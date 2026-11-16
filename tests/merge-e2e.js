import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { demoBackup } from "../src/demo.js";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:8770/?test=1";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixture(path, mutate) {
  const copy = JSON.parse(JSON.stringify(demoBackup));
  mutate(copy);
  fs.writeFileSync(path, JSON.stringify(copy, null, 2));
  return path;
}

const conflictFile = fixture("/tmp/tubeshelf-merge-conflict.json", (backup) => {
  const video = backup.library.videos.find((item) => item.youtubeID === "VEtU4Co08yY");
  video.note = "backup note";
  backup.library.videos.find((item) => item.youtubeID === "jNQXAC9IVRw").isFavorite = true;
});

const cleanFile = fixture("/tmp/tubeshelf-merge-clean.json", (backup) => {
  backup.library.videos.find((item) => item.youtubeID === "jNQXAC9IVRw").isFavorite = true;
});

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" && !/404|Failed to load resource/.test(message.text())) {
      errors.push(message.text());
    }
  });
  page.on("dialog", (dialog) => dialog.accept());

  await page.setViewport({ width: 1240, height: 800 });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await page.click("#demo");
  await wait(700);

  const storeValue = (expression) =>
    page.evaluate((code) => Function(`return (${code})`)(), expression);

  async function editNote(note) {
    const opened = await page.evaluate(() => {
      const card = document.querySelector(".card");
      const button = [...card.querySelectorAll("button")].find((item) => item.title === "Edit categories and notes");
      if (!button) return false;
      button.click();
      return true;
    });
    assert.equal(opened, true, "card edit button exists");
    await page.waitForSelector("#editor-modal:not([hidden])", { timeout: 5000 });
    await page.$eval("#editor-body textarea", (node, value) => {
      node.value = value;
      node.dispatchEvent(new Event("input", { bubbles: true }));
    }, note);
    await page.evaluate(() => {
      const save = [...document.querySelectorAll("#editor-body .modal-actions button")]
        .find((button) => button.textContent === "Save");
      save.click();
    });
    await wait(300);
  }

  async function upload(path) {
    const input = await page.$("#file");
    await input.uploadFile(path);
    await wait(800);
  }

  await editNote("browser note");
  assert.equal(await storeValue('window.__tubeshelfTest.state.store.videos.find(v => v.youtubeID === "VEtU4Co08yY").note'), "browser note");

  await upload(conflictFile);
  await page.waitForSelector("#reconcile-modal:not([hidden])", { timeout: 5000 });
  const summary = await page.$eval(".reconcile-summary", (node) => node.textContent);
  assert.match(summary, /1 conflict/);
  assert.equal(await page.$$eval(".reconcile-card", (nodes) => nodes.length), 1);
  assert.match(await page.$eval(".reconcile-card", (node) => node.textContent), /Note/);

  const picked = await page.evaluate(() => {
    const row = [...document.querySelectorAll(".reconcile-row")]
      .find((node) => node.textContent.includes("Note"));
    const backup = [...row.querySelectorAll(".reconcile-choice")]
      .find((node) => node.textContent.includes("Backup"));
    if (!backup) return false;
    backup.querySelector("input").click();
    return true;
  });
  assert.equal(picked, true, "backup note choice exists");

  await page.click("#reconcile-merge");
  await wait(500);
  assert.equal(await page.$eval("#reconcile-modal", (node) => node.hidden), true, "modal closes after merge");
  assert.equal(await storeValue('window.__tubeshelfTest.state.store.videos.find(v => v.youtubeID === "VEtU4Co08yY").note'), "backup note");
  assert.equal(await storeValue('window.__tubeshelfTest.state.store.videos.find(v => v.youtubeID === "jNQXAC9IVRw").isFavorite'), true);
  assert.equal(await storeValue("window.__tubeshelfTest.state.store.dirty"), true);
  assert.equal(await page.$eval("#undo", (node) => node.disabled), false);

  await page.click("#undo");
  await wait(300);
  assert.equal(await storeValue('window.__tubeshelfTest.state.store.videos.find(v => v.youtubeID === "VEtU4Co08yY").note'), "browser note");
  assert.equal(Boolean(await storeValue('window.__tubeshelfTest.state.store.videos.find(v => v.youtubeID === "jNQXAC9IVRw").isFavorite')), false);

  await editNote("note before reload");
  await wait(1700);
  await page.reload({ waitUntil: "networkidle2" });
  await wait(800);
  assert.equal(await page.$("#draft-banner"), null, "no draft banner");
  assert.equal(await storeValue('window.__tubeshelfTest.state.store.videos.find(v => v.youtubeID === "VEtU4Co08yY").note'), "note before reload");
  assert.equal(await storeValue("window.__tubeshelfTest.state.base !== null"), true, "merge base survives reload");

  await upload(cleanFile);
  assert.equal(await page.$eval("#reconcile-modal", (node) => node.hidden), true, "no conflict for a favorite-only backup");
  assert.equal(await storeValue('window.__tubeshelfTest.state.store.videos.find(v => v.youtubeID === "VEtU4Co08yY").note'), "note before reload");
  assert.equal(await storeValue('window.__tubeshelfTest.state.store.videos.find(v => v.youtubeID === "jNQXAC9IVRw").isFavorite'), true);

  await page.setViewport({ width: 390, height: 844 });
  await editNote("mobile note");
  await upload(conflictFile);
  await page.waitForSelector("#reconcile-modal:not([hidden])", { timeout: 5000 });
  const rect = await page.$eval(".reconcile-panel", (node) => {
    const box = node.getBoundingClientRect();
    return { left: box.left, right: box.right, bottom: box.bottom, width: window.innerWidth, height: window.innerHeight };
  });
  assert.ok(rect.left >= 0 && rect.right <= rect.width, "merge panel fits the narrow viewport");
  assert.ok(rect.bottom <= rect.height, "merge panel fits the screen height");
  await page.click("#reconcile-keep");
  assert.equal(await page.$eval("#reconcile-modal", (node) => node.hidden), true, "keep closes the modal");
  assert.equal(await storeValue('window.__tubeshelfTest.state.store.videos.find(v => v.youtubeID === "VEtU4Co08yY").note'), "mobile note");

  await upload(conflictFile);
  await page.waitForSelector("#reconcile-modal:not([hidden])", { timeout: 5000 });
  await page.click("#reconcile-replace");
  await wait(500);
  assert.equal(await page.$eval("#reconcile-modal", (node) => node.hidden), true, "replace closes the modal");
  assert.equal(await storeValue('window.__tubeshelfTest.state.store.videos.find(v => v.youtubeID === "VEtU4Co08yY").note'), "backup note");
  assert.equal(await storeValue("window.__tubeshelfTest.state.store.dirty"), false);

  assert.deepEqual(errors, [], "no page errors");
  console.log(JSON.stringify({ summary, errors }, null, 2));
} finally {
  await browser.close();
}
