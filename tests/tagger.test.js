import test from "node:test";
import assert from "node:assert/strict";
import {
  suggestTags,
  guestName,
  formatTags,
  buildCategoryProfiles,
  channelAffinity,
} from "../src/tagger.js";
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
  assert.ok(result.tags.includes("AI & Machine Learning"), JSON.stringify(result.tags));
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


test("learned profiles make the person's own categories fire", () => {
  const videos = [
    { title: "Why Chasing Happiness is Pointless: psychology", channel: "Einzelgänger", tags: ["Self Help", "Psychology"] },
    { title: "Happiness and psychology", channel: "Psychplicit", tags: ["Self Help", "Psychology"] },
    { title: "Teach Yourself Anything So Well", channel: "Psycuro", tags: ["Learning"] },
    { title: "How LLMs Actually Work, Explained", channel: "Engineering", tags: ["Explainer", "AI & Machine Learning"] },
    { title: "How Attention Works, Explained", channel: "Engineering", tags: ["Explainer", "AI & Machine Learning"] },
    { title: "This Is Boring But It Makes You Scary Intelligent", channel: "Sandeep", tags: ["Self Help", "Learning"] },
  ];
  const profiles = buildCategoryProfiles(videos);
  assert.ok(profiles["self help"].includes("happiness") || profiles["self help"].includes("angry"), JSON.stringify(profiles["self help"]));
  assert.ok(profiles["explainer"].includes("explained"), JSON.stringify(profiles["explainer"]));

  const result = suggestTags({
    title: "Happiness and psychology",
    channel: "Some Channel",
    knownCategories: ["Self Help", "Psychology", "Learning", "Explainer"],
    profiles,
  });
  assert.ok(result.tags.includes("Self Help"), JSON.stringify(result.tags));
});

test("channel affinity fills an otherwise empty answer", () => {
  const videos = [
    { title: "Jev explained in 7min", channel: "Caleb Writes Code", tags: ["AI & Machine Learning", "LLM"] },
    { title: "Graph Engineering explained", channel: "Caleb Writes Code", tags: ["AI & Machine Learning", "LLM"] },
    { title: "Loop Engineering explained", channel: "Caleb Writes Code", tags: ["AI & Machine Learning", "Explainer"] },
    { title: "One more", channel: "Other", tags: ["Cooking"] },
  ];
  assert.equal(channelAffinity(videos, "Caleb Writes Code"), "AI & Machine Learning");

  const result = suggestTags({
    title: "Jev, part 7",
    channel: "Caleb Writes Code",
    knownCategories: ["AI & Machine Learning", "LLM", "Explainer"],
    channelHint: channelAffinity(videos, "Caleb Writes Code"),
  });
  assert.ok(result.tags.includes("AI & Machine Learning"), JSON.stringify(result.tags));
});
