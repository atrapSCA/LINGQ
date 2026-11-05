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

  INSERT INTO public.words AS w (word, language, translation, status, view_count, lingq_card_id)
  VALUES (
    normalized,
    COALESCE(NULLIF(btrim(p_language), ''), 'en'),
    NULLIF(btrim(COALESCE(p_translation, '')), ''),
    COALESCE(p_status, 1),
    1,
    p_lingq_card_id
  )
  ON CONFLICT (word, language) DO UPDATE SET
    view_count = w.view_count + 1,
    translation = COALESCE(EXCLUDED.translation, w.translation),
    status = COALESCE(EXCLUDED.status, w.status),
    lingq_card_id = COALESCE(EXCLUDED.lingq_card_id, w.lingq_card_id),
    updated_at = now()
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

  INSERT INTO public.words AS w (word, language, translation, status, view_count, lingq_card_id)
  VALUES (
    normalized,
    COALESCE(NULLIF(btrim(p_language), ''), 'en'),
    NULLIF(btrim(COALESCE(p_translation, '')), ''),
    COALESCE(p_status, 1),
    0,
    p_lingq_card_id
  )
  ON CONFLICT (word, language) DO UPDATE SET
    translation = COALESCE(EXCLUDED.translation, w.translation),
    status = COALESCE(EXCLUDED.status, w.status),
    lingq_card_id = COALESCE(EXCLUDED.lingq_card_id, w.lingq_card_id),
    updated_at = now()
  RETURNING * INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.touch_word(text, text, text, integer, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_word_fields(text, text, text, integer, bigint) TO anon, authenticated;
