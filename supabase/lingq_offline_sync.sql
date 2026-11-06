-- Offline režim bez LingQ: příznak needs_lingq_sync + RPC umí příznak nastavit/zrušit.
ALTER TABLE public.words
  ADD COLUMN IF NOT EXISTS needs_lingq_sync boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS words_needs_lingq_sync_idx
  ON public.words (language, needs_lingq_sync)
  WHERE needs_lingq_sync = true;

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
BEGIN
  IF normalized = '' THEN
    RAISE EXCEPTION 'word is required';
  END IF;

  INSERT INTO public.words AS w (
    word, language, translation, status, view_count, lingq_card_id, needs_lingq_sync, created_at, updated_at
  )
  VALUES (
    normalized,
    COALESCE(NULLIF(btrim(p_language), ''), 'en'),
    NULLIF(btrim(COALESCE(p_translation, '')), ''),
    COALESCE(p_status, 1),
    1,
    p_lingq_card_id,
    COALESCE(p_needs_lingq_sync, false),
    now(),
    now()
  )
  ON CONFLICT (word, language) DO UPDATE SET
    view_count = w.view_count + 1,
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
BEGIN
  IF normalized = '' THEN
    RAISE EXCEPTION 'word is required';
  END IF;

  INSERT INTO public.words AS w (
    word, language, translation, status, view_count, lingq_card_id, needs_lingq_sync, created_at, updated_at
  )
  VALUES (
    normalized,
    COALESCE(NULLIF(btrim(p_language), ''), 'en'),
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

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.touch_word(text, text, text, integer, bigint, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_word_fields(text, text, text, integer, bigint, boolean) TO anon, authenticated;

-- Staré podpisy (bez needs_lingq_sync) mohou zůstat; PostgREST bere shodu podle argumentů.
DROP FUNCTION IF EXISTS public.touch_word(text, text, text, integer, bigint);
DROP FUNCTION IF EXISTS public.update_word_fields(text, text, text, integer, bigint);
