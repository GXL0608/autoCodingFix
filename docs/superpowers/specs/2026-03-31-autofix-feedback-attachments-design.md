# Autofix Feedback Attachments Design

## Summary

Autofix currently mirrors feedback text and audio metadata from `voice_feedback_records`, but it does not mirror or forward image and GIF attachments. We will extend the feedback mirror so each feedback item can include locally stored attachment binaries, then pass those attachments to every Autofix model stage together with text and optional audio fallback.

This design chooses local attachment mirroring as the source of truth during Autofix execution. Once a feedback item has been synced, later execution must not depend on the external PostgreSQL database remaining available.

## Goals

- Mirror image and GIF attachments from `voice_feedback_attachments` into local Autofix storage.
- Keep attachments associated with the mirrored feedback item, including stable display order.
- Send mirrored image and GIF attachments to the model during Autofix analysis, implementation, and Harness stages.
- Allow manual feedback import to include image and GIF attachments through the existing Autofix import API.
- Treat attachments as valid execution input so feedback with no text but with images or GIFs can still run.

## Non-Goals

- Supporting non-image attachments as model input.
- Changing provider-level multimodal behavior beyond using existing `file` parts.
- Replacing the current audio fallback policy.
- Adding a second import API just for attachments.

## Current State

### External source

- `packages/opencode/src/autofix/source/postgres.ts` pulls rows only from `voice_feedback_records`.
- Audio binaries are fetched lazily from PostgreSQL only when text is missing and audio fallback is enabled.
- No attachment rows are queried from `voice_feedback_attachments`.

### Local mirror

- `packages/opencode/src/autofix/autofix.sql.ts` defines only `autofix_feedback` for mirrored feedback records.
- No local attachment table exists.
- Queue status logic only considers `recognized_text`, `meta`, and audio fallback eligibility.

### Model input

- `packages/opencode/src/autofix/analysis.ts` sends text and optional audio file parts.
- `packages/opencode/src/autofix/executor.ts` sends text and optional audio file parts.
- `packages/opencode/src/autofix/harness.ts` uses only text in Harness prompts.
- `packages/opencode/src/session/prompt.ts` already supports image file parts and can extract key frames from animated GIFs automatically.

## Proposed Design

### 1. Add a local mirrored attachment table

Create a new local SQLite table, `autofix_feedback_attachment`, as a child of `autofix_feedback`.

Proposed columns:

- `id`: local primary key
- `feedback_id`: references local `autofix_feedback.id` with `on delete cascade`
- `external_id`: mirrors `voice_feedback_attachments.id` when the attachment came from PostgreSQL, nullable for manual imports
- `created_at`: mirrored attachment creation time
- `display_order`: mirrored order field
- `file_name`: optional original file name
- `mime_type`: required attachment MIME type
- `file_size_bytes`: optional original size
- `file_blob`: required attachment binary
- timestamps from the shared local schema helper

Recommended indexes:

- `(feedback_id, display_order, created_at, id)` for ordered retrieval
- `(feedback_id, external_id)` for idempotent upsert of mirrored PostgreSQL attachments

This keeps feedback-level state and attachment binaries separate while preserving cascade delete behavior on feedback reset and removal.

### 2. Extend mirrored feedback types and API schema

Add an attachment type to Autofix runtime and API schemas.

Proposed attachment shape:

- `id`
- `feedback_id`
- `external_id?`
- `created_at`
- `display_order`
- `file_name?`
- `mime_type`
- `file_size_bytes?`

Feedback API changes:

- `AutofixSchema.feedback` gains `attachments`
- `AutofixSchema.detail.feedback` returns the same attachment list
- `AutofixSchema.import_item` gains `attachments`

Manual import attachment input shape:

- `display_order?`
- `file_name?`
- `mime_type`
- `file_size_bytes?`
- `file_blob_base64`

The import API remains `POST /feedback/import`.

### 3. Mirror attachments during PostgreSQL sync

Extend `CellFeedbackSource.pull()` so it performs two reads for each feedback batch:

1. Pull feedback rows from `voice_feedback_records`
2. Pull attachment rows from `voice_feedback_attachments` for the fetched feedback ids

Attachment query rules:

- Filter by `feedback_id in (...)`
- Order by `feedback_id`, `display_order`, `created_at`, `id`
- Return only columns needed for mirroring:
  - `id`
  - `feedback_id`
  - `created_at`
  - `display_order`
  - `file_name`
  - `mime_type`
  - `file_size_bytes`
  - `file_blob`

`PulledFeedback` will gain an `attachments` array. Each pulled feedback row will carry its own ordered attachment list before entering the local save path.

### 4. Save attachments as part of feedback upsert

Extend `AutofixQueue.save()` so each mirrored feedback row syncs its attachments after the parent feedback upsert succeeds.

Save behavior:

- New feedback:
  - insert mirrored feedback row
  - insert all attachment child rows
- Existing feedback:
  - upsert attachments by stable identity
  - delete local child rows that no longer exist in the mirrored external set

Stable identity rules:

- PostgreSQL-sourced attachments use `(feedback_id, external_id)`
- Manual-imported attachments without `external_id` use their local generated ids and are replaced during a new manual import of the same feedback payload

The local mirror should behave like a full snapshot of the latest source state for that feedback item.

### 5. Treat attachments as valid executable input

Current queue blocking logic marks feedback as blocked when text and metadata are empty and audio cannot be used. That must change.

Revised executable-input rule:

- A feedback item is runnable if at least one of the following exists:
  - non-empty `recognized_text`
  - non-empty `meta`
  - at least one valid mirrored image attachment
  - eligible audio fallback

Revised blocking rule:

- A feedback item is blocked only when all of the above are unavailable

