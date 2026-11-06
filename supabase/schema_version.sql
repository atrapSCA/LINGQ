-- Verze schématu doplňku LingQ Click Translator (pro kontrolu / instalaci z popup).
CREATE TABLE IF NOT EXISTS public.lingq_extension_meta (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lingq_extension_meta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lingq_extension_meta_anon_all ON public.lingq_extension_meta;
CREATE POLICY lingq_extension_meta_anon_all ON public.lingq_extension_meta
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON TABLE public.lingq_extension_meta TO anon, authenticated;

INSERT INTO public.lingq_extension_meta (key, value, updated_at)
VALUES ('schema_version', '4', now())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

-- Obnoví cache PostgREST (nové tabulky/funkce hned viditelné přes API).
NOTIFY pgrst, 'reload schema';
