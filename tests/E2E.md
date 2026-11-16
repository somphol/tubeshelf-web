# Manual end-to-end check

The app has no runtime build step or dependency. Unit tests cover the data layer:

```bash
npm test
```

The committed Drive harness installs only dev dependencies and runs a real Chrome
against a fake Google OAuth + Drive API:

```bash
npm install
npm run serve        # in another terminal
npm run test:e2e
```

For the no-OAuth Google Drive folder (fake File System Access handle):

```bash
npm run test:e2e:folder
```

It chooses a folder, saves a timestamped backup, opens the latest, writes the
hourly `Local Sync` autosave and checks the shelf is marked clean. No OAuth or
Google Cloud project.

For the merge review:

```bash
npm run test:e2e:merge
```

It edits the demo note, opens a backup with a conflicting note plus a
favorite-only change, resolves the conflict, checks the merge is one undo step,
reloads to prove the base survived the draft, confirms a non-conflicting backup
applies without a modal, and checks the panel at 390 px.

For clipboard autofill (stubbed clipboard and oEmbed):

```bash
npm run test:e2e:clipboard
```

It opens **Add video** with a YouTube URL on the fake clipboard, asserts the URL
field fills, checks the title and channel resolve without a network call, types a
category without Return, and adds the video with that category and no warning.

For the sidebar:

```bash
npm run test:e2e:sidebar
```

It folds and reopens a section, hides and shows the bar, unpins it, checks the
650 ms pointer-leave auto-hide and left-edge reveal, pins it again, reloads to
prove folds and pin persist, and checks the flat 390 px strip.

For the slide deck (including card click and right-click):

```bash
npm run test:e2e:deck
```

It opens the demo, presses **Present**, checks 7 slides, arrow/Home/End/wheel
navigation, card-start, Escape, and the 390 px stacked layout with hidden arrow
buttons.

For the 3D view:

```bash
npm run test:e2e:graph
```

It opens the demo, waits for the WebGL canvas, asserts hub labels, clicks one,
checks the info card, returns to Grid and confirms the graph was destroyed.

The Drive harness asserts: connect creates/opens `TubeShelf Backups`; manual Save writes a
timestamped file; the hourly plan uploads an `Autosave (Web)` only when due and
marks the shelf clean; a disconnected save writes one local snapshot and no Drive
upload; Open latest loads it; reload restores the local session. No Google
credentials or personal shelf are used (demo content only).

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
   automatically (landing hidden, 7 cards, `local copy` in the file meta) with no
   banner. The filter/search/page should match the first tab. (A reload in a
   dirty tab triggers the beforeunload prompt; accept it.)
4. **Add video**, paste `https://www.youtube.com/watch?v=kJQP7kiw5Fk`, press
   **Fetch details**. Expect title/channel from oEmbed within ~3 s. Leave the
   categories empty, press **Add to shelf**; expect the confirmation
   “No category selected…”, dismiss it, and confirm the card count is unchanged.
   Pick an existing category chip, add it, and confirm 8 cards.
5. Press **Export backup**. Expect `TubeShelf YYYY-MM-DD HH.MM.SS-web.json` in the
   download folder with 8 videos, the edited note/tag and the new video. The demo
   has no profile name; loading a Mac file such as `TubeShelf My Shelf …json` adds
   `My Shelf` to the export name.
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
