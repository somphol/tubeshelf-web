// Google Drive transport for the editable app. Tokens stay in memory; settings
// (client ID, API key, folder) are public values stored locally. No backend.
import { DRIVE_DEFAULTS } from "./drive-config.js";
import { backupIdentity } from "./format.js";

export const DRIVE_SCOPE_FILE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_SCOPE_FULL = "https://www.googleapis.com/auth/drive";

const SETTINGS_KEY = "tubeshelf-rw-drive";
const STATE_KEY = "tubeshelf-rw-drive-state";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

export class DriveError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "DriveError";
    this.status = status;
  }
}

export function loadDriveSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    const mode = raw?.mode || DRIVE_DEFAULTS.mode;
    return {
      clientId: raw?.clientId || DRIVE_DEFAULTS.clientId,
      apiKey: raw?.apiKey || DRIVE_DEFAULTS.apiKey,
      mode: mode === "full" ? "full" : "picker",
      folderName: raw?.folderName || DRIVE_DEFAULTS.folderName,
      autoSave: (raw?.autoSave ?? DRIVE_DEFAULTS.autoSave) !== false,
    };
  } catch {
    return { ...DRIVE_DEFAULTS };
  }
}

export function saveDriveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

export function loadDriveState() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) || "null") || {};
  } catch {
    return {};
  }
}

export function saveDriveState(patch) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ ...loadDriveState(), ...patch }));
  } catch {}
}

export function clearDriveState() {
  try { localStorage.removeItem(STATE_KEY); } catch {}
}

export function scopeForMode(mode) {
  return mode === "full" ? DRIVE_SCOPE_FULL : DRIVE_SCOPE_FILE;
}

export function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
}

export function backupName(date = new Date(), profileName = "", machineName = "") {
  const identity = backupIdentity(profileName, machineName);
  return `TubeShelf ${identity ? `${identity} ` : ""}${stamp(date)}-web.json`;
}

export function autosaveName(date = new Date()) {
  return `TubeShelf Autosave (Web) ${stamp(date)}.json`;
}

export function isAutosaveName(name) {
  return /^TubeShelf Autosave \(Web\) .*\.json$/.test(String(name || ""));
}

export function isBackupName(name) {
  return /^TubeShelf .*\.json$/.test(String(name || "")) && !isAutosaveName(name);
}

/** Delete candidates beyond `keep` autosaves; manual backups are never included. */
export function retentionVictims(files, keep = 24) {
  return files
    .filter((file) => isAutosaveName(file.name))
    .sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime)))
    .slice(keep);
}

export const AUTO_SAVE_INTERVAL = 60 * 60 * 1000;

/**
 * Decide the hourly work. Cloud wins when Drive is ready; a failed cloud save
 * can still fall back to a local snapshot. A healthy Drive that is not due yet
 * does not create a duplicate local snapshot.
 */
export function autoSavePlan({
  now,
  dirty,
  driveReady,
  lastCloudAt = 0,
  lastLocalAt = 0,
  revision = 0,
  lastRevision = -1,
  interval = AUTO_SAVE_INTERVAL,
}) {
  if (!dirty) return { cloudDue: false, localDue: false, localFallbackDue: false };
  const localFallbackDue = now - lastLocalAt >= interval && revision !== lastRevision;
  const cloudDue = Boolean(driveReady && now - lastCloudAt >= interval);
  return {
    cloudDue,
    localDue: !driveReady && localFallbackDue,
    localFallbackDue,
  };
}

export function latestFile(files) {
  return files
    .slice()
    .sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime)))[0] || null;
}

/** Google multipart/related body for a JSON file. */
export function multipartBody(metadata, text, boundary = `tubeshelf-${crypto.randomUUID()}`) {
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    text,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

export function loadScript(src) {
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing) {
    return existing.dataset.loaded === "1"
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener("error", () => reject(new Error(`Could not load ${src}`)), { once: true });
        });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(script);
  });
}

