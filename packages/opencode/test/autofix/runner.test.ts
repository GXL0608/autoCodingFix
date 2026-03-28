import { $ } from "bun"
import path from "path"
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { AutofixAnalyzer } from "../../src/autofix/analysis"
import { AutofixConfig } from "../../src/autofix/config"
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

afterEach(async () => {
  cfg?.mockRestore()
  analyze?.mockRestore()
  cfg = undefined
  analyze = undefined
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
        const row = (await AutofixQueue.listFeedback(project.id))[0]
        if (!row) throw new Error("expected imported feedback")

        await AutofixRunner.startFeedback(tmp.path, row.id, pick)
        await wait(async () => {
          const runs = await AutofixQueue.listRuns(project.id)
          return runs.some((item) => ["blocked", "failed", "done", "stopped"].includes(item.status))
        })

        expect(seen).toEqual(pick)
      },
    })
  })
})
