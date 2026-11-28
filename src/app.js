// Editable TubeShelf web app. Files stay local; export writes a new backup.
import {
  parseBackup,
  thumbnailCandidates,
  formatDuration,
  watchURL,
  playlistURL,
  playlistIDFromText,
  youtubeIDFromText,
  suggestedFileName,
  profileNameFromFile,
} from "./format.js";
import {
  createStore,
  currentBackup,
  displayVideos as storeVideos,
  displayPlaylists as storePlaylists,
  counts,
  markSaved,
  saveVideo,
  setVideoFavorite,
  setVideoTags,
  deleteVideo,
  addVideo,
  newVideo,
  replaceShelf,
  hasDuplicate,
  videoByYoutubeID,
  canUndo,
  canRedo,
  undo,
  toggleTagPin,
  toggleChannelPin,
  renameTag,
  mergeTags,
  deleteTag,
  isTagPinned,
  isChannelPinned,
  canonicalTag,
  setPlaylistTags,
  togglePlaylistChapter,
  removePlaylist,
  addPlaylist,
} from "./store.js";
import {
  applyVideoFilter,
  searchVideos,
  matches,
  playlistSearchText,
  shelfItems,
  playlistWatched,
  courseProgress,
  courseWatchedCount,
  pageWindow,
  pageSlice,
  PAGE_SIZES,
} from "./shelf.js";
import {
  suggestTags,
  buildCategoryProfiles,
  channelAffinity,
  TAXONOMY_CATEGORY_NAMES,
} from "./tagger.js";
import { demoBackup } from "./demo.js";
import { HAS_DRIVE_DEFAULTS } from "./drive-config.js";
import { WEB_VERSION } from "./version.js";
import { deviceName, setDeviceName, detectedDeviceName } from "./device.js";
import {
  folderSupported,
  pickFolder,
  folderPermission,
  requestFolderPermission,
  listBackups,
  readText,
  writeText,
  deleteFile,
  folderAutosaveName,
  folderRetentionVictims,
  latestBackup,
} from "./folder.js";
import { mergeShelves, resolveMerge, shelfFingerprint } from "./merge.js";
import { buildGraph } from "./graph.js";
import { mountGraph } from "./graph-view.js";
import {
  Drive,
  DriveError,
  loadDriveSettings,
  saveDriveSettings,
  loadDriveState,
  saveDriveState,
  requestToken,
  revokeToken,
  pickFromDrive,
  scopeForMode,
  backupName,
  autosaveName,
  retentionVictims,
  latestFile,
  autoSavePlan,
  stamp,
} from "./drive.js";

/* ---------- tiny DOM helper ---------- */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const $ = (selector) => document.querySelector(selector);
const SIDEBAR_PIN_KEY = "tubeshelf-rw-sidebar-pinned";
const SIDEBAR_HIDDEN_KEY = "tubeshelf-rw-sidebar-hidden";
const SECTIONS_KEY = "tubeshelf-rw-sections";
const state = {
  store: null,
  filter: { kind: "all" },
  query: "",
  scope: "everything",
  page: 0,
  pageSize: 48,
  sidebarQuery: "",
  sidebarPinned: localStorage.getItem(SIDEBAR_PIN_KEY) !== "0",
  sidebarHidden: localStorage.getItem(SIDEBAR_HIDDEN_KEY) === "1",
  sidebarPeek: false,
  sidebarCollapsed: loadCollapsedSections(),
  context: null,
  draftAt: null,
  base: null,
  baseText: null,
  merge: null,
  drive: {
    settings: loadDriveSettings(),
    token: null,
    expiresAt: 0,
    folderId: loadDriveState().folderId || null,
    folderName: loadDriveState().folderName || "",
    lastAutoSaveAt: loadDriveState().lastAutoSaveAt || 0,
    status: "off",
    message: "",
    files: [],
    intent: "manage",
    busy: false,
  },
  snapshots: { lastAt: 0, revision: -1 },
  autosaveBusy: false,
  view: "grid",
  graphSelected: null,
  graphController: null,
  graphToken: 0,
  deck: null,
  course: null,
  playlistPlayer: null,
  playlistToken: 0,
  folder: {
    supported: folderSupported(),
    handle: null,
    name: "",
    files: [],
    status: "off",
    message: "",
    lastSavedAt: (() => {
      try {
        return JSON.parse(localStorage.getItem("tubeshelf-rw-folder-state") || "{}").lastSavedAt || 0;
      } catch {
        return 0;
      }
    })(),
  },
};

const versionNode = $("#version");
if (versionNode) {
  versionNode.textContent = `v${WEB_VERSION}`;
  versionNode.title = `TubeShelf Web ${WEB_VERSION}`;
}

const SNAPSHOT_KEY = "tubeshelf-rw-snapshots";

try {
  const saved = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null");
  if (saved) state.snapshots = { lastAt: saved.lastAt || 0, revision: saved.revision ?? -1 };
} catch {}

let draftTimer = null;

/* ---------- IndexedDB draft ---------- */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("tubeshelf-rw", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("kv");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readonly");
      const req = tx.objectStore("kv").get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbPut(key, value) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* IndexedDB can be unavailable in private mode; the app still works. */
  }
}

async function idbAll(prefix) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readonly");
      const store = tx.objectStore("kv");
      const keysReq = store.getAllKeys();
      const valuesReq = store.getAll();
      tx.oncomplete = () => {
        const out = [];
        keysReq.result.forEach((key, index) => {
          if (String(key).startsWith(prefix)) out.push({ key, ...valuesReq.result[index] });
        });
        resolve(out);
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return [];
  }
}

