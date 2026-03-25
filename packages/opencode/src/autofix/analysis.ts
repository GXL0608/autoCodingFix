import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { pathToFileURL } from "url"
import z from "zod"
import { AutofixSchema } from "./schema"
import type { RunCtx, TempAudio } from "./types"

export namespace AutofixAnalyzer {
  const SYSTEM = [
    "你正在执行 AutoCodingFix 的全自动分析阶段。",
    "禁止向用户提问，禁止等待人工确认，信息不足时必须自行做出最合理的工程判断。",
    "如果存在多个实现方向，优先选择影响面最小、风险最低、兼容现有架构且最容易自动落地的方案。",
    "对于可以通过阅读代码自行判断的歧义，必须直接做决定并继续，不要把这类问题标记为阻塞。",
    "只有在缺少必要代码、资源、依赖、权限或会造成明显不可逆破坏时，才允许将 automatable 设为 false。",
    "如果你仍然决定使用 question 工具，推荐答案必须放在第一个选项，并在 label 中追加 (Recommended)。",
  ].join("\n")

  export function schema() {
    const raw = z.toJSONSchema(AutofixSchema.plan)
    if (raw.type !== "object") throw new Error("Autofix plan schema must be an object")
    const { $schema, ref, ...schema } = raw
    return schema
  }

  function text(ctx: RunCtx, extra?: string) {
    return [
      `反馈内容：${ctx.recognized_text?.trim() || "当前没有识别到可用文本。"}`,
      "仔细分析反馈内容和当前项目代码，制定一份计划来解决反馈内容问题，输出计划的同时，必须要附带当前需要修改内容的关键的架构、关键的方法及其注释，将相关的、涉及到的所有功能及其逻辑全部捋顺，不能有任何遗漏，将这些内容展示出来，我要严格审查，发挥你最高的水平和最高的能力。",
      "结构化计划要求如下：summary 写总体判断；scope 列出影响范围；steps 列出执行步骤；acceptance 列出验收标准；architecture 列出关键架构，每项必须包含 name、files、logic；methods 列出关键方法，每项必须包含 name、file、comment、logic；flows 列出相关功能与逻辑链路；automatable 表示是否可以安全自动执行；对于可通过工程判断解决的不确定性，不要放入 blockers，而是直接做决定并把假设写入 summary、scope、steps。",
      extra?.trim() ? `补充要求：\n${extra.trim()}` : undefined,
    ]
      .filter(Boolean)
      .join("\n")
  }

  async function run(ctx: RunCtx, audio?: TempAudio, extra?: string) {
    const msg = await SessionPrompt.prompt({
      sessionID: ctx.session_id as Parameters<typeof SessionPrompt.prompt>[0]["sessionID"],
      agent: "plan",
      system: SYSTEM,
      format: {
        type: "json_schema",
        schema: schema(),
        retryCount: 2,
      },
      parts: [
        {
          type: "text",
          text: text(ctx, extra),
        },
        ...(audio
          ? [
              {
                type: "file" as const,
                url: pathToFileURL(audio.path).href,
                filename: audio.filename,
                mime: audio.mime,
              },
            ]
          : []),
      ],
    })
    if (msg.info.role !== "assistant") throw new Error("Autofix plan did not return an assistant message")
    return AutofixSchema.plan.parse(msg.info.structured)
  }

  function retry(plan: AutofixSchema.Plan, extra?: string) {
    return [
      "上一版计划仍然把任务标记为 blocked 或不可自动化。",
      `上一版 summary：${plan.summary}`,
      plan.blockers?.length ? `上一版 blockers：\n${plan.blockers.map((item) => `- ${item}`).join("\n")}` : undefined,
      extra?.trim() ? `用户追加提示：\n${extra.trim()}` : undefined,
      "如果 blockers 只是待确认项、范围取舍项、入口选择项、命名差异项、实现偏好项，你必须自行采用影响面最小且最稳妥的方案，不要继续阻塞。",
      "请输出修订版计划。除非真的缺失关键资源或会造成明显不可逆破坏，否则 automatable 必须为 true。",
    ]
      .filter(Boolean)
      .join("\n\n")
  }

  export async function analyze(ctx: RunCtx, audio?: TempAudio, extra?: string) {
    const plan = await run(ctx, audio, extra)
    if (plan.automatable || !plan.blockers?.length) return plan
    return run(ctx, audio, retry(plan, extra))
  }
}
