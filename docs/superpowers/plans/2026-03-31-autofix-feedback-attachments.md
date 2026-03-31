# Autofix Feedback Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror image and GIF feedback attachments into local Autofix storage and send them to every Autofix model stage together with existing text and audio inputs.

**Architecture:** Add a local attachment child table under mirrored Autofix feedback, extend the PostgreSQL source and manual import payloads to hydrate attachment snapshots, and route those snapshots through a shared prompt-part assembly helper. Execution stays local-first: sync stores binaries in SQLite, prompt assembly restores temp files, and session prompt handling keeps ownership of GIF frame extraction.

**Tech Stack:** Bun, TypeScript, Drizzle SQLite schema, Hono routes, PostgreSQL source sync, Bun tests

---

### Task 1: Add local attachment storage and migration

**Files:**
- Modify: `packages/opencode/src/autofix/autofix.sql.ts`
- Modify: `packages/opencode/src/storage/schema.ts`
- Create: `packages/opencode/migration/20260331120000_autofix_feedback_attachments/migration.sql`

- [ ] **Step 1: Add the failing schema expectations in code review notes**

```ts
export const AutofixFeedbackAttachmentTable = sqliteTable(
  "autofix_feedback_attachment",
  {
    id: text().primaryKey(),
    feedback_id: text().notNull().references(() => AutofixFeedbackTable.id, { onDelete: "cascade" }),
    external_id: integer(),
    created_at: integer().notNull(),
    display_order: integer().notNull().$default(() => 0),
    file_name: text(),
    mime_type: text().notNull(),
    file_size_bytes: integer(),
    file_blob: blob({ mode: "buffer" }).notNull(),
    ...Timestamps,
  },
  (table) => [
    index("autofix_feedback_attachment_feedback_idx").on(
      table.feedback_id,
      table.display_order,
      table.created_at,
      table.id,
    ),
    index("autofix_feedback_attachment_feedback_external_idx").on(table.feedback_id, table.external_id),
  ],
)
```

- [ ] **Step 2: Update exports so queue code can import the table**

```ts
export {
  AutofixArtifactTable,
  AutofixAttemptTable,
  AutofixEventTable,
  AutofixFeedbackAttachmentTable,
  AutofixFeedbackTable,
  AutofixRunTable,
  AutofixStateTable,
} from "../autofix/autofix.sql"
```

- [ ] **Step 3: Add the SQLite migration**

```sql
CREATE TABLE `autofix_feedback_attachment` (
  `id` text PRIMARY KEY NOT NULL,
  `feedback_id` text NOT NULL REFERENCES `autofix_feedback`(`id`) ON DELETE cascade,
  `external_id` integer,
  `created_at` integer NOT NULL,
  `display_order` integer NOT NULL DEFAULT 0,
  `file_name` text,
  `mime_type` text NOT NULL,
  `file_size_bytes` integer,
  `file_blob` blob NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `autofix_feedback_attachment_feedback_idx`
  ON `autofix_feedback_attachment` (`feedback_id`, `display_order`, `created_at`, `id`);
--> statement-breakpoint
CREATE INDEX `autofix_feedback_attachment_feedback_external_idx`
  ON `autofix_feedback_attachment` (`feedback_id`, `external_id`);
```

- [ ] **Step 4: Sanity check the migration file**

Run: `sed -n '1,200p' packages/opencode/migration/20260331120000_autofix_feedback_attachments/migration.sql`
Expected: one new table and two indexes, no unrelated DDL

### Task 2: Extend Autofix runtime types and API schemas

**Files:**
- Modify: `packages/opencode/src/autofix/types.ts`
- Modify: `packages/opencode/src/autofix/schema.ts`

- [ ] **Step 1: Add attachment runtime types**

```ts
export type PulledAttachment = {
  external_id?: number
  created_at: number
  display_order: number
  file_name?: string
  mime_type: string
  file_size_bytes?: number
  file_blob: Buffer
}

export type TempAttachment = {
  path: string
  filename: string
  mime: string
  size: number
}
```

- [ ] **Step 2: Extend pulled feedback and run context helpers**

```ts
export type PulledFeedback = {
  // existing fields...
  attachments: PulledAttachment[]
}
```

- [ ] **Step 3: Extend zod schemas for mirrored and imported attachments**

