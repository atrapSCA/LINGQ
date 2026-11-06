-- Druh měření: klasické kliknutí, nebo automatický dotaz při nečinnosti.
CREATE TABLE IF NOT EXISTS public.lingq_latency_kind (
  code text PRIMARY KEY,
  label text NOT NULL
);

INSERT INTO public.lingq_latency_kind (code, label) VALUES
  ('click', 'klasické kliknutí'),
  ('idle', 'automaticky při nečinnosti'),
  ('phrase', 'překlad věty')
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label;

-- Jednotlivá měření odezvy LingQ.
CREATE TABLE IF NOT EXISTS public.lingq_latency (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL REFERENCES public.lingq_latency_kind (code),
  word text,
  language text NOT NULL DEFAULT 'en',
  word_status text CHECK (word_status IS NULL OR word_status IN ('new', '1', '2', '3', '4', 'K')),
  duration_ms integer NOT NULL,
  ok boolean NOT NULL DEFAULT true,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lingq_latency
  ADD COLUMN IF NOT EXISTS word_status text;

ALTER TABLE public.lingq_latency
  ADD COLUMN IF NOT EXISTS kind text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'lingq_latency'
      AND column_name = 'source'
  ) THEN
    UPDATE public.lingq_latency
    SET kind = CASE WHEN source = 'probe' THEN 'idle' ELSE 'click' END
    WHERE kind IS NULL;
    ALTER TABLE public.lingq_latency ALTER COLUMN source DROP NOT NULL;
  ELSE
    UPDATE public.lingq_latency
    SET kind = 'click'
    WHERE kind IS NULL;
  END IF;
END $$;

ALTER TABLE public.lingq_latency ALTER COLUMN kind SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lingq_latency_kind_fkey'
  ) THEN
    ALTER TABLE public.lingq_latency
      ADD CONSTRAINT lingq_latency_kind_fkey
      FOREIGN KEY (kind) REFERENCES public.lingq_latency_kind (code);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS lingq_latency_language_created_idx
  ON public.lingq_latency (language, created_at DESC);

CREATE INDEX IF NOT EXISTS lingq_latency_kind_created_idx
  ON public.lingq_latency (kind, created_at DESC);

ALTER TABLE public.lingq_latency_kind ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lingq_latency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lingq_latency_kind_anon_read ON public.lingq_latency_kind;
CREATE POLICY lingq_latency_kind_anon_read ON public.lingq_latency_kind
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS lingq_latency_anon_all ON public.lingq_latency;
CREATE POLICY lingq_latency_anon_all ON public.lingq_latency
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON TABLE public.lingq_latency_kind TO anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.lingq_latency TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
