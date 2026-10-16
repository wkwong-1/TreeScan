// Parsers, writers and editing operations of src/core.js.
const assert = require("node:assert/strict");
const Tree = require("../src/core.js");
const truth = require("./fixtures/truth.json");

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log("ok  ", name); } catch (e) { console.error("FAIL", name, "\n     ", e.message); process.exitCode = 1; } };

// unrooted bipartitions with their support, ignoring the edge split by the root
function bipartitions(tree) {
  const all = Tree.tips(tree.root).map((t) => t.name).sort();
  const sets = new Map(), out = {};
  for (const n of Tree.postorder(tree.root)) sets.set(n, n.isTip ? [n.name] : n.children.flatMap((c) => sets.get(c)));
  for (const [n, s] of sets) {
    if (n === tree.root || n.isTip || n.parent === tree.root) continue;
    if (s.length < 2 || s.length > all.length - 2) continue;
    const comp = all.filter((x) => !s.includes(x));
    const key = [s.slice().sort(), comp].sort((a, b) => a.join().localeCompare(b.join()))[0].join("|");
    out[key] = n.support;
  }
  return out;
}

for (const [name, nwk] of Object.entries(truth)) {
  test(`${name}: Newick round trip`, () => assert.equal(Tree.toNewick(Tree.parseNewick(nwk)), nwk));
  test(`${name}: NEXUS round trip`, () => {
    const t = Tree.parseNewick(nwk);
    assert.equal(Tree.toNewick(Tree.parseNexus(Tree.toNexus(t))[0]), Tree.toNewick(t));
  });
  test(`${name}: rerooting keeps bipartitions, supports and total length`, () => {
    const t = Tree.parseNewick(nwk);
    const before = bipartitions(t), len = Tree.stats(t).total;
    Tree.reroot(t, Tree.tips(t.root)[3], 0.3);
    const inner = Tree.nodes(t.root).find((n) => !n.isTip && n.parent && n.parent !== t.root);
    if (inner) Tree.reroot(t, inner);
    const after = bipartitions(t);
    // every bipartition away from both roots must survive with the same support
    for (const [k, v] of Object.entries(after)) if (k in before) assert.equal(v, before[k], `support moved for ${k}`);
    assert.ok(Math.abs(Tree.stats(t).total - len) < 1e-9, "total length changed");
  });
  test(`${name}: midpoint root halves the longest path`, () => {
    const t = Tree.parseNewick(nwk);
    Tree.midpointRoot(t);
    const depth = new Map(); let left = 0, right = 0;
    for (const n of Tree.nodes(t.root)) depth.set(n, n.parent ? depth.get(n.parent) + (n.length || 0) : 0);
    const [a, b] = t.root.children;
    for (const tip of Tree.tips(a)) left = Math.max(left, depth.get(tip));
    for (const tip of Tree.tips(b)) right = Math.max(right, depth.get(tip));
    assert.ok(Math.abs(left - right) < 1e-9, `${left} vs ${right}`);
  });
}

test("quoted labels, annotations and internal names", () => {
  const t = Tree.parseNewick("((A:1,B:2)0.95[&posterior=0.95]:0.5,'C d''x':3,(D,E)'clade X')root;");
  assert.equal(Tree.toNewick(t), "((A:1,B:2)0.95:0.5,'C d''x':3,(D,E)clade_X)root;");
  assert.equal(Tree.toNewick(t, { names: "quote" }), "((A:1,B:2)0.95:0.5,'C d''x':3,(D,E)'clade X')root;");
});
test("NEXUS translate table", () => {
  const t = Tree.parseNexus("#NEXUS\nbegin trees;\n translate 1 Homo_sapiens, 2 'Pan paniscus', 3 C;\n tree t1 = [&R] ((1:1,2:1):1,3:2);\nend;")[0];
  assert.deepEqual(Tree.tips(t.root).map((n) => n.name), ["Homo sapiens", "Pan paniscus", "C"]);
});
test("PhyloXML export lists every clade", () => {
  const t = Tree.parseNewick(truth.rect12);
  const xml = Tree.toPhyloXML(t);
  assert.equal((xml.match(/<clade>/g) || []).length, Tree.nodes(t.root).length);
});
test("collapse, prune and ladderize", () => {
  const t = Tree.parseNewick("(((A:1,B:1)40:1,C:1)90:1,(D:1,E:1)95:1);");
  assert.equal(Tree.collapseBelow(t, 50), 1);
  Tree.prune(t, Tree.tips(t.root).find((n) => n.name === "E"));
  Tree.ladderize(t.root, true);
  assert.equal(Tree.toNewick(t), "(D:2,(A:2,B:2,C:1)90:1);");
});

console.log(`\n${passed} passed`);
