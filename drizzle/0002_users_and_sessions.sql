CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  github_id bigint NOT NULL,
  login text NOT NULL,
  name text,
  avatar_url text,
  created_at timestamptz NOT NULL,
  last_sign_in_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS users_github_id ON users (github_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions (user_id);
