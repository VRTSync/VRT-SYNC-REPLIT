-- 0014_work_order_client_actions.sql
-- Adds cancel/decline lifecycle columns to tasks and creates task_comments table.
-- All DDL uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS guards for idempotency.

-- ── Cancel lifecycle columns ──────────────────────────────────────────────
-- Recorded when a client cancels their own unacknowledged work order.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cancelled_at  timestamp;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cancelled_by  varchar REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cancel_reason text;

-- ── Decline lifecycle columns ─────────────────────────────────────────────
-- Recorded when a client declines a contractor estimate.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS declined_at   timestamp;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS declined_by   varchar REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS decline_reason text;

-- ── Task comments table ───────────────────────────────────────────────────
-- Named task_comments (not work_order_comments) because a task is the shared
-- row across all product tiers — HOA residents see "request", crews see "task",
-- commercial clients see "work order".  One comment thread per task.
CREATE TABLE IF NOT EXISTS task_comments (
  id             varchar     PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id        varchar     NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_user_id varchar     NOT NULL REFERENCES users(id),
  body           text        NOT NULL,
  created_at     timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_comments_task_id_idx    ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS task_comments_created_at_idx ON task_comments(created_at);
