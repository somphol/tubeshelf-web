import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:8770/?test=1";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("dialog", (dialog) => dialog.accept());
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" && !/404|Failed to load resource/.test(message.text())) {
      errors.push(message.text());
    }
  });

  await page.setViewport({ width: 1240, height: 800 });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await page.click("#demo");
  await wait(700);
  await page.evaluate(() => {
    [...document.querySelectorAll(".side-list button")]
      .find((node) => node.textContent.includes("Playlist Catalog"))
      .click();
  });
  await wait(250);

  assert.equal(await page.$eval(".content-head h2", (node) => node.textContent), "Playlist Catalog");
  assert.equal(await page.$$eval(".card", (nodes) => nodes.length), 1);
  assert.match(await page.$eval(".card-title", (node) => node.textContent), /Essence of linear algebra/);
  assert.match(await page.$eval(".card-meta", (node) => node.textContent), /2\/3 watched/);

  await page.click(".card");
  await page.waitForSelector("#course:not([hidden])", { timeout: 5000 });
  assert.equal(await page.$$eval(".course-row", (nodes) => nodes.length), 3);
  assert.equal(await page.$$eval(".course-row .tick.on", (nodes) => nodes.length), 2);
  assert.match(await page.$eval("#course .deck-top .right", (node) => node.textContent), /2 \/ 3 watched/);

  await page.evaluate(() => document.querySelectorAll(".course-row .tick")[2].click());
  await wait(250);
  assert.equal(await page.$$eval(".course-row .tick.on", (nodes) => nodes.length), 3);
  assert.match(await page.$eval("#course .deck-top .right", (node) => node.textContent), /3 \/ 3 watched/);
  assert.equal(
    await page.evaluate(() => window.__tubeshelfTest.state.store.playlists[0].watchedItemIDs.length),
    3
  );

  await page.type("#course-tag-input", "Archive");
  await page.evaluate(() => {
    [...document.querySelectorAll("#course .button")].find((node) => node.textContent === "Add").click();
  });
  await wait(250);
  assert.ok(
    await page.$$eval("#course .tag-chip", (nodes) => nodes.some((node) => node.textContent.includes("Archive")))
  );
  assert.ok(
    await page.evaluate(() => window.__tubeshelfTest.state.store.playlists[0].tags.includes("Archive"))
  );

  await page.evaluate(() => {
    [...document.querySelectorAll("#course .button")]
      .find((node) => node.textContent.includes("Present 3 chapters"))
      .click();
  });
  await page.waitForSelector("#deck:not([hidden])", { timeout: 5000 });
  assert.equal(await page.$eval(".deck-top .right", (node) => node.textContent), "1 / 3✕");
  await page.keyboard.press("Escape");
  await wait(200);

  await page.click(".card");
  await page.waitForSelector("#course:not([hidden])", { timeout: 5000 });
  await page.evaluate(() => {
    [...document.querySelectorAll("#course .button")]
      .find((node) => node.textContent === "Remove course")
      .click();
  });
  await wait(400);
  assert.equal(await page.$eval("#course", (node) => node.hidden), true);
  assert.equal(await page.$$eval(".card", (nodes) => nodes.length), 0);
  assert.match(await page.$eval(".empty h3", (node) => node.textContent), /No courses yet/);
  assert.equal(await page.evaluate(() => window.__tubeshelfTest.state.store.playlists.length), 0);

  assert.deepEqual(errors, [], "no page errors");
  console.log(JSON.stringify({ chapters: 3, watched: 3, tags: ["Archive"], errors }, null, 2));
} finally {
  await browser.close();
}
