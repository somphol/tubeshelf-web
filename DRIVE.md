# Google Drive setup

Google Drive is optional. It lets the web editor **open the newest backup from
Drive** and **save edits back to the same folder**, so Drive for Desktop delivers
them to the Mac. Local files and local snapshots work without it.

The app ships no credentials. **Recommended for ease:** the app owner creates one
OAuth client and puts its public client ID in `src/drive-config.js`. End users then
only see **Sign in with Google** — no fields, no Google Cloud setup. No server is
involved.

If the app has no default client (or a user wants their own project), the
Backups panel exposes an **Advanced** section with the client ID/API key fields.


## Two access modes

| Mode | Scope | What it does | Cost |
|---|---|---|---|
| Pick a folder | `drive.file` | You pick the folder once per session. The app can only touch what it opened or created. | Least access; needs the Picker API key. Creating new files in a picked folder is the uncertain part. |
| Automatic | `drive` | Lists Drive, finds or creates `TubeShelf Backups`, and opens the newest backup. | Consent describes full Drive access. Personal testing mode avoids verification. |

Start with **Pick a folder** if you want minimal access. Note that `drive.file`
only guarantees access to files the app opened or created; it may not list backups
the **Mac** created in that folder. For the daily Mac↔web loop, **Automatic is the
reliable mode** because the Mac created the files. If Drive refuses new files in a
picked folder, switch to Automatic. Reconnect after switching modes: the scope
changes.

## One-click for end users (recommended)

This is the setup to use if other people will use the page:

1. As the owner, do the one-time setup below once.
2. Put the public **Client ID** in `src/drive-config.js` (`clientId`). Keep
   `mode: "full"` for the Mac folder; an API key is only needed for Picker mode.
3. Commit and deploy. Every user now sees one **Sign in with Google** button.
4. In Google Cloud, the OAuth consent screen can stay in **Testing**. Add each
   person as a **test user** (up to 100); they click through an “unverified app”
   warning once. No Google review is needed for this private use.
5. For public use beyond those test users, Google requires verification for the
   Drive scopes. A static client cannot bypass that; plan for the review or keep
   the app private/testing. This is the only unavoidable platform limit.

The client ID is public. There is no client secret in a browser token flow.

## One-time setup (owner, or Advanced)

1. Open <https://console.cloud.google.com/> and create or select a project.
2. Enable the **Google Drive API**:
   <https://console.cloud.google.com/apis/library/drive.googleapis.com>.
3. Configure the **OAuth consent screen**:
   <https://console.cloud.google.com/apis/credentials/consent>.
   - User type: **External** is fine.
   - Add your Google account under **Test users**.
   - Add the scopes:
     - `https://www.googleapis.com/auth/drive.file`
     - `https://www.googleapis.com/auth/drive` (only if you want Automatic)
4. Create a **Web application** OAuth client:
   <https://console.cloud.google.com/apis/credentials>.
   - Authorised JavaScript origins:
     - `https://somphol.github.io`
     - `http://localhost:8770` (local testing)
   - The token flow does not use a redirect URI; if the console insists, use the
     same origin.
   - Copy the **Client ID** (ends with `.apps.googleusercontent.com`).
5. For **Pick a folder**, create an **API key** on the same Credentials page:
   - Restrict it to the **Google Picker API**.
   - Restrict HTTP referrers to `https://somphol.github.io/*` and
     `http://localhost:8770/*`.
   - Copy the key.
