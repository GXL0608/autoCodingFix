import { rm } from "fs/promises"
import path from "path"
import { Global } from "@/global"
import { Lock } from "@/util/lock"
import { Filesystem } from "@/util/filesystem"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Instance } from "@/project/instance"
import { AutofixAnalyzer } from "./analysis"
import { AutofixAuto } from "./auto"
import { AutofixConfig } from "./config"
import { AutofixExecutor } from "./executor"
import { AutofixHarness } from "./harness"
import { LocalGitFlow } from "./git"
import { CellPackager, VersionManager } from "./package"
import { AutofixQueue } from "./queue"
import { AutofixReport } from "./report"
import { CellFeedbackSource } from "./source/postgres"
import { CellSmokeVerifier } from "./verify/electron-webview"
import type { AutofixSchema } from "./schema"
import type { ResolvedTarget, RunCtx } from "./types"

const MAX_ATTEMPTS = 5

type Job = {
  abort: AbortController
  promise: Promise<void>
}

const jobs = new Map<string, Job>()
const active = new Set(["analyzing", "implementing", "verifying", "committing", "packaging"])

export namespace AutofixRunner {
  function key(cfg: Pick<ResolvedTarget, "project_id" | "directory">) {
    return `${cfg.project_id}:${cfg.directory}`
  }

  async function prompt(cfg: Pick<ResolvedTarget, "project_id" | "directory">) {
    return AutofixQueue.getPrompt(cfg.project_id, cfg.directory)
  }

  async function harness(cfg: Pick<ResolvedTarget, "project_id" | "directory">) {
    return AutofixQueue.getHarness(cfg.project_id, cfg.directory)
  }

  function meta(item?: AutofixSchema.HarnessRun) {
    return {
      sessions: [],
      ...item,
    } satisfies AutofixSchema.HarnessRun
  }

  async function setMeta(runID: string, patch: Partial<AutofixSchema.HarnessRun>) {
    const row = await AutofixQueue.getRun(runID)
    const next = {
      ...meta(row?.harness),
      ...patch,
      sessions: patch.sessions ?? meta(row?.harness).sessions,
    } satisfies AutofixSchema.HarnessRun
    await AutofixQueue.updateRun(runID, {
      harness: next,
    })
    return next
  }

  async function addMeta(runID: string, kind: string, session_id: string) {
    const row = await AutofixQueue.getRun(runID)
    const next = meta(row?.harness)
    await AutofixQueue.updateRun(runID, {
      harness: {
        ...next,
        sessions: [...next.sessions, { kind, session_id }],
      },
    })
  }

  function extra(...items: Array<string | undefined>) {
    return items.map((item) => item?.trim()).filter(Boolean).join("\n\n")
  }

  function decision(item: AutofixSchema.HarnessDecision) {
    return [item.summary, item.issues.length ? `问题：\n${item.issues.map((row) => `- ${row}`).join("\n")}` : undefined, item.next.length ? `建议：\n${item.next.map((row) => `- ${row}`).join("\n")}` : undefined]
      .filter(Boolean)
      .join("\n\n")
  }

  async function collect(cfg: ResolvedTarget, feedbackID: string) {
    const roots = [cfg.directory, Global.Path.data, Global.Path.state].map((item) => Filesystem.resolve(item))
    const files = new Set<string>()
    const sessions = new Set<string>()
    const push = (file?: string) => {
      if (!file) return
      const next = Filesystem.resolve(file)
      if (!roots.some((root) => Filesystem.contains(root, next))) return
      files.add(next)
    }
    for (const row of (await AutofixQueue.listRuns(cfg.project_id, cfg.directory)).filter((item) => item.feedback_id === feedbackID)) {
      const detail = await AutofixQueue.detailByScope(cfg.project_id, cfg.directory, row.id)
      if (!detail) continue
      if (detail.run.session_id) sessions.add(detail.run.session_id)
      detail.run.harness?.sessions.forEach((item) => sessions.add(item.session_id))
      push(detail.run.report_json_path)
      push(detail.run.report_md_path)
      push(detail.run.smoke_log_path)
      push(detail.run.package_log_path)
      push(path.join(Global.Path.state, "autofix", "run", detail.run.id))
      push(path.join(Global.Path.data, "autofix", detail.run.project_id, detail.run.id))
      detail.attempts.forEach((item) => {
        push(item.verify_log_path)
        push(item.package_log_path)
      })
      detail.artifacts.forEach((item) => push(item.path))
    }
    return {
      files: [...files],
      sessions: [...sessions],
    }
  }

  async function target(projectDir: string) {
    const next = await AutofixConfig.resolveForDirectory(projectDir)
    if (!next) throw new Error("Autofix is not enabled for the current project")
    return next
  }

