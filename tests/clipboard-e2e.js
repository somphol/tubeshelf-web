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
      value: { readText: async () => "https://youtu.be/kJQP7kiw5Fk?si=clipboard" },
    });
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (String(input).includes("youtube.com/oembed")) {
        return new Response(
          JSON.stringify({ title: "Clipboard video", author_name: "Clipboard channel" }),
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

  const filled = await page.$eval('#add-body input[type="url"]', (node) => node.value);
  assert.ok(filled.includes("kJQP7kiw5Fk"), "the clipboard URL fills the field");
  assert.equal(
    await page.$eval('#add-body input[placeholder="Title"]', (node) => node.value),
    "Clipboard video",
    "details resolve automatically"
  );
  assert.equal(
    await page.$eval('#add-body input[placeholder="Channel"]', (node) => node.value),
    "Clipboard channel"
  );

  await page.type('#add-body input[list="add-category-list"]', "Archive");
  await page.evaluate(() => {
    [...document.querySelectorAll("#add-body .modal-actions button")]
      .find((node) => node.textContent === "Add to shelf")
      .click();
  });
  await wait(500);
  assert.equal(await page.$eval("#add-modal", (node) => node.hidden), true, "the video is added");
  assert.equal(await page.$$eval(".card", (nodes) => nodes.length), 8);
  const tags = await page.$$eval(".card", (cards) => {
    const card = cards.find((node) => node.querySelector(".card-title")?.textContent === "Clipboard video");
    return card ? [...card.querySelectorAll(".chip")].map((node) => node.textContent) : null;
  });
  assert.ok(tags?.includes("Archive"), "the uncommitted category is used");
  assert.deepEqual(dialogs, [], "no empty-category warning");

  assert.deepEqual(errors, [], "no page errors");
  console.log(JSON.stringify({ filled, tags, dialogs, errors }, null, 2));
} finally {
  await browser.close();
}
