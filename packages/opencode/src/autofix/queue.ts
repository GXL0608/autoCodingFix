import { and, asc, desc, eq, inArray } from "@/storage/db"
import { Database } from "@/storage/db"
import { AutofixArtifactTable, AutofixAttemptTable, AutofixEventTable, AutofixFeedbackTable, AutofixRunTable, AutofixStateTable } from "@/storage/schema"
import { ulid } from "ulid"
import { AutofixPrompt } from "./prompt"
import { AutofixSchema } from "./schema"
import { AutofixEvent } from "./events"
import { CellFeedbackSource } from "./source/postgres"
import type { PulledFeedback, ResolvedTarget } from "./types"

export namespace AutofixQueue {
  type StateRow = typeof AutofixStateTable.$inferSelect
  type FeedbackRow = typeof AutofixFeedbackTable.$inferSelect
  type RunRow = typeof AutofixRunTable.$inferSelect
  type AttemptRow = typeof AutofixAttemptTable.$inferSelect
  type ArtifactRow = typeof AutofixArtifactTable.$inferSelect
  type EventRow = typeof AutofixEventTable.$inferSelect

  function counts() {
    return {
      queued: 0,
      running: 0,
      muted: 0,
      blocked: 0,
      failed: 0,
      done: 0,
    } satisfies AutofixSchema.Counts
  }

  function active(status: string) {
    return ["analyzing", "implementing", "verifying", "committing", "packaging"].includes(status)
  }

  function state(row: StateRow | undefined, input: { directory: string; project_id: string; supported: boolean; profile?: string }) {
    return {
      directory: input.directory,
      project_id: input.project_id,
      supported: input.supported,
      profile: row?.profile ?? input.profile,
      status: row?.status ?? (input.supported ? "idle" : "disabled"),
      note: row?.note ?? undefined,
      branch: undefined as string | undefined,
      stop_requested: row?.stop_requested ?? false,
      active_run_id: row?.active_run_id ?? undefined,
      last_sync_at: row?.time_last_sync ?? undefined,
      last_success_commit: row?.last_success_commit ?? undefined,
      last_success_version: row?.last_success_version ?? undefined,
      prompt: AutofixPrompt.resolve(row?.prompt ?? undefined),
      counts: counts(),
    } satisfies AutofixSchema.State
  }

  function feedback(row: FeedbackRow) {
    return {
      id: row.id,
      project_id: row.project_id,
      directory: row.directory,
      external_id: row.external_id,
      created_at: row.created_at,
      request_id: row.request_id ?? undefined,
      source: row.source,
      feedback_token: row.feedback_token,
      device_id: row.device_id,
      app_version: row.app_version ?? undefined,
      audio_filename: row.audio_filename ?? undefined,
      audio_mime_type: row.audio_mime_type ?? undefined,
      audio_size_bytes: row.audio_size_bytes ?? undefined,
      audio_duration_ms: row.audio_duration_ms ?? undefined,
      has_audio: row.has_audio,
      language: row.language ?? undefined,
      recognized_text: row.recognized_text ?? undefined,
      processing_time_ms: row.processing_time_ms ?? undefined,
      recognize_success: row.recognize_success,
      recognize_http_status: row.recognize_http_status ?? undefined,
      recognize_error: row.recognize_error ?? undefined,
      recognize_response: row.recognize_response ?? undefined,
      uploader: row.uploader ?? undefined,
      meta: row.meta ?? undefined,
      muted: row.muted,
      status: row.status,
      note: row.note ?? undefined,
      last_run_id: row.last_run_id ?? undefined,
      time_created: row.time_created,
      time_updated: row.time_updated,
    } satisfies AutofixSchema.Feedback
  }

