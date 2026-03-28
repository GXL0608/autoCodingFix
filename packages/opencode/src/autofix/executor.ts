import { SessionPrompt } from "@/session/prompt"
import { pathToFileURL } from "url"
import { LocalGitFlow } from "./git"
import { AutofixPrompt } from "./prompt"
import type { AttemptResult, RunCtx, TempAudio } from "./types"
import type { AutofixSchema } from "./schema"

export namespace AutofixExecutor {
  function error(err: { name: string; data: unknown }) {
    const data = err.data
    if (typeof data === "object" && data !== null && "message" in data && typeof data.message === "string")
      return data.message
    return err.name
  }

  export async function implement(
    ctx: RunCtx,
    plan: AutofixSchema.Plan,
    attempt: number,
    audio?: TempAudio,
    issue?: string,
    extra?: string,
    prompt?: AutofixSchema.Prompt,
    pick?: AutofixSchema.StartInput,
  ): Promise<AttemptResult> {
    const item = AutofixPrompt.build(ctx, plan, attempt, issue, extra, prompt)
    const msg = await SessionPrompt.prompt({
      sessionID: ctx.session_id as Parameters<typeof SessionPrompt.prompt>[0]["sessionID"],
      agent: "build",
      model: pick?.model,
      system: item.system,
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
    if (msg.info.role !== "assistant") throw new Error("Autofix implementation did not return an assistant message")
    if (msg.info.error) throw new Error(error(msg.info.error))
    return {
      files: await LocalGitFlow.diff(ctx.target.directory),
    }
  }
}
