# AGENTS.md

Read this first; [README.md](README.md) explains the user-facing flow and
[PLAN.md](PLAN.md) the phases. This file is the handoff for whoever changes the
code next.

## What it is

A static, zero-build editor for TubeShelf backups. It loads the Mac app's JSON,
edits videos and categories in the browser, and exports a new timestamped backup.
It is **not** a server or YouTube client. Core editing needs no account; Google
Drive is optional and implemented (OAuth client required). The shared folder is
intended to be the same `My Drive/TubeShelf Backups` folder that Google Drive for
Desktop syncs to the Mac.

## Current state (phase 1)

Implemented and manually verified on 2026-11-15:

- Raw parse/export with unknown-field preservation.
- Grid, categories, channels, favorites, unwatched, unsorted, search, paging.
- Video editor: categories + suggestions, note, favorite, watched, remove.
- Add by URL via YouTube oEmbed, duplicate guard.
- Category pin/rename/merge/delete; channel pins.
- Slide deck: **Present** from the header or a card; arrow keys, Home/End, wheel
  and filmstrip; tags filter, Edit/Play actions, Esc returns. Video slides only.
- IndexedDB local copy with automatic restore; timestamped export download.
- Google Drive: OAuth (Picker/`drive.file` or full `drive`), folder listing,
  open-latest, manual timestamped save, hourly change-only autosave, retention 24.
- Local snapshots when Drive is unavailable: hourly, change-only, newest 24,
  open/download/delete, Snapshot now.
- Drive-first landing when configured; local file always beside it.
- Existing-category chips and type-ahead in the editor/add sheet; learned
  keyword profiles from the person's own filing and channel affinity.
- A new video with no category requires confirmation before it becomes Unsorted.
- 54 unit tests; manual E2E notes in [tests/E2E.md](tests/E2E.md).

Not implemented: live OAuth verification (no credentials in the repo), course
editing, bulk selection, in-place file save, redo UI, AI tagging.

## Commands

```bash
npm test                           # 54 unit tests (dev-only puppeteer dependency)
python3 -m http.server 8770        # ES modules need http://
open http://localhost:8770/
npm run test:e2e                   # fake Google OAuth + Drive, server must be running
npm run test:e2e:folder            # no-OAuth local Drive folder save/open/autosave
npm run test:e2e:deck              # presentation flow at 1240 px and 390 px
npm run test:e2e:graph             # 3D canvas, labels, click-to-filter, destroy
python3 scripts/sync-taxonomy.py   # regenerate taxonomy from ../tubeshelf
python3 scripts/sync-taxonomy.py --check
```

`npm install` is only needed for the browser E2E harness; the app itself has no
runtime dependency. The E2E script stubs `accounts.google.com/gsi/client` and the
Drive REST calls, then proves connect, manual save, hourly autosave, local
fallback, open-latest and reload with `?test=1`.

There is no build, bundler or runtime dependency. Do not add one without a strong
reason; the value is that the whole app is auditable in one sitting.

## Architecture

- `src/format.js` — decode/validate, raw `parseBackup`, `buildBackup`, display
  normalisers, thumbnails. Pure.
- `src/store.js` — raw document state, mutations, canonical tags, pins, category
  rename/merge/delete, undo/redo, counts. Every mutation bumps `revision` and
  `dirty`; unknown JSON fields survive.
- `src/drive.js` — Google OAuth/Picker helpers and Drive REST transport. Pure
  helpers (names, retention, multipart) are unit-tested; the OAuth round-trip is
  not.
- `src/drive-config.js` — public default OAuth client ID/API key and the default
  mode; empty in the repo. The owner fills it once so end users only see
  “Sign in with Google”. Never put a client secret here; token flow has none.
- `src/folder.js` — File System Access folder backend (choose/list/read/write/
  retention). No OAuth, no Cloud project.
- `src/graph.js` — pure category graph (nodes, weighted shared-video links, degree
  cap, hidden unlinked count, group colours). Unit tested.
- `src/graph-view.js` — lazy `3d-force-graph` mount, camera, hub labels,
  click-to-filter, destroy. Only imported/loaded when the 3D view opens.
- `vendor/3d-force-graph.min.js` — pinned 1.79.1 UMD (MIT), no CDN.
- `src/tagger.js` — deterministic port of `HeuristicTagger`, `GuestNameExtractor`
  and `FormatTagger`. No network.
- `src/taxonomy.js` / `.json` — generated from the Mac's `TagTaxonomy.swift`.
  Never edit by hand; run `scripts/sync-taxonomy.py`.
- `src/shelf.js` — filters, search, paging. Pure, copied from the read-only app.
- `src/app.js` — DOM rendering, modals, session copy, export, slide deck,
  keyboard.
- `src/demo.js` — seven public videos; the only content shipped.
- `index.html`, `styles.css` — shell and layout. System fonts only.

Flow: `parseBackup → createStore → render → mutate → scheduleDraft/export`.

## Decisions and constraints

