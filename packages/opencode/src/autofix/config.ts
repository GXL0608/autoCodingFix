import path from "path"
import { Config } from "@/config/config"
import { Env } from "@/env"
import { Instance } from "@/project/instance"
import { Process } from "@/util/process"
import type { ResolvedTarget } from "./types"

const SSLMODE = new Set(["disable", "allow", "prefer", "require", "verify-ca", "verify-full"])
const DSN = "postgres://opencode:opencode@182.92.74.187:9124/omnivoice_main?sslmode=prefer"

export namespace AutofixConfig {
  function base(input: { directory: string; worktree: string; remotes: string[] }): ResolvedTarget {
    return {
      directory: input.directory,
      worktree: input.worktree,
      project_id: Instance.project.id,
      profile: "cell",
      remotes: input.remotes,
      source: {
        kind: "postgres",
        dsn: DSN,
        dsn_env: "OPENCODE_AUTOFIX_CELL_PG_DSN",
        table: "voice_feedback_records",
        sync_batch: 100,
      },
      feedback: {
        use_audio_when_text_missing: true,
        max_audio_bytes: 8 * 1024 * 1024,
      },
      verify: {
        kind: "electron_webview_smoke",
        command: "npm run desktop:webview",
        startup_timeout_ms: 120_000,
        healthy_window_ms: 10_000,
      },
      package: {
        command: "sh build-mac-arm64-dmg.sh",
        artifact_glob: ["**/*.dmg"],
      },
      version: {
        kind: "suffix",
        source: "root_package_json",
        format: "{base}-af.{seq}.{feedbackId}",
      },
    }
  }

  function norm(dir: string) {
    return path.resolve(dir)
  }

  async function remotes(dir: string) {
    const names = await Process.lines(["git", "remote"], {
      cwd: dir,
      nothrow: true,
    })
    return Promise.all(
      names.map(async (name) => {
        const out = await Process.text(["git", "remote", "get-url", name], {
          cwd: dir,
          nothrow: true,
        })
        if (out.code !== 0) return
        const text = out.text.trim()
        if (!text) return
        return text
      }),
    ).then((all) => all.filter((item): item is string => !!item))
  }

  function matchRemote(rule: string | undefined, list: string[]) {
    if (!rule) return true
    return list.includes(rule)
  }

  function resolveDsn(source: NonNullable<NonNullable<Config.Autofix["profiles"]>[string]>["source"]) {
    const dsn_env = source.dsn_env ?? "OPENCODE_AUTOFIX_CELL_PG_DSN"
    const dsn = source.dsn ?? Env.get(dsn_env) ?? DSN
    const url = new URL(dsn)
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error(`Unsupported PostgreSQL DSN protocol: ${url.protocol}`)
    const sslmode = url.searchParams.get("sslmode")
    if (sslmode && !SSLMODE.has(sslmode)) throw new Error(`Unsupported PostgreSQL sslmode: ${sslmode}`)
    return { dsn, dsn_env }
  }

  async function supported(dir: string) {
    return Instance.project.id !== "global"
  }

  function merge(target: ResolvedTarget, profile?: NonNullable<NonNullable<Config.Autofix["profiles"]>[string]>) {
    if (!profile) return target
    const dsn = resolveDsn(profile.source)
    return {
      ...target,
      source: {
        ...target.source,
        dsn: dsn.dsn,
        dsn_env: dsn.dsn_env,
        table: profile.source.table ?? target.source.table,
        sync_batch: profile.source.sync_batch ?? target.source.sync_batch,
      },
      feedback: {
        ...target.feedback,
        use_audio_when_text_missing:
          profile.feedback?.use_audio_when_text_missing ?? target.feedback.use_audio_when_text_missing,
        max_audio_bytes: profile.feedback?.max_audio_bytes ?? target.feedback.max_audio_bytes,
      },
      verify: {
        ...target.verify,
        command: profile.verify?.command ?? target.verify.command,
        startup_timeout_ms: profile.verify?.startup_timeout_ms ?? target.verify.startup_timeout_ms,
        healthy_window_ms: profile.verify?.healthy_window_ms ?? target.verify.healthy_window_ms,
      },
      package: {
        ...target.package,
        command: profile.package?.command ?? target.package.command,
        artifact_glob: profile.package?.artifact_glob ?? target.package.artifact_glob,
      },
      version: {
        ...target.version,
        format: profile.version?.format ?? target.version.format,
      },
    }
  }

  export async function resolveForDirectory(directory: string): Promise<ResolvedTarget | null> {
    const dir = norm(directory)
    const worktree = norm(Instance.project.worktree || directory)
    if (!(await supported(worktree))) return null
    const rem = await remotes(worktree)
    const built = base({
      directory: dir,
      worktree,
      remotes: rem,
    })
    const cfg = await Config.get()
    const autofix = cfg.autofix
    const cell = merge(built, autofix?.profiles?.cell)
    if (!autofix?.targets?.length) return cell
    for (const item of autofix.targets) {
      const profile = autofix.profiles?.[item.profile]
      if (!profile) continue
      if (item.match.worktree && norm(item.match.worktree) !== worktree) continue
      if (!matchRemote(item.match.git_remote, rem)) continue
      return {
        ...merge(cell, profile),
        profile: item.profile,
      }
    }
    return cell
  }
}