```ts
export const feedback_attachment = z.object({
  id: z.string(),
  feedback_id: z.string(),
  external_id: z.number().int().optional(),
  created_at: z.number(),
  display_order: z.number().int(),
  file_name: z.string().optional(),
  mime_type: z.string(),
  file_size_bytes: z.number().int().optional(),
})

export const import_attachment = z.object({
  display_order: z.coerce.number().int().optional(),
  file_name: z.string().optional(),
  mime_type: z.string().regex(/^image\\//),
  file_size_bytes: z.coerce.number().int().optional(),
  file_blob_base64: z.string().min(1),
})
```

- [ ] **Step 4: Attach attachments to feedback and import schemas**

```ts
attachments: z.array(feedback_attachment).default([])
```

```ts
attachments: z.array(import_attachment).default([])
```

- [ ] **Step 5: Run focused schema tests after implementation**

Run: `bun test test/autofix/schema.test.ts`
Expected: PASS with new attachment cases covering import parsing and feedback schema shape

### Task 3: Extend PostgreSQL source sync and queue persistence

**Files:**
- Modify: `packages/opencode/src/autofix/source/postgres.ts`
- Modify: `packages/opencode/src/autofix/queue.ts`
- Modify: `packages/opencode/test/autofix/queue.test.ts`

- [ ] **Step 1: Add a failing queue test for image-only feedback**

```ts
test("keeps image-only feedback queued", async () => {
  const result = await AutofixQueue.importFeedback(target, [
    {
      external_id: 3,
      created_at: 300,
      source: "manual_import",
      feedback_token: "manual-3",
      device_id: "local-import",
      has_audio: false,
      recognize_success: true,
      attachments: [
        {
          created_at: 300,
          display_order: 0,
          mime_type: "image/png",
          file_name: "shot.png",
          file_blob: Buffer.from("img"),
        },
      ],
    },
  ])

  expect(result.blocked).toBe(0)
  expect((await AutofixQueue.listFeedback(project.id, tmp.path))[0]?.status).toBe("queued")
})
```

- [ ] **Step 2: Teach PostgreSQL pull to fetch attachments for the current feedback batch**

```ts
const ids = rows.map((row) => Number(row.id))
const files = ids.length
  ? await sql.unsafe(
      `
        select id, feedback_id, created_at, display_order, file_name, mime_type, file_size_bytes, file_blob
        from ${attachments}
        where feedback_id = any($1)
        order by feedback_id asc, display_order asc, created_at asc, id asc
      `,
      [ids],
    )
  : []
```

- [ ] **Step 3: Group pulled attachments onto each feedback item**

```ts
const grouped = files.reduce((map, row) => {
  const key = Number(row.feedback_id)
  const list = map.get(key) ?? []
  list.push({
    external_id: Number(row.id),
    created_at: ms(row.created_at),
    display_order: Number(row.display_order ?? 0),
    file_name: row.file_name ?? undefined,
    mime_type: row.mime_type,
    file_size_bytes: row.file_size_bytes ?? undefined,
    file_blob: Buffer.isBuffer(row.file_blob) ? row.file_blob : Buffer.from(row.file_blob),
  })
  map.set(key, list)
  return map
}, new Map<number, PulledAttachment[]>())
```

- [ ] **Step 4: Add queue helpers to save, replace, and list attachment rows**

```ts
function attachment(row: AttachmentRow) {
  return {
    id: row.id,
    feedback_id: row.feedback_id,
    external_id: row.external_id ?? undefined,
    created_at: row.created_at,
    display_order: row.display_order,
    file_name: row.file_name ?? undefined,
    mime_type: row.mime_type,
    file_size_bytes: row.file_size_bytes ?? undefined,
  }
}
```

```ts
async function replaceAttachments(feedback_id: string, items: PulledAttachment[]) {
  Database.use((db) => db.delete(AutofixFeedbackAttachmentTable).where(eq(AutofixFeedbackAttachmentTable.feedback_id, feedback_id)).run())
  if (!items.length) return
  Database.use((db) =>
    db.insert(AutofixFeedbackAttachmentTable).values(
      items.map((item) => ({
        id: ulid(),
        feedback_id,
        external_id: item.external_id ?? null,
        created_at: item.created_at,
        display_order: item.display_order,
        file_name: item.file_name ?? null,
        mime_type: item.mime_type,
        file_size_bytes: item.file_size_bytes ?? null,
        file_blob: item.file_blob,
      })),
    ).run(),
  )
}
```

- [ ] **Step 5: Update queue note logic to treat valid image attachments as runnable input**

```ts
if (item.attachments?.some((file) => file.mime_type.startsWith("image/"))) return
```

- [ ] **Step 6: Return attachments in feedback and run detail reads**

