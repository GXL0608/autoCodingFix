import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { AutofixExecutor } from "../../src/autofix/executor"
import { AutofixSchema } from "../../src/autofix/schema"
import { LocalGitFlow } from "../../src/autofix/git"
import { AutofixQueue } from "../../src/autofix/queue"
import * as PromptModule from "../../src/session/prompt"

let prompt: ReturnType<typeof spyOn> | undefined
let diff: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  prompt?.mockRestore()
  diff?.mockRestore()
  prompt = undefined
  diff = undefined
})

function feedback() {
  return AutofixSchema.feedback.parse({
    id: "fb",
    project_id: "p",
    directory: "/tmp",
    external_id: 1,
    created_at: Date.now(),
    source: "manual_import",
    feedback_token: "manual-1",
    device_id: "manual-import",
    has_audio: false,
    recognize_success: true,
    recognized_text: "设置页文案未刷新",
    attachments: [],
    muted: false,
    status: "queued",
    time_created: Date.now(),
    time_updated: Date.now(),
  })
}

describe("autofix.executor", () => {
  test("forwards explicit model selection to build prompts", async () => {
    prompt = spyOn(PromptModule.SessionPrompt, "prompt").mockResolvedValue({
      info: {
        role: "assistant",
      },
    } as never)
    diff = spyOn(LocalGitFlow, "diff").mockResolvedValue([])

    const pick = AutofixSchema.start_input.parse({
      model: {
        providerID: "openai",
        modelID: "gpt-5.2",
      },
      variant: "high",
    })

    await AutofixExecutor.implement(
      {
        target: {
          directory: "/tmp",
          worktree: "/tmp",
          project_id: "p",
          profile: "cell",
          remotes: [],
          source: {
            kind: "postgres",
            dsn: "",
            dsn_env: "",
            table: "",
            sync_batch: 1,
          },
          feedback: {
            use_audio_when_text_missing: false,
            max_audio_bytes: 1,
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
            format: "",
          },
        },
        run_id: "run",
        session_id: "ses",
        feedback_id: "fb",
        external_id: 1,
        recognized_text: "设置页文案未刷新",
      },
      feedback(),
      {
        summary: "修复文案刷新",
        scope: ["设置页"],
        steps: ["触发重新渲染"],
        acceptance: ["切换语言后立即刷新"],
        architecture: [],
        methods: [],
        flows: [],
        automatable: true,
      },
      1,
      undefined,
      undefined,
      undefined,
      undefined,
      pick,
    )

    const req = prompt?.mock.calls[0]?.[0]
    expect(req?.model).toEqual(pick.model)
    expect(req?.variant).toBe("high")
  })

  test("forwards image attachments to build prompts", async () => {
    prompt = spyOn(PromptModule.SessionPrompt, "prompt").mockResolvedValue({
      info: {
        role: "assistant",
      },
    } as never)
    diff = spyOn(LocalGitFlow, "diff").mockResolvedValue([])
    const files = spyOn(AutofixQueue, "attachmentData").mockResolvedValue([
      {
        id: "att",
        feedback_id: "fb",
        external_id: null,
        created_at: Date.now(),
        display_order: 0,
        file_name: "shot.png",
        mime_type: "image/png",
        file_size_bytes: 3,
        file_blob: Buffer.from("img"),
        time_created: Date.now(),
        time_updated: Date.now(),
      },
    ] as never)

    await AutofixExecutor.implement(
      {
        target: {
          directory: "/tmp",
          worktree: "/tmp",
          project_id: "p",
          profile: "cell",
          remotes: [],
          source: {
            kind: "postgres",
            dsn: "",
            dsn_env: "",
            table: "",
            sync_batch: 1,
          },
          feedback: {
            use_audio_when_text_missing: false,
            max_audio_bytes: 1,
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
            format: "",
          },
        },
        run_id: "run",
        session_id: "ses",
        feedback_id: "fb",
        external_id: 1,
        recognized_text: "设置页文案未刷新",
      },
      {
        ...feedback(),
        attachments: [
          {
            id: "att",
            feedback_id: "fb",
            created_at: Date.now(),
            display_order: 0,
            file_name: "shot.png",
            mime_type: "image/png",
            file_size_bytes: 3,
          },
        ],
      },
      {
        summary: "修复文案刷新",
        scope: ["设置页"],
        steps: ["触发重新渲染"],
        acceptance: ["切换语言后立即刷新"],
        architecture: [],
        methods: [],
        flows: [],
        automatable: true,
      },
      1,
    )

    const req = prompt?.mock.calls[0]?.[0]
    expect(req?.parts.some((part: { type: string; mime?: string }) => part.type === "file" && part.mime === "image/png")).toBe(true)
    files.mockRestore()
  })
})
