-- Druh měření: kliknutí, nečinnost, překlad věty.
INSERT INTO public.lingq_latency_kind (code, label) VALUES
  ('click', 'klasické kliknutí'),
  ('idle', 'automaticky při nečinnosti'),
  ('phrase', 'překlad věty')
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label;

-- Úroveň znalosti u měření slovíčka: new / 1 / 2 / 3 / 4 / K
ALTER TABLE public.lingq_latency
  ADD COLUMN IF NOT EXISTS word_status text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lingq_latency_word_status_check'
  ) THEN
    ALTER TABLE public.lingq_latency
      ADD CONSTRAINT lingq_latency_word_status_check
      CHECK (word_status IS NULL OR word_status IN ('new', '1', '2', '3', '4', 'K'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS lingq_latency_word_status_idx
  ON public.lingq_latency (word_status, created_at DESC);

-- Počet překladů vět v usage_events
ALTER TABLE public.usage_events
  DROP CONSTRAINT IF EXISTS usage_events_event_type_check;

ALTER TABLE public.usage_events
  ADD CONSTRAINT usage_events_event_type_check
  CHECK (event_type IN ('view', 'create', 'edit', 'phrase'));

CREATE OR REPLACE FUNCTION public.get_usage_stats(
  p_language text DEFAULT 'en',
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  lang text := COALESCE(NULLIF(btrim(p_language), ''), 'en');
  range_from timestamptz := COALESCE(p_from, ((now() AT TIME ZONE 'Europe/Prague')::date - 29)::timestamp AT TIME ZONE 'Europe/Prague');
  range_to timestamptz := COALESCE(p_to, now());
BEGIN
  RETURN jsonb_build_object(
    'from', range_from,
    'to', range_to,
    'clicks', COALESCE((
      SELECT count(*)::int FROM public.usage_events e
      WHERE e.language = lang AND e.event_type = 'view'
        AND e.created_at >= range_from AND e.created_at < range_to
    ), 0),
    'phrases', COALESCE((
      SELECT count(*)::int FROM public.usage_events e
      WHERE e.language = lang AND e.event_type = 'phrase'
        AND e.created_at >= range_from AND e.created_at < range_to
    ), 0),
    'added', COALESCE((
      SELECT count(*)::int FROM public.words w
      WHERE w.language = lang
        AND w.created_at >= range_from AND w.created_at < range_to
    ), 0),
    'edited', COALESCE((
      SELECT count(*)::int FROM public.words w
      WHERE w.language = lang
        AND w.updated_at >= range_from AND w.updated_at < range_to
        AND w.updated_at > w.created_at + interval '1 second'
    ), 0),
    'active_days', COALESCE((
      SELECT count(DISTINCT ((e.created_at AT TIME ZONE 'Europe/Prague')::date))::int
      FROM public.usage_events e
      WHERE e.language = lang AND e.event_type IN ('view', 'phrase')
        AND e.created_at >= range_from AND e.created_at < range_to
    ), 0),
    'days', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('day', d.day, 'clicks', d.clicks) ORDER BY d.day)
      FROM (
        SELECT ((e.created_at AT TIME ZONE 'Europe/Prague')::date) AS day, count(*)::int AS clicks
        FROM public.usage_events e
        WHERE e.language = lang AND e.event_type = 'view'
          AND e.created_at >= range_from AND e.created_at < range_to
        GROUP BY 1
      ) d
    ), '[]'::jsonb),
    'total_words', COALESCE((SELECT count(*)::int FROM public.words w WHERE w.language = lang), 0),
    'status_1', COALESCE((SELECT count(*)::int FROM public.words w WHERE w.language = lang AND w.status = 1), 0),
    'status_2', COALESCE((SELECT count(*)::int FROM public.words w WHERE w.language = lang AND w.status = 2), 0),
    'status_3', COALESCE((SELECT count(*)::int FROM public.words w WHERE w.language = lang AND w.status = 3), 0),
    'status_4', COALESCE((SELECT count(*)::int FROM public.words w WHERE w.language = lang AND w.status = 4), 0),
    'status_5', COALESCE((SELECT count(*)::int FROM public.words w WHERE w.language = lang AND w.status = 5), 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_usage_stats(text, timestamptz, timestamptz) TO anon, authenticated;
