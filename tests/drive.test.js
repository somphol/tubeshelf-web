import test from "node:test";
import assert from "node:assert/strict";
import {
  Drive,
  DriveError,
  backupName,
  autosaveName,
  isAutosaveName,
  retentionVictims,
  latestFile,
  multipartBody,
  scopeForMode,
  autoSavePlan,
  AUTO_SAVE_INTERVAL,
  DRIVE_SCOPE_FILE,
  DRIVE_SCOPE_FULL,
} from "../src/drive.js";

test("names distinguish manual, autosave and local files", () => {
  const date = new Date(2026, 10, 15, 13, 0, 0);
  assert.equal(backupName(date), "TubeShelf 2026-11-15 13.00.00-web.json");
  assert.equal(backupName(date, "My Shelf"), "TubeShelf My Shelf 2026-11-15 13.00.00-web.json");
  assert.equal(autosaveName(date), "TubeShelf Autosave (Web) 2026-11-15 13.00.00.json");
  assert.equal(isAutosaveName(autosaveName(date)), true);
  assert.equal(isAutosaveName(backupName(date)), false);
  assert.equal(isAutosaveName("TubeShelf Autosave (Mac) 2026-11-15.json"), false);
});

test("retention keeps 24 web autosaves and never touches manual backups", () => {
  const files = [];
  for (let i = 0; i < 26; i += 1) {
    files.push({
      id: `auto-${i}`,
      name: `TubeShelf Autosave (Web) 2026-11-15 ${String(i).padStart(2, "0")}.00.00.json`,
      modifiedTime: `2026-11-15T${String(i).padStart(2, "0")}:00:00Z`,
    });
  }
  files.push({ id: "manual", name: "TubeShelf 2026-11-15 12.00.00.json", modifiedTime: "2026-11-15T12:00:00Z" });
  const victims = retentionVictims(files, 24);
  assert.equal(victims.length, 2);
  assert.deepEqual(victims.map((file) => file.id).sort(), ["auto-0", "auto-1"]);
});

test("latestFile sorts by modified time and ignores nothing", () => {
  const files = [
    { id: "a", name: "a", modifiedTime: "2026-11-15T10:00:00Z" },
    { id: "b", name: "b", modifiedTime: "2026-11-15T12:00:00Z" },
  ];
  assert.equal(latestFile(files).id, "b");
  assert.equal(latestFile([]), null);
});

test("multipartBody is a valid multipart/related payload", () => {
  const { body, contentType } = multipartBody({ name: "x.json", mimeType: "application/json" }, '{"a":1}', "BOUND");
  assert.equal(contentType, "multipart/related; boundary=BOUND");
  assert.match(body, /^--BOUND\r\nContent-Type: application\/json/);
  assert.match(body, /\{"name":"x\.json","mimeType":"application\/json"\}/);
  assert.match(body, /\{"a":1\}/);
  assert.match(body, /--BOUND--\r\n$/);
});

test("scope follows the access mode", () => {
  assert.equal(scopeForMode("picker"), DRIVE_SCOPE_FILE);
  assert.equal(scopeForMode("full"), DRIVE_SCOPE_FULL);
});

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => (typeof data === "string" ? data : JSON.stringify(data)),
  };
}

test("ensureFolder lists then creates only when missing", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/files?") && !String(url).includes("upload")) return response({ files: [] });
    return response({ id: "folder-1", name: "TubeShelf Backups" });
  };
  const drive = new Drive("token", { fetchImpl });
  const folder = await drive.ensureFolder("TubeShelf Backups");
  assert.equal(folder.id, "folder-1");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.method, "POST");
  assert.match(calls[1].options.body, /"mimeType":"application\/vnd\.google-apps\.folder"/);
});

test("listFolder follows nextPageToken and download/delete hit the right paths", async () => {
  const calls = [];
  let page = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options?.method || "GET" });
    if (String(url).includes("pageToken")) return response({ files: [{ id: "2", name: "b" }] });
    if (String(url).includes("/files?") && !String(url).includes("pageToken")) {
      page += 1;
      return response({ files: [{ id: "1", name: "a" }], nextPageToken: "next" });
    }
    if (String(url).includes("alt=media")) return response("hello");
    return response({});
  };
  const drive = new Drive("token", { fetchImpl });
  const files = await drive.listFolder("folder");
  assert.deepEqual(files.map((file) => file.id), ["1", "2"]);
  assert.equal(await drive.download("1"), "hello");
  await drive.delete("1");
  assert.ok(calls.some((call) => call.method === "DELETE" && call.url.endsWith("/files/1")));
});

test("upload sends the envelope as multipart", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url: String(url), options };
    return response({ id: "new-file", name: "TubeShelf.json" });
  };
  const drive = new Drive("token", { fetchImpl });
  const result = await drive.upload({ name: "TubeShelf.json", text: "{}", parents: ["folder"] });
  assert.equal(result.id, "new-file");
  assert.match(captured.url, /upload\/drive\/v3\/files\?uploadType=multipart/);
  assert.match(captured.options.headers["Content-Type"], /multipart\/related; boundary=/);
  assert.match(captured.options.body, /"parents":\["folder"\]/);
});

test("DriveError carries the HTTP status", async () => {
  const fetchImpl = async () => response("nope", 403);
  const drive = new Drive("token", { fetchImpl });
  await assert.rejects(drive.listFolder("folder"), (error) => {
    assert.ok(error instanceof DriveError);
    assert.equal(error.status, 403);
    return true;
  });
});


test("hourly plan prefers Drive, skips duplicates, and falls back locally", () => {
  const hour = AUTO_SAVE_INTERVAL;
  const now = 10 * hour;

  assert.deepEqual(
    autoSavePlan({ now, dirty: false, driveReady: true, lastCloudAt: 0, lastLocalAt: 0, revision: 2, lastRevision: 1 }),
    { cloudDue: false, localDue: false, localFallbackDue: false }
  );

  assert.deepEqual(
    autoSavePlan({ now, dirty: true, driveReady: true, lastCloudAt: now - hour, lastLocalAt: 0, revision: 2, lastRevision: 1 }),
    { cloudDue: true, localDue: false, localFallbackDue: true }
  );

  assert.deepEqual(
    autoSavePlan({ now, dirty: true, driveReady: true, lastCloudAt: now - 1000, lastLocalAt: 0, revision: 2, lastRevision: 1 }),
    { cloudDue: false, localDue: false, localFallbackDue: true }
  );

  assert.deepEqual(
    autoSavePlan({ now, dirty: true, driveReady: false, lastCloudAt: 0, lastLocalAt: now - hour, revision: 2, lastRevision: 1 }),
    { cloudDue: false, localDue: true, localFallbackDue: true }
  );

  assert.deepEqual(
    autoSavePlan({ now, dirty: true, driveReady: false, lastCloudAt: 0, lastLocalAt: now - hour, revision: 2, lastRevision: 2 }),
    { cloudDue: false, localDue: false, localFallbackDue: false }
  );
});
