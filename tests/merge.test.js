import test from "node:test";
import assert from "node:assert/strict";
import { mergeShelves, resolveMerge, shelfFingerprint } from "../src/merge.js";

const video = (youtubeID, overrides = {}) => ({
  youtubeID,
  title: youtubeID,
  channel: "Channel",
  tags: [],
  note: "",
  isFavorite: false,
  watchStatus: "unwatched",
  ...overrides,
});

const shelf = (videos, overrides = {}) => ({
  videos,
  playlists: [],
  pinnedTags: [],
  pinnedChannels: [],
  hasPlaylistCatalog: false,
  ...overrides,
});

test("one-sided field edits merge without a conflict", () => {
  const base = shelf([video("a", { note: "old" })]);
  const mine = shelf([video("a", { note: "browser" })]);
  const theirs = shelf([video("a", { note: "old", isFavorite: true })]);

  const result = mergeShelves(base, mine, theirs);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.shelf.videos[0].note, "browser");
  assert.equal(result.shelf.videos[0].isFavorite, true);
  assert.equal(result.stats.updated, 1);
});

test("a field changed on both sides becomes a conflict", () => {
  const base = shelf([video("a", { note: "old" })]);
  const mine = shelf([video("a", { note: "browser" })]);
  const theirs = shelf([video("a", { note: "backup" })]);

  const result = mergeShelves(base, mine, theirs);
  assert.equal(result.conflicts.length, 1);
  const [group] = result.conflicts;
  assert.equal(group.key, "video:a");
  assert.equal(group.fields[0].key, "note");
  assert.equal(group.fields[0].default, "mine");
  assert.equal(result.shelf.videos[0].note, "browser");

  const resolved = resolveMerge(result.shelf, result.conflicts, {
    "video:a:note": "theirs",
  });
  assert.equal(resolved.videos[0].note, "backup");
});

test("category conflicts default to combining both sides", () => {
  const base = shelf([video("a", { tags: ["Math"] })]);
  const mine = shelf([video("a", { tags: ["Math", "Linear Algebra"] })]);
  const theirs = shelf([video("a", { tags: ["Math", "Calculus"] })]);

  const result = mergeShelves(base, mine, theirs);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].fields[0].default, "both");
  assert.deepEqual(result.shelf.videos[0].tags, ["Math", "Linear Algebra", "Calculus"]);

  const mineOnly = resolveMerge(result.shelf, result.conflicts, {
    "video:a:tags": "mine",
  });
  assert.deepEqual(mineOnly.videos[0].tags, ["Math", "Linear Algebra"]);
});

test("favorite fills from one side and watch state can conflict", () => {
  const base = shelf([video("a")]);
  const mine = shelf([video("a", { isFavorite: true, watchStatus: "watching" })]);
  const theirs = shelf([video("a", { isFavorite: false, watchStatus: "done" })]);

  const result = mergeShelves(base, mine, theirs);
  assert.equal(result.shelf.videos[0].isFavorite, true);
  assert.equal(result.conflicts.length, 1);
  const keys = result.conflicts[0].fields.map((field) => field.key);
  assert.deepEqual(keys, ["watchStatus"]);

  const resolved = resolveMerge(result.shelf, result.conflicts, {
    "video:a:watchStatus": "theirs",
  });
  assert.equal(resolved.videos[0].isFavorite, true);
  assert.equal(resolved.videos[0].watchStatus, "done");
});

test("videos added on either side are kept", () => {
  const base = shelf([video("a")]);
  const mine = shelf([video("a"), video("local")]);
  const theirs = shelf([video("a"), video("remote")]);

  const result = mergeShelves(base, mine, theirs);
  assert.deepEqual(result.shelf.videos.map((item) => item.youtubeID), ["a", "local", "remote"]);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.stats.added, 1);
  assert.equal(result.stats.kept, 1);
});

test("a backup deletion applies when the browser did not edit the video", () => {
  const base = shelf([video("a"), video("b")]);
  const mine = shelf([video("a", { note: "edited here" }), video("b")]);
  const theirs = shelf([video("a")]);

  const result = mergeShelves(base, mine, theirs);
  assert.deepEqual(result.shelf.videos.map((item) => item.youtubeID), ["a"]);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.stats.deleted, 1);
});

