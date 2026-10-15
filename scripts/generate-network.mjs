import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SETTINGS = Object.freeze({
  seed: 0x12f00d,
  width: 1440,
  height: 1000,
  neighboursPerNode: 2,
  curvedEdgeRatio: 0.1,
});

const CLUSTERS = Object.freeze([
  { cx: 720, cy: 520, rx: 340, ry: 280, count: 11 },
  { cx: 330, cy: 180, rx: 300, ry: 200, count: 6 },
  { cx: 1140, cy: 400, rx: 320, ry: 220, count: 7 },
  { cx: 370, cy: 840, rx: 300, ry: 220, count: 5 },
  { cx: 1510, cy: 720, rx: 250, ry: 260, count: 3 },
]);

function mulberry32(seed) {
  return function random() {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

const random = mulberry32(SETTINGS.seed);

function rounded(value) {
  return Math.round(value * 10) / 10;
}

function distanceSquared(left, right) {
  const x = left.x - right.x;
  const y = left.y - right.y;
  return x * x + y * y;
}

const nodes = [];

CLUSTERS.forEach((cluster, clusterIndex) => {
  for (let index = 0; index < cluster.count; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random());
    const depth = random();

    nodes.push({
      id: nodes.length,
      cluster: clusterIndex,
      x: rounded(cluster.cx + Math.cos(angle) * cluster.rx * radius),
      y: rounded(cluster.cy + Math.sin(angle) * cluster.ry * radius),
      radius: rounded(0.8 + Math.pow(random(), 2.6) * 3.2),
      opacity: rounded(0.42 + depth * 0.5),
      depth,
      hub: false,
    });
  }
});

// One prominent hub and two medium anchors echo the reference image.
nodes[4].radius = 8.4;
nodes[4].opacity = 1;
nodes[4].depth = 1;
nodes[4].hub = true;

[
  { index: 1, radius: 4.8 },
  { index: 20, radius: 4.5 },
].forEach(({ index, radius }) => {
  nodes[index].radius = radius;
  nodes[index].opacity = 0.95;
  nodes[index].depth = 0.9;
});

const edgeKeys = new Set();
const edges = [];

function addEdge(left, right) {
  if (left === right) return;
  const [start, end] = left < right ? [left, right] : [right, left];
  const key = `${start}:${end}`;
  if (edgeKeys.has(key)) return;

  edgeKeys.add(key);
  edges.push({ start, end });
}

nodes.forEach((node) => {
  nodes
    .filter((candidate) => candidate.cluster === node.cluster && candidate.id !== node.id)
    .sort((left, right) => distanceSquared(node, left) - distanceSquared(node, right))
    .slice(0, SETTINGS.neighboursPerNode)
    .forEach((candidate) => addEdge(node.id, candidate.id));
});

// A few spokes from the main hub bind the satellites into one radial mesh.
CLUSTERS.forEach((cluster, clusterIndex) => {
  if (clusterIndex === nodes[4].cluster) return;

  const nearestInCluster = nodes
    .filter((node) => node.cluster === clusterIndex)
    .sort((left, right) => distanceSquared(nodes[4], left) - distanceSquared(nodes[4], right))[0];

  addEdge(4, nearestInCluster.id);
});

// Join any disconnected local clusters by repeatedly adding the shortest bridge.
const parent = nodes.map((node) => node.id);

function find(value) {
  if (parent[value] !== value) parent[value] = find(parent[value]);
  return parent[value];
}

function union(left, right) {
  const leftRoot = find(left);
  const rightRoot = find(right);
  if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
}

edges.forEach(({ start, end }) => union(start, end));

while (new Set(nodes.map((node) => find(node.id))).size > 1) {
  let closest = null;

  nodes.forEach((left) => {
    nodes.forEach((right) => {
      if (left.id >= right.id || find(left.id) === find(right.id)) return;
      const distance = distanceSquared(left, right);
      if (!closest || distance < closest.distance) {
        closest = { start: left.id, end: right.id, distance };
      }
    });
  });

  addEdge(closest.start, closest.end);
  union(closest.start, closest.end);
}

const edgeMarkup = edges.map(({ start, end }) => {
  const left = nodes[start];
  const right = nodes[end];
  const distance = Math.sqrt(distanceSquared(left, right));
  const averageDepth = (left.depth + right.depth) / 2;
  const opacity = rounded(0.28 + averageDepth * 0.34);
  const width = averageDepth > 0.72 ? 1.02 : averageDepth > 0.42 ? 0.82 : 0.62;
  const curved = random() < SETTINGS.curvedEdgeRatio && distance < 300;

  if (!curved) {
    return `    <path d="M${left.x} ${left.y} L${right.x} ${right.y}" stroke-width="${width}" stroke-opacity="${opacity}"/>`;
  }

  const middleX = (left.x + right.x) / 2;
  const middleY = (left.y + right.y) / 2;
  const perpendicularX = -(right.y - left.y) / distance;
  const perpendicularY = (right.x - left.x) / distance;
  const bend = Math.min(24, distance * (0.06 + random() * 0.07)) * (random() < 0.5 ? -1 : 1);
  const controlX = rounded(middleX + perpendicularX * bend);
  const controlY = rounded(middleY + perpendicularY * bend);

  return `    <path d="M${left.x} ${left.y} Q${controlX} ${controlY} ${right.x} ${right.y}" stroke-width="${width}" stroke-opacity="${opacity}"/>`;
}).join("\n");

const nodeMarkup = nodes
  .map((node) => `    <circle cx="${node.x}" cy="${node.y}" r="${node.radius}" fill-opacity="${node.opacity}"/>`)
  .join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SETTINGS.width} ${SETTINGS.height}">
  <!-- Generated deterministically by scripts/generate-network.mjs. -->
  <g fill="none" stroke="black" stroke-linecap="round" stroke-linejoin="round">
${edgeMarkup}
  </g>
  <g fill="black">
${nodeMarkup}
  </g>
</svg>
`;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDirectory, "..", "network-mask.svg");

await writeFile(outputPath, svg, "utf8");
console.log(`Generated ${nodes.length} nodes and ${edges.length} edges in ${outputPath}`);
