import { afterEach, describe, expect, test } from "bun:test"
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
})
