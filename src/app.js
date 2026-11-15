// Editable TubeShelf web app. Files stay local; export writes a new backup.
import {
  parseBackup,
  thumbnailCandidates,
  formatDuration,
  watchURL,
  suggestedFileName,
  normalizeTags,
} from "./format.js";
import {
  createStore,
  currentBackup,
  displayVideos as storeVideos,
  counts,
  setVideoFavorite,
  saveVideo,
  deleteVideo,
  addVideo,
  newVideo,
  hasDuplicate,
  videoByYoutubeID,
  canUndo,
  canRedo,
  undo,
  redo,
  toggleTagPin,
  toggleChannelPin,
  renameTag,
  mergeTags,
  deleteTag,
  isTagPinned,
  isChannelPinned,
  canonicalTag,
} from "./store.js";
import {
  applyVideoFilter,
  searchVideos,
  pageWindow,
  pageSlice,
  PAGE_SIZES,
} from "./shelf.js";
import { suggestTags } from "./tagger.js";
import { demoBackup } from "./demo.js";

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
const state = {
  store: null,
  filter: { kind: "all" },
  query: "",
  scope: "everything",
  page: 0,
  pageSize: 48,
  sidebarQuery: "",
  context: null,
  draftAt: null,
};

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
  $("#draft-banner").hidden = true;
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
function loadText(text, name, { draft = false, dirty = false, restoreView = false } = {}) {
  try {
    const parsed = parseBackup(text);
    state.store = createStore(parsed, name);
    state.draftAt = null;
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
    $("#draft-banner").hidden = true;
    if (restoreView) applySavedView();
    renderAll();
    scheduleDraft();
    toast(
      `${state.store.videos.length} videos · ${state.store.playlists.length} course${state.store.playlists.length === 1 ? "" : "s"}${draft ? " · restored last session" : ""}`
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
  loadText(await file.text(), file.name);
}

function loadDemo() {
  loadText(JSON.stringify(demoBackup), "demo-shelf.json");
}

/* ---------- rendering ---------- */
function renderAll() {
  if (!state.store) return;
  renderMeta();
  renderSidebar();
  renderContent();
  $("#undo").disabled = !canUndo(state.store);
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
        placeholder: "Filter categories & channels",
        value: state.sidebarQuery,
        oninput: (event) => {
          state.sidebarQuery = event.target.value;
          renderSidebar();
        },
      })
    )
  );

  const videos = storeVideos(store);
  sidebar.append(sideList("Library", [
    row("All videos", videos.length, { kind: "all" }),
    row("Favorites", videos.filter((video) => video.isFavorite).length, { kind: "favorites" }),
    row("Unwatched", videos.filter((video) => video.watchStatus !== "done").length, { kind: "unwatched" }),
    row("Unsorted", videos.filter((video) => video.tags.length === 0).length, { kind: "unsorted" }),
  ]));

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
    ]));
  }

  const pinnedKeys = new Set(store.pinnedTags.map((pin) => pin.toLowerCase()));
  const rest = categories
    .filter((entry) => !pinnedKeys.has(entry.name.toLowerCase()))
    .filter(keep);
  sidebar.append(sideList("Categories", rest.length
    ? rest.map((entry) => categoryRow(entry, false))
    : [el("div", { class: "side-empty", text: "No categories yet" })]));

  const channelKeys = new Set(store.pinnedChannels.map((pin) => pin.toLowerCase()));
  const channelRows = channels
    .filter((entry) => !channelKeys.has(entry.name.toLowerCase()))
    .filter(keep)
    .slice(0, 14)
    .map((entry) => channelRow(entry, false));
  if (channelRows.length) sidebar.append(sideList("Channels", channelRows));
}

