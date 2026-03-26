import { createHash } from "crypto"
import path from "path"
import { Glob } from "@/util/glob"
import { Process } from "@/util/process"
import { Filesystem } from "@/util/filesystem"
import { Global } from "@/global"
import type { ArtifactResult } from "./types"

export namespace VersionManager {
  function strip(version: string) {
    return version.replace(/-af\.\d+\.\d+$/, "")
  }

  export async function bump(projectDir: string, feedbackID: string, seq: number, format: string) {
    const file = path.join(projectDir, "package.json")
    const pkg = await Filesystem.readJson<{ version?: string }>(file)
    const current = pkg.version
    if (!current) throw new Error("package.json version is missing")
    const base = strip(current)
    const next = format.replace("{base}", base).replace("{seq}", String(seq)).replace("{feedbackId}", feedbackID)
    await Filesystem.writeJson(file, {
      ...(await Filesystem.readJson<Record<string, unknown>>(file)),
      version: next,
    })
    return next
  }
}

export namespace CellPackager {
  async function snap(dir: string, list: string[]) {
    const files = await Promise.all(
      list.flatMap((pattern) =>
        Glob.scan(pattern, {
          cwd: dir,
          absolute: true,
          dot: true,
        }),
      ),
    )
    return files
      .flat()
      .map((item) => {
        const stat = Filesystem.stat(item)
        return stat
          ? {
              path: item,
              mtime: Number(stat.mtimeMs),
            }
          : undefined
      })
      .filter((item): item is { path: string; mtime: number } => !!item)
  }

  async function hash(file: string) {
    const buf = await Filesystem.readBytes(file)
    return createHash("sha256").update(buf).digest("hex")
  }

  export async function build(
    projectDir: string,
    runID: string,
    cfg: { command: string; artifact_glob: string[] },
    abort?: AbortSignal,
  ): Promise<ArtifactResult> {
    const before = await snap(projectDir, cfg.artifact_glob)
    const log_path = path.join(Global.Path.state, "autofix", "run", runID, "package.log")
    const out = await Process.run(["sh", "-lc", cfg.command], {
      cwd: projectDir,
      abort,
      nothrow: true,
    })
    await Filesystem.write(log_path, Buffer.concat([out.stdout, Buffer.from("\n"), out.stderr]))
    if (out.code !== 0) throw new Error(out.stderr.toString() || out.stdout.toString() || "Package command failed")
    const after = await snap(projectDir, cfg.artifact_glob)
    const known = new Map(before.map((item) => [item.path, item.mtime]))
    const pick = after
      .filter((item) => (known.get(item.path) ?? 0) < item.mtime)
      .sort((a, b) => b.mtime - a.mtime)[0]
    if (!pick) throw new Error("No package artifact found after build")
    return {
      path: pick.path,
      sha256: await hash(pick.path),
      size_bytes: await Filesystem.size(pick.path),
      log_path,
    }
  }
}
