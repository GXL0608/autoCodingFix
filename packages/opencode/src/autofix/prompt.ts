import { AutofixSchema } from "./schema"
import type { RunCtx } from "./types"

export namespace AutofixPrompt {
  const plan_system = [
    "你正在执行 AutoCodingFix 的全自动分析阶段。",
    "禁止向用户提问，禁止等待人工确认，信息不足时必须自行做出最合理的工程判断。",
    "如果存在多个实现方向，优先选择影响面最小、风险最低、兼容现有架构且最容易自动落地的方案。",
    "修改当前反馈内容时，必须严格限制影响范围，不要影响到其他正常功能，不要对其他功能造成影响。",
    "修改当前问题时，如果碰见与当前问题直接相关的代码存在不合理的架构问题，要及时修改优化，同样不要影响其他架构功能，不要影响当前项目正常运转。",
    "对于可以通过阅读代码自行判断的歧义，必须直接做决定并继续，不要把这类问题标记为阻塞。",
    "只有在缺少必要代码、资源、依赖、权限或会造成明显不可逆破坏时，才允许将 automatable 设为 false。",
    "如果你仍然决定使用 question 工具，推荐答案必须放在第一个选项，并在 label 中追加 (Recommended)。",
  ].join("\n")

  const plan_user = [
    "反馈内容：{{feedback}}",
    "结合反馈内容和当前项目代码，输出一份能直接落地的简洁修复计划，优先保证判断准确、范围清晰、步骤可执行，不追求面面俱到的大而全分析。",
    "修改当前反馈内容的时候，不要影响到其他正常功能，不要对其他功能造成影响。",
    "修改当前问题的时候，碰见相关的代码存在不合理的架构问题，要及时的修改优化，同样不要影响其他架构功能，不要影响当前项目正常运转。",
    "结构化计划要求如下：summary 写总体判断和拟采用方案；scope 仅列直接受影响的页面、模块或文件；steps 只写关键执行步骤；acceptance 只写核心验收标准；architecture 仅在直接影响实现时填写关键模块，字段为 name、files、logic，不需要时返回空数组；methods 仅在直接影响修改时填写关键方法，字段为 name、file、comment、logic，不需要时返回空数组；flows 仅列与本次修复直接相关的链路，不需要时返回空数组；automatable 表示是否可以安全自动执行；只有在确实缺少必要资源、依赖、权限或存在明显不可逆风险时才填写 blockers，否则直接做工程判断，不要把可自行决策的问题放入 blockers。",
    "{{extra_block}}",
  ].join("\n")

  const build_system = [
    "你正在执行 AutoCodingFix 的全自动修改阶段。",
    "禁止向用户提问，禁止等待人工确认，遇到取舍时必须自行做出最合理的工程判断并直接执行。",
    "修改当前反馈内容时，必须严格限制影响范围，不要影响到其他正常功能，不要对其他功能造成影响。",
    "修改当前问题时，如果碰见与当前问题直接相关的代码存在不合理的架构问题，要及时修改优化，同样不要影响其他架构功能，不要影响当前项目正常运转。",
    "需要运行命令时直接选择你认为正确且最稳妥的命令，不要把命令选择交还给用户。",
    "如果你仍然决定使用 question 工具，推荐答案必须放在第一个选项，并在 label 中追加 (Recommended)。",
  ].join("\n")

  const build_user = [
    "你现在要在当前 Cell 仓库中直接实现已经批准的 AutoCodingFix 计划。",
    "直接修改当前仓库代码，不要修改版本号，不要创建 worktree，不要创建分支。",
    "反馈 ID：{{feedback_id}}",
    "反馈内容：\n{{feedback}}",
    "{{meta_block}}",
    "第 {{attempt}} 次尝试",
    "计划摘要：{{plan_summary}}",
    "修改当前反馈内容的时候，不要影响到其他正常功能，不要对其他功能造成影响。",
    "修改当前问题的时候，碰见相关的代码存在不合理的架构问题，要及时的修改优化，同样不要影响其他架构功能，不要影响当前项目正常运转。",
    "影响范围：\n{{plan_scope}}",
    "执行步骤：\n{{plan_steps}}",
    "验收标准：\n{{plan_acceptance}}",
    "{{plan_architecture_block}}",
    "{{plan_methods_block}}",
    "{{plan_flows_block}}",
    "{{issue_block}}",
    "{{extra_block}}",
    "严格按照计划实施修改，完成代码修改后停止。",
  ].join("\n\n")

