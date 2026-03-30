import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Instance } from "@/project/instance"
import { lazy } from "@/util/lazy"
import { errors } from "@/server/error"
import { AutofixConfig } from "./config"
import { AutofixQueue } from "./queue"
import { AutofixRunner } from "./runner"
import { AutofixSchema } from "./schema"
import { LocalGitFlow } from "./git"

export const AutofixRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get autofix state",
        description: "Get autofix support, queue counts, and active run info for the current project.",
        operationId: "experimental.autofix.get",
        responses: {
          200: {
            description: "Autofix summary",
            content: {
              "application/json": {
                schema: resolver(AutofixSchema.summary),
              },
            },
          },
        },
      }),
      async (c) => {
        const cfg = await AutofixConfig.resolveForDirectory(Instance.directory)
        const result = await AutofixQueue.summary({
          directory: Instance.directory,
          project_id: Instance.project.id,
          profile: cfg?.profile,
          supported: !!cfg,
        })
        result.state.branch = await LocalGitFlow.branch(Instance.directory).catch(() => undefined)
        return c.json(result)
      },
    )
    .post(
      "/prompt",
      describeRoute({
        summary: "Set shared autofix prompt",
        description: "Persist the project-scoped shared Autofix prompt used for future runs.",
        operationId: "experimental.autofix.prompt.set",
        responses: {
          200: {
            description: "Autofix summary",
            content: {
              "application/json": {
                schema: resolver(AutofixSchema.summary),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", AutofixSchema.prompt_input),
      async (c) => {
        const cfg = await AutofixConfig.resolveForDirectory(Instance.directory)
        if (!cfg) throw new Error("Autofix is not available for the current project")
        const body = c.req.valid("json")
        return c.json(
          await AutofixQueue.setPrompt(
            {
              directory: Instance.directory,
              project_id: Instance.project.id,
              profile: cfg.profile,
            },
            body,
          ),
        )
      },
    )
    .post(
      "/start",
      describeRoute({
        summary: "Start autofix",
        description: "Start the autofix queue for the current project.",
        operationId: "experimental.autofix.start",
        responses: {
          200: {
            description: "Autofix summary",
            content: {
              "application/json": {
                schema: resolver(AutofixSchema.summary),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", AutofixSchema.start_input.optional()),
      async (c) => {
        const cfg = await AutofixConfig.resolveForDirectory(Instance.directory)
        if (!cfg) throw new Error("Autofix is not available for the current project")
        const body = c.req.valid("json")
        await AutofixRunner.start(Instance.directory, body)
        const result = await AutofixQueue.summary({
          directory: Instance.directory,
          project_id: Instance.project.id,
          profile: cfg.profile,
          supported: true,
        })
        result.state.branch = await LocalGitFlow.branch(Instance.directory).catch(() => undefined)
        return c.json(result)
      },
    )
    .post(
      "/feedback/:feedbackID/start",
      describeRoute({
        summary: "Start autofix for a single feedback item",
        description: "Start AutoCodingFix for one mirrored feedback item in the current project.",
        operationId: "experimental.autofix.startFeedback",
        responses: {
          200: {
            description: "Autofix summary",
            content: {
              "application/json": {
                schema: resolver(AutofixSchema.summary),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          feedbackID: z.string(),
        }),
      ),
      validator("json", AutofixSchema.start_input.optional()),
      async (c) => {
        const cfg = await AutofixConfig.resolveForDirectory(Instance.directory)
        if (!cfg) throw new Error("Autofix is not available for the current project")
        const { feedbackID } = c.req.valid("param")
        const body = c.req.valid("json")
        await AutofixRunner.startFeedback(Instance.directory, feedbackID, body)
        const result = await AutofixQueue.summary({
          directory: Instance.directory,
          project_id: Instance.project.id,
          profile: cfg.profile,
          supported: true,
        })
        result.state.branch = await LocalGitFlow.branch(Instance.directory).catch(() => undefined)
        return c.json(result)
      },
    )
    .post(
      "/feedback/:feedbackID/reset",
      describeRoute({
        summary: "Reset autofix state for a single feedback item",
        description: "Clear the mirrored autofix run history and status for one feedback item in the current project.",
        operationId: "experimental.autofix.resetFeedback",
        responses: {
          200: {
            description: "Autofix summary",
            content: {
              "application/json": {
                schema: resolver(AutofixSchema.summary),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          feedbackID: z.string(),
        }),
      ),
      async (c) => {
        const cfg = await AutofixConfig.resolveForDirectory(Instance.directory)
        if (!cfg) throw new Error("Autofix is not available for the current project")
        const { feedbackID } = c.req.valid("param")
        await AutofixRunner.resetFeedback(Instance.directory, feedbackID)
        const result = await AutofixQueue.summary({
          directory: Instance.directory,
          project_id: Instance.project.id,
          profile: cfg.profile,
          supported: true,
        })
        result.state.branch = await LocalGitFlow.branch(Instance.directory).catch(() => undefined)
        return c.json(result)
      },
    )
    .post(
      "/feedback/:feedbackID/mute",
      describeRoute({
        summary: "Mute autofix feedback",
        description: "Mark one mirrored feedback item as muted so queue execution skips it.",
        operationId: "experimental.autofix.muteFeedback",
        responses: {
          200: {
            description: "Autofix summary",
            content: {
              "application/json": {
                schema: resolver(AutofixSchema.summary),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          feedbackID: z.string(),
        }),
      ),
      async (c) => {
        const cfg = await AutofixConfig.resolveForDirectory(Instance.directory)
        if (!cfg) throw new Error("Autofix is not available for the current project")
        const { feedbackID } = c.req.valid("param")
        await AutofixQueue.setMuted(cfg, feedbackID, true)
        const result = await AutofixQueue.summary({
          directory: Instance.directory,
          project_id: Instance.project.id,
          profile: cfg.profile,
          supported: true,
        })
        result.state.branch = await LocalGitFlow.branch(Instance.directory).catch(() => undefined)
        return c.json(result)
      },
    )
    .post(
      "/feedback/:feedbackID/unmute",
      describeRoute({
        summary: "Unmute autofix feedback",
        description: "Restore one muted feedback item so it can rejoin queue execution.",
        operationId: "experimental.autofix.unmuteFeedback",
        responses: {
          200: {
            description: "Autofix summary",
            content: {
              "application/json": {
                schema: resolver(AutofixSchema.summary),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          feedbackID: z.string(),
        }),
      ),
      async (c) => {
        const cfg = await AutofixConfig.resolveForDirectory(Instance.directory)
        if (!cfg) throw new Error("Autofix is not available for the current project")
        const { feedbackID } = c.req.valid("param")
        await AutofixQueue.setMuted(cfg, feedbackID, false)
        const result = await AutofixQueue.summary({
          directory: Instance.directory,
          project_id: Instance.project.id,
          profile: cfg.profile,
          supported: true,
        })
        result.state.branch = await LocalGitFlow.branch(Instance.directory).catch(() => undefined)
        return c.json(result)
      },
    )
    .post(
      "/feedback/:feedbackID/delete",
      describeRoute({
        summary: "Delete autofix feedback",
        description: "Delete one mirrored feedback item together with its local run history and artifacts.",
        operationId: "experimental.autofix.deleteFeedback",
        responses: {
          200: {
            description: "Autofix summary",
            content: {
              "application/json": {
                schema: resolver(AutofixSchema.summary),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          feedbackID: z.string(),
        }),
      ),
      async (c) => {
        const cfg = await AutofixConfig.resolveForDirectory(Instance.directory)
        if (!cfg) throw new Error("Autofix is not available for the current project")
        const { feedbackID } = c.req.valid("param")
        await AutofixRunner.deleteFeedback(Instance.directory, feedbackID)
        const result = await AutofixQueue.summary({
          directory: Instance.directory,
          project_id: Instance.project.id,
          profile: cfg.profile,
          supported: true,
        })
        result.state.branch = await LocalGitFlow.branch(Instance.directory).catch(() => undefined)
        return c.json(result)
      },
    )
    .post(
      "/stop",
      describeRoute({
        summary: "Stop autofix",
        description: "Request autofix queue stop for the current project.",
        operationId: "experimental.autofix.stop",
        responses: {
          200: {
            description: "Autofix summary",
            content: {
              "application/json": {
                schema: resolver(AutofixSchema.summary),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const cfg = await AutofixConfig.resolveForDirectory(Instance.directory)
        if (!cfg) throw new Error("Autofix is not available for the current project")
        await AutofixRunner.stop(Instance.directory)
        const result = await AutofixQueue.summary({
          directory: Instance.directory,
          project_id: Instance.project.id,
          profile: cfg.profile,
          supported: true,
        })
        result.state.branch = await LocalGitFlow.branch(Instance.directory).catch(() => undefined)
        return c.json(result)
      },
    )
    .post(
      "/feedback/import",
      describeRoute({
        summary: "Import autofix feedback",
        description: "Import local autofix feedback data into the mirrored queue for the current project.",
        operationId: "experimental.autofix.importFeedback",
        responses: {
          200: {
            description: "Autofix import result",
            content: {
              "application/json": {
                schema: resolver(AutofixSchema.sync),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", AutofixSchema.import_input),
      async (c) => {
        const cfg = await AutofixConfig.resolveForDirectory(Instance.directory)
        if (!cfg) throw new Error("Autofix is not available for the current project")
        const body = c.req.valid("json")
        return c.json(await AutofixQueue.importFeedback(cfg, body.items))
      },
    )
    .post(
      "/sync",
      describeRoute({
        summary: "Sync autofix feedback",
        description: "Immediately sync autofix feedback from the configured source.",
        operationId: "experimental.autofix.sync",
        responses: {
          200: {
            description: "Autofix sync result",
            content: {
              "application/json": {
                schema: resolver(AutofixSchema.sync),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const cfg = await AutofixConfig.resolveForDirectory(Instance.directory)
        if (!cfg) throw new Error("Autofix is not available for the current project")
        return c.json(await AutofixQueue.syncProject(cfg, { full: true }))
      },
    )
    .get(
      "/feedback",
      describeRoute({
        summary: "List autofix feedback",
        description: "List mirrored feedback records for the current project.",
        operationId: "experimental.autofix.feedback",
        responses: {
          200: {
            description: "Autofix feedback list",
            content: {
              "application/json": {
                schema: resolver(z.array(AutofixSchema.feedback)),
              },
            },
          },
        },
      }),
      async (c) => c.json(await AutofixQueue.listFeedback(Instance.project.id, Instance.directory)),
    )
    .get(
      "/run",
      describeRoute({
        summary: "List autofix runs",
        description: "List autofix run history for the current project.",
        operationId: "experimental.autofix.run.list",
        responses: {
          200: {
            description: "Autofix run list",
            content: {
              "application/json": {
                schema: resolver(z.array(AutofixSchema.run)),
              },
            },
          },
        },
      }),
      async (c) => c.json(await AutofixQueue.listRuns(Instance.project.id, Instance.directory)),
    )
    .get(
      "/run/:runID",
      describeRoute({
        summary: "Get autofix run detail",
        description: "Get a single autofix run detail.",
        operationId: "experimental.autofix.run.get",
        responses: {
          200: {
            description: "Autofix run detail",
            content: {
              "application/json": {
                schema: resolver(AutofixSchema.detail),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          runID: z.string(),
        }),
      ),
      async (c) => {
        const { runID } = c.req.valid("param")
        const result = await AutofixQueue.detailByScope(Instance.project.id, Instance.directory, runID)
        if (!result) throw new Error("Autofix run not found")
        return c.json(result)
      },
    )
    .post(
      "/run/:runID/continue",
      describeRoute({
        summary: "Continue autofix run",
        description: "Start a follow-up autofix run from an existing run, optionally with extra guidance.",
        operationId: "experimental.autofix.run.continue",
        responses: {
          200: {
            description: "Autofix run",
            content: {
              "application/json": {
                schema: resolver(AutofixSchema.run),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          runID: z.string(),
        }),
      ),
      validator("json", AutofixSchema.continue_input),
      async (c) => {
        const { runID } = c.req.valid("param")
        const body = c.req.valid("json")
        return c.json(await AutofixRunner.continueRun(Instance.directory, runID, body.prompt))
      },
    ),
)
