import test from "node:test";
import assert from "node:assert/strict";
import { parseBackup, buildBackup } from "../src/format.js";
import {
  createStore,
  currentBackup,
  setVideoTags,
  setVideoNote,
  setVideoFavorite,
  setVideoWatchStatus,
  addVideo,
  newVideo,
  deleteVideo,
  toggleTagPin,
  toggleChannelPin,
  renameTag,
  mergeTags,
  deleteTag,
  undo,
  redo,
  counts,
  displayVideos,
} from "../src/store.js";

const raw = {
  format: "tubeshelf.backup",
  version: 1,
  exportedAt: "2026-11-14T10:00:00Z",
  futureTop: "keep me",
  library: {
    futureLibrary: 7,
    pinnedTags: ["Math"],
    pinnedChannels: ["3Blue1Brown"],
    videos: [
      {
        id: "11111111-1111-1111-1111-111111111111",
        youtubeID: "dQw4w9WgXcQ",
        title: "Vectors",
        channel: "3Blue1Brown",
        tags: ["Math", "Linear Algebra"],
        note: "",
        addedAt: "2026-11-01T10:00:00Z",
        durationSeconds: 213,
        isFavorite: false,
        watchStatus: "unwatched",
        futureVideo: { nested: true },
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        youtubeID: "jNQXAC9IVRw",
        title: "Me at the zoo",
        channel: "jawed",
        tags: ["Film & Video"],
        addedAt: "2026-11-02T10:00:00Z",
      },
    ],
  },
  playlists: [
    {
      id: "PLZHQObOWTQDPD3MizzM2xVFitgF8hE_ab",
      title: "Essence",
      channel: "3Blue1Brown",
      tags: ["Math"],
      items: [],
      watchedItemIDs: [],
      addedAt: "2026-11-03T10:00:00Z",
    },
  ],
};

function store() {
  return createStore(parseBackup(JSON.stringify(raw)), "shelf.json");
}

test("editing preserves unknown fields through a round trip", () => {
  const shelf = store();
  setVideoNote(shelf, "dQw4w9WgXcQ", "watch the proof");
  setVideoFavorite(shelf, "dQw4w9WgXcQ", true);
  setVideoWatchStatus(shelf, "dQw4w9WgXcQ", "done");
  const out = JSON.parse(buildBackup(shelf));
  assert.match(out.exportedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(out.futureTop, "keep me");
  assert.equal(out.library.futureLibrary, 7);
  assert.equal(out.library.videos[0].futureVideo.nested, true);
  assert.equal(out.library.videos[0].note, "watch the proof");
  assert.equal(out.library.videos[0].isFavorite, true);
  assert.equal(out.library.videos[0].watchStatus, "done");
  assert.equal(out.format, "tubeshelf.backup");
  assert.equal(out.version, 1);
  assert.equal(out.playlists.length, 1);
});

test("new videos get ids, timestamps and no duplicate", () => {
  const shelf = store();
  const video = newVideo({ youtubeID: "aaaaaaaaaaa", title: "Actors", channel: "Point-Free", tags: ["Programming"] });
  assert.ok(video.id);
  assert.ok(Date.parse(video.addedAt));
  assert.match(video.addedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "no fractional seconds for Swift");
  assert.equal(addVideo(shelf, video), true);
  assert.equal(addVideo(shelf, video), false);
  assert.equal(shelf.videos.length, 3);
  assert.deepEqual(video.tags, ["Programming"]);
});

test("tags are replaced, renamed, merged and deleted across videos and courses", () => {
  const shelf = store();
  setVideoTags(shelf, "jNQXAC9IVRw", ["math", "film & video"]);
  assert.deepEqual(shelf.videos[1].tags, ["Math", "Film & Video"]);

  renameTag(shelf, "Math", "Mathematics");
  assert.ok(shelf.videos[0].tags.includes("Mathematics"));
  assert.ok(shelf.playlists[0].tags.includes("Mathematics"));
  assert.ok(shelf.pinnedTags.includes("Mathematics"));

  setVideoTags(shelf, "jNQXAC9IVRw", ["Linear Algebra", "Mathematics"]);
  mergeTags(shelf, "Mathematics", "Linear Algebra");
  assert.ok(!shelf.videos[1].tags.includes("Mathematics"));
  assert.ok(shelf.videos[1].tags.includes("Linear Algebra"));

  deleteTag(shelf, "Linear Algebra");
  assert.ok(!shelf.videos[0].tags.includes("Linear Algebra"));
  assert.ok(!shelf.playlists[0].tags.includes("Linear Algebra"));
});

test("pins toggle and undo restores the exact previous state", () => {
  const shelf = store();
  toggleTagPin(shelf, "Math");
  assert.deepEqual(shelf.pinnedTags, []);
  toggleChannelPin(shelf, "3Blue1Brown");
  assert.deepEqual(shelf.pinnedChannels, []);
  assert.equal(undo(shelf), true);
  assert.deepEqual(shelf.pinnedChannels, ["3Blue1Brown"]);
  assert.equal(redo(shelf), true);
  assert.deepEqual(shelf.pinnedChannels, []);
});

test("deleting a video prunes pins that no longer exist", () => {
  const shelf = store();
  toggleTagPin(shelf, "Film & Video");
  assert.ok(shelf.pinnedTags.includes("Film & Video"));
  deleteVideo(shelf, "jNQXAC9IVRw");
  assert.ok(!shelf.pinnedTags.includes("Film & Video"));
  assert.equal(shelf.videos.length, 1);
});

test("counts merge videos and courses", () => {
  const shelf = store();
  const { categories, channels } = counts(shelf);
  assert.equal(categories.find((entry) => entry.name === "Math").count, 2);
  assert.equal(channels.find((entry) => entry.name === "3Blue1Brown").count, 1);
});

test("display videos reflect edits", () => {
  const shelf = store();
  setVideoNote(shelf, "jNQXAC9IVRw", "hello");
  const shown = displayVideos(shelf);
  assert.equal(shown.find((video) => video.youtubeID === "jNQXAC9IVRw").note, "hello");
});

test("a raw library file exports as a backup envelope", () => {
  const rawLibrary = { videos: [{ youtubeID: "dQw4w9WgXcQ", title: "A", tags: [] }], futureX: 1 };
  const shelf = createStore(parseBackup(JSON.stringify(rawLibrary)));
  const out = JSON.parse(currentBackup(shelf));
  assert.equal(out.format, "tubeshelf.backup");
  assert.equal(out.library.futureX, 1);
  assert.equal(out.playlists, undefined);
});
