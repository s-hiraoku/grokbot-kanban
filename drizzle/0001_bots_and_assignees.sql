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

CREATE UNIQUE INDEX IF NOT EXISTS bots_name ON bots (lower(name));