6. In the app, click **Backups** (or the landing's **Set it up**):
   - Paste the Client ID and API key.
   - Choose the access mode and folder name.
   - **Save settings**, then **Connect Google Drive**.
   - Approve the Google prompt. If the app cannot list the folder in Pick mode,
     choose the folder again or switch to Automatic.

## What happens after connecting

- The app opens the newest `.json` when you use **Open from Google Drive** or
  **Open latest**. It asks before replacing unsaved edits.
- **Save now** uploads a new timestamped `TubeShelf YYYY-MM-DD HH.MM.SS.json`.
- **Hourly Drive autosave** is on by default in the panel. It writes at most once
  per hour, only when the shelf revision changed, as
  `TubeShelf Autosave (Web) YYYY-MM-DD HH.MM.SS.json`.
- The newest **24** web autosaves are kept. Older `Autosave (Web)` files are
  deleted; manual backups and `Autosave (Mac)` files are never touched.
- **Local snapshots** are the fallback when Drive is not connected, the token
  expired, or the mode is off. They are written at most hourly when the shelf
  changed, keep the newest 24, and can be opened, downloaded or deleted from the
  Backups panel. **Snapshot now** creates one immediately.
- The current session is also kept as a local copy; reloading reopens it with a
  Keep/Forget banner.

## Token lifetime

Google Identity Services returns a short-lived access token (about an hour). No
refresh token is stored. When it expires, the Backups button changes to
**Backups · reconnect**; press Connect again. Autosave falls back to local
snapshots until you do.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `redirect_uri_mismatch` or “origin is not allowed” | Add the exact origin (`https://somphol.github.io`, `http://localhost:8770`) to the OAuth client's authorised JavaScript origins. |
| `access_denied` | Add your account to Test users on the OAuth consent screen. |
| `403 insufficientPermissions` | The scope for the selected mode was not granted. Reconnect after switching modes; confirm the scopes on the consent screen. |
| Picker fails to open | Check the API key, its referrer restrictions, and that the Google Picker API is enabled. Allow popups. |
| Drive refuses to create a file in the picked folder | `drive.file` folder access is limited. Switch to Automatic mode (full scope). |
| Pick a folder does not show the Mac's backups | `drive.file` may not list files created outside this app. Use Automatic for the shared folder. |
| Popup blocked | Allow popups for the site, then press Connect again. |
| Autosave stops | Check the Backups panel; reconnect if the token expired. Local snapshots continue. |

## Privacy

- Tokens live in memory only. Settings (client ID, API key, folder name, mode)
  live in `localStorage`; tokens never do.
- The app has no backend and sends no analytics.
- Automatic mode requests broad Drive consent so it can find the folder. The code
  only lists, downloads, creates and deletes inside `TubeShelf Backups`; review
  `src/drive.js` if you want to verify that.
- Local snapshots live in this browser's IndexedDB. Clearing site data removes
  them; export a backup for durable storage.

## Testing status

`npm run test:e2e` stubs Google OAuth and the Drive REST API, then proves the real
UI path: connect, create/open the folder, manual save, hourly autosave, local
fallback, open-latest and reload. Unit tests cover the transport, retention and
autosave plan. A live OAuth round-trip has **not** been run in this repository
because it needs a real Google Cloud client and account; verify your own project
with the steps above before relying on it daily.

## Recommended Mac ↔ web loop (reuse your Drive folder)

This is the setup the Mac app already supports:

1. On the Mac, install **Google Drive for Desktop** and sign in. Let `My Drive`
   appear under `~/Library/CloudStorage/`.
2. In the Mac app, use **Back up to Drive** (Settings, or ⌥⇧⌘S). It writes
   `My Drive/TubeShelf Backups/TubeShelf ….json`.
3. In this web app, choose **Automatic (full Drive)** and keep the folder name
   **TubeShelf Backups**. Connect.
4. Morning: back up from the Mac, then **Open from Google Drive** here.
5. Work: edit; hourly autosave writes a new timestamped file into the same folder.
6. Evening: **Save now**, then restore that file on the Mac. Drive for Desktop
   has already synced it into the local `My Drive` folder, so no download or
   upload is needed.

Why Automatic: `drive.file` (Pick a folder) only guarantees files this app opened
or created; it may not list backups the Mac wrote. Automatic uses full Drive scope
to find the shared folder. The app code only touches `TubeShelf Backups` and
keeps the newest 24 web autosaves; manual backups and Mac autosaves are never
deleted.

Keep one writer at a time. Every save is a new timestamped file, so a wrong
restore is recoverable, and the Mac still copies the replaced shelf aside.