test("a locally edited video deleted in the backup asks", () => {
  const base = shelf([video("a")]);
  const mine = shelf([video("a", { note: "edited here" })]);
  const theirs = shelf([]);

  const result = mergeShelves(base, mine, theirs);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].presence, "deleted-in-backup");
  assert.deepEqual(result.shelf.videos.map((item) => item.youtubeID), ["a"]);

  const restored = resolveMerge(result.shelf, result.conflicts, {
    "video:a:presence": "theirs",
  });
  assert.deepEqual(restored.videos, []);
});

test("a video deleted here but edited in the backup asks before returning", () => {
  const base = shelf([video("a")]);
  const mine = shelf([]);
  const theirs = shelf([video("a", { note: "edited remotely" })]);

  const result = mergeShelves(base, mine, theirs);
  assert.deepEqual(result.shelf.videos, []);
  assert.equal(result.conflicts[0].presence, "deleted-here");

  const restored = resolveMerge(result.shelf, result.conflicts, {
    "video:a:presence": "theirs",
  });
  assert.equal(restored.videos[0].note, "edited remotely");
});

test("without a base, differing fields are conflicts and tags combine", () => {
  const mine = shelf([video("a", { note: "browser", tags: ["Math"] })]);
  const theirs = shelf([video("a", { note: "backup", tags: ["Calculus"] })]);

  const result = mergeShelves(null, mine, theirs);
  assert.deepEqual(
    result.conflicts[0].fields.map((field) => field.key),
    ["tags", "note"]
  );
  assert.deepEqual(result.shelf.videos[0].tags, ["Math", "Calculus"]);
  assert.equal(result.shelf.videos[0].note, "browser");
});

test("pins merge three ways without deleting a one-sided change", () => {
  const base = shelf([], { pinnedTags: ["Math", "Old"], pinnedChannels: ["A"] });
  const mine = shelf([], { pinnedTags: ["Math", "Cooking"], pinnedChannels: ["A", "B"] });
  const theirs = shelf([], { pinnedTags: ["Math", "Old", "Physics"], pinnedChannels: ["A"] });

  const result = mergeShelves(base, mine, theirs);
  assert.deepEqual(result.shelf.pinnedTags, ["Math", "Cooking", "Physics"]);
  assert.deepEqual(result.shelf.pinnedChannels, ["A", "B"]);
});

test("playlists merge whole records and survive a backup without a catalog", () => {
  const basePlaylist = { id: "p1", title: "Course", tags: [], items: [{ youtubeID: "a" }] };
  const base = shelf([], { playlists: [basePlaylist], hasPlaylistCatalog: true });
  const mine = shelf([], {
    playlists: [{ ...basePlaylist, title: "Course edited" }],
    hasPlaylistCatalog: true,
  });
  const theirs = shelf([], { playlists: [basePlaylist], hasPlaylistCatalog: true });

  const oneSided = mergeShelves(base, mine, theirs);
  assert.equal(oneSided.shelf.playlists[0].title, "Course edited");
  assert.equal(oneSided.conflicts.length, 0);

  const both = mergeShelves(
    base,
    mine,
    shelf([], { playlists: [{ ...basePlaylist, title: "Course from Mac" }], hasPlaylistCatalog: true })
  );
  assert.equal(both.conflicts[0].kind, "playlist");
  const resolved = resolveMerge(both.shelf, both.conflicts, { "playlist:p1:presence": "theirs" });
  assert.equal(resolved.playlists[0].title, "Course from Mac");

  const noCatalog = mergeShelves(
    base,
    mine,
    shelf([], { playlists: [], hasPlaylistCatalog: false })
  );
  assert.equal(noCatalog.shelf.playlists.length, 1);
  assert.equal(noCatalog.conflicts.length, 0);
});

test("unknown fields on the current video survive the merge", () => {
  const base = shelf([video("a")]);
  const mine = shelf([{ ...video("a"), custom: { keep: true } }]);
  const theirs = shelf([video("a", { note: "backup note" })]);

  const result = mergeShelves(base, mine, theirs);
  assert.deepEqual(result.shelf.videos[0].custom, { keep: true });
  assert.equal(result.shelf.videos[0].note, "backup note");
});

test("fingerprints ignore display order of categories", () => {
  const left = shelf([video("a", { tags: ["Math", "Calculus"] })]);
  const right = shelf([video("a", { tags: ["Calculus", "Math"] })]);
  assert.equal(shelfFingerprint(left), shelfFingerprint(right));
});
