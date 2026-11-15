import test from "node:test";
import assert from "node:assert/strict";
import {
  folderAutosaveName,
  isFolderAutosave,
  folderRetentionVictims,
  latestBackup,
  listBackups,
  readText,
  writeText,
  deleteFile,
} from "../src/folder.js";

function fakeHandle() {
  const files = new Map();
  let tick = 0;
  const entry = (name) => ({
    kind: "file",
    name,
    getFile: async () => {
      const record = files.get(name);
      return { text: async () => record.text, lastModified: record.lastModified, size: record.text.length };
    },
    createWritable: async () => ({
      write: async (text) => {
        const record = files.get(name);
        record.text = text;
        record.lastModified = Date.now() + (++tick);
      },
      close: async () => {},
    }),
  });
  return {
    name: "TubeShelf Backups",
    files,
    values: async function* () {
      for (const name of [...files.keys()]) yield entry(name);
    },
    getFileHandle: async (name, options) => {
      if (!files.has(name) && options?.create) files.set(name, { text: "", lastModified: Date.now() + (++tick) });
      if (!files.has(name)) throw new Error("missing");
      return entry(name);
    },
    removeEntry: async (name) => files.delete(name),
  };
}

test("local sync names and retention keep manual files", () => {
  const date = new Date(2026, 10, 15, 14, 0, 0);
  const name = folderAutosaveName(date);
  assert.equal(name, "TubeShelf Autosave (Local Sync) 2026-11-15 14.00.00.json");
  assert.equal(isFolderAutosave(name), true);
  assert.equal(isFolderAutosave("TubeShelf 2026-11-15.json"), false);

  const files = Array.from({ length: 26 }, (_, index) => ({
    name: folderAutosaveName(new Date(2026, 10, 15, index, 0, 0)),
    lastModified: index,
  }));
  files.push({ name: "TubeShelf manual.json", lastModified: 999 });
  const victims = folderRetentionVictims(files, 24);
  assert.equal(victims.length, 2);
  assert.ok(victims.every((file) => isFolderAutosave(file.name)));
});

test("folder handle read/write/list/delete", async () => {
  const handle = fakeHandle();
  await writeText(handle, "TubeShelf 2026-11-15 14.00.00.json", '{"a":1}');
  await writeText(handle, "TubeShelf Autosave (Local Sync) 2026-11-15 15.00.00.json", '{"b":2}');
  const files = await listBackups(handle);
  assert.equal(files.length, 2);
  assert.ok(files[0].lastModified >= files[1].lastModified);
  const latest = latestBackup(files);
  assert.equal(await readText(latest.entry), '{"b":2}');
  await deleteFile(handle, "TubeShelf Autosave (Local Sync) 2026-11-15 15.00.00.json");
  assert.equal((await listBackups(handle)).length, 1);
});