This allows image-only or GIF-only feedback to enter the queue.

### 6. Build one shared Autofix input assembly path

Autofix should use one shared helper to assemble model input parts from a mirrored feedback item.

Input sources:

- text from `recognized_text`
- attachments from local `autofix_feedback_attachment`
- optional audio from the existing fallback logic

Part assembly rules:

1. Add one text part first
2. Add attachment file parts in `(display_order, created_at, external_id/local id)` order
3. Add audio file part last only when current fallback rules allow it

Attachment filtering rules:

- Forward only `image/*` attachments to the model
- Keep mirrored non-image attachments out of model parts
- Do not block execution merely because one attachment is invalid if others remain usable

This helper should be used by:

- `AutofixAnalyzer.analyze()`
- `AutofixExecutor.implement()`
- Harness `survey`
- Harness `planReview`
- Harness `review`
- Harness `gate`

This keeps every Autofix model stage looking at the same evidence set.

### 7. Restore mirrored attachments to temp files before prompting

Because `SessionPrompt.prompt()` accepts file parts, Autofix should restore mirrored attachment blobs to temporary files before building prompt parts.

Recommended behavior:

- Write temp files under `state/autofix/attachment/...`
- Preserve original file extension where available
- Derive a safe extension from MIME type when `file_name` is missing
- Return a temp attachment descriptor with:
  - `path`
  - `filename`
  - `mime`
  - `size`

Temp attachment lifecycle:

- Create temp files only for the current run
- Reuse runner cleanup to delete them after completion, stop, or failure

GIF handling:

- Autofix should pass GIF attachments as normal `image/gif` file parts
- `packages/opencode/src/session/prompt.ts` already extracts key frames for animated GIFs
- Autofix must not implement a second GIF frame extraction layer

### 8. Manual import support

Manual import will support attachments through the existing JSON payload.

Example shape:

```json
{
  "items": [
    {
      "external_id": 10001,
      "recognized_text": "设置页切换语言后，文案没有立即刷新。",
      "attachments": [
        {
          "display_order": 0,
          "file_name": "case-1.png",
          "mime_type": "image/png",
          "file_blob_base64": "..."
        },
        {
          "display_order": 1,
          "file_name": "recording.gif",
          "mime_type": "image/gif",
          "file_blob_base64": "..."
        }
      ]
    }
  ]
}
```

Validation rules:

- Require `mime_type`
- Require non-empty `file_blob_base64`
- Accept only `image/*` for now
- Default `display_order` to `0`
- Derive `file_size_bytes` from decoded content if not provided

### 9. Error handling

Error handling should prefer partial success over blocking the whole feedback item.

Rules:

- If one attachment is unreadable or cannot be restored to a temp file:
  - log an Autofix event
  - skip that attachment
  - continue with remaining valid inputs
- If all mirrored attachments are invalid and there is no text, no meta, and no eligible audio:
  - mark the feedback as blocked
- If PostgreSQL attachment sync fails for a feedback batch:
  - fail the sync batch rather than silently writing a partial mirror for that batch

This preserves local mirror consistency while keeping execution resilient.

## Implementation Outline

### Storage and schema

- Add `autofix_feedback_attachment` table and migration
- Add attachment runtime and API schemas
- Add attachment types for pulled feedback, temp attachments, and run context helpers

### PostgreSQL source

- Add attachment query support to `CellFeedbackSource.pull()`
- Map attachment rows into `PulledFeedback.attachments`

### Queue layer

- Save, update, list, and delete mirrored attachments with the parent feedback
- Include attachments in feedback reads and run detail reads
- Update queue note and status logic to treat attachments as valid input

### Execution layer

- Add shared prompt-part assembly for text, image/GIF attachments, and optional audio
- Use the shared helper from analyze, implement, and Harness entry points
- Restore attachment blobs to temp files and clean them up with the run

### API layer

- Extend feedback listing and run detail responses
- Extend manual import request validation

## Testing Plan

### Source tests

- Pull feedback with no attachments
- Pull feedback with multiple attachments
- Preserve attachment order by `display_order`, `created_at`, and id

### Queue tests

- Import feedback with attachments
- Upsert existing feedback and replace changed attachment sets
- Delete attachments removed from the source snapshot
- Keep image-only feedback queued instead of blocked

### Execution tests

- Analyzer receives text plus attachment file parts
- Executor receives text plus attachment file parts
- Harness receives the same attachments as analysis and implementation
- GIF attachments are forwarded as `image/gif` and rely on shared prompt handling

### Route and schema tests

- Manual import accepts image and GIF attachments
- Feedback list includes attachment metadata
- Run detail includes attachment metadata through the linked feedback object

## Risks and Mitigations

### Local database growth

Mirroring binary blobs increases local storage usage.

Mitigation:

- Limit support to image attachments only for now
- Keep cascade delete behavior on feedback deletion and reset
- Store only one mirrored snapshot per attachment record

### Sync consistency

A feedback row and its attachments must remain in sync.

Mitigation:

- Treat each feedback item as a snapshot unit during save
- Avoid writing attachment rows without a successfully upserted parent feedback

### Provider compatibility

Some models may not support image input.

Mitigation:

- Continue relying on the existing provider capability filtering in session message transformation
- Unsupported-image models will receive the current explicit error text behavior instead of crashing

## Acceptance Criteria

- Syncing feedback from PostgreSQL mirrors `voice_feedback_attachments` locally.
- Manual import can include image and GIF attachments.
- Feedback with only image or GIF attachments is runnable.
- Autofix analysis, implementation, and Harness stages all receive the mirrored attachments.
- GIF attachments are passed through and analyzed through the existing session prompt GIF handling.
- Feedback delete and reset flows remove mirrored local attachments together with their parent feedback state.
