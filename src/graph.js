// Pure category graph for the optional 3D view: nodes are categories, links are
// shared videos. No DOM, no Three.js.
import { TAXONOMY } from "./taxonomy.js";

const PALETTE = [
  "#8b7bf0", "#e5484d", "#4d8bf0", "#2fb3b3",
  "#4db86a", "#e68c3f", "#e0609a",
];

function groupKey(name) {
  const category = TAXONOMY.categories.find(
    (entry) => entry.name.toLowerCase() === String(name).toLowerCase()
  );
  if (category?.parent) return category.parent;
  if (category) return category.name;
  return "Other";
}

function colorFor(key) {
  let sum = 0;
  for (const char of key) sum += char.codePointAt(0);
  return PALETTE[sum % PALETTE.length];
}

/**
 * @param {Array} videos normalised videos (tags arrays)
 * @param {Array} playlists normalised playlists (tags arrays), counts only
 * @returns {{nodes: Array, links: Array, hiddenCount: number}}
 */
export function buildGraph(videos, playlists = [], maxLinksPerNode = 4) {
  const counts = new Map();
  const spelling = new Map();
  const add = (name) => {
    const key = String(name).toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!spelling.has(key)) spelling.set(key, name);
  };
  for (const video of videos) for (const tag of video.tags || []) add(tag);
  for (const playlist of playlists) for (const tag of playlist.tags || []) add(tag);

  const tally = new Map();
  for (const video of videos) {
    const tags = [...new Set((video.tags || []).map((tag) => String(tag).toLowerCase()))]
      .filter((tag) => counts.has(tag))
      .sort();
    for (let i = 0; i < tags.length; i += 1) {
      for (let j = i + 1; j < tags.length; j += 1) {
        const pair = `${tags[i]}|${tags[j]}`;
        tally.set(pair, (tally.get(pair) || 0) + 1);
      }
    }
  }

  let links = [...tally.entries()].map(([pair, shared]) => {
    const [source, target] = pair.split("|");
    return { source, target, shared };
  });
  links.sort((a, b) => (a.shared === b.shared
    ? `${a.source}|${a.target}`.localeCompare(`${b.source}|${b.target}`)
    : b.shared - a.shared));

  const degree = new Map();
  const kept = [];
  for (const link of links) {
    if ((degree.get(link.source) || 0) >= maxLinksPerNode) continue;
    if ((degree.get(link.target) || 0) >= maxLinksPerNode) continue;
    kept.push(link);
    degree.set(link.source, (degree.get(link.source) || 0) + 1);
    degree.set(link.target, (degree.get(link.target) || 0) + 1);
  }
  links = kept;

  const linked = new Set(links.flatMap((link) => [link.source, link.target]));
  const nodes = [...counts.entries()]
    .filter(([id]) => linked.has(id))
    .map(([id, count]) => {
      const name = spelling.get(id) || id;
      const group = groupKey(name);
      return {
        id,
        name,
        count,
        group,
        // User categories all share "Other"; give each its own stable hue so the
        // graph is not a single teal cloud.
        color: colorFor(group === "Other" ? name : group),
        val: 0.8 + Math.sqrt(count) * 0.6,
      };
    })
    .sort((a, b) => (b.count === a.count ? a.name.localeCompare(b.name) : b.count - a.count));

  return {
    nodes,
    links: links.map((link) => ({ ...link, value: link.shared })),
    hiddenCount: counts.size - nodes.length,
  };
}