- **The folder path is the default no-OAuth route.** `src/folder.js` uses
  `showDirectoryPicker`/`createWritable`; the user chooses the folder Google Drive
  for Desktop syncs, permission is requested on a gesture, and the handle is kept
  in IndexedDB. Manual saves are timestamped; hourly `Local Sync` autosaves keep
  24. Chrome/Edge only. OAuth remains an advanced alternative for machines
  without Drive for Desktop. Do not make OAuth the first-run path.
- **One client for all users.** End users must not see OAuth fields. The owner
  puts the public client ID in `src/drive-config.js`; `HAS_DRIVE_DEFAULTS` then
  hides the fields under **Advanced** and the Backups panel offers one
  “Sign in with Google”. OAuth can stay in Google's Testing mode with up to 100
  test users; public use beyond that requires Google verification for Drive
  scopes and cannot be bypassed by a static app. The API key is only for Picker.
  Never commit a secret — there is none.
- **Drive is optional and never required.** When configured, the landing starts
  with **Open from Google Drive**; **From this computer…** is always beside it. A
  local copy/snapshot path works with no Google account. The app ships no OAuth
  credentials; each user creates a client. Setup lives in [DRIVE.md](DRIVE.md).
- **Reuse the Mac's Drive folder.** The intended loop is Google Drive for Desktop
  on the Mac, the Mac app's *Back up to Drive* writing
  `My Drive/TubeShelf Backups`, and this app in Automatic mode using the same
  folder. That makes web edits appear in the Mac's local Drive folder with no
  download or upload. Picker/`drive.file` may not list Mac-created files, so
  Automatic is the reliable cross-device mode. Keep the folder name identical and
  one writer at a time; timestamps are the history.
- **Two Drive modes, explicit scope.** Picker + `drive.file` is least access;
  Automatic uses full `drive` to find/create `TubeShelf Backups`. The token is
  memory-only with a ~1h lifetime; no refresh token or backend. Changing mode or
  client ID clears the token and folder. `drive.file` folder creation is the
  known risk; errors point at Automatic.
- **Autosave is hourly and change-only.** A 60s tick writes at most once per hour,
  only when the shelf is dirty, to a timestamped `Autosave (Web)` file. Retention
  deletes web autosaves beyond 24; manual backups and Mac autosaves are never
  touched. Manual **Save now** also writes a timestamped file. The Mac's matching
  autosave plan is in its `AGENTS.md`.
- **Local fallback snapshots are separate from Drive.** If Drive is unavailable
  or the token expired, the same hourly/change-only check writes an IndexedDB
  snapshot named `Autosave (Local)`; keep 24; the Backups panel lists them with
  Open/Download/Delete. **Snapshot now** forces one. The continuous local copy
  (one slot) still restores the last session on load.
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
- **Suggestions use the person's own filing.** `buildCategoryProfiles` learns up
  to ten discriminative title words per user category (at least two videos,
  stopwords removed); profile hits score 2 each, capped at 4, so they cannot
  outrank a real taxonomy/title hit. `channelAffinity` appends the channel's usual
  category (3+ videos, 2+ in the category, 60% share). The editor/add sheet shows
  existing categories as chips and a datalist so the user can file explicitly.
  Do not turn profile words into strong keywords; noisy categories then beat
  Math/Finance/Education on incidental words.
- **A new uncategorised video is confirmed.** Both the Mac app and this app ask
  before adding it as Unsorted. Do not make the button a silent path.
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

- **Live Drive OAuth is not verified in this repo.** There are no credentials, so
  only the transport is unit-tested. Verify with a real Google Cloud project using
  [DRIVE.md](DRIVE.md) before relying on it.
- **Picker folder creation is uncertain.** `drive.file` may refuse to create a new
  file in a picked folder. The UI reports it and suggests Automatic; the in-place
  fallback is not implemented.
- Access tokens last about an hour. Autosave falls back to local snapshots and the
  button says reconnect; there is no silent refresh.
- Full scope consent is broad and, in testing mode, limited to listed test users.
  Do not request verification for a personal tool.
- Local snapshots contain full backups and can be a few MB each; 24 of them use
  browser quota. Export for durable storage.
- Courses are counted but not shown or editable; a course-only category opens an
  empty video grid.
- No bulk selection, no redo button, no file picker “save”.
- The local copy is one global slot; loading a second shelf replaces it after the
  1.2 s debounce.
- Learned profile words can still be noisy for tiny categories; the explicit
  category chips are the reliable path.
- Category UI uses `prompt`/`confirm`; acceptable now, replace with a dialog for
  polish.
- Tag suggestions cannot see YouTube descriptions, so description-only guests
  (e.g. JRE #2501 without the title suffix) are missed. The numbered-episode
  suffix covers most podcast titles.
- No virtualised grid; fine for a few thousand videos, untested beyond that.
- The deck presents the current filtered video list only; courses/playlists are
  not slides. It snapshots the list when opened, so edits made behind it are not
  reflected until it is reopened.
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
