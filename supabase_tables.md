## Table `orders`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `stripe_payment_intent_id` | `text` |  Nullable Unique |
| `user_id` | `uuid` |  Nullable |
| `services` | `_text` |  |
| `page_count` | `int4` |  Nullable |
| `amount_brl` | `numeric` |  |
| `status` | `text` |  |
| `is_trial` | `bool` |  |
| `created_at` | `timestamptz` |  |

## Table `projects`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `uuid` |  |
| `order_id` | `uuid` |  Nullable Unique |
| `services` | `_text` |  |
| `guideline` | `text` |  Nullable |
| `page_count` | `int4` |  Nullable |
| `status` | `text` |  |
| `original_file_name` | `text` |  Nullable |
| `original_file_path` | `text` |  Nullable |
| `processed_file_path` | `text` |  Nullable |
| `delete_files_at` | `timestamptz` |  Nullable |
| `files_deleted_at` | `timestamptz` |  Nullable |
| `references_pages` | `_int4` |  Nullable |
| `completed_at` | `timestamptz` |  Nullable |
| `created_at` | `timestamptz` |  |
| `selected_pages` | `_int4` |  Nullable |
| `title` | `text` |  Nullable |
| `pending_inputs` | `jsonb` | Nullable |
| `removed_inputs` | `jsonb` | Nullable |

## Table `user_profiles`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `trial_used_at` | `timestamptz` |  Nullable |
| `notification_preferences` | `jsonb` |  Nullable |

> Default value: `{"project_ready": true, "file_expiry": true}`. Null treated as all-on. Add column with: `ALTER TABLE user_profiles ADD COLUMN notification_preferences jsonb DEFAULT '{"project_ready":true,"file_expiry":true}'::jsonb;`

> `pending_inputs` stores `[{ id, kind, ordinal, insertedAt }]` — one entry per red placeholder paragraph inserted by the pipeline. Null when all resolved. Add with: `ALTER TABLE projects ADD COLUMN pending_inputs jsonb;`

> `removed_inputs` stores `[{ id, kind, removedAt }]` — audit trail of placeholders the user intentionally removed. Append-only; never cleared. Add with: `ALTER TABLE projects ADD COLUMN removed_inputs jsonb;`