async function idbDelete(key) {
  try {
    const db = await openDB();
    await new Promise((resolve) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").delete(key);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch {}
}

function scheduleDraft() {
  if (!state.store) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(async () => {
    if (!state.store) return;
    state.draftAt = new Date();
    await idbPut("draft", {
      text: currentBackup(state.store),
      baseText: state.baseText || null,
      fileName: state.store.fileName,
      savedAt: state.draftAt.toISOString(),
      dirty: state.store.dirty,
    });
    setDraftStatus();
  }, 1200);
}

async function clearDraft() {
  clearTimeout(draftTimer);
  await idbDelete("draft");
}

function setDraftStatus() {
  const meta = $("#file-meta");
  if (!state.store) return;
  meta.querySelectorAll(".draft-meta").forEach((node) => node.remove());
  if (!state.draftAt) return;
  const time = state.draftAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  meta.append(el("span", { class: "draft-meta", text: ` · local copy ${time}` }));
}

/* ---------- loading ---------- */
function shelfFromParsed(parsed) {
  return {
    videos: parsed.videos,
    playlists: parsed.playlists,
    pinnedTags: parsed.pinnedTags,
    pinnedChannels: parsed.pinnedChannels,
    hasPlaylistCatalog: parsed.hasPlaylistCatalog,
  };
}

function shelfFromStore(store) {
  return {
    videos: store.videos,
    playlists: store.playlists,
    pinnedTags: store.pinnedTags,
    pinnedChannels: store.pinnedChannels,
    hasPlaylistCatalog: store.hasPlaylistCatalog,
  };
}

function cloneShelf(shelf) {
  return JSON.parse(JSON.stringify(shelf));
}

/** The last state the Mac could have started from: a load or a manual save. */
function checkpointBase(text) {
  if (!state.store) return;
  state.base = cloneShelf(shelfFromStore(state.store));
  state.baseText = text;
}

function loadText(text, name, { draft = false, dirty = false, restoreView = false, baseText = null } = {}) {
  try {
    closeDeck();
    closeCourse();
    closePlaylistImport();
    closeReconcile();
    const parsed = parseBackup(text);
    state.store = createStore(parsed, name);
    state.draftAt = null;
    if (!draft) {
      state.base = cloneShelf(shelfFromParsed(parsed));
      state.baseText = text;
    } else if (baseText) {
      try {
        state.base = cloneShelf(shelfFromParsed(parseBackup(baseText)));
        state.baseText = baseText;
      } catch {
        state.base = null;
        state.baseText = null;
      }
    } else {
      // Older drafts have no common ancestor; treat every difference as a conflict.
      state.base = null;
      state.baseText = null;
    }
    if (draft && dirty) {
      state.store.dirty = true;
      state.store.revision = 1;
    }
    if (!restoreView) {
      state.filter = { kind: "all" };
      state.query = "";
      state.scope = "everything";
      state.page = 0;
      state.sidebarQuery = "";
      clearSavedView();
    }
    $("#landing").hidden = true;
    $("#main").hidden = false;
    $("#add").disabled = false;
    $("#export").disabled = false;
    if (restoreView) applySavedView();
    renderAll();
    scheduleDraft();
    toast(
      `${state.store.videos.length} videos · ${state.store.playlists.length} course${state.store.playlists.length === 1 ? "" : "s"}${draft ? " · restored local copy" : ""}`
    );
  } catch (error) {
    toast(error.message || "That file could not be read.");
  }
}

async function loadFile(file) {
  if (!file) return;
  if (file.size > 32 * 1024 * 1024) {
    toast("That file is larger than 32 MB.");
    return;
  }
  openIncoming(await file.text(), file.name);
}

function loadDemo() {
  loadText(JSON.stringify(demoBackup), "demo-shelf.json");
}

/* ---------- merging an opened backup ---------- */
function openIncoming(text, name) {
  let parsed;
  try {
    parsed = parseBackup(text);
  } catch (error) {
    toast(error.message || "That file could not be read.");
    return "none";
  }
  if (!state.store || !state.store.dirty) {
    loadText(text, name);
    return "opened";
  }
  const current = shelfFromStore(state.store);
  const incoming = shelfFromParsed(parsed);
  if (shelfFingerprint(current) === shelfFingerprint(incoming)) {
    toast("That backup matches this shelf.");
    return "none";
  }
  if (state.base && shelfFingerprint(state.base) === shelfFingerprint(current)) {
    loadText(text, name);
    return "opened";
  }
  const result = mergeShelves(state.base, current, incoming);
  const changed = result.stats.added + result.stats.updated + result.stats.deleted;
  if (!changed && !result.conflicts.length) {
    toast("That backup has no newer changes.");
    return "none";
  }
  if (!result.conflicts.length) {
    applyMergedShelf(result.shelf, name, result.stats);
    return "merged";
  }
  openReconcile(result, text, name);
  return "review";
}

function applyMergedShelf(shelf, name, stats = {}) {
  if (!state.store) return;
  replaceShelf(state.store, shelf);
  closeReconcile();
  renderAll();
  scheduleDraft();
  const conflicts = stats.conflicts || 0;
  const changes = (stats.added || 0) + (stats.updated || 0) + (stats.deleted || 0);
  const lead = changes
    ? `Merged ${changes} backup change${changes === 1 ? "" : "s"} from ${name}`
    : `Merged ${name}`;
  toast(
    `${lead}${conflicts
      ? ` · ${conflicts} conflict${conflicts === 1 ? "" : "s"} resolved`
      : ""}`
  );
}

function openReconcile(result, text, name) {
  const diffs = [];
  for (const group of result.conflicts) {
    if (group.fields?.length) {
      for (const field of group.fields) {
        diffs.push({ key: `${group.key}:${field.key}`, group, field });
      }
    } else {
      diffs.push({ key: `${group.key}:presence`, group, field: null });
    }
  }
  state.merge = {
    result,
    text,
    name,
    diffs,
    choices: {},
    resolved: new Set(),
    order: [],
    pending: diffs.map((diff) => diff.key),
    current: diffs[0]?.key || null,
  };
  renderReconcile();
  $("#reconcile-modal").hidden = false;
}

function closeReconcile() {
  state.merge = null;
  const modal = $("#reconcile-modal");
  if (modal) modal.hidden = true;
}

function conflictValueLabel(key, value) {
  if (key === "tags") return value.length ? value.join(", ") : "No categories";
  if (key === "note") return value ? value : "Empty";
  if (key === "isFavorite") return value ? "Favorite" : "Not favorite";
  if (key === "watchStatus") {
    return { watched: "Watched", done: "Watched", watching: "Watching", unwatched: "Unwatched" }[value] || value;
  }
  return String(value ?? "");
}

function presenceLabels(group) {
  if (group.kind === "playlist") {
    if (group.presence === "deleted-in-backup") {
      return {
        note: "The backup deleted this course; this browser edited it.",
        mine: "Keep this course",
        theirs: "Use the deletion",
      };
    }
    if (group.presence === "deleted-here") {
      return {
        note: "This browser deleted this course; the backup edited it.",
        mine: "Keep it deleted",
        theirs: "Bring it back",
      };
    }
    return { note: "Changed in both places.", mine: "Keep this course", theirs: "Use the backup" };
  }
  if (group.presence === "deleted-in-backup") {
    return {
      note: "The backup deleted this video; this browser edited it.",
      mine: "Keep this video",
      theirs: "Use the deletion",
    };
  }
  return {
    note: "This browser deleted this video; the backup edited it.",
    mine: "Keep it deleted",
    theirs: "Bring it back",
  };
}

function mergeDiff(key) {
  return state.merge?.diffs.find((diff) => diff.key === key) || null;
}

function resolveCurrentDiff(key, choice) {
  if (!state.merge) return;
  state.merge.choices[key] = choice;
  state.merge.resolved.add(key);
  if (!state.merge.order.includes(key)) state.merge.order.push(key);
  state.merge.pending = state.merge.pending.filter((item) => item !== key);
  state.merge.current = state.merge.pending[0] || null;
  renderReconcile();
}

function backDiff() {
  if (!state.merge || !state.merge.order.length) return;
  const key = state.merge.order.pop();
  state.merge.resolved.delete(key);
  state.merge.pending = [key, ...state.merge.pending.filter((item) => item !== key)];
  state.merge.current = key;
  renderReconcile();
}

function resolveAllDiffs(choice) {
  if (!state.merge) return;
  for (const diff of state.merge.diffs) {
    state.merge.choices[diff.key] = choice;
    state.merge.resolved.add(diff.key);
  }
  state.merge.pending = [];
  state.merge.order = state.merge.diffs.map((diff) => diff.key);
  state.merge.current = null;
  renderReconcile();
}

function choiceCard(key, choice, title, value, extra = "") {
  return el("button", {
    class: `reconcile-choice-card ${extra}`.trim(),
    type: "button",
    "data-choice": choice,
    onclick: () => resolveCurrentDiff(key, choice),
  },
    el("span", { class: "reconcile-choice-title", text: title }),
    value ? el("span", { class: "reconcile-choice-value", text: value }) : null
  );
}

function diffCard(diff) {
  const group = diff.group;
  const card = el("section", { class: "reconcile-current" },
    el("div", { class: "reconcile-card-head" },
      el("strong", { text: group.title }),
      el("span", { class: "chip", text: group.kind === "video" ? "Video" : "Course" })
    )
  );

  if (diff.field) {
    const field = diff.field;
    card.append(
      el("div", { class: "reconcile-current-label", text: field.label }),
      el("div", { class: "reconcile-choices" },
        choiceCard(diff.key, "mine", "Keep this browser", conflictValueLabel(field.key, field.mine)),
        choiceCard(diff.key, "theirs", "Use the backup", conflictValueLabel(field.key, field.theirs)),
        field.allowBoth
          ? choiceCard(
            diff.key,
            "both",
            "Keep both",
            conflictValueLabel(
              field.key,
              field.both || Array.from(new Set([...field.mine, ...field.theirs]))
            ),
            "both"
          )
          : null
      )
    );
  } else {
    const labels = presenceLabels(group);
    card.append(
      el("div", { class: "reconcile-current-label", text: "Deleted or changed" }),
      el("p", { class: "reconcile-question", text: labels.note }),
      el("div", { class: "reconcile-choices" },
        choiceCard(
          diff.key,
          "mine",
          labels.mine,
          group.kind === "playlist" ? group.mineTitle || "" : ""
        ),
        choiceCard(
          diff.key,
          "theirs",
          labels.theirs,
          group.kind === "playlist" ? group.theirsTitle || group.incoming?.title || "" : ""
        )
      )
    );
  }
  return card;
}

function renderReconcile() {
  if (!state.merge) return;
  const merge = state.merge;
  const { result } = merge;
  const total = merge.diffs.length;
  const done = merge.pending.length === 0;
  const left = merge.pending.length;
  const body = $("#reconcile-body");
  body.replaceChildren();

  const parts = [];
  if (result.stats.added) parts.push(`${result.stats.added} added`);
  if (result.stats.updated) parts.push(`${result.stats.updated} updated`);
  if (result.stats.deleted) parts.push(`${result.stats.deleted} removed`);
  if (result.stats.kept) parts.push(`${result.stats.kept} kept locally`);
  const summary = parts.length ? `${parts.join(" · ")}. ` : "";
  body.append(
    el("p", { class: "reconcile-source", text: `From ${merge.name}` }),
    el("p", { class: "reconcile-summary" },
      `${summary}${total} difference${total === 1 ? "" : "s"} to review. ` +
      "One-sided backup changes are applied automatically."
    ),
    el("div", { class: "reconcile-progress" },
      el("span", { style: `width:${total ? (merge.resolved.size / total) * 100 : 100}%` })
    ),
    el("div", {
      class: "reconcile-progress-label",
      text: `${merge.resolved.size} of ${total} resolved · ${left} left`,
    }),
    el("div", { class: "reconcile-toolbar" },
      el("button", {
        class: "button",
        disabled: merge.order.length === 0,
        onclick: backDiff,
      }, "Back"),
      el("button", { class: "button", onclick: () => resolveAllDiffs("mine") }, "All this browser"),
      el("button", { class: "button", onclick: () => resolveAllDiffs("theirs") }, "All backup")
    )
  );

  if (done) {
    body.append(el("div", { class: "reconcile-done" },
      el("strong", { text: "All differences resolved" }),
      el("p", { text: "Press Merge to apply the choices. Use Back to revisit the last difference." })
    ));
  } else {
    body.append(diffCard(mergeDiff(merge.current)));
  }

  const mergeButton = $("#reconcile-merge");
  if (mergeButton) {
    mergeButton.disabled = !done;
    mergeButton.textContent = done ? "Merge" : `Merge (${left} left)`;
  }
}

/* ---------- rendering ---------- */
function renderAll() {
  if (!state.store) return;
  renderMeta();
  renderSidebar();
  renderContent();
  $("#undo").disabled = !canUndo(state.store);
  updateDriveButton();
  saveView();
}

function render() {
  renderAll();
}

function renderMeta() {
  const store = state.store;
  const meta = $("#file-meta");
  meta.replaceChildren();
  const parts = [
    store.fileName || "Untitled shelf",
    `${store.videos.length} videos`,
    `${store.playlists.length} course${store.playlists.length === 1 ? "" : "s"}`,
  ];
  meta.append(el("span", { class: "file-meta", text: parts.join("  ·  ") }));
  if (store.dirty) meta.append(el("span", { class: "edited", text: " · Edited" }));
  setDraftStatus();
  updateDriveButton();
}

function loadCollapsedSections() {
  try {
    const raw = JSON.parse(localStorage.getItem(SECTIONS_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw.filter((key) => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

function saveCollapsedSections() {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify([...state.sidebarCollapsed]));
  } catch {}
}

function toggleSideSection(key) {
  if (state.sidebarCollapsed.has(key)) state.sidebarCollapsed.delete(key);
  else state.sidebarCollapsed.add(key);
  saveCollapsedSections();
  renderSidebar();
}

function effectiveSidebarHidden() {
  return state.sidebarHidden || (!state.sidebarPinned && state.sidebarPeek);
}

function applySidebarState() {
  const main = $("#main");
  const hidden = effectiveSidebarHidden();
  if (main) main.classList.toggle("sidebar-hidden", hidden);

  const toggle = $("#sidebar-toggle");
  if (toggle) {
    toggle.hidden = !state.store;
    toggle.setAttribute("aria-pressed", String(hidden));
    toggle.title = hidden ? "Show sidebar" : "Hide sidebar";
    toggle.textContent = hidden ? "»" : "☰";
  }

  const peek = $("#sidebar-peek");
  if (peek) {
    peek.hidden = !state.store || !(!state.sidebarPinned && !state.sidebarHidden && state.sidebarPeek);
  }

  const pin = $("#sidebar-pin");
  if (pin) {
    pin.setAttribute("aria-pressed", String(state.sidebarPinned));
    pin.textContent = state.sidebarPinned ? "Pinned" : "Pin";
    pin.title = state.sidebarPinned
      ? "Unpin the sidebar (auto-hide when the pointer leaves)"
      : "Pin the sidebar open";
  }
}

function toggleSidebarVisibility() {
  if (state.sidebarHidden) {
    state.sidebarHidden = false;
    state.sidebarPeek = false;
  } else if (!state.sidebarPinned && state.sidebarPeek) {
    state.sidebarPeek = false;
  } else {
    state.sidebarHidden = true;
    state.sidebarPeek = false;
  }
  try {
    localStorage.setItem(SIDEBAR_HIDDEN_KEY, state.sidebarHidden ? "1" : "0");
  } catch {}
  applySidebarState();
}

let sidebarHideTimer = null;

function scheduleSidebarHide() {
  clearTimeout(sidebarHideTimer);
  if (state.sidebarPinned || state.sidebarHidden) return;
  if (!$("#context-menu").hidden) return;
  if (window.matchMedia("(max-width: 900px)").matches) return;
  sidebarHideTimer = setTimeout(() => {
    state.sidebarPeek = true;
    applySidebarState();
  }, 650);
}

function toggleSidebarPin() {
  state.sidebarPinned = !state.sidebarPinned;
  try {
    localStorage.setItem(SIDEBAR_PIN_KEY, state.sidebarPinned ? "1" : "0");
  } catch {}
  if (state.sidebarPinned) {
    state.sidebarHidden = false;
    state.sidebarPeek = false;
    try { localStorage.setItem(SIDEBAR_HIDDEN_KEY, "0"); } catch {}
  }
  applySidebarState();
  if (!state.sidebarPinned && !$("#sidebar").matches(":hover")) scheduleSidebarHide();
}

function renderSidebar() {
  const store = state.store;
  const sidebar = $("#sidebar");
  sidebar.replaceChildren();
  const { categories, channels } = counts(store);
  const needle = state.sidebarQuery.trim().toLowerCase();
  const keep = (entry) => !needle || entry.name.toLowerCase().includes(needle);

  sidebar.append(
    el("div", { class: "side-search" },
      el("input", {
        type: "search",
        id: "sidebar-search",
        placeholder: "Filter categories & channels",
        value: state.sidebarQuery,
        oninput: (event) => {
          const start = event.target.selectionStart ?? event.target.value.length;
          const end = event.target.selectionEnd ?? start;
          state.sidebarQuery = event.target.value;
          renderSidebar();
          const next = $("#sidebar-search");
          if (next) {
            next.focus();
            next.setSelectionRange(start, end);
          }
        },
      }),
      el("button", {
        class: "side-pin",
        id: "sidebar-pin",
        type: "button",
        title: state.sidebarPinned
          ? "Unpin the sidebar (auto-hide when the pointer leaves)"
          : "Pin the sidebar open",
        "aria-pressed": String(state.sidebarPinned),
        onclick: toggleSidebarPin,
      }, state.sidebarPinned ? "Pinned" : "Pin")
    )
  );

  const videos = storeVideos(store);
  sidebar.append(sideList("Library", [
    row("All videos", videos.length, { kind: "all" }),
    row("Favorites", videos.filter((video) => video.isFavorite).length, { kind: "favorites" }),
    row("Unwatched", videos.filter((video) => video.watchStatus !== "done").length, { kind: "unwatched" }),
    row("Unsorted", videos.filter((video) => video.tags.length === 0).length, { kind: "unsorted" }),
    row("Playlist Catalog", store.playlists.length, { kind: "playlists" }),
  ], "library", 5, Boolean(needle)));

  const pinnedTags = store.pinnedTags
    .map((pin) => categories.find((entry) => entry.name.toLowerCase() === pin.toLowerCase()))
    .filter(Boolean)
    .filter(keep);
  const pinnedChannels = store.pinnedChannels
    .map((pin) => channels.find((entry) => entry.name.toLowerCase() === pin.toLowerCase()))
    .filter(Boolean)
    .filter(keep);

  if (pinnedTags.length || pinnedChannels.length) {
    sidebar.append(sideList("Pinned", [
      ...pinnedTags.map((entry) => categoryRow(entry, true)),
      ...pinnedChannels.map((entry) => channelRow(entry, true)),
    ], "pinned", pinnedTags.length + pinnedChannels.length, Boolean(needle)));
  }

  const pinnedKeys = new Set(store.pinnedTags.map((pin) => pin.toLowerCase()));
  const rest = categories
    .filter((entry) => !pinnedKeys.has(entry.name.toLowerCase()))
    .filter(keep);
  sidebar.append(sideList("Categories", rest.length
    ? rest.map((entry) => categoryRow(entry, false))
    : [el("div", { class: "side-empty", text: "No categories yet" })],
    "categories", rest.length, Boolean(needle)));

  const channelKeys = new Set(store.pinnedChannels.map((pin) => pin.toLowerCase()));
  const channelRows = channels
    .filter((entry) => !channelKeys.has(entry.name.toLowerCase()))
    .filter(keep)
    .slice(0, 14)
    .map((entry) => channelRow(entry, false));
  if (channelRows.length) {
    sidebar.append(sideList("Channels", channelRows, "channels", channelRows.length, Boolean(needle)));
  }
  applySidebarState();
}

function sideList(title, rows, key, count, searching = false) {
  const collapsed = !searching && state.sidebarCollapsed.has(key);
  return el("section", { class: collapsed ? "side-section collapsed" : "side-section" },
    el("button", {
      class: "side-head",
      type: "button",
      "aria-expanded": String(!collapsed),
      title: `${collapsed ? "Expand" : "Collapse"} ${title}`,
      onclick: () => toggleSideSection(key),
    },
      el("span", { class: "chevron", text: collapsed ? "▸" : "▾" }),
      el("span", { class: "side-title", text: title }),
      el("span", { class: "side-count", text: String(count) })
    ),
    el("ul", { class: "side-list", hidden: collapsed }, rows.map((node) => el("li", {}, node)))
  );
}

function row(label, count, filter) {
  return el("button", {
    class: activeFilter(filter) ? "active" : "",
    title: label,
    onclick: () => {
      state.filter = filter;
      state.page = 0;
      render();
    },
  },
    el("span", { class: "label", text: label }),
    el("span", { class: "count", text: String(count) })
  );
}

function activeFilter(filter) {
  const active = state.filter;
  if (active.kind !== filter.kind) return false;
  if (filter.kind === "tag" || filter.kind === "channel") {
    return active.value.toLowerCase() === filter.value.toLowerCase();
  }
  return true;
}

function categoryRow(entry, pinned) {
  const node = el("button", {
    class: activeFilter({ kind: "tag", value: entry.name }) ? "active" : "",
    title: entry.name,
    onclick: () => {
      state.filter = { kind: "tag", value: entry.name };
      state.page = 0;
      render();
    },
    oncontextmenu: (event) => {
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY, [
        {
          label: pinned ? "Unpin category" : "Pin category",
          action: () => {
            toggleTagPin(state.store, entry.name);
            changed();
          },
        },
        { label: "Rename category…", action: () => renamePrompt(entry.name) },
        { label: "Merge into…", action: () => openMerge(entry.name) },
        { separator: true },
        { label: "Delete category from all videos", danger: true, action: () => deletePrompt(entry.name) },
      ]);
      return false;
    },
  },
    el("span", { class: "label", text: entry.name }),
    el("span", { class: "count", text: String(entry.count) })
  );
  return node;
}

function channelRow(entry, pinned) {
  return el("button", {
    class: activeFilter({ kind: "channel", value: entry.name }) ? "active" : "",
    title: entry.name,
    onclick: () => {
      state.filter = { kind: "channel", value: entry.name };
      state.page = 0;
      render();
    },
    oncontextmenu: (event) => {
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY, [
        {
          label: pinned ? "Unpin channel" : "Pin channel",
          action: () => {
            toggleChannelPin(state.store, entry.name);
            changed();
          },
        },
        {
          label: "Show these videos",
          action: () => {
            state.filter = { kind: "channel", value: entry.name };
            state.page = 0;
            render();
          },
        },
      ]);
      return false;
    },
  },
    el("span", { class: "label", text: entry.name }),
    el("span", { class: "count", text: String(entry.count) })
  );
}

function showChannel(name) {
  if (!name) return;
  closeDeck();
  state.filter = { kind: "channel", value: name };
  state.page = 0;
  render();
}

function filterTitle() {
  if (state.filter.kind === "tag") return state.filter.value;
  if (state.filter.kind === "channel") return state.filter.value;
  return {
    all: "All videos",
    favorites: "Favorites",
    unwatched: "Unwatched",
    unsorted: "Unsorted",
    playlists: "Playlist Catalog",
  }[state.filter.kind] || "Shelf";
}

function currentVideos() {
  let videos = storeVideos(state.store);
  videos = applyVideoFilter(videos, state.filter);
  videos = searchVideos(videos, state.query, state.scope);
  return videos.sort((a, b) => b.addedAt - a.addedAt);
}

function currentItems() {
  const videos = storeVideos(state.store);
  const playlists = storePlaylists(state.store);
  if (state.filter.kind === "playlists") {
    const needle = state.query.trim();
    return playlists
      .filter((playlist) => !needle || (state.scope === "titles"
        ? matches(playlist.title, needle)
        : matches(playlistSearchText(playlist), needle)))
      .sort((a, b) => b.addedAt - a.addedAt)
      .map((playlist) => ({ kind: "playlist", addedAt: playlist.addedAt, playlist }));
  }
  return shelfItems(videos, playlists, state.filter, state.query, state.scope);
}

function contentSubtitle(items, window) {
  if (state.filter.kind === "playlists") {
    if (!state.store.hasPlaylistCatalog) return "This backup has no playlist catalog";
    const chapters = items.reduce((sum, item) => sum + item.playlist.items.length, 0);
    return `${items.length} course${items.length === 1 ? "" : "s"} · ${chapters} chapter${chapters === 1 ? "" : "s"}`;
  }
  if (state.filter.kind === "tag") {
    const videoCount = items.filter((item) => item.kind === "video").length;
    const courseCount = items.length - videoCount;
    return `${videoCount} video${videoCount === 1 ? "" : "s"} · ${courseCount} course${courseCount === 1 ? "" : "s"} · ${window.rangeLabel}`;
  }
  return `${items.length} video${items.length === 1 ? "" : "s"}`;
}

function destroyGraph() {
  state.graphToken += 1;
  state.graphController?.destroy();
  state.graphController = null;
}

function renderGraphContent(videos) {
  const content = $("#content");
  const data = buildGraph(storeVideos(state.store), storePlaylists(state.store));
  const active = state.filter.kind === "tag" ? state.filter.value : null;

  const head = el("div", { class: "content-head" },
    el("div", {},
      el("h2", { text: "Category graph" }),
      el("div", { class: "sub", text: `${data.nodes.length} linked categories · ${data.hiddenCount} unlinked hidden` })
    ),
    el("div", { class: "grow" }),
    el("button", {
      class: "button",
      onclick: () => {
        state.view = "grid";
        renderContent();
      },
    }, "Grid"),
    active ? el("button", {
      class: "button primary",
      onclick: () => {
        state.view = "grid";
        renderContent();
      },
    }, "Show videos") : null,
    el("button", {
      class: "button",
      onclick: () => state.graphController?.reset(),
    }, "Reset view")
  );
  content.append(head);

  if (!data.nodes.length) {
    content.append(el("div", { class: "empty" },
      el("h3", { text: "No shared categories yet" }),
      el("p", { text: "The 3D view draws a line when one video carries two categories. Add a second category to connect this shelf." })
    ));
    return;
  }

  const shell = el("div", { class: "graph-shell" });
  const container = el("div", { class: "graph-container", id: "graph-container" });
  const info = el("div", { class: "graph-info" });
  const legend = el("div", { class: "graph-legend" },
    "Drag to orbit · scroll to zoom · click a category to filter"
  );
  shell.append(container, info, legend);
  content.append(shell);

  const selectedNode = data.nodes.find((node) =>
    active ? node.name.toLowerCase() === active.toLowerCase() : node.id === state.graphSelected
  );
  const paintInfo = (node) => {
    info.replaceChildren();
    if (!node) {
      info.append(el("span", { class: "tag-hint", text: "Click a category for its videos" }));
      return;
    }
    info.append(
      el("strong", { text: node.name }),
      el("span", { text: `${node.count} video${node.count === 1 ? "" : "s"} · ${node.group}` }),
      el("button", {
        class: "button primary",
        onclick: () => {
          state.filter = { kind: "tag", value: node.name };
          state.view = "grid";
          state.page = 0;
          renderContent();
        },
      }, "Show videos")
    );
  };
  paintInfo(selectedNode);
  state.graphSelected = selectedNode?.id || null;
  state.graphController?.destroy();
  state.graphController = null;
  const token = ++state.graphToken;

  mountGraph(container, data, {
    onSelect: (node) => {
      state.filter = { kind: "tag", value: node.name };
      state.graphSelected = node.id;
      state.page = 0;
      paintInfo(node);
      renderSidebar();
    },
  }).then((controller) => {
    if (token !== state.graphToken || state.view !== "graph" || !container.isConnected) {
      controller.destroy();
      return;
    }
    state.graphController = controller;
    if (state.graphSelected) controller.select(state.graphSelected);
  }).catch((error) => {
    container.replaceChildren(el("div", { class: "empty" },
      el("h3", { text: "3D is unavailable" }),
      el("p", { text: error.message })
    ));
  });
}

function renderContent() {
  const content = $("#content");
  destroyGraph();
  content.replaceChildren();
  if (state.view === "graph") {
    renderGraphContent(currentVideos());
    return;
  }
  const items = currentItems();
  const videosForDeck = items.filter((item) => item.kind === "video").map((item) => item.video);
  const window = pageWindow(items.length, state.pageSize, state.page);
  const shown = pageSlice(items, window);

  const head = el("div", { class: "content-head" },
    el("div", {},
      el("h2", { text: filterTitle() }),
      el("div", { class: "sub", text: contentSubtitle(items, window) })
    ),
    el("div", { class: "grow" }),
    state.filter.kind === "playlists"
      ? el("button", { class: "button primary", onclick: openPlaylistImport }, "Add playlist")
      : null,
    el("button", {
      class: "button",
      title: "Present this list as slides",
      disabled: videosForDeck.length === 0,
      onclick: () => openDeck(videosForDeck, 0),
    }, "Present"),
    el("button", {
      class: "button",
      title: "Optional 3D category graph",
      onclick: () => {
        state.view = "graph";
        state.page = 0;
        renderContent();
      },
    }, "3D"),
    el("div", { class: "search" },
      el("input", {
        type: "search",
        id: "search",
        placeholder: "Search titles…",
        value: state.query,
        oninput: (event) => {
          const start = event.target.selectionStart ?? event.target.value.length;
          const end = event.target.selectionEnd ?? start;
          state.query = event.target.value;
          state.page = 0;
          renderContent();
          const next = $("#search");
          if (next) {
            next.focus();
            next.setSelectionRange(start, end);
          }
        },
      }),
      el("select", {
        title: "Search scope",
        onchange: (event) => {
          state.scope = event.target.value;
          state.page = 0;
          renderContent();
        },
      },
        el("option", { value: "titles", selected: state.scope === "titles", text: "Titles" }),
        el("option", { value: "everything", selected: state.scope === "everything", text: "Everything" })
      )
    )
  );
  content.append(head);

  if (!items.length) {
    let title = state.query.trim() ? `Nothing matches “${state.query.trim()}”` : "Nothing here";
    let message = state.query.trim() ? "Try a shorter word or switch the scope." : "Add a video, or pick another category.";
    if (state.filter.kind === "playlists") {
      if (!state.store.hasPlaylistCatalog) {
        title = "No playlist catalog";
        message = "This backup was exported without courses. Export again from the Mac so it includes playlists.";
      } else if (!state.query.trim()) {
        title = "No courses yet";
        message = "Add a playlist in the Mac app, then reopen this backup.";
      }
    }
    content.append(el("div", { class: "empty" },
      el("h3", { text: title }),
      el("p", { text: message })
    ));
    return;
  }

  const grid = el("div", { class: "grid" });
  for (const item of shown) {
    grid.append(item.kind === "video" ? videoCard(item.video) : courseCard(item.playlist));
  }
  content.append(grid);

  if (window.pageCount > 1) {
    content.append(pager(items, window));
  }
}

function presentVideo(video) {
  const items = currentVideos();
  const start = Math.max(0, items.findIndex((entry) => entry.youtubeID === video.youtubeID));
  openDeck(items, start);
}

function videoCard(video) {
  const thumb = el("div", { class: "thumb" });
  const img = coverImage(video.youtubeID, () => {
    img.remove();
    thumb.prepend(el("div", { class: "placeholder", text: "No artwork" }));
  });
  thumb.append(img);
  if (video.durationSeconds) {
    thumb.append(el("span", { class: "duration", text: formatDuration(video.durationSeconds) }));
  }
  const actions = el("div", { class: "card-actions" },
    el("button", {
      title: "Open on YouTube",
      onclick: (event) => {
        event.stopPropagation();
        window.open(watchURL(video.youtubeID), "_blank", "noopener");
      },
    }, "YouTube"),
    el("button", {
      title: "Present from here",
      onclick: (event) => {
        event.stopPropagation();
        presentVideo(video);
      },
    }, "Present"),
    el("button", {
      title: "Edit categories and notes",
      onclick: (event) => {
        event.stopPropagation();
        openEditor(video.youtubeID);
      },
    }, "Edit")
  );
  thumb.append(actions);
  thumb.append(el("button", {
    class: `thumb-favorite${video.isFavorite ? " active" : ""}`,
    title: video.isFavorite ? "Remove from favorites" : "Add to favorites",
    onclick: (event) => {
      event.stopPropagation();
      setVideoFavorite(state.store, video.youtubeID, !video.isFavorite);
      changed();
      toast(video.isFavorite ? "Removed from favorites" : "Added to favorites");
    },
  }, video.isFavorite ? "★" : "☆"));

  return el("button", {
    class: "card",
    dataset: { youtubeId: video.youtubeID },
    title: "Open slide · right-click to edit",
    onclick: () => presentVideo(video),
    oncontextmenu: (event) => {
      event.preventDefault();
      event.stopPropagation();
      showContextMenu(event.clientX, event.clientY, [
        { label: "Show slide", action: () => presentVideo(video) },
        { label: "Edit categories and notes…", action: () => openEditor(video.youtubeID) },
        { separator: true },
        {
          label: "Open on YouTube",
          action: () => window.open(watchURL(video.youtubeID), "_blank", "noopener"),
        },
      ]);
      return false;
    },
  },
    thumb,
    el("div", { class: "card-body" },
      el("div", { class: "card-title", text: video.title }),
      el("div", { class: "card-meta" },
        el("span", { text: video.channel || "Unknown channel" }),
        el("span", { class: "dot", text: "·" }),
        el("span", { text: dateLabel(video.addedAt) }),
        video.watchStatus === "done" ? el("span", { class: "dot", text: "·" }) : null,
        video.watchStatus === "done" ? el("span", { class: "watch-dot", text: "✓ watched" }) : null
      ),
      tagRow(video.tags)
    )
  );
}

function tagRow(tags) {
  if (!tags.length) return el("div", { class: "card-tags" }, el("span", { class: "chip", text: "Unsorted" }));
  return el("div", { class: "card-tags" },
    tags.slice(0, 3).map((tag) => el("span", { class: "chip", text: tag })),
    tags.length > 3 ? el("span", { class: "chip", text: `+${tags.length - 3}` }) : null
  );
}

let youtubeApiPromise = null;

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("YouTube's player did not load. Add the playlist on the Mac instead."));
    }, 15000);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === "function") previous();
      if (settled || !window.YT?.Player) return;
      settled = true;
      clearTimeout(timeout);
      resolve(window.YT);
    };
    if (document.querySelector('script[data-youtube-api="1"]')) return;
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.dataset.youtubeApi = "1";
    script.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      script.remove();
      reject(new Error("YouTube's player script could not load."));
    };
    document.head.append(script);
  }).catch((error) => {
    youtubeApiPromise = null;
    throw error;
  });
  return youtubeApiPromise;
}

