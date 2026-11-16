// Three-way merge for TubeShelf shelves.
//
// base    = the shelf as it was loaded or last manually saved
// mine    = the current browser shelf (may contain edits)
// theirs  = the backup being opened
//
// One-sided changes are applied automatically. Only fields changed differently
// on both sides become conflicts. The editor can only change tags, note,
// favorite and watch state, so those are the fields that need a choice; title,
// channel and duration are treated as metadata and filled from the backup.
import { normalizeTags } from "./format.js";
import { canonicalTag } from "./store.js";

const EDITABLE = [
  { key: "tags", label: "Categories", allowBoth: true },
  { key: "note", label: "Note", allowBoth: false },
  { key: "isFavorite", label: "Favorite", allowBoth: false },
  { key: "watchStatus", label: "Watch state", allowBoth: false },
];

const EMPTY_SHELF = {
  videos: [],
  playlists: [],
  pinnedTags: [],
  pinnedChannels: [],
  hasPlaylistCatalog: false,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function tagsOf(list) {
  return normalizeTags((Array.isArray(list) ? list : []).map(canonicalTag).filter(Boolean));
}

function values(video) {
  return {
    tags: tagsOf(video?.tags),
    note: String(video?.note ?? ""),
    isFavorite: Boolean(video?.isFavorite),
    watchStatus: ["unwatched", "watching", "done"].includes(video?.watchStatus)
      ? video.watchStatus
      : "unwatched",
  };
}

function sameTags(left, right) {
  if (left.length !== right.length) return false;
  const keys = new Set(left.map((tag) => tag.toLowerCase()));
  return right.every((tag) => keys.has(tag.toLowerCase()));
}

function sameValue(key, left, right) {
  if (key === "tags") return sameTags(left, right);
  return left === right;
}

function sameValues(left, right) {
  return EDITABLE.every((field) => sameValue(field.key, left[field.key], right[field.key]));
}

function mergeTags(mine, theirs) {
  return tagsOf([...mine, ...theirs]);
}

/** True three-way set merge for categories: removals survive when the other side kept them. */
function mergeTagSets(base, mine, theirs) {
  const baseKeys = new Set(base.map((tag) => tag.toLowerCase()));
  const mineKeys = new Set(mine.map((tag) => tag.toLowerCase()));
  const theirKeys = new Set(theirs.map((tag) => tag.toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const tag of [...mine, ...theirs]) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const inBase = baseKeys.has(key);
    const inMine = mineKeys.has(key);
    const inTheirs = theirKeys.has(key);
    let keep;
    if (inMine === inTheirs) keep = inMine;
    else if (inMine === inBase) keep = inTheirs;
    else if (inTheirs === inBase) keep = inMine;
    else keep = true;
    if (keep) out.push(inMine ? mine.find((item) => item.toLowerCase() === key) : theirs.find((item) => item.toLowerCase() === key));
  }
  return tagsOf(out);
}

function joinTags(mine, theirs) {
  return mergeTags(tagsOf(mine), tagsOf(theirs));
}

function pickMeta(key, base, mine, theirs) {
  const mineValue = mine?.[key];
  const theirValue = theirs?.[key];
  const baseValue = base?.[key];
  if (mineValue === theirValue) return mineValue;
  if (base && baseValue === mineValue) return theirValue;
  if (base && baseValue === theirValue) return mineValue;
  return mineValue || theirValue;
}

function pickDuration(base, mine, theirs) {
  const mineValue = Number.isFinite(mine?.durationSeconds) ? mine.durationSeconds : null;
  const theirValue = Number.isFinite(theirs?.durationSeconds) ? theirs.durationSeconds : null;
  const baseValue = Number.isFinite(base?.durationSeconds) ? base.durationSeconds : null;
  if (mineValue === theirValue) return mineValue;
  if (mineValue === null) return theirValue;
  if (theirValue === null) return mineValue;
  if (base && baseValue === mineValue) return theirValue;
  if (base && baseValue === theirValue) return mineValue;
  return theirValue;
}

function mergeVideo(base, mine, theirs) {
  const baseValues = base ? values(base) : null;
  const mineValues = values(mine);
  const theirValues = values(theirs);
  const chosen = { ...mineValues };
  const fields = [];
  let updated = false;

  for (const field of EDITABLE) {
    const key = field.key;
    if (sameValue(key, mineValues[key], theirValues[key])) {
      chosen[key] = mineValues[key];
      continue;
    }
    if (baseValues) {
      if (sameValue(key, baseValues[key], mineValues[key])) {
        chosen[key] = theirValues[key];
        updated = true;
        continue;
      }
      if (sameValue(key, baseValues[key], theirValues[key])) {
        chosen[key] = mineValues[key];
        continue;
      }
    }
    const fallback = field.allowBoth ? "both" : "mine";
    const both = field.allowBoth
      ? (baseValues
        ? mergeTagSets(baseValues[key], mineValues[key], theirValues[key])
        : joinTags(mineValues[key], theirValues[key]))
      : null;
    chosen[key] = fallback === "both" ? both : mineValues[key];
    fields.push({
      key,
      label: field.label,
      mine: mineValues[key],
      theirs: theirValues[key],
      both,
      default: fallback,
      allowBoth: field.allowBoth,
    });
  }

  const merged = { ...clone(theirs), ...clone(mine) };
  for (const field of EDITABLE) merged[field.key] = chosen[field.key];
  merged.title = pickMeta("title", base, mine, theirs) || "Untitled";
  merged.channel = pickMeta("channel", base, mine, theirs) || "";
  merged.durationSeconds = pickDuration(base, mine, theirs);
  merged.addedAt = mine.addedAt || theirs.addedAt;
  merged.id = mine.id || theirs.id;

  if (merged.durationSeconds !== (Number.isFinite(mine.durationSeconds) ? mine.durationSeconds : null)) {
    updated = true;
  }
  if (merged.title !== mine.title || merged.channel !== (mine.channel || "")) updated = true;

  return { video: merged, fields, updated };
}

function videoPresence(kind, mine, theirs) {
  const source = mine || theirs;
  return {
    key: `video:${source.youtubeID}`,
    kind: "video",
    id: source.youtubeID,
    title: source.title || "(untitled)",
    presence: kind,
    mine: mine ? "present" : "deleted",
    theirs: theirs ? "present" : "deleted",
    default: "mine",
    incoming: theirs ? clone(theirs) : null,
  };
}

function playlistSignature(playlist) {
  return JSON.stringify({
    title: String(playlist?.title ?? ""),
    tags: tagsOf(playlist?.tags).sort((left, right) => left.localeCompare(right)),
    items: Array.isArray(playlist?.items) ? playlist.items : [],
  });
}

function samePlaylist(left, right) {
  return playlistSignature(left) === playlistSignature(right);
}

function playlistConflict(kind, mine, theirs) {
  const source = mine || theirs;
  return {
    key: `playlist:${source.id || source.title}`,
    kind: "playlist",
    id: source.id || source.title,
    title: source.title || "(untitled course)",
    presence: kind,
    mine: mine ? "present" : "deleted",
    theirs: theirs ? "present" : "deleted",
    default: "mine",
    incoming: theirs ? clone(theirs) : null,
  };
}

function mergePins(baseList, mineList, theirList) {
  const base = (baseList || []).map((name) => String(name).toLowerCase());
  const mine = (mineList || []).map((name) => String(name));
  const theirs = (theirList || []).map((name) => String(name));
  const mineKeys = new Set(mine.map((name) => name.toLowerCase()));
  const baseKeys = new Set(base);
  const theirKeys = new Set(theirs.map((name) => name.toLowerCase()));
  const seen = new Set();
  const out = [];

  for (const name of [...mine, ...theirs]) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    const inMine = mineKeys.has(key);
    const inTheirs = theirKeys.has(key);
    const inBase = baseKeys.has(key);
    let keep;
    if (inMine === inTheirs) keep = inMine;
    else if (!baseList) keep = true;
    else if (inMine === inBase) keep = inTheirs;
    else if (inTheirs === inBase) keep = inMine;
    else keep = true;
    if (keep) {
      seen.add(key);
      out.push(inMine ? mine.find((item) => item.toLowerCase() === key) : theirs.find((item) => item.toLowerCase() === key));
    }
  }
  return out;
}

