# TubeShelf Web (editable)

A static, local-first editor for **TubeShelf backups**. Open a backup exported by
the [Mac app](https://github.com/somphol/tubeshelf), edit categories, notes,
favorites and watch state, add videos by link, then export a new backup to load
back on the Mac.

No account, no server, no upload. The file is parsed in the browser.

> **Status: phase 1.** Editing videos, adding by link, category actions and export
> work. Google Drive sync and course editing are next; see [PLAN.md](PLAN.md).

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
- Add a video by URL: title and channel come from YouTube oEmbed; thumbnail and
  suggestions follow. Duplicate IDs are refused.
- Category actions: pin/unpin, rename, merge into another category, delete.
- Pin channels alongside categories.
- Local draft in IndexedDB with a restore banner, cleared on export.
- **⌘S** export, **⌘N** add, **⌘F** search, **⌘Z** undo, **Esc** close.
- Mobile-width layout for quick edits.

## What is not here yet

- Google Drive connect/Picker and hourly autosave (designed in [PLAN.md](PLAN.md)).
- Course/playlist editing; courses are counted but not shown or tickable here.
- In-place file saving; export downloads a new backup.
- Description and duration for new videos: the watch page is CORS-blocked, so only
  oEmbed title/channel are fetched. Duration stays empty until the Mac sees it.
- AI tagging. The deterministic Mac tagger is ported to JavaScript and runs
  offline; there is no model in the browser.

## Privacy

The app makes exactly two network requests: YouTube oEmbed for a pasted link, and
thumbnails from `i.ytimg.com`. No analytics, no fonts, no uploads. The IndexedDB
draft is local to the browser and can be discarded from the banner or by clearing
site data.

## Repository

- Format contract: [`format.schema.json`](format.schema.json) (copy of the Mac
  app's schema; preserve unknown fields).
- Handoff: [AGENTS.md](AGENTS.md) — architecture, decisions, gaps, Drive plan.
- Plan: [PLAN.md](PLAN.md).
- Tests: `node --test tests/` (35 tests); manual end-to-end notes in
  [tests/E2E.md](tests/E2E.md).
- The Mac app is public: <https://github.com/somphol/tubeshelf>.
- The read-only viewer remains at <https://somphol.github.io/tubeshelf-web-ro/>.

## License

MIT. Free to use, **no warranty, no liability**. Not affiliated with YouTube,
Google or Apple. See [LICENSE](LICENSE) and [DISCLAIMER.md](DISCLAIMER.md).
