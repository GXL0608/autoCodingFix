import { $ } from "bun"
import path from "path"
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { AutofixAnalyzer } from "../../src/autofix/analysis"
import { AutofixConfig } from "../../src/autofix/config"
import { AutofixHarness } from "../../src/autofix/harness"
import { AutofixQueue } from "../../src/autofix/queue"
import { AutofixRunner } from "../../src/autofix/runner"
import { AutofixSchema } from "../../src/autofix/schema"
import { Project } from "../../src/project/project"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import type { PulledFeedback, ResolvedTarget } from "../../src/autofix/types"

Log.init({ print: false })

let cfg: ReturnType<typeof spyOn> | undefined
let analyze: ReturnType<typeof spyOn> | undefined
let survey: ReturnType<typeof spyOn> | undefined

afterEach(async () => {
  cfg?.mockRestore()
  analyze?.mockRestore()
  survey?.mockRestore()
  cfg = undefined
  analyze = undefined
  survey = undefined
  await resetDatabase()
})

function target(project_id: string, directory: string) {
  return {
    directory,
    worktree: directory,
    project_id,
    profile: "cell",
    remotes: [],
    source: {
      kind: "postgres",
      dsn: "",
      dsn_env: "",
      table: "",
      sync_batch: 100,
    },
    feedback: {
      use_audio_when_text_missing: false,
      max_audio_bytes: 8 * 1024 * 1024,
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
      format: "{base}-af.{seq}.{feedbackId}",
    },
  } satisfies ResolvedTarget
}

function item(id: number) {
  return {
    external_id: id,
    created_at: Date.now(),
    source: "manual_import",
    feedback_token: `manual-${id}`,
    device_id: "local-import",
    has_audio: false,
    recognized_text: "设置页切换语言后，文案没有立即刷新。",
    recognize_success: true,
  } satisfies PulledFeedback
}

async function wait(fn: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return
    await Bun.sleep(10)
  }
  throw new Error("timed out waiting for autofix runner")
}