  async function preflight(cfg: ResolvedTarget) {
    const file = path.join(cfg.directory, "package.json")
    const pkg = await Filesystem.readJson<{ scripts?: Record<string, string>; version?: string }>(file).catch(() => undefined)
    if (!pkg?.version) throw new Error("package.json version is missing")
    if (!pkg.scripts?.["desktop:webview"]) throw new Error("package.json is missing desktop:webview script")
    if (!(await Filesystem.exists(path.join(cfg.directory, "build-mac-arm64-dmg.sh"))))
      throw new Error("build-mac-arm64-dmg.sh is missing")
    await LocalGitFlow.ensureClean(cfg.directory)
    await LocalGitFlow.branch(cfg.directory)
  }

  async function ready(cfg: ResolvedTarget) {
    return preflight(cfg).catch(async (err) => {
      await AutofixQueue.setState({
        directory: cfg.directory,
        project_id: cfg.project_id,
        profile: cfg.profile,
        status: "blocked",
        note: err instanceof Error ? err.message : String(err),
        active_run_id: null,
        stop_requested: false,
      })
      throw err
    })
  }

  async function audio(cfg: ResolvedTarget, feedback: Awaited<ReturnType<typeof AutofixQueue.getFeedback>>) {
    if (!feedback) return
    if (feedback.recognized_text?.trim()) return
    if (feedback.meta && JSON.stringify(feedback.meta) !== "{}") return
    if (!cfg.feedback.use_audio_when_text_missing || !feedback.has_audio) return
    if ((feedback.audio_size_bytes ?? 0) > cfg.feedback.max_audio_bytes) return
    return CellFeedbackSource.fetchAudio(cfg.source, feedback.external_id)
  }

  async function ctx(cfg: ResolvedTarget, runID: string, sessionID: string) {
    const detail = await AutofixQueue.detailByScope(cfg.project_id, cfg.directory, runID)
    if (!detail?.feedback) throw new Error("Autofix feedback not found")
    return {
      target: cfg,
      run_id: runID,
      session_id: sessionID,
      feedback_id: detail.feedback.id,
      external_id: detail.feedback.external_id,
      recognized_text: detail.feedback.recognized_text,
      meta: detail.feedback.meta,
      app_version: detail.feedback.app_version,
      language: detail.feedback.language,
      recognize_error: detail.feedback.recognize_error,
    } satisfies RunCtx
  }

  async function rollback(cfg: ResolvedTarget, base_commit?: string) {
    const state = await AutofixQueue.summary({
      directory: cfg.directory,
      project_id: cfg.project_id,
      profile: cfg.profile,
      supported: true,
    })
    const commit = state.state.last_success_commit ?? base_commit
    if (!commit) return
    await LocalGitFlow.rollback(cfg.directory, commit)
  }

  async function fail(cfg: ResolvedTarget, runID: string, feedbackID: string, reason: string, base_commit?: string) {
    await rollback(cfg, base_commit)
    await AutofixQueue.updateRun(runID, {
      status: "failed",
      failure_reason: reason,
      time_finished: Date.now(),
    })
    await AutofixQueue.setStatus(feedbackID, "failed", reason, runID)
    await AutofixQueue.log({
      directory: cfg.directory,
      project_id: cfg.project_id,
      run_id: runID,
      feedback_id: feedbackID,
      phase: "failed",
      level: "error",
      message: reason,
    })
    await AutofixQueue.emitRun(cfg.directory, runID)
  }

  async function halt(cfg: ResolvedTarget, runID: string, feedbackID: string, reason: string, base_commit?: string) {
    await rollback(cfg, base_commit)
    await AutofixQueue.updateRun(runID, {
      status: "stopped",
      failure_reason: reason,
      time_finished: Date.now(),
    })
    await AutofixQueue.setStatus(feedbackID, "stopped", reason, runID)
    await AutofixQueue.log({
      directory: cfg.directory,
      project_id: cfg.project_id,
      run_id: runID,
      feedback_id: feedbackID,
      phase: "stopped",
      level: "warn",
      message: reason,
    })
    await AutofixQueue.emitRun(cfg.directory, runID)
  }

  async function queued(cfg: ResolvedTarget, feedbackID: string, mode: AutofixSchema.RunMode) {
    const branch = await LocalGitFlow.branch(cfg.directory)
    const base_commit = await LocalGitFlow.head(cfg.directory)
    const run = await AutofixQueue.createRun({
      project_id: cfg.project_id,
      directory: cfg.directory,
      feedback_id: feedbackID,
      mode,
      status: "queued",
      branch,
      base_commit,
      last_success_commit: (
        await AutofixQueue.summary({
          directory: cfg.directory,
          project_id: cfg.project_id,
          profile: cfg.profile,
          supported: true,
        })
      ).state.last_success_commit,
    })
    await AutofixQueue.setStatus(feedbackID, "queued", undefined, run.id)
    await AutofixQueue.emitRun(cfg.directory, run.id)
    return run
  }