  function run(row: RunRow) {
    const plan = AutofixSchema.plan.safeParse(
      row.plan && typeof row.plan === "object" ? { architecture: [], methods: [], flows: [], ...row.plan } : row.plan,
    )
    return {
      id: row.id,
      project_id: row.project_id,
      directory: row.directory,
      feedback_id: row.feedback_id,
      session_id: row.session_id ?? undefined,
      branch: row.branch ?? undefined,
      base_commit: row.base_commit ?? undefined,
      last_success_commit: row.last_success_commit ?? undefined,
      commit_hash: row.commit_hash ?? undefined,
      version: row.version ?? undefined,
      status: row.status,
      failure_reason: row.failure_reason ?? undefined,
      plan: plan.success ? plan.data : undefined,
      summary: row.summary ?? undefined,
      report_json_path: row.report_json_path ?? undefined,
      report_md_path: row.report_md_path ?? undefined,
      smoke_log_path: row.smoke_log_path ?? undefined,
      package_log_path: row.package_log_path ?? undefined,
      time_created: row.time_created,
      time_updated: row.time_updated,
      time_finished: row.time_finished ?? undefined,
    } satisfies AutofixSchema.Run
  }

  function attempt(row: AttemptRow) {
    return {
      id: row.id,
      run_id: row.run_id,
      attempt: row.attempt,
      status: row.status,
      summary: row.summary ?? undefined,
      error: row.error ?? undefined,
      verify_ok: row.verify_ok ?? undefined,
      verify_log_path: row.verify_log_path ?? undefined,
      package_log_path: row.package_log_path ?? undefined,
      files: row.files ?? undefined,
      time_created: row.time_created,
      time_updated: row.time_updated,
    } satisfies AutofixSchema.Attempt
  }

  function artifact(row: ArtifactRow) {
    return {
      id: row.id,
      run_id: row.run_id,
      kind: row.kind,
      path: row.path,
      sha256: row.sha256 ?? undefined,
      size_bytes: row.size_bytes ?? undefined,
      mime: row.mime ?? undefined,
      meta: row.meta ?? undefined,
      time_created: row.time_created,
      time_updated: row.time_updated,
    } satisfies AutofixSchema.Artifact
  }

  function event(row: EventRow) {
    return {
      id: row.id,
      project_id: row.project_id,
      directory: row.directory,
      run_id: row.run_id ?? undefined,
      feedback_id: row.feedback_id ?? undefined,
      phase: row.phase,
      level: row.level,
      message: row.message,
      payload_json: row.payload_json ?? undefined,
      time_created: row.time_created,
    } satisfies AutofixSchema.Event
  }

  function feedbackRow(id: string, project_id?: string, directory?: string) {
    return Database.use((db) =>
      db
        .select()
        .from(AutofixFeedbackTable)
        .where(
          project_id && directory
            ? and(
                eq(AutofixFeedbackTable.id, id),
                eq(AutofixFeedbackTable.project_id, project_id),
                eq(AutofixFeedbackTable.directory, directory),
              )
            : eq(AutofixFeedbackTable.id, id),
        )
        .get(),
    )
  }

  function runRow(id: string, project_id?: string, directory?: string) {
    return Database.use((db) =>
      db
        .select()
        .from(AutofixRunTable)
        .where(
          project_id && directory
            ? and(eq(AutofixRunTable.id, id), eq(AutofixRunTable.project_id, project_id), eq(AutofixRunTable.directory, directory))
            : eq(AutofixRunTable.id, id),
        )
        .get(),
    )
  }

  async function stateRow(project_id: string, directory: string) {
    return Database.use((db) =>
      db
        .select()
        .from(AutofixStateTable)
        .where(and(eq(AutofixStateTable.project_id, project_id), eq(AutofixStateTable.directory, directory)))
        .get(),
    )
  }

  async function feedbackRows(project_id: string, directory: string) {
    return Database.use((db) =>
      db
        .select()
        .from(AutofixFeedbackTable)
        .where(and(eq(AutofixFeedbackTable.project_id, project_id), eq(AutofixFeedbackTable.directory, directory)))
        .orderBy(desc(AutofixFeedbackTable.created_at), desc(AutofixFeedbackTable.external_id))
        .all(),
    )
  }

