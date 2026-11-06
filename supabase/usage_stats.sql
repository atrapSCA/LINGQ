CREATE TABLE IF NOT EXISTS public.usage_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN ('view', 'create', 'edit', 'phrase')),
  word text,
  language text NOT NULL DEFAULT 'en',
  status integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_created_at_idx ON public.usage_events (created_at);
CREATE INDEX IF NOT EXISTS usage_events_language_created_idx ON public.usage_events (language, created_at);
CREATE INDEX IF NOT EXISTS usage_events_type_created_idx ON public.usage_events (event_type, created_at);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usage_events_anon_all ON public.usage_events;
CREATE POLICY usage_events_anon_all ON public.usage_events
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT ON TABLE public.usage_events TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

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

CREATE OR REPLACE FUNCTION public.touch_word(
  p_word text,
  p_language text,
  p_translation text DEFAULT NULL,
  p_status integer DEFAULT NULL,
  p_lingq_card_id bigint DEFAULT NULL
)
RETURNS public.words
LANGUAGE plpgsql
AS $$
DECLARE
  result public.words;
  normalized text := lower(btrim(p_word));
  lang text := COALESCE(NULLIF(btrim(p_language), ''), 'en');
  was_insert boolean := false;
BEGIN
  IF normalized = '' THEN
    RAISE EXCEPTION 'word is required';
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.words w WHERE w.word = normalized AND w.language = lang
  ) INTO was_insert;

  INSERT INTO public.words AS w (word, language, translation, status, view_count, lingq_card_id, created_at, updated_at)
  VALUES (
    normalized,
    lang,
    NULLIF(btrim(COALESCE(p_translation, '')), ''),
    COALESCE(p_status, 1),
    1,
    p_lingq_card_id,
    now(),
    now()
  )
  ON CONFLICT (word, language) DO UPDATE SET
    view_count = w.view_count + 1,
    translation = COALESCE(EXCLUDED.translation, w.translation),
    status = COALESCE(EXCLUDED.status, w.status),
    lingq_card_id = COALESCE(EXCLUDED.lingq_card_id, w.lingq_card_id),
    updated_at = CASE
      WHEN (EXCLUDED.translation IS NOT NULL AND EXCLUDED.translation IS DISTINCT FROM w.translation)
        OR (EXCLUDED.status IS NOT NULL AND EXCLUDED.status IS DISTINCT FROM w.status)
        OR (EXCLUDED.lingq_card_id IS NOT NULL AND EXCLUDED.lingq_card_id IS DISTINCT FROM w.lingq_card_id)
      THEN now()
      ELSE w.updated_at
    END
  RETURNING * INTO result;

  IF was_insert THEN
    INSERT INTO public.usage_events (event_type, word, language, status)
    VALUES ('create', result.word, result.language, result.status);
  END IF;

  INSERT INTO public.usage_events (event_type, word, language, status)
  VALUES ('view', result.word, result.language, result.status);

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_word_fields(
  p_word text,
  p_language text,
  p_translation text DEFAULT NULL,
  p_status integer DEFAULT NULL,
  p_lingq_card_id bigint DEFAULT NULL
)
RETURNS public.words
LANGUAGE plpgsql
AS $$
DECLARE
  result public.words;
  normalized text := lower(btrim(p_word));
  lang text := COALESCE(NULLIF(btrim(p_language), ''), 'en');
  old_translation text;
  old_status integer;
  old_card bigint;
  changed boolean := false;
BEGIN
  IF normalized = '' THEN
    RAISE EXCEPTION 'word is required';
  END IF;

  SELECT w.translation, w.status, w.lingq_card_id
  INTO old_translation, old_status, old_card
  FROM public.words w
  WHERE w.word = normalized AND w.language = lang;

  INSERT INTO public.words AS w (word, language, translation, status, view_count, lingq_card_id, created_at, updated_at)
  VALUES (
    normalized,
    lang,
    NULLIF(btrim(COALESCE(p_translation, '')), ''),
    COALESCE(p_status, 1),
    0,
    p_lingq_card_id,
    now(),
    now()
  )
  ON CONFLICT (word, language) DO UPDATE SET
    translation = COALESCE(EXCLUDED.translation, w.translation),
    status = COALESCE(EXCLUDED.status, w.status),
    lingq_card_id = COALESCE(EXCLUDED.lingq_card_id, w.lingq_card_id),
    updated_at = CASE
      WHEN (EXCLUDED.translation IS NOT NULL AND EXCLUDED.translation IS DISTINCT FROM w.translation)
        OR (EXCLUDED.status IS NOT NULL AND EXCLUDED.status IS DISTINCT FROM w.status)
        OR (EXCLUDED.lingq_card_id IS NOT NULL AND EXCLUDED.lingq_card_id IS DISTINCT FROM w.lingq_card_id)
      THEN now()
      ELSE w.updated_at
    END
  RETURNING * INTO result;

  IF old_translation IS NULL AND old_status IS NULL THEN
    changed := true;
  ELSE
    changed := (
      (p_translation IS NOT NULL AND NULLIF(btrim(p_translation), '') IS DISTINCT FROM old_translation)
      OR (p_status IS NOT NULL AND p_status IS DISTINCT FROM old_status)
      OR (p_lingq_card_id IS NOT NULL AND p_lingq_card_id IS DISTINCT FROM old_card)
    );
  END IF;

  IF changed THEN
    INSERT INTO public.usage_events (event_type, word, language, status)
    VALUES ('edit', result.word, result.language, result.status);
  END IF;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_usage_stats(text, timestamptz, timestamptz) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_word(text, text, text, integer, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_word_fields(text, text, text, integer, bigint) TO anon, authenticated;
