# TubeShelf Web plan

This is the working plan for the editable web companion. `AGENTS.md` is the
handoff; this file records product decisions and phases.

## Goal

One shelf, two workstations. Export from the Mac in the morning, edit in the
browser at work, export or sync at the end of the day, restore on the Mac.
No accounts required for the core loop.

## Phase 1 — local edit and export (done)

- Raw backup parse with unknown-field preservation.
- Video editing, add by oEmbed, category actions, pins, suggestion port.
- IndexedDB draft and timestamped export.
- Tests and a manual end-to-end pass.

## Phase 2 — Google Drive (implemented)

### Permission model

Primary no-OAuth path: choose the local folder Google Drive for Desktop syncs
(File System Access API); manual saves and hourly `Local Sync` autosaves write
directly. OAuth is an advanced alternative: one **Sign in with Google** button. The owner configures one public
client ID in `src/drive-config.js`; fields live under **Advanced**. Testing mode
with test users avoids Google verification for a private app; public use beyond
test users needs Google's Drive-scope review.

- Default: `drive.file` + Google Picker. The user picks the `TubeShelf Backups`
  folder or the latest backup once per session; the file/folder ID is remembered.
- Opt-in: full `drive` scope. The app lists `My Drive/TubeShelf Backups`, opens the
  newest backup automatically and can create files there without a picker.
- Tokens stay in memory. No refresh token, no backend.

### One-time setup

1. Google Cloud project → enable Google Drive API.
2. OAuth consent screen → External; add the owner as a test user; scopes
   `drive.file` and (optional) `drive`.
3. Web OAuth client → authorized origins `https://somphol.github.io` and
   `http://localhost:8770`.
4. Optional API key for the Picker, restricted to the same origins and the
   Google Picker API.
5. Put the public client ID and API key in a config file or Settings form.

### Save behaviour (implemented)

- Manual **Save now** writes a new timestamped `TubeShelf YYYY-MM-DD HH.MM.SS-web.json`.
- Never overwrite a morning file.
- Autosave writes at most **once per hour**, only when the document revision
  changed since the last autosave, to
  `TubeShelf Autosave (Web) YYYY-MM-DD HH.MM.SS.json`.
- Retain the newest 24 web autosaves; delete older `Autosave (Web)` files only.
- The Mac writes its own `TubeShelf Autosave (Mac) …` files; never delete those.
- **Local fallback:** when Drive is unavailable, disconnected, expired, or its
  autosave is off, the same hourly/change-only rule writes an IndexedDB
  `Autosave (Local)` snapshot; keep 24; the Backups panel can open, download,
  delete or create one now.

### Conflict handling

- File IDs and `modifiedTime` are recorded on open.
- Timestamped files avoid overwrites; if a newer manual backup appears, show a
  quiet “newer backup in Drive” note, never a modal.
- One writer at a time remains the workflow; there is no merge.

### Risk

`drive.file` folder access for creating a file in a picked folder is the
uncertain part. Validate with a real account before building the editor around
it. If it fails, Picker mode updates the picked file in place and full scope
handles folder creation.

## Startup and fallback (implemented)

- If an OAuth client is configured, the landing leads with **Open from Google
  Drive**; **From this computer…** remains beside it.
- If not configured, the local chooser is primary and a visible Google Drive
  suggestion card explains the optional setup.
- A local session copy always auto-restores on reload; the banner offers Keep or
  Forget.
- Tokens are memory-only; a reconnect is required after expiry.

## Phase 3 — courses and scale

The optional web 3D graph is implemented alongside this phase: a pure
`buildGraph`, a vendored lazy `3d-force-graph`, hub labels, click-to-filter and
`test:e2e:graph`. It is a showpiece; the grid remains the editing surface.


- Read/write courses: existing ticks, manual chapter rows, tags, title.
- Bulk selection (favorite, watched, add/remove categories) with one undo.
- Category manager view, channel pins UI parity.
- Larger-library virtualisation if the grid becomes slow.

## Phase 4 — polish

- File System Access “save in place” where supported.
- Redo UI, keyboard help, conflict banner, tablet layout.
- E2E automation with a local server and mocked Drive.

## Non-goals

- A backend, accounts, analytics or uploads.
- Embedded playback.
- Automatic playlist scraping; CORS blocks it and a key/proxy is out of scope.
- Merging two shelves. Restore is replace-only.