  function note(
    item: {
      recognized_text?: string | null
      meta?: unknown
      has_audio: boolean
      audio_size_bytes?: number | null
    },
    cfg: ResolvedTarget,
  ) {
    if (item.recognized_text?.trim()) return
    if (item.meta && JSON.stringify(item.meta) !== "{}") return
    if (!cfg.feedback.use_audio_when_text_missing) return "recognized_text is empty and audio fallback is disabled"
    if (!item.has_audio) return "recognized_text is empty and no audio is available"
    if ((item.audio_size_bytes ?? 0) > cfg.feedback.max_audio_bytes)
      return `audio blob exceeds max_audio_bytes (${cfg.feedback.max_audio_bytes})`
  }

  function status(item: PulledFeedback, cfg: ResolvedTarget, prev?: FeedbackRow) {
    if (prev && ["done", "failed", "stopped"].includes(prev.status)) return prev.status
    if (prev && active(prev.status)) return prev.status
    return note(item, cfg) ? "blocked" : "queued"
  }

  function seed(input: { project_id: string; directory: string; profile: string }) {
    Database.use((db) =>
      db
        .insert(AutofixStateTable)
        .values({
          project_id: input.project_id,
          directory: input.directory,
          profile: input.profile,
          status: "idle",
        })
        .onConflictDoUpdate({
          target: [AutofixStateTable.project_id, AutofixStateTable.directory],
          set: {
            profile: input.profile,
          },
        })
        .run(),
    )
  }

  async function save(target: ResolvedTarget, list: PulledFeedback[]) {
    let imported = 0
    let updated = 0
    let blocked = 0
    let cursor_created_at: number | undefined
    let cursor_external_id: number | undefined
    const rows = [...list].sort((a, b) =>
      a.created_at === b.created_at ? a.external_id - b.external_id : a.created_at - b.created_at,
    )
    for (const item of rows) {
      const prev = Database.use((db) =>
        db
          .select()
          .from(AutofixFeedbackTable)
          .where(
            and(
              eq(AutofixFeedbackTable.project_id, target.project_id),
              eq(AutofixFeedbackTable.directory, target.directory),
              eq(AutofixFeedbackTable.external_id, item.external_id),
            ),
          )
          .get(),
      )
      const next = status(item, target, prev)
      const why = note(item, target)
      Database.use((db) =>
        db
          .insert(AutofixFeedbackTable)
          .values({
            id: prev?.id ?? ulid(),
            project_id: target.project_id,
            directory: target.directory,
            external_id: item.external_id,
            created_at: item.created_at,
            request_id: item.request_id ?? null,
            source: item.source,
            feedback_token: item.feedback_token,
            device_id: item.device_id,
            uploader: item.uploader ?? null,
            app_version: item.app_version ?? null,
            audio_filename: item.audio_filename ?? null,
            audio_mime_type: item.audio_mime_type ?? null,
            audio_size_bytes: item.audio_size_bytes ?? null,
            audio_duration_ms: item.audio_duration_ms ?? null,
            has_audio: item.has_audio,
            language: item.language ?? null,
            recognized_text: item.recognized_text ?? null,
            processing_time_ms: item.processing_time_ms ?? null,
            recognize_success: item.recognize_success,
            recognize_http_status: item.recognize_http_status ?? null,
            recognize_error: item.recognize_error ?? null,
            recognize_response: item.recognize_response ?? null,
            meta: item.meta ?? null,
            muted: prev?.muted ?? false,
            status: next,
            note: why ?? prev?.note ?? null,
            last_run_id: prev?.last_run_id ?? null,
          })
          .onConflictDoUpdate({
            target: AutofixFeedbackTable.id,
            set: {
              created_at: item.created_at,
              request_id: item.request_id ?? null,
              source: item.source,
              feedback_token: item.feedback_token,
              device_id: item.device_id,
              uploader: item.uploader ?? null,
              app_version: item.app_version ?? null,
              audio_filename: item.audio_filename ?? null,
              audio_mime_type: item.audio_mime_type ?? null,
              audio_size_bytes: item.audio_size_bytes ?? null,
              audio_duration_ms: item.audio_duration_ms ?? null,
              has_audio: item.has_audio,
              language: item.language ?? null,
              recognized_text: item.recognized_text ?? null,
              processing_time_ms: item.processing_time_ms ?? null,
              recognize_success: item.recognize_success,
              recognize_http_status: item.recognize_http_status ?? null,
              recognize_error: item.recognize_error ?? null,
              recognize_response: item.recognize_response ?? null,
              meta: item.meta ?? null,
              muted: prev?.muted ?? false,
              status: next,
              note: why ?? prev?.note ?? null,
            },
          })
          .run(),
      )
      if (prev) updated += 1
      if (!prev) imported += 1
      if (next === "blocked") blocked += 1
      cursor_created_at = item.created_at
      cursor_external_id = item.external_id
    }
    return {
      imported,
      updated,
      blocked,
      cursor_created_at,
      cursor_external_id,
    } satisfies AutofixSchema.Sync
  }