  async function mode(cfg: ResolvedTarget, pick?: AutofixSchema.StartInput) {
    if (pick?.mode) return pick.mode
    return (await harness(cfg)).enabled ? "harness" : "legacy"
  }

  async function block(
    cfg: ResolvedTarget,
    runID: string,
    feedbackID: string,
    reason: string,
    plan?: AutofixSchema.Plan,
  ) {
    await AutofixQueue.updateRun(runID, {
      status: "blocked",
      failure_reason: reason,
      plan,
      time_finished: Date.now(),
    })
    await AutofixQueue.setStatus(feedbackID, "blocked", reason, runID)
    await AutofixQueue.emitRun(cfg.directory, runID)
  }

  async function legacy(
    cfg: ResolvedTarget,
    run: RunCtx,
    feedback: NonNullable<NonNullable<Awaited<ReturnType<typeof AutofixQueue.detailByScope>>>["feedback"]>,
    base_commit: string | undefined,
    audio_file: Awaited<ReturnType<typeof audio>>,
    item: AutofixSchema.Prompt,
    abort?: AbortSignal,
    opts?: {
      extra?: string
      plan?: AutofixSchema.Plan
      issue?: string
      pick?: AutofixSchema.StartInput
    },
  ) {
    await AutofixQueue.updateRun(run.run_id, {
      session_id: run.session_id,
      status: opts?.plan ? "implementing" : "analyzing",
    })
    await AutofixQueue.setStatus(feedback.id, opts?.plan ? "implementing" : "analyzing", undefined, run.run_id)
    await AutofixQueue.emitRun(cfg.directory, run.run_id)
    await AutofixQueue.log({
      directory: cfg.directory,
      project_id: cfg.project_id,
      run_id: run.run_id,
      feedback_id: feedback.id,
      phase: opts?.plan ? "implementing" : "analyzing",
      level: "info",
      message: opts?.plan ? `Continuing feedback #${feedback.external_id}` : `Analyzing feedback #${feedback.external_id}`,
    })
    const plan =
      opts?.plan ?? (await AutofixAnalyzer.analyze(run, feedback, audio_file ?? undefined, opts?.extra, item, opts?.pick))
    if (!plan.automatable) {
      await block(cfg, run.run_id, feedback.id, plan.blockers?.join("\n") || "Plan marked feedback as not automatable", plan)
      return
    }
    await AutofixQueue.updateRun(run.run_id, {
      plan,
      status: "implementing",
    })
    await AutofixQueue.emitRun(cfg.directory, run.run_id)
    let issue = opts?.issue ?? ""
    for (let no = 1; no <= MAX_ATTEMPTS; no++) {
      if (abort?.aborted) {
        await halt(cfg, run.run_id, feedback.id, "Autofix run aborted", base_commit)
        return
      }
      const attempt = await AutofixQueue.createAttempt(run.run_id, no)
      await AutofixQueue.updateAttempt(attempt, {
        status: "running",
      })
      await AutofixQueue.setStatus(feedback.id, "implementing", undefined, run.run_id)
      const result = await AutofixExecutor.implement(
        run,
        feedback,
        plan,
        no,
        audio_file ?? undefined,
        issue,
        opts?.extra,
        item,
        opts?.pick,
      )
      await AutofixQueue.updateAttempt(attempt, {
        files: result.files,
        summary: `Touched ${result.files.length} file(s)`,
      })
      await AutofixQueue.updateRun(run.run_id, {
        status: "verifying",
      })
      await AutofixQueue.setStatus(feedback.id, "verifying", undefined, run.run_id)
      const smoke = await CellSmokeVerifier.verify(cfg.directory, run.run_id, cfg.verify, abort)
      await AutofixQueue.updateAttempt(attempt, {
        status: smoke.ok ? "verified" : abort?.aborted ? "stopped" : "failed",
        verify_ok: smoke.ok,
        verify_log_path: smoke.log_path,
        error: smoke.ok ? undefined : smoke.summary,
      })
      await AutofixQueue.updateRun(run.run_id, {
        smoke_log_path: smoke.log_path,
      })
      if (smoke.ok) break
      issue = [smoke.summary, await Filesystem.readText(smoke.log_path).catch(() => "")].filter(Boolean).join("\n\n")
      if (no === MAX_ATTEMPTS) {
        await fail(cfg, run.run_id, feedback.id, smoke.summary, base_commit)
        return
      }
    }
    return finish(cfg, run.run_id, feedback.id, feedback.external_id, base_commit, abort)
  }

