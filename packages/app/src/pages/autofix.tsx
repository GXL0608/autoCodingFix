import type { AutofixDetail, AutofixFeedback, AutofixPrompt, AutofixRun, AutofixSummary } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Select } from "@opencode-ai/ui/select"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/util/encode"
import { useNavigate } from "@solidjs/router"
import { type JSX, For, Show, batch, createEffect, createMemo, createResource, createSelector, createSignal, onCleanup } from "solid-js"
import { useLocal } from "@/context/local"
import { useSDK } from "@/context/sdk"

const stateText: Record<string, string> = {
  disabled: "不可用",
  idle: "空闲",
  syncing: "同步中",
  running: "执行中",
  stopping: "停止中",
  blocked: "已阻塞",
}

const statusText: Record<string, string> = {
  queued: "待处理",
  analyzing: "分析中",
  implementing: "修改中",
  verifying: "验证中",
  committing: "提交中",
  packaging: "打包中",
  done: "已完成",
  muted: "已屏蔽",
  blocked: "已阻塞",
  failed: "已失败",
  stopped: "已停止",
}

const attemptText: Record<string, string> = {
  pending: "等待中",
  running: "执行中",
  verified: "已通过",
  failed: "已失败",
  stopped: "已停止",
}

const levelText: Record<string, string> = {
  info: "信息",
  warn: "警告",
  error: "错误",
}

const artifactText: Record<string, string> = {
  package: "安装包",
}

const filters = [
  { value: "all", label: "全部状态" },
  { value: "queued", label: "待处理" },
  { value: "analyzing", label: "分析中" },
  { value: "implementing", label: "修改中" },
  { value: "verifying", label: "验证中" },
  { value: "committing", label: "提交中" },
  { value: "packaging", label: "打包中" },
  { value: "done", label: "已完成" },
  { value: "muted", label: "已屏蔽" },
  { value: "blocked", label: "已阻塞" },
  { value: "failed", label: "已失败" },
  { value: "stopped", label: "已停止" },
] as const

const sample = JSON.stringify(
  [
    {
      external_id: 10001,
      recognized_text: "设置页切换语言后，文案没有立即刷新。",
    },
  ],
  null,
  2,
)

const blank = {
  analysis_system: "",
  analysis_user: "",
  build_system: "",
  build_user: "",
} satisfies AutofixPrompt

function ink(status?: string) {
  if (status === "done" || status === "verified") return "text-emerald-700 dark:text-emerald-300"
  if (status === "failed" || status === "error") return "text-rose-700 dark:text-rose-300"
  if (status === "muted") return "text-zinc-700 dark:text-zinc-300"
  if (status === "blocked" || status === "warn" || status === "stopping") return "text-amber-700 dark:text-amber-300"
  if (["analyzing", "implementing", "verifying", "committing", "packaging", "running", "info"].includes(status ?? ""))
    return "text-sky-700 dark:text-sky-300"
  return "text-text-base"
}

function pill(status?: string) {
  if (status === "done" || status === "verified")
    return "border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  if (status === "failed" || status === "error")
    return "border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
  if (status === "muted") return "border border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300"
  if (status === "blocked" || status === "warn" || status === "stopping")
    return "border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
  if (["analyzing", "implementing", "verifying", "committing", "packaging", "running", "info"].includes(status ?? ""))
    return "border border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
  return "border border-border-weak-base bg-surface-raised-base text-text-base"
}

function view(item?: { muted?: boolean; status?: string }) {
  if (item?.muted) return "muted"
  return item?.status
}

function work(status?: string) {
  return ["analyzing", "implementing", "verifying", "committing", "packaging"].includes(status ?? "")
}

function label(status?: string) {
  return (
    stateText[status ?? ""] ??
    statusText[status ?? ""] ??
    attemptText[status ?? ""] ??
    levelText[status ?? ""] ??
    status ??
    "未知"
  )
}

function stamp(time?: number) {
  if (!time) return "暂无"
  return new Date(time).toLocaleString("zh-CN")
}

function parse(input: string) {
  const text = input.trim()
  if (!text) throw new Error("请先选择文件或粘贴 JSON 数据。")
  const data = JSON.parse(text) as unknown
  if (Array.isArray(data)) return { items: data }
  if (!data || typeof data !== "object" || !("items" in data)) {
    throw new Error('JSON 顶层需要是数组，或形如 {"items":[...]} 的对象。')
  }
  if (!Array.isArray(data.items)) throw new Error('字段 "items" 必须是数组。')
  return { items: data.items }
}

function text(item?: AutofixFeedback) {
  return item?.recognized_text?.trim() || item?.note?.trim() || "暂无识别文本"
}

function missing(err: unknown) {
  if (!err) return false
  if (err instanceof Error) {
    if (err.message.includes("Autofix run not found")) return true
    return missing(err.cause)
  }
  if (typeof err !== "object") return false
  if ("message" in err && typeof err.message === "string" && err.message.includes("Autofix run not found")) return true
  if ("data" in err && missing(err.data)) return true
  if ("cause" in err) return missing(err.cause)
  return false
}

function clone(prompt?: AutofixPrompt) {
  return {
    analysis_system: prompt?.analysis_system ?? "",
    analysis_user: prompt?.analysis_user ?? "",
    build_system: prompt?.build_system ?? "",
    build_user: prompt?.build_user ?? "",
  } satisfies AutofixPrompt
}

function same(a?: AutofixPrompt, b?: AutofixPrompt) {
  return (
    (a?.analysis_system ?? "") === (b?.analysis_system ?? "") &&
    (a?.analysis_user ?? "") === (b?.analysis_user ?? "") &&
    (a?.build_system ?? "") === (b?.build_system ?? "") &&
    (a?.build_user ?? "") === (b?.build_user ?? "")
  )
}

function Card(props: {
  title: string
  children: JSX.Element
  class?: string
  action?: JSX.Element
  body?: string
}) {
  return (
    <section class={`min-h-0 flex flex-col rounded-2xl border border-border-weak-base bg-surface-base ${props.class ?? ""}`}>
      <div class="shrink-0 px-4 py-3 border-b border-border-weak-base flex items-center gap-3">
        <div class="text-14-medium text-text-strong">{props.title}</div>
        <div class="grow" />
        {props.action}
      </div>
      <div class={`min-h-0 ${props.body ?? "p-4"}`}>{props.children}</div>
    </section>
  )
}

function Info(props: { name: string; value?: string | number | null }) {
  return (
    <div class="flex items-center gap-2 text-12-regular">
      <span class="text-text-weak">{props.name}</span>
      <span class="text-text-base break-all">{props.value || "暂无"}</span>
    </div>
  )
}

