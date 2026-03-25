import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import z from "zod"
import { AutofixSchema } from "./schema"

export namespace AutofixEvent {
  export const QueueUpdated = BusEvent.define(
    "autofix.queue.updated",
    z.object({
      state: AutofixSchema.state,
    }),
  )

  export const RunUpdated = BusEvent.define(
    "autofix.run.updated",
    z.object({
      run: AutofixSchema.run,
    }),
  )

  export const RunLog = BusEvent.define(
    "autofix.run.log",
    z.object({
      run_id: z.string().optional(),
      phase: z.string(),
      level: AutofixSchema.event_level,
      message: z.string(),
    }),
  )

  export const ArtifactReady = BusEvent.define(
    "autofix.artifact.ready",
    z.object({
      run_id: z.string(),
      artifact: AutofixSchema.artifact,
    }),
  )

  export function emit(directory: string, payload: { type: string; properties: unknown }) {
    GlobalBus.emit("event", {
      directory,
      payload,
    })
  }
}