describe("autofix.runner", () => {
  test("passes selected model to analyze when starting a single feedback run", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "package.json"),
          JSON.stringify({
            version: "1.0.0",
            scripts: {
              "desktop:webview": "echo ok",
            },
          }),
        )
        await Bun.write(path.join(dir, "build-mac-arm64-dmg.sh"), "#!/bin/sh\nexit 0\n")
        await $`git add package.json build-mac-arm64-dmg.sh`.cwd(dir).quiet()
        await $`git commit -m "fixture"`.cwd(dir).quiet()
      },
    })

    const { project } = await Project.fromDirectory(tmp.path)
    const next = target(project.id, tmp.path)
    const pick = AutofixSchema.start_input.parse({
      model: {
        providerID: "openai",
        modelID: "gpt-5.2",
      },
      variant: "high",
    })
    let seen: AutofixSchema.StartInput | undefined

    cfg = spyOn(AutofixConfig, "resolveForDirectory").mockResolvedValue(next)
    analyze = spyOn(AutofixAnalyzer, "analyze").mockImplementation(async (_run, _audio, _extra, _prompt, input) => {
      seen = input
      return {
        summary: "需要人工处理",
        scope: ["设置页"],
        steps: ["确认范围"],
        acceptance: ["范围明确"],
        architecture: [],
        methods: [],
        flows: [],
        automatable: false,
        blockers: ["需要人工确认"],
      }
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await AutofixQueue.importFeedback(next, [item(1)])
        const row = (await AutofixQueue.listFeedback(project.id, tmp.path))[0]
        if (!row) throw new Error("expected imported feedback")

        await AutofixRunner.startFeedback(tmp.path, row.id, pick)
        await wait(async () => {
          const runs = await AutofixQueue.listRuns(project.id, tmp.path)
          return runs.some((item) => ["blocked", "failed", "done", "stopped"].includes(item.status))
        })

        expect(seen).toEqual(pick)
      },
    })
  })

  test("rejects feedback and runs from another project", async () => {
    await using one = await tmpdir({ git: true })
    await using two = await tmpdir({ git: true })

    const { project } = await Project.fromDirectory(one.path)
    const left = target(project.id, one.path)
    const right = target(project.id, two.path)

    cfg = spyOn(AutofixConfig, "resolveForDirectory").mockImplementation(async (dir) => {
      if (dir === one.path) return left
      if (dir === two.path) return right
      return null
    })

    await AutofixQueue.importFeedback(right, [item(9)])
    const row = (await AutofixQueue.listFeedback(project.id, two.path))[0]
    if (!row) throw new Error("expected imported feedback")

    const run = await AutofixQueue.createRun({
      project_id: project.id,
      directory: two.path,
      feedback_id: row.id,
      status: "failed",
    })

    await Instance.provide({
      directory: one.path,
      fn: async () => {
        await expect(AutofixRunner.startFeedback(one.path, row.id)).rejects.toThrow("Autofix feedback not found")
        await expect(AutofixRunner.continueRun(one.path, run.id)).rejects.toThrow("Autofix run not found")
      },
    })

    expect(await AutofixQueue.listRuns(project.id, one.path)).toHaveLength(0)
    expect(await AutofixQueue.listRuns(project.id, two.path)).toHaveLength(1)
  })

  test("fails fast when queue start hits a dirty repository", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "package.json"),
          JSON.stringify({
            version: "1.0.0",
            scripts: {
              "desktop:webview": "echo ok",
            },
          }),
        )
        await Bun.write(path.join(dir, "build-mac-arm64-dmg.sh"), "#!/bin/sh\nexit 0\n")
        await $`git add package.json build-mac-arm64-dmg.sh`.cwd(dir).quiet()
        await $`git commit -m "fixture"`.cwd(dir).quiet()
        await Bun.write(path.join(dir, "dirty.txt"), "pending\n")
      },
    })

    const { project } = await Project.fromDirectory(tmp.path)
    const next = target(project.id, tmp.path)

    cfg = spyOn(AutofixConfig, "resolveForDirectory").mockResolvedValue(next)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await AutofixQueue.importFeedback(next, [item(1)])

        await expect(AutofixRunner.start(tmp.path)).rejects.toThrow("uncommitted changes")

        const sum = await AutofixQueue.summary({
          directory: tmp.path,
          project_id: project.id,
          profile: next.profile,
          supported: true,
        })

        expect(sum.state.status).toBe("blocked")
        expect(sum.state.note).toContain("uncommitted changes")
        expect(await AutofixQueue.listRuns(project.id, tmp.path)).toHaveLength(0)
      },
    })
  })

  test("falls back to legacy autofix flow when harness survey fails", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "package.json"),
          JSON.stringify({
            version: "1.0.0",
            scripts: {
              "desktop:webview": "echo ok",
            },
          }),
        )
        await Bun.write(path.join(dir, "build-mac-arm64-dmg.sh"), "#!/bin/sh\nexit 0\n")
        await $`git add package.json build-mac-arm64-dmg.sh`.cwd(dir).quiet()
        await $`git commit -m "fixture"`.cwd(dir).quiet()
      },
    })

    const { project } = await Project.fromDirectory(tmp.path)
    const next = target(project.id, tmp.path)
    let seen = 0

    cfg = spyOn(AutofixConfig, "resolveForDirectory").mockResolvedValue(next)
    survey = spyOn(AutofixHarness, "survey").mockRejectedValue(new Error("survey exploded"))
    analyze = spyOn(AutofixAnalyzer, "analyze").mockImplementation(async () => {
      seen += 1
      return {
        summary: "回退旧流程后进入 legacy analyze",
        scope: ["设置页"],
        steps: ["继续修复"],
        acceptance: ["能够自动继续"],
        architecture: [],
        methods: [],
        flows: [],
        automatable: false,
        blockers: ["legacy blocked"],
      }
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await AutofixQueue.setHarness(
          {
            directory: tmp.path,
            project_id: project.id,
            profile: next.profile,
          },
          {
            enabled: true,
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
          },
        )
        await AutofixQueue.importFeedback(next, [item(1)])
        const row = (await AutofixQueue.listFeedback(project.id, tmp.path))[0]
        if (!row) throw new Error("expected imported feedback")

        await AutofixRunner.startFeedback(
          tmp.path,
          row.id,
          AutofixSchema.start_input.parse({
            mode: "harness",
          }),
        )
        await wait(async () => {
          const runs = await AutofixQueue.listRuns(project.id, tmp.path)
          return runs.some((item) => ["blocked", "failed", "done", "stopped"].includes(item.status))
        })

        const run = (await AutofixQueue.listRuns(project.id, tmp.path))[0]
        expect(seen).toBe(1)
        expect(run?.mode).toBe("harness")
        expect(run?.harness?.fallback).toBe(true)
        expect(run?.harness?.stage).toBe("legacy-fallback")
      },
    })
  })
})
