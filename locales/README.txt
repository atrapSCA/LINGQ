Jazykové texty doplňku
======================

Každý soubor = jeden jazyk rozhraní:
  cs.json  Čeština (zdrojová / mateřská verze textů)
  en.json  English
  de.json  Deutsch
  fr.json  Français
  es.json  Español

Jak upravit text
----------------
1. Otevřete příslušný .json soubor.
2. Najděte klíč (např. "import.known").
3. Změňte jen hodnotu vpravo — klíč neměňte.
4. Uložte soubor a v Chrome obnovte doplněk (chrome://extensions → Reload).

Pravidla
--------
- Klíče musí být stejné ve všech jazycích.
- Placeholdery jako {n}, {from}, {version} v textu ponechte.
- HTML (odkazy) je u některých klíčů záměrně (data-i18n-html).
- Nový jazyk: přidejte locales/xx.json a doplňte kód do LOCALES v i18n.js.

Ve skriptech (app.js, background.js, content.js, …) se texty neukládají —
jen se volá t('klíč') / bt('klíč') nebo data-i18n="klíč" v HTML.

Výjimky (záměrně ne v locale):
- názvy produktů: LingQ, ChatGPT, Supabase, API
- anglické promptové instrukce pro ChatGPT API (ne UI)
- CSS třídy, URL, SQL soubory, technické identifikátory