  async function snapshot(directory: string, project_id: string, profile?: string, supported = true) {
    const base = await stateRow(project_id, directory)
    const next = state(base, {
      directory,
      project_id,
      supported,
      profile,
    })
    const rows = await feedbackRows(project_id, directory)
    for (const item of rows) {
      if (item.muted) {
        next.counts.muted += 1
        continue
      }
      if (item.status === "queued") next.counts.queued += 1
      if (item.status === "blocked") next.counts.blocked += 1
      if (item.status === "failed") next.counts.failed += 1
      if (item.status === "done") next.counts.done += 1
      if (active(item.status)) next.counts.running += 1
    }
    return next
  }

  async function broadcast(directory: string, project_id: string, profile?: string, supported = true) {
    const next = await snapshot(directory, project_id, profile, supported)
    AutofixEvent.emit(directory, {
      type: AutofixEvent.QueueUpdated.type,
      properties: { state: next },
    })
    return next
  }

  export async function summary(input: { directory: string; project_id: string; profile?: string; supported: boolean }) {
    const state = await snapshot(input.directory, input.project_id, input.profile, input.supported)
    const active = state.active_run_id ? await getRunByScope(input.project_id, input.directory, state.active_run_id) : undefined
    return {
      state,
      active_run: active ?? undefined,
    } satisfies AutofixSchema.Summary
  }

  export async function ensureState(input: { directory: string; project_id: string; profile: string }) {
    seed(input)
    return broadcast(input.directory, input.project_id, input.profile)
  }

  export async function setState(
    input: { directory: string; project_id: string; profile?: string } & Partial<
      Pick<
        typeof AutofixStateTable.$inferInsert,
        | "status"
        | "note"
        | "source_cursor_created_at"
        | "source_cursor_external_id"
        | "time_last_sync"
        | "active_run_id"
        | "last_success_commit"
        | "last_success_version"
        | "prompt"
        | "stop_requested"
      >
    >,
  ) {
    Database.use((db) =>
      db
        .insert(AutofixStateTable)
        .values({
          project_id: input.project_id,
          directory: input.directory,
          profile: input.profile,
          status: input.status ?? "idle",
          note: input.note ?? null,
          source_cursor_created_at: input.source_cursor_created_at ?? null,
          source_cursor_external_id: input.source_cursor_external_id ?? null,
          time_last_sync: input.time_last_sync ?? null,
          active_run_id: input.active_run_id ?? null,
          last_success_commit: input.last_success_commit ?? null,
          last_success_version: input.last_success_version ?? null,
          prompt: input.prompt ?? null,
          stop_requested: input.stop_requested ?? false,
        })
        .onConflictDoUpdate({
          target: [AutofixStateTable.project_id, AutofixStateTable.directory],
          set: {
            profile: input.profile,
            status: input.status,
            note: input.note,
            source_cursor_created_at: input.source_cursor_created_at,
            source_cursor_external_id: input.source_cursor_external_id,
            time_last_sync: input.time_last_sync,
            active_run_id: input.active_run_id,
            last_success_commit: input.last_success_commit,
            last_success_version: input.last_success_version,
            prompt: input.prompt,
            stop_requested: input.stop_requested,
          },
        })
        .run(),
    )
    return broadcast(input.directory, input.project_id, input.profile)
  }