function normalizeShelf(shelf) {
  if (!shelf) return null;
  return {
    videos: Array.isArray(shelf.videos) ? shelf.videos : [],
    playlists: Array.isArray(shelf.playlists) ? shelf.playlists : [],
    pinnedTags: Array.isArray(shelf.pinnedTags) ? shelf.pinnedTags : [],
    pinnedChannels: Array.isArray(shelf.pinnedChannels) ? shelf.pinnedChannels : [],
    hasPlaylistCatalog: Boolean(shelf.hasPlaylistCatalog),
  };
}

function mapBy(list, key) {
  const map = new Map();
  for (const item of list) {
    const id = item?.[key];
    if (id && !map.has(id)) map.set(id, item);
  }
  return map;
}

/**
 * Merge `theirs` into `mine` using `base` as the common ancestor.
 * Returns the default-merged shelf plus conflict groups for the review UI.
 */
export function mergeShelves(baseShelf, mineShelf, theirShelf) {
  const base = normalizeShelf(baseShelf);
  const mine = normalizeShelf(mineShelf) || EMPTY_SHELF;
  const theirs = normalizeShelf(theirShelf) || EMPTY_SHELF;
  const conflicts = [];
  const stats = { added: 0, updated: 0, deleted: 0, kept: 0 };

  const baseVideos = mapBy(base?.videos || [], "youtubeID");
  const theirVideos = mapBy(theirs.videos, "youtubeID");
  const videos = [];
  const seen = new Set();

  for (const current of mine.videos) {
    const id = current?.youtubeID;
    if (!id) {
      videos.push(current);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const original = baseVideos.get(id);
    const incoming = theirVideos.get(id);

    if (incoming) {
      const result = mergeVideo(original, current, incoming);
      videos.push(result.video);
      if (result.fields.length) {
        conflicts.push({
          key: `video:${id}`,
          kind: "video",
          id,
          title: result.video.title || current.title || "(untitled)",
          fields: result.fields,
        });
      }
      if (result.updated) stats.updated += 1;
    } else if (!original) {
      videos.push(current);
      stats.kept += 1;
    } else if (sameValues(values(original), values(current))) {
      stats.deleted += 1;
    } else {
      videos.push(current);
      conflicts.push(videoPresence("deleted-in-backup", current, null));
    }
  }

  for (const incoming of theirs.videos) {
    const id = incoming?.youtubeID;
    if (!id) {
      videos.push(incoming);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const original = baseVideos.get(id);
    if (!original) {
      videos.push(incoming);
      stats.added += 1;
    } else if (sameValues(values(original), values(incoming))) {
      // Deleted here and untouched in the backup: keep the deletion.
    } else {
      conflicts.push(videoPresence("deleted-here", null, incoming));
    }
  }

  const incomingCatalog = theirs.hasPlaylistCatalog ? theirs.playlists : null;
  const basePlaylists = mapBy(base?.playlists || [], "id");
  const theirPlaylists = mapBy(incomingCatalog || [], "id");
  const playlists = [];
  const seenPlaylists = new Set();

  for (const current of mine.playlists) {
    const id = current?.id;
    if (!id) {
      playlists.push(current);
      continue;
    }
    if (seenPlaylists.has(id)) continue;
    seenPlaylists.add(id);
    if (!incomingCatalog) {
      playlists.push(current);
      continue;
    }
    const original = basePlaylists.get(id);
    const incoming = theirPlaylists.get(id);
    if (incoming) {
      if (samePlaylist(current, incoming)) {
        playlists.push(current);
      } else if (!original) {
        playlists.push(current);
        conflicts.push(playlistConflict("both", current, incoming));
      } else if (samePlaylist(original, current)) {
        playlists.push(incoming);
        stats.updated += 1;
      } else if (samePlaylist(original, incoming)) {
        playlists.push(current);
      } else {
        playlists.push(current);
        conflicts.push(playlistConflict("both", current, incoming));
      }
    } else if (!original) {
      playlists.push(current);
      stats.kept += 1;
    } else if (samePlaylist(original, current)) {
      stats.deleted += 1;
    } else {
      playlists.push(current);
      conflicts.push(playlistConflict("deleted-in-backup", current, null));
    }
  }

  if (incomingCatalog) {
    for (const incoming of incomingCatalog) {
      const id = incoming?.id;
      if (!id) {
        playlists.push(incoming);
        continue;
      }
      if (seenPlaylists.has(id)) continue;
      seenPlaylists.add(id);
      const original = basePlaylists.get(id);
      if (!original) {
        playlists.push(incoming);
        stats.added += 1;
      } else if (samePlaylist(original, incoming)) {
        // Deleted here and untouched in the backup: keep the deletion.
      } else {
        conflicts.push(playlistConflict("deleted-here", null, incoming));
      }
    }
  }

  return {
    shelf: {
      videos,
      playlists,
      pinnedTags: mergePins(base?.pinnedTags, mine.pinnedTags, theirs.pinnedTags),
      pinnedChannels: mergePins(base?.pinnedChannels, mine.pinnedChannels, theirs.pinnedChannels),
      hasPlaylistCatalog: mine.hasPlaylistCatalog || theirs.hasPlaylistCatalog,
    },
    conflicts,
    stats,
  };
}

function conflictChoice(choices, group, field) {
  const key = `${group.key}:${field}`;
  return choices?.[key] || null;
}

function applyField(video, field, choice) {
  if (choice === "both") {
    video[field.key] = clone(field.both || mergeTags(field.mine, field.theirs));
    return;
  }
  video[field.key] = clone(choice === "theirs" ? field.theirs : field.mine);
}

/**
 * Apply the reviewed choices to the default-merged shelf.
 * `choices` is keyed by `${group.key}:${field|presence}`.
 */
export function resolveMerge(shelf, conflicts, choices = {}) {
  const out = clone({ ...EMPTY_SHELF, ...shelf });
  const videos = new Map(out.videos.map((video) => [video.youtubeID, video]));
  const playlists = new Map(out.playlists.map((playlist) => [playlist.id, playlist]));

  for (const group of conflicts) {
    if (group.kind === "video" && group.fields) {
      const video = videos.get(group.id);
      if (!video) continue;
      for (const field of group.fields) {
        applyField(video, field, conflictChoice(choices, group, field.key) || field.default);
      }
      continue;
    }

    if (group.kind === "video") {
      const choice = conflictChoice(choices, group, "presence") || group.default;
      if (group.presence === "deleted-in-backup") {
        if (choice === "theirs") {
          const index = out.videos.findIndex((video) => video.youtubeID === group.id);
          if (index !== -1) out.videos.splice(index, 1);
        }
      } else if (choice === "theirs" && group.incoming && !videos.has(group.id)) {
        out.videos.push(clone(group.incoming));
      }
      continue;
    }

    if (group.kind === "playlist") {
      const choice = conflictChoice(choices, group, "presence") || group.default;
      if (group.presence === "deleted-in-backup") {
        if (choice === "theirs") {
          const index = out.playlists.findIndex((playlist) => playlist.id === group.id);
          if (index !== -1) out.playlists.splice(index, 1);
        }
      } else if (choice === "theirs" && group.incoming) {
        const index = out.playlists.findIndex((playlist) => playlist.id === group.id);
        if (index === -1) out.playlists.push(clone(group.incoming));
        else out.playlists[index] = clone(group.incoming);
        out.hasPlaylistCatalog = true;
      }
    }
  }

  return out;
}

/** A cheap equality used to skip the merge UI when nothing differs. */
export function shelfFingerprint(shelf) {
  return JSON.stringify({
    videos: (shelf?.videos || []).map((video) => ({
      id: video.youtubeID,
      tags: tagsOf(video.tags).sort((left, right) => left.localeCompare(right)),
      note: String(video.note ?? ""),
      favorite: Boolean(video.isFavorite),
      status: video.watchStatus || "unwatched",
      title: video.title || "",
      channel: video.channel || "",
      duration: Number.isFinite(video.durationSeconds) ? video.durationSeconds : null,
    })),
    playlists: (shelf?.playlists || []).map((playlist) => ({
      id: playlist.id,
      signature: playlistSignature(playlist),
    })),
    tags: shelf?.pinnedTags || [],
    channels: shelf?.pinnedChannels || [],
    catalog: Boolean(shelf?.hasPlaylistCatalog),
  });
}
