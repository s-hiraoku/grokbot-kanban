CREATE TABLE IF NOT EXISTS board_revision (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0,
  cursor_runs integer NOT NULL DEFAULT 0
);

INSERT INTO board_revision (user_id, revision, cursor_runs)
SELECT user_id, 0, count(*) FILTER (WHERE jsonb_typeof(state->'cursorRun') = 'object')::int
FROM cards
WHERE user_id IS NOT NULL
GROUP BY user_id
ON CONFLICT (user_id) DO UPDATE
SET cursor_runs = EXCLUDED.cursor_runs;