  async function finish(
    cfg: ResolvedTarget,
    runID: string,
    feedbackID: string,
    external_id: number,
    base_commit?: string,
    abort?: AbortSignal,
  ) {
    const seq = (await AutofixQueue.listFeedback(cfg.project_id, cfg.directory)).filter((item) => item.status === "done").length + 1
    await AutofixQueue.updateRun(runID, {
      status: "committing",
    })
    await AutofixQueue.setStatus(feedbackID, "committing", undefined, runID)
    const version = await VersionManager.bump(cfg.directory, String(external_id), seq, cfg.version.format)
    const commit_hash = await LocalGitFlow.commit(cfg.directory, `autofix(cell): feedback #${external_id}`)
    await AutofixQueue.updateRun(runID, {
      commit_hash,
      version,
      status: "packaging",
    })
    await AutofixQueue.setStatus(feedbackID, "packaging", undefined, runID)
    try {
      const pack = await CellPackager.build(cfg.directory, runID, cfg.package, abort)
      await AutofixQueue.addArtifact({
        directory: cfg.directory,
        run_id: runID,
        kind: "package",
        path: pack.path,
        sha256: pack.sha256,
        size_bytes: pack.size_bytes,
        mime: "application/x-apple-diskimage",
      })
      const report = await AutofixReport.write(cfg.project_id, cfg.directory, runID)
      await AutofixQueue.updateRun(runID, {
        status: "done",
        version,
        commit_hash,
        package_log_path: pack.log_path,
        report_json_path: report.report_json_path,
        report_md_path: report.report_md_path,
        time_finished: Date.now(),
      })
      await AutofixQueue.setStatus(feedbackID, "done", undefined, runID)
      await AutofixQueue.setState({
        directory: cfg.directory,
        project_id: cfg.project_id,
        profile: cfg.profile,
        status: "running",
        last_success_commit: commit_hash,
        last_success_version: version,
      })
      await AutofixQueue.emitRun(cfg.directory, runID)
      return
    } catch (err) {
      await fail(cfg, runID, feedbackID, err instanceof Error ? err.message : String(err), base_commit)
    }
  }

  async function fallback(
    cfg: ResolvedTarget,
    run: RunCtx,
    feedback: NonNullable<NonNullable<Awaited<ReturnType<typeof AutofixQueue.detailByScope>>>["feedback"]>,
    base_commit: string | undefined,
    audio_file: Awaited<ReturnType<typeof audio>>,
    item: AutofixSchema.Prompt,
    why: string,
    abort?: AbortSignal,
    opts?: {
      extra?: string
      plan?: AutofixSchema.Plan
      issue?: string
      pick?: AutofixSchema.StartInput
    },
  ) {
    await rollback(cfg, base_commit)
    await setMeta(run.run_id, {
      stage: "legacy-fallback",
      fallback: true,
      fallback_reason: why,
    })
    await AutofixQueue.log({
      directory: cfg.directory,
      project_id: cfg.project_id,
      run_id: run.run_id,
      feedback_id: feedback.id,
      phase: "fallback",
      level: "warn",
      message: why,
    })
    return legacy(cfg, run, feedback, base_commit, audio_file, item, abort, {
      ...opts,
      extra: extra(opts?.extra, `Harness 回退原因：\n${why}`),
    })
  }

