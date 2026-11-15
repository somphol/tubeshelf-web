import test from "node:test";
import assert from "node:assert/strict";
import { suggestTags, guestName, formatTags } from "../src/tagger.js";
import { TAXONOMY } from "../src/taxonomy.js";

test("taxonomy carries every built-in category", () => {
  assert.equal(TAXONOMY.categories.length, 31);
  assert.ok(TAXONOMY.categories.some((category) => category.name === "Math"));
  assert.ok(TAXONOMY.aliases["ai"]);
});

test("the Marc Andreessen episode suggests AI, podcasts and the guest", () => {
  const result = suggestTags({
    title: "Marc Andreessen: The real AI boom hasn’t even started yet",
    channel: "Lenny's Podcast",
  });
  assert.ok(result.tags.includes("AI & Machine Learning"), result.tags);
  assert.ok(result.tags.includes("Talks & Podcasts"), result.tags);
  assert.ok(result.tags.includes("Marc Andreessen"), result.tags);
  assert.equal(result.tags.at(-1), "Marc Andreessen");
});

test("a numbered episode extracts the guest from its suffix", () => {
  const result = suggestTags({
    title: "Joe Rogan Experience #2501 - Marc Andreessen",
    channel: "PowerfulJRE",
    knownCategories: ["Joe Rogan"],
  });
  assert.ok(result.tags.includes("Talks & Podcasts"), result.tags);
  assert.ok(result.tags.includes("Marc Andreessen"), result.tags);
  assert.ok(result.tags.includes("Joe Rogan"), result.tags);
});

test("honorifics and credentials are dropped, stage names survive", () => {
  assert.equal(guestName("Dr. Marc Andreessen: The boom", "Lenny's Podcast"), "Marc Andreessen");
  assert.equal(guestName("Prof. Dr. Sarah Drasner: CSS", "Conference"), "Sarah Drasner");
  assert.equal(guestName("Marc Andreessen, PhD: The boom", "Lenny's Podcast"), "Marc Andreessen");
  assert.equal(guestName("Dr. Dre: The recipe", "Beats"), "Dr. Dre");
  assert.equal(guestName("Luis Fonsi - Despacito ft. Daddy Yankee", "LuisFonsiVEVO"), "Daddy Yankee");
  assert.equal(guestName("Interview with Sam Altman", "Talks at Google"), "Sam Altman");
});

test("hosts and show names are not guests", () => {
  assert.equal(guestName("Huberman Lab: How to sleep", "Huberman Lab"), null);
  assert.equal(guestName("The Daily: A new election", "The New York Times"), null);
  assert.equal(guestName("How to Build a Startup", "Y Combinator"), null);
});

test("a tutorial is not a podcast", () => {
  assert.deepEqual(formatTags("Build a server with Sarah Drasner", "Conference"), []);
  assert.deepEqual(formatTags("The future of agents", "Lenny's Podcast"), ["Talks & Podcasts"]);
});

test("the keyword floor stays quiet without an anchor", () => {
  const result = suggestTags({
    title: "Untitled conversation",
    channel: "Some Channel",
  });
  assert.deepEqual(result.tags, []);
});

test("user categories are matched by name", () => {
  const result = suggestTags({
    title: "Rust for Swift developers",
    channel: "Conference",
    knownCategories: ["Swift Notes"],
  });
  assert.ok(result.tags.includes("Programming"), result.tags);
});
