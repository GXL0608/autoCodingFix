import { SessionPrompt } from "@/session/prompt"
import { pathToFileURL } from "url"
import { LocalGitFlow } from "./git"
import type { AttemptResult, RunCtx, TempAudio } from "./types"
import type { AutofixSchema } from "./schema"

export namespace AutofixExecutor {
  const SYSTEM = [
    "你正在执行 AutoCodingFix 的全自动修改阶段。",
    "禁止向用户提问，禁止等待人工确认，遇到取舍时必须自行做出最合理的工程判断并直接执行。",
    "修改当前反馈内容时，必须严格限制影响范围，不要影响到其他正常功能，不要对其他功能造成影响。",
    "需要运行命令时直接选择你认为正确且最稳妥的命令，不要把命令选择交还给用户。",
    "如果你仍然决定使用 question 工具，推荐答案必须放在第一个选项，并在 label 中追加 (Recommended)。",
  ].join("\n")

  function error(err: { name: string; data: unknown }) {
    const data = err.data
    if (typeof data === "object" && data !== null && "message" in data && typeof data.message === "string")
      return data.message
    return err.name
  }

  function text(ctx: RunCtx, plan: AutofixSchema.Plan, attempt: number, issue?: string, extra?: string) {
    return [
      "你现在要在当前 Cell 仓库中直接实现已经批准的 AutoCodingFix 计划。",
      "直接修改当前仓库代码，不要修改版本号，不要创建 worktree，不要创建分支。",
      `反馈 ID：${ctx.external_id}`,
      ctx.recognized_text?.trim() ? `反馈内容：\n${ctx.recognized_text}` : "反馈内容：当前没有识别到可用文本。",
      ctx.meta ? `附加信息：\n${JSON.stringify(ctx.meta, null, 2)}` : undefined,
      `第 ${attempt} 次尝试`,
      `计划摘要：${plan.summary}`,
      "修改当前反馈内容的时候，不要影响到其他正常功能，不要对其他功能造成影响。",
      `影响范围：\n${plan.scope.map((item) => `- ${item}`).join("\n")}`,
      `执行步骤：\n${plan.steps.map((item) => `- ${item}`).join("\n")}`,
      `验收标准：\n${plan.acceptance.map((item) => `- ${item}`).join("\n")}`,
      plan.architecture.length
        ? `关键架构：\n${plan.architecture
            .map((item) => [`- ${item.name}`, `  文件：${item.files.join("、") || "暂无"}`, `  逻辑：${item.logic}`].join("\n"))
            .join("\n")}`
        : undefined,
      plan.methods.length
        ? `关键方法：\n${plan.methods
            .map((item) => [`- ${item.name}`, `  文件：${item.file}`, `  注释：${item.comment}`, `  逻辑：${item.logic}`].join("\n"))
            .join("\n")}`
        : undefined,
      plan.flows.length ? `相关功能与逻辑：\n${plan.flows.map((item) => `- ${item}`).join("\n")}` : undefined,
      issue ? `上一次验证失败信息：\n${issue}` : undefined,
      extra?.trim() ? `补充要求：\n${extra.trim()}` : undefined,
      "严格按照计划实施修改，完成代码修改后停止。",
    ]
      .filter(Boolean)
      .join("\n\n")
  }

  export async function implement(
    ctx: RunCtx,
    plan: AutofixSchema.Plan,
    attempt: number,
    audio?: TempAudio,
    issue?: string,
    extra?: string,
  ): Promise<AttemptResult> {
    const msg = await SessionPrompt.prompt({
      sessionID: ctx.session_id as Parameters<typeof SessionPrompt.prompt>[0]["sessionID"],
      agent: "build",
      system: SYSTEM,
      parts: [
        {
          type: "text",
          text: text(ctx, plan, attempt, issue, extra),
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
    if (msg.info.role !== "assistant") throw new Error("Autofix implementation did not return an assistant message")
    if (msg.info.error) throw new Error(error(msg.info.error))
    return {
      files: await LocalGitFlow.diff(ctx.target.directory),
    }
  }
}
