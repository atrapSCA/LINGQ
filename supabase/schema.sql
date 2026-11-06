-- Tabulka slovíček pro LingQ Click Translator (větev experiment)
CREATE TABLE IF NOT EXISTS public.words (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  word text NOT NULL,
  language text NOT NULL DEFAULT 'en',
  translation text,
  status integer NOT NULL DEFAULT 1,
  view_count integer NOT NULL DEFAULT 1,
  lingq_card_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT words_word_language_unique UNIQUE (word, language)
);

-- created_at = kdy bylo slovíčko vloženo
-- updated_at = kdy bylo naposledy editované (překlad / úroveň), ne při pouhém zobrazení
ALTER TABLE public.words
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.words
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.words
  ADD COLUMN IF NOT EXISTS import_note text;

ALTER TABLE public.words
  ADD COLUMN IF NOT EXISTS importance integer;

ALTER TABLE public.words
  ADD COLUMN IF NOT EXISTS popularity integer;

CREATE INDEX IF NOT EXISTS words_word_language_idx ON public.words (lower(word), language);

ALTER TABLE public.words ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS words_anon_all ON public.words;
CREATE POLICY words_anon_all ON public.words
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.words TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Při zobrazení bubliny: vloží nové slovo, nebo zvýší view_count
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
BEGIN
  IF normalized = '' THEN
    RAISE EXCEPTION 'word is required';
  END IF;

  INSERT INTO public.words AS w (word, language, translation, status, view_count, lingq_card_id, created_at, updated_at)
  VALUES (
    normalized,
    COALESCE(NULLIF(btrim(p_language), ''), 'en'),
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

  RETURN result;
END;
$$;

-- Při úpravě slovíčka: aktualizuje překlad/stav bez navyšování view_count
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
BEGIN
  IF normalized = '' THEN
    RAISE EXCEPTION 'word is required';
  END IF;

  INSERT INTO public.words AS w (word, language, translation, status, view_count, lingq_card_id, created_at, updated_at)
  VALUES (
    normalized,
    COALESCE(NULLIF(btrim(p_language), ''), 'en'),
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

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.touch_word(text, text, text, integer, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_word_fields(text, text, text, integer, bigint) TO anon, authenticated;

-- Hromadný import slovíček z LingQ — viz supabase/import_known_words.sql
-- term → word; hints[].text → translation; card.importance; hint.popularity
DROP FUNCTION IF EXISTS public.import_known_words(text, text[]);
DROP FUNCTION IF EXISTS public.import_lingq_words(text, text[], integer[]);
DROP FUNCTION IF EXISTS public.import_lingq_words(text, text[], integer[], text[]);

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
  bulk_note text := 'Hromadný import z LingQ';
  result jsonb;
BEGIN
  IF p_words IS NULL OR cardinality(p_words) = 0 THEN
    RETURN jsonb_build_object(
      'processed', 0,
      'inserted', 0,
      'updated', 0
    );
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
      GREATEST(1, LEAST(5, COALESCE(p_statuses[idx], 1))) AS status,
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
          status DESC,
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
      status = GREATEST(w.status, EXCLUDED.status),
      translation = CASE
        WHEN NULLIF(btrim(COALESCE(w.translation, '')), '') IS NULL THEN EXCLUDED.translation
        ELSE w.translation
      END,
      importance = COALESCE(w.importance, EXCLUDED.importance),
      popularity = COALESCE(w.popularity, EXCLUDED.popularity),
      updated_at = CASE
        WHEN GREATEST(w.status, EXCLUDED.status) IS DISTINCT FROM w.status
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

  RETURN COALESCE(result, jsonb_build_object('processed', 0, 'inserted', 0, 'updated', 0));
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_lingq_words(text, text[], integer[], text[], integer[], integer[]) TO anon, authenticated;
