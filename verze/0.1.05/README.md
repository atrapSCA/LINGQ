# LingQ Click Translator

Chrome extension that looks up a clicked word in your LingQ vocabulary and shows its translation above the word. If the word is not in your vocabulary, it asks LingQ for a hint and creates a new LingQ with status 1.

## Setup

1. Open LingQ and sign in.
2. Open your account's API key page: https://www.lingq.com/en/accounts/apikey/
3. Copy the API key.
4. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this folder.
5. Click the extension icon, paste the API key, choose the language you are learning and the translation language, then save.

## Usage

- Click once on a normal word to look it up.
- Double-click a word that is part of a link to look it up without opening the link.
- The result appears in a small tooltip above the word.
- Use the switch in the popup to pause the extension.

## Important API note

LingQ's current API is only partially documented and some vocabulary endpoints are not officially documented. The extension uses the current v3 cards and hints routes. If LingQ changes those routes or your account does not have access to them, the tooltip shows a readable error instead of silently failing.
