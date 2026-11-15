# AGENTS.md

Read this first; [README.md](README.md) explains the user-facing flow and
[PLAN.md](PLAN.md) the phases. This file is the handoff for whoever changes the
code next.

## What it is

A static, zero-build editor for TubeShelf backups. It loads the Mac app's JSON,
edits videos and categories in the browser, and exports a new timestamped backup.
It is **not** a server, sync client or YouTube client. Core editing needs no
account; Google Drive is the planned optional sync (not implemented yet).

## Current state (phase 1)

Implemented and manually verified on 2026-11-15:

- Raw parse/export with unknown-field preservation.
- Grid, categories, channels, favorites, unwatched, unsorted, search, paging.
- Video editor: categories + suggestions, note, favorite, watched, remove.
- Add by URL via YouTube oEmbed, duplicate guard.
- Category pin/rename/merge/delete; channel pins.
- IndexedDB draft with restore banner; timestamped export download.
- 35 unit tests; manual E2E notes in [tests/E2E.md](tests/E2E.md).

Not implemented: Google Drive sync/autosave, course editing, bulk selection,
in-place file save, redo UI, AI tagging.

## Commands

```bash
node --test tests/                 # unit tests, no install
python3 -m http.server 8770        # ES modules need http://
open http://localhost:8770/
python3 scripts/sync-taxonomy.py   # regenerate taxonomy from ../tubeshelf
python3 scripts/sync-taxonomy.py --check
```

There is no build, bundler or runtime dependency. Do not add one without a strong
reason; the value is that the whole app is auditable in one sitting.

## Architecture

- `src/format.js` — decode/validate, raw `parseBackup`, `buildBackup`, display
  normalisers, thumbnails. Pure.
- `src/store.js` — raw document state, mutations, canonical tags, pins, category
  rename/merge/delete, undo/redo, counts. Every mutation bumps `revision` and
  `dirty`; unknown JSON fields survive.
- `src/tagger.js` — deterministic port of `HeuristicTagger`, `GuestNameExtractor`
  and `FormatTagger`. No network.
- `src/taxonomy.js` / `.json` — generated from the Mac's `TagTaxonomy.swift`.
  Never edit by hand; run `scripts/sync-taxonomy.py`.
- `src/shelf.js` — filters, search, paging. Pure, copied from the read-only app.
- `src/app.js` — DOM rendering, modals, session copy, export, keyboard.
- `src/demo.js` — seven public videos; the only content shipped.
- `index.html`, `styles.css` — shell and layout. System fonts only.

Flow: `parseBackup → createStore → render → mutate → scheduleDraft/export`.

## Decisions and constraints

- **The Mac app owns the format.** `parseBackup` keeps the raw library, videos and
  playlists; edits patch known fields only. `buildBackup` spreads the original
  envelope/library so future fields survive. Never normalise into a new object and
  re-encode from scratch.
- **Export creates a new timestamped file.** Do not overwrite the file you loaded.
  The workflow is one writer at a time; the Mac's restore copies the replaced
  shelf aside.
- **Export is a download.** File System Access “save in place” is not implemented;
  do not pretend the browser wrote the original file.
- **oEmbed only.** `youtube.com/oembed` sends CORS headers (verified for localhost
  and Pages). The watch page does not, so description and duration are unavailable
  in the browser. New videos get `durationSeconds: null`.
- **No AI in the browser.** The Mac model cannot run here. The ported tagger is
  the floor; keep it conservative. Do not add a cloud key or proxy without an
  explicit decision.
- **Taxonomy is generated.** Category names, keywords, parents and aliases come
  from the Swift file. If the Mac taxonomy changes, run the sync script and commit
  both generated files.
- **Guest rules are deliberate.** Titles and the user's note are the only text
  available. Honorifics/credentials are stripped; one-word stage names keep their
  title; `with`, `ft.`, `feat.`, colon prefixes, `|` sides and numbered-episode
  suffixes are supported. The `u` regex flag is required for `\p{Lu}`.
