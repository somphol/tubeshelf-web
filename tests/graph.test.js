import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../src/graph.js";

test("builds weighted links and counts videos plus courses", () => {
  const videos = [
    { tags: ["Math", "Linear Algebra"], channel: "3b1b" },
    { tags: ["Math", "Linear Algebra"], channel: "3b1b" },
    { tags: ["Math"], channel: "other" },
  ];
  const playlists = [{ tags: ["Math"] }];
  const graph = buildGraph(videos, playlists);
  assert.equal(graph.nodes.length, 2);
  const math = graph.nodes.find((node) => node.name === "Math");
  assert.equal(math.count, 4, "three videos + one course");
  assert.equal(graph.links.length, 1);
  assert.equal(graph.links[0].value, 2);
});

test("hides unlinked categories and reports how many", () => {
  const graph = buildGraph(
    [{ tags: ["Math", "Linear Algebra"] }, { tags: ["Cooking"] }],
    []
  );
  assert.deepEqual(graph.nodes.map((node) => node.name).sort(), ["Linear Algebra", "Math"]);
  assert.equal(graph.hiddenCount, 1);
});

test("caps each node's degree, strongest links first", () => {
  const videos = [
    ...Array.from({ length: 4 }, () => ({ tags: ["A", "B"] })),
    ...Array.from({ length: 3 }, () => ({ tags: ["A", "C"] })),
    ...Array.from({ length: 2 }, () => ({ tags: ["A", "D"] })),
    { tags: ["A", "E"] },
  ];
  const graph = buildGraph(videos, [], 1);
  assert.equal(graph.links.length, 1);
  assert.equal(graph.links[0].source, "a");
  assert.equal(graph.links[0].target, "b");
});

test("groups and colours are stable and size reflects counts", () => {
  const graph = buildGraph(
    [
      ...Array.from({ length: 5 }, () => ({ tags: ["Trigonometry", "Math"] })),
      ...Array.from({ length: 1 }, () => ({ tags: ["Design", "Math"] })),
    ],
    []
  );
  const trig = graph.nodes.find((node) => node.name === "Trigonometry");
  const design = graph.nodes.find((node) => node.name === "Design");
  assert.equal(trig.group, "Math");
  assert.ok(trig.val > design.val);
  assert.match(trig.color, /^#[0-9a-f]{6}$/i);
  assert.equal(trig.color, graph.nodes.find((node) => node.name === "Math").color);
});

test("an empty shelf produces an empty graph", () => {
  assert.deepEqual(buildGraph([], []), { nodes: [], links: [], hiddenCount: 0 });
});