  export async function getPrompt(project_id: string, directory: string) {
    return AutofixPrompt.resolve((await stateRow(project_id, directory))?.prompt ?? undefined)
  }

  export async function setPrompt(input: { directory: string; project_id: string; profile: string }, prompt: AutofixSchema.Prompt) {
    const next = AutofixPrompt.same(prompt, AutofixPrompt.resolve()) ? null : AutofixPrompt.serialize(prompt)
    return setState({
      directory: input.directory,
      project_id: input.project_id,
      profile: input.profile,
      prompt: next,
    })
  }

  export async function syncProject(target: ResolvedTarget, opts?: { full?: boolean }) {
    await ensureState({
      directory: target.directory,
      project_id: target.project_id,
      profile: target.profile,
    })
    const current = await stateRow(target.project_id, target.directory)
    let cursor_created_at = opts?.full ? undefined : current?.source_cursor_created_at
    let cursor_external_id = opts?.full ? undefined : current?.source_cursor_external_id
    let imported = 0
    let updated = 0
    let blocked = 0
    while (true) {
      const rows = await CellFeedbackSource.pull(
        target.source,
        {
          created_at: cursor_created_at ?? undefined,
          external_id: cursor_external_id ?? undefined,
        },
        target.source.sync_batch,
      )
      if (!rows.length) break
      const next = await save(target, rows)
      imported += next.imported
      updated += next.updated
      blocked += next.blocked
      cursor_created_at = next.cursor_created_at ?? cursor_created_at
      cursor_external_id = next.cursor_external_id ?? cursor_external_id
      if (rows.length < target.source.sync_batch) break
    }
    await setState({
      directory: target.directory,
      project_id: target.project_id,
      profile: target.profile,
      status: "idle",
      source_cursor_created_at: cursor_created_at ?? undefined,
      source_cursor_external_id: cursor_external_id ?? undefined,
      time_last_sync: Date.now(),
    })
    return {
      imported,
      updated,
      blocked,
      cursor_created_at: cursor_created_at ?? undefined,
      cursor_external_id: cursor_external_id ?? undefined,
    } satisfies AutofixSchema.Sync
  }

  export async function importFeedback(target: ResolvedTarget, list: PulledFeedback[]) {
    seed({
      project_id: target.project_id,
      directory: target.directory,
      profile: target.profile,
    })
    const result = await save(target, list)
    await broadcast(target.directory, target.project_id, target.profile)
    return result
  }

  export async function listFeedback(project_id: string, directory: string) {
    return feedbackRows(project_id, directory).then((rows) => rows.map(feedback))
  }

  export async function next(project_id: string, directory: string) {
    const row = Database.use((db) =>
      db
        .select()
        .from(AutofixFeedbackTable)
        .where(
          and(
            eq(AutofixFeedbackTable.project_id, project_id),
            eq(AutofixFeedbackTable.directory, directory),
            eq(AutofixFeedbackTable.status, "queued"),
            eq(AutofixFeedbackTable.muted, false),
          ),
        )
        .orderBy(asc(AutofixFeedbackTable.created_at), asc(AutofixFeedbackTable.external_id))
        .get(),
    )
    return row ? feedback(row) : null
  }

  export async function getFeedback(id: string) {
    const row = feedbackRow(id)
    return row ? feedback(row) : undefined
  }

  export async function getFeedbackByScope(project_id: string, directory: string, id: string) {
    const row = feedbackRow(id, project_id, directory)
    return row ? feedback(row) : undefined
  }

