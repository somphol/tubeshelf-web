# Manual end-to-end check

The app has no build step and no npm dependency. Unit tests cover the data layer:

```bash
node --test tests/
```

For browser checks, serve the folder and drive a real Chrome with `puppeteer-core`.
Install it in a disposable scratch folder so the app itself stays dependency-free:

```bash
mkdir -p /tmp/rw-check && cd /tmp/rw-check
npm init -y && npm i puppeteer-core
```

Chrome headless clamps `--window-size` to 500 CSS px, so use `page.setViewport`
for narrow checks. Write the scratch script there; it is not part of the repo.

```bash
python3 -m http.server 8770
```

## Flow verified 2026-11-15

1. Open `http://localhost:8770/`, click **Open the demo shelf**.
   Expect 7 cards, 1 course, no console errors.
2. Open the first card. The **Your categories** chips and the type-ahead list the
   shelf's categories. Set the note to `Edited on the web`, type `Test Tag` and
   press Return, press **Save**. Expect `· Edited`, an enabled Undo and the tag
   on the card. Re-open and confirm `Test Tag` appears under Your categories.
3. Wait ~1.5 s, open a **second tab** to the same URL. The shelf restores
   automatically (landing hidden, 7 cards) with a **Restored last session**
   banner. The filter/search/page should match the first tab. Press **Keep**.
   (A reload in a dirty tab triggers the beforeunload prompt; accept it.)
4. **Add video**, paste `https://www.youtube.com/watch?v=kJQP7kiw5Fk`, press
   **Fetch details**. Expect title/channel from oEmbed within ~3 s. Leave the
   categories empty, press **Add to shelf**; expect the confirmation
   “No category selected…”, dismiss it, and confirm the card count is unchanged.
   Pick an existing category chip, add it, and confirm 8 cards.
5. Press **Export backup**. Expect `TubeShelf YYYY-MM-DD HH.MM.SS.json` in the
   download folder with 8 videos, the edited note/tag and the new video.
6. Delete the demo card, press Undo; the card returns.
7. Thumbnail fallback: load a one-video backup for `nwjAHQERL08`. Its maxres is a
   404 body; the card must end on `hqdefault.jpg` with `naturalWidth` 480, not a
   grey 120×90 tile. `dQw4w9WgXcQ` must stay on `maxresdefault.jpg` (1280).

## Notes from the first pass

- oEmbed CORS works from `http://localhost:8770` and the Pages origin; the watch
  page does not, so description/duration are unavailable.
- `newVideo` uses `crypto.randomUUID()`; all origins used are secure contexts.
- CSP allows only `self` scripts, `unsafe-inline` styles for progress widths,
  `i.ytimg.com` images, and `youtube.com`/`youtube-nocookie.com` for oEmbed.
- Export downloads are not blocked by the CSP.
- The draft key is currently a single `draft` record; opening a different shelf
  replaces it. Phase 2 should key by file identity.
