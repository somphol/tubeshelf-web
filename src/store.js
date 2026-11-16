// Editable shelf state on top of the raw backup. Every mutation bumps a revision
// and leaves unknown JSON fields untouched.
import {
  buildBackup,
  isoNow,
  documentFingerprint,
  normalizePlaylist,
  normalizeTags,
  normalizeVideo,
  normalizeChannels,
} from "./format.js";
import { TAXONOMY } from "./taxonomy.js";

const KNOWN = new Map(TAXONOMY.categories.map((category) => [category.name.toLowerCase(), category.name]));

export function canonicalTag(raw) {
  if (typeof raw !== "string") return null;
  let text = raw.trim().replace(/^#+/, "").replace(/\s+/g, " ").trim();
  if (!text || !/[a-z0-9]/i.test(text)) return null;
  text = text.slice(0, 28).trim();
  const known = KNOWN.get(text.toLowerCase());
  if (known) return known;
  if (text[0] === text[0].toLowerCase()) text = text[0].toUpperCase() + text.slice(1);
  return text;
}

export function createStore(parsed, fileName = "") {
  return {
    envelope: parsed.envelope,
    raw: parsed.raw,
    library: parsed.library,
    videos: parsed.library.videos,
    playlists: parsed.playlists,
    pinnedTags: parsed.pinnedTags,
    pinnedChannels: parsed.pinnedChannels,
    hasPlaylistCatalog: parsed.hasPlaylistCatalog,
    exportedAt: parsed.exportedAt,
    fileName,
    revision: 0,
    dirty: false,
    undoStack: [],
    redoStack: [],
  };
}

export function currentBackup(store) {
  return buildBackup(store);
}

export function fingerprint(store) {
  return documentFingerprint(store);
}

function snapshot(store) {
  return JSON.stringify({
    videos: store.videos,
    playlists: store.playlists,
    pinnedTags: store.pinnedTags,
    pinnedChannels: store.pinnedChannels,
  });
}

function restore(store, text) {
  const data = JSON.parse(text);
  store.videos = data.videos;
  store.playlists = data.playlists;
  store.pinnedTags = data.pinnedTags;
  store.pinnedChannels = data.pinnedChannels;
  touch(store);
}

export function touch(store) {
  store.revision += 1;
  store.dirty = true;
}

export function markSaved(store) {
  store.dirty = false;
}

function remember(store) {
  store.undoStack.push(snapshot(store));
  if (store.undoStack.length > 40) store.undoStack.shift();
  store.redoStack = [];
}

export function canUndo(store) {
  return store.undoStack.length > 0;
}

export function canRedo(store) {
  return store.redoStack.length > 0;
}

export function undo(store) {
  const previous = store.undoStack.pop();
  if (!previous) return false;
  store.redoStack.push(snapshot(store));
  restore(store, previous);
  return true;
}

export function redo(store) {
  const next = store.redoStack.pop();
  if (!next) return false;
  store.undoStack.push(snapshot(store));
  restore(store, next);
  return true;
}

export function displayVideos(store) {
  return store.videos.map(normalizeVideo).filter(Boolean);
}

export function displayPlaylists(store) {
  return store.playlists.map(normalizePlaylist).filter(Boolean);
}

export function videoByYoutubeID(store, youtubeID) {
  return store.videos.find((video) => video.youtubeID === youtubeID);
}

export function hasDuplicate(store, youtubeID) {
  return store.videos.some((video) => video.youtubeID === youtubeID);
}

function modify(store, youtubeID, patch) {
  const raw = videoByYoutubeID(store, youtubeID);
  if (!raw) return false;
  remember(store);
  Object.assign(raw, patch);
  touch(store);
  return true;
}

export function saveVideo(store, youtubeID, { tags, note, isFavorite, watchStatus }) {
  const raw = videoByYoutubeID(store, youtubeID);
  if (!raw) return false;
  remember(store);
  raw.tags = normalizeTags((tags || []).map(canonicalTag).filter(Boolean));
  raw.note = String(note ?? "");
  raw.isFavorite = Boolean(isFavorite);
  raw.watchStatus = ["unwatched", "watching", "done"].includes(watchStatus)
    ? watchStatus
    : "unwatched";
  touch(store);
  return true;
}

export function setVideoTags(store, youtubeID, tags) {
  return modify(store, youtubeID, {
    tags: normalizeTags(tags.map(canonicalTag).filter(Boolean)),
  });
}

export function setVideoNote(store, youtubeID, note) {
  return modify(store, youtubeID, { note: String(note) });
}

export function setVideoFavorite(store, youtubeID, isFavorite) {
  return modify(store, youtubeID, { isFavorite: Boolean(isFavorite) });
}

export function setVideoWatchStatus(store, youtubeID, status) {
  return modify(store, youtubeID, {
    watchStatus: ["unwatched", "watching", "done"].includes(status) ? status : "unwatched",
  });
}

export function setVideoTitle(store, youtubeID, title) {
  return modify(store, youtubeID, { title: String(title).trim() || "Untitled" });
}

export function deleteVideo(store, youtubeID) {
  const index = store.videos.findIndex((video) => video.youtubeID === youtubeID);
  if (index === -1) return false;
  remember(store);
  store.videos.splice(index, 1);
  prunePins(store);
  touch(store);
  return true;
}

export function addVideo(store, video) {
  if (!video || !video.youtubeID || hasDuplicate(store, video.youtubeID)) return false;
  remember(store);
  store.videos.push(video);
  touch(store);
  return true;
}

/** Replace the whole shelf in one undoable step (used by the merge review). */
export function replaceShelf(store, shelf) {
  remember(store);
  store.videos = shelf.videos || [];
  store.playlists = shelf.playlists || [];
  store.pinnedTags = shelf.pinnedTags || [];
  store.pinnedChannels = shelf.pinnedChannels || [];
  if (typeof shelf.hasPlaylistCatalog === "boolean") {
    store.hasPlaylistCatalog = shelf.hasPlaylistCatalog;
  } else if (store.playlists.length) {
    store.hasPlaylistCatalog = true;
  }
  touch(store);
}

export function newVideo({ youtubeID, title, channel, tags = [], note = "", durationSeconds = null }) {
  return {
    id: crypto.randomUUID(),
    youtubeID,
    title: title || "Untitled",
    channel: channel || "",
    tags: normalizeTags(tags.map(canonicalTag).filter(Boolean)),
    note,
    addedAt: isoNow(),
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    isFavorite: false,
    watchStatus: "unwatched",
  };
}

export function counts(store) {
  const categories = new Map();
  const channels = new Map();
  const spell = new Map();
  const add = (map, name) => {
    const key = name.toLowerCase();
    map.set(key, (map.get(key) || 0) + 1);
    if (!spell.has(key)) spell.set(key, name);
  };
  for (const video of store.videos) {
    for (const tag of normalizeTags(video.tags || [])) add(categories, tag);
    const channel = (video.channel || "").trim();
    if (channel) add(channels, channel);
  }
  for (const playlist of store.playlists) {
    for (const tag of normalizeTags(playlist.tags || [])) add(categories, tag);
  }
  const sort = (map) =>
    [...map.entries()]
      .map(([key, count]) => ({ name: spell.get(key) || key, count }))
      .sort((a, b) => (a.count === b.count ? a.name.localeCompare(b.name) : b.count - a.count));
  return { categories: sort(categories), channels: sort(channels) };
}

export function toggleTagPin(store, name) {
  remember(store);
  const key = name.toLowerCase();
  const index = store.pinnedTags.findIndex((pin) => pin.toLowerCase() === key);
  if (index >= 0) store.pinnedTags.splice(index, 1);
  else store.pinnedTags.push(name);
  touch(store);
}

export function toggleChannelPin(store, name) {
  remember(store);
  const key = name.toLowerCase();
  const index = store.pinnedChannels.findIndex((pin) => pin.toLowerCase() === key);
  if (index >= 0) store.pinnedChannels.splice(index, 1);
  else store.pinnedChannels.push(name);
  touch(store);
}

export function isTagPinned(store, name) {
  return store.pinnedTags.some((pin) => pin.toLowerCase() === name.toLowerCase());
}

export function isChannelPinned(store, name) {
  return store.pinnedChannels.some((pin) => pin.toLowerCase() === name.toLowerCase());
}

function rewriteTags(store, transform) {
  for (const video of store.videos) {
    if (Array.isArray(video.tags)) {
      video.tags = normalizeTags(transform(video.tags).map(canonicalTag).filter(Boolean));
    }
  }
  for (const playlist of store.playlists) {
    if (Array.isArray(playlist.tags)) {
      playlist.tags = normalizeTags(transform(playlist.tags).map(canonicalTag).filter(Boolean));
    }
  }
}

export function renameTag(store, from, to) {
  const target = canonicalTag(to);
  if (!target || from.toLowerCase() === target.toLowerCase()) return;
  remember(store);
  rewriteTags(store, (tags) =>
    tags.map((tag) => (tag.toLowerCase() === from.toLowerCase() ? target : tag))
  );
  store.pinnedTags = store.pinnedTags.map((pin) =>
    pin.toLowerCase() === from.toLowerCase() ? target : pin
  );
  touch(store);
}

export function mergeTags(store, from, into) {
  const target = canonicalTag(into);
  if (!target || from.toLowerCase() === target.toLowerCase()) return;
  remember(store);
  rewriteTags(store, (tags) =>
    tags.map((tag) => (tag.toLowerCase() === from.toLowerCase() ? target : tag))
  );
  const wasPinned = isTagPinned(store, from);
  const alreadyPinned = isTagPinned(store, target);
  store.pinnedTags = store.pinnedTags
    .filter((pin) => pin.toLowerCase() !== from.toLowerCase())
    .map((pin) => (pin.toLowerCase() === target.toLowerCase() ? target : pin));
  if (wasPinned && !alreadyPinned) store.pinnedTags.push(target);
  touch(store);
}

export function deleteTag(store, name) {
  remember(store);
  rewriteTags(store, (tags) => tags.filter((tag) => tag.toLowerCase() !== name.toLowerCase()));
  store.pinnedTags = store.pinnedTags.filter((pin) => pin.toLowerCase() !== name.toLowerCase());
  touch(store);
}

export function prunePins(store) {
  const { categories, channels } = counts(store);
  const tags = new Set(categories.map((entry) => entry.name.toLowerCase()));
  const names = new Set(channels.map((entry) => entry.name.toLowerCase()));
  store.pinnedTags = store.pinnedTags.filter((pin) => tags.has(pin.toLowerCase()));
  store.pinnedChannels = store.pinnedChannels.filter((pin) => names.has(pin.toLowerCase()));
}

export function exportText(store) {
  return buildBackup(store);
}