  function defaults() {
    return {
      analysis_system: plan_system,
      analysis_user: plan_user,
      build_system,
      build_user,
    } satisfies AutofixSchema.Prompt
  }

  function replace(text: string, vars: Record<string, string>) {
    let next = text
    for (const [key, value] of Object.entries(vars)) {
      next = next.replaceAll(`{{${key}}}`, value)
    }
    return next.trim()
  }

  function list(items: string[]) {
    return items.map((item) => `- ${item}`).join("\n")
  }

  function block(name: string, text?: string) {
    const item = text?.trim()
    if (!item) return ""
    return `${name}\n${item}`
  }

  function arch(items: AutofixSchema.Plan["architecture"]) {
    if (!items.length) return ""
    return `关键架构：\n${items
      .map((item) => [`- ${item.name}`, `  文件：${item.files.join("、") || "暂无"}`, `  逻辑：${item.logic}`].join("\n"))
      .join("\n")}`
  }

  function methods(items: AutofixSchema.Plan["methods"]) {
    if (!items.length) return ""
    return `关键方法：\n${items
      .map((item) => [`- ${item.name}`, `  文件：${item.file}`, `  注释：${item.comment}`, `  逻辑：${item.logic}`].join("\n"))
      .join("\n")}`
  }

  function flows(items: string[]) {
    if (!items.length) return ""
    return `相关功能与逻辑：\n${list(items)}`
  }

  export function resolve(raw?: unknown) {
    const next = defaults()
    if (!raw) return next
    if (typeof raw === "string") {
      const item = raw.trim()
      if (!item) return next
      try {
        const parsed = JSON.parse(item) as unknown
        if (parsed && typeof parsed === "object") return resolve(parsed)
      } catch {}
      return {
        ...next,
        analysis_user: `${next.analysis_user}\n\n补充要求：\n${item}`,
        build_user: `${next.build_user}\n\n补充要求：\n${item}`,
      } satisfies AutofixSchema.Prompt
    }
    const item = AutofixSchema.prompt_partial.safeParse(raw)
    if (!item.success) return next
    return {
      analysis_system: item.data.analysis_system ?? next.analysis_system,
      analysis_user: item.data.analysis_user ?? next.analysis_user,
      build_system: item.data.build_system ?? next.build_system,
      build_user: item.data.build_user ?? next.build_user,
    } satisfies AutofixSchema.Prompt
  }

  export function same(a: AutofixSchema.Prompt, b: AutofixSchema.Prompt) {
    return (
      a.analysis_system === b.analysis_system &&
      a.analysis_user === b.analysis_user &&
      a.build_system === b.build_system &&
      a.build_user === b.build_user
    )
  }

  export function serialize(item: AutofixSchema.Prompt) {
    return JSON.stringify(item)
  }

  export function analyze(ctx: RunCtx, extra?: string, raw?: unknown) {
    const tmpl = resolve(raw)
    return {
      system: tmpl.analysis_system,
      text: replace(tmpl.analysis_user, {
        feedback: ctx.recognized_text?.trim() || "当前没有识别到可用文本。",
        extra_block: extra?.trim() ? `补充要求：\n${extra.trim()}` : "",
      }),
    }
  }

  export function build(
    ctx: RunCtx,
    plan: AutofixSchema.Plan,
    attempt: number,
    issue?: string,
    extra?: string,
    raw?: unknown,
  ) {
    const tmpl = resolve(raw)
    return {
      system: tmpl.build_system,
      text: replace(tmpl.build_user, {
        feedback_id: String(ctx.external_id),
        feedback: ctx.recognized_text?.trim() || "当前没有识别到可用文本。",
        meta_block: ctx.meta ? `附加信息：\n${JSON.stringify(ctx.meta, null, 2)}` : "",
        attempt: String(attempt),
        plan_summary: plan.summary,
        plan_scope: list(plan.scope),
        plan_steps: list(plan.steps),
        plan_acceptance: list(plan.acceptance),
        plan_architecture_block: arch(plan.architecture),
        plan_methods_block: methods(plan.methods),
        plan_flows_block: flows(plan.flows),
        issue_block: block("上一次验证失败信息：", issue),
        extra_block: block("补充要求：", extra),
      }),
    }
  }
}
