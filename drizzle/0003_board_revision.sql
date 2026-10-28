CREATE TABLE IF NOT EXISTS board_revision (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  revision bigint NOT NULL DEFAULT 0,
  cursor_runs integer NOT NULL DEFAULT 0
);

INSERT INTO board_revision (id, revision, cursor_runs)
VALUES (true, 0, 0)
ON CONFLICT (id) DO NOTHING;

UPDATE board_revision
SET cursor_runs = (
  SELECT count(*)::int FROM cards WHERE jsonb_typeof(state->'cursorRun') = 'object'
)
WHERE id;