```ts
attachments: await listFeedbackAttachments(row.id)
```

- [ ] **Step 7: Run queue tests**

Run: `bun test test/autofix/queue.test.ts`
Expected: PASS including attachment persistence and image-only queue eligibility

### Task 4: Add shared Autofix prompt-part assembly for text, attachments, and audio

**Files:**
- Create: `packages/opencode/src/autofix/input.ts`
- Modify: `packages/opencode/src/autofix/analysis.ts`
- Modify: `packages/opencode/src/autofix/executor.ts`
- Modify: `packages/opencode/src/autofix/harness.ts`
- Modify: `packages/opencode/src/autofix/runner.ts`

- [ ] **Step 1: Add a helper that restores attachment blobs to temp files**

```ts
export async function attachments(feedback: AutofixSchema.Feedback) {
  const dir = path.join(Global.Path.state, "autofix", "attachment", feedback.id)
  return Promise.all(
    feedback.attachments
      .filter((item) => item.mime_type.startsWith("image/"))
      .map(async (item, index) => {
        const ext = item.file_name?.split(".").pop() || item.mime_type.split("/")[1] || "bin"
        const filename = item.file_name ?? `feedback-${feedback.external_id}-${index}.${ext}`
        const file = path.join(dir, `${index}-${Date.now()}-${filename}`)
        const blob = await AutofixQueue.getAttachmentBlob(item.id)
        await Filesystem.write(file, blob)
        return { path: file, filename, mime: item.mime_type, size: item.file_size_bytes ?? blob.byteLength }
      }),
  )
}
```

- [ ] **Step 2: Add one shared `parts()` helper**

```ts
export async function parts(input: {
  text: string
  attachments: TempAttachment[]
  audio?: TempAudio
}) {
  return [
    { type: "text" as const, text: input.text },
    ...input.attachments.map((item) => ({
      type: "file" as const,
      url: pathToFileURL(item.path).href,
      filename: item.filename,
      mime: item.mime,
    })),
    ...(input.audio
      ? [{ type: "file" as const, url: pathToFileURL(input.audio.path).href, filename: input.audio.filename, mime: input.audio.mime }]
      : []),
  ]
}
```

- [ ] **Step 3: Switch analysis and implementation to the shared helper**

```ts
const msg = await SessionPrompt.prompt({
  // existing fields...
  parts: await AutofixInput.parts({ text: item.text, attachments, audio }),
})
```

- [ ] **Step 4: Extend Harness prompts to include file parts too**

```ts
parts: await AutofixInput.parts({
  text,
  attachments,
})
```

- [ ] **Step 5: Ensure runner cleanup removes temp attachment directories**

```ts
clean.files.push(path.join(Global.Path.state, "autofix", "attachment", feedbackID))
```

- [ ] **Step 6: Run focused execution tests**

Run: `bun test test/autofix/executor.test.ts test/autofix/schema.test.ts`
Expected: PASS with prompt calls containing attachment file parts

### Task 5: Extend import and route surfaces, then validate end-to-end

**Files:**
- Modify: `packages/opencode/src/autofix/route.ts`
- Modify: `packages/opencode/test/autofix/runner.test.ts`
- Modify: `examples/autofix-feedback.template.json`

- [ ] **Step 1: Add import examples with attachment payloads**

```json
[
  {
    "external_id": 10001,
    "recognized_text": "设置页切换语言后，文案没有立即刷新。",
    "attachments": [
      {
        "display_order": 0,
        "file_name": "case-1.png",
        "mime_type": "image/png",
        "file_blob_base64": "aW1n"
      }
    ]
  }
]
```

- [ ] **Step 2: Add runner tests that verify attachments reach model prompts**

```ts
expect(req?.parts.some((part) => part.type === "file" && part.mime === "image/png")).toBe(true)
```

- [ ] **Step 3: Run targeted validation**

Run: `cd packages/opencode && bun test test/autofix/schema.test.ts test/autofix/queue.test.ts test/autofix/executor.test.ts test/autofix/runner.test.ts`
Expected: PASS

- [ ] **Step 4: Run package typecheck**

Run: `cd packages/opencode && bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit the implementation**

```bash
git add packages/opencode/src/autofix packages/opencode/src/storage/schema.ts packages/opencode/migration packages/opencode/test/autofix examples/autofix-feedback.template.json docs/superpowers/plans/2026-03-31-autofix-feedback-attachments.md
git commit -m "feat: mirror autofix feedback attachments"
```
