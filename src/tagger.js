// Deterministic tag suggestions ported from the Mac app: category scoring,
// guest-name extraction and the podcast format rule. No network, no model.
import { TAXONOMY } from "./taxonomy.js";

const TAXONOMY_NAMES = new Set(TAXONOMY.categories.map((category) => category.name.toLowerCase()));

export function fold(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokens(text) {
  return fold(text).split(" ").filter(Boolean);
}

function stem(word) {
  if (word.length < 5) return word;
  if (word.endsWith("ies") && word.length > 5) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ss")) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function contains(keyword, text) {
  const needle = tokens(keyword).map(stem);
  const haystack = tokens(text).map(stem);
  if (!needle.length || needle.length > haystack.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    if (needle.every((word, j) => word === haystack[i + j])) return true;
  }
  return false;
}

function categoryCandidates(knownCategories) {
  const candidates = TAXONOMY.categories.map((category) => ({
    name: category.name,
    keywords: category.keywords,
    weakKeywords: category.weakKeywords,
    parent: category.parent || null,
  }));
  const seen = new Set(candidates.map((category) => category.name.toLowerCase()));
  for (const raw of knownCategories) {
    const name = String(raw).trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key) || TAXONOMY_NAMES.has(key)) continue;
    seen.add(key);
    candidates.push({ name, keywords: [name], weakKeywords: [], parent: null });
  }
  return candidates;
}

function categoryTags(title, channel, body, knownCategories, limit = 3) {
  const scored = [];
  for (const category of categoryCandidates(knownCategories)) {
    let strongTitle = 0;
    let strongChannel = 0;
    let strongBody = 0;
    for (const keyword of category.keywords) {
      if (contains(keyword, title)) strongTitle += 1;
      if (contains(keyword, channel)) strongChannel += 1;
      if (contains(keyword, body)) strongBody += 1;
    }
    let weakTitle = 0;
    let weakChannel = 0;
    let weakBody = 0;
    for (const keyword of category.weakKeywords) {
      if (contains(keyword, title)) weakTitle += 1;
      else if (contains(keyword, channel)) weakChannel += 1;
      else if (contains(keyword, body)) weakBody += 1;
    }
    const score =
      4 * Math.min(strongTitle, 2) +
      2 * Math.min(strongChannel, 1) +
      2 * Math.min(strongBody, 2) +
      Math.min(weakTitle, 2) +
      Math.min(weakChannel, 1) +
      Math.min(weakBody, 1);
    const anchored = strongTitle > 0 || strongChannel > 0 || weakTitle > 0;
    if (score >= 4 && anchored) scored.push({ name: category.name, score, parent: category.parent });
  }
  scored.sort((a, b) => (a.score === b.score ? a.name.localeCompare(b.name) : b.score - a.score));
  if (!scored.length) return [];
  const floor = Math.ceil(scored[0].score * 0.6);
  const chosen = scored.filter((entry) => entry.score >= floor).slice(0, Math.max(1, Math.min(limit, 3)));
  const names = chosen.map((entry) => entry.name);
  for (const entry of chosen) {
    if (entry.parent && !names.some((name) => name.toLowerCase() === entry.parent.toLowerCase())) {
      names.push(entry.parent);
    }
  }
  return names;
}

// MARK: - Guest names

const HONORIFICS = new Set([
  "dr", "mr", "mrs", "ms", "mx", "prof", "professor", "sir", "dame", "lord", "lady",
  "rev", "reverend", "hon", "honorable", "judge", "justice", "capt", "captain",
  "col", "colonel", "gen", "general", "sen", "senator", "rep", "representative",
  "gov", "governor", "mayor",
]);

const CREDENTIALS = new Set(["phd", "md", "mba", "jd", "esq", "cpa", "rn", "dds", "dvm", "mph", "jr", "sr", "ii", "iii", "iv"]);

const BLOCKED = new Set([
  "the", "a", "an", "this", "that", "these", "those", "how", "why", "what", "when",
  "where", "who", "which", "new", "best", "top", "part", "episode", "ep", "vol",
  "volume", "podcast", "show", "interview", "conversation", "talk", "talks", "full",
  "live", "official", "trailer", "clip", "highlights", "machine", "learning",
  "artificial", "intelligence", "deep", "language", "model", "models", "ai", "ml",
  "llm", "llms", "day", "days", "year", "years", "world", "science", "history",
  "business", "money", "health", "news", "explained", "guide", "course", "tutorial",
  "review", "react", "reaction",
]);

function coreWord(word) {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase();
}

function strippedTitles(raw) {
  let words = raw.trim().split(/\s+/).filter(Boolean);
  while (words.length && HONORIFICS.has(coreWord(words[0]))) words.shift();
  while (words.length && CREDENTIALS.has(coreWord(words[words.length - 1]))) words.pop();
  return words.join(" ");
}

