import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load/.test(m.text())) errors.push(m.text()); });

  await page.evaluateOnNewDocument(() => {
    const files = new Map();
    const fileEntry = (name) => ({
      kind: "file",
      name,
      getFile: async () => {
        const rec = files.get(name);
        return { text: async () => rec.text, lastModified: rec.lastModified, size: rec.text.length };
      },
      createWritable: async () => ({
        write: async (text) => {
          const rec = files.get(name);
          rec.text = text;
          rec.lastModified = Date.now();
        },
        close: async () => {},
      }),
    });
    const handle = {
      kind: "directory",
      name: "TubeShelf Backups",
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
      values: async function* () {
        for (const name of [...files.keys()]) yield fileEntry(name);
      },
      getFileHandle: async (name, options) => {
        if (!files.has(name) && options?.create) files.set(name, { text: "", lastModified: Date.now() });
        if (!files.has(name)) throw new Error("not found");
        return fileEntry(name);
      },
      removeEntry: async (name) => { files.delete(name); },
    };
    window.__fakeFiles = files;
    window.showDirectoryPicker = async () => handle;
  });

  await page.setViewport({ width: 1240, height: 800 });
  const BASE = process.env.BASE_URL || "http://localhost:8770/?test=1";
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await page.click("#demo");
  await new Promise((r) => setTimeout(r, 800));
  await page.click("#drive");
  await new Promise((r) => setTimeout(r, 300));
  const choose = await page.$("#folder-choose");
  assert.ok(choose, "folder chooser is present");
  await choose.click();
  await new Promise((r) => setTimeout(r, 500));
  const connected = await page.evaluate(() => ({
    section: document.querySelector(".folder-section")?.textContent.slice(0, 180),
    save: Boolean(document.querySelector("#folder-save-now")),
  }));
  assert.equal(connected.save, true);

  await page.click("#folder-save-now");
  await new Promise((r) => setTimeout(r, 600));
  const saved = await page.evaluate(() => ({
    files: [...window.__fakeFiles.keys()],
    rows: document.querySelectorAll(".folder-section .drive-row").length,
    button: document.querySelector("#drive")?.textContent,
  }));
  assert.equal(saved.files.length, 1);
  assert.ok(saved.files[0].endsWith("-web.json"));
  assert.equal(saved.rows, 1);

  await page.click("#folder-open-latest");
  await new Promise((r) => setTimeout(r, 800));
  const opened = await page.evaluate(() => ({
    landing: !document.querySelector("#landing").hidden,
    cards: document.querySelectorAll(".card").length,
    modal: document.querySelector("#drive-modal").hidden,
  }));
  assert.equal(opened.cards, 7);
  assert.equal(opened.modal, true);

  const auto = await page.evaluate(async () => {
    const t = window.__tubeshelfTest;
    t.state.folder.lastSavedAt = 0;
    t.state.store.dirty = true;
    t.state.store.revision += 1;
    await t.maybeAutoSave();
    return { files: [...window.__fakeFiles.keys()], dirty: t.state.store.dirty };
  });
  assert.equal(auto.files.length, 2);
  assert.ok(auto.files.some((name) => name.includes("Autosave (Local Sync)")));
  assert.equal(auto.dirty, false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ connected, saved, opened, auto, errors }, null, 2));
  await browser.close();
})();