/** One OAuth token request. Must be called from a user gesture. */
export async function requestToken(clientId, scope) {
  await loadScript("https://accounts.google.com/gsi/client");
  if (!window.google?.accounts?.oauth2) throw new Error("Google identity support did not load.");
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        resolve({
          token: response.access_token,
          expiresAt: Date.now() + Math.max(60, Number(response.expires_in) || 3600) * 1000,
        });
      },
      error_callback: (error) => reject(new Error(error.message || error.type || "Google sign-in failed")),
    });
    client.requestAccessToken({ prompt: "" });
  });
}

export async function revokeToken(token) {
  if (!token) return;
  try {
    await loadScript("https://accounts.google.com/gsi/client");
    google.accounts.oauth2.revoke(token);
  } catch {}
}

/** Opens the Google Picker and resolves the selected folder or file. */
export async function pickFromDrive({ apiKey, token, kind = "folder" }) {
  if (!apiKey) throw new Error("The Google API key is required for the Picker.");
  await loadScript("https://apis.google.com/js/api.js");
  await new Promise((resolve, reject) => {
    window.gapi.load("picker", { callback: resolve, onerror: () => reject(new Error("Picker failed to load.")) });
  });

  return new Promise((resolve, reject) => {
    const view = kind === "folder"
      ? new google.picker.DocsView(google.picker.ViewId.FOLDERS)
          .setSelectFolderEnabled(true)
          .setIncludeFolders(true)
      : new google.picker.DocsView(google.picker.ViewId.DOCS)
          .setMimeTypes("application/json")
          .setIncludeFolders(false);

    const picker = new google.picker.PickerBuilder()
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .addView(view)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          const doc = data.docs[0];
          resolve({ id: doc.id, name: doc.name, parentId: doc.parentId || null });
        } else if (data.action === google.picker.Action.CANCEL) {
          reject(new Error("Picker cancelled."));
        }
      })
      .build();
    picker.setVisible(true);
  });
}

export class Drive {
  constructor(token, { fetchImpl = fetch } = {}) {
    this.token = token;
    // Native fetch throws "Illegal invocation" if called as an object method.
    this.fetchImpl = fetchImpl === fetch ? fetch.bind(globalThis) : fetchImpl;
  }

  async request(url, options = {}) {
    const headers = {
      Authorization: `Bearer ${this.token}`,
      ...(options.headers || {}),
    };
    const response = await this.fetchImpl(url, { ...options, headers });
    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch {}
      throw new DriveError(response.status, `Drive ${response.status}: ${detail.slice(0, 180)}`);
    }
    return response;
  }

  async listFiles(query, { pageSize = 100 } = {}) {
    const files = [];
    let pageToken = "";
    do {
      const params = new URLSearchParams({
        q: query,
        fields: "nextPageToken,files(id,name,modifiedTime,parents,size,mimeType)",
        orderBy: "modifiedTime desc",
        pageSize: String(pageSize),
        spaces: "drive",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const response = await this.request(`${API}/files?${params}`);
      const data = await response.json();
      files.push(...(data.files || []));
      pageToken = data.nextPageToken || "";
    } while (pageToken);
    return files;
  }

  async ensureFolder(name) {
    const safe = String(name).replace(/'/g, "\\'");
    const found = await this.listFiles(
      `name='${safe}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    if (found.length) return found[0];
    const response = await this.request(`${API}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }),
    });
    return response.json();
  }

  async listFolder(folderId) {
    const safe = String(folderId).replace(/'/g, "\\'");
    return this.listFiles(`'${safe}' in parents and trashed=false`);
  }

  async download(fileId) {
    const response = await this.request(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
    return response.text();
  }

  async upload({ name, text, parents }) {
    const { body, contentType } = multipartBody(
      { name, mimeType: "application/json", ...(parents?.length ? { parents } : {}) },
      text
    );
    const response = await this.request(
      `${UPLOAD}?uploadType=multipart&fields=id,name,modifiedTime,parents`,
      { method: "POST", headers: { "Content-Type": contentType }, body }
    );
    return response.json();
  }

  async delete(fileId) {
    await this.request(`${API}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
  }
}
