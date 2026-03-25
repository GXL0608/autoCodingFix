export type ResolvedTarget = {
  directory: string
  worktree: string
  project_id: string
  profile: string
  remotes: string[]
  source: {
    kind: "postgres"
    dsn: string
    dsn_env: string
    table: string
    sync_batch: number
  }
  feedback: {
    use_audio_when_text_missing: boolean
    max_audio_bytes: number
  }
  verify: {
    kind: "electron_webview_smoke"
    command: string
    startup_timeout_ms: number
    healthy_window_ms: number
  }
  package: {
    command: string
    artifact_glob: string[]
  }
  version: {
    kind: "suffix"
    source: "root_package_json"
    format: string
  }
}

export type PulledFeedback = {
  external_id: number
  created_at: number
  request_id?: string
  source: string
  feedback_token: string
  device_id: string
  uploader?: unknown
  app_version?: string
  audio_filename?: string
  audio_mime_type?: string
  audio_size_bytes?: number
  audio_duration_ms?: number
  has_audio: boolean
  language?: string
  recognized_text?: string
  processing_time_ms?: number
  recognize_success: boolean
  recognize_http_status?: number
  recognize_error?: string
  recognize_response?: unknown
  meta?: unknown
}

export type TempAudio = {
  path: string
  filename: string
  mime: string
  size: number
}

export type SyncCursor = {
  created_at?: number
  external_id?: number
}

export type SmokeResult = {
  ok: boolean
  log_path: string
  summary: string
}

export type ArtifactResult = {
  path: string
  sha256: string
  size_bytes: number
  log_path: string
}

export type RunCtx = {
  target: ResolvedTarget
  run_id: string
  session_id: string
  feedback_id: string
  external_id: number
  recognized_text?: string
  meta?: unknown
  app_version?: string
  language?: string
  recognize_error?: string
  abort?: AbortSignal
}

export type AttemptResult = {
  files: string[]
}
