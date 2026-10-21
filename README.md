# Prompt Enhancer — Chrome Extension

Turns a rough one-line prompt into a handful of sharp clarifying questions,
then weaves your answers into a single polished prompt you can paste
anywhere.

## Load it in Chrome

1. Unzip this folder somewhere permanent (don't delete it after loading — Chrome reads the files live).
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `prompt-enhancer` folder.
5. Click the extension icon in the toolbar, then click the ⚙ settings icon (or right-click the icon → Options).
6. Pick OpenAI, Anthropic, or Gemini, paste your API key, optionally set a model, and hit **Save Settings**.

That's it — no build step, no server.

## How to use it

**Popup:** Click the extension icon, type a rough prompt, optionally attach
files for context (see below), hit *Enhance*. Answer the questions it asks
(skip any that don't apply), then copy the final prompt.

**On any page:** Click into any textarea, text input, or editable text box
on a webpage — a small ✨ button appears at the top-right corner of the
field. Click it to open the same flow right there, pre-filled with whatever
you'd already typed. It only shows you the result to copy; it won't touch
the page's text box.

## Attaching files for extra context

Click **📎 Attach files** on the prompt step to add up to 4 files (5MB each,
15MB total) as context:

- **Images** (PNG/JPEG/WEBP/GIF) — sent directly to the AI so it can "see"
  them. Works with all three providers.
- **PDFs** — sent directly to the AI. Works with **Anthropic** and
  **Gemini**, which both understand PDFs natively. OpenAI's chat API doesn't
  accept PDFs directly, so a PDF attachment will be skipped if you're using
  OpenAI (you'll see a small warning next to the file).
- **Text files** (.txt, .md, .csv, .json) — read as plain text and folded
  into the prompt as context. Works with all three providers.

The attached files are used both when generating clarifying questions and
when writing the final prompt, so the AI can reference their contents
directly.

## Notes on the API key

- Your key is stored only in `chrome.storage.local` on your machine — it
  never goes through any server of mine, only directly from your browser to
  OpenAI's or Anthropic's API.
- Because it's a direct browser call, treat this like any local dev tool:
  fine for personal use, but don't hand this build to other people with
  your key baked in.
- If you ever want to publish this to the Chrome Web Store for other users,
  you'd want to swap this for a small backend that holds the key instead
  (happy to help with that if you get there).

## File map

- `manifest.json` — MV3 config
- `background.js` — service worker; makes the actual OpenAI/Anthropic calls
- `ui-core.js` — shared UI flow (prompt → questions → answers → result), used by both popup and the in-page panel
- `popup.html/js/css` — toolbar popup
- `options.html/js/css` — settings page (provider, API key, model)
- `content.js` + `content-panel.css` — injects the floating ✨ button and panel into every page via a Shadow DOM (so host-page CSS can't interfere)
- `shared.css` — shared visual styling/tokens
