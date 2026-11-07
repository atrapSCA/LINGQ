-- Ignored slovíčka: status = -1 (stejně jako LingQ API).
-- Neobjevují se ve slovníku, statistikách ani v podbarvení stránky.

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
        AND (e.status IS NULL OR e.status <> -1)
    ), 0),
    'phrases', COALESCE((
      SELECT count(*)::int FROM public.usage_events e
      WHERE e.language = lang AND e.event_type = 'phrase'
        AND e.created_at >= range_from AND e.created_at < range_to
    ), 0),
    'added', COALESCE((
      SELECT count(*)::int FROM public.words w
      WHERE w.language = lang
        AND w.status <> -1
        AND w.created_at >= range_from AND w.created_at < range_to
    ), 0),
    'edited', COALESCE((
      SELECT count(*)::int FROM public.words w
      WHERE w.language = lang
        AND w.status <> -1
        AND w.updated_at >= range_from AND w.updated_at < range_to
        AND w.updated_at > w.created_at + interval '1 second'
    ), 0),
    'active_days', COALESCE((
      SELECT count(DISTINCT ((e.created_at AT TIME ZONE 'Europe/Prague')::date))::int
      FROM public.usage_events e
      WHERE e.language = lang AND e.event_type IN ('view', 'phrase')
        AND e.created_at >= range_from AND e.created_at < range_to
        AND (e.event_type = 'phrase' OR e.status IS NULL OR e.status <> -1)
    ), 0),
    'days', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('day', d.day, 'clicks', d.clicks) ORDER BY d.day)
      FROM (
        SELECT ((e.created_at AT TIME ZONE 'Europe/Prague')::date) AS day, count(*)::int AS clicks
        FROM public.usage_events e
        WHERE e.language = lang AND e.event_type = 'view'
          AND e.created_at >= range_from AND e.created_at < range_to
          AND (e.status IS NULL OR e.status <> -1)
        GROUP BY 1
      ) d
    ), '[]'::jsonb),
    'total_words', COALESCE((
      SELECT count(*)::int FROM public.words w
      WHERE w.language = lang AND w.status <> -1
    ), 0),
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
  p_lingq_card_id bigint DEFAULT NULL,
  p_needs_lingq_sync boolean DEFAULT NULL
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

  INSERT INTO public.words AS w (
    word, language, translation, status, view_count, lingq_card_id, needs_lingq_sync, created_at, updated_at
  )
  VALUES (
    normalized,
    lang,
    NULLIF(btrim(COALESCE(p_translation, '')), ''),
    COALESCE(p_status, 1),
    1,
    p_lingq_card_id,
    COALESCE(p_needs_lingq_sync, false),
    now(),
    now()
  )
  ON CONFLICT (word, language) DO UPDATE SET
    view_count = CASE
      WHEN w.status = -1 OR COALESCE(EXCLUDED.status, w.status) = -1 THEN w.view_count
      ELSE w.view_count + 1
    END,
    translation = COALESCE(EXCLUDED.translation, w.translation),
    status = COALESCE(EXCLUDED.status, w.status),
    lingq_card_id = COALESCE(EXCLUDED.lingq_card_id, w.lingq_card_id),
    needs_lingq_sync = CASE
      WHEN p_needs_lingq_sync IS NULL THEN w.needs_lingq_sync
      ELSE p_needs_lingq_sync
    END,
    updated_at = CASE
      WHEN (EXCLUDED.translation IS NOT NULL AND EXCLUDED.translation IS DISTINCT FROM w.translation)
        OR (EXCLUDED.status IS NOT NULL AND EXCLUDED.status IS DISTINCT FROM w.status)
        OR (EXCLUDED.lingq_card_id IS NOT NULL AND EXCLUDED.lingq_card_id IS DISTINCT FROM w.lingq_card_id)
        OR (p_needs_lingq_sync IS NOT NULL AND p_needs_lingq_sync IS DISTINCT FROM w.needs_lingq_sync)
      THEN now()
      ELSE w.updated_at
    END
  RETURNING * INTO result;

  IF result.status IS DISTINCT FROM -1 THEN
    IF was_insert THEN
      INSERT INTO public.usage_events (event_type, word, language, status)
      VALUES ('create', result.word, result.language, result.status);
    END IF;
    INSERT INTO public.usage_events (event_type, word, language, status)
    VALUES ('view', result.word, result.language, result.status);
  END IF;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_word_fields(
  p_word text,
  p_language text,
  p_translation text DEFAULT NULL,
  p_status integer DEFAULT NULL,
  p_lingq_card_id bigint DEFAULT NULL,
  p_needs_lingq_sync boolean DEFAULT NULL
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

  INSERT INTO public.words AS w (
    word, language, translation, status, view_count, lingq_card_id, needs_lingq_sync, created_at, updated_at
  )
  VALUES (
    normalized,
    lang,
    NULLIF(btrim(COALESCE(p_translation, '')), ''),
    COALESCE(p_status, 1),
    0,
    p_lingq_card_id,
    COALESCE(p_needs_lingq_sync, false),
    now(),
    now()
  )
  ON CONFLICT (word, language) DO UPDATE SET
    translation = COALESCE(EXCLUDED.translation, w.translation),
    status = COALESCE(EXCLUDED.status, w.status),
    lingq_card_id = COALESCE(EXCLUDED.lingq_card_id, w.lingq_card_id),
    needs_lingq_sync = CASE
      WHEN p_needs_lingq_sync IS NULL THEN w.needs_lingq_sync
      ELSE p_needs_lingq_sync
    END,
    updated_at = CASE
      WHEN (EXCLUDED.translation IS NOT NULL AND EXCLUDED.translation IS DISTINCT FROM w.translation)
        OR (EXCLUDED.status IS NOT NULL AND EXCLUDED.status IS DISTINCT FROM w.status)
        OR (EXCLUDED.lingq_card_id IS NOT NULL AND EXCLUDED.lingq_card_id IS DISTINCT FROM w.lingq_card_id)
        OR (p_needs_lingq_sync IS NOT NULL AND p_needs_lingq_sync IS DISTINCT FROM w.needs_lingq_sync)
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

  IF changed
    AND result.status IS DISTINCT FROM -1
    AND COALESCE(old_status, 0) IS DISTINCT FROM -1
  THEN
    INSERT INTO public.usage_events (event_type, word, language, status)
    VALUES (
      CASE WHEN old_translation IS NULL AND old_status IS NULL THEN 'create' ELSE 'edit' END,
      result.word,
      result.language,
      result.status
    );
  END IF;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.import_lingq_words(
  p_language text,
  p_words text[],
  p_statuses integer[],
  p_translations text[] DEFAULT NULL,
  p_importance integer[] DEFAULT NULL,
  p_popularity integer[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  lang text := COALESCE(NULLIF(btrim(p_language), ''), 'en');
  bulk_note text := 'lingq-import';
  result jsonb;
BEGIN
  IF p_words IS NULL OR cardinality(p_words) = 0 THEN
    RETURN jsonb_build_object('processed', 0, 'inserted', 0, 'updated', 0);
  END IF;

  IF p_statuses IS NULL OR cardinality(p_statuses) <> cardinality(p_words) THEN
    RAISE EXCEPTION 'p_words and p_statuses must have the same length';
  END IF;

  IF p_translations IS NOT NULL AND cardinality(p_translations) <> cardinality(p_words) THEN
    RAISE EXCEPTION 'p_translations must be NULL or the same length as p_words';
  END IF;

  IF p_importance IS NOT NULL AND cardinality(p_importance) <> cardinality(p_words) THEN
    RAISE EXCEPTION 'p_importance must be NULL or the same length as p_words';
  END IF;

  IF p_popularity IS NOT NULL AND cardinality(p_popularity) <> cardinality(p_words) THEN
    RAISE EXCEPTION 'p_popularity must be NULL or the same length as p_words';
  END IF;

  WITH incoming AS (
    SELECT
      lower(btrim(p_words[idx])) AS word,
      CASE
        WHEN COALESCE(p_statuses[idx], 1) = -1 THEN -1
        ELSE GREATEST(1, LEAST(5, COALESCE(p_statuses[idx], 1)))
      END AS status,
      NULLIF(btrim(COALESCE(p_translations[idx], '')), '') AS translation,
      p_importance[idx] AS importance,
      p_popularity[idx] AS popularity
    FROM generate_subscripts(p_words, 1) AS idx
    WHERE NULLIF(btrim(p_words[idx]), '') IS NOT NULL
  ),
  ranked AS (
    SELECT
      word,
      status,
      translation,
      importance,
      popularity,
      ROW_NUMBER() OVER (
        PARTITION BY word
        ORDER BY
          CASE WHEN status = -1 THEN -100 ELSE status END DESC,
          (translation IS NOT NULL) DESC,
          COALESCE(popularity, -1) DESC,
          COALESCE(importance, -1) DESC
      ) AS rn
    FROM incoming
  ),
  merged AS (
    SELECT word, status, translation, importance, popularity
    FROM ranked
    WHERE rn = 1
  ),
  upserted AS (
    INSERT INTO public.words AS w (
      word, language, translation, status, view_count, import_note, importance, popularity, created_at, updated_at
    )
    SELECT
      m.word,
      lang,
      m.translation,
      m.status,
      0,
      bulk_note,
      m.importance,
      m.popularity,
      now(),
      now()
    FROM merged m
    ON CONFLICT (word, language) DO UPDATE SET
      status = CASE
        WHEN EXCLUDED.status = -1 THEN -1
        WHEN w.status = -1 THEN EXCLUDED.status
        ELSE GREATEST(w.status, EXCLUDED.status)
      END,
      translation = CASE
        WHEN NULLIF(btrim(COALESCE(w.translation, '')), '') IS NULL THEN EXCLUDED.translation
        ELSE w.translation
      END,
      importance = COALESCE(w.importance, EXCLUDED.importance),
      popularity = COALESCE(w.popularity, EXCLUDED.popularity),
      updated_at = CASE
        WHEN (
          CASE
            WHEN EXCLUDED.status = -1 THEN -1
            WHEN w.status = -1 THEN EXCLUDED.status
            ELSE GREATEST(w.status, EXCLUDED.status)
          END
        ) IS DISTINCT FROM w.status
          OR (
            NULLIF(btrim(COALESCE(w.translation, '')), '') IS NULL
            AND EXCLUDED.translation IS NOT NULL
          )
          OR (w.importance IS NULL AND EXCLUDED.importance IS NOT NULL)
          OR (w.popularity IS NULL AND EXCLUDED.popularity IS NOT NULL)
        THEN now()
        ELSE w.updated_at
      END
    RETURNING (xmax = 0) AS was_insert
  )
  SELECT jsonb_build_object(
    'processed', COALESCE(count(*)::int, 0),
    'inserted', COALESCE(count(*) FILTER (WHERE was_insert)::int, 0),
    'updated', COALESCE(count(*) FILTER (WHERE NOT was_insert)::int, 0)
  )
  INTO result
  FROM upserted;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_usage_stats(text, timestamptz, timestamptz) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_word(text, text, text, integer, bigint, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_word_fields(text, text, text, integer, bigint, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_lingq_words(text, text[], integer[], text[], integer[], integer[]) TO anon, authenticated;