  async function governed(
    cfg: ResolvedTarget,
    run: RunCtx,
    feedback: NonNullable<NonNullable<Awaited<ReturnType<typeof AutofixQueue.detailByScope>>>["feedback"]>,
    base_commit: string | undefined,
    audio_file: Awaited<ReturnType<typeof audio>>,
    item: AutofixSchema.Prompt,
    abort?: AbortSignal,
    opts?: {
      extra?: string
      plan?: AutofixSchema.Plan
      issue?: string
      pick?: AutofixSchema.StartInput
    },
  ) {
    const gov = await harness(cfg)
    try {
    await setMeta(run.run_id, {
      stage: gov.survey ? "survey" : "planning",
      sessions: [],
    })
    await AutofixQueue.updateRun(run.run_id, {
      session_id: run.session_id,
      status: opts?.plan ? "implementing" : "analyzing",
    })
    await AutofixQueue.setStatus(feedback.id, opts?.plan ? "implementing" : "analyzing", undefined, run.run_id)
    await AutofixQueue.emitRun(cfg.directory, run.run_id)
    let sum: AutofixSchema.HarnessSurvey | undefined
    if (gov.survey) {
      await AutofixQueue.log({
        directory: cfg.directory,
        project_id: cfg.project_id,
        run_id: run.run_id,
        feedback_id: feedback.id,
        phase: "survey",
        level: "info",
        message: `Survey feedback #${feedback.external_id}`,
      })
      const res = await AutofixHarness.survey(run.session_id, run, feedback, audio_file ?? undefined, gov, opts?.pick)
      sum = res.data
      await addMeta(run.run_id, "survey", res.session_id)
      await setMeta(run.run_id, {
        stage: "planning",
        survey: sum,
      })
    }
    const plan =
      opts?.plan ??
      (await AutofixAnalyzer.analyze(
        run,
        feedback,
        audio_file ?? undefined,
        extra(opts?.extra, sum ? `survey 摘要：${sum.summary}\n重点文件：\n${sum.files.map((item) => `- ${item}`).join("\n")}` : undefined, gov.analysis),
        item,
        opts?.pick,
      ))
    if (!plan.automatable) {
      const why = plan.blockers?.join("\n") || "Plan marked feedback as not automatable"
      if (gov.fallback_legacy) {
        return fallback(cfg, run, feedback, base_commit, audio_file, item, why, abort, {
          ...opts,
          plan: undefined,
        })
      }
      await block(cfg, run.run_id, feedback.id, why, plan)
      return
    }
    if (gov.review) {
      await setMeta(run.run_id, {
        stage: "plan-review",
      })
      const res = await AutofixHarness.planReview(
        run.session_id,
        run,
        feedback,
        audio_file ?? undefined,
        plan,
        sum,
        gov,
        opts?.pick,
      )
      await addMeta(run.run_id, "plan_review", res.session_id)
      await setMeta(run.run_id, {
        stage: "implementing",
        plan_review: res.data,
      })
      await AutofixQueue.log({
        directory: cfg.directory,
        project_id: cfg.project_id,
        run_id: run.run_id,
        feedback_id: feedback.id,
        phase: "plan_review",
        level: res.data.ok ? "info" : "warn",
        message: res.data.summary,
        payload_json: res.data,
      })
      if (!res.data.ok) {
        const why = decision(res.data)
        if (gov.fallback_legacy) {
          return fallback(cfg, run, feedback, base_commit, audio_file, item, why, abort, {
            ...opts,
            plan: undefined,
          })
        }
        await block(cfg, run.run_id, feedback.id, why, plan)
        return
      }
    }
    await AutofixQueue.updateRun(run.run_id, {
      plan,
      status: "implementing",
    })
    await AutofixQueue.emitRun(cfg.directory, run.run_id)
    let issue = opts?.issue ?? ""
    const note = extra(
      opts?.extra,
      sum ? `survey 摘要：${sum.summary}\n相关文件：\n${sum.files.map((item) => `- ${item}`).join("\n")}` : undefined,
      "如果遇到大范围搜索、长日志分析、复杂排查或不确定实现入口，优先使用 task 工具把探索工作交给子智能体处理，并基于子智能体结果继续，不要把无关上下文持续堆进当前主会话。",
      gov.build,
    )
    for (let no = 1; no <= MAX_ATTEMPTS; no++) {
      if (abort?.aborted) {
        await halt(cfg, run.run_id, feedback.id, "Autofix run aborted", base_commit)
        return
      }
      await setMeta(run.run_id, {
        stage: "implementing",
      })
      const id = await AutofixQueue.createAttempt(run.run_id, no)
      await AutofixQueue.updateAttempt(id, {
        status: "running",
      })
      await AutofixQueue.setStatus(feedback.id, "implementing", undefined, run.run_id)
      const result = await AutofixExecutor.implement(
        run,
        feedback,
        plan,
        no,
        audio_file ?? undefined,
        issue,
        note,
        item,
        opts?.pick,
      )
      await AutofixQueue.updateAttempt(id, {
        files: result.files,
        summary: `Touched ${result.files.length} file(s)`,
      })
      if (gov.review) {
        await setMeta(run.run_id, {
          stage: "review",
        })
        const res = await AutofixHarness.review(
          run.session_id,
          run,
          feedback,
          audio_file ?? undefined,
          plan,
          no,
          result.files,
          sum,
          gov,
          opts?.pick,
        )
        await addMeta(run.run_id, "review", res.session_id)
        await AutofixQueue.updateAttempt(id, {
          review: res.data,
        })
        await AutofixQueue.log({
          directory: cfg.directory,
          project_id: cfg.project_id,
          run_id: run.run_id,
          feedback_id: feedback.id,
          phase: "review",
          level: res.data.ok ? "info" : "warn",
          message: res.data.summary,
          payload_json: res.data,
        })
        if (!res.data.ok) {
          issue = decision(res.data)
          await AutofixQueue.updateAttempt(id, {
            status: "failed",
            error: issue,
          })
          if (no === MAX_ATTEMPTS) {
            if (gov.fallback_legacy) {
              return fallback(cfg, run, feedback, base_commit, audio_file, item, issue, abort, {
                ...opts,
                plan,
                issue,
              })
            }
            await fail(cfg, run.run_id, feedback.id, res.data.summary, base_commit)
            return
          }
          continue
        }
      }
      await AutofixQueue.updateRun(run.run_id, {
        status: "verifying",
      })
      await AutofixQueue.setStatus(feedback.id, "verifying", undefined, run.run_id)
      await setMeta(run.run_id, {
        stage: "smoke",
      })
      const smoke = await CellSmokeVerifier.verify(cfg.directory, run.run_id, cfg.verify, abort)
      await AutofixQueue.updateAttempt(id, {
        status: smoke.ok ? "verified" : abort?.aborted ? "stopped" : "failed",
        verify_ok: smoke.ok,
        verify_log_path: smoke.log_path,
        error: smoke.ok ? undefined : smoke.summary,
      })
      await AutofixQueue.updateRun(run.run_id, {
        smoke_log_path: smoke.log_path,
      })
      if (!smoke.ok) {
        issue = [smoke.summary, await Filesystem.readText(smoke.log_path).catch(() => "")].filter(Boolean).join("\n\n")
        if (no === MAX_ATTEMPTS) {
          if (gov.fallback_legacy) {
            return fallback(cfg, run, feedback, base_commit, audio_file, item, smoke.summary, abort, {
              ...opts,
              plan,
              issue,
            })
          }
          await fail(cfg, run.run_id, feedback.id, smoke.summary, base_commit)
          return
        }
        continue
      }
      if (gov.verify) {
        await setMeta(run.run_id, {
          stage: "gate",
        })
        const res = await AutofixHarness.gate(
          run.session_id,
          run,
          feedback,
          audio_file ?? undefined,
          plan,
          no,
          result.files,
          sum,
          {
            summary: smoke.summary,
            log_path: smoke.log_path,
          },
          cfg.verify,
          gov,
          opts?.pick,
        )
        await addMeta(run.run_id, "gate", res.session_id)
        await AutofixQueue.updateAttempt(id, {
          gate: res.data,
        })
        await AutofixQueue.log({
          directory: cfg.directory,
          project_id: cfg.project_id,
          run_id: run.run_id,
          feedback_id: feedback.id,
          phase: "gate",
          level: res.data.ok ? "info" : "warn",
          message: res.data.summary,
          payload_json: res.data,
        })
        if (!res.data.ok) {
          issue = decision(res.data)
          await AutofixQueue.updateAttempt(id, {
            status: "failed",
            error: issue,
          })
          if (no === MAX_ATTEMPTS) {
            if (gov.fallback_legacy) {
              return fallback(cfg, run, feedback, base_commit, audio_file, item, issue, abort, {
                ...opts,
                plan,
                issue,
              })
            }
            await fail(cfg, run.run_id, feedback.id, res.data.summary, base_commit)
            return
          }
          continue
        }
      }
      break
    }
    await setMeta(run.run_id, {
      stage: "committing",
    })
    return finish(cfg, run.run_id, feedback.id, feedback.external_id, base_commit, abort)
    } catch (err) {
      if (gov.fallback_legacy && !abort?.aborted) {
        return fallback(cfg, run, feedback, base_commit, audio_file, item, err instanceof Error ? err.message : String(err), abort, opts)
      }
      throw err
    }
  }

