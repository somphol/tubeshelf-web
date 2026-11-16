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

  await page.setViewport({ width: 1240, height: 800 });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await page.click("#demo");
  await wait(700);

  const presentButton = async () => {
    const buttons = await page.$$(".content-head .button");
    for (const button of buttons) {
      if ((await button.evaluate((node) => node.textContent)) === "Present") return button;
    }
    return null;
  };
  const counter = () => page.$eval(".deck-top .right", (node) => node.textContent);
  const deckOpen = () => page.$eval("#deck", (node) => !node.hidden);

  const firstID = await page.$eval(".card", (node) => node.dataset.youtubeId);
  const isFavorite = () => page.evaluate((id) =>
    window.__tubeshelfTest.state.store.videos.find((video) => video.youtubeID === id).isFavorite, firstID);
  await page.hover(".card");
  await page.click(".card .thumb-favorite");
  await wait(200);
  assert.equal(await isFavorite(), false, "hover star removes a favorite");
  await page.hover(".card");
  await page.click(".card .thumb-favorite");
  await wait(200);
  assert.equal(await isFavorite(), true, "hover star adds a favorite");

  await page.click(".card");
  await wait(400);
  assert.equal(await deckOpen(), true, "left-clicking a card opens the slide");
  assert.equal(await counter(), "1 / 7✕", "the clicked card starts the deck");
  await page.keyboard.press("Escape");
  await wait(200);

  await page.click(".card", { button: "right" });
  await wait(250);
  assert.equal(await page.$eval("#context-menu", (node) => node.hidden), false, "right-click opens the menu");
  const menu = await page.$$eval("#context-menu button", (nodes) => nodes.map((node) => node.textContent));
  assert.ok(menu.includes("Edit categories and notes…"), "the menu offers category editing");
  await page.evaluate(() => {
    [...document.querySelectorAll("#context-menu button")]
      .find((node) => node.textContent === "Edit categories and notes…")
      .click();
  });
  await page.waitForSelector("#editor-modal:not([hidden])", { timeout: 5000 });
  await page.click("#editor-close");
  await wait(200);

  const headPresent = await presentButton();
  assert.ok(headPresent, "header Present button exists");
  await headPresent.click();
  await wait(400);
  assert.equal(await deckOpen(), true, "deck opens");
  assert.equal(await counter(), "1 / 7✕", "deck starts at the first slide");
  assert.equal(await page.$$eval(".filmstrip button", (nodes) => nodes.length), 7, "filmstrip lists all slides");
  assert.ok(await page.$(".deck-media img"), "slide artwork is present");
  assert.ok((await page.$eval(".deck-title", (node) => node.textContent)).length > 0, "slide title is present");

  await page.keyboard.press("ArrowRight");
  await wait(200);
  assert.equal(await counter(), "2 / 7✕", "arrow right advances");

  await page.keyboard.press("End");
  await wait(200);
  assert.equal(await counter(), "7 / 7✕", "End jumps to the last slide");
  assert.equal(
    await page.$eval(".deck-controls button:last-of-type", (node) => node.disabled),
    true,
    "Next is disabled on the last slide"
  );

  await page.keyboard.press("Home");
  await wait(200);
  assert.equal(await counter(), "1 / 7✕", "Home returns to the first slide");

  await page.keyboard.press("ArrowLeft");
  await wait(200);
  assert.equal(await counter(), "1 / 7✕", "arrow left stops at the first slide");

  await page.mouse.move(600, 400);
  await page.mouse.wheel({ deltaY: 240 });
  await wait(500);
  assert.equal(await counter(), "2 / 7✕", "wheel advances one slide");

  await page.keyboard.press("Escape");
  await wait(200);
  assert.equal(await deckOpen(), false, "Escape closes the deck");

  const cardPresent = await page.$$eval(".card", (cards) => {
    const third = cards[2];
    const button = [...third.querySelectorAll("button")].find((node) => node.textContent === "Present");
    if (!button) return false;
    button.click();
    return true;
  });
  assert.equal(cardPresent, true, "card Present button exists");
  await wait(400);
  assert.equal(await counter(), "3 / 7✕", "card Present starts from that video");

  await page.click(".deck-top .pill");
  await wait(200);
  assert.equal(await deckOpen(), false, "back to shelf closes the deck");

  await page.setViewport({ width: 390, height: 844 });
  const headPresentMobile = await presentButton();
  await headPresentMobile.click();
  await wait(400);
  const layout = await page.evaluate(() => {
    const body = document.querySelector(".deck-body");
    const info = document.querySelector(".deck-info");
    const rect = info.getBoundingClientRect();
    return {
      direction: getComputedStyle(body).flexDirection,
      left: rect.left,
      right: rect.right,
      width: window.innerWidth,
      navVisible: getComputedStyle(document.querySelector(".deck-nav")).display !== "none",
    };
  });
  assert.equal(layout.direction, "column", "deck stacks on a narrow screen");
  assert.ok(layout.left >= 0 && layout.right <= layout.width, "deck info fits the viewport");
  assert.equal(layout.navVisible, false, "arrow buttons hide on a narrow screen");
  await page.keyboard.press("Escape");
  await wait(200);
  assert.equal(await deckOpen(), false, "Escape closes the mobile deck");

  assert.deepEqual(errors, [], "no console or page errors");
  console.log(JSON.stringify({ slides: 7, layout, errors }, null, 2));
} finally {
  await browser.close();
}