export default function AutofixPage() {
  const local = useLocal()
  const sdk = useSDK()
  const navigate = useNavigate()
  const dialog = useDialog()
  let listRef: HTMLDivElement | undefined
  const [busy, setBusy] = createSignal<string>()
  const [feedbackID, setFeedbackID] = createSignal<string>()
  const [runID, setRunID] = createSignal<string>()
  const [resetID, setResetID] = createSignal<string>()
  const [filter, setFilter] = createSignal<(typeof filters)[number]["value"]>("all")
  const [infoOpen, setInfoOpen] = createSignal(true)
  const [shared, setShared] = createSignal<AutofixPrompt>(blank)
  const [saved, setSaved] = createSignal<AutofixPrompt>(blank)
  let tick = 0

  const [summary, summaryCtl] = createResource(
    async () => (await sdk.client.experimental.autofix.get()).data as AutofixSummary | undefined,
  )
  const [feedback, feedbackCtl] = createResource(
    async () => (await sdk.client.experimental.autofix.feedback()).data ?? ([] as AutofixFeedback[]),
  )
  const [runs, runsCtl] = createResource(
    async () => (await sdk.client.experimental.autofix.run.list()).data ?? ([] as AutofixRun[]),
  )

  const items = createMemo(() => feedback() ?? [])
  const rows = createMemo(() => {
    const key = filter()
    if (key === "all") return items()
    return items().filter((item) => view(item) === key)
  })
  const live = createMemo(() => summary()?.active_run)
  const liveItem = createMemo(() => items().find((item) => item.id === live()?.feedback_id))
  const dirty = createMemo(() => !same(shared(), saved()))
  const picked = createMemo(() => items().find((item) => item.id === feedbackID()))
  const pickedRow = createSelector(feedbackID)
  const liveRow = createSelector(() => live()?.feedback_id)
  const list = createMemo(() => (runs() ?? []).filter((item) => item.feedback_id === feedbackID()))
  const note = createMemo(() => {
    const item = picked()
    if (!item?.note?.trim()) return
    if (item.note === item.recognized_text) return
    return item.note
  })
  const total = createMemo(() => {
    const item = summary()?.state.counts
    if (!item) return 0
    return item.queued + item.running + item.done + item.failed + item.blocked + item.muted
  })
  const done = createMemo(() => {
    const item = summary()?.state.counts
    if (!item) return 0
    return item.done + item.failed + item.blocked + item.muted
  })
  const pct = createMemo(() => (total() ? Math.round((done() / total()) * 100) : items().length > 0 ? 100 : 0))

  const [detail, detailCtl] = createResource(
    () => ({
      feedback: feedbackID(),
      run: runID(),
    }),
    async (value) => {
      if (!value.feedback || !value.run) return
      try {
        return (await sdk.client.experimental.autofix.run.get({ runID: value.run })).data as AutofixDetail | undefined
      } catch (err) {
        if (missing(err)) return
        throw err
      }
    },
  )

  const grab = () => {
    if (!listRef) return
    return {
      top: listRef.scrollTop,
      height: listRef.scrollHeight,
    }
  }

  const last = (item?: AutofixFeedback) => {
    if (!item) return
    if (resetID() === item.id) return
    const run = live()
    if (run?.feedback_id === item.id) return run.id
    if (!item.last_run_id) return
    return (runs() ?? []).find((row) => row.feedback_id === item.id && row.id === item.last_run_id)?.id
  }

  const keep = (snap?: { top: number; height: number }, id = tick) => {
    if (!snap) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!listRef || id !== tick) return
        listRef.scrollTop = Math.max(0, snap.top + listRef.scrollHeight - snap.height)
      })
    })
  }

  const reload = async (snap = grab()) => {
    const id = ++tick
    await Promise.all([
      summaryCtl.refetch(),
      feedbackCtl.refetch(),
      runsCtl.refetch(),
      runID() && !resetID() ? detailCtl.refetch() : Promise.resolve(),
    ])
    keep(snap, id)
  }

  const pickOne = (item: AutofixFeedback) => {
    const snap = grab()
    batch(() => {
      setFeedbackID(item.id)
      setRunID(last(item))
      detailCtl.mutate(undefined)
    })
    keep(snap)
  }

  createEffect(() => {
    const next = clone(summary()?.state.prompt)
    if (!same(shared(), saved())) return
    if (same(saved(), next)) return
    batch(() => {
      setSaved(clone(next))
      setShared(clone(next))
    })
  })

  createEffect(() => {
    const id = feedbackID()
    if (id && rows().some((item) => item.id === id)) return
    const liveID = liveItem()?.id
    if (liveID && rows().some((item) => item.id === liveID)) {
      setFeedbackID(liveID)
      return
    }
    if (rows()[0]?.id) {
      setFeedbackID(rows()[0].id)
      return
    }
    setFeedbackID(undefined)
  })

  createEffect(() => {
    feedbackID()
    setInfoOpen(true)
  })

  createEffect(() => {
    const item = picked()
    if (!item) {
      setRunID(undefined)
      return
    }
    if (resetID() === item.id) {
      setRunID(undefined)
      return
    }
    const run = live()
    if (run?.feedback_id === item.id) {
      if (runID() !== run.id) setRunID(run.id)
      return
    }
    if (!item.last_run_id) {
      setRunID(undefined)
      return
    }
    if (runID() && list().some((row) => row.id === runID())) return
    setRunID(last(item))
  })

  createEffect(() => {
    const off1 = sdk.event.on("autofix.queue.updated", () => void reload())
    const off2 = sdk.event.on("autofix.run.updated", () => void reload())
    const off3 = sdk.event.on("autofix.run.log", () => {
      if (runID() && !resetID()) void detailCtl.refetch()
    })
    const off4 = sdk.event.on("autofix.artifact.ready", () => void reload())
    onCleanup(() => {
      off1()
      off2()
      off3()
      off4()
    })
  })

  const act = async (name: string, fn: () => Promise<unknown>, snap = grab()) => {
    setBusy(name)
    await fn()
      .then(() => reload(snap))
      .catch((err: unknown) => {
        showToast({
          variant: "error",
          title: "AutoCodingFix 请求失败",
          description: err instanceof Error ? err.message : String(err),
        })
      })
    setBusy(undefined)
  }

  const sync = () =>
    act("sync", async () => {
      const result = await sdk.client.experimental.autofix.sync()
      const data = result.data
      if (!data) return
      showToast({
        title: "同步完成",
        description: `新增 ${data.imported} 条，更新 ${data.updated} 条，阻塞 ${data.blocked} 条。`,
      })
    })

  const pickModel = () => {
    const item = local.model.current()
    if (!item) return
    return {
      model: {
        providerID: item.provider.id,
        modelID: item.id,
      },
      variant: local.model.variant.current() ?? undefined,
    }
  }

  const openSession = (session: string) => {
    local.session.promote(sdk.directory, session)
    navigate(`/${base64Encode(sdk.directory)}/session/${session}`)
  }

  const startAll = () =>
    act("start", () =>
      sdk.client.experimental.autofix.start({
        autofixStartInput: pickModel(),
      }),
    )
  const stop = () => act("stop", () => sdk.client.experimental.autofix.stop())

  const saveShared = async (close?: boolean) => {
    setBusy("prompt")
    await sdk.client.experimental.autofix.prompt
      .set({
        autofixPromptInput: clone(shared()),
      })
      .then((result) => {
        const next = clone((result.data as AutofixSummary | undefined)?.state.prompt)
        batch(() => {
          summaryCtl.mutate(result.data as AutofixSummary | undefined)
          setSaved(clone(next))
          setShared(clone(next))
        })
        if (close) dialog.close()
        showToast({
          title: "已保存通用提示词模板",
          description: "后续新的 AutoCodingFix 提示词会直接使用你刚保存的模板。",
        })
      })
      .catch((err: unknown) => {
        showToast({
          variant: "error",
          title: "AutoCodingFix 请求失败",
          description: err instanceof Error ? err.message : String(err),
        })
      })
    setBusy(undefined)
  }

  function DialogPrompt() {
    return (
      <Dialog title="通用提示词模板" fit>
        <div class="flex max-h-[78vh] flex-col gap-3 overflow-y-auto pl-6 pr-2.5 pb-3">
          <div class="flex flex-wrap items-center gap-2 text-11-regular text-text-weak">
            <span class="rounded-full bg-surface-raised-base px-2 py-1">当前回显的是正在生效的提示词模板</span>
            <span>{dirty() ? "有未保存修改，新的执行仍会使用上一次已保存模板。" : "保存后立即生效，影响后续新的顺序执行、执行当前反馈、继续处理。"}</span>
          </div>

          <div class="grid gap-3 xl:grid-cols-2">
            <TextField
              label="分析阶段系统提示"
              multiline
              spellcheck={false}
              value={shared().analysis_system}
              onChange={(value) => setShared((item) => ({ ...item, analysis_system: value }))}
              class="min-h-[180px] max-h-[320px] w-full overflow-y-auto"
            />
            <TextField
              label="分析阶段用户模板"
              multiline
              spellcheck={false}
              value={shared().analysis_user}
              onChange={(value) => setShared((item) => ({ ...item, analysis_user: value }))}
              class="min-h-[220px] max-h-[360px] w-full overflow-y-auto"
            />
            <TextField
              label="修改阶段系统提示"
              multiline
              spellcheck={false}
              value={shared().build_system}
              onChange={(value) => setShared((item) => ({ ...item, build_system: value }))}
              class="min-h-[180px] max-h-[320px] w-full overflow-y-auto"
            />
            <TextField
              label="修改阶段用户模板"
              multiline
              spellcheck={false}
              value={shared().build_user}
              onChange={(value) => setShared((item) => ({ ...item, build_user: value }))}
              class="min-h-[260px] max-h-[420px] w-full overflow-y-auto"
            />
          </div>

          <div class="rounded-xl border border-border-weak-base bg-surface-raised-base px-3 py-2.5 text-11-regular text-text-weak">
            <div>这里编辑的是当前真正发给模型的公共提示词模板，不是额外附加说明。</div>
            <div class="mt-1">
              分析阶段可用占位符：
              <code>{"{{feedback}}"}</code>
              、
              <code>{"{{extra_block}}"}</code>
              。
            </div>
            <div class="mt-1">
              修改阶段可用占位符：
              <code>{"{{feedback_id}}"}</code>
              、
              <code>{"{{feedback}}"}</code>
              、
              <code>{"{{meta_block}}"}</code>
              、
              <code>{"{{attempt}}"}</code>
              、
              <code>{"{{plan_summary}}"}</code>
              、
              <code>{"{{plan_scope}}"}</code>
              、
              <code>{"{{plan_steps}}"}</code>
              、
              <code>{"{{plan_acceptance}}"}</code>
              、
              <code>{"{{plan_architecture_block}}"}</code>
              、
              <code>{"{{plan_methods_block}}"}</code>
              、
              <code>{"{{plan_flows_block}}"}</code>
              、
              <code>{"{{issue_block}}"}</code>
              、
              <code>{"{{extra_block}}"}</code>
              。
            </div>
            <div class="mt-1">当前已经发出的请求不会中途改写，保存后会用于下一次新的发送。</div>
          </div>

          <div class="flex justify-end gap-2">
            <Show when={dirty()}>
              <Button size="large" variant="ghost" disabled={busy() !== undefined} onClick={() => setShared(clone(saved()))}>
                恢复已保存
              </Button>
            </Show>
            <Button size="large" variant="ghost" disabled={busy() !== undefined} onClick={() => dialog.close()}>
              关闭
            </Button>
            <Button size="large" variant="primary" disabled={busy() !== undefined || !dirty()} onClick={() => void saveShared(true)}>
              保存
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }
  const startOne = () => {
    const item = picked()
    if (!item) return Promise.resolve()
    if (item.muted) {
      showToast({
        variant: "error",
        title: "当前反馈已屏蔽",
        description: `反馈 #${item.external_id} 需要先恢复后才能执行。`,
      })
      return Promise.resolve()
    }
    return act("one", () =>
      sdk.client.experimental.autofix.startFeedback({
        feedbackID: item.id,
        autofixStartInput: pickModel(),
      }),
    )
  }
  const resetOne = () => {
    const item = picked()
    if (!item) return Promise.resolve()
    const prev = runID()
    const snap = grab()
    setBusy("reset")
    setResetID(item.id)
    setRunID(undefined)
    detailCtl.mutate(undefined)
    feedbackCtl.mutate((list) => list?.map((row) => (row.id === item.id ? { ...row, last_run_id: undefined } : row)))
    runsCtl.mutate((list) => list?.filter((row) => row.feedback_id !== item.id))
    return sdk.client.experimental.autofix
      .resetFeedback({ feedbackID: item.id })
      .then(async () => {
        await reload(snap)
        showToast({
          title: "已清除当前反馈记录",
          description: `反馈 #${item.external_id} 的执行记录和状态已重置。`,
        })
      })
      .catch((err: unknown) => {
        setRunID(prev)
        showToast({
          variant: "error",
          title: "AutoCodingFix 请求失败",
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => {
        setResetID(undefined)
        setBusy(undefined)
      })
  }

  const canContinue = (status?: string) => ["blocked", "failed", "stopped"].includes(status ?? "")

  const muteOne = (item: AutofixFeedback) =>
    act(`mute:${item.id}`, async () => {
      await sdk.client.experimental.autofix.muteFeedback({ feedbackID: item.id })
      showToast({
        title: "已屏蔽反馈",
        description: `反馈 #${item.external_id} 不会再参与顺序执行。`,
      })
    })

  const unmuteOne = (item: AutofixFeedback) =>
    act(`unmute:${item.id}`, async () => {
      await sdk.client.experimental.autofix.unmuteFeedback({ feedbackID: item.id })
      showToast({
        title: "已恢复反馈",
        description: `反馈 #${item.external_id} 已恢复为可执行状态。`,
      })
    })

  const deleteOne = (item: AutofixFeedback) => {
    const snap = grab()
    if (feedbackID() === item.id) {
      setFeedbackID(undefined)
      setRunID(undefined)
      detailCtl.mutate(undefined)
    }
    return act(`delete:${item.id}`, async () => {
      await sdk.client.experimental.autofix.deleteFeedback({ feedbackID: item.id })
      showToast({
        title: "已删除反馈",
        description: `反馈 #${item.external_id} 及其本地执行记录已移除。`,
      })
    }, snap)
  }

  function DialogImport() {
    const [body, setBody] = createSignal("")
    let input: HTMLInputElement | undefined

    const pick = () => input?.click()
    const fill = async (event: Event) => {
      const node = event.currentTarget instanceof HTMLInputElement ? event.currentTarget : undefined
      const file = node?.files?.[0]
      if (!file) return
      setBody(await file.text())
      if (node) node.value = ""
    }

    const submit = async () => {
      const data = (() => {
        try {
          return parse(body())
        } catch (err) {
          showToast({
            variant: "error",
            title: "导入数据无效",
            description: err instanceof Error ? err.message : String(err),
          })
        }
      })()
      if (!data) return
      setBusy("import")
      await sdk.client.experimental.autofix
        .importFeedback({ autofixImportInput: data })
        .then(async (result) => {
          dialog.close()
          await reload()
          showToast({
            title: "导入完成",
            description: `新增 ${result.data?.imported ?? 0} 条，更新 ${result.data?.updated ?? 0} 条，阻塞 ${result.data?.blocked ?? 0} 条。`,
          })
        })
        .catch((err: unknown) => {
          showToast({
            variant: "error",
            title: "AutoCodingFix 请求失败",
            description: err instanceof Error ? err.message : String(err),
          })
        })
      setBusy(undefined)
    }

    return (
      <Dialog
        title="导入本地反馈"
        size="x-large"
        class="w-full max-w-[860px] mx-auto [&_[data-slot=dialog-body]]:overflow-visible"
      >
        <div class="flex max-h-[calc(100vh-168px)] min-h-0 flex-col gap-4 overflow-y-auto p-6 pt-0 pr-5">
          <div class="rounded-xl border border-border-weak-base bg-surface-raised-base px-4 py-3">
            <div class="text-13-medium text-text-strong">导入说明</div>
            <div class="mt-2 text-12-regular text-text-weak whitespace-pre-wrap break-words">
              导入数据会直接写入当前目录的 AutoCodingFix 反馈镜像表，左侧列表、执行、重置、历史记录都会继续走现有逻辑。
              本地导入只会写入你当前粘贴或选择的 JSON 数据，不会额外同步数据库反馈；如果要拉数据库数据，请单独点击上方“同步全部反馈”。
              最简单可以直接导入 JSON 数组。`external_id` 必填，`recognized_text` 建议填写；`created_at`、`source`、
              `feedback_token`、`device_id`、`recognize_success` 等字段都可以省略，系统会自动补默认值。
            </div>
          </div>

          <input
            ref={(el) => {
              input = el
            }}
            type="file"
            accept=".json,application/json"
            class="hidden"
            onChange={(event) => void fill(event)}
          />

          <div class="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="small" disabled={busy() !== undefined} onClick={pick}>
              选择 JSON 文件
            </Button>
            <Button type="button" variant="ghost" size="small" disabled={busy() !== undefined} onClick={() => setBody(sample)}>
              填入模板
            </Button>
            <div class="text-11-regular text-text-weak">最小推荐只填 `external_id` 和 `recognized_text`。</div>
          </div>

          <TextField
            label="反馈 JSON"
            multiline
            spellcheck={false}
            value={body()}
            onChange={setBody}
            placeholder='可直接粘贴 JSON。最简单格式是 [{"external_id":10001,"recognized_text":"反馈内容"}]。'
            class="min-h-[260px] max-h-[360px] w-full overflow-y-auto font-mono text-xs"
          />

          <div class="rounded-xl border border-border-weak-base bg-surface-base px-4 py-3">
            <div class="flex items-center gap-2">
              <div class="text-12-medium text-text-strong">模板示例</div>
              <div class="text-11-regular text-text-weak">可直接点击上方“填入模板”后修改</div>
            </div>
            <pre class="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-surface-raised-base p-3 text-[11px] leading-5 text-text-base">
              {sample}
            </pre>
          </div>

          <div class="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="large" disabled={busy() !== undefined} onClick={() => dialog.close()}>
              取消
            </Button>
            <Button type="button" variant="primary" size="large" disabled={busy() !== undefined} onClick={() => void submit()}>
              导入反馈
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  function DialogContinue(props: { run: AutofixRun }) {
    const [prompt, setPrompt] = createSignal("")

    const submit = async () => {
      setBusy("continue")
      await sdk.client.experimental.autofix.run
        .continue({
          runID: props.run.id,
          autofixContinueInput: {
            prompt: prompt().trim() || undefined,
          },
        })
        .then(async (result) => {
          const snap = grab()
          const next = result.data
          dialog.close()
          if (next?.id) {
            setRunID(next.id)
            detailCtl.mutate(undefined)
          }
          await reload(snap)
          showToast({
            title: "已继续当前记录",
            description: prompt().trim() ? "已追加提示词并开始新的自动修复。" : "已基于当前记录开始新的自动修复。",
          })
        })
        .catch((err: unknown) => {
          showToast({
            variant: "error",
            title: "AutoCodingFix 请求失败",
            description: err instanceof Error ? err.message : String(err),
          })
        })
      setBusy(undefined)
    }

    return (
      <Dialog title={`继续反馈 #${picked()?.external_id ?? ""}`} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">可选：补充一段提示，帮助模型继续生成计划或继续修改。</span>
            <span class="text-12-regular text-text-weak">留空则直接基于当前记录继续。系统会新建一条 run，原记录保留。</span>
          </div>
          <TextField
            label="补充提示"
            multiline
            autofocus
            value={prompt()}
            onChange={setPrompt}
            placeholder="例如：默认只改主界面，其他入口保持不动；优先最小改动；不要影响现有统计链路。"
          />
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" disabled={busy() !== undefined} onClick={() => dialog.close()}>
              取消
            </Button>
            <Button variant="primary" size="large" disabled={busy() !== undefined} onClick={() => void submit()}>
              继续处理
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  return (
    <div class="size-full overflow-hidden bg-background-base">
      <div class="size-full max-w-[1720px] mx-auto px-3 py-3 flex flex-col gap-3 min-h-0">
        <Card
          title="AutoCodingFix"
          class="shrink-0"
          body="p-2.5"
          action={
            <div class="flex items-center gap-2">
              <Button size="small" variant="secondary" disabled={busy() !== undefined} onClick={sync}>
                同步全部反馈
              </Button>
              <Button
                size="small"
                variant="secondary"
                disabled={busy() !== undefined}
                onClick={() => dialog.show(() => <DialogImport />)}
              >
                导入本地反馈
              </Button>
              <Button size="small" variant="secondary" disabled={busy() !== undefined} onClick={() => dialog.show(() => <DialogPrompt />)}>
                {dirty() ? "通用提示词*" : "通用提示词"}
              </Button>
              <Show
                when={summary()?.state.status === "running" || summary()?.state.status === "stopping"}
                fallback={
                  <Button size="small" disabled={busy() !== undefined} onClick={startAll}>
                    顺序执行全部
                  </Button>
                }
              >
                <Button size="small" variant="secondary" disabled={busy() !== undefined} onClick={stop}>
                  停止执行
                </Button>
              </Show>
            </div>
          }
        >
          <Show when={summary()} fallback={<div class="text-13-regular text-text-weak">正在加载状态...</div>}>
            {(sum) => (
              <Show when={sum().state.supported} fallback={<div class="text-13-regular text-text-weak">当前目录暂不支持 AutoCodingFix。</div>}>
                <div class="grid grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)] gap-2.5 max-xl:grid-cols-1">
                  <div class="rounded-xl border border-border-weak-base bg-[linear-gradient(135deg,rgba(14,165,233,0.10),rgba(255,255,255,0))] px-3 py-2.5">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class={`inline-flex items-center rounded-full px-2.5 py-1 text-11-medium ${pill(sum().state.status)}`}>
                        {label(sum().state.status)}
                      </span>
                      <span class="text-11-regular text-text-weak">分支：{sum().state.branch ?? "未知"}</span>
                      <span class="text-11-regular text-text-weak">同步：{stamp(sum().state.last_sync_at)}</span>
                    </div>
                    <div class="mt-2.5 flex items-center gap-3">
                      <div class="text-20-semibold text-text-strong leading-none">{pct()}%</div>
                      <div class="text-11-regular text-text-weak">
                        已处理 {done()} / {total() || 0}
                      </div>
                    </div>
                    <div class="mt-2 h-1.5 rounded-full bg-surface-raised-base overflow-hidden">
                      <div
                        class="h-full rounded-full bg-[linear-gradient(90deg,#0ea5e9,#22c55e)] transition-[width] duration-300"
                        style={{ width: `${pct()}%` }}
                      />
                    </div>
                    <div class="mt-2.5 flex flex-wrap gap-1.5">
                      <span class="rounded-full bg-surface-raised-base px-2 py-1 text-11-regular text-text-base">
                        待处理 {sum().state.counts.queued}
                      </span>
                      <span class="rounded-full bg-surface-raised-base px-2 py-1 text-11-regular text-text-base">
                        执行中 {sum().state.counts.running}
                      </span>
                      <span class="rounded-full bg-surface-raised-base px-2 py-1 text-11-regular text-text-base">
                        已完成 {sum().state.counts.done}
                      </span>
                      <span class="rounded-full bg-surface-raised-base px-2 py-1 text-11-regular text-text-base">
                        已失败 {sum().state.counts.failed}
                      </span>
                      <span class="rounded-full bg-surface-raised-base px-2 py-1 text-11-regular text-text-base">
                        已屏蔽 {sum().state.counts.muted}
                      </span>
                      <span class="rounded-full bg-surface-raised-base px-2 py-1 text-11-regular text-text-base">
                        已阻塞 {sum().state.counts.blocked}
                      </span>
                    </div>
                  </div>

                  <div class="rounded-xl border border-border-weak-base bg-surface-raised-base px-3 py-2.5">
                    <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">当前执行</div>
                    <Show when={liveItem()} fallback={<div class="mt-1.5 text-12-regular text-text-weak">当前没有正在执行的反馈。</div>}>
                      {(item) => (
                        <div class="mt-1.5 flex flex-col gap-1.5">
                          <div class="flex items-center gap-1.5">
                            <div class="text-13-medium text-text-strong">反馈 #{item().external_id}</div>
                            <span class={`inline-flex items-center rounded-full px-2 py-0.5 text-11-medium ${pill(live()?.status)}`}>
                              {label(live()?.status)}
                            </span>
                          </div>
                          <div class="text-12-regular text-text-base whitespace-pre-wrap break-words line-clamp-2">
                            {text(item())}
                          </div>
                          <div class="flex flex-wrap gap-2.5 text-11-regular text-text-weak">
                            <span>{stamp(item().created_at)}</span>
                            <span>{item().app_version || "暂无版本"}</span>
                          </div>
                        </div>
                      )}
                    </Show>
                  </div>
                </div>
              </Show>
            )}
          </Show>
        </Card>

        <div class="min-h-0 flex-1 grid grid-cols-[300px_minmax(0,1fr)] gap-3 max-xl:grid-cols-1">
          <Card
            title="反馈列表"
            class="h-full"
            body="p-2 min-h-0 flex flex-col"
            action={
              <div class="flex items-center gap-2">
                <Select
                  options={[...filters]}
                  current={filters.find((item) => item.value === filter())}
                  value={(item) => item.value}
                  label={(item) => item.label}
                  onSelect={(item) => setFilter(item?.value ?? "all")}
                  variant="ghost"
                  size="small"
                  class="min-w-[120px]"
                  valueClass="text-11-regular text-text-base"
                />
                <div class="text-11-regular text-text-weak">
                  {rows().length}
                  <Show when={rows().length !== items().length}> / {items().length}</Show>
                  条
                </div>
              </div>
            }
          >
            <div
              ref={listRef}
              class="min-h-0 overflow-y-auto pr-1 flex flex-col gap-2"
            >
              <For each={rows()}>
                {(item) => {
                  const sel = () => pickedRow(item.id)
                  const run = () => liveRow(item.id)
                  return (
                    <div
                      class="w-full rounded-xl border px-2.5 py-2.5 text-left transition-colors"
                      classList={{
                        "border-sky-500 bg-sky-500/18 text-sky-950 dark:text-sky-50 shadow-sm ring-1 ring-sky-500/35": sel() && run(),
                        "border-sky-500/60 bg-sky-500/12 text-text-strong shadow-sm ring-1 ring-sky-500/20": sel() && !run(),
                        "border-amber-500/50 bg-amber-500/12": !sel() && run(),
                        "border-border-weak-base bg-surface-base hover:bg-surface-base-hover": !sel() && !run(),
                      }}
                    >
                      <div class="flex gap-2">
                        <button
                          type="button"
                          class="min-w-0 flex-1 text-left"
                          onClick={() => pickOne(item)}
                        >
                          <div class="flex items-center gap-2">
                            <span class={`inline-flex items-center rounded-full px-2 py-0.5 text-11-medium ${pill(view(item))}`}>
                              {label(view(item))}
                            </span>
                            <Show when={run()}>
                              <span class="inline-flex items-center rounded-full px-2 py-0.5 text-11-medium border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                                当前执行
                              </span>
                            </Show>
                            <span class={`text-11-medium ${sel() ? "text-current" : "text-text-weak"}`}>#{item.external_id}</span>
                            <div class="grow" />
                            <span class={`text-11-regular ${sel() ? "text-current/80" : "text-text-weak"}`}>{stamp(item.created_at)}</span>
                          </div>

                          <div
                            class={`mt-2 text-12-regular whitespace-pre-wrap break-words line-clamp-3 ${sel() ? "text-current" : "text-text-base"}`}
                          >
                            {text(item)}
                          </div>

                          <div class={`mt-2 flex flex-wrap gap-3 text-11-regular ${sel() ? "text-current/80" : "text-text-weak"}`}>
                            <span>{item.app_version || "暂无版本"}</span>
                            <span>{item.language || "暂无语言"}</span>
                            <span>{item.device_id || "暂无设备"}</span>
                          </div>
                        </button>

                        <div class="shrink-0 flex flex-col items-stretch gap-1">
                          <Show
                            when={item.muted}
                            fallback={
                              <Button
                                type="button"
                                size="small"
                                variant="ghost"
                                icon="shield"
                                disabled={busy() !== undefined || run() || work(item.status)}
                                onClick={() => void muteOne(item)}
                              >
                                屏蔽
                              </Button>
                            }
                          >
                            <Button
                              type="button"
                              size="small"
                              variant="ghost"
                              icon="reset"
                              disabled={busy() !== undefined || run() || work(item.status)}
                              onClick={() => void unmuteOne(item)}
                            >
                              恢复
                            </Button>
                          </Show>
                          <Button
                            type="button"
                            size="small"
                            variant="ghost"
                            icon="trash"
                            disabled={busy() !== undefined || run() || work(item.status)}
                            onClick={() => void deleteOne(item)}
                          >
                            删除
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                }}
              </For>

              <Show when={rows().length === 0}>
                <div class="rounded-xl border border-dashed border-border-weak-base px-4 py-6 text-12-regular text-text-weak">
                  {items().length === 0 ? "暂无反馈，点击上方“同步全部反馈”或“导入本地反馈”后这里会展示完整列表。" : "当前筛选条件下暂无反馈，试试切换为“全部状态”。"}
                </div>
              </Show>
            </div>
          </Card>

          <Card
            title={picked() ? `反馈 #${picked()?.external_id}` : "执行记录"}
            class="h-full"
            body="p-0 min-h-0 flex flex-col"
            action={
              <Show when={picked()}>
                <div class="flex items-center gap-2">
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={busy() !== undefined || summary()?.state.status === "running" || summary()?.state.status === "stopping"}
                    onClick={() => void resetOne()}
                  >
                    清除当前记录
                  </Button>
                  <Show
                    when={picked()?.muted}
                    fallback={
                      <Button
                        size="small"
                        disabled={busy() !== undefined || summary()?.state.status === "running" || summary()?.state.status === "stopping"}
                        onClick={() => void startOne()}
                      >
                        执行当前反馈
                      </Button>
                    }
                  >
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={busy() !== undefined || summary()?.state.status === "running" || summary()?.state.status === "stopping"}
                      onClick={() => {
                        const item = picked()
                        if (!item) return
                        void unmuteOne(item)
                      }}
                    >
                      恢复执行
                    </Button>
                  </Show>
                </div>
              </Show>
            }
          >
            <Show when={picked()} fallback={<div class="p-4 text-13-regular text-text-weak">请先从左侧选择一条反馈。</div>}>
              {(item) => (
                <div class="min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class={`inline-flex items-center rounded-full px-2.5 py-1 text-11-medium ${pill(view(item()))}`}>
                      {label(view(item()))}
                    </span>
                    <Show when={summary()?.active_run?.feedback_id === item().id}>
                      <span class="inline-flex items-center rounded-full px-2.5 py-1 text-11-medium border border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300">
                        当前执行
                      </span>
                    </Show>
                    <span class="text-11-regular text-text-weak">{stamp(item().created_at)}</span>
                    <span class="text-11-regular text-text-weak">{item().app_version || "暂无版本"}</span>
                    <span class="text-11-regular text-text-weak">{item().language || "暂无语言"}</span>
                  </div>

                  <Collapsible
                    open={infoOpen()}
                    onOpenChange={setInfoOpen}
                    class="rounded-xl border border-border-weak-base bg-surface-raised-base"
                  >
                    <Collapsible.Trigger class="flex w-full items-center gap-3 px-3 py-3 text-left">
                      <div class="min-w-0">
                        <div class="text-12-medium text-text-strong">反馈详情</div>
                        <div class="mt-1 text-11-regular text-text-weak">反馈内容、基础信息和补充说明</div>
                      </div>
                      <div class="grow" />
                      <Collapsible.Arrow class="text-text-weak" />
                    </Collapsible.Trigger>
                    <Collapsible.Content class="border-t border-border-weak-base px-3 py-3">
                      <div class="grid grid-cols-[minmax(0,1.8fr)_minmax(220px,1fr)] gap-3 max-2xl:grid-cols-1">
                        <div class="rounded-xl border border-border-weak-base bg-surface-base px-3 py-3">
                          <div class="text-11-medium text-text-weak">反馈内容</div>
                          <div class="mt-2 text-13-regular text-text-base whitespace-pre-wrap break-words">{text(item())}</div>
                        </div>

                        <div class="rounded-xl border border-border-weak-base bg-surface-base px-3 py-3">
                          <div class="text-11-medium text-text-weak">基础信息</div>
                          <div class="mt-3 grid grid-cols-1 gap-2">
                            <Info name="反馈编号" value={`#${item().external_id}`} />
                            <Info name="创建时间" value={stamp(item().created_at)} />
                            <Info name="应用版本" value={item().app_version} />
                            <Info name="反馈语言" value={item().language} />
                            <Info name="设备标识" value={item().device_id} />
                          </div>
                        </div>
                      </div>

                      <Show when={note()}>
                        <div class="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3">
                          <div class="text-11-medium text-amber-700 dark:text-amber-300">补充说明</div>
                          <div class="mt-2 text-12-regular text-amber-700 dark:text-amber-300 whitespace-pre-wrap break-words">
                            {note()}
                          </div>
                        </div>
                      </Show>
                    </Collapsible.Content>
                  </Collapsible>

                  <div class="rounded-xl border border-border-weak-base bg-surface-raised-base px-3 py-3">
                    <div class="flex items-center gap-2">
                      <div class="text-12-medium text-text-strong">执行记录</div>
                      <div class="text-11-regular text-text-weak">{list().length} 条</div>
                    </div>
                    <Show
                      when={list().length > 0}
                      fallback={
                        <div class="mt-3 rounded-xl border border-dashed border-border-weak-base px-4 py-5 text-12-regular text-text-weak">
                          这条反馈还没有执行记录。
                        </div>
                      }
                    >
                      <div class="mt-3 flex flex-wrap gap-2">
                        <For each={list()}>
                          {(row) => (
                            <button
                              type="button"
                              class="rounded-xl border px-3 py-2 text-left transition-colors"
                              classList={{
                                "border-sky-500/60 bg-sky-500/12 shadow-sm": runID() === row.id,
                                "border-border-weak-base bg-surface-base hover:bg-surface-base-hover": runID() !== row.id,
                              }}
                              onClick={() => {
                                setRunID(row.id)
                                detailCtl.mutate(undefined)
                              }}
                            >
                              <div class={`text-11-medium ${ink(row.status)}`}>{label(row.status)}</div>
                              <div class="mt-1 text-11-regular text-text-weak">{stamp(row.time_created)}</div>
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>

                  <Show
                    when={detail()}
                    fallback={
                      <Show when={list().length > 0}>
                        <div class="rounded-xl border border-dashed border-border-weak-base px-4 py-5 text-12-regular text-text-weak">
                          请选择一条执行记录查看计划、尝试记录和日志。
                        </div>
                      </Show>
                    }
                  >
                    {(info) => (
                      <div class="flex flex-col gap-3">
                        <div class="rounded-xl border border-border-weak-base bg-surface-raised-base px-3 py-3">
                          <div class="flex flex-wrap items-center gap-3">
                            <span class={`inline-flex items-center rounded-full px-2.5 py-1 text-11-medium ${pill(info().run.status)}`}>
                              {label(info().run.status)}
                            </span>
                            <span class="text-11-regular text-text-weak">版本 {info().run.version ?? "暂无"}</span>
                            <span class="text-11-regular text-text-weak">提交 {info().run.commit_hash ?? "暂无"}</span>
                            <div class="grow" />
                            <Show when={info().run.session_id}>
                              <Button
                                size="small"
                                variant="secondary"
                                onClick={() => openSession(info().run.session_id!)}
                              >
                                打开会话
                              </Button>
                            </Show>
                          </div>
                          <div class="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                            <Info name="开始时间" value={stamp(info().run.time_created)} />
                            <Info name="结束时间" value={stamp(info().run.time_finished)} />
                            <Info name="基线提交" value={info().run.base_commit} />
                          </div>
                          <Show when={canContinue(info().run.status)}>
                            <div class="mt-3">
                              <Button
                                size="small"
                                variant="secondary"
                                disabled={busy() !== undefined}
                                onClick={() => dialog.show(() => <DialogContinue run={info().run} />)}
                              >
                                继续处理
                              </Button>
                            </div>
                          </Show>
                        </div>

                        <Show when={info().run.failure_reason}>
                          <div class="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-3">
                            <div class="text-12-medium text-rose-700 dark:text-rose-300">失败原因</div>
                            <div class="mt-2 text-12-regular text-rose-700 dark:text-rose-300 whitespace-pre-wrap break-words">
                              {info().run.failure_reason}
                            </div>
                          </div>
                        </Show>

                        <Show when={info().run.plan}>
                          {(plan) => (
                            <div class="rounded-xl border border-border-weak-base bg-surface-raised-base px-3 py-3">
                              <div class="text-12-medium text-text-strong">修复计划</div>
                              <div class="mt-2 text-12-regular text-text-base whitespace-pre-wrap break-words">{plan().summary}</div>

                              <Show when={plan().scope.length > 0}>
                                <div class="mt-4">
                                  <div class="text-11-medium text-text-weak">影响范围</div>
                                  <div class="mt-2 flex flex-col gap-2">
                                    <For each={plan().scope}>
                                      {(item) => (
                                        <div class="flex gap-2 text-12-regular text-text-base">
                                          <span class="text-text-weak">-</span>
                                          <span class="min-w-0 whitespace-pre-wrap break-words">{item}</span>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </div>
                              </Show>

                              <Show when={plan().steps.length > 0}>
                                <div class="mt-4">
                                  <div class="text-11-medium text-text-weak">执行步骤</div>
                                  <div class="mt-2 flex flex-col gap-2">
                                    <For each={plan().steps}>
                                      {(step, index) => (
                                        <div class="flex gap-2 text-12-regular text-text-base">
                                          <span class="text-text-weak">{index() + 1}.</span>
                                          <span class="min-w-0 whitespace-pre-wrap break-words">{step}</span>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </div>
                              </Show>

                              <Show when={plan().acceptance.length > 0}>
                                <div class="mt-4">
                                  <div class="text-11-medium text-text-weak">验收标准</div>
                                  <div class="mt-2 flex flex-col gap-2">
                                    <For each={plan().acceptance}>
                                      {(item) => (
                                        <div class="flex gap-2 text-12-regular text-text-base">
                                          <span class="text-text-weak">-</span>
                                          <span class="min-w-0 whitespace-pre-wrap break-words">{item}</span>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </div>
                              </Show>

                              <Show when={plan().architecture.length > 0}>
                                <div class="mt-4">
                                  <div class="text-11-medium text-text-weak">关键架构</div>
                                  <div class="mt-2 flex flex-col gap-2">
                                    <For each={plan().architecture}>
                                      {(item) => (
                                        <div class="rounded-xl border border-border-weak-base px-3 py-3">
                                          <div class="text-12-medium text-text-strong whitespace-pre-wrap break-words">{item.name}</div>
                                          <Show when={item.files.length > 0}>
                                            <div class="mt-1 text-11-regular text-text-weak whitespace-pre-wrap break-words">
                                              相关文件：{item.files.join("，")}
                                            </div>
                                          </Show>
                                          <div class="mt-2 text-12-regular text-text-base whitespace-pre-wrap break-words">{item.logic}</div>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </div>
                              </Show>

                              <Show when={plan().methods.length > 0}>
                                <div class="mt-4">
                                  <div class="text-11-medium text-text-weak">关键方法与注释</div>
                                  <div class="mt-2 flex flex-col gap-2">
                                    <For each={plan().methods}>
                                      {(item) => (
                                        <div class="rounded-xl border border-border-weak-base px-3 py-3">
                                          <div class="flex flex-wrap items-center gap-2">
                                            <div class="text-12-medium text-text-strong whitespace-pre-wrap break-words">{item.name}</div>
                                            <span class="text-11-regular text-text-weak whitespace-pre-wrap break-words">{item.file}</span>
                                          </div>
                                          <div class="mt-2 text-11-regular text-text-weak whitespace-pre-wrap break-words">
                                            注释：{item.comment}
                                          </div>
                                          <div class="mt-2 text-12-regular text-text-base whitespace-pre-wrap break-words">{item.logic}</div>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </div>
                              </Show>

                              <Show when={plan().flows.length > 0}>
                                <div class="mt-4">
                                  <div class="text-11-medium text-text-weak">相关功能与逻辑</div>
                                  <div class="mt-2 flex flex-col gap-2">
                                    <For each={plan().flows}>
                                      {(item) => (
                                        <div class="flex gap-2 text-12-regular text-text-base">
                                          <span class="text-text-weak">-</span>
                                          <span class="min-w-0 whitespace-pre-wrap break-words">{item}</span>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </div>
                              </Show>

                              <Show when={(plan().blockers?.length ?? 0) > 0}>
                                <div class="mt-4">
                                  <div class="text-11-medium text-amber-700 dark:text-amber-300">阻塞项</div>
                                  <div class="mt-2 flex flex-col gap-2">
                                    <For each={plan().blockers ?? []}>
                                      {(item) => (
                                        <div class="flex gap-2 text-12-regular text-amber-700 dark:text-amber-300">
                                          <span>•</span>
                                          <span class="min-w-0 whitespace-pre-wrap break-words">{item}</span>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </div>
                              </Show>
                            </div>
                          )}
                        </Show>

                        <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
                          <div class="rounded-xl border border-border-weak-base bg-surface-raised-base px-3 py-3">
                            <div class="text-12-medium text-text-strong">尝试记录</div>
                            <div class="mt-3 flex flex-col gap-2">
                              <For each={info().attempts}>
                                {(row) => (
                                  <div class="rounded-xl border border-border-weak-base px-3 py-3">
                                    <div class="flex items-center gap-2">
                                      <span class={`inline-flex items-center rounded-full px-2 py-0.5 text-11-medium ${pill(row.status)}`}>
                                        {label(row.status)}
                                      </span>
                                      <span class="text-11-regular text-text-weak">第 {row.attempt} 次</span>
                                    </div>
                                    <Show when={row.summary}>
                                      <div class="mt-2 text-12-regular text-text-base">{row.summary}</div>
                                    </Show>
                                    <Show when={row.files?.length}>
                                      <div class="mt-2 text-11-regular text-text-weak break-words">
                                        修改文件：{row.files?.join("，")}
                                      </div>
                                    </Show>
                                    <Show when={row.error}>
                                      <div class="mt-2 text-11-regular text-rose-700 dark:text-rose-300 whitespace-pre-wrap break-words">
                                        {row.error}
                                      </div>
                                    </Show>
                                  </div>
                                )}
                              </For>
                              <Show when={(info().attempts.length ?? 0) === 0}>
                                <div class="rounded-xl border border-dashed border-border-weak-base px-3 py-4 text-11-regular text-text-weak">
                                  暂无尝试记录。
                                </div>
                              </Show>
                            </div>
                          </div>

                          <div class="rounded-xl border border-border-weak-base bg-surface-raised-base px-3 py-3">
                            <div class="text-12-medium text-text-strong">产物</div>
                            <div class="mt-3 flex flex-col gap-2">
                              <For each={info().artifacts}>
                                {(row) => (
                                  <div class="rounded-xl border border-border-weak-base px-3 py-3">
                                    <div class="text-12-medium text-text-strong">{artifactText[row.kind] ?? row.kind}</div>
                                    <div class="mt-1 text-11-regular text-text-weak break-all">{row.path}</div>
                                    <Show when={row.sha256}>
                                      <div class="mt-1 text-11-regular text-text-weak break-all">{row.sha256}</div>
                                    </Show>
                                  </div>
                                )}
                              </For>
                              <Show when={(info().artifacts.length ?? 0) === 0}>
                                <div class="rounded-xl border border-dashed border-border-weak-base px-3 py-4 text-11-regular text-text-weak">
                                  暂无产物记录。
                                </div>
                              </Show>
                            </div>
                          </div>
                        </div>

                        <div class="rounded-xl border border-border-weak-base bg-surface-raised-base px-3 py-3">
                          <div class="text-12-medium text-text-strong">事件日志</div>
                          <div class="mt-3 flex flex-col gap-2">
                            <For each={info().events}>
                              {(row) => (
                                <div class="rounded-xl border border-border-weak-base px-3 py-3">
                                  <div class="flex flex-wrap items-center gap-2">
                                    <span class={`inline-flex items-center rounded-full px-2 py-0.5 text-11-medium ${pill(row.level)}`}>
                                      {label(row.level)}
                                    </span>
                                    <span class="text-11-medium text-text-strong">{row.phase}</span>
                                    <div class="grow" />
                                    <span class="text-11-regular text-text-weak">{stamp(row.time_created)}</span>
                                  </div>
                                  <div class="mt-2 text-12-regular text-text-base whitespace-pre-wrap break-words">
                                    {row.message}
                                  </div>
                                </div>
                              )}
                            </For>
                            <Show when={(info().events.length ?? 0) === 0}>
                              <div class="rounded-xl border border-dashed border-border-weak-base px-3 py-4 text-11-regular text-text-weak">
                                暂无事件日志。
                              </div>
                            </Show>
                          </div>
                        </div>
                      </div>
                    )}
                  </Show>
                </div>
              )}
            </Show>
          </Card>
        </div>
      </div>
    </div>
  )
}