  async function runOne(
    cfg: ResolvedTarget,
    runID: string,
    abort?: AbortSignal,
    opts?: {
      session_id?: Awaited<ReturnType<typeof Session.create>>["id"]
      extra?: string
      plan?: AutofixSchema.Plan
      issue?: string
      pick?: AutofixSchema.StartInput
    },
  ) {
    const detail = await AutofixQueue.detailByScope(cfg.project_id, cfg.directory, runID)
    if (!detail?.feedback) throw new Error("Autofix run has no feedback")
    const base_commit = detail.run.base_commit
    const feedback = detail.feedback!
    const audio_file = await audio(cfg, feedback)
    let sessionID = opts?.session_id
    try {
      if (!sessionID) {
        const session = await Session.create({
          title: `Autofix #${feedback.external_id}`,
        })
        sessionID = session.id
      }
      AutofixAuto.enable(sessionID)
      const run = await ctx(cfg, runID, sessionID)
      const item = await prompt(cfg)
      if (detail.run.mode === "harness") {
        return governed(cfg, run, feedback, base_commit, audio_file, item, abort, opts)
      }
      return legacy(cfg, run, feedback, base_commit, audio_file, item, abort, opts)
    } catch (err) {
      if (abort?.aborted) {
        await halt(cfg, runID, feedback.id, "Autofix run aborted", base_commit)
        return
      }
      await fail(cfg, runID, feedback.id, err instanceof Error ? err.message : String(err), base_commit)
    } finally {
      if (sessionID) AutofixAuto.disable(sessionID)
      if (audio_file?.path) await rm(audio_file.path, { force: true }).catch(() => undefined)
    }
  }