function closePlaylistImport() {
  state.playlistToken += 1;
  try { state.playlistPlayer?.destroy?.(); } catch {}
  state.playlistPlayer = null;
  const modal = $("#playlist-modal");
  if (modal) modal.hidden = true;
  $("#playlist-body")?.replaceChildren();
}

async function fetchOEmbed(url) {
  const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
  if (!response.ok) throw new Error(`YouTube answered ${response.status}`);
  return response.json();
}

function readPlaylistIDs(holder, id, token) {
  return loadYouTubeApi().then((YT) => new Promise((resolve, reject) => {
    let settled = false;
    let player = null;
    let poll = null;
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(poll);
      if (error) reject(error);
      else resolve(value);
    };
    const timeout = setTimeout(
      () => finish(null, new Error("YouTube did not answer in time.")),
      20000
    );
    try {
      player = new YT.Player(holder, {
        height: "180",
        width: "320",
        playerVars: { listType: "playlist", list: id, origin: location.origin },
        events: {
          onReady: () => {
            try {
              player.cuePlaylist({ list: id, listType: "playlist" });
            } catch (error) {
              finish(null, error);
              return;
            }
            let previous = -1;
            let stable = 0;
            poll = setInterval(() => {
              if (token !== state.playlistToken) {
                finish(null, new Error("cancelled"));
                return;
              }
              let ids = [];
              try { ids = player.getPlaylist() || []; } catch {}
              if (!ids.length) return;
              if (ids.length === previous) stable += 1;
              else {
                previous = ids.length;
                stable = 0;
              }
              if (stable >= 2) finish({ player, ids });
            }, 400);
          },
          onError: (event) => finish(null, new Error(`YouTube could not read this playlist (${event.data}).`)),
        },
      });
      state.playlistPlayer = player;
    } catch (error) {
      finish(null, error);
    }
  }));
}

function openPlaylistImport() {
  if (!state.store) return;
  closePlaylistImport();
  const body = $("#playlist-body");
  const input = el("input", {
    type: "url",
    placeholder: "https://www.youtube.com/playlist?list=…",
  });
  const status = el("div", { class: "tag-hint" });
  const playerSlot = el("div", { class: "playlist-player-slot" });
  const fetchButton = el("button", { class: "button primary", onclick: () => start() }, "Fetch playlist");

  body.append(
    el("div", { class: "field" },
      el("label", { text: "Playlist link" }),
      el("div", { class: "tag-entry" }, input, fetchButton)
    ),
    el("div", { class: "tag-hint" },
      "Reads the public chapter list with YouTube's player. No API key, no proxy; nothing is added until you confirm."
    ),
    status,
    playerSlot
  );
  $("#playlist-modal").hidden = false;
  input.focus();

  async function start() {
    const id = playlistIDFromText(input.value);
    if (!id) {
      status.textContent = "Paste a playlist link with a list=… ID.";
      return;
    }
    const token = ++state.playlistToken;
    fetchButton.disabled = true;
    status.textContent = "Reading playlist…";
    playerSlot.replaceChildren();
    const holder = el("div", { class: "playlist-player" });
    playerSlot.append(holder);
    try {
      const { ids } = await readPlaylistIDs(holder, id, token);
      if (token !== state.playlistToken) return;
      try { state.playlistPlayer?.destroy?.(); } catch {}
      state.playlistPlayer = null;
      playerSlot.replaceChildren();
      const unique = [...new Set(ids.filter(Boolean))];
      if (!unique.length) throw new Error("That playlist has no readable chapters.");
      status.textContent = `Loading ${unique.length} chapters…`;
      const meta = await fetchOEmbed(`https://www.youtube.com/playlist?list=${id}`).catch(() => null);
      if (token !== state.playlistToken) return;
      const items = new Array(unique.length);
      let cursor = 0;
      async function worker() {
        while (cursor < unique.length) {
          const index = cursor;
          cursor += 1;
          const data = await fetchOEmbed(watchURL(unique[index])).catch(() => null);
          if (token !== state.playlistToken) return;
          items[index] = {
            videoID: unique[index],
            title: data?.title || `Chapter ${index + 1}`,
            channel: data?.author_name || meta?.author_name || "",
            durationSeconds: null,
          };
          status.textContent = `Loading chapters… ${items.filter(Boolean).length} / ${unique.length}`;
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, unique.length) }, worker));
      if (token !== state.playlistToken) return;
      status.textContent = "";
      const title = meta?.title || "Playlist";
      const channel = meta?.author_name || "";
      const result = el("div", { class: "playlist-result" },
        el("div", { class: "field-label", text: "Found" }),
        el("strong", { text: title }),
        el("div", { class: "tag-hint", text: `${channel || "Playlist"} · ${items.length} chapters` }),
        el("div", { class: "drive-actions" },
          el("button", {
            class: "button primary",
            onclick: () => {
              const record = {
                id,
                title,
                channel,
                items,
                watchedItemIDs: [],
                tags: [],
                addedAt: new Date().toISOString(),
                fetchedAt: new Date().toISOString(),
                isTruncated: unique.length >= 200,
              };
              const added = addPlaylist(state.store, record);
              closePlaylistImport();
              state.filter = { kind: "playlists" };
              state.page = 0;
              changed();
              openCourse(id);
              toast(added ? `Added ${items.length} chapters` : "Already in the catalog");
            },
          }, "Add to catalog"),
          el("button", { class: "button", onclick: closePlaylistImport }, "Cancel")
        )
      );
      body.append(result);
    } catch (error) {
      if (token !== state.playlistToken) return;
      status.textContent = error.message || "Could not read that playlist.";
      fetchButton.disabled = false;
    }
  }
}

