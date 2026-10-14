CREATE TABLE IF NOT EXISTS cards (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL,
  external_id text UNIQUE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  repo jsonb,
  source text,
  original_link text,
  priority text NOT NULL DEFAULT 'normal',
  kind jsonb NOT NULL,
  screening jsonb,
  rank text NOT NULL,
  state jsonb NOT NULL,
  state_version integer NOT NULL DEFAULT 0,
  slot smallint GENERATED ALWAYS AS ((state->>'slot')::smallint) STORED,
  CONSTRAINT slot_in_range CHECK (slot IS NULL OR (slot >= 1 AND slot <= 3)),
  CONSTRAINT one_card_per_slot UNIQUE (slot)
);

CREATE INDEX IF NOT EXISTS cards_rank ON cards (rank, id);