  async function loop(cfg: ResolvedTarget, abort: AbortController, pick?: AutofixSchema.StartInput) {
    await AutofixQueue.setState({
      directory: cfg.directory,
      project_id: cfg.project_id,
      profile: cfg.profile,
      status: "running",
      stop_requested: false,
      note: undefined,
    })
    while (!abort.signal.aborted) {
      const next = await AutofixQueue.next(cfg.project_id, cfg.directory)
      if (!next) break
      const run = await queued(cfg, next.id, await mode(cfg, pick))
      await AutofixQueue.setState({
        directory: cfg.directory,
        project_id: cfg.project_id,
        profile: cfg.profile,
        status: "running",
        active_run_id: run.id,
      })
      await runOne(cfg, run.id, abort.signal, { pick })
      await AutofixQueue.setState({
        directory: cfg.directory,
        project_id: cfg.project_id,
        profile: cfg.profile,
        status: abort.signal.aborted ? "stopping" : "running",
        active_run_id: null,
      })
    }
    await AutofixQueue.setState({
      directory: cfg.directory,
      project_id: cfg.project_id,
      profile: cfg.profile,
      status: abort.signal.aborted ? "idle" : "idle",
      active_run_id: null,
      stop_requested: false,
    })
  }

  async function one(cfg: ResolvedTarget, feedbackID: string, abort: AbortController, pick?: AutofixSchema.StartInput) {
    const feedback = await AutofixQueue.getFeedbackByScope(cfg.project_id, cfg.directory, feedbackID)
    if (!feedback) throw new Error("Autofix feedback not found")
    if (feedback.muted) throw new Error("Autofix feedback is muted")
    if (active.has(feedback.status)) throw new Error("Autofix feedback is already running")
    const run = await queued(cfg, feedback.id, await mode(cfg, pick))
    await AutofixQueue.setState({
      directory: cfg.directory,
      project_id: cfg.project_id,
      profile: cfg.profile,
      status: "running",
      active_run_id: run.id,
      stop_requested: false,
      note: undefined,
    })
    await runOne(cfg, run.id, abort.signal, { pick })
    await AutofixQueue.setState({
      directory: cfg.directory,
      project_id: cfg.project_id,
      profile: cfg.profile,
      status: "idle",
      active_run_id: null,
      stop_requested: false,
    })
  }

  async function launch(cfg: ResolvedTarget, work: (abort: AbortController) => Promise<void>, force = false) {
    if (jobs.has(key(cfg))) {
      if (force) throw new Error("AutoCodingFix is already running")
      return
    }
    await using _ = await Lock.write(`autofix:${key(cfg)}`)
    if (jobs.has(key(cfg))) {
      if (force) throw new Error("AutoCodingFix is already running")
      return
    }
    const abort = new AbortController()
    const promise = work(abort)
      .catch(async (err) => {
        await AutofixQueue.setState({
          directory: cfg.directory,
          project_id: cfg.project_id,
          profile: cfg.profile,
          status: "blocked",
          note: err instanceof Error ? err.message : String(err),
          active_run_id: null,
          stop_requested: false,
        })
      })
      .finally(() => {
        jobs.delete(key(cfg))
      })
    jobs.set(key(cfg), { abort, promise })
  }

  export async function start(projectDir: string, pick?: AutofixSchema.StartInput) {
    const cfg = await target(projectDir)
    await AutofixQueue.repair(cfg)
    await ready(cfg)
    await launch(cfg, (abort) => loop(cfg, abort, pick))
  }

  export async function startFeedback(projectDir: string, feedbackID: string, pick?: AutofixSchema.StartInput) {
    const cfg = await target(projectDir)
    if (!(await AutofixQueue.getFeedbackByScope(cfg.project_id, cfg.directory, feedbackID)))
      throw new Error("Autofix feedback not found")
    await AutofixQueue.repair(cfg)
    await ready(cfg)
    await launch(cfg, (abort) => one(cfg, feedbackID, abort, pick), true)
  }