- **Categories rewrite everywhere.** Rename/merge/delete update videos, courses
  and pins. Merging never deletes a category with no target; the UI requires a
  target.
- **The local copy is automatic.** A single IndexedDB record under `draft` holds
  the last shelf, written 1.2 s after load or change. On boot it is restored
  automatically, with a banner offering **Keep** or **Forget**. The record stores
  `dirty` so an exported shelf reloads without the Edited marker or beforeunload
  prompt. Export keeps the record; only Forget clears it. View state (filter,
  query, scope, page, sidebar query) lives in `localStorage` under
  `tubeshelf-rw-view` and is restored with the shelf. Known gap: one slot, not
  keyed per file.
- **Thumbnails use the 120 px rule.** YouTube can answer a missing maxres with
  HTTP 404 plus a decodable 120×90 grey image, so `coverImage` advances on
  `naturalWidth <= 120`, then on `error`. Same rule as the Mac app.
- **Security.** All file-derived strings render with `textContent`; no
  `innerHTML`. CSP allows only self scripts, inline styles (progress widths),
  `i.ytimg.com` images and YouTube oEmbed. Do not add remote fonts or analytics.
- **No personal data in the repo.** The demo is public YouTube links only. Never
  commit a real backup, thumbnail cache, token or Drive file ID.

## Google Drive plan (phase 2, not built)

Read [PLAN.md](PLAN.md) for the full design. Summary:

- Picker + `drive.file` by default; full `drive` scope opt-in for automatic
  newest-file listing.
- One-time Google Cloud setup; OAuth token in memory; file/folder IDs only in
  IndexedDB. No refresh token, no backend.
- New timestamped files in `My Drive/TubeShelf Backups`; never overwrite.
- Hourly autosave only when `revision` changed, named
  `TubeShelf Autosave (Web) YYYY-MM-DD HH.MM.SS.json`; retain 24 per device;
  never delete Mac autosaves or manual backups.
- Validate `drive.file` folder creation with a real account **before** building
  the editor around it. If it fails, Picker mode falls back to in-place save;
  full scope handles folder creation.
- CSP must add `accounts.google.com`, `apis.google.com`, `www.googleapis.com`
  and the Picker iframe.

## Known issues

- Courses are counted but not shown or editable; a course-only category opens an
  empty video grid.
- No bulk selection, no redo button, no file picker “save”.
- The local copy is one global slot; loading a second shelf replaces it after the
  1.2 s debounce.
- Category UI uses `prompt`/`confirm`; acceptable now, replace with a dialog for
  polish.
- Tag suggestions cannot see YouTube descriptions, so description-only guests
  (e.g. JRE #2501 without the title suffix) are missed. The numbered-episode
  suffix covers most podcast titles.
- No virtualised grid; fine for a few thousand videos, untested beyond that.
- The app has no automated browser test; use [tests/E2E.md](tests/E2E.md).

## Continuity

- Repository: <https://github.com/somphol/tubeshelf-web-rw> (public, Pages from
  `main`). Live: <https://somphol.github.io/tubeshelf-web-rw/>.
- Mac app: <https://github.com/somphol/tubeshelf> (public; unsigned arm64 release,
  MIT, see its `DISCLAIMER.md`).
- Read-only viewer: <https://somphol.github.io/tubeshelf-web-ro/>.
- Local checkout: `/Users/somphol/Projects/tubeshelf-web-rw` — the remote is the
  master copy; do not leave work only on this disk.
- Data: none in the repo. Real backups stay on the user's disk or Drive.
- Deploy: push to `main`; GitHub Pages serves the repo root. No workflow file.

## Verification before a push

```bash
node --test tests/
python3 scripts/sync-taxonomy.py --check
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8770/   # with server
```

Then run the six steps in [tests/E2E.md](tests/E2E.md) and confirm no console
errors. A change to `format.js`, `store.js` or `tagger.js` needs a unit test.
