import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:8770/?test=1";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  await page.evaluateOnNewDocument(() => {
    window.YT = {
      Player: class {
        constructor(element, options) {
          this.options = options;
          this.ids = ["aaaaaaaaaaa", "bbbbbbbbbbb"];
          setTimeout(() => options.events?.onReady?.({ target: this }), 30);
        }
        cuePlaylist() {}
        getPlaylist() { return this.ids; }
        destroy() {}
      },
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = String(input);
      if (!url.includes("youtube.com/oembed")) return realFetch(input, init);
      const target = decodeURIComponent((url.match(/[?&]url=([^&]+)/) || [])[1] || "");
      let title = "";
      if (target.includes("playlist?list=")) title = "Fake Course";
      else if (target.includes("v=aaaaaaaaaaa")) title = "Fake Chapter A";
      else if (target.includes("v=bbbbbbbbbbb")) title = "Fake Chapter B";
      if (!title) return new Response("{}", { status: 404 });
      return new Response(
        JSON.stringify({ title, author_name: "Fake Channel" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };
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
  await page.evaluate(() => {
    [...document.querySelectorAll(".content-head button")]
      .find((node) => node.textContent === "Add playlist")
      .click();
  });
  await page.waitForSelector("#playlist-modal:not([hidden])", { timeout: 5000 });
  await page.type('#playlist-body input[type="url"]', "https://www.youtube.com/playlist?list=PLfake123456");
  await page.evaluate(() => {
    [...document.querySelectorAll("#playlist-body button")]
      .find((node) => node.textContent === "Fetch playlist")
      .click();
  });
  await page.waitForSelector(".playlist-result", { timeout: 8000 });
  assert.match(await page.$eval(".playlist-result", (node) => node.textContent), /Fake Course/);
  assert.match(await page.$eval(".playlist-result", (node) => node.textContent), /2 chapters/);

  await page.evaluate(() => {
    [...document.querySelectorAll(".playlist-result button")]
      .find((node) => node.textContent === "Add to catalog")
      .click();
  });
  await wait(500);
  assert.equal(await page.$eval("#playlist-modal", (node) => node.hidden), true);
  assert.equal(await page.evaluate(() => window.__tubeshelfTest.state.store.playlists.length), 2);
  assert.equal(await page.$eval("#course h2", (node) => node.textContent), "Fake Course");
  assert.equal(await page.$$eval(".course-row", (nodes) => nodes.length), 2);

  assert.deepEqual(errors, [], "no page errors");
  console.log(JSON.stringify({ imported: "Fake Course", chapters: 2, errors }, null, 2));
} finally {
  await browser.close();
}