  export async function resetFeedback(projectDir: string, feedbackID: string) {
    const cfg = await target(projectDir)
    if (jobs.has(key(cfg))) throw new Error("AutoCodingFix is already running")
    const clean = await collect(cfg, feedbackID)
    await AutofixQueue.reset(cfg, feedbackID)
    await Promise.all(clean.sessions.map((item) => Session.remove(item as Parameters<typeof Session.remove>[0])))
    await Promise.all(clean.files.map((item) => rm(item, { recursive: true, force: true }).catch(() => undefined)))
  }

  export async function deleteFeedback(projectDir: string, feedbackID: string) {
    const cfg = await target(projectDir)
    const clean = await collect(cfg, feedbackID)
    await AutofixQueue.remove(cfg, feedbackID)
    await Promise.all(clean.sessions.map((item) => Session.remove(item as Parameters<typeof Session.remove>[0])))
    await Promise.all(clean.files.map((item) => rm(item, { recursive: true, force: true }).catch(() => undefined)))
  }

  export async function runFeedback(runID: string) {
    const cfg = await target(Instance.directory)
    const detail = await AutofixQueue.detailByScope(cfg.project_id, cfg.directory, runID)
    if (!detail?.feedback) throw new Error("Autofix run not found")
    await ready(cfg)
    await runOne(cfg, runID)
    const run = await AutofixQueue.getRunByScope(cfg.project_id, cfg.directory, runID)
    if (!run) throw new Error("Autofix run disappeared")
    return run
  }

  export async function continueRun(projectDir: string, runID: string, input?: AutofixSchema.ContinueInput) {
    const cfg = await target(projectDir)
    const detail = await AutofixQueue.detailByScope(cfg.project_id, cfg.directory, runID)
    if (!detail?.feedback) throw new Error("Autofix run not found")
    await AutofixQueue.repair(cfg)
    await ready(cfg)
    if (jobs.has(key(cfg))) throw new Error("AutoCodingFix is already running")
    const run = await queued(
      cfg,
      detail.feedback.id,
      input?.mode ?? (detail.run.mode === "harness" ? "harness" : await mode(cfg)),
    )
    const seed = detail.run.session_id
      ? await Session.fork({ sessionID: detail.run.session_id as Parameters<typeof Session.fork>[0]["sessionID"] }).catch(
          () => undefined,
        )
      : undefined
    await AutofixQueue.log({
      directory: cfg.directory,
      project_id: cfg.project_id,
      run_id: run.id,
      feedback_id: detail.feedback.id,
      phase: "queued",
      level: "info",
      message: input?.prompt?.trim() ? `Continue from run ${detail.run.id}: ${input.prompt.trim()}` : `Continue from run ${detail.run.id}`,
    })
    await launch(
      cfg,
      async (abort) => {
        await AutofixQueue.setState({
          directory: cfg.directory,
          project_id: cfg.project_id,
          profile: cfg.profile,
          status: "running",
          active_run_id: run.id,
          stop_requested: false,
          note: undefined,
        })
        await runOne(cfg, run.id, abort.signal, {
          session_id: seed?.id,
          extra: input?.prompt,
          plan: detail.run.plan && detail.run.status !== "blocked" ? detail.run.plan : undefined,
          issue: detail.run.status === "blocked" ? undefined : detail.run.failure_reason,
          pick: input?.mode ? { mode: input.mode } : undefined,
        })
        await AutofixQueue.setState({
          directory: cfg.directory,
          project_id: cfg.project_id,
          profile: cfg.profile,
          status: "idle",
          active_run_id: null,
          stop_requested: false,
        })
      },
      true,
    )
    return run
  }

  export async function stop(projectDir: string) {
    const cfg = await target(projectDir)
    const job = jobs.get(key(cfg))
    if (!job) {
      await AutofixQueue.setState({
        directory: cfg.directory,
        project_id: cfg.project_id,
        profile: cfg.profile,
        status: "idle",
        stop_requested: false,
      })
      return
    }
    await AutofixQueue.setState({
      directory: cfg.directory,
      project_id: cfg.project_id,
      profile: cfg.profile,
      status: "stopping",
      stop_requested: true,
    })
    const summary = await AutofixQueue.summary({
      directory: cfg.directory,
      project_id: cfg.project_id,
      profile: cfg.profile,
      supported: true,
    })
    await Promise.all(
      [
        summary.active_run?.session_id,
        ...(summary.active_run?.harness?.sessions.map((item) => item.session_id) ?? []),
      ]
        .filter(Boolean)
        .map((item) => SessionPrompt.cancel(item as Parameters<typeof SessionPrompt.cancel>[0]).catch(() => undefined)),
    )
    job?.abort.abort()
    await job?.promise
  }
}
