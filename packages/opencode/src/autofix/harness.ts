import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { SessionPrompt } from "@/session/prompt"
import { MessageV2 } from "@/session/message-v2"
import { pathToFileURL } from "url"
import z from "zod"
import { AutofixSchema } from "./schema"
import type { ResolvedTarget, RunCtx } from "./types"

export namespace AutofixHarness {
  const survey_system = [
    "你是 AutoCodingFix Harness 的 survey 子智能体。",
    "你只负责收集与当前反馈直接相关的最小上下文，不负责编写修复计划，不负责改代码。",
    "只允许围绕当前问题做最小范围探索，避免无关阅读和发散分析。",
    "如果需要搜索或阅读代码，最多进行 {{search}} 次搜索、{{read}} 次 read、{{bash}} 次 bash。",
    "输出必须简洁，重点回答：影响范围、最相关文件、主要风险。",
  ].join("\n")

  const plan_system = [
    "你是 AutoCodingFix Harness 的计划审查子智能体。",
    "你只负责评估计划是否适合自动执行，不负责编写代码。",
    "如果计划范围过大、缺少关键验收标准、或明显偏离当前反馈，就应拒绝。",
    "如果计划可以执行，给出通过结论和最关键的执行提醒。",
    "如果需要搜索或阅读代码，最多进行 {{search}} 次搜索、{{read}} 次 read、{{bash}} 次 bash。",
  ].join("\n")

  const review_system = [
    "你是 AutoCodingFix Harness 的代码审查子智能体。",
    "你只负责评估本轮修改是否真正解决问题且没有明显扩大影响面，不负责编写代码。",
    "优先审查：是否命中反馈、是否符合计划、是否可能带来回归、是否遗漏关键路径。",
    "如果需要搜索或阅读代码，最多进行 {{search}} 次搜索、{{read}} 次 read、{{bash}} 次 bash。",
  ].join("\n")

  const gate_system = [
    "你是 AutoCodingFix Harness 的提交前验证子智能体。",
    "你只负责决定当前结果是否允许进入提交阶段，不负责编写代码。",
    "你需要结合修复计划、改动文件、smoke 验证结果和日志判断是否可以提交。",
    "如果 smoke 失败、风险未收敛、或改动和反馈不一致，就应拒绝提交。",
    "如果需要搜索或阅读代码，最多进行 {{search}} 次搜索、{{read}} 次 read、{{bash}} 次 bash。",
  ].join("\n")

  function defaults() {
    return {
      enabled: false,
      fallback_legacy: true,
      survey: true,
      review: true,
      verify: true,
      limits: {
        search: 5,
        read: 8,
        bash: 4,
      },
      overview: "",
      analysis: "",
      build: "",
      review_note: "",
      verify_note: "",
    } satisfies AutofixSchema.Harness
  }

  function replace(text: string, vars: Record<string, string>) {
    let next = text
    for (const [key, value] of Object.entries(vars)) {
      next = next.replaceAll(`{{${key}}}`, value)
    }
    return next.trim()
  }

  function schema(item: z.ZodType) {
    const raw = z.toJSONSchema(item)
    if (raw.type !== "object") throw new Error("Harness schema must be an object")
    const { $schema, ref, ...next } = raw
    return next
  }

  function list(items: string[]) {
    return items.length ? items.map((item) => `- ${item}`).join("\n") : "- 暂无"
  }

  function txt(text?: string, title?: string) {
    const item = text?.trim()
    if (!item) return ""
    if (!title) return item
    return `${title}\n${item}`
  }

  function prompt(text: string, cfg: AutofixSchema.Harness) {
    return replace(text, {
      search: String(cfg.limits.search),
      read: String(cfg.limits.read),
      bash: String(cfg.limits.bash),
    })
  }

  export function resolve(raw?: unknown) {
    const next = defaults()
    if (!raw) return next
    const item = AutofixSchema.harness.safeParse(raw)
    if (!item.success) return next
    return item.data
  }

  export function same(a: AutofixSchema.Harness, b: AutofixSchema.Harness) {
    return JSON.stringify(a) === JSON.stringify(b)
  }

  export function serialize(item: AutofixSchema.Harness) {
    return JSON.stringify(item)
  }

