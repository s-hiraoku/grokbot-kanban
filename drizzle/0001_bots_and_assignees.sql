ALTER TABLE cards ADD COLUMN IF NOT EXISTS assignees jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS created_by text;

CREATE TABLE IF NOT EXISTS bots (
  id text PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL DEFAULT '',
  avatar text,
  color text NOT NULL,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz
);

-- Bot names are unique per user, and 0003 creates that index. This file once made them unique board-wide,
-- and since every file is applied again on each migrate, it must not bring that index back.
