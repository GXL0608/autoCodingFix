import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { AutofixAnalyzer } from "../../src/autofix/analysis"
import { AutofixSchema } from "../../src/autofix/schema"
import * as PromptModule from "../../src/session/prompt"

let mock: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  mock?.mockRestore()
  mock = undefined
})

describe("autofix.analysis", () => {
  test("accepts minimal import items and fills defaults", () => {
    const out = AutofixSchema.import_input.parse({
      items: [
        {
          external_id: 1,
          recognized_text: "反馈内容",
        },
      ],
    })

    expect(out.items[0]?.external_id).toBe(1)
    expect(out.items[0]?.recognized_text).toBe("反馈内容")
    expect(out.items[0]?.source).toBe("manual_import")
    expect(out.items[0]?.device_id).toBe("manual-import")
    expect(out.items[0]?.feedback_token).toBe("manual-1")
    expect(out.items[0]?.has_audio).toBe(false)
    expect(out.items[0]?.recognize_success).toBe(true)
    expect(typeof out.items[0]?.created_at).toBe("number")
  })

  test("uses an object schema for structured output", () => {
    const schema = AutofixAnalyzer.schema() as {
      $schema?: string
      ref?: string
      type?: string
      properties?: Record<string, unknown>
    }

    expect(schema.$schema).toBeUndefined()
    expect(schema.ref).toBeUndefined()
    expect(schema.type).toBe("object")
    expect(schema.properties?.summary).toBeDefined()
    expect(schema.properties?.architecture).toBeDefined()
    expect(schema.properties?.methods).toBeDefined()
    expect(schema.properties?.flows).toBeDefined()
  })

  test("uses concise planning instructions and allows empty detail sections", async () => {
    mock = spyOn(PromptModule.SessionPrompt, "prompt").mockResolvedValue({
      info: {
        role: "assistant",
        structured: {
          summary: "默认采用最小改动方案。",
          scope: ["主界面播放区域"],
          steps: ["对齐雾化内容和实际播放状态"],
          acceptance: ["雾化显示与播放一致"],
          architecture: [],
          methods: [],
          flows: [],
          automatable: true,
          blockers: [],
        },
      },
    } as never)

    await AutofixAnalyzer.analyze({
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
      recognized_text: "播放雾化不同步",
    })

    const req = mock.mock.calls[0]?.[0]
    const text = req?.parts[0]

    expect(text?.type).toBe("text")
    if (text?.type !== "text") return
    expect(text.text).toContain("简洁修复计划")
    expect(text.text).toContain("不要影响到其他正常功能")
    expect(text.text).toContain("不需要时返回空数组")
    expect(text.text).not.toContain("不能有任何遗漏")
  })

  test("retries blocked plans and prefers an automatable revision", async () => {
    mock = spyOn(PromptModule.SessionPrompt, "prompt")
    mock
      .mockResolvedValueOnce({
        info: {
          role: "assistant",
          structured: {
            summary: "需要确认入口范围",
            scope: ["首页搜索入口"],
            steps: ["确认需要移除哪个入口"],
            acceptance: ["范围明确"],
            architecture: [],
            methods: [],
            flows: [],
            automatable: false,
            blockers: ["当前代码存在两处相似入口，请确认只改主界面还是两处都改。"],
          },
        },
      } as never)
      .mockResolvedValueOnce({
        info: {
          role: "assistant",
          structured: {
            summary: "默认只改主界面入口，保持最小改动。",
            scope: ["主界面搜索入口"],
            steps: ["移除主界面入口", "保留其他页面"],
            acceptance: ["主界面入口消失", "其他页面不受影响"],
            architecture: [],
            methods: [],
            flows: [],
            automatable: true,
            blockers: [],
          },
        },
      } as never)

    const plan = await AutofixAnalyzer.analyze({
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
      recognized_text: "移除搜索入口",
    })

    expect(mock).toHaveBeenCalledTimes(2)
    expect(plan.automatable).toBe(true)
    expect(plan.summary).toContain("默认只改主界面")
  })
})
