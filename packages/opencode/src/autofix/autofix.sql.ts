import { integer, text, sqliteTable, index, real, primaryKey } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import { Timestamps } from "../storage/schema.sql"
import type { AutofixSchema } from "./schema"

export const AutofixStateTable = sqliteTable(
  "autofix_state",
  {
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    directory: text().notNull(),
    profile: text(),
    status: text().notNull().$type<AutofixSchema.StateStatus>(),
    note: text(),
    source_cursor_created_at: integer(),
    source_cursor_external_id: integer(),
    time_last_sync: integer(),
    active_run_id: text(),
    last_success_commit: text(),
    last_success_version: text(),
    prompt: text(),
    stop_requested: integer({ mode: "boolean" })
      .notNull()
      .$default(() => false),
    ...Timestamps,
  },
  (table) => [primaryKey({ columns: [table.project_id, table.directory] }), index("autofix_state_status_idx").on(table.status)],
)

export const AutofixFeedbackTable = sqliteTable(
  "autofix_feedback",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    directory: text().notNull(),
    external_id: integer().notNull(),
    created_at: integer().notNull(),
    request_id: text(),
    source: text().notNull(),
    feedback_token: text().notNull(),
    device_id: text().notNull(),
    uploader: text({ mode: "json" }),
    app_version: text(),
    audio_filename: text(),
    audio_mime_type: text(),
    audio_size_bytes: integer(),
    audio_duration_ms: integer(),
    has_audio: integer({ mode: "boolean" })
      .notNull()
      .$default(() => false),
    language: text(),
    recognized_text: text(),
    processing_time_ms: real(),
    recognize_success: integer({ mode: "boolean" })
      .notNull()
      .$default(() => false),
    recognize_http_status: integer(),
    recognize_error: text(),
    recognize_response: text({ mode: "json" }),
    meta: text({ mode: "json" }),
    muted: integer({ mode: "boolean" })
      .notNull()
      .$default(() => false),
    status: text().notNull().$type<AutofixSchema.FeedbackStatus>(),
    note: text(),
    last_run_id: text(),
    ...Timestamps,
  },
  (table) => [
    index("autofix_feedback_project_external_idx").on(table.project_id, table.directory, table.external_id),
    index("autofix_feedback_project_status_created_idx").on(table.project_id, table.directory, table.status, table.created_at, table.id),
  ],
)

export const AutofixRunTable = sqliteTable(
  "autofix_run",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    directory: text().notNull(),
    feedback_id: text()
      .notNull()
      .references(() => AutofixFeedbackTable.id, { onDelete: "cascade" }),
    session_id: text(),
    branch: text(),
    base_commit: text(),
    last_success_commit: text(),
    commit_hash: text(),
    version: text(),
    status: text().notNull().$type<AutofixSchema.RunStatus>(),
    failure_reason: text(),
    plan: text({ mode: "json" }),
    summary: text(),
    report_json_path: text(),
    report_md_path: text(),
    smoke_log_path: text(),
    package_log_path: text(),
    time_finished: integer(),
    ...Timestamps,
  },
  (table) => [
    index("autofix_run_project_created_idx").on(table.project_id, table.directory, table.time_created),
    index("autofix_run_feedback_idx").on(table.feedback_id, table.time_created),
  ],
)

export const AutofixAttemptTable = sqliteTable(
  "autofix_attempt",
  {
    id: text().primaryKey(),
    run_id: text()
      .notNull()
      .references(() => AutofixRunTable.id, { onDelete: "cascade" }),
    attempt: integer().notNull(),
    status: text().notNull().$type<AutofixSchema.AttemptStatus>(),
    summary: text(),
    error: text(),
    verify_ok: integer({ mode: "boolean" }),
    verify_log_path: text(),
    package_log_path: text(),
    files: text({ mode: "json" }).$type<string[]>(),
    ...Timestamps,
  },
  (table) => [index("autofix_attempt_run_attempt_idx").on(table.run_id, table.attempt)],
)

export const AutofixArtifactTable = sqliteTable(
  "autofix_artifact",
  {
    id: text().primaryKey(),
    run_id: text()
      .notNull()
      .references(() => AutofixRunTable.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    path: text().notNull(),
    sha256: text(),
    size_bytes: integer(),
    mime: text(),
    meta: text({ mode: "json" }),
    ...Timestamps,
  },
  (table) => [index("autofix_artifact_run_kind_idx").on(table.run_id, table.kind)],
)

export const AutofixEventTable = sqliteTable(
  "autofix_event",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    directory: text().notNull(),
    run_id: text().references(() => AutofixRunTable.id, { onDelete: "cascade" }),
    feedback_id: text().references(() => AutofixFeedbackTable.id, { onDelete: "cascade" }),
    phase: text().notNull(),
    level: text().notNull().$type<AutofixSchema.EventLevel>(),
    message: text().notNull(),
    payload_json: text({ mode: "json" }),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    index("autofix_event_project_time_idx").on(table.project_id, table.directory, table.time_created),
    index("autofix_event_run_time_idx").on(table.run_id, table.time_created),
  ],
)
