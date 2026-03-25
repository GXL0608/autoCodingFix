import { Process } from "@/util/process"

export namespace LocalGitFlow {
  export async function ensureClean(dir: string) {
    const out = await Process.text(["git", "status", "--porcelain"], {
      cwd: dir,
      nothrow: true,
    })
    if (out.code !== 0) throw new Error(out.stderr.toString() || "git status failed")
    if (out.text.trim()) throw new Error("Target repository has uncommitted changes")
  }

  export async function branch(dir: string) {
    const out = await Process.text(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: dir,
      nothrow: true,
    })
    const name = out.text.trim()
    if (out.code !== 0 || !name) throw new Error(out.stderr.toString() || "Unable to determine git branch")
    if (name === "HEAD") throw new Error("Detached HEAD is not supported for autofix")
    return name
  }

  export async function head(dir: string) {
    const out = await Process.text(["git", "rev-parse", "HEAD"], {
      cwd: dir,
      nothrow: true,
    })
    const hash = out.text.trim()
    if (out.code !== 0 || !hash) throw new Error(out.stderr.toString() || "Unable to resolve git HEAD")
    return hash
  }

  export async function diff(dir: string) {
    const out = await Process.lines(["git", "diff", "--name-only"], {
      cwd: dir,
      nothrow: true,
    })
    return out
  }

  export async function commit(dir: string, message: string) {
    const add = await Process.run(["git", "add", "-A"], {
      cwd: dir,
      nothrow: true,
    })
    if (add.code !== 0) throw new Error(add.stderr.toString() || "git add failed")
    const out = await Process.run(["git", "commit", "--no-verify", "-m", message], {
      cwd: dir,
      nothrow: true,
    })
    if (out.code !== 0) throw new Error(out.stderr.toString() || out.stdout.toString() || "git commit failed")
    return head(dir)
  }

  export async function rollback(dir: string, commit: string) {
    const out = await Process.run(["git", "reset", "--hard", commit], {
      cwd: dir,
      nothrow: true,
    })
    if (out.code !== 0) throw new Error(out.stderr.toString() || "git reset failed")
  }
}