function sideList(title, rows) {
  return el("section", {},
    el("h3", { text: title }),
    el("ul", { class: "side-list" }, rows.map((node) => el("li", {}, node)))
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

function filterTitle() {
  if (state.filter.kind === "tag") return state.filter.value;
  if (state.filter.kind === "channel") return state.filter.value;
  return {
    all: "All videos",
    favorites: "Favorites",
    unwatched: "Unwatched",
    unsorted: "Unsorted",
  }[state.filter.kind] || "Shelf";
}

function currentVideos() {
  let videos = storeVideos(state.store);
  videos = applyVideoFilter(videos, state.filter);
  videos = searchVideos(videos, state.query, state.scope);
  return videos.sort((a, b) => b.addedAt - a.addedAt);
}

function renderContent() {
  const content = $("#content");
  content.replaceChildren();
  const videos = currentVideos();
  const window = pageWindow(videos.length, state.pageSize, state.page);
  const shown = pageSlice(videos, window);

  const head = el("div", { class: "content-head" },
    el("div", {},
      el("h2", { text: filterTitle() }),
      el("div", { class: "sub", text: `${videos.length} video${videos.length === 1 ? "" : "s"}` })
    ),
    el("div", { class: "grow" }),
    el("div", { class: "search" },
      el("input", {
        type: "search",
        id: "search",
        placeholder: "Search titles…",
        value: state.query,
        oninput: (event) => {
          state.query = event.target.value;
          state.page = 0;
          renderContent();
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

  if (!videos.length) {
    content.append(
      el("div", { class: "empty" },
        el("h3", { text: state.query.trim() ? `Nothing matches “${state.query.trim()}”` : "Nothing here" }),
        el("p", { text: state.query.trim() ? "Try a shorter word or switch the scope." : "Add a video, or pick another category." })
      )
    );
    return;
  }

  const grid = el("div", { class: "grid" });
  for (const video of shown) grid.append(videoCard(video));
  content.append(grid);

  if (window.pageCount > 1) {
    content.append(pager(videos, window));
  }
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
  if (video.isFavorite) thumb.append(el("span", { class: "flag", text: "★" }));
  const actions = el("div", { class: "card-actions" },
    el("button", {
      title: "Open on YouTube",
      onclick: (event) => {
        event.stopPropagation();
        window.open(watchURL(video.youtubeID), "_blank", "noopener");
      },
    }, "YouTube"),
    el("button", {
      title: "Edit categories and notes",
      onclick: (event) => {
        event.stopPropagation();
        openEditor(video.youtubeID);
      },
    }, "Edit")
  );
  thumb.append(actions);

  return el("button", {
    class: "card",
    onclick: () => openEditor(video.youtubeID),
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
  const known = counts(state.store).categories.map((entry) => entry.name);
  let suggestions = suggestTags({
    title: video.title,
    channel: video.channel,
    note: working.note,
    knownCategories: known,
  }).tags;

  const body = $("#editor-body");
  body.replaceChildren();
  $("#editor-title").textContent = "Edit video";
  const tagsBox = el("div", { class: "chip-list" });
  const suggestBox = el("div", { class: "chip-list" });
  const input = el("input", {
    type: "text",
    placeholder: "Type a category, then Return",
    onkeydown: (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const tag = canonicalTag(event.target.value);
      if (!tag) return;
      if (!working.tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) working.tags.push(tag);
      event.target.value = "";
      paintTags();
    },
  });

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
      el("div", { class: "tag-hint", text: "Suggested from the title and channel" }),
      suggestBox
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
  };
  const body = $("#add-body");
  body.replaceChildren();
  const preview = el("div", { class: "edit-preview" });
  const tagBox = el("div", { class: "chip-list" });
  const suggestBox = el("div", { class: "chip-list" });
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
  const status = el("div", { class: "tag-hint" });

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
  }

  function suggest() {
    working.suggestions = suggestTags({
      title: working.title,
      channel: working.channel,
      note: working.note,
      knownCategories: counts(state.store).categories.map((entry) => entry.name),
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
    status.textContent = hasDuplicate(state.store, working.id)
      ? "This video is already on the shelf."
      : "";
  }

  const fetchButton = el("button", {
    class: "button",
    onclick: async () => {
      const match = urlInput.value.trim().match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
      if (!match) {
        toast("Paste a YouTube link with an 11-character video ID.");
        return;
      }
      working.id = match[1];
      if (hasDuplicate(state.store, working.id)) {
        toast("That video is already on the shelf.");
      }
      fetchButton.disabled = true;
      fetchButton.textContent = "Fetching…";
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
        fetchButton.disabled = false;
        fetchButton.textContent = "Fetch details";
      }
    },
  }, "Fetch details");

  body.append(
    el("div", { class: "field" },
      el("label", { text: "YouTube link" }),
      el("div", { class: "tag-entry" }, urlInput, fetchButton)
    ),
    preview,
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
        el("input", {
          type: "text",
          placeholder: "Type a category, then Return",
          onkeydown: (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const tag = canonicalTag(event.target.value);
            if (!tag) return;
            if (!working.tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) working.tags.push(tag);
            event.target.value = "";
            paintTags();
          },
        }),
        el("button", { class: "button", onclick: suggest }, "Suggest")
      ),
      suggestBox
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
      el("button", {
        class: "button primary",
        onclick: () => {
          if (!working.id) {
            toast("Paste a YouTube link first.");
            return;
          }
          if (hasDuplicate(state.store, working.id)) {
            toast("That video is already on the shelf.");
            return;
          }
          if (!working.title.trim()) {
            toast("A title is required.");
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
      }, "Add to shelf")
    )
  );
  paintPreview();
  $("#add-modal").hidden = false;
  urlInput.focus();
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
function exportBackup() {
  if (!state.store) return;
  const text = currentBackup(state.store);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: suggestedFileName() });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
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
  for (const selector of ["#editor-modal", "#add-modal", "#merge-modal"]) {
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

/* ---------- events ---------- */
$("#open").addEventListener("click", () => $("#file").click());
$("#choose").addEventListener("click", () => $("#file").click());
$("#demo").addEventListener("click", loadDemo);
$("#add").addEventListener("click", openAdd);
$("#undo").addEventListener("click", undoLast);
$("#export").addEventListener("click", exportBackup);
$("#file").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  loadFile(file);
  event.target.value = "";
});

$("#editor-close").addEventListener("click", () => closeModal("#editor-modal"));
$("#add-close").addEventListener("click", () => closeModal("#add-modal"));
$("#merge-close").addEventListener("click", () => closeModal("#merge-modal"));

for (const selector of ["#editor-modal", "#add-modal", "#merge-modal"]) {
  $(selector).addEventListener("click", (event) => {
    if (event.target === $(selector)) $(selector).hidden = true;
  });
}

document.addEventListener("click", (event) => {
  if (!event.target.closest("#context-menu")) hideContextMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (closeAll()) event.preventDefault();
    return;
  }
  const meta = event.metaKey || event.ctrlKey;
  if (!meta) return;
  if (event.key.toLowerCase() === "s") {
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
  $("#draft-banner").hidden = true;
}

/* ---------- boot / draft ---------- */
(async () => {
  const draft = await idbGet("draft");
  if (!draft?.text) return;

  loadText(draft.text, draft.fileName || "shelf.json", { draft: true, dirty: Boolean(draft.dirty), restoreView: true });
  const when = draft.savedAt ? new Date(draft.savedAt).toLocaleString() : "earlier";
  $("#draft-meta").textContent = `Restored last session · ${draft.fileName || "shelf"} · ${when}`;
  $("#draft-banner").hidden = false;
  $("#draft-restore").textContent = "Keep";
  $("#draft-restore").onclick = () => {
    $("#draft-banner").hidden = true;
  };
  $("#draft-discard").textContent = "Forget";
  $("#draft-discard").onclick = async () => {
    await clearDraft();
    clearSavedView();
    showLanding();
    toast("Local copy forgotten");
  };
})();
