import { afterEach, describe, expect, test } from "bun:test"
import { AutofixPrompt } from "../../src/autofix/prompt"
import { Project } from "../../src/project/project"
import { AutofixQueue } from "../../src/autofix/queue"
import { AutofixStateTable } from "../../src/autofix/autofix.sql"
import { Database, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import type { PulledFeedback, ResolvedTarget } from "../../src/autofix/types"

Log.init({ print: false })

afterEach(async () => {
  await resetDatabase()
})

function cfg(project_id: string, directory: string) {
  return {
    directory,
    worktree: directory,
    project_id,
    profile: "cell",
    remotes: [],
    source: {
      kind: "postgres",
      dsn: "",
      dsn_env: "",
      table: "",
      sync_batch: 100,
    },
    feedback: {
      use_audio_when_text_missing: false,
      max_audio_bytes: 8 * 1024 * 1024,
    },
    verify: {
      kind: "electron_webview_smoke",
      command: "",
      startup_timeout_ms: 1,
      healthy_window_ms: 1,
    },
    package: {
      command: "",
      artifact_glob: [],
    },
    version: {
      kind: "suffix",
      source: "root_package_json",
      format: "{base}-af.{seq}.{feedbackId}",
    },
  } satisfies ResolvedTarget
}

function item(input: { id: number; at: number; text?: string; meta?: unknown; audio?: boolean }) {
  return {
    external_id: input.id,
    created_at: input.at,
    source: "manual_import",
    feedback_token: `manual-${input.id}`,
    device_id: "local-import",
    has_audio: input.audio ?? false,
    recognized_text: input.text,
    recognize_success: !!(input.text?.trim() || input.meta),
    meta: input.meta,
  } satisfies PulledFeedback
}

describe("autofix.queue.importFeedback", () => {
  test("imports local feedback with the same queue status rules as sync", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    const target = cfg(project.id, tmp.path)

    const result = await AutofixQueue.importFeedback(target, [
      item({
        id: 1,
        at: 100,
        text: "设置页切换语言后，文案没有立即刷新。",
      }),
      item({
        id: 2,
        at: 200,
      }),
    ])

    expect(result).toEqual({
      imported: 2,
      updated: 0,
      blocked: 1,
      cursor_created_at: 200,
      cursor_external_id: 2,
    })

    const rows = await AutofixQueue.listFeedback(project.id)
    expect(rows.find((row) => row.external_id === 1)?.status).toBe("queued")
    expect(rows.find((row) => row.external_id === 2)?.status).toBe("blocked")
    expect(rows.find((row) => row.external_id === 2)?.note).toBe("recognized_text is empty and audio fallback is disabled")
  })

  test("updates mirrored feedback without changing sync cursor or active state", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    const target = cfg(project.id, tmp.path)

    await AutofixQueue.importFeedback(target, [
      item({
        id: 7,
        at: 100,
        text: "旧反馈文本",
      }),
    ])

    const prev = (await AutofixQueue.listFeedback(project.id)).find((row) => row.external_id === 7)
    expect(prev).toBeDefined()
    await AutofixQueue.setStatus(prev!.id, "done", "已完成", "run-7")
    await AutofixQueue.setState({
      directory: tmp.path,
      project_id: project.id,
      profile: target.profile,
      status: "running",
      source_cursor_created_at: 999,
      source_cursor_external_id: 77,
      time_last_sync: 555,
      active_run_id: "run-7",
    })

    const result = await AutofixQueue.importFeedback(target, [
      item({
        id: 7,
        at: 200,
        text: "更新后的反馈文本",
      }),
    ])

    expect(result).toEqual({
      imported: 0,
      updated: 1,
      blocked: 0,
      cursor_created_at: 200,
      cursor_external_id: 7,
    })

    const next = (await AutofixQueue.listFeedback(project.id)).find((row) => row.external_id === 7)
    expect(next?.status).toBe("done")
    expect(next?.last_run_id).toBe("run-7")
    expect(next?.recognized_text).toBe("更新后的反馈文本")

    const state = Database.use((db) => db.select().from(AutofixStateTable).where(eq(AutofixStateTable.project_id, project.id)).get())
    expect(state?.status).toBe("running")
    expect(state?.source_cursor_created_at).toBe(999)
    expect(state?.source_cursor_external_id).toBe(77)
    expect(state?.time_last_sync).toBe(555)
    expect(state?.active_run_id).toBe("run-7")
  })

  test("persists shared prompt across unrelated state updates", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    const target = cfg(project.id, tmp.path)

    const prompt = {
      ...AutofixPrompt.resolve(),
      analysis_user: "反馈内容：{{feedback}}\n默认最小改动，不要影响其他正常功能。\n{{extra_block}}",
    }

    await AutofixQueue.setPrompt(target, prompt)

    let summary = await AutofixQueue.summary({
      directory: tmp.path,
      project_id: project.id,
      profile: target.profile,
      supported: true,
    })
    expect(summary.state.prompt?.analysis_user).toBe(prompt.analysis_user)
    expect(summary.state.prompt?.build_system).toBe(prompt.build_system)

    await AutofixQueue.setState({
      directory: tmp.path,
      project_id: project.id,
      profile: target.profile,
      status: "running",
      active_run_id: "run-99",
    })

    summary = await AutofixQueue.summary({
      directory: tmp.path,
      project_id: project.id,
      profile: target.profile,
      supported: true,
    })
    expect(summary.state.prompt?.analysis_user).toBe(prompt.analysis_user)
    expect(summary.state.prompt?.build_system).toBe(prompt.build_system)
  })

  test("returns effective default prompt when no custom prompt is saved", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    const target = cfg(project.id, tmp.path)

    const summary = await AutofixQueue.summary({
      directory: tmp.path,
      project_id: project.id,
      profile: target.profile,
      supported: true,
    })

    expect(summary.state.prompt).toEqual(AutofixPrompt.resolve())
  })

  test("mutes queued feedback without losing the original status", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    const target = cfg(project.id, tmp.path)

    await AutofixQueue.importFeedback(target, [
      item({
        id: 11,
        at: 100,
        text: "先屏蔽这条反馈",
      }),
      item({
        id: 12,
        at: 200,
        text: "继续执行这条反馈",
      }),
    ])

    const row = (await AutofixQueue.listFeedback(project.id)).find((item) => item.external_id === 11)
    expect(row).toBeDefined()

    await AutofixQueue.setMuted(target, row!.id, true)

    const next = (await AutofixQueue.listFeedback(project.id)).find((item) => item.external_id === 11)
    expect(next?.status).toBe("queued")
    expect(next?.muted).toBe(true)

    const queued = await AutofixQueue.next(project.id)
    expect(queued?.external_id).toBe(12)

    const summary = await AutofixQueue.summary({
      directory: tmp.path,
      project_id: project.id,
      profile: target.profile,
      supported: true,
    })
    expect(summary.state.counts.muted).toBe(1)
    expect(summary.state.counts.queued).toBe(1)
  })

  test("deletes feedback and cascades local run history", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    const target = cfg(project.id, tmp.path)

    await AutofixQueue.importFeedback(target, [
      item({
        id: 21,
        at: 100,
        text: "删除这条反馈",
      }),
    ])

    const row = (await AutofixQueue.listFeedback(project.id)).find((item) => item.external_id === 21)
    expect(row).toBeDefined()

    const run = await AutofixQueue.createRun({
      project_id: project.id,
      feedback_id: row!.id,
      status: "failed",
    })
    await AutofixQueue.setStatus(row!.id, "failed", "失败记录", run.id)

    await AutofixQueue.remove(target, row!.id)

    expect(await AutofixQueue.listFeedback(project.id)).toHaveLength(0)
    expect(await AutofixQueue.listRuns(project.id)).toHaveLength(0)
  })
})