function courseThumb(playlist) {
  const thumb = el("div", { class: "thumb" });
  const cover = playlist.items[0];
  if (cover) {
    thumb.append(thumbnail(cover.videoID));
  } else {
    thumb.append(el("div", { class: "placeholder", text: "No chapters" }));
  }
  thumb.append(el("span", { class: "chapters", text: `${playlist.items.length} chapters` }));
  return thumb;
}

function courseCard(playlist) {
  const watched = courseWatchedCount(playlist);
  return el("button", {
    class: "card",
    dataset: { playlistId: playlist.id },
    title: "Open course",
    onclick: () => openCourse(playlist.id),
  },
    courseThumb(playlist),
    el("div", { class: "card-body" },
      el("div", { class: "card-title", text: playlist.title }),
      el("div", { class: "card-meta" },
        el("span", { text: playlist.channel || "Playlist" }),
        el("span", { class: "dot", text: "·" }),
        el("span", { text: `${watched}/${playlist.items.length} watched` }),
        playlist.isTruncated ? el("span", { class: "dot", text: "·" }) : null,
        playlist.isTruncated ? el("span", { text: "first batch" }) : null
      ),
      el("div", { class: "progress" },
        el("span", { style: `width:${Math.round(courseProgress(playlist) * 100)}%` })
      ),
      tagRow(playlist.tags)
    )
  );
}

function openCourse(playlistID) {
  const playlist = storePlaylists(state.store).find((item) => item.id === playlistID);
  if (!playlist) return;
  state.course = playlistID;
  $("#course").hidden = false;
  renderCourse();
}

function closeCourse() {
  state.course = null;
  const sheet = $("#course");
  if (sheet) sheet.hidden = true;
}

function renderCourse() {
  const sheet = $("#course");
  if (!sheet || !state.course) return;
  const playlist = storePlaylists(state.store).find((item) => item.id === state.course);
  if (!playlist) {
    closeCourse();
    return;
  }
  sheet.replaceChildren();

  const onShelf = playlist.items
    .map((item) => state.store.videos.find((video) => video.youtubeID === item.videoID))
    .filter(Boolean);
  const cover = playlist.items[0];

  sheet.append(el("div", { class: "deck-top" },
    el("button", { class: "pill", onclick: closeCourse }, "‹ Back"),
    el("span", { text: "Course" }),
    el("div", { class: "right" },
      el("span", { text: `${courseWatchedCount(playlist)} / ${playlist.items.length} watched` }),
      el("button", { class: "pill", onclick: closeCourse, title: "Close (esc)" }, "✕")
    )
  ));

  const tagsBox = el("div", { class: "chip-list" });
  const tagInput = el("input", {
    type: "text",
    id: "course-tag-input",
    list: "course-tag-list",
    placeholder: "Add a category",
    onkeydown: (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      addCourseTag();
    },
  });
  const tagDatalist = el("datalist", { id: "course-tag-list" },
    allCategoryNames().map((name) => el("option", { value: name }))
  );

  function applyTags(next) {
    setPlaylistTags(state.store, playlist.id, next);
    changed();
    renderCourse();
    requestAnimationFrame(() => {
      const input = $("#course-tag-input");
      if (input) input.focus();
    });
  }

  function addCourseTag() {
    const tag = canonicalTag(tagInput.value);
    if (!tag) return;
    if (playlist.tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      tagInput.value = "";
      return;
    }
    applyTags([...playlist.tags, tag]);
  }

  function paintCourseTags() {
    tagsBox.replaceChildren(...playlist.tags.map((tag) =>
      el("span", { class: "tag-chip" }, tag,
        el("button", {
          title: "Remove category",
          onclick: () => applyTags(playlist.tags.filter((value) => value !== tag)),
        }, "✕")
      )
    ));
  }
  paintCourseTags();

  const head = el("div", { class: "course-head" });
  if (cover) {
    head.append(thumbnail(cover.videoID));
  } else {
    head.append(el("div", { class: "mosaic" }, el("div", { class: "placeholder", text: "No chapters" })));
  }
  head.append(el("div", { class: "course-info" },
    el("h2", { text: playlist.title }),
    el("div", { class: "deck-meta" },
      el("span", { text: playlist.channel || "Playlist" }),
      el("span", { text: "·" }),
      el("span", { text: `${courseWatchedCount(playlist)} of ${playlist.items.length} watched` }),
      el("span", { text: "·" }),
      el("span", { text: `${onShelf.length} on your shelf` })
    ),
    el("div", { class: "progress", style: "margin:10px 0 12px;max-width:320px" },
      el("span", { style: `width:${Math.round(courseProgress(playlist) * 100)}%` })
    ),
    el("div", { class: "field-label", text: "Categories" }),
    tagsBox,
    el("div", { class: "tag-entry" },
      tagInput,
      el("button", { class: "button", onclick: addCourseTag }, "Add")
    ),
    tagDatalist,
    el("div", { class: "deck-actions" },
      el("a", {
        class: "button",
        href: playlistURL(playlist.id),
        target: "_blank",
        rel: "noreferrer noopener",
        text: "Open on YouTube",
      }),
      onShelf.length
        ? el("button", {
            class: "button primary",
            onclick: () => {
              closeCourse();
              openDeck(onShelf, 0);
            },
          }, `Present ${onShelf.length} chapter${onShelf.length === 1 ? "" : "s"}`)
        : null
    )
  ));
  sheet.append(head);

  const list = el("div", { class: "course-list" });
  playlist.items.forEach((item, index) => {
    const video = state.store.videos.find((entry) => entry.youtubeID === item.videoID);
    const watched = playlistWatched(playlist, item.videoID);
    list.append(el("div", { class: "course-row" },
      el("span", { class: "idx", text: String(index + 1) }),
      el("button", {
        class: watched ? "tick on" : "tick",
        title: watched ? "Mark chapter unwatched" : "Mark chapter watched",
        onclick: () => {
          togglePlaylistChapter(state.store, playlist.id, item.videoID);
          changed();
          renderCourse();
        },
      }, watched ? "✓" : "○"),
      thumbnail(item.videoID),
      el("div", {},
        el("div", { class: "title", text: item.title }),
        el("div", { class: "sub", text: [item.channel, formatDuration(item.durationSeconds)].filter(Boolean).join(" · ") })
      ),
      el("div", { class: "row-actions" },
        el("span", { class: "shelf", text: video ? "On shelf" : "Not on shelf" }),
        video
          ? el("button", {
              class: "button",
              onclick: () => {
                closeCourse();
                openEditor(item.videoID);
              },
            }, "Edit")
          : null
      )
    ));
  });
  sheet.append(list);

  sheet.append(el("div", { class: "course-footer" },
    el("button", {
      class: "button danger",
      onclick: () => {
        if (!confirm(`Remove “${playlist.title}” from the course catalog? Its videos stay on the shelf.`)) return;
        removePlaylist(state.store, playlist.id);
        closeCourse();
        changed();
        toast("Course removed");
      },
    }, "Remove course"),
    el("span", { class: "grow" }),
    el("span", { class: "tag-hint", text: `Added ${dateLabel(playlist.addedAt)}` })
  ));
}

function pager(items, window) {
  return el("div", { class: "pager" },
    el("button", {
      class: "button",
      disabled: window.isFirst,
      onclick: () => {
        state.page = window.index - 1;
        renderContent();
      },
    }, "Previous"),
    el("span", { text: window.rangeLabel }),
    el("span", { class: "grow" }),
    el("span", { text: `Page ${window.index + 1} of ${window.pageCount}` }),
    el("select", {
      title: "Page size",
      onchange: (event) => {
        state.pageSize = Number(event.target.value);
        state.page = 0;
        renderContent();
      },
    }, PAGE_SIZES.map((size) =>
      el("option", { value: String(size), selected: size === state.pageSize, text: `${size} per page` })
    )),
    el("button", {
      class: "button",
      disabled: window.isLast,
      onclick: () => {
        state.page = window.index + 1;
        renderContent();
      },
    }, "Next")
  );
}


/* ---------- slide deck ---------- */
function openDeck(items, start = 0) {
  const videos = items.filter((item) => item?.youtubeID);
  if (!videos.length) return;
  state.deck = { items: videos, index: Math.max(0, Math.min(start, videos.length - 1)) };
  $("#deck").hidden = false;
  document.body.style.overflow = "hidden";
  renderDeck();
}

function closeDeck() {
  state.deck = null;
  const deck = $("#deck");
  if (deck) deck.hidden = true;
  document.body.style.overflow = "";
}

function deckStep(delta) {
  if (!state.deck) return;
  const next = state.deck.index + delta;
  if (next < 0 || next >= state.deck.items.length) return;
  state.deck.index = next;
  renderDeck();
}

function deckJump(index) {
  if (!state.deck) return;
  state.deck.index = Math.max(0, Math.min(index, state.deck.items.length - 1));
  renderDeck();
}

function renderDeck() {
  const deck = $("#deck");
  if (!deck || !state.deck) return;
  const video = state.deck.items[state.deck.index];
  const backdrop = el("div", { class: "deck-backdrop" });
  const backdropImg = coverImage(video.youtubeID, () => {});
  backdrop.append(backdropImg);

  const top = el("div", { class: "deck-top" },
    el("button", { class: "pill", onclick: closeDeck, text: "‹ Shelf" }, " "),
    el("span", { text: filterTitle() }),
    el("div", { class: "right" },
      el("span", { text: `${state.deck.index + 1} / ${state.deck.items.length}` }),
      el("button", { class: "pill", onclick: closeDeck, title: "Close (esc)" }, "✕")
    )
  );

  const media = el("div", { class: "deck-media" });
  const placeholder = el("div", { class: "deck-media-placeholder", text: "No artwork" });
  const img = coverImage(video.youtubeID, () => {
    img.remove();
    media.prepend(placeholder);
  });
  media.append(img);
  media.append(
    el("button", {
      class: "deck-nav prev",
      disabled: state.deck.index === 0,
      title: "Previous (←)",
      onclick: () => deckStep(-1),
    }, "‹"),
    el("button", {
      class: "deck-nav next",
      disabled: state.deck.index >= state.deck.items.length - 1,
      title: "Next (→)",
      onclick: () => deckStep(1),
    }, "›")
  );

  const info = el("div", { class: "deck-info" },
    el("div", { class: "deck-kicker", text: "SLIDE" }),
    el("div", { class: "deck-title", text: video.title }),
    el("div", { class: "deck-meta" },
      video.channel
        ? el("button", {
            class: "deck-channel",
            title: `Show ${video.channel} in the shelf`,
            onclick: () => showChannel(video.channel),
          }, video.channel)
        : el("span", { text: "Unknown channel" }),
      video.durationSeconds ? el("span", { text: "·" }) : null,
      video.durationSeconds ? el("span", { text: formatDuration(video.durationSeconds) }) : null,
      video.watchStatus === "done" ? el("span", { text: "· Watched" }) : null,
      video.isFavorite ? el("span", { text: "· ★ Favorite" }) : null
    ),
    el("div", { class: "deck-saved", text: `saved ${dateLabel(video.addedAt)}` }),
    deckTags(video.tags),
    video.note ? el("p", { class: "deck-note", text: video.note }) : null,
    el("div", { class: "deck-actions" },
      el("a", {
        class: "button primary",
        href: watchURL(video.youtubeID),
        target: "_blank",
        rel: "noreferrer noopener",
        text: "Play on YouTube",
      }),
      el("button", {
        class: "button",
        onclick: () => {
          closeDeck();
          openEditor(video.youtubeID);
        },
      }, "Edit")
    )
  );

  const body = el("div", { class: "deck-body" }, media, info);

  const film = el("div", { class: "filmstrip" });
  const radius = 16;
  const lower = Math.max(0, state.deck.index - radius);
  const upper = Math.min(state.deck.items.length, state.deck.index + radius + 1);
  for (let i = lower; i < upper; i += 1) {
    const item = state.deck.items[i];
    const button = el("button", {
      class: i === state.deck.index ? "current" : "",
      title: item.title,
      onclick: () => deckJump(i),
    });
    button.append(coverImage(item.youtubeID, () => {}));
    film.append(button);
  }

  const progress = el("div", { class: "deck-progress" },
    el("span", { style: `width:${((state.deck.index + 1) / state.deck.items.length) * 100}%` })
  );

  const controls = el("div", { class: "deck-controls" },
    el("button", { class: "button", disabled: state.deck.index === 0, onclick: () => deckStep(-1) }, "‹ Previous"),
    el("span", { class: "grow" }),
    el("a", {
      class: "link",
      href: watchURL(video.youtubeID),
      target: "_blank",
      rel: "noreferrer noopener",
      text: "Open on YouTube",
    }),
    el("span", { class: "grow" }),
    el("button", { class: "button", disabled: state.deck.index >= state.deck.items.length - 1, onclick: () => deckStep(1) }, "Next ›")
  );

  deck.replaceChildren(backdrop, top, body, film, progress, controls);
  requestAnimationFrame(() => {
    film.querySelector(".current")?.scrollIntoView({ inline: "center", block: "nearest" });
  });
}

function deckTags(tags) {
  if (!tags.length) return el("div", { class: "deck-tags" }, el("span", { class: "deck-chapter", text: "No category" }));
  return el("div", { class: "deck-tags" }, tags.map((tag) =>
    el("button", {
      onclick: () => {
        closeDeck();
        state.filter = { kind: "tag", value: tag };
        state.page = 0;
        render();
      },
      text: tag,
    })
  ));
}

/* ---------- categories ---------- */
function allCategoryNames() {
  const map = new Map();
  for (const entry of counts(state.store).categories) map.set(entry.name.toLowerCase(), entry.name);
  for (const name of TAXONOMY_CATEGORY_NAMES) {
    if (!map.has(name.toLowerCase())) map.set(name.toLowerCase(), name);
  }
  return [...map.values()].sort((a, b) => a.localeCompare(b));
}

function otherCategories(workingTags, limit = 12) {
  return counts(state.store).categories
    .filter((entry) => !workingTags.some(
      (tag) => tag.toLowerCase() === entry.name.toLowerCase()
    ))
    .slice(0, limit);
}

