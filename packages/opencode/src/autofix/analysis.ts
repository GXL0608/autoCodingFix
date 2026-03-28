import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { pathToFileURL } from "url"
import z from "zod"
import { AutofixPrompt } from "./prompt"
import { AutofixSchema } from "./schema"
import type { RunCtx, TempAudio } from "./types"

export namespace AutofixAnalyzer {
  export function schema() {
    const raw = z.toJSONSchema(AutofixSchema.plan)
    if (raw.type !== "object") throw new Error("Autofix plan schema must be an object")
    const { $schema, ref, ...schema } = raw
    return schema
  }

  async function run(
    ctx: RunCtx,
    audio?: TempAudio,
    extra?: string,
    prompt?: AutofixSchema.Prompt,
    pick?: AutofixSchema.StartInput,
  ) {
    const item = AutofixPrompt.analyze(ctx, extra, prompt)
    const msg = await SessionPrompt.prompt({
      sessionID: ctx.session_id as Parameters<typeof SessionPrompt.prompt>[0]["sessionID"],
      agent: "plan",
      model: pick?.model,
      system: item.system,
      format: {
        type: "json_schema",
        schema: schema(),
        retryCount: 2,
      },
      variant: pick?.variant,
      parts: [
        {
          type: "text",
          text: item.text,
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

  export async function analyze(
    ctx: RunCtx,
    audio?: TempAudio,
    extra?: string,
    prompt?: AutofixSchema.Prompt,
    pick?: AutofixSchema.StartInput,
  ) {
    const plan = await run(ctx, audio, extra, prompt, pick)
    if (plan.automatable || !plan.blockers?.length) return plan
    return run(ctx, audio, retry(plan, extra), prompt, pick)
  }
}
