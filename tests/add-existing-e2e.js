import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:8770/?test=1";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
try {
  const page = await browser.newPage();
  const errors = [];
  const dialogs = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" && !/404|Failed to load resource/.test(message.text())) {
      errors.push(message.text());
    }
  });

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: async () => "https://youtu.be/dQw4w9WgXcQ" },
    });
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (String(input).includes("youtube.com/oembed")) {
        return new Response(
          JSON.stringify({
            title: "Rick Astley – Never Gonna Give You Up",
            author_name: "Rick Astley",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return realFetch(input, init);
    };
  });

  await page.setViewport({ width: 1240, height: 800 });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await page.click("#demo");
  await wait(700);
  await page.click("#add");
  await page.waitForSelector("#add-modal:not([hidden])", { timeout: 5000 });
  await wait(800);

  assert.equal(
    await page.$eval(".duplicate-box", (node) => node.hidden),
    false,
    "duplicate panel appears"
  );
  assert.equal(
    await page.$eval("#add-body .modal-actions .button.primary", (node) => node.textContent),
    "Update categories"
  );
  assert.ok(
    await page.$$eval("#add-body .tag-chip", (nodes) => nodes.some((node) => node.textContent.includes("Music"))),
    "existing categories are loaded"
  );

  await page.evaluate(() => {
    const chip = [...document.querySelectorAll("#add-body .tag-chip")]
      .find((node) => node.textContent.includes("Music"));
    chip.querySelector("button").click();
  });
  await page.type('#add-body input[list="add-category-list"]', "Archive");
  await page.evaluate(() => {
    document.querySelector("#add-body .modal-actions .button.primary").click();
  });
  await wait(500);

  assert.equal(await page.$eval("#add-modal", (node) => node.hidden), true);
  assert.deepEqual(
    await page.evaluate(() => window.__tubeshelfTest.state.store.videos
      .find((video) => video.youtubeID === "dQw4w9WgXcQ").tags),
    ["Archive"]
  );
  assert.equal(await page.$$eval(".card", (nodes) => nodes.length), 7);
  assert.equal(
    await page.$eval('.card[data-youtube-id="dQw4w9WgXcQ"]', (node) => node.classList.contains("card-flash")),
    true,
    "the updated card is highlighted"
  );

  await page.click("#add");
  await page.waitForSelector("#add-modal:not([hidden])", { timeout: 5000 });
  await wait(800);
  await page.evaluate(() => {
    [...document.querySelectorAll(".duplicate-box .button")]
      .find((node) => node.textContent === "Show existing card")
      .click();
  });
  await wait(400);
  assert.equal(await page.$eval("#add-modal", (node) => node.hidden), true);
  assert.ok(await page.$('.card[data-youtube-id="dQw4w9WgXcQ"]'));
  assert.deepEqual(dialogs, [], "no dialogs");
  assert.deepEqual(errors, [], "no page errors");
  console.log(JSON.stringify({ tags: ["Archive"], dialogs, errors }, null, 2));
} finally {
  await browser.close();
}
