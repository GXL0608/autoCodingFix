import path from "path"
import { pathToFileURL } from "url"
import { rm } from "fs/promises"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { AutofixQueue } from "./queue"
import type { AutofixSchema } from "./schema"
import type { TempAttachment, TempAudio } from "./types"

type Part =
  | {
      type: "text"
      text: string
    }
  | {
      type: "file"
      url: string
      filename: string
      mime: string
    }

export namespace AutofixInput {
  function ext(name?: string, mime?: string) {
    const file = name ? path.extname(name).slice(1) : ""
    if (file) return file
    return mime?.split("/")[1]?.split("+")[0] ?? "bin"
  }

  function filename(
    feedback: AutofixSchema.Feedback,
    item: Awaited<ReturnType<typeof AutofixQueue.attachmentData>>[number],
    index: number,
  ) {
    return item.file_name ? path.basename(item.file_name) : `feedback-${feedback.external_id}-${index}.${ext(undefined, item.mime_type)}`
  }

  async function attachments(feedback: AutofixSchema.Feedback) {
    const rows = await AutofixQueue.attachmentData(feedback.id)
    return Promise.all(
      rows
        .filter((item) => item.mime_type.startsWith("image/"))
        .map(async (item, index) => {
          const name = filename(feedback, item, index)
          const file = path.join(Global.Path.state, "autofix", "attachment", feedback.id, `${index}-${Date.now()}-${name}`)
          const blob = Buffer.isBuffer(item.file_blob) ? item.file_blob : Buffer.from(item.file_blob)
          await Filesystem.write(file, blob)
          return {
            path: file,
            filename: name,
            mime: item.mime_type,
            size: item.file_size_bytes ?? blob.byteLength,
          } satisfies TempAttachment
        }),
    )
  }

  export async function build(input: {
    feedback?: AutofixSchema.Feedback
    text: string
    extra?: Part[]
    audio?: TempAudio
  }) {
    const files = input.feedback ? await attachments(input.feedback) : []
    return {
      parts: [
        {
          type: "text" as const,
          text: input.text,
        },
        ...files.map((item) => ({
          type: "file" as const,
          url: pathToFileURL(item.path).href,
          filename: item.filename,
          mime: item.mime,
        })),
        ...(input.extra ?? []),
        ...(input.audio
          ? [
              {
                type: "file" as const,
                url: pathToFileURL(input.audio.path).href,
                filename: input.audio.filename,
                mime: input.audio.mime,
              },
            ]
          : []),
      ] satisfies Part[],
      temp: files.map((item) => item.path),
    }
  }

  export async function cleanup(files: string[]) {
    await Promise.all(files.map((item) => rm(item, { force: true }).catch(() => undefined)))
  }
}
