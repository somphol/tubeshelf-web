import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { WEB_VERSION } from "../src/version.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("the web version matches package.json, the header fallback and the icon", () => {
  const pkg = JSON.parse(read("../package.json"));
  assert.equal(WEB_VERSION, pkg.version);
  const html = read("../index.html");
  assert.match(html, new RegExp(`id="version"[^>]*>v${WEB_VERSION.replaceAll(".", "\\.")}<`));
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="icon\.svg">/);
  assert.match(html, /img-src 'self' https:\/\/i\.ytimg\.com data:/);
  assert.ok(fs.existsSync(new URL("../icon.svg", import.meta.url)));
});