function paintKnownCategories(container, workingTags, onAdd) {
  const existing = otherCategories(workingTags);
  container.replaceChildren(...existing.map((entry) =>
    el("button", {
      class: "tag-chip",
      title: `${entry.count} video${entry.count === 1 ? "" : "s"}`,
      onclick: () => onAdd(entry.name),
    }, entry.name)
  ));
  if (!existing.length) {
    container.append(el("span", { class: "tag-hint", text: "No other categories yet" }));
  }
}

/* ---------- editor ---------- */
function openEditor(youtubeID) {
  const raw = videoByYoutubeID(state.store, youtubeID);
  if (!raw) return;
  const video = storeVideos(state.store).find((entry) => entry.youtubeID === youtubeID);
  const working = {
    tags: [...(raw.tags || [])],
    note: raw.note || "",
    isFavorite: Boolean(raw.isFavorite),
    watchStatus: raw.watchStatus || "unwatched",
  };
  const videos = storeVideos(state.store);
  const known = counts(state.store).categories.map((entry) => entry.name);
  const profiles = buildCategoryProfiles(videos);
  let suggestions = suggestTags({
    title: video.title,
    channel: video.channel,
    note: working.note,
    knownCategories: known,
    profiles,
    channelHint: channelAffinity(videos, video.channel),
  }).tags;

  const body = $("#editor-body");
  body.replaceChildren();
  $("#editor-title").textContent = "Edit video";
  const tagsBox = el("div", { class: "chip-list" });
  const suggestBox = el("div", { class: "chip-list" });
  const knownBox = el("div", { class: "chip-list" });
  const listId = "editor-category-list";
  const datalist = el("datalist", { id: listId },
    allCategoryNames().map((name) => el("option", { value: name }))
  );
  const input = el("input", {
    type: "text",
    placeholder: "Type your category, or pick one below",
    list: listId,
    onkeydown: (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      commitTypedCategory();
    },
  });

  function commitTypedCategory() {
    const tag = canonicalTag(input.value);
    if (!tag) return;
    if (!working.tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      working.tags.push(tag);
    }
    input.value = "";
    paintTags();
  }

  function updateAddButton() {
    const duplicate = Boolean(working.id) && hasDuplicate(state.store, working.id);
    addButton.textContent = duplicate ? "Update categories" : "Add to shelf";
    addButton.disabled = false;
    addButton.title = duplicate ? "Apply the categories above to the existing video" : "";
  }

  function showExisting() {
    if (!working.id) return;
    closeModal("#add-modal");
    revealVideo(working.id);
  }

  function updateExistingCategories() {
    if (!working.id) return;
    commitTypedCategory();
    if (!working.tags.length) {
      toast("Pick at least one category to update.");
      return;
    }
    setVideoTags(state.store, working.id, working.tags);
    closeModal("#add-modal");
    changed();
    revealVideo(working.id);
    toast("Categories updated");
  }

  function paintTags() {
    tagsBox.replaceChildren(...working.tags.map((tag) =>
      el("span", { class: "tag-chip" }, tag,
        el("button", {
          title: "Remove",
          onclick: () => {
            working.tags = working.tags.filter((value) => value !== tag);
            paintTags();
          },
        }, "✕")
      )
    ));
    const extra = suggestions.filter(
      (tag) => !working.tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())
    );
    suggestBox.replaceChildren(...extra.map((tag) =>
      el("button", {
        class: "tag-chip suggested",
        title: "Add this suggestion",
        onclick: () => {
          working.tags.push(tag);
          paintTags();
        },
      }, tag)
    ));
    if (!extra.length) {
      suggestBox.append(el("span", { class: "tag-hint", text: "No more suggestions" }));
    }
    paintKnownCategories(knownBox, working.tags, (name) => {
      working.tags.push(name);
      paintTags();
    });
  }

  const preview = el("div", { class: "edit-preview" },
    thumbnail(video.youtubeID),
    el("div", { class: "meta" },
      el("div", { class: "title", text: video.title }),
      el("div", { class: "sub", text: `${video.channel || "Unknown channel"} · ${dateLabel(video.addedAt)}` }),
      el("a", {
        class: "link",
        href: watchURL(video.youtubeID),
        target: "_blank",
        rel: "noreferrer noopener",
        text: "Open on YouTube",
      })
    )
  );

  body.append(
    preview,
    el("div", { class: "field" },
      el("div", { class: "field-label", text: "Categories" }),
      tagsBox,
      el("div", { class: "tag-entry" }, input),
      datalist,
      el("div", { class: "tag-hint", text: "Suggested from the title, channel and your shelf" }),
      suggestBox,
      el("div", { class: "field-label", text: "Your categories" }),
      knownBox
    ),
    el("div", { class: "field" },
      el("label", { text: "Why you saved it" }),
      el("textarea", {
        placeholder: "Optional — searchable later",
        value: working.note,
        oninput: (event) => {
          working.note = event.target.value;
        },
      })
    ),
    el("div", { class: "edit-row" },
      el("label", {},
        el("input", {
          type: "checkbox",
          checked: working.isFavorite,
          onchange: (event) => {
            working.isFavorite = event.target.checked;
          },
        }),
        "Favorite"
      ),
      el("label", {},
        "Watch",
        el("select", {
          onchange: (event) => {
            working.watchStatus = event.target.value;
          },
        },
          ["unwatched", "watching", "done"].map((status) =>
            el("option", {
              value: status,
              selected: working.watchStatus === status,
              text: status === "done" ? "Watched" : status === "watching" ? "Watching" : "Unwatched",
            })
          )
        )
      )
    ),
    el("div", { class: "modal-actions" },
      el("button", {
        class: "button danger",
        onclick: () => {
          if (!confirm(`Remove “${video.title}” from the shelf?`)) return;
          deleteVideo(state.store, youtubeID);
          closeModal("#editor-modal");
          changed();
        },
      }, "Remove"),
      el("span", { class: "grow" }),
      el("button", { class: "button", onclick: () => closeModal("#editor-modal") }, "Cancel"),
      el("button", {
        class: "button primary",
        onclick: () => {
          commitTypedCategory();
          saveVideo(state.store, youtubeID, working);
          closeModal("#editor-modal");
          changed();
          toast("Video updated");
        },
      }, "Save")
    )
  );

  paintTags();
  $("#editor-modal").hidden = false;
}

/**
 * YouTube answers a missing maxresdefault with 404 + a 120×90 grey body, which
 * Chrome decodes without firing `error`. Treat that size as a miss and try the
 * next quality. This is the same rule as the Mac app.
 */
function coverImage(videoID, onGiveUp) {
  const img = el("img", { alt: "", loading: "lazy" });
  const candidates = thumbnailCandidates(videoID);
  let index = 0;
  const advance = () => {
    index += 1;
    if (index < candidates.length) img.src = candidates[index];
    else onGiveUp?.();
  };
  img.addEventListener("error", advance);
  img.addEventListener("load", () => {
    if (img.naturalWidth <= 120) advance();
  });
  img.src = candidates[0];
  return img;
}

function thumbnail(videoID) {
  return coverImage(videoID, () => {});
}

function revealVideo(youtubeID) {
  if (!state.store) return;
  state.view = "grid";
  state.filter = { kind: "all" };
  state.query = "";
  state.scope = "everything";
  state.sidebarQuery = "";
  state.page = 0;
  const items = currentVideos();
  const index = items.findIndex((video) => video.youtubeID === youtubeID);
  if (index !== -1) state.page = Math.floor(index / state.pageSize);
  renderAll();
  requestAnimationFrame(() => {
    const card = document.querySelector(`.card[data-youtube-id="${youtubeID}"]`);
    if (!card) return;
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    card.classList.add("card-flash");
    setTimeout(() => card.classList.remove("card-flash"), 1800);
  });
}