  export async function setStatus(id: string, status: AutofixSchema.FeedbackStatus, note?: string, last_run_id?: string) {
    Database.use((db) =>
      db
        .update(AutofixFeedbackTable)
        .set({
          status,
          note: note ?? null,
          last_run_id: last_run_id ?? null,
        })
        .where(eq(AutofixFeedbackTable.id, id))
        .run(),
    )
  }

  export async function setMuted(input: { directory: string; project_id: string; profile: string }, id: string, muted: boolean) {
    const row = feedbackRow(id, input.project_id, input.directory)
    if (!row) throw new Error("Autofix feedback not found")
    if (active(row.status)) throw new Error("Autofix feedback is already running")
    Database.use((db) =>
      db
        .update(AutofixFeedbackTable)
        .set({
          muted,
        })
        .where(
          and(
            eq(AutofixFeedbackTable.id, id),
            eq(AutofixFeedbackTable.project_id, input.project_id),
            eq(AutofixFeedbackTable.directory, input.directory),
          ),
        )
        .run(),
    )
    return broadcast(input.directory, input.project_id, input.profile)
  }

  export async function repair(target: ResolvedTarget) {
    const rows = await feedbackRows(target.project_id, target.directory)
    const list = rows.filter((item) => active(item.status))
    if (!list.length) return
    const ids = list.map((item) => item.id)
    const msg = "Autofix run was interrupted unexpectedly. State was repaired."
    const now = Date.now()
    Database.use((db) =>
      db
        .update(AutofixRunTable)
        .set({
          status: "failed",
          failure_reason: msg,
          time_finished: now,
        })
        .where(
          and(
            eq(AutofixRunTable.project_id, target.project_id),
            eq(AutofixRunTable.directory, target.directory),
            inArray(AutofixRunTable.feedback_id, ids),
            inArray(AutofixRunTable.status, ["queued", "analyzing", "implementing", "verifying", "committing", "packaging"]),
          ),
        )
        .run(),
    )
    await Promise.all(
      list.map((item) =>
        setStatus(
          item.id,
          note(item, target) ? "blocked" : "failed",
          note(item, target) ?? msg,
          item.last_run_id ?? undefined,
        ),
      ),
    )
    await setState({
      directory: target.directory,
      project_id: target.project_id,
      profile: target.profile,
      status: "idle",
      note: undefined,
      active_run_id: null,
      stop_requested: false,
    })
  }

  export async function reset(target: ResolvedTarget, id: string) {
    const row = feedbackRow(id, target.project_id, target.directory)
    if (!row) throw new Error("Autofix feedback not found")
    const why = note(row, target)
    const runs = Database.use((db) =>
      db
        .select({ id: AutofixRunTable.id })
        .from(AutofixRunTable)
        .where(
          and(
            eq(AutofixRunTable.project_id, target.project_id),
            eq(AutofixRunTable.directory, target.directory),
            eq(AutofixRunTable.feedback_id, id),
          ),
        )
        .all(),
    )
    Database.use((db) =>
      db
        .delete(AutofixRunTable)
        .where(
          and(
            eq(AutofixRunTable.project_id, target.project_id),
            eq(AutofixRunTable.directory, target.directory),
            eq(AutofixRunTable.feedback_id, id),
          ),
        )
        .run(),
    )
    await setStatus(id, why ? "blocked" : "queued", why, undefined)
    const state = await stateRow(target.project_id, target.directory)
    if (!state?.active_run_id) return
    if (!runs.some((item) => item.id === state.active_run_id)) return
    await setState({
      directory: target.directory,
      project_id: target.project_id,
      profile: target.profile,
      status: "idle",
      note: undefined,
      active_run_id: null,
      stop_requested: false,
    })
  }

