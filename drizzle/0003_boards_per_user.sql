-- Every card and Bot belongs to one user's board. Rows from before this file have no user yet, and the owner
-- (OWNER_GITHUB_LOGIN) takes them over at their next sign-in.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS cards_user_id ON cards (user_id);

-- External ids, Bot ids, and Bot names only need to be unique within one board.
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_external_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS cards_user_external_id ON cards (user_id, external_id);
ALTER TABLE bots DROP CONSTRAINT IF EXISTS bots_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS bots_user_id_id ON bots (user_id, id);
DROP INDEX IF EXISTS bots_name;
CREATE UNIQUE INDEX IF NOT EXISTS bots_user_name ON bots (user_id, lower(name));

-- Tokens a user makes for their Grok Bot connector. Only the SHA-256 of each token is kept.
CREATE TABLE IF NOT EXISTS bot_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  label text NOT NULL,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  last_used_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS bot_tokens_hash ON bot_tokens (token_hash);
CREATE INDEX IF NOT EXISTS bot_tokens_user_id ON bot_tokens (user_id);
