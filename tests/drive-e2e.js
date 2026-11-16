import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new",
  });
  const page = await browser.newPage();
  page.on("dialog", (dialog) => dialog.accept());
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errors.push(m.text());
    if (m.text().startsWith("DRIVE SAVE")) console.log("PAGE", m.text());
  });
  await page.setViewport({ width: 1240, height: 800 });
  await page.setRequestInterception(true);

  const drive = { folder: null, files: [] };
  let uploadCount = 0;

  page.on("request", async (request) => {
    const url = request.url();

    if (url === "https://accounts.google.com/gsi/client") {
      return request.respond({
        status: 200,
        contentType: "application/javascript",
        body: `
          window.google = window.google || {};
          window.google.accounts = window.google.accounts || {};
          window.google.accounts.oauth2 = {
            initTokenClient: (config) => ({
              requestAccessToken: () => setTimeout(() => config.callback({
                access_token: "fake-drive-token",
                expires_in: 3600
              }), 20)
            }),
            revoke: () => {}
          };
        `,
      });
    }

    if (url.startsWith("https://www.googleapis.com/") || url.startsWith("https://uploads.googleapis.com/")) {
      if (request.method() === "OPTIONS") {
        return request.respond({
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
            "access-control-allow-headers": "authorization,content-type",
          },
        });
      }
      const parsed = new URL(url);
      const q = parsed.searchParams.get("q") || "";
      const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };
      const json = (value, status = 200) =>
        request.respond({ status, headers: cors, body: JSON.stringify(value) });

      if (request.method() === "GET" && parsed.pathname.endsWith("/files")) {
        if (q.includes("mimeType='application/vnd.google-apps.folder'")) {
          return json({ files: drive.folder ? [drive.folder] : [] });
        }
        if (q.includes("in parents")) {
            return json({ files: drive.files });
        }
        return json({ files: [] });
      }
      if (request.method() === "POST" && parsed.pathname.includes("/upload/drive/v3/files")) {
        const body = request.postData() || "";
        const name = (body.match(/"name":"([^"]+)"/) || [])[1] || `upload-${uploadCount}.json`;
        const contentType = request.headers()["content-type"] || "";
        const boundary = (contentType.match(/boundary=(.+)$/) || [])[1];
        let text = "{}";
        if (boundary) {
          const parts = body.split(`--${boundary}`);
          if (parts[2]) {
            text = parts[2].split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, "");
          }
        }
        uploadCount += 1;
        const file = {
          id: `file-${uploadCount}`,
          name,
          modifiedTime: new Date().toISOString(),
          parents: ["folder-1"],
        };
        drive.files.unshift({ ...file, text });
        return json({ id: file.id, name, modifiedTime: file.modifiedTime, parents: file.parents });
      }
      if (request.method() === "POST" && parsed.pathname.endsWith("/files")) {
        drive.folder = { id: "folder-1", name: "TubeShelf Backups", modifiedTime: new Date().toISOString() };
        return json(drive.folder);
      }
      if (request.method() === "GET" && parsed.pathname.includes("/files/") && parsed.searchParams.get("alt") === "media") {
        const id = parsed.pathname.split("/").pop();
        const file = drive.files.find((entry) => entry.id === id);
        return request.respond({
          status: 200,
          headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
          body: file?.text || "{}",
        });
      }
      if (request.method() === "DELETE" && parsed.pathname.includes("/files/")) {
        const id = parsed.pathname.split("/").pop();
        drive.files = drive.files.filter((entry) => entry.id !== id);
        return request.respond({ status: 204, headers: { "access-control-allow-origin": "*" } });
      }
      return json({});
    }

    return request.continue();
  });

  const BASE = process.env.BASE_URL || "http://localhost:8770/?test=1";
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await page.click("#demo");
  await new Promise((r) => setTimeout(r, 800));
  await page.click("#drive");
  await new Promise((r) => setTimeout(r, 300));
  const localCopy = await page.$eval("#drive-body", (node) => node.textContent);
  assert.match(localCopy, /Local copy on this device/);
  assert.match(localCopy, /Forget local copy/);
  await page.type("#drive-client", "123-test.apps.googleusercontent.com");
  await page.type("#drive-key", "fake-api-key");
  await page.select("#drive-mode", "full");
  await page.click("#drive-save-settings");
  await new Promise((r) => setTimeout(r, 300));
  await page.click("#drive-connect");
  await new Promise((r) => setTimeout(r, 1200));

  const connected = await page.evaluate(() => ({
    button: document.querySelector("#drive").textContent,
    status: document.querySelector("#drive-body .drive-status")?.textContent,
    saveNow: Boolean(document.querySelector("#drive-save-now")),
    folder: JSON.parse(localStorage.getItem("tubeshelf-rw-drive-state") || "{}").folderId,
  }));

  console.log("CONNECTED", JSON.stringify(connected));
  await page.screenshot({ path: "/tmp/rw-drive-connected.png" });
  if (!connected.saveNow) {
    console.log("PANEL", await page.evaluate(() => document.querySelector("#drive-body")?.textContent));
    await browser.close();
    return;
  }
  await page.click("#drive-save-now");
  await new Promise((r) => setTimeout(r, 800));
  const saved = {
    uploads: uploadCount,
    name: drive.files[0]?.name,
    size: drive.files[0]?.text?.length,
    listed: await page.evaluate(() => document.querySelectorAll("#drive-body .drive-list .drive-row").length),
  };

  const auto = await page.evaluate(async () => {
    const t = window.__tubeshelfTest;
    t.state.drive.lastAutoSaveAt = Date.now() - 2 * 3600 * 1000;
    t.state.store.revision += 1;
    t.state.store.dirty = true;
    await t.maybeAutoSave();
    return {
      uploads: "pending",
      dirty: t.state.store.dirty,
      lastAt: t.state.drive.lastAutoSaveAt,
    };
  });
  const uploadAfterAuto = uploadCount;


  await page.click("#drive-open-latest");
  await new Promise((r) => setTimeout(r, 1200));
  const opened = await page.evaluate(() => ({
    meta: document.querySelector("#file-meta")?.textContent,
    cards: document.querySelectorAll(".card").length,
    modalClosed: document.querySelector("#drive-modal").hidden,
  }));

  const local = await page.evaluate(async () => {
    const t = window.__tubeshelfTest;
    t.state.drive.token = null;
    t.state.drive.status = "off";
    t.state.snapshots.lastAt = 0;
    t.state.snapshots.revision = -1;
    t.state.store.revision += 1;
    t.state.store.dirty = true;
    await t.maybeAutoSave();
    return { snapshots: (await t.localSnapshots()).length, uploads: "pending", dirty: t.state.store.dirty };
  });
  const uploadAfterLocal = uploadCount;
  await page.reload({ waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 900));
  const reloaded = await page.evaluate(() => ({
    landing: !document.querySelector("#landing").hidden,
    cards: document.querySelectorAll(".card").length,
    button: document.querySelector("#drive").textContent,
  }));

  assert.equal(connected.saveNow, true, "Save now is available after connecting");
  assert.equal(connected.folder, "folder-1");
  assert.equal(saved.uploads, 1);
  assert.ok(saved.name.startsWith("TubeShelf "));
  assert.ok(saved.name.endsWith("-web.json"));
  assert.equal(saved.listed, 1);
  assert.equal(auto.dirty, false, "cloud autosave marks the shelf clean");
  assert.equal(uploadAfterAuto, 2, "one web autosave was uploaded");
  assert.equal(local.snapshots, 1, "local fallback snapshot was written");
  assert.equal(uploadAfterLocal, 2, "local fallback did not upload to Drive");
  assert.equal(opened.cards, 7);
  assert.equal(opened.modalClosed, true);
  assert.equal(reloaded.cards, 7);
  assert.equal(await page.$("#draft-banner"), null, "no draft banner");
  assert.deepEqual(errors, [], "no page errors");

  console.log(JSON.stringify({ connected, saved, auto, uploadAfterAuto, local, uploadAfterLocal, opened, reloaded, errors }, null, 2));
  await page.screenshot({ path: "/tmp/rw-drive-e2e.png" });
  await browser.close();
})();