  export async function remove(target: ResolvedTarget, id: string) {
    const row = feedbackRow(id, target.project_id, target.directory)
    if (!row) throw new Error("Autofix feedback not found")
    if (active(row.status)) throw new Error("Autofix feedback is already running")
    const runs = Database.use((db) =>
      db
        .select({ id: AutofixRunTable.id })
        .from(AutofixRunTable)
        .where(
          and(
            eq(AutofixRunTable.project_id, target.project_id),
            eq(AutofixRunTable.directory, target.directory),
            eq(AutofixRunTable.feedback_id, id),
          ),
        )
        .all(),
    )
    Database.use((db) =>
      db
        .delete(AutofixFeedbackTable)
        .where(
          and(
            eq(AutofixFeedbackTable.id, id),
            eq(AutofixFeedbackTable.project_id, target.project_id),
            eq(AutofixFeedbackTable.directory, target.directory),
          ),
        )
        .run(),
    )
    const state = await stateRow(target.project_id, target.directory)
    if (state?.active_run_id && runs.some((item) => item.id === state.active_run_id)) {
      await setState({
        directory: target.directory,
        project_id: target.project_id,
        profile: target.profile,
        status: "idle",
        note: undefined,
        active_run_id: null,
        stop_requested: false,
      })
      return
    }
    await broadcast(target.directory, target.project_id, target.profile)
  }

  export async function createRun(input: {
    project_id: string
    directory: string
    feedback_id: string
    status: AutofixSchema.RunStatus
    branch?: string
    base_commit?: string
    last_success_commit?: string
  }) {
    const id = ulid()
    Database.use((db) =>
      db
        .insert(AutofixRunTable)
        .values({
          id,
          project_id: input.project_id,
          directory: input.directory,
          feedback_id: input.feedback_id,
          branch: input.branch ?? null,
          base_commit: input.base_commit ?? null,
          last_success_commit: input.last_success_commit ?? null,
          status: input.status,
        })
        .run(),
    )
    const item = await getRunByScope(input.project_id, input.directory, id)
    if (!item) throw new Error("Failed to create autofix run")
    return item
  }

  export async function getRun(id: string) {
    const row = runRow(id)
    return row ? run(row) : undefined
  }

  export async function getRunByScope(project_id: string, directory: string, id: string) {
    const row = runRow(id, project_id, directory)
    return row ? run(row) : undefined
  }

  export async function listRuns(project_id: string, directory: string) {
    const rows = Database.use((db) =>
      db
        .select()
        .from(AutofixRunTable)
        .where(and(eq(AutofixRunTable.project_id, project_id), eq(AutofixRunTable.directory, directory)))
        .orderBy(desc(AutofixRunTable.time_created))
        .all(),
    )
    return rows.map(run)
  }

  export async function updateRun(id: string, values: Partial<typeof AutofixRunTable.$inferInsert>) {
    Database.use((db) =>
      db
        .update(AutofixRunTable)
        .set(values)
        .where(eq(AutofixRunTable.id, id))
        .run(),
    )
    return getRun(id)
  }

  export async function createAttempt(run_id: string, no: number) {
    const id = ulid()
    Database.use((db) =>
      db
        .insert(AutofixAttemptTable)
        .values({
          id,
          run_id,
          attempt: no,
          status: "pending",
        })
        .run(),
    )
    return id
  }

  export async function updateAttempt(id: string, values: Partial<typeof AutofixAttemptTable.$inferInsert>) {
    Database.use((db) =>
      db
        .update(AutofixAttemptTable)
        .set(values)
        .where(eq(AutofixAttemptTable.id, id))
        .run(),
    )
  }

  export async function listAttempts(run_id: string) {
    const rows = Database.use((db) =>
      db
        .select()
        .from(AutofixAttemptTable)
        .where(eq(AutofixAttemptTable.run_id, run_id))
        .orderBy(asc(AutofixAttemptTable.attempt))
        .all(),
    )
    return rows.map(attempt)
  }

