// With one tree fixed, the optimiser must find the true minimum number of crossings.
// Checked against brute force over every rotation of the free tree (11 taxa = 1024 orders).
global.Tree = require("../src/core.js");
const Tangle = require("../src/tangle.js");
const T = Tangle._state;

let seed = 5;
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
function randomTree(names) {
  let nodes = names.map((n) => new Tree.TNode(n, 1));
  while (nodes.length > 1) {
    const a = nodes.splice(Math.floor(rnd() * nodes.length), 1)[0], b = nodes.splice(Math.floor(rnd() * nodes.length), 1)[0];
    const p = new Tree.TNode("", 1); p.add(a); p.add(b); nodes.push(p);
  }
  return { root: nodes[0], meta: {} };
}

let worse = 0;
const RUNS = 30;
for (let rep = 0; rep < RUNS; rep++) {
  const names = [...Array(11).keys()].map((i) => "S" + i);
  T.A = randomTree(names); T.B = randomTree(names); // unrelated trees: a hard case
  const ta = Tree.tips(T.A.root), tb = Tree.tips(T.B.root);
  T.links = [];
  for (const a of ta) for (const b of tb) if (a.name === b.name || rnd() < 0.03) T.links.push({ a, b }); // plus some extra many-to-many links
  const internal = Tree.nodes(T.B.root).filter((n) => !n.isTip);
  let best = Infinity;
  for (let m = 0; m < 1 << internal.length; m++) {
    internal.forEach((n, i) => { const bit = (m >> i) & 1; if (bit !== (n._flip || 0)) { n.children.reverse(); n._flip = bit; } });
    best = Math.min(best, Tangle.count());
  }
  const got = Tangle.untangle("B", { polish: false, restarts: 0 });
  if (got > best) { worse++; console.error(`run ${rep}: optimiser ${got}, true minimum ${best}`); }
}
console.log(`one-sided optimiser matched brute force in ${RUNS - worse} of ${RUNS} runs`);
if (worse) process.exitCode = 1;
