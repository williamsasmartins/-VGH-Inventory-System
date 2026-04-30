-- Migration 4: Quotes table for saved Quote Builder documents

CREATE TABLE IF NOT EXISTS quotes (
  id          uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  project_name text         NOT NULL DEFAULT '',
  description  text         NOT NULL DEFAULT '',
  store        text         NOT NULL DEFAULT 'Kenroc',
  mat_items    jsonb        NOT NULL DEFAULT '[]',
  lab_items    jsonb        NOT NULL DEFAULT '[]',
  grand_total  numeric(10,2) NOT NULL DEFAULT 0,
  created_at   timestamptz  DEFAULT now()
);

-- Allow public read/write (same pattern as other tables in this project)
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on quotes"
  ON quotes FOR ALL
  USING (true)
  WITH CHECK (true);

-- Grant access to anon and authenticated roles
GRANT ALL ON TABLE quotes TO anon, authenticated;