  function usage(msgs: Awaited<ReturnType<typeof Session.messages>>) {
    const count = {
      search: 0,
      read: 0,
      bash: 0,
    }
    for (const msg of msgs) {
      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        if (["grep", "glob", "codesearch", "websearch"].includes(part.tool)) count.search += 1
        if (part.tool === "read") count.read += 1
        if (part.tool === "bash") count.bash += 1
      }
    }
    return count
  }

  async function audit(sessionID: string, cfg: AutofixSchema.Harness) {
    const msgs = await Session.messages({
      sessionID: SessionID.make(sessionID),
    })
    const count = usage(msgs)
    if (count.search > cfg.limits.search)
      throw new Error(`Harness search limit exceeded: ${count.search}/${cfg.limits.search}`)
    if (count.read > cfg.limits.read)
      throw new Error(`Harness read limit exceeded: ${count.read}/${cfg.limits.read}`)
    if (count.bash > cfg.limits.bash)
      throw new Error(`Harness bash limit exceeded: ${count.bash}/${cfg.limits.bash}`)
    return count
  }

  async function run<T>(input: {
    parentID: string
    title: string
    agent: "explore" | "plan"
    text: string
    system: string
    pick?: AutofixSchema.StartInput
    schema: z.ZodType<T>
    file?: string
    cfg: AutofixSchema.Harness
  }) {
    const ses = await Session.create({
      parentID: SessionID.make(input.parentID),
      title: input.title,
    })
    const msg = await SessionPrompt.prompt({
      sessionID: ses.id,
      agent: input.agent,
      model: input.pick?.model,
      system: input.system,
      variant: input.pick?.variant,
      format: {
        type: "json_schema",
        schema: schema(input.schema),
        retryCount: 2,
      },
      parts: [
        {
          type: "text",
          text: input.text,
        },
        ...(input.file
          ? [
              {
                type: "file" as const,
                url: pathToFileURL(input.file).href,
                filename: input.file.split("/").pop() ?? "file.txt",
                mime: "text/plain",
              },
            ]
          : []),
      ],
    })
    if (msg.info.role !== "assistant") throw new Error("Harness agent did not return an assistant message")
    const count = await audit(ses.id, input.cfg)
    return {
      session_id: ses.id,
      data: input.schema.parse(msg.info.structured),
      count,
    }
  }

  export async function survey(
    parentID: string,
    ctx: RunCtx,
    cfg: AutofixSchema.Harness,
    pick?: AutofixSchema.StartInput,
  ) {
    return run({
      parentID,
      title: `Harness survey #${ctx.external_id}`,
      agent: "explore",
      system: prompt(survey_system, cfg),
      pick,
      schema: AutofixSchema.harness_survey,
      cfg,
      text: [
        `反馈内容：${ctx.recognized_text?.trim() || "当前没有识别到可用文本。"}`,
        txt(cfg.overview, "通用治理要求："),
        txt(cfg.analysis, "分析阶段详情："),
        "请只输出当前反馈最需要的最小上下文。",
      ]
        .filter(Boolean)
        .join("\n\n"),
    })
  }

  export async function planReview(
    parentID: string,
    ctx: RunCtx,
    plan: AutofixSchema.Plan,
    sum: AutofixSchema.HarnessSurvey | undefined,
    cfg: AutofixSchema.Harness,
    pick?: AutofixSchema.StartInput,
  ) {
    return run({
      parentID,
      title: `Harness plan review #${ctx.external_id}`,
      agent: "plan",
      system: prompt(plan_system, cfg),
      pick,
      schema: AutofixSchema.harness_decision,
      cfg,
      text: [
        `反馈内容：${ctx.recognized_text?.trim() || "当前没有识别到可用文本。"}`,
        sum ? `survey 摘要：${sum.summary}` : "",
        `计划摘要：${plan.summary}`,
        `影响范围：\n${list(plan.scope)}`,
        `执行步骤：\n${list(plan.steps)}`,
        `验收标准：\n${list(plan.acceptance)}`,
        txt(cfg.overview, "通用治理要求："),
        txt(cfg.analysis, "分析阶段详情："),
        "请判断这个计划是否适合自动执行，并给出通过或驳回结论。",
      ]
        .filter(Boolean)
        .join("\n\n"),
    })
  }

  export async function review(
    parentID: string,
    ctx: RunCtx,
    plan: AutofixSchema.Plan,
    no: number,
    files: string[],
    sum: AutofixSchema.HarnessSurvey | undefined,
    cfg: AutofixSchema.Harness,
    pick?: AutofixSchema.StartInput,
  ) {
    return run({
      parentID,
      title: `Harness review #${ctx.external_id} attempt ${no}`,
      agent: "plan",
      system: prompt(review_system, cfg),
      pick,
      schema: AutofixSchema.harness_decision,
      cfg,
      text: [
        `反馈内容：${ctx.recognized_text?.trim() || "当前没有识别到可用文本。"}`,
        `第 ${no} 次尝试`,
        sum ? `survey 摘要：${sum.summary}` : "",
        `计划摘要：${plan.summary}`,
        `验收标准：\n${list(plan.acceptance)}`,
        `本轮修改文件：\n${list(files)}`,
        txt(cfg.overview, "通用治理要求："),
        txt(cfg.build, "修改阶段详情："),
        txt(cfg.review_note, "审查阶段详情："),
        "请基于当前仓库状态审查本轮修改是否解决问题且风险可控。",
      ]
        .filter(Boolean)
        .join("\n\n"),
    })
  }

  export async function gate(
    parentID: string,
    ctx: RunCtx,
    plan: AutofixSchema.Plan,
    no: number,
    files: string[],
    sum: AutofixSchema.HarnessSurvey | undefined,
    smoke: { summary: string; log_path?: string },
    target: ResolvedTarget["verify"],
    cfg: AutofixSchema.Harness,
    pick?: AutofixSchema.StartInput,
  ) {
    return run({
      parentID,
      title: `Harness gate #${ctx.external_id} attempt ${no}`,
      agent: "plan",
      system: prompt(gate_system, cfg),
      pick,
      schema: AutofixSchema.harness_decision,
      cfg,
      file: smoke.log_path,
      text: [
        `反馈内容：${ctx.recognized_text?.trim() || "当前没有识别到可用文本。"}`,
        `第 ${no} 次尝试`,
        sum ? `survey 摘要：${sum.summary}` : "",
        `计划摘要：${plan.summary}`,
        `验收标准：\n${list(plan.acceptance)}`,
        `本轮修改文件：\n${list(files)}`,
        `smoke 结果：${smoke.summary}`,
        `你必须自行执行验证命令并根据实际结果做判断：${target.command}`,
        txt(cfg.overview, "通用治理要求："),
        txt(cfg.verify_note, "提交前验证详情："),
        "请判断当前结果是否允许进入提交阶段。",
      ]
        .filter(Boolean)
        .join("\n\n"),
    })
  }
}