  export async function addArtifact(
    input: Omit<typeof AutofixArtifactTable.$inferInsert, "id"> & {
      directory: string
    },
  ) {
    const id = ulid()
    Database.use((db) =>
      db
        .insert(AutofixArtifactTable)
        .values({
          id,
          run_id: input.run_id,
          kind: input.kind,
          path: input.path,
          sha256: input.sha256 ?? null,
          size_bytes: input.size_bytes ?? null,
          mime: input.mime ?? null,
          meta: input.meta ?? null,
        })
        .run(),
    )
    const item = Database.use((db) => db.select().from(AutofixArtifactTable).where(eq(AutofixArtifactTable.id, id)).get())
    if (!item) throw new Error("Failed to create autofix artifact")
    const next = artifact(item)
    AutofixEvent.emit(input.directory, {
      type: AutofixEvent.ArtifactReady.type,
      properties: {
        run_id: next.run_id,
        artifact: next,
      },
    })
    return next
  }

  export async function listArtifacts(run_id: string) {
    const rows = Database.use((db) =>
      db
        .select()
        .from(AutofixArtifactTable)
        .where(eq(AutofixArtifactTable.run_id, run_id))
        .orderBy(desc(AutofixArtifactTable.time_created))
        .all(),
    )
    return rows.map(artifact)
  }

  export async function addEvent(input: {
    project_id: string
    directory: string
    run_id?: string
    feedback_id?: string
    phase: string
    level: AutofixSchema.EventLevel
    message: string
    payload_json?: unknown
  }) {
    Database.use((db) =>
      db
        .insert(AutofixEventTable)
        .values({
          id: ulid(),
          project_id: input.project_id,
          directory: input.directory,
          run_id: input.run_id ?? null,
          feedback_id: input.feedback_id ?? null,
          phase: input.phase,
          level: input.level,
          message: input.message,
          payload_json: input.payload_json ?? null,
        })
        .run(),
    )
  }

  export async function listEvents(input: { project_id: string; directory: string; run_id?: string }) {
    const rows = Database.use((db) =>
      db
        .select()
        .from(AutofixEventTable)
        .where(
          input.run_id
            ? and(
                eq(AutofixEventTable.project_id, input.project_id),
                eq(AutofixEventTable.directory, input.directory),
                eq(AutofixEventTable.run_id, input.run_id),
              )
            : and(eq(AutofixEventTable.project_id, input.project_id), eq(AutofixEventTable.directory, input.directory)),
        )
        .orderBy(desc(AutofixEventTable.time_created))
        .all(),
    )
    return rows.map(event)
  }

  export async function log(input: {
    directory: string
    project_id: string
    run_id?: string
    feedback_id?: string
    phase: string
    level: AutofixSchema.EventLevel
    message: string
    payload_json?: unknown
  }) {
    await addEvent(input)
    AutofixEvent.emit(input.directory, {
      type: AutofixEvent.RunLog.type,
      properties: {
        run_id: input.run_id,
        phase: input.phase,
        level: input.level,
        message: input.message,
      },
    })
  }

  export async function emitRun(directory: string, id: string) {
    const row = runRow(id)
    if (!row) return
    const item = run(row)
    if (!item) return
    AutofixEvent.emit(directory, {
      type: AutofixEvent.RunUpdated.type,
      properties: {
        run: item,
      },
    })
  }

  export async function detail(id: string) {
    const run = await getRun(id)
    if (!run) return
    return {
      run,
      feedback: await getFeedback(run.feedback_id),
      attempts: await listAttempts(run.id),
      artifacts: await listArtifacts(run.id),
      events: await listEvents({ project_id: run.project_id, directory: run.directory, run_id: run.id }),
    } satisfies AutofixSchema.Detail
  }

  export async function detailByScope(project_id: string, directory: string, id: string) {
    const run = await getRunByScope(project_id, directory, id)
    if (!run) return
    return {
      run,
      feedback: await getFeedbackByScope(project_id, directory, run.feedback_id),
      attempts: await listAttempts(run.id),
      artifacts: await listArtifacts(run.id),
      events: await listEvents({ project_id: run.project_id, directory: run.directory, run_id: run.id }),
    } satisfies AutofixSchema.Detail
  }
}