/* ---------- add ---------- */
function openAdd() {
  const working = {
    id: "",
    title: "",
    channel: "",
    tags: [],
    note: "",
    suggestions: [],
    fetching: false,
    tagsSeeded: false,
  };
  const body = $("#add-body");
  body.replaceChildren();
  const videos = storeVideos(state.store);
  const profiles = buildCategoryProfiles(videos);
  const preview = el("div", { class: "edit-preview" });
  const tagBox = el("div", { class: "chip-list" });
  const suggestBox = el("div", { class: "chip-list" });
  const knownBox = el("div", { class: "chip-list" });
  const warning = el("div", { class: "tag-hint warn", hidden: true, text: "No category yet — this will be Unsorted." });
  const listId = "add-category-list";
  const datalist = el("datalist", { id: listId },
    allCategoryNames().map((name) => el("option", { value: name }))
  );
  const titleInput = el("input", {
    type: "text",
    placeholder: "Title",
    oninput: (event) => {
      working.title = event.target.value;
    },
  });
  const channelInput = el("input", {
    type: "text",
    placeholder: "Channel",
    oninput: (event) => {
      working.channel = event.target.value;
    },
  });
  const urlInput = el("input", {
    type: "url",
    placeholder: "https://www.youtube.com/watch?v=…",
  });
  const categoryInput = el("input", {
    type: "text",
    placeholder: "Type your category, or pick one below",
    list: listId,
    onkeydown: (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      commitTypedCategory();
    },
  });
  const status = el("div", { class: "tag-hint" });
  const duplicateBox = el("div", { class: "duplicate-box", hidden: true });

  function commitTypedCategory() {
    const tag = canonicalTag(categoryInput.value);
    if (!tag) return;
    if (!working.tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      working.tags.push(tag);
    }
    categoryInput.value = "";
    paintTags();
  }

  function updateAddButton() {
    const duplicate = Boolean(working.id) && hasDuplicate(state.store, working.id);
    addButton.textContent = duplicate ? "Update categories" : "Add to shelf";
    addButton.disabled = false;
    addButton.title = duplicate ? "Apply the categories above to the existing video" : "";
  }

  function showExisting() {
    if (!working.id) return;
    closeModal("#add-modal");
    revealVideo(working.id);
  }

  function updateExistingCategories() {
    if (!working.id) return;
    commitTypedCategory();
    if (!working.tags.length) {
      toast("Pick at least one category to update.");
      return;
    }
    setVideoTags(state.store, working.id, working.tags);
    closeModal("#add-modal");
    changed();
    revealVideo(working.id);
    toast("Categories updated");
  }

  function paintTags() {
    tagBox.replaceChildren(...working.tags.map((tag) =>
      el("span", { class: "tag-chip" }, tag,
        el("button", {
          onclick: () => {
            working.tags = working.tags.filter((value) => value !== tag);
            paintTags();
          },
        }, "✕")
      )
    ));
    const extra = working.suggestions.filter(
      (tag) => !working.tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())
    );
    suggestBox.replaceChildren(...extra.map((tag) =>
      el("button", {
        class: "tag-chip suggested",
        onclick: () => {
          working.tags.push(tag);
          paintTags();
        },
      }, tag)
    ));
    paintKnownCategories(knownBox, working.tags, (name) => {
      working.tags.push(name);
      paintTags();
    });
    warning.hidden = working.tags.length > 0;
    updateAddButton();
  }

  function suggest() {
    working.suggestions = suggestTags({
      title: working.title,
      channel: working.channel,
      note: working.note,
      knownCategories: counts(state.store).categories.map((entry) => entry.name),
      profiles,
      channelHint: channelAffinity(videos, working.channel),
    }).tags;
    paintTags();
  }

  function paintPreview() {
    preview.replaceChildren();
    if (!working.id) return;
    preview.append(
      thumbnail(working.id),
      el("div", { class: "meta" },
        el("div", { class: "title", text: working.title || "Untitled" }),
        el("div", { class: "sub", text: working.channel || "Unknown channel" }),
        el("div", { class: "tag-hint", text: working.id })
      )
    );
    const duplicate = hasDuplicate(state.store, working.id);
    status.textContent = "";
    duplicateBox.hidden = !duplicate;
    if (duplicate) {
      const existing = videoByYoutubeID(state.store, working.id);
      if (!working.tagsSeeded) {
        for (const tag of existing?.tags || []) {
          if (!working.tags.some((current) => current.toLowerCase() === tag.toLowerCase())) {
            working.tags.push(tag);
          }
        }
        working.tagsSeeded = true;
        paintTags();
      }
      const existingTags = existing?.tags || [];
      duplicateBox.replaceChildren(
        el("div", {
          class: "tag-hint",
          text: existingTags.length
            ? "This video is already on the shelf. Existing categories are loaded above."
            : "This video is already on the shelf. Add a category above to update it.",
        }),
        el("div", { class: "drive-actions" },
          el("button", { class: "button", onclick: showExisting }, "Show existing card")
        )
      );
    } else {
      duplicateBox.replaceChildren();
    }
    updateAddButton();
  }

  let fetchButton = null;

  async function resolve() {
    if (working.fetching) return;
    const id = youtubeIDFromText(urlInput.value);
    if (!id) {
      toast("Paste a YouTube link with an 11-character video ID.");
      return;
    }
    if (working.id !== id) working.tagsSeeded = false;
    working.id = id;
    working.fetching = true;
    if (fetchButton) {
      fetchButton.disabled = true;
      fetchButton.textContent = "Fetching…";
    }
    try {
      const response = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(watchURL(working.id))}&format=json`
      );
      if (!response.ok) throw new Error(`YouTube answered ${response.status}`);
      const data = await response.json();
      working.title = data.title || working.title;
      working.channel = data.author_name || working.channel;
      titleInput.value = working.title;
      channelInput.value = working.channel;
      suggest();
      paintPreview();
      toast("Details loaded");
    } catch (error) {
      toast(`Could not load details: ${error.message}. You can type them.`);
      paintPreview();
    } finally {
      working.fetching = false;
      if (fetchButton) {
        fetchButton.disabled = false;
        fetchButton.textContent = "Fetch details";
      }
    }
  }

  async function fillUrlFromClipboard({ force = false, fetchDetails = true } = {}) {
    if (!force && urlInput.value.trim()) return false;
    let text = "";
    try {
      text = (await navigator.clipboard?.readText?.())?.trim() || "";
    } catch {
      return false;
    }
    const id = youtubeIDFromText(text);
    if (!id) return false;
    if ($("#add-modal").hidden) return false;
    if (!force && urlInput.value.trim()) return false;
    urlInput.value = /^https?:\/\//i.test(text) ? text : watchURL(id);
    if (fetchDetails) await resolve();
    return true;
  }

  fetchButton = el("button", { class: "button", onclick: resolve }, "Fetch details");
  const pasteButton = el("button", {
    class: "button",
    title: "Read a YouTube link from the clipboard",
    onclick: async () => {
      if (!(await fillUrlFromClipboard({ force: true, fetchDetails: true }))) {
        toast("No YouTube link on the clipboard, or clipboard access is blocked.");
      }
    },
  }, "Paste");

  const addButton = el("button", {
    class: "button primary",
    onclick: () => {
      if (!working.id) {
        toast("Paste a YouTube link first.");
        return;
      }
      if (hasDuplicate(state.store, working.id)) {
        updateExistingCategories();
        return;
      }
      if (!working.title.trim()) {
        toast("A title is required.");
        return;
      }
      commitTypedCategory();
      if (!working.tags.length && !confirm("No category selected. Add this video as Unsorted?")) {
        return;
      }
      const video = newVideo({
        youtubeID: working.id,
        title: working.title,
        channel: working.channel,
        tags: working.tags,
        note: working.note,
      });
      addVideo(state.store, video);
      closeModal("#add-modal");
      changed();
      toast("Video added");
    },
  }, "Add to shelf");

  body.append(
    el("div", { class: "field" },
      el("label", { text: "YouTube link" }),
      el("div", { class: "tag-entry url-entry" }, urlInput, pasteButton, fetchButton),
      el("div", { class: "tag-hint", text: "Copy a YouTube link; this sheet fills it automatically, or press Paste." })
    ),
    preview,
    duplicateBox,
    el("div", { class: "field" },
      el("label", { text: "Title" }),
      titleInput
    ),
    el("div", { class: "field" },
      el("label", { text: "Channel" }),
      channelInput
    ),
    el("div", { class: "field" },
      el("div", { class: "field-label", text: "Categories" }),
      tagBox,
      el("div", { class: "tag-entry" },
        categoryInput,
        el("button", { class: "button", onclick: suggest }, "Suggest")
      ),
      datalist,
      suggestBox,
      el("div", { class: "field-label", text: "Your categories" }),
      knownBox,
      warning
    ),
    el("div", { class: "field" },
      el("label", { text: "Why you saved it" }),
      el("textarea", {
        placeholder: "Optional — searchable later",
        oninput: (event) => {
          working.note = event.target.value;
        },
      })
    ),
    status,
    el("div", { class: "modal-actions" },
      el("span", { class: "grow" }),
      el("button", { class: "button", onclick: () => closeModal("#add-modal") }, "Cancel"),
      addButton
    )
  );
  paintTags();
  paintPreview();
  $("#add-modal").hidden = false;
  urlInput.focus();
  fillUrlFromClipboard();
}


/* ---------- categories ---------- */
function renamePrompt(name) {
  const next = prompt(`Rename “${name}” to:`, name);
  if (!next || next.trim() === name) return;
  renameTag(state.store, name, next.trim());
  if (state.filter.kind === "tag" && state.filter.value.toLowerCase() === name.toLowerCase()) {
    state.filter = { kind: "tag", value: canonicalTag(next) || next };
  }
  changed();
}

function deletePrompt(name) {
  if (!confirm(`Delete “${name}” from every video and course?`)) return;
  deleteTag(state.store, name);
  if (state.filter.kind === "tag" && state.filter.value.toLowerCase() === name.toLowerCase()) {
    state.filter = { kind: "all" };
  }
  changed();
}

function openMerge(from) {
  const { categories } = counts(state.store);
  const options = categories.filter((entry) => entry.name.toLowerCase() !== from.toLowerCase());
  const body = $("#merge-body");
  body.replaceChildren();
  const select = el("select", {},
    options.map((entry) => el("option", { value: entry.name, text: `${entry.name} (${entry.count})` }))
  );
  body.append(
    el("p", { class: "tag-hint", text: `Move every “${from}” video into another category, then remove “${from}”.` }),
    el("div", { class: "field" }, el("label", { text: "Merge into" }), select),
    el("div", { class: "modal-actions" },
      el("span", { class: "grow" }),
      el("button", { class: "button", onclick: () => closeModal("#merge-modal") }, "Cancel"),
      el("button", {
        class: "button primary",
        disabled: options.length === 0,
        onclick: () => {
          if (!select.value) return;
          mergeTags(state.store, from, select.value);
          closeModal("#merge-modal");
          if (state.filter.kind === "tag" && state.filter.value.toLowerCase() === from.toLowerCase()) {
            state.filter = { kind: "tag", value: select.value };
          }
          changed();
          toast("Categories merged");
        },
      }, "Merge")
    )
  );
  $("#merge-modal").hidden = false;
}

/* ---------- context menu ---------- */
function showContextMenu(x, y, items) {
  const menu = $("#context-menu");
  menu.replaceChildren();
  for (const item of items) {
    if (item.separator) {
      menu.append(el("div", { class: "sep" }));
      continue;
    }
    menu.append(el("button", {
      class: item.danger ? "danger" : "",
      text: item.label,
      onclick: () => {
        hideContextMenu();
        item.action();
      },
    }));
  }
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.hidden = false;
}

function hideContextMenu() {
  $("#context-menu").hidden = true;
}

/* ---------- export / undo ---------- */
function backupProfileName() {
  return profileNameFromFile(state.store?.fileName || "");
}

function backupMachineName() {
  return deviceName();
}

function exportBackup() {
  if (!state.store) return;
  const text = currentBackup(state.store);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = el("a", {
    href: url,
    download: suggestedFileName(new Date(), backupProfileName(), backupMachineName()),
  });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  checkpointBase(text);
  state.store.dirty = false;
  renderMeta();
  scheduleDraft();
  $("#undo").disabled = !canUndo(state.store);
  toast("Backup exported. Reload it on the Mac.");
}

function undoLast() {
  if (!state.store || !undo(state.store)) return;
  changed();
}

function changed({ draft = true } = {}) {
  renderAll();
  if (draft) scheduleDraft();
}

/* ---------- modals ---------- */
function closeModal(selector) {
  $(selector).hidden = true;
}

function closeAll() {
  hideContextMenu();
  if (!$("#playlist-modal").hidden) {
    closePlaylistImport();
    return true;
  }
  if (!$("#reconcile-modal").hidden) {
    closeReconcile();
    return true;
  }
  for (const selector of ["#editor-modal", "#add-modal", "#merge-modal", "#drive-modal", "#reconcile-modal"]) {
    if (!$(selector).hidden) {
      $(selector).hidden = true;
      return true;
    }
  }
  return false;
}

/* ---------- helpers ---------- */
function dateLabel(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

let toastTimer = null;
function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 4200);
}



/* ---------- Local Google Drive folder (no OAuth) ---------- */
function persistFolderState() {
  try {
    localStorage.setItem("tubeshelf-rw-folder-state", JSON.stringify({
      lastSavedAt: state.folder.lastSavedAt || 0,
    }));
  } catch {}
}

async function refreshFolderFiles() {
  if (!state.folder.handle) return [];
  try {
    const files = await listBackups(state.folder.handle);
    state.folder.files = files;
    state.folder.status = "ready";
    state.folder.message = "";
    return files;
  } catch (error) {
    state.folder.status = "error";
    state.folder.message = error.message || "Could not read that folder.";
    throw error;
  }
}

async function restoreFolder() {
  if (!state.folder.supported) return;
  try {
    const handle = await idbGet("folder-handle");
    if (!handle) return;
    state.folder.handle = handle;
    state.folder.name = handle.name || "Drive folder";
    const permission = await folderPermission(handle);
    if (permission === "granted") {
      await refreshFolderFiles();
    } else {
      state.folder.status = "needsPermission";
    }
  } catch (error) {
    state.folder.status = "error";
    state.folder.message = error.message || "Could not restore the folder.";
  }
  updateDriveButton();
  updateLanding();
}

async function chooseFolder() {
  if (!state.folder.supported) {
    toast("This browser cannot choose a folder. Use Chrome or Edge.");
    return;
  }
  try {
    const handle = await pickFolder();
    const permission = await requestFolderPermission(handle);
    if (permission !== "granted") {
      state.folder.status = "needsPermission";
      state.folder.message = "Folder permission was not granted.";
      renderDriveBody();
      return;
    }
    state.folder.handle = handle;
    state.folder.name = handle.name || "Drive folder";
    state.folder.status = "ready";
    state.folder.message = "";
    try { await idbPut("folder-handle", handle); } catch {}
    await refreshFolderFiles();
    renderDriveBody();
    updateDriveButton();
    updateLanding();
    toast(`Using ${state.folder.name}`);
  } catch (error) {
    if (error?.name !== "AbortError") toast(error.message || "Could not open the folder.");
  }
}

async function reconnectFolder() {
  if (!state.folder.handle) return;
  try {
    const permission = await requestFolderPermission(state.folder.handle);
    if (permission !== "granted") {
      toast("Folder permission was not granted.");
      return;
    }
    await refreshFolderFiles();
    renderDriveBody();
    updateDriveButton();
    updateLanding();
  } catch (error) {
    toast(error.message || "Could not reconnect the folder.");
  }
}

async function forgetFolder() {
  try { await idbDelete("folder-handle"); } catch {}
  state.folder.handle = null;
  state.folder.name = "";
  state.folder.files = [];
  state.folder.status = "off";
  state.folder.message = "";
  state.folder.lastSavedAt = 0;
  persistFolderState();
  renderDriveBody();
  updateDriveButton();
  updateLanding();
  toast("Folder forgotten");
}

async function ensureFolder(request = false) {
  if (!state.folder.handle) return false;
  let permission = await folderPermission(state.folder.handle);
  if (permission !== "granted" && request) {
    permission = await requestFolderPermission(state.folder.handle);
  }
  if (permission !== "granted") {
    state.folder.status = "needsPermission";
    return false;
  }
  state.folder.status = "ready";
  return true;
}

async function forgetLocalCopy() {
  if (!state.store) return;
  if (!confirm("Forget the copy of this shelf stored in this browser? Export a backup first if you need it.")) return;
  closeModal("#drive-modal");
  await clearDraft();
  clearSavedView();
  showLanding();
  toast("Local copy forgotten");
}

function localCopySection() {
  if (!state.store) return null;
  const detail = state.draftAt
    ? `Last written ${state.draftAt.toLocaleString()}.`
    : "Written automatically after each change.";
  return el("section", { class: "local-copy-section" },
    el("div", { class: "field-label", text: "Local copy on this device" }),
    el("div", { class: "drive-hint",
      text: `“${state.store.fileName}” reopens automatically on this device. ${detail}` }),
    el("div", { class: "field" },
      el("label", { text: "This device name" }),
      el("input", {
        type: "text",
        value: deviceName(),
        placeholder: detectedDeviceName(),
        oninput: (event) => setDeviceName(event.target.value),
      }),
      el("div", { class: "tag-hint", text: "Used in backup filenames. Clear it to use the detected name." })
    ),
    el("div", { class: "drive-actions" },
      el("button", { class: "button danger", onclick: forgetLocalCopy }, "Forget local copy")
    )
  );
}

async function openLatestFolder() {
  if (!(await ensureFolder(true))) {
    toast("Choose the Google Drive folder first.");
    return;
  }
  try {
    const files = await refreshFolderFiles();
    const latest = latestBackup(files.filter((file) => /\.json$/i.test(file.name)));
    if (!latest) {
      toast("No backups in that folder yet.");
      renderDriveBody();
      return;
    }
    const text = await readText(latest.entry);
    state.folder.status = "ready";
    const outcome = openIncoming(text, latest.name);
    if (outcome !== "none") closeModal("#drive-modal");
  } catch (error) {
    state.folder.status = "error";
    state.folder.message = error.message;
    renderDriveBody();
    toast(error.message);
  }
}

async function openFolderFile(file) {
  if (!(await ensureFolder(true))) return;
  try {
    const text = await readText(file.entry);
    const outcome = openIncoming(text, file.name);
    if (outcome !== "none") closeModal("#drive-modal");
  } catch (error) {
    toast(error.message);
  }
}

async function saveNowToFolder() {
  if (!state.store) return;
  if (!(await ensureFolder(true))) {
    toast("Choose the Google Drive folder first.");
    return;
  }
  try {
    const name = backupName(new Date(), backupProfileName(), backupMachineName());
    const text = currentBackup(state.store);
    await writeText(state.folder.handle, name, text);
    markSaved(state.store);
    checkpointBase(text);
    state.folder.lastSavedAt = Date.now();
    persistFolderState();
    await refreshFolderFiles();
    renderMeta();
    renderDriveBody();
    scheduleDraft();
    toast(`Saved ${name} to ${state.folder.name}`);
  } catch (error) {
    state.folder.status = "error";
    state.folder.message = error.message;
    renderDriveBody();
    toast(error.message);
  }
}

function folderSection() {
  const folder = state.folder;
  const section = el("section", { class: "folder-section" });
  section.append(el("div", { class: "field-label", text: "Google Drive folder (no sign-in)" }));

  if (!folder.supported) {
    section.append(el("div", { class: "drive-hint" },
      "This browser cannot open a folder. Use Chrome or Edge, or use “From this computer…” with an exported file."
    ));
    return section;
  }

  if (!folder.handle) {
    section.append(
      el("div", { class: "drive-hint" },
        "No client ID or Google Cloud project. Install Google Drive for Desktop, then choose the folder it syncs (usually My Drive/TubeShelf Backups). The browser writes directly; Drive carries the files to the Mac."
      ),
      el("div", { class: "drive-actions" },
        el("button", { class: "button primary", id: "folder-choose", onclick: chooseFolder }, "Choose Google Drive folder…"),
        el("a", {
          class: "button",
          href: "https://github.com/somphol/tubeshelf-web/blob/main/DRIVE.md#google-drive-for-desktop-no-oauth",
          target: "_blank",
          rel: "noreferrer noopener",
          text: "Setup guide",
        })
      )
    );
    return section;
  }

  section.append(el("div", { class: "drive-hint" },
    `Folder: ${folder.name}${folder.status === "needsPermission" ? " · permission needed" : ""}`
  ));
  section.append(el("div", { class: "drive-actions" },
    folder.status === "needsPermission"
      ? el("button", { class: "button primary", id: "folder-reconnect", onclick: reconnectFolder }, "Reconnect folder")
      : null,
    el("button", { class: "button primary", id: "folder-open-latest", onclick: openLatestFolder }, "Open latest"),
    state.store ? el("button", { class: "button primary", id: "folder-save-now", onclick: saveNowToFolder }, "Save now") : null,
    el("button", { class: "button", id: "folder-choose", onclick: chooseFolder }, "Choose folder…"),
    el("button", { class: "button danger", id: "folder-forget", onclick: forgetFolder }, "Forget")
  ));

  if (folder.status === "error" && folder.message) {
    section.append(el("div", { class: "tag-hint warn", text: folder.message }));
  }

  if (folder.files.length) {
    const list = el("div", { class: "drive-list" });
    for (const file of folder.files.slice(0, 8)) {
      list.append(el("div", { class: "drive-row" },
        el("span", { class: "name", text: file.name }),
        el("span", { class: "when", text: new Date(file.lastModified).toLocaleString() }),
        el("button", { class: "button", onclick: () => openFolderFile(file) }, "Open")
      ));
    }
    section.append(list);
  }
  return section;
}

/* ---------- Google Drive + local snapshots ---------- */

function configured() {
  const settings = state.drive.settings;
  if (!settings.clientId.trim()) return false;
  if (settings.mode === "picker" && !settings.apiKey.trim()) return false;
  return true;
}

function tokenValid() {
  return Boolean(state.drive.token && state.drive.expiresAt > Date.now() + 60_000);
}

function connected() {
  return state.drive.status === "connected" && tokenValid() && Boolean(state.drive.folderId);
}

function driveClient() {
  if (!tokenValid()) throw new Error("Google Drive session expired. Connect again.");
  return new Drive(state.drive.token);
}

function updateQuickBackupButton() {
  const button = $("#quick-backup");
  if (!button) return;
  const folderReady = Boolean(state.folder.handle) && state.folder.status !== "off";
  const driveReady = configured() && connected() && tokenValid() && Boolean(state.drive.folderId);
  button.hidden = !state.store || !(folderReady || driveReady);
  if (button.hidden) return;
  button.title = folderReady
    ? `Quick backup to ${state.folder.name || "the Google Drive folder"}`
    : `Quick backup to ${state.drive.folderName || "Google Drive"}`;
}

async function quickBackup() {
  if (!state.store) return;
  if (state.folder.handle && state.folder.status !== "off") {
    await saveNowToFolder();
    return;
  }
  if (configured() && connected() && tokenValid() && state.drive.folderId) {
    await saveNowToDrive();
    return;
  }
  exportBackup();
}

function updateDriveButton() {
  const button = $("#drive");
  if (!button) return;
  updateQuickBackupButton();
  if (state.folder.status === "ready") {
    const time = state.folder.lastSavedAt
      ? new Date(state.folder.lastSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "folder";
    button.textContent = `Backups · ${time}`;
    button.title = `Google Drive folder: ${state.folder.name}`;
    return;
  }
  if (state.folder.handle && state.folder.status === "needsPermission") {
    button.textContent = "Backups · folder";
    button.title = "Reconnect the Google Drive folder";
    return;
  }
  if (state.drive.busy || state.drive.status === "connecting") {
    button.textContent = "Backups…";
  } else if (connected()) {
    const time = state.drive.lastAutoSaveAt
      ? new Date(state.drive.lastAutoSaveAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "on";
    button.textContent = `Backups · ${time}`;
  } else if (state.drive.status === "reconnect") {
    button.textContent = "Backups · reconnect";
  } else if (state.drive.status === "error") {
    button.textContent = "Backups · !";
  } else if (configured()) {
    button.textContent = "Backups · sign in";
  } else {
    button.textContent = "Backups";
  }
  button.title = state.drive.message || "Google Drive and local snapshots";
}

function updateLanding() {
  const isConfigured = configured();
  const folderAvailable = state.folder.supported;
  const folderReady = state.folder.status === "ready";
  const driveStart = $("#drive-start");
  const folderStart = $("#folder-start");
  const choose = $("#choose");
  const setup = $("#drive-setup");
  const hint = $("#drive-hint");
  if (folderStart) {
    folderStart.hidden = !folderAvailable;
    folderStart.textContent = folderReady
      ? "Open from Google Drive folder"
      : "Set up Google Drive folder";
  }
  if (driveStart) driveStart.hidden = !isConfigured || folderAvailable;
  if (choose) {
    const localPrimary = !folderAvailable && !isConfigured;
    choose.classList.toggle("primary", localPrimary);
    choose.textContent = localPrimary ? "Choose a backup…" : "From this computer…";
  }
  if (setup) setup.textContent = "Google Drive & backups";
  if (hint) {
    hint.hidden = !folderAvailable
      || folderReady
      || Boolean(state.folder.handle)
      || isConfigured
      || localStorage.getItem("tubeshelf-rw-drive-hint") === "off";
  }
}

function openDrivePanel(intent = "manage") {
  state.drive.intent = intent;
  renderDriveBody();
  $("#drive-modal").hidden = false;
}

function readDriveFields() {
  const clientId = $("#drive-client");
  if (!clientId) return state.drive.settings;
  return {
    clientId: clientId.value.trim(),
    apiKey: $("#drive-key").value.trim(),
    mode: $("#drive-mode").value === "full" ? "full" : "picker",
    folderName: $("#drive-folder").value.trim() || "TubeShelf Backups",
    autoSave: $("#drive-auto").checked,
  };
}

function persistDriveFields({ rerender = true } = {}) {
  const previous = state.drive.settings;
  const next = readDriveFields();
  saveDriveSettings(next);
  state.drive.settings = next;
  if (previous.clientId !== next.clientId
      || previous.mode !== next.mode
      || (previous.folderName !== next.folderName && next.mode === "full")) {
    state.drive.token = null;
    state.drive.expiresAt = 0;
    state.drive.folderId = null;
    state.drive.folderName = "";
    state.drive.status = "off";
    saveDriveState({ folderId: null, folderName: "", mode: next.mode });
  }
  updateLanding();
  updateDriveButton();
  if (rerender) renderDriveBody();
}

async function connectDrive({ intent = "manage" } = {}) {
  if (state.drive.busy) return;
  persistDriveFields({ rerender: false });
  const settings = state.drive.settings;
  if (!settings.clientId) {
    toast("Add the OAuth client ID from Google Cloud first.");
    return;
  }
  if (settings.mode === "picker" && !settings.apiKey) {
    toast("Picker mode needs the Google API key.");
    return;
  }

  state.drive.busy = true;
  state.drive.status = "connecting";
  state.drive.message = "";
  updateDriveButton();
  renderDriveBody();

  try {
    const auth = await requestToken(settings.clientId, scopeForMode(settings.mode));
    state.drive.token = auth.token;
    state.drive.expiresAt = auth.expiresAt;
    const client = new Drive(auth.token);

    if (settings.mode === "full") {
      const folder = await client.ensureFolder(settings.folderName);
      state.drive.folderId = folder.id;
      state.drive.folderName = folder.name;
    } else if (!state.drive.folderId) {
      const picked = await pickFromDrive({
        apiKey: settings.apiKey,
        token: auth.token,
        kind: "folder",
      });
      state.drive.folderId = picked.id;
      state.drive.folderName = picked.name;
    }

    state.drive.lastAutoSaveAt = Date.now();
    saveDriveState({
      folderId: state.drive.folderId,
      folderName: state.drive.folderName,
      lastAutoSaveAt: state.drive.lastAutoSaveAt,
      mode: settings.mode,
    });
    state.drive.status = "connected";
    state.drive.message = "";
    await refreshDriveFiles();
    state.drive.busy = false;
    updateDriveButton();
    updateLanding();
    renderDriveBody();
    toast("Google Drive connected");
    if (intent === "open") await openLatestDrive();
    else if (intent === "save") await saveNowToDrive();
  } catch (error) {
    state.drive.busy = false;
    state.drive.status = "off";
    state.drive.token = null;
    state.drive.expiresAt = 0;
    state.drive.message = error.message || "Could not connect Google Drive.";
    updateDriveButton();
    renderDriveBody();
    toast(state.drive.message);
  }
}

function handleDriveError(error) {
  if (error instanceof DriveError && error.status === 401) {
    state.drive.status = "reconnect";
    state.drive.token = null;
    state.drive.expiresAt = 0;
    state.drive.message = "Google Drive session expired. Connect again.";
  } else {
    state.drive.status = "error";
    state.drive.message = error.message || "Google Drive request failed.";
    if (state.drive.settings.mode === "picker") {
      state.drive.message += " Picker mode may not create files here; try Automatic mode.";
    }
  }
  updateDriveButton();
}

async function refreshDriveFiles() {
  if (!tokenValid() || !state.drive.folderId) return [];
  try {
    const files = await driveClient().listFolder(state.drive.folderId);
    state.drive.files = files;
    state.drive.status = "connected";
    return files;
  } catch (error) {
    handleDriveError(error);
    throw error;
  }
}

async function openLatestDrive() {
  if (!tokenValid()) {
    await connectDrive({ intent: "open" });
    return;
  }
  try {
    const files = await refreshDriveFiles();
    const latest = latestFile(files.filter((file) => /\.json$/i.test(file.name)));
    if (!latest) {
      toast("No backups found in the Drive folder yet.");
      renderDriveBody();
      return;
    }
    await openDriveFile(latest);
  } catch (error) {
    renderDriveBody();
    toast(error.message);
  }
}

async function openDriveFile(file) {
  try {
    const text = await driveClient().download(file.id);
    const outcome = openIncoming(text, file.name);
    if (outcome === "opened" || outcome === "merged") {
      state.drive.lastAutoSaveAt = Date.now();
      saveDriveState({ lastAutoSaveAt: state.drive.lastAutoSaveAt });
      state.drive.status = "connected";
      updateDriveButton();
    }
    if (outcome !== "none") closeModal("#drive-modal");
  } catch (error) {
    handleDriveError(error);
    renderDriveBody();
    toast(error.message);
  }
}

async function saveNowToDrive() {
  if (!state.store) return;
  if (!tokenValid()) {
    await connectDrive({ intent: "save" });
    return;
  }
  try {
    const name = backupName(new Date(), backupProfileName(), backupMachineName());
    const text = currentBackup(state.store);
    await driveClient().upload({
      name,
      text,
      parents: [state.drive.folderId],
    });
    markSaved(state.store);
    checkpointBase(text);
    state.drive.lastAutoSaveAt = Date.now();
    saveDriveState({ lastAutoSaveAt: state.drive.lastAutoSaveAt });
    state.drive.status = "connected";
    await refreshDriveFiles();
    renderMeta();
    updateDriveButton();
    renderDriveBody();
    scheduleDraft();
    toast(`Saved ${name} to Drive`);
  } catch (error) {
    handleDriveError(error);
    renderDriveBody();
    toast(error.message);
  }
}

async function chooseDriveFolder() {
  if (!tokenValid()) {
    await connectDrive({ intent: "manage" });
    return;
  }
  try {
    const picked = await pickFromDrive({
      apiKey: state.drive.settings.apiKey,
      token: state.drive.token,
      kind: "folder",
    });
    state.drive.folderId = picked.id;
    state.drive.folderName = picked.name;
    saveDriveState({ folderId: picked.id, folderName: picked.name });
    await refreshDriveFiles();
    renderDriveBody();
    toast(`Using ${picked.name}`);
  } catch (error) {
    toast(error.message);
  }
}

async function maybeAutoSave() {
  if (state.autosaveBusy || !state.store) return;
  const now = Date.now();
  const settings = state.drive.settings;
  const driveReady = settings.autoSave && tokenValid() && Boolean(state.drive.folderId);
  const folderReady = state.folder.status === "ready" && Boolean(state.folder.handle);
  const cloudReady = driveReady || folderReady;
  const plan = autoSavePlan({
    now,
    dirty: state.store.dirty,
    driveReady: cloudReady,
    lastCloudAt: Math.max(state.drive.lastAutoSaveAt || 0, state.folder.lastSavedAt || 0),
    lastLocalAt: state.snapshots.lastAt,
    revision: state.store.revision,
    lastRevision: state.snapshots.revision,
  });
  if (!plan.cloudDue && !plan.localDue) return;

  if (plan.cloudDue) {
    state.autosaveBusy = true;
    try {
      if (driveReady) {
        const name = autosaveName();
        await driveClient().upload({
          name,
          text: currentBackup(state.store),
          parents: [state.drive.folderId],
        });
        markSaved(state.store);
        state.drive.lastAutoSaveAt = Date.now();
        saveDriveState({ lastAutoSaveAt: state.drive.lastAutoSaveAt });
        state.drive.status = "connected";
        try {
          const files = await driveClient().listFolder(state.drive.folderId);
          state.drive.files = files;
          const victims = retentionVictims(files, 24);
          for (const file of victims) {
            try { await driveClient().delete(file.id); } catch {}
          }
        } catch {}
        toast("Drive autosaved (hourly, changes only)");
      } else {
        await writeText(state.folder.handle, folderAutosaveName(), currentBackup(state.store));
        markSaved(state.store);
        state.folder.lastSavedAt = Date.now();
        persistFolderState();
        state.folder.status = "ready";
        const files = await refreshFolderFiles();
        const victims = folderRetentionVictims(files, 24);
        for (const file of victims) {
          try { await deleteFile(state.folder.handle, file.name); } catch {}
        }
        await refreshFolderFiles();
        toast("Folder autosaved (hourly, changes only)");
      }
      renderMeta();
      updateDriveButton();
      renderDriveBody();
      scheduleDraft();
      state.autosaveBusy = false;
      return;
    } catch (error) {
      if (!driveReady) {
        state.folder.status = "error";
        state.folder.message = error.message;
      } else {
        handleDriveError(error);
      }
      renderDriveBody();
    } finally {
      state.autosaveBusy = false;
    }
  }

  if (plan.localDue || plan.localFallbackDue) {
    await writeLocalSnapshot();
  }
}

async function writeLocalSnapshot({ force = false } = {}) {
  if (!state.store) return;
  if (!force && !state.store.dirty) return;
  const now = new Date();
  const name = `TubeShelf Autosave (Local) ${stamp(now)}.json`;
  const key = `snap:${now.toISOString()}`;
  await idbPut(key, {
    text: currentBackup(state.store),
    fileName: state.store.fileName,
    name,
    savedAt: now.toISOString(),
  });
  state.snapshots = { lastAt: now.getTime(), revision: state.store.revision };
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(state.snapshots));
  } catch {}
  await pruneLocalSnapshots();
  toast("Local snapshot saved");
  if (!$("#drive-modal").hidden) renderDriveBody();
}

async function localSnapshots() {
  const all = await idbAll("snap:");
  return all.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

async function pruneLocalSnapshots() {
  const all = await localSnapshots();
  for (const snapshot of all.slice(24)) {
    await idbDelete(snapshot.key);
  }
}

function downloadText(text, name) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function renderLocalSnapshots(container) {
  const snaps = await localSnapshots();
  container.replaceChildren();
  if (!snaps.length) {
    container.append(el("div", { class: "drive-hint", text: "No local snapshots yet. One is written hourly when Drive is unavailable and only if the shelf changed." }));
    return;
  }
  for (const snapshot of snaps) {
    container.append(el("div", { class: "drive-row" },
      el("span", { class: "name", text: snapshot.name }),
      el("span", { class: "when", text: new Date(snapshot.savedAt).toLocaleString() }),
      el("button", {
        class: "button",
        onclick: () => {
          if (state.store?.dirty && !confirm("Replace the current shelf with this local snapshot?")) return;
          loadText(snapshot.text, snapshot.fileName || snapshot.name, { draft: true, dirty: true });
          closeModal("#drive-modal");
          toast("Local snapshot restored");
        },
      }, "Open"),
      el("button", {
        class: "button",
        onclick: () => downloadText(snapshot.text, snapshot.name),
      }, "Download"),
      el("button", {
        class: "button danger",
        onclick: async () => {
          await idbDelete(snapshot.key);
          renderDriveBody();
        },
      }, "Delete")
    ));
  }
}

function renderDriveBody() {
  const body = $("#drive-body");
  if (!body) return;
  const settings = state.drive.settings;
  const isConnected = connected();
  body.replaceChildren();
  body.append(folderSection());
  const localCopy = localCopySection();
  if (localCopy) body.append(localCopy);
  body.append(el("div", { class: "field-label", text: "Advanced: Google sign-in (app owner)" }));

  const dotClass = isConnected ? "on" : ["reconnect", "error"].includes(state.drive.status) ? "warn" : "";
  body.append(el("div", { class: "drive-status" },
    el("span", { class: `drive-dot ${dotClass}` }),
    el("strong", {
      text: isConnected
        ? `Connected${state.drive.folderName ? ` · ${state.drive.folderName}` : ""}`
        : state.drive.busy ? "Connecting…" : configured() ? "Not connected" : "Not set up",
    }),
    state.drive.message ? el("span", { class: "drive-hint", text: state.drive.message }) : null
  ));

  if (!configured()) {
    body.append(el("div", { class: "drive-hint" },
      "Google Drive is optional. It lets this page open the newest backup and save edits back to the same folder, so the Mac sees them through Drive for Desktop. Local backups always remain available."
    ));
    body.append(el("ol", { class: "drive-hint", style: "margin:0;padding-left:18px" },
      el("li", {}, "On the Mac, install Google Drive for Desktop and sign in; the Mac app's Back up to Drive writes into My Drive/TubeShelf Backups."),
      el("li", {}, "Create a Google Cloud project and enable the Drive API."),
      el("li", {}, "Set the OAuth consent screen to External, add yourself as a test user, and add the scopes drive.file (and drive for Automatic)."),
      el("li", {}, `Create a Web OAuth client with this origin: ${location.origin}`),
      el("li", {}, "Create an API key for the Picker (Picker mode only)."),
      el("li", {}, "Paste both values below, choose Automatic to share the Mac's folder, and press Connect.")
    ));
    body.append(el("div", { class: "drive-actions" },
      el("a", { class: "button", href: "https://github.com/somphol/tubeshelf-web/blob/main/DRIVE.md", target: "_blank", rel: "noreferrer noopener", text: "Open the setup guide" }),
      el("a", { class: "button", href: "https://console.cloud.google.com/apis/credentials", target: "_blank", rel: "noreferrer noopener", text: "Google Cloud credentials" })
    ));
  }

  if (!isConnected) {
    body.append(el("div", { class: "drive-hint" },
      "One click. Google asks once to let TubeShelf use the TubeShelf Backups folder. The token stays in memory."
    ));
  }

  const grid = el("div", { class: "drive-grid" });
  grid.append(
    el("div", { class: "field wide" },
      el("label", { text: "OAuth client ID" }),
      el("input", { id: "drive-client", type: "text", value: settings.clientId, placeholder: "…apps.googleusercontent.com" })
    ),
    el("div", { class: "field wide" },
      el("label", { text: "API key (Picker mode)" }),
      el("input", { id: "drive-key", type: "text", value: settings.apiKey, placeholder: "Google API key" })
    ),
    el("div", { class: "field" },
      el("label", { text: "Access" }),
      el("select", { id: "drive-mode" },
        el("option", { value: "picker", selected: settings.mode === "picker", text: "Pick a folder (least access)" }),
        el("option", { value: "full", selected: settings.mode === "full", text: "Automatic (full Drive)" })
      )
    ),
    el("div", { class: "field" },
      el("label", { text: "Folder name" }),
      el("input", { id: "drive-folder", type: "text", value: settings.folderName })
    ),
    el("label", { class: "drive-hint wide", style: "display:flex;gap:7px;align-items:center" },
      el("input", { id: "drive-auto", type: "checkbox", checked: settings.autoSave }),
      "Hourly Drive autosave when changes exist (timestamped; newest 24 kept)"
    )
  );
  const originHint = el("div", { class: "drive-hint" },
    `Authorized origin: ${location.origin} `,
    el("button", {
      class: "link",
      onclick: () => navigator.clipboard?.writeText(location.origin),
    }, "Copy"),
    ` · Automatic is the reliable mode for backups the Mac created; it asks for full Drive access so it can find and create “${settings.folderName}”. Picker mode touches only what you choose. Drive for Desktop carries the same folder to the Mac.`
  );
  const settingsButton = el("button", { class: "button", id: "drive-save-settings", onclick: () => persistDriveFields() }, "Save settings");
  body.append(el("div", { class: "drive-actions" },
    el("button", {
      class: "button primary",
      id: "drive-connect",
      disabled: state.drive.busy || !settings.clientId,
      onclick: () => connectDrive({ intent: state.drive.intent }),
    }, isConnected ? "Reconnect" : "Sign in with Google"),
    isConnected ? el("button", {
      class: "button",
      onclick: async () => {
        await revokeToken(state.drive.token);
        state.drive.token = null;
        state.drive.expiresAt = 0;
        state.drive.status = "off";
        updateDriveButton();
        renderDriveBody();
      },
    }, "Disconnect") : null,
    settings.mode === "picker" && isConnected ? el("button", {
      class: "button",
      onclick: chooseDriveFolder,
    }, "Choose folder…") : null,
    isConnected ? el("button", { class: "button", id: "drive-open-latest", onclick: openLatestDrive }, "Open latest") : null,
    isConnected && state.store ? el("button", { class: "button primary", id: "drive-save-now", onclick: saveNowToDrive }, "Save now") : null,
    state.store ? el("button", {
      class: "button",
      id: "drive-snapshot-now",
      onclick: () => writeLocalSnapshot({ force: true }),
    }, "Snapshot now") : null,
    el("button", {
      class: "button",
      onclick: () => {
        closeModal("#drive-modal");
        $("#file").click();
      },
    }, "From this computer…")
  ));

  if (isConnected && state.drive.files.length) {
    body.append(el("div", { class: "field-label", text: "Recent Drive backups" }));
    const list = el("div", { class: "drive-list" });
    for (const file of state.drive.files.slice(0, 8)) {
      list.append(el("div", { class: "drive-row" },
        el("span", { class: "name", text: file.name }),
        el("span", { class: "when", text: new Date(file.modifiedTime).toLocaleString() }),
        el("button", { class: "button", onclick: () => openDriveFile(file) }, "Open")
      ));
    }
    body.append(list);
  }

  body.append(el("div", { class: "field-label", text: "Local snapshots" }));
  const snapshots = el("div", { class: "drive-list" });
  body.append(snapshots);
  renderLocalSnapshots(snapshots);

  body.append(el("details", {
    class: "drive-advanced",
    open: !HAS_DRIVE_DEFAULTS,
  },
    el("summary", {
      text: HAS_DRIVE_DEFAULTS
        ? "Advanced: use your own Google project"
        : "Google project settings",
    }),
    grid,
    originHint,
    settingsButton
  ));

  body.append(el("div", { class: "drive-hint" },
    "Retention: local snapshots keep the newest 24. Drive autosaves keep the newest 24 per app; manual saves are never deleted. Hourly writes happen only when the shelf changed. ",
    el("a", {
      href: "https://github.com/somphol/tubeshelf-web/blob/main/DRIVE.md",
      target: "_blank",
      rel: "noreferrer noopener",
      text: "Setup and troubleshooting",
    })
  ));
}

async function startFolderOpen() {
  if (!state.folder.supported) {
    toast("This browser cannot choose a folder. Use Chrome or Edge.");
    return;
  }
  if (state.folder.status === "ready") {
    await openLatestFolder();
    return;
  }
  openDrivePanel("folder");
  if (state.folder.status === "needsPermission") {
    await reconnectFolder();
  } else {
    await chooseFolder();
  }
  if (state.folder.status === "ready" && state.folder.files.length) {
    await openLatestFolder();
  }
}

async function startDriveOpen() {
  if (!configured()) {
    openDrivePanel("setup");
    return;
  }
  openDrivePanel("open");
  if (tokenValid()) {
    await openLatestDrive();
  } else {
    await connectDrive({ intent: "open" });
  }
}

/* ---------- events ---------- */
$("#sidebar-toggle").addEventListener("click", toggleSidebarVisibility);
$("#sidebar").addEventListener("mouseenter", () => {
  clearTimeout(sidebarHideTimer);
  if (!state.sidebarHidden && state.sidebarPeek) {
    state.sidebarPeek = false;
    applySidebarState();
  }
});
$("#sidebar").addEventListener("mouseleave", scheduleSidebarHide);
$("#sidebar-peek").addEventListener("mouseenter", () => {
  if (state.sidebarPinned || state.sidebarHidden) return;
  state.sidebarPeek = false;
  applySidebarState();
});
window.addEventListener("resize", () => {
  clearTimeout(sidebarHideTimer);
  if (window.matchMedia("(max-width: 900px)").matches) state.sidebarPeek = false;
  applySidebarState();
});

$("#quick-backup").addEventListener("click", quickBackup);
$("#open").addEventListener("click", () => {
  if (configured()) {
    openDrivePanel("open");
  } else {
    $("#file").click();
  }
});
$("#choose").addEventListener("click", () => $("#file").click());
$("#demo").addEventListener("click", loadDemo);
$("#add").addEventListener("click", openAdd);
$("#drive").addEventListener("click", () => openDrivePanel("manage"));
$("#folder-start").addEventListener("click", startFolderOpen);
$("#drive-start").addEventListener("click", startDriveOpen);
$("#drive-setup").addEventListener("click", () => openDrivePanel("setup"));
$("#drive-hint-setup").addEventListener("click", () => {
  if (state.folder.supported) startFolderOpen();
  else openDrivePanel("setup");
});
$("#drive-hint-off").addEventListener("click", () => {
  localStorage.setItem("tubeshelf-rw-drive-hint", "off");
  $("#drive-hint").hidden = true;
});
$("#drive-close").addEventListener("click", () => closeModal("#drive-modal"));
$("#undo").addEventListener("click", undoLast);
$("#export").addEventListener("click", exportBackup);
$("#file").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  loadFile(file);
  event.target.value = "";
});

$("#playlist-close").addEventListener("click", closePlaylistImport);
$("#reconcile-close").addEventListener("click", closeReconcile);
$("#reconcile-keep").addEventListener("click", closeReconcile);
$("#reconcile-merge").addEventListener("click", () => {
  const merge = state.merge;
  if (!merge) return;
  const shelf = resolveMerge(merge.result.shelf, merge.result.conflicts, merge.choices);
  applyMergedShelf(shelf, merge.name, {
    ...merge.result.stats,
    conflicts: merge.result.conflicts.length,
  });
});
$("#reconcile-replace").addEventListener("click", () => {
  const merge = state.merge;
  if (!merge) return;
  const { text, name } = merge;
  closeReconcile();
  loadText(text, name);
});
$("#editor-close").addEventListener("click", () => closeModal("#editor-modal"));
$("#add-close").addEventListener("click", () => closeModal("#add-modal"));
$("#merge-close").addEventListener("click", () => closeModal("#merge-modal"));

for (const selector of ["#editor-modal", "#add-modal", "#merge-modal", "#drive-modal", "#reconcile-modal", "#playlist-modal"]) {
  $(selector).addEventListener("click", (event) => {
    if (event.target !== $(selector)) return;
    if (selector === "#reconcile-modal") closeReconcile();
    else if (selector === "#playlist-modal") closePlaylistImport();
    else $(selector).hidden = true;
  });
}

document.addEventListener("click", (event) => {
  if (!event.target.closest("#context-menu")) hideContextMenu();
});

document.addEventListener("keydown", (event) => {
  if (state.course && event.key === "Escape") {
    event.preventDefault();
    closeCourse();
    return;
  }
  if (state.deck) {
    if (event.key === "ArrowRight") { event.preventDefault(); deckStep(1); return; }
    if (event.key === "ArrowLeft") { event.preventDefault(); deckStep(-1); return; }
    if (event.key === "Home") { event.preventDefault(); deckJump(0); return; }
    if (event.key === "End") { event.preventDefault(); deckJump(state.deck.items.length - 1); return; }
    if (event.key === "Escape") { event.preventDefault(); closeDeck(); return; }
    return;
  }
  if (event.key === "Escape") {
    if (closeAll()) event.preventDefault();
    return;
  }
  const meta = event.metaKey || event.ctrlKey;
  if (!meta) return;
  if (event.key === "\\") {
    event.preventDefault();
    toggleSidebarVisibility();
  } else if (event.key.toLowerCase() === "s") {
    event.preventDefault();
    exportBackup();
  } else if (event.key.toLowerCase() === "n") {
    event.preventDefault();
    if (state.store) openAdd();
  } else if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    $("#search")?.focus();
  } else if (event.key.toLowerCase() === "z" && !event.shiftKey) {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    event.preventDefault();
    undoLast();
  }
});

let lastDeckWheel = 0;
$("#deck").addEventListener("wheel", (event) => {
  if (!state.deck) return;
  if (event.target.closest?.(".filmstrip, .deck-controls")) return;
  const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  if (Math.abs(delta) < 8) return;
  const now = Date.now();
  if (now - lastDeckWheel < 280) return;
  lastDeckWheel = now;
  deckStep(delta > 0 ? 1 : -1);
}, { passive: true });

window.addEventListener("beforeunload", (event) => {
  if (state.store?.dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

let dragDepth = 0;
window.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth += 1;
  $("#drop").hidden = false;
});
window.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) $("#drop").hidden = true;
});
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  $("#drop").hidden = true;
  const file = event.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});

/* ---------- saved view ---------- */
const VIEW_KEY = "tubeshelf-rw-view";

function saveView() {
  if (!state.store) return;
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({
      filter: state.filter,
      query: state.query,
      scope: state.scope,
      page: state.page,
      sidebarQuery: state.sidebarQuery,
    }));
  } catch {}
}

function applySavedView() {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || "null");
    if (!saved) return;
    if (saved.filter && typeof saved.filter.kind === "string") state.filter = saved.filter;
    if (typeof saved.query === "string") state.query = saved.query;
    if (saved.scope === "titles" || saved.scope === "everything") state.scope = saved.scope;
    if (Number.isFinite(saved.page)) state.page = saved.page;
    if (typeof saved.sidebarQuery === "string") state.sidebarQuery = saved.sidebarQuery;
  } catch {}
}

function clearSavedView() {
  try { localStorage.removeItem(VIEW_KEY); } catch {}
}

function showLanding() {
  state.store = null;
  state.base = null;
  state.baseText = null;
  closeCourse();
  closePlaylistImport();
  closeReconcile();
  state.filter = { kind: "all" };
  state.query = "";
  state.page = 0;
  state.sidebarQuery = "";
  $("#main").hidden = true;
  $("#landing").hidden = false;
  $("#file-meta").replaceChildren();
  $("#add").disabled = true;
  $("#export").disabled = true;
  $("#undo").disabled = true;
  applySidebarState();
}

/* ---------- boot / draft ---------- */
(async () => {
  applySidebarState();
  updateLanding();
  updateDriveButton();
  restoreFolder();
  if (new URLSearchParams(location.search).has("test")) {
    window.__tubeshelfTest = { state, maybeAutoSave, localSnapshots };
  }
  setInterval(() => {
    if (state.drive.status === "connected" && !tokenValid()) {
      state.drive.status = "reconnect";
      updateDriveButton();
    }
    maybeAutoSave();
  }, 60_000);

  const draft = await idbGet("draft");
  if (!draft?.text) return;

  loadText(draft.text, draft.fileName || "shelf.json", {
    draft: true,
    dirty: Boolean(draft.dirty),
    restoreView: true,
    baseText: draft.baseText || null,
  });
  updateLanding();
  updateDriveButton();
})();
