# TubeShelf Web

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
3. **Export backup** writes a new timestamped `…-web.json` file.
4. Evening: restore that file on the Mac. The Mac keeps a copy of the shelf it
   replaced, so a wrong file is recoverable.

## What works

- Load `tubeshelf.backup` or a raw `library.json`; unknown fields are preserved.
- Grid, categories, channels, favorites, unwatched, unsorted, search and paging.
- Edit a video: categories (with suggestions), note, favorite, watched, remove.
  Existing categories are shown as chips and in the type-ahead; suggestions learn
  keywords from the titles you already filed under your own categories.
- Add a video by URL: opening the sheet reads a YouTube link from the clipboard
  when the browser allows it, then fills the title and channel from oEmbed and
  suggests categories. **Paste** retries explicitly; typing always works.
  A category typed but not entered is still used when you press **Add**/Save.
  If the link is already saved, the sheet loads that video's categories, offers
  **Show existing card**, and changes Add to **Update categories** instead of
  creating a duplicate.
- Adding a new video with **no category** asks for confirmation; it is never
  silently filed as Unsorted.
- Category actions: pin/unpin, rename, merge into another category, delete.
- Pin channels alongside categories.
- **Playlist Catalog:** courses live beside videos. **Add playlist** reads a
  public playlist's chapter IDs with YouTube's own player (no API key, no proxy)
  and fills titles/channels via oEmbed. Open a course to see ordered chapters,
  tick progress, edit course categories, open a chapter in the editor, present
  the on-shelf chapters as a video deck, or remove the course without touching
  shelf videos. Course tags appear in Categories too.
- **Sidebar controls:** LIBRARY, PINNED, CATEGORIES and CHANNELS fold
  independently and remember it. **☰** (or **⌘\**) hides the bar; **Pin** keeps
  it open, while unpinned it auto-hides when the pointer leaves and returns from
  the left edge. Mobile keeps the flat filter strip.
- **Slide deck:** click any card, or press **Present** in the header, to show the
  current list full-screen starting at that video. Arrow keys, Home/End, mouse
  wheel, or the filmstrip move between slides; tags filter the shelf, **Edit**
  opens the editor, **Play on YouTube** opens the video, and **Esc** returns.
- **Right-click a card** for Show slide / Edit categories and notes / Open on
  YouTube. Left-click stays a slide, never the editor. Hover shows a **★/☆**
  button to favorite or unfavorite immediately.
- **Backups keep the profile and device:** a Mac file named
  `TubeShelf My Shelf @ Work-Mac …json` exports as
  `TubeShelf My Shelf @ macOS …-web.json`. The device defaults to the browser
  platform; rename it under **Backups → This device name**. A file without a
  profile still gets a parseable `Shelf @ device` name.
- **Merge instead of replace:** opening a backup while this browser has edits
  applies one-sided changes and asks only where both sides changed. Differences
  are reviewed one at a time: **Keep this browser / Use the backup / Keep both**,
  with **Back** to revisit the last choice. Merge enables when none are left; the
  merge is one undo step and the common base survives a reload.
- **Quick backup:** one click saves a timestamped `-web.json` straight to the
  selected Google Drive folder, or to Drive when connected. It appears only when
  a destination is set up; otherwise use **Export backup**.
- **Google Drive folder (no OAuth):** install Google Drive for Desktop, choose
  the synced `My Drive/TubeShelf Backups` folder once in **Backups**, and the
  browser reads/writes it directly. No client ID, no Google Cloud project, no
  sign-in. New timestamped saves and hourly `Local Sync` autosaves (newest 24)
  sync through Drive to the Mac. Chrome/Edge only.
- **Google sign-in (advanced, optional):** for computers without Drive for
  Desktop. Needs an app-owner OAuth client; see [DRIVE.md](DRIVE.md).
- **Local snapshots** when Drive is unavailable: hourly, change-only, newest 24,
  with Open / Download / Delete and a Snapshot now action.
- Drive-first landing when configured, with **From this computer…** always beside
  it.
- **⌘S** export, **⌘N** add, **⌘F** search, **⌘Z** undo, **Esc** close.
- Mobile-width layout for quick edits.

## What is not here yet

- Playlist import depends on YouTube's player: it exposes at most the first
  batch (currently 200 chapters), oEmbed has no duration, and an embed-disabled
  chapter falls back to `Chapter N` until you edit it. There is no automatic
  refresh of an existing course; remove and re-add it. Adding a missing chapter
  to the shelf is still done through **Add video**. Course cards open the course
  sheet, not the video deck; the sheet's Present action plays on-shelf chapters.
- Live OAuth verification: the client ships without credentials; each user creates
  one. The transport is unit-tested, the real round-trip is not.
- In-place file saving; export downloads a new backup.
- Course conflicts are resolved as whole courses; chapters are not merged field
  by field. Local hourly snapshots still use the replace confirmation.
- Multiple shelves cached at once: the local copy is a single slot.
- Description and duration for new videos: the watch page is CORS-blocked, so only
  oEmbed title/channel are fetched. Duration stays empty until the Mac sees it.
- AI tagging. The deterministic Mac tagger is ported to JavaScript and runs
  offline; there is no model in the browser.

## Privacy

Without Drive, the app talks to YouTube only: thumbnails from `i.ytimg.com`,
oEmbed for a pasted video or playlist, and — when you press **Add playlist** —
YouTube's IFrame player to read the public chapter IDs. With Drive connected it
also talks to `accounts.google.com`, `oauth2.googleapis.com` and
`www.googleapis.com`, only for the folder you choose. No analytics, no fonts.
IndexedDB holds the local copy and snapshots; clearing site data removes them.

## Repository

- Format contract: [`format.schema.json`](format.schema.json) (copy of the Mac
  app's schema; preserve unknown fields).
- Handoff: [AGENTS.md](AGENTS.md) — architecture, decisions, gaps, Drive plan.
- Plan: [PLAN.md](PLAN.md).
- Tests: `npm test` (75 tests); browser proof: `npm run test:e2e` (fake Google
  OAuth + Drive, no credentials), `npm run test:e2e:folder` (no-OAuth folder),
  `npm run test:e2e:clipboard` (clipboard autofill), `npm run test:e2e:duplicate`
  (existing card + category update), `npm run test:e2e:course` (catalog, ticks,
  tags, present, remove), `npm run test:e2e:merge` (conflicts, undo and reload),
  `npm run test:e2e:sidebar` (fold, hide, pin and auto-hide), `npm run test:e2e:deck`
  (presentation flow) and `npm run test:e2e:graph` (WebGL + labels).
  Notes in [tests/E2E.md](tests/E2E.md). Drive setup: [DRIVE.md](DRIVE.md).
- The Mac app is public: <https://github.com/somphol/tubeshelf>.

## License

MIT. Free to use, **no warranty, no liability**. Not affiliated with YouTube,
Google or Apple. See [LICENSE](LICENSE) and [DISCLAIMER.md](DISCLAIMER.md).
