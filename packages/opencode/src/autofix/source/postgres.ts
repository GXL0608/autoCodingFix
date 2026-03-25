import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import path from "path"
import postgres from "postgres"
import type { PulledFeedback, SyncCursor, TempAudio } from "../types"

export namespace CellFeedbackSource {
  const refs = new Map<string, string>()

  function client(dsn: string) {
    return postgres(dsn, {
      max: 1,
      idle_timeout: 5,
      prepare: false,
    })
  }

  function ms(input: Date | string | number) {
    if (typeof input === "number") return input
    if (input instanceof Date) return input.getTime()
    return new Date(input).getTime()
  }

  function clean(input: string) {
    const text = input.trim()
    if (!text.startsWith(`"`)) return text
    if (!text.endsWith(`"`)) return text
    return text.slice(1, -1).replaceAll(`""`, `"`)
  }

  function parse(input: string) {
    const parts = input.split(".")
    if (parts.length !== 2) return { table: clean(input) }
    return {
      schema: clean(parts[0]),
      table: clean(parts[1]),
    }
  }

  function quote(input: string) {
    return `"${input.replaceAll(`"`, `""`)}"`
  }

  function ref(input: { schema?: string; table: string }) {
    if (!input.schema) return quote(input.table)
    return `${quote(input.schema)}.${quote(input.table)}`
  }

  async function similar(sql: ReturnType<typeof client>, table: string) {
    const words = table
      .split(/[^a-zA-Z0-9]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 3)
    const terms = Array.from(new Set([table, ...words]))
    const cond = terms.map((_, index) => `c.relname ilike $${index + 1}`).join(" or ")
    const rows = await sql.unsafe<{ name: string }[]>(
      `
        select n.nspname || '.' || c.relname as name
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p')
          and n.nspname not in ('pg_catalog', 'information_schema')
          and (${cond})
        order by
          case when n.nspname = 'public' then 0 else 1 end,
          n.nspname asc,
          c.relname asc
        limit 8
      `,
      terms.map((item) => `%${item}%`),
    )
    return rows.map((row) => row.name)
  }

  async function relation(sql: ReturnType<typeof client>, cfg: { dsn: string; table: string }) {
    const key = `${cfg.dsn}::${cfg.table}`
    const hit = refs.get(key)
    if (hit) return hit
    const item = parse(cfg.table)
    if (item.schema) {
      const value = ref(item)
      refs.set(key, value)
      return value
    }
    const rows = await sql<{ schema_name: string; table_name: string }[]>`
      select
        n.nspname as schema_name,
        c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and n.nspname not in ('pg_catalog', 'information_schema')
        and c.relname = ${item.table}
      order by
        case when n.nspname = 'public' then 0 else 1 end,
        n.nspname asc
      limit 1
    `
    const row = rows[0]
    if (!row) {
      const list = await similar(sql, item.table)
      if (list.length)
        throw new Error(
          `PostgreSQL relation ${item.table} not found in the target database. Similar tables: ${list.join(", ")}`,
        )
      throw new Error(`PostgreSQL relation ${item.table} not found in the target database`)
    }
    const value = ref({
      schema: row.schema_name,
      table: row.table_name,
    })
    refs.set(key, value)
    return value
  }

  export async function pull(
    cfg: { dsn: string; table: string },
    cursor: SyncCursor,
    limit: number,
  ): Promise<PulledFeedback[]> {
    const sql = client(cfg.dsn)
    const rows = await relation(sql, cfg)
      .then((table) =>
        cursor.created_at && cursor.external_id
          ? sql.unsafe(
              `
                select
                  id,
                  created_at,
                  request_id,
                  source,
                  feedback_token,
                  device_id,
                  uploader,
                  app_version,
                  audio_filename,
                  audio_mime_type,
                  audio_size_bytes,
                  audio_duration_ms,
                  language,
                  recognized_text,
                  processing_time_ms,
                  recognize_success,
                  recognize_http_status,
                  recognize_error,
                  recognize_response,
                  meta,
                  audio_blob is not null as has_audio
                from ${table}
                where created_at > $1
                   or (created_at = $1 and id > $2)
                order by created_at asc, id asc
                limit $3
              `,
              [new Date(cursor.created_at).toISOString(), cursor.external_id, limit],
            )
          : sql.unsafe(
              `
                select
                  id,
                  created_at,
                  request_id,
                  source,
                  feedback_token,
                  device_id,
                  uploader,
                  app_version,
                  audio_filename,
                  audio_mime_type,
                  audio_size_bytes,
                  audio_duration_ms,
                  language,
                  recognized_text,
                  processing_time_ms,
                  recognize_success,
                  recognize_http_status,
                  recognize_error,
                  recognize_response,
                  meta,
                  audio_blob is not null as has_audio
                from ${table}
                order by created_at asc, id asc
                limit $1
              `,
              [limit],
            ),
      )
      .finally(() => sql.end({ timeout: 0 }))

    return rows.map((row) => ({
      external_id: Number(row.id),
      created_at: ms(row.created_at),
      request_id: row.request_id ?? undefined,
      source: row.source,
      feedback_token: row.feedback_token,
      device_id: row.device_id,
      uploader: row.uploader ?? undefined,
      app_version: row.app_version ?? undefined,
      audio_filename: row.audio_filename ?? undefined,
      audio_mime_type: row.audio_mime_type ?? undefined,
      audio_size_bytes: row.audio_size_bytes ?? undefined,
      audio_duration_ms: row.audio_duration_ms ?? undefined,
      has_audio: Boolean(row.has_audio),
      language: row.language ?? undefined,
      recognized_text: row.recognized_text ?? undefined,
      processing_time_ms: row.processing_time_ms === null ? undefined : Number(row.processing_time_ms),
      recognize_success: Boolean(row.recognize_success),
      recognize_http_status: row.recognize_http_status ?? undefined,
      recognize_error: row.recognize_error ?? undefined,
      recognize_response: row.recognize_response ?? undefined,
      meta: row.meta ?? undefined,
    }))
  }

  export async function fetchAudio(
    cfg: { dsn: string; table: string },
    external_id: number,
  ): Promise<TempAudio | null> {
    const sql = client(cfg.dsn)
    const rows = await relation(sql, cfg)
      .then((table) =>
        sql.unsafe(
          `
            select
              audio_blob,
              audio_filename,
              audio_mime_type,
              audio_size_bytes
            from ${table}
            where id = $1
            limit 1
          `,
          [external_id],
        ),
      )
      .finally(() => sql.end({ timeout: 0 }))
    const row = rows[0]
    if (!row?.audio_blob) return null
    const mime = row.audio_mime_type ?? "application/octet-stream"
    const ext = mime.split("/")[1] ?? "bin"
    const filename = row.audio_filename ?? `feedback-${external_id}.${ext}`
    const dir = path.join(Global.Path.state, "autofix", "audio")
    const file = path.join(dir, `${external_id}-${Date.now()}-${filename}`)
    const buf = Buffer.isBuffer(row.audio_blob) ? row.audio_blob : Buffer.from(row.audio_blob)
    await Filesystem.write(file, buf)
    return {
      path: file,
      filename,
      mime,
      size: row.audio_size_bytes ?? buf.byteLength,
    }
  }
}
