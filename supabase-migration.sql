-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS rosters (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  week_start DATE NOT NULL UNIQUE,
  employees JSONB NOT NULL,
  departures JSONB NOT NULL DEFAULT '{}',
  arrivals JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE rosters;

-- RLS: open read; open write (client-side admin password gates mutations)
ALTER TABLE rosters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read" ON rosters
  FOR SELECT USING (true);

CREATE POLICY "public_insert" ON rosters
  FOR INSERT WITH CHECK (true);

CREATE POLICY "public_update" ON rosters
  FOR UPDATE USING (true);
