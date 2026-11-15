# TubeShelf Web (editable)

A static, local-first editor for **TubeShelf backups**. Open a backup exported by
the [Mac app](https://github.com/somphol/tubeshelf), edit categories, notes,
favorites and watch state, add videos by link, then export a new backup to load
back on the Mac.

No account, no server, no upload. The file is parsed in the browser.

> **Status: phase 2.** Editing, adding by link, category actions, export, Google
> Drive open/save, hourly autosave and local snapshots are implemented. Course
> editing is next; see [PLAN.md](PLAN.md) and [DRIVE.md](DRIVE.md).

## Run it

```bash
python3 -m http.server 8770
open http://localhost:8770/
```

There is no build step and no dependency. Choose a backup (or the demo shelf) and
start editing.

## Workflow

1. Morning: export a backup from the Mac (or use the one already in Drive).
2. At work: **Open…**, edit, add videos, tidy categories.
3. **Export backup** writes a new timestamped JSON file.
4. Evening: restore that file on the Mac. The Mac keeps a copy of the shelf it
   replaced, so a wrong file is recoverable.

## What works

- Load `tubeshelf.backup` or a raw `library.json`; unknown fields are preserved.
- Grid, categories, channels, favorites, unwatched, unsorted, search and paging.
- Edit a video: categories (with suggestions), note, favorite, watched, remove.
  Existing categories are shown as chips and in the type-ahead; suggestions learn
  keywords from the titles you already filed under your own categories.
- Add a video by URL: title and channel come from YouTube oEmbed; thumbnail and
  suggestions follow. Duplicate IDs are refused.
- Adding a new video with **no category** asks for confirmation; it is never
  silently filed as Unsorted.
- Category actions: pin/unpin, rename, merge into another category, delete.
- Pin channels alongside categories.
- Local copy in IndexedDB: a reload reopens the last shelf and keeps your
  category, search and page. A banner lets you forget it.
- **Google Drive (optional):** open the newest backup from Drive, save a new
  timestamped backup, hourly autosave when changes exist, and retention of the
  newest 24 web autosaves. The intended loop reuses the Mac app's
  `My Drive/TubeShelf Backups` folder through **Google Drive for Desktop**, so web
  edits appear locally on the Mac with no download or upload. Use Automatic mode
  for Mac-created files; Pick a folder may not list them. End users only see
  **Sign in with Google**; the app owner fills one public client ID in
  [`src/drive-config.js`](src/drive-config.js) once. See [DRIVE.md](DRIVE.md) for
  the owner step and the Google testing/verification limits.
- **Local snapshots** when Drive is unavailable: hourly, change-only, newest 24,
  with Open / Download / Delete and a Snapshot now action.
- Drive-first landing when configured, with **From this computer…** always beside
  it.
- **⌘S** export, **⌘N** add, **⌘F** search, **⌘Z** undo, **Esc** close.
- Mobile-width layout for quick edits.

## What is not here yet

- Course/playlist editing; courses are counted but not shown or tickable here.
- Live OAuth verification: the client ships without credentials; each user creates
  one. The transport is unit-tested, the real round-trip is not.
- In-place file saving; export downloads a new backup.
- Multiple shelves cached at once: the local copy is a single slot.
- Description and duration for new videos: the watch page is CORS-blocked, so only
  oEmbed title/channel are fetched. Duration stays empty until the Mac sees it.
- AI tagging. The deterministic Mac tagger is ported to JavaScript and runs
  offline; there is no model in the browser.

## Privacy

Without Drive, the app makes exactly two network requests: YouTube oEmbed for a
pasted link, and thumbnails from `i.ytimg.com`. With Drive connected it also talks
to `accounts.google.com`, `oauth2.googleapis.com` and `www.googleapis.com`, only
for the folder you choose. No analytics, no fonts. IndexedDB holds the local copy
and snapshots; clearing site data removes them.

## Repository

- Format contract: [`format.schema.json`](format.schema.json) (copy of the Mac
  app's schema; preserve unknown fields).
- Handoff: [AGENTS.md](AGENTS.md) — architecture, decisions, gaps, Drive plan.
- Plan: [PLAN.md](PLAN.md).
- Tests: `npm test` (47 tests); browser proof: `npm run test:e2e` (fake Google
  OAuth + Drive, no credentials). Notes in [tests/E2E.md](tests/E2E.md). Drive
  setup: [DRIVE.md](DRIVE.md).
- The Mac app is public: <https://github.com/somphol/tubeshelf>.
- The read-only viewer remains at <https://somphol.github.io/tubeshelf-web-ro/>.

## License

MIT. Free to use, **no warranty, no liability**. Not affiliated with YouTube,
Google or Apple. See [LICENSE](LICENSE) and [DISCLAIMER.md](DISCLAIMER.md).
