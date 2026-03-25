import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import path from "path"
import { Global } from "@/global"
import type { SmokeResult } from "../types"

const FATAL = /(fatal|panic|uncaught|eaddrinuse|segmentation fault|electron.*crash|exception)/i
const READY = /(ready|listening|vite|compiled|running|dev server)/i

export namespace CellSmokeVerifier {
  export async function verify(
    projectDir: string,
    runID: string,
    cfg: { command: string; startup_timeout_ms: number; healthy_window_ms: number },
    abort?: AbortSignal,
  ): Promise<SmokeResult> {
    const log_path = path.join(Global.Path.state, "autofix", "run", runID, "smoke.log")
    let text = ""
    let ok = false
    let ready = false
    let done = false
    const ctl = new AbortController()
    const stop = () => {
      if (done) return
      done = true
      ctl.abort()
    }
    abort?.addEventListener("abort", stop, { once: true })
    const proc = Process.spawn(["sh", "-lc", cfg.command], {
      cwd: projectDir,
      stdout: "pipe",
      stderr: "pipe",
      abort: ctl.signal,
      timeout: 2_000,
    })
    const push = (chunk: Buffer) => {
      const next = chunk.toString()
      text += next
      if (READY.test(next)) ready = true
      if (FATAL.test(next)) stop()
    }
    proc.stdout?.on("data", push)
    proc.stderr?.on("data", push)
    const timer = setTimeout(() => {
      ok = ready || text.length > 0
      stop()
    }, cfg.healthy_window_ms)
    const timeout = setTimeout(stop, cfg.startup_timeout_ms)
    const code = await proc.exited.finally(() => {
      clearTimeout(timer)
      clearTimeout(timeout)
    })
    await Filesystem.write(log_path, text)
    abort?.removeEventListener("abort", stop)
    if (abort?.aborted) {
      return {
        ok: false,
        log_path,
        summary: "Smoke verification aborted",
      }
    }
    if (!ok && code === 0 && text.length > 0 && !FATAL.test(text)) ok = true
    return {
      ok,
      log_path,
      summary: ok ? "Smoke verification passed" : "Smoke verification failed",
    }
  }
}
