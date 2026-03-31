import z from "zod"
import { ModelID, ProviderID } from "@/provider/schema"

export namespace AutofixSchema {
  function bytes(input: string, ctx: z.RefinementCtx) {
    const text = input.trim()
    if (!text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid base64 payload",
      })
      return z.NEVER
    }
    const buf = Buffer.from(text, "base64")
    if (!buf.byteLength) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid base64 payload",
      })
      return z.NEVER
    }
    return buf
  }

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

  export const run_mode = z.enum(["legacy", "harness"])
  export type RunMode = z.infer<typeof run_mode>

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

  export const harness_limit = z
    .object({
      search: z.number().int(),
      read: z.number().int(),
      bash: z.number().int(),
    })
    .meta({
      ref: "AutofixHarnessLimit",
    })
  export type HarnessLimit = z.infer<typeof harness_limit>

  export const harness = z
    .object({
      enabled: z.boolean(),
      fallback_legacy: z.boolean(),
      survey: z.boolean(),
      review: z.boolean(),
      verify: z.boolean(),
      limits: harness_limit,
      overview: z.string(),
      analysis: z.string(),
      build: z.string(),
      review_note: z.string(),
      verify_note: z.string(),
    })
    .meta({
      ref: "AutofixHarness",
    })
  export type Harness = z.infer<typeof harness>

  export const harness_session = z
    .object({
      kind: z.string(),
      session_id: z.string(),
    })
    .meta({
      ref: "AutofixHarnessSession",
    })
  export type HarnessSession = z.infer<typeof harness_session>

  export const harness_survey = z
    .object({
      summary: z.string(),
      scope: z.array(z.string()),
      files: z.array(z.string()),
      risks: z.array(z.string()),
    })
    .meta({
      ref: "AutofixHarnessSurvey",
    })
  export type HarnessSurvey = z.infer<typeof harness_survey>

  export const harness_decision = z
    .object({
      ok: z.boolean(),
      summary: z.string(),
      issues: z.array(z.string()),
      next: z.array(z.string()),
    })
    .meta({
      ref: "AutofixHarnessDecision",
    })
  export type HarnessDecision = z.infer<typeof harness_decision>

  export const harness_run = z
    .object({
      stage: z.string().optional(),
      fallback: z.boolean().optional(),
      fallback_reason: z.string().optional(),
      survey: harness_survey.optional(),
      plan_review: harness_decision.optional(),
      sessions: z.array(harness_session),
    })
    .meta({
      ref: "AutofixHarnessRun",
    })
  export type HarnessRun = z.infer<typeof harness_run>

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
      mode: run_mode.optional(),
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

  export const feedback_attachment = z
    .object({
      id: z.string(),
      feedback_id: z.string(),
      external_id: z.number().int().optional(),
      created_at: z.number(),
      display_order: z.number().int(),
      file_name: z.string().optional(),
      mime_type: z.string(),
      file_size_bytes: z.number().int().optional(),
    })
    .meta({
      ref: "AutofixFeedbackAttachment",
    })
  export type FeedbackAttachment = z.infer<typeof feedback_attachment>

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
      harness: harness.optional(),
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
      attachments: z.array(feedback_attachment),
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
      mode: run_mode,
      status: run_status,
      failure_reason: z.string().optional(),
      plan: plan.optional(),
      harness: harness_run.optional(),
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
      review: harness_decision.optional(),
      gate: harness_decision.optional(),
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

  export const import_attachment = z
    .object({
      display_order: z.coerce.number().int().optional(),
      file_name: z.string().optional(),
      mime_type: z.string().regex(/^image\//),
      file_size_bytes: z.coerce.number().int().optional(),
      file_blob_base64: z.string().min(1),
    })
    .transform((item, ctx) => {
      const file_blob = bytes(item.file_blob_base64, ctx)
      return {
        created_at: 0,
        display_order: item.display_order ?? 0,
        file_name: item.file_name,
        mime_type: item.mime_type,
        file_size_bytes: item.file_size_bytes ?? file_blob.byteLength,
        file_blob,
      }
    })
    .meta({
      ref: "AutofixImportAttachment",
    })
  export type ImportAttachment = z.infer<typeof import_attachment>

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
      attachments: z.array(import_attachment).default([]),
    })
    .transform((item) => ({
      ...item,
      attachments: item.attachments.map((file) => ({
        ...file,
        created_at: item.created_at,
      })),
      feedback_token: item.feedback_token ?? `manual-${item.external_id}`,
      recognize_success: item.recognize_success ?? !!(item.recognized_text?.trim() || item.meta || item.attachments.length),
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
      mode: run_mode.optional(),
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

  export const harness_input = harness.meta({
    ref: "AutofixHarnessInput",
  })
  export type HarnessInput = z.infer<typeof harness_input>

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
