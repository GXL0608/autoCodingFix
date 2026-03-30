import { afterEach, describe, expect, test } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { readFileSync, readdirSync } from "fs"
import path from "path"

function list() {
  return readdirSync(path.join(import.meta.dirname, "../../migration"), { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => ({
      name: item.name,
      timestamp: Number(item.name.split("_")[0]),
      sql: readFileSync(path.join(import.meta.dirname, "../../migration", item.name, "migration.sql"), "utf-8"),
    }))
    .sort((a, b) => a.timestamp - b.timestamp)
}

function apply(sqlite: Sqlite, items: ReturnType<typeof list>) {
  migrate(drizzle({ client: sqlite }), items)
}

let sqlite: Sqlite | undefined

afterEach(() => {
  sqlite?.close()
  sqlite = undefined
})

describe("autofix.directory scope migration", () => {
  test("moves legacy autofix rows to the dominant session directory", () => {
    sqlite = new Sqlite(":memory:")
    sqlite.exec("PRAGMA foreign_keys = ON")

    const items = list()
    const next = items.find((item) => item.name.includes("autofix_directory_scope"))
    if (!next) throw new Error("expected autofix directory scope migration")

    apply(
      sqlite,
      items.filter((item) => item.timestamp < next.timestamp),
    )

    sqlite.exec(`
      INSERT INTO project (
        id, worktree, vcs, name, icon_url, icon_color,
        time_created, time_updated, time_initialized, sandboxes, commands
      ) VALUES (
        'proj', '/Users/gxl/projects/OmniVoiceGxl2Auto', 'git', NULL, NULL, NULL,
        1, 1, NULL, '[]', NULL
      );

      INSERT INTO session (
        id, project_id, workspace_id, parent_id, slug, directory, title, version,
        share_url, summary_additions, summary_deletions, summary_files, summary_diffs,
        revert, permission, time_created, time_updated, time_compacting, time_archived
      ) VALUES (
        'ses1', 'proj', NULL, NULL, 'ses1', '/Users/gxl/projects/OmniVoiceGxl3', 'Autofix #1', '0.0.0',
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1, NULL, NULL
      );

      INSERT INTO autofix_state (
        project_id, profile, status, note, source_cursor_created_at, source_cursor_external_id,
        time_last_sync, active_run_id, last_success_commit, last_success_version, stop_requested,
        time_created, time_updated, prompt
      ) VALUES (
        'proj', 'cell', 'running', NULL, NULL, NULL, 1, 'run1', NULL, NULL, 0, 1, 1, NULL
      );

      INSERT INTO autofix_feedback (
        id, project_id, external_id, created_at, request_id, source, feedback_token, device_id,
        uploader, app_version, audio_filename, audio_mime_type, audio_size_bytes, audio_duration_ms,
        has_audio, language, recognized_text, processing_time_ms, recognize_success, recognize_http_status,
        recognize_error, recognize_response, meta, muted, status, note, last_run_id, time_created, time_updated
      ) VALUES (
        'fb1', 'proj', 30001, 1, NULL, 'manual_import', 'tok-1', 'dev',
        NULL, NULL, NULL, NULL, NULL, NULL,
        0, NULL, '旧反馈', NULL, 1, NULL,
        NULL, NULL, NULL, 0, 'done', NULL, 'run1', 1, 1
      );

      INSERT INTO autofix_feedback (
        id, project_id, external_id, created_at, request_id, source, feedback_token, device_id,
        uploader, app_version, audio_filename, audio_mime_type, audio_size_bytes, audio_duration_ms,
        has_audio, language, recognized_text, processing_time_ms, recognize_success, recognize_http_status,
        recognize_error, recognize_response, meta, muted, status, note, last_run_id, time_created, time_updated
      ) VALUES (
        'fb2', 'proj', 30002, 2, NULL, 'manual_import', 'tok-2', 'dev',
        NULL, NULL, NULL, NULL, NULL, NULL,
        0, NULL, '待处理反馈', NULL, 1, NULL,
        NULL, NULL, NULL, 0, 'queued', NULL, NULL, 2, 2
      );

      INSERT INTO autofix_run (
        id, project_id, feedback_id, session_id, branch, base_commit, last_success_commit, commit_hash,
        version, status, failure_reason, plan, summary, report_json_path, report_md_path, smoke_log_path,
        package_log_path, time_finished, time_created, time_updated
      ) VALUES (
        'run1', 'proj', 'fb1', 'ses1', NULL, NULL, NULL, NULL,
        NULL, 'done', NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, 1, 1, 1
      );

      INSERT INTO autofix_event (
        id, project_id, run_id, feedback_id, phase, level, message, payload_json, time_created
      ) VALUES (
        'evt1', 'proj', 'run1', 'fb1', 'queued', 'info', 'started', NULL, 1
      );
    `)

    apply(sqlite, [next])

    const state = sqlite.query("select directory from autofix_state where project_id = 'proj'").get() as { directory: string }
    const feedback = sqlite.query("select directory from autofix_feedback where project_id = 'proj' order by external_id").all() as Array<{
      directory: string
    }>
    const run = sqlite.query("select directory from autofix_run where id = 'run1'").get() as { directory: string }
    const event = sqlite.query("select directory from autofix_event where id = 'evt1'").get() as { directory: string }

    expect(state.directory).toBe("/Users/gxl/projects/OmniVoiceGxl3")
    expect(feedback.map((item) => item.directory)).toEqual([
      "/Users/gxl/projects/OmniVoiceGxl3",
      "/Users/gxl/projects/OmniVoiceGxl3",
    ])
    expect(run.directory).toBe("/Users/gxl/projects/OmniVoiceGxl3")
    expect(event.directory).toBe("/Users/gxl/projects/OmniVoiceGxl3")
  })
})
