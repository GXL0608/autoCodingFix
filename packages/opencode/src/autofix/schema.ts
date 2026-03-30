import z from "zod"
import { ModelID, ProviderID } from "@/provider/schema"

export namespace AutofixSchema {
  function time(input: number | string, ctx: z.RefinementCtx) {
    if (typeof input === "number" && Number.isFinite(input)) return input
    const text = String(input).trim()
    const num = Number(text)
    if (text && Number.isFinite(num)) return num
    const at = new Date(text).getTime()
    if (Number.isFinite(at)) return at
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid timestamp",
    })
    return z.NEVER
  }

  export const state_status = z.enum(["disabled", "idle", "syncing", "running", "stopping", "blocked"])
  export type StateStatus = z.infer<typeof state_status>

  export const feedback_status = z.enum([
    "queued",
    "analyzing",
    "implementing",
    "verifying",
    "committing",
    "packaging",
    "done",
    "blocked",
    "failed",
    "stopped",
  ])
  export type FeedbackStatus = z.infer<typeof feedback_status>

  export const run_status = z.enum([
    "queued",
    "analyzing",
    "implementing",
    "verifying",
    "committing",
    "packaging",
    "done",
    "blocked",
    "failed",
    "stopped",
  ])
  export type RunStatus = z.infer<typeof run_status>

  export const attempt_status = z.enum(["pending", "running", "verified", "failed", "stopped"])
  export type AttemptStatus = z.infer<typeof attempt_status>

  export const event_level = z.enum(["info", "warn", "error"])
  export type EventLevel = z.infer<typeof event_level>

  export const plan_arch = z
    .object({
      name: z.string(),
      files: z.array(z.string()),
      logic: z.string(),
    })
    .meta({
      ref: "AutofixPlanArchitecture",
    })
  export type PlanArch = z.infer<typeof plan_arch>

  export const plan_method = z
    .object({
      name: z.string(),
      file: z.string(),
      comment: z.string(),
      logic: z.string(),
    })
    .meta({
      ref: "AutofixPlanMethod",
    })
  export type PlanMethod = z.infer<typeof plan_method>

  export const plan = z
    .object({
      summary: z.string(),
      scope: z.array(z.string()),
      steps: z.array(z.string()),
      acceptance: z.array(z.string()),
      architecture: z.array(plan_arch),
      methods: z.array(plan_method),
      flows: z.array(z.string()),
      automatable: z.boolean(),
      blockers: z.array(z.string()).optional(),
    })
    .meta({
      ref: "AutofixPlan",
    })
  export type Plan = z.infer<typeof plan>

  export const prompt = z
    .object({
      analysis_system: z.string(),
      analysis_user: z.string(),
      build_system: z.string(),
      build_user: z.string(),
    })
    .meta({
      ref: "AutofixPrompt",
    })
  export type Prompt = z.infer<typeof prompt>

  export const prompt_partial = prompt.partial()
  export type PromptPartial = z.infer<typeof prompt_partial>

  export const model = z
    .object({
      providerID: ProviderID.zod,
      modelID: ModelID.zod,
    })
    .meta({
      ref: "AutofixModel",
    })
  export type Model = z.infer<typeof model>

  export const start_input = z
    .object({
      model: model.optional(),
      variant: z.string().optional(),
    })
    .meta({
      ref: "AutofixStartInput",
    })
  export type StartInput = z.infer<typeof start_input>

  export const counts = z
    .object({
      queued: z.number().int(),
      running: z.number().int(),
      muted: z.number().int(),
      blocked: z.number().int(),
      failed: z.number().int(),
      done: z.number().int(),
    })
    .meta({
      ref: "AutofixCounts",
    })
  export type Counts = z.infer<typeof counts>

  export const state = z
    .object({
      directory: z.string(),
      project_id: z.string(),
      supported: z.boolean(),
      profile: z.string().optional(),
      status: state_status,
      note: z.string().optional(),
      branch: z.string().optional(),
      stop_requested: z.boolean(),
      active_run_id: z.string().optional(),
      last_sync_at: z.number().optional(),
      last_success_commit: z.string().optional(),
      last_success_version: z.string().optional(),
      prompt: prompt.optional(),
      counts,
    })
    .meta({
      ref: "AutofixState",
    })
  export type State = z.infer<typeof state>

  export const feedback = z
    .object({
      id: z.string(),
      project_id: z.string(),
      directory: z.string(),
      external_id: z.number().int(),
      created_at: z.number(),
      request_id: z.string().optional(),
      source: z.string(),
      feedback_token: z.string(),
      device_id: z.string(),
      app_version: z.string().optional(),
      audio_filename: z.string().optional(),
      audio_mime_type: z.string().optional(),
      audio_size_bytes: z.number().int().optional(),
      audio_duration_ms: z.number().int().optional(),
      has_audio: z.boolean(),
      language: z.string().optional(),
      recognized_text: z.string().optional(),
      processing_time_ms: z.number().optional(),
      recognize_success: z.boolean(),
      recognize_http_status: z.number().int().optional(),
      recognize_error: z.string().optional(),
      recognize_response: z.any().optional(),
      uploader: z.any().optional(),
      meta: z.any().optional(),
      muted: z.boolean(),
      status: feedback_status,
      note: z.string().optional(),
      last_run_id: z.string().optional(),
      time_created: z.number(),
      time_updated: z.number(),
    })
    .meta({
      ref: "AutofixFeedback",
    })
  export type Feedback = z.infer<typeof feedback>

  export const run = z
    .object({
      id: z.string(),
      project_id: z.string(),
      directory: z.string(),
      feedback_id: z.string(),
      session_id: z.string().optional(),
      branch: z.string().optional(),
      base_commit: z.string().optional(),
      last_success_commit: z.string().optional(),
      commit_hash: z.string().optional(),
      version: z.string().optional(),
      status: run_status,
      failure_reason: z.string().optional(),
      plan: plan.optional(),
      summary: z.string().optional(),
      report_json_path: z.string().optional(),
      report_md_path: z.string().optional(),
      smoke_log_path: z.string().optional(),
      package_log_path: z.string().optional(),
      time_created: z.number(),
      time_updated: z.number(),
      time_finished: z.number().optional(),
    })
    .meta({
      ref: "AutofixRun",
    })
  export type Run = z.infer<typeof run>

  export const attempt = z
    .object({
      id: z.string(),
      run_id: z.string(),
      attempt: z.number().int(),
      status: attempt_status,
      summary: z.string().optional(),
      error: z.string().optional(),
      verify_ok: z.boolean().optional(),
      verify_log_path: z.string().optional(),
      package_log_path: z.string().optional(),
      files: z.array(z.string()).optional(),
      time_created: z.number(),
      time_updated: z.number(),
    })
    .meta({
      ref: "AutofixAttempt",
    })
  export type Attempt = z.infer<typeof attempt>

  export const artifact = z
    .object({
      id: z.string(),
      run_id: z.string(),
      kind: z.string(),
      path: z.string(),
      sha256: z.string().optional(),
      size_bytes: z.number().int().optional(),
      mime: z.string().optional(),
      meta: z.any().optional(),
      time_created: z.number(),
      time_updated: z.number(),
    })
    .meta({
      ref: "AutofixArtifact",
    })
  export type Artifact = z.infer<typeof artifact>

  export const event = z
    .object({
      id: z.string(),
      project_id: z.string(),
      directory: z.string(),
      run_id: z.string().optional(),
      feedback_id: z.string().optional(),
      phase: z.string(),
      level: event_level,
      message: z.string(),
      payload_json: z.any().optional(),
      time_created: z.number(),
    })
    .meta({
      ref: "AutofixEvent",
    })
  export type Event = z.infer<typeof event>

  export const sync = z
    .object({
      imported: z.number().int(),
      updated: z.number().int(),
      blocked: z.number().int(),
      cursor_created_at: z.number().optional(),
      cursor_external_id: z.number().int().optional(),
    })
    .meta({
      ref: "AutofixSyncResult",
    })
  export type Sync = z.infer<typeof sync>

  export const import_item = z
    .object({
      external_id: z.coerce.number().int(),
      created_at: z
        .union([z.number(), z.string()])
        .optional()
        .transform((input, ctx) => (input === undefined ? Date.now() : time(input, ctx))),
      request_id: z.string().optional(),
      source: z.string().default("manual_import"),
      feedback_token: z.string().optional(),
      device_id: z.string().default("manual-import"),
      uploader: z.any().optional(),
      app_version: z.string().optional(),
      audio_filename: z.string().optional(),
      audio_mime_type: z.string().optional(),
      audio_size_bytes: z.coerce.number().int().optional(),
      audio_duration_ms: z.coerce.number().int().optional(),
      has_audio: z.boolean().default(false),
      language: z.string().optional(),
      recognized_text: z.string().optional(),
      processing_time_ms: z.coerce.number().optional(),
      recognize_success: z.boolean().optional(),
      recognize_http_status: z.coerce.number().int().optional(),
      recognize_error: z.string().optional(),
      recognize_response: z.any().optional(),
      meta: z.any().optional(),
    })
    .transform((item) => ({
      ...item,
      feedback_token: item.feedback_token ?? `manual-${item.external_id}`,
      recognize_success: item.recognize_success ?? !!(item.recognized_text?.trim() || item.meta),
    }))
    .meta({
      ref: "AutofixImportItem",
    })
  export type ImportItem = z.infer<typeof import_item>

  export const import_input = z
    .object({
      items: z.array(import_item).min(1),
    })
    .meta({
      ref: "AutofixImportInput",
    })
  export type ImportInput = z.infer<typeof import_input>

  export const continue_input = z
    .object({
      prompt: z.string().optional(),
    })
    .meta({
      ref: "AutofixContinueInput",
    })
  export type ContinueInput = z.infer<typeof continue_input>

  export const prompt_input = z
    .object({
      analysis_system: z.string(),
      analysis_user: z.string(),
      build_system: z.string(),
      build_user: z.string(),
    })
    .meta({
      ref: "AutofixPromptInput",
    })
  export type PromptInput = z.infer<typeof prompt_input>

  export const summary = z
    .object({
      state,
      active_run: run.optional(),
    })
    .meta({
      ref: "AutofixSummary",
    })
  export type Summary = z.infer<typeof summary>

  export const detail = z
    .object({
      run,
      feedback: feedback.optional(),
      attempts: z.array(attempt),
      artifacts: z.array(artifact),
      events: z.array(event),
    })
    .meta({
      ref: "AutofixDetail",
    })
  export type Detail = z.infer<typeof detail>
}