function validateName(raw) {
  const trimmed = String(raw).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").trim();
  if (!trimmed || trimmed.length > 40) return null;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return null;
  for (const word of words) {
    const core = word.replace(/^[^\p{L}\p{N}.]+|[^\p{L}\p{N}.]+$/gu, "");
    if (!core) return null;
    if (!/^[\p{Lu}][\p{L}.'-]*$/u.test(core)) return null;
    if (!/\p{Ll}/u.test(core) && !(core.length === 1 && word.endsWith("."))) return null;
    if (BLOCKED.has(coreWord(core))) return null;
  }
  return words.join(" ");
}

function normalizeName(value) {
  return fold(value).replace(/\s+/g, " ").trim();
}

function overlapsChannel(name, channel) {
  const channelKey = normalizeName(channel);
  if (!channelKey) return false;
  const nameKey = normalizeName(name);
  if (!nameKey) return true;
  if (channelKey.includes(nameKey) || nameKey.includes(channelKey)) return true;
  const nameTokens = new Set(nameKey.split(" "));
  const channelTokens = new Set(channelKey.split(" "));
  return nameTokens.size > 0 && [...nameTokens].every((word) => channelTokens.has(word));
}

function captures(pattern, text, group = 1) {
  const regex = new RegExp(pattern, "gu");
  const out = [];
  let match;
  while ((match = regex.exec(text)) !== null) out.push(match[group]);
  return out;
}

export function guestName(title, channel = "", note = "") {
  const candidates = [];
  const colon = title.indexOf(":");
  if (colon > 0) candidates.push(title.slice(0, colon));
  const pipe = title.indexOf(" | ");
  if (pipe > 0) {
    candidates.push(title.slice(0, pipe));
    candidates.push(title.slice(pipe + 3));
  }
  // "Show #2501 - Marc Andreessen" (no colon, no description).
  const episode = title.match(/#\s*\d{1,5}\s*[-–—]\s*([\p{Lu}][\p{L}.'-]*(?:\s+[\p{Lu}][\p{L}.'-]*){1,3})/u);
  if (episode) candidates.push(episode[1]);
  candidates.push(
    ...captures(
      String.raw`\b(?:with|ft\.?|feat\.?|featuring)\s+([\p{Lu}][\p{L}.'-]*(?:\s+[\p{Lu}][\p{L}.'-]*){1,3})`,
      title
    )
  );
  candidates.push(
    ...captures(
      String.raw`\bguest:?\s+([\p{Lu}][\p{L}.'-]*(?:\s+[\p{Lu}][\p{L}.'-]*){1,3})`,
      title
    )
  );
  candidates.push(
    ...captures(
      String.raw`\b(?:[Ii]n conversation with|[Jj]oined by|[Ss]its down with)\s+([\p{Lu}][\p{L}.'-]*(?:\s+[\p{Lu}][\p{L}.'-]*){1,3})`,
      note
    )
  );
  candidates.push(
    ...captures(
      String.raw`^\s*([\p{Lu}][\p{L}.'-]*(?:\s+[\p{Lu}][\p{L}.'-]*){1,3})\s+(?:is|joins|returns|talks|discusses)\b`,
      note
    )
  );

  for (const candidate of candidates) {
    for (const variant of [strippedTitles(candidate), candidate]) {
      const name = validateName(variant);
      if (!name) continue;
      if (overlapsChannel(name, channel)) continue;
      return name;
    }
  }
  return null;
}

export function formatTags(title, channel = "", note = "", guest = null) {
  const headline = title.toLowerCase();
  const byline = channel.toLowerCase();
  const opening = note.slice(0, 700).toLowerCase();
  if (headline.includes("podcast") || byline.includes("podcast") || opening.includes("podcast")) {
    return ["Talks & Podcasts"];
  }
  if (!guest) return [];
  if (/(?:#\s*\d{1,5}\b|\b(?:ep|episode|part)\.?\s*\d{1,4}\b)/.test(headline)) {
    return ["Talks & Podcasts"];
  }
  const markers = ["% off", "promo code", "sponsor", "sponsored by", "timestamps", "subscribe", "apple podcasts", "spotify", "patreon", "guest"];
  const hits = markers.filter((marker) => opening.includes(marker)).length;
  return hits >= 2 ? ["Talks & Podcasts"] : [];
}

export function suggestTags({ title, channel = "", note = "", knownCategories = [] }) {
  const body = note;
  const base = categoryTags(title, channel, body, knownCategories);
  const guest = guestName(title, channel, note);
  const extras = [];
  for (const tag of formatTags(title, channel, note, guest)) {
    if (!base.some((name) => name.toLowerCase() === tag.toLowerCase())) extras.push(tag);
  }
  if (guest && !base.some((name) => name.toLowerCase() === guest.toLowerCase())) extras.push(guest);
  const tags = [...base, ...extras];
  return {
    tags,
    source: "keyword",
    note: tags.length ? "" : "No confident match",
  };
}
