// Benchmark: crossings left by the tanglegram optimiser on random tree pairs.
// Tree B is tree A with random SPR moves (conflict) and some taxa duplicated (many-to-many links);
// both start with random branch orders. Compares the current method with the older
// barycentre + single-flip search.
global.Tree = require("../src/core.js");
const Tangle = require("../src/tangle.js");
const T = Tangle._state;

let seed = 1;
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
function randomTree(names) {
  let nodes = names.map((n) => new Tree.TNode(n, rnd()));
  while (nodes.length > 1) {
    const a = nodes.splice(Math.floor(rnd() * nodes.length), 1)[0], b = nodes.splice(Math.floor(rnd() * nodes.length), 1)[0];
    const p = new Tree.TNode("", rnd()); p.add(a); p.add(b); nodes.push(p);
  }
  return { root: nodes[0], meta: {} };
}
function spr(t) { // prune a random subtree and regraft it elsewhere
  const cand = Tree.nodes(t.root).filter((n) => n.parent);
  const s = cand[Math.floor(rnd() * cand.length)], p = s.parent;
  p.children.splice(p.children.indexOf(s), 1);
  if (p.children.length === 1) Tree.spliceUnary(t, p);
  const inside = new Set(Tree.nodes(s));
  const targets = Tree.nodes(t.root).filter((n) => !inside.has(n) && n.parent);
  if (!targets.length) return;
  const tg = targets[Math.floor(rnd() * targets.length)], gp = tg.parent, m = new Tree.TNode("", 0.1);
  gp.children[gp.children.indexOf(tg)] = m; m.parent = gp; m.add(tg); m.add(s);
}
function scenario(n, moves, dup) {
  const A = randomTree([...Array(n).keys()].map((i) => "S" + i)), B = Tree.clone(A);
  for (let i = 0; i < moves; i++) spr(B);
  for (const t of Tree.tips(B.root)) if (rnd() < dup) {
    const p = t.parent, m = new Tree.TNode("", 0.1);
    p.children[p.children.indexOf(t)] = m; m.parent = p; m.add(t); m.add(new Tree.TNode(t.name + "_2", 0.1));
  }
  for (const x of [A, B]) for (const nd of Tree.nodes(x.root)) if (rnd() < 0.5) nd.children.reverse();
  return [A, B];
}
function load(A, B) {
  T.A = Tree.clone(A); T.B = Tree.clone(B);
  const tb = Tree.tips(T.B.root);
  T.links = [];
  for (const a of Tree.tips(T.A.root)) for (const b of tb) if (b.name === a.name || b.name === a.name + "_2") T.links.push({ a, b });
}

const REPS = 5, rows = [];
for (const [n, moves, dup] of [[30, 0, 0], [30, 3, 0.2], [60, 5, 0.2], [100, 8, 0.2], [200, 15, 0.2], [400, 30, 0.1]]) {
  const r = { taxa: n, spr_moves: moves, start: 0, old_method: 0, current: 0, old_ms: 0, current_ms: 0 };
  for (let k = 0; k < REPS; k++) {
    const [A, B] = scenario(n, moves, dup);
    load(A, B); r.start += Tangle.count();
    let t = Date.now(); r.old_method += Tangle.untangleGreedy("both"); r.old_ms += Date.now() - t;
    load(A, B); t = Date.now(); r.current += Tangle.untangle("both"); r.current_ms += Date.now() - t;
  }
  for (const k of ["start", "old_method", "current", "old_ms", "current_ms"]) r[k] = Math.round((r[k] / REPS) * 10) / 10;
  rows.push(r);
}
console.table(rows);
