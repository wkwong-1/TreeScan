// Compare a predicted Newick tree with the true one (tips matched by name).
const Tree = require("../src/core.js");

module.exports = function score(pred, truth) {
  const a = Tree.parseNewick(pred), b = Tree.parseNewick(truth);
  const names = (t) => Tree.tips(t.root).map((n) => n.name);
  const na = names(a), nb = names(b);
  const clades = (t) => {
    const sets = new Map(), out = new Map();
    for (const n of Tree.postorder(t.root)) {
      sets.set(n, n.isTip ? [n.name] : n.children.flatMap((c) => sets.get(c)));
      if (!n.isTip && n !== t.root) out.set(sets.get(n).slice().sort().join("|"), n);
    }
    return out;
  };
  const ca = clades(a), cb = clades(b);
  let cladeHit = 0, supTotal = 0, supHit = 0;
  const lenErr = [];
  for (const [k, n] of cb) {
    const m = ca.get(k); if (!m) continue;
    cladeHit++;
    if (n.support != null) { supTotal++; if (m.support === n.support) supHit++; }
    if (n.length) lenErr.push(Math.abs((m.length || 0) - n.length) / n.length);
  }
  const byName = new Map(Tree.tips(a.root).map((n) => [n.name, n]));
  for (const n of Tree.tips(b.root)) { const m = byName.get(n.name); if (m && n.length) lenErr.push(Math.abs((m.length || 0) - n.length) / n.length); }
  lenErr.sort((x, y) => x - y);
  return {
    tips: na.length, trueTips: nb.length,
    names: na.filter((x) => nb.includes(x)).length,
    clades: cladeHit, trueClades: cb.size,
    supports: supHit, trueSupports: supTotal,
    medianLenErr: lenErr.length ? lenErr[Math.floor(lenErr.length / 2)] : null,
  };
};
