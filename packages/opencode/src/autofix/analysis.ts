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
    "修改当前反馈内容时，必须严格限制影响范围，不要影响到其他正常功能，不要对其他功能造成影响。",
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
      "结合反馈内容和当前项目代码，输出一份能直接落地的简洁修复计划，优先保证判断准确、范围清晰、步骤可执行，不追求面面俱到的大而全分析。",
      "修改当前反馈内容的时候，不要影响到其他正常功能，不要对其他功能造成影响。",
      "结构化计划要求如下：summary 写总体判断和拟采用方案；scope 仅列直接受影响的页面、模块或文件；steps 只写关键执行步骤；acceptance 只写核心验收标准；architecture 仅在直接影响实现时填写关键模块，字段为 name、files、logic，不需要时返回空数组；methods 仅在直接影响修改时填写关键方法，字段为 name、file、comment、logic，不需要时返回空数组；flows 仅列与本次修复直接相关的链路，不需要时返回空数组；automatable 表示是否可以安全自动执行；只有在确实缺少必要资源、依赖、权限或存在明显不可逆风险时才填写 blockers，否则直接做工程判断，不要把可自行决策的问题放入 blockers。",
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
