/* ===== Tanglegram: two trees, tips linked by shared species/strain names ===== */
const Tangle = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const T = { A: null, B: null, origA: null, origB: null, links: [], unA: [], unB: [], mode: "strain", len: "phylo", color: "A", sup: false, font: 11, row: 1, hi: null, before: null, slot: null, wired: false, sel: null, selSide: null, undo: [] };

  /* ---------- name parsing ---------- */
  const QUAL = /^(str\.?|strain|isolate|iso\.?|clone|cultivar|cv\.?|substr\.?|serotype|genotype)$/i;
  const SUBSP = /^(subsp\.?|ssp\.?|var\.?|pv\.?|bv\.?|biovar|serovar|f\.|forma|morph)$/i;
  const SPNOV = /^(sp|spp|sp\.|spp\.|cf\.?|aff\.?|nr\.?|gen\.?|genomosp\.?)$/i;
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  function nameKey(raw) {
    const s = String(raw || "").replace(/[_|]/g, " ").replace(/['"\[\]()]/g, " ").replace(/\s+/g, " ").trim();
    const toks = s.split(" ").filter(Boolean);
    const k = { raw: s, exact: norm(s), genus: null, abbr: false, species: null, strain: null };
    if (toks.length >= 2 && /^(?:[A-Z][a-z]+|[A-Z][a-z]?\.)$/.test(toks[0])) {
      k.genus = toks[0].replace(/\./, "").toLowerCase(); k.abbr = /\.$/.test(toks[0]);
      let i = 1;
      if (SPNOV.test(toks[1])) { k.species = "sp"; i = 2; }
      else if (/^[a-z][a-z-]+\.?$/.test(toks[1]) && !QUAL.test(toks[1]) && !SUBSP.test(toks[1])) { k.species = toks[1].replace(/\.$/, ""); i = 2; }
      else k.species = null;
      // qualifiers: subspecies join the species; str./strain/isolate are skipped
      while (i < toks.length) {
        if (SUBSP.test(toks[i]) && toks[i + 1]) { k.species = (k.species || "") + " " + toks[i + 1].toLowerCase(); i += 2; continue; }
        if (QUAL.test(toks[i]) || SPNOV.test(toks[i])) { i++; continue; }
        break;
      }
      // "Occ3_1" becomes "Occ3 1" once underscores are read as spaces: rejoin a short number
      if (toks[i]) k.strain = norm(toks[i] + (toks[i + 1] && /^\d{1,3}$/.test(toks[i + 1]) ? toks[i + 1] : "")) || null;
    }
    return k;
  }
  function genusOK(a, b) { if (!a.genus || !b.genus) return false; if (a.genus === b.genus) return true; return (a.abbr || b.abbr) && a.genus[0] === b.genus[0] && (a.abbr ? b.genus.startsWith(a.genus) : a.genus.startsWith(b.genus)); }
  function same(a, b, mode) {
    if (mode === "exact") return a.exact && a.exact === b.exact;
    if (!a.genus || !b.genus || a.species == null || b.species == null) return a.exact && a.exact === b.exact; // not a binomial: fall back to the whole label
    if (!genusOK(a, b)) return false;
    if (mode === "species") return a.species === b.species && a.species !== "sp" ? true : a.species === b.species && a.strain === b.strain;
    // species + strain
    if (a.species !== b.species) return false;
    if (a.strain || b.strain) return a.strain === b.strain;
    return true;
  }
  function parseTable(text) {
    return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(l => { const p = l.includes("\t") ? l.split("\t") : l.split(/\s*[,;]\s*/); return [p[0], p[1]]; }).filter(p => p[0] && p[1]);
  }
  function computeLinks() {
    T.links = []; T.unA = []; T.unB = [];
    if (!T.A || !T.B) return;
    const ta = Tree.tips(T.A.root), tb = Tree.tips(T.B.root);
    const ka = new Map(ta.map(t => [t, nameKey(t.name)])), kb = new Map(tb.map(t => [t, nameKey(t.name)]));
    if (T.mode === "table") {
      const rows = parseTable($("tgTable").value);
      const find = (tips, keys, label) => { const k = nameKey(label); const ex = tips.filter(t => keys.get(t).exact === k.exact); return ex.length ? ex : tips.filter(t => same(keys.get(t), k, "strain")); };
      const seen = new Set();
      for (const [l, r] of rows) for (const a of find(ta, ka, l)) for (const b of find(tb, kb, r)) { const id = a.id + ":" + b.id; if (!seen.has(id)) { seen.add(id); T.links.push({ a, b, key: l + " ↔ " + r }); } }
    } else {
      for (const a of ta) for (const b of tb) if (same(ka.get(a), kb.get(b), T.mode)) T.links.push({ a, b, key: keyLabel(ka.get(a)) });
    }
    const la = new Set(T.links.map(l => l.a)), lb = new Set(T.links.map(l => l.b));
    T.unA = ta.filter(t => !la.has(t)); T.unB = tb.filter(t => !lb.has(t));
  }
  function keyLabel(k) { return k.genus ? [k.genus, k.species, k.strain].filter(Boolean).join(" ") : k.raw; }

  /* ---------- crossings & untangling ---------- */
  function positions(tree) { const m = new Map(); Tree.tips(tree.root).forEach((t, i) => m.set(t, i)); return m; }
  function crossings(pa, pb) {
    if (!T.links.length) return 0;
    const arr = T.links.map(l => [pa.get(l.a), pb.get(l.b)]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    // count pairs i<j with b_i > b_j (merge sort inversions); equal left positions never count
    const b = arr.map(x => x[1]);
    const tmp = new Array(b.length);
    const sort = (lo, hi) => {
      if (hi - lo < 2) return 0;
      const mid = (lo + hi) >> 1; let c = sort(lo, mid) + sort(mid, hi);
      let i = lo, j = mid, k = lo;
      while (i < mid && j < hi) { if (b[j] < b[i]) { c += mid - i; tmp[k++] = b[j++]; } else tmp[k++] = b[i++]; }
      while (i < mid) tmp[k++] = b[i++]; while (j < hi) tmp[k++] = b[j++];
      for (let q = lo; q < hi; q++) b[q] = tmp[q];
      return c;
    };
    return sort(0, b.length);
  }
  const count = () => crossings(positions(T.A), positions(T.B));
  function orderSnap(tree) { return Tree.nodes(tree.root).filter(n => !n.isTip).map(n => [n, n.children.slice()]); }
  function restore(snap) { for (const [n, c] of snap) n.children = c.slice(); }
  function barycentre(tree, otherPos, isA) {
    const linksOf = new Map();
    for (const l of T.links) { const me = isA ? l.a : l.b, o = isA ? l.b : l.a; if (!linksOf.has(me)) linksOf.set(me, []); linksOf.get(me).push(otherPos.get(o)); }
    const bc = new Map();
    for (const n of Tree.postorder(tree.root)) {
      if (n.isTip) { const v = linksOf.get(n); bc.set(n, v ? { s: v.reduce((a, b) => a + b, 0), w: v.length } : { s: 0, w: 0 }); }
      else {
        const agg = { s: 0, w: 0 }; for (const c of n.children) { const x = bc.get(c); agg.s += x.s; agg.w += x.w; } bc.set(n, agg);
        const keyed = n.children.map((c, i) => ({ c, i, v: bc.get(c).w ? bc.get(c).s / bc.get(c).w : null }));
        // unlinked clades keep their place relative to neighbours
        keyed.forEach((o, i) => { if (o.v == null) { const prev = keyed.slice(0, i).reverse().find(q => q.v != null); o.v = prev ? prev.v + 1e-6 * (i + 1) : -1e9 + i; } });
        n.children = keyed.sort((x, y) => x.v - y.v || x.i - y.i).map(o => o.c);
      }
    }
  }
  function greedy(tree) {
    let best = count(), improved = false;
    for (const n of Tree.nodes(tree.root)) {
      if (n.isTip) continue;
      const before = n.children.slice();
      n.children.reverse();
      let c = count();
      if (c < best) { best = c; improved = true; continue; }
      n.children = before;
      if (before.length > 2) { // polytomy: also try moving each child to the front
        for (let i = 1; i < before.length; i++) {
          n.children = [before[i], ...before.filter((_, j) => j !== i)];
          c = count(); if (c < best) { best = c; improved = true; break; }
          n.children = before;
        }
      }
    }
    return improved;
  }
  /* Exact one-sided step: with the other tree fixed, the crossings between two sibling
     clades depend only on which of the two comes first, so every node can be decided
     on its own (bottom-up, merging sorted lists of the other side's positions). */
  function pairsAbove(x, y) { // #(a in x, b in y, a > b); x, y sorted ascending
    let c = 0, j = 0;
    for (let i = 0; i < x.length; i++) { while (j < y.length && y[j] < x[i]) j++; c += j; }
    return c;
  }
  function mergeSorted(lists) {
    let out = lists[0] || [];
    for (let k = 1; k < lists.length; k++) {
      const a = out, b = lists[k], m = new Array(a.length + b.length); let i = 0, j = 0, q = 0;
      while (i < a.length && j < b.length) m[q++] = a[i] <= b[j] ? a[i++] : b[j++];
      while (i < a.length) m[q++] = a[i++]; while (j < b.length) m[q++] = b[j++];
      out = m;
    }
    return out;
  }
  function permutations(arr) { if (arr.length <= 1) return [arr]; const out = []; arr.forEach((x, i) => { for (const p of permutations(arr.filter((_, j) => j !== i))) out.push([x, ...p]); }); return out; }
  function optimizeSide(tree, otherPos, isA) {
    const linksOf = new Map();
    for (const l of T.links) { const me = isA ? l.a : l.b, o = isA ? l.b : l.a; if (!linksOf.has(me)) linksOf.set(me, []); linksOf.get(me).push(otherPos.get(o)); }
    const lists = new Map();
    for (const n of Tree.postorder(tree.root)) {
      if (n.isTip) { lists.set(n, (linksOf.get(n) || []).slice().sort((x, y) => x - y)); continue; }
      const k = n.children.length, L = n.children.map(c => lists.get(c));
      if (k === 2) {
        if (pairsAbove(L[1], L[0]) < pairsAbove(L[0], L[1])) n.children.reverse();
      } else {
        // polytomy: cost[i][j] = crossings if child i is placed before child j
        const cost = L.map(x => L.map(y => x === y ? 0 : pairsAbove(x, y)));
        let order;
        if (k <= 7) {
          let best = Infinity;
          for (const p of permutations([...Array(k).keys()])) { let c = 0; for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) c += cost[p[i]][p[j]]; if (c < best) { best = c; order = p; } }
        } else {
          const mean = L.map(x => x.length ? x.reduce((a, b) => a + b, 0) / x.length : Infinity);
          order = [...Array(k).keys()].sort((i, j) => mean[i] - mean[j]);
          for (let pass = 0, moved = true; moved && pass < 50; pass++) { moved = false; for (let i = 0; i + 1 < k; i++) { const a = order[i], b = order[i + 1]; if (cost[b][a] < cost[a][b]) { order[i] = b; order[i + 1] = a; moved = true; } } }
        }
        n.children = order.map(i => n.children[i]);
      }
      lists.set(n, mergeSorted(n.children.map(c => lists.get(c))));
    }
  }
  function shuffleOrder(tree, rnd) { for (const n of Tree.nodes(tree.root)) if (!n.isTip && rnd() < 0.5) n.children.reverse(); }
  function untangle(sides, opts = {}) {
    const doA = sides !== "B", doB = sides !== "A";
    const run = () => {
      let c = count();
      for (let r = 0; r < 30; r++) {
        if (doA) optimizeSide(T.A, positions(T.B), true);
        if (doB) optimizeSide(T.B, positions(T.A), false);
        const c2 = count(); if (c2 >= c) { c = c2; break; } c = c2;
      }
      return c;
    };
    // several starting orders (current, ladderized, random); keep the best result
    let seed = 12345; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
    const nTips = Tree.tips(T.A.root).length + Tree.tips(T.B.root).length;
    const restarts = opts.restarts ?? (nTips <= 300 ? 40 : nTips <= 1000 ? 16 : 6);
    const starts = [() => {}, () => { if (doA) Tree.ladderize(T.A.root, true); if (doB) Tree.ladderize(T.B.root, true); }, () => { if (doA) Tree.ladderize(T.A.root, false); if (doB) Tree.ladderize(T.B.root, false); }];
    if (nTips <= 1000) starts.push(() => { untangleGreedy(sides); }); // the older barycentre + flip search as one more start
    for (let i = 0; i < restarts; i++) starts.push(() => { if (doA) shuffleOrder(T.A, rnd); if (doB && (!doA || i % 2)) shuffleOrder(T.B, rnd); });
    let best = null;
    const base = [orderSnap(T.A), orderSnap(T.B)];
    for (const st of starts) {
      restore(base[0]); restore(base[1]); st();
      const c = run();
      if (!best || c < best.c) best = { c, a: orderSnap(T.A), b: orderSnap(T.B) };
      if (best.c === 0) break;
    }
    restore(best.a); restore(best.b);
    // polish: single-node flips judged on the total (can escape the alternating fixed point)
    if (opts.polish !== false) {
      for (let r = 0; r < 6; r++) {
        let any = false;
        if (doA) any = greedy(T.A) || any;
        if (doB) any = greedy(T.B) || any;
        if (doA) optimizeSide(T.A, positions(T.B), true);
        if (doB) optimizeSide(T.B, positions(T.A), false);
        if (!any) break;
      }
    }
    return count();
  }
  function untangleGreedy(sides) {
    const doA = sides !== "B", doB = sides !== "A";
    const run = () => {
      for (let r = 0; r < 12; r++) {
        let any = false;
        const s0 = count();
        if (doA) { const snap = orderSnap(T.A); barycentre(T.A, positions(T.B), true); if (count() > s0) restore(snap); }
        const s1 = count();
        if (doB) { const snap = orderSnap(T.B); barycentre(T.B, positions(T.A), false); if (count() > s1) restore(snap); }
        if (doA) any = greedy(T.A) || any;
        if (doB) any = greedy(T.B) || any;
        if (!any && count() >= s0) break;
      }
      return count();
    };
    // a few starting points; keep the best
    const starts = [() => {}, () => { if (doA) Tree.ladderize(T.A.root, true); if (doB) Tree.ladderize(T.B.root, true); }, () => { if (doA) Tree.ladderize(T.A.root, false); if (doB) Tree.ladderize(T.B.root, false); }];
    let best = null;
    const base = [orderSnap(T.A), orderSnap(T.B)];
    for (const st of starts) {
      restore(base[0]); restore(base[1]); st();
      const c = run();
      if (!best || c < best.c) best = { c, a: orderSnap(T.A), b: orderSnap(T.B) };
    }
    restore(best.a); restore(best.b);
    return best.c;
  }

  /* ---------- drawing ---------- */
  const PAL_L = ["#2c7a5b", "#b5542d", "#3f62b5", "#9a7a16", "#8a3f8f", "#2f8a9a", "#a83b52", "#5b7a2a", "#6b5bb5", "#b07a3a"];
  const PAL_D = ["#5cc496", "#ef8a62", "#7fa3f0", "#d9b54a", "#c784cc", "#5cc3d4", "#e77a90", "#9cc35c", "#a49af0", "#e0a86a"];
  function palette() { const dark = getComputedStyle(document.documentElement).getPropertyValue("color-scheme").includes("dark") || matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light"; return document.documentElement.dataset.theme === "dark" || dark ? PAL_D : PAL_L; }
  function layoutOne(tree, clado) {
    const tips = Tree.tips(tree.root);
    const useLen = !clado && Tree.hasLengths(tree.root);
    const depth = new Map(), height = new Map(), pos = new Map();
    for (const n of Tree.postorder(tree.root)) height.set(n, n.isTip ? 0 : 1 + Math.max(...n.children.map(c => height.get(c))));
    const H = height.get(tree.root);
    for (const n of Tree.nodes(tree.root)) depth.set(n, useLen ? (n.parent ? depth.get(n.parent) + Math.max(0, n.length || 0) : 0) : H - height.get(n));
    tips.forEach((t, i) => pos.set(t, i));
    for (const n of Tree.postorder(tree.root)) if (!n.isTip) pos.set(n, (pos.get(n.children[0]) + pos.get(n.children[n.children.length - 1])) / 2);
    return { tips, depth, pos, maxD: Math.max(1e-12, ...tips.map(t => depth.get(t))) };
  }
  let lastSVG = "";
  function render() {
    const cv = $("tgCanvas");
    cv.querySelectorAll("svg").forEach(e => e.remove());
    const ready = T.A && T.B;
    $("tgEmpty").hidden = !!ready;
    ["tgSvg", "tgCsv", "tgNwk", "tgUntangle", "tgReset"].forEach(id => $(id).disabled = !ready);
    editState(ready);
    $("infoA").textContent = T.A ? `${Tree.tips(T.A.root).length} taxa` : "empty";
    $("infoB").textContent = T.B ? `${Tree.tips(T.B.root).length} taxa` : "empty";
    if (!ready) { lastSVG = ""; stats(); return; }
    const f = T.font, clado = T.len === "clado";
    const LA = layoutOne(T.A, clado), LB = layoutOne(T.B, clado);
    const nA = LA.tips.length, nB = LB.tips.length, n = Math.max(nA, nB);
    const row = Math.max(f * 1.4, 9, Math.min(f * 2.4, 640 / n)) * T.row;
    const top = 40, Hh = top + n * row + 40;
    const yA = (i) => top + (i + 0.5) * (n * row / nA), yB = (i) => top + (i + 0.5) * (n * row / nB);
    const tw = (s) => (s || "").length * f * 0.5 + 6;
    const labA = Math.min(360, Math.max(...LA.tips.map(t => tw(t.name)))), labB = Math.min(360, Math.max(...LB.tips.map(t => tw(t.name))));
    const avail = Math.max(900, cv.clientWidth - 20);
    const treeW = Math.max(140, (avail - labA - labB - 220) * 0.5), gap = Math.max(160, avail - 2 * treeW - labA - labB - 40);
    const x0 = 20, xAend = x0 + treeW, xAlab = xAend + 6, xLinkA = xAlab + labA + 4;
    const xLinkB = xLinkA + gap, xBlab = xLinkB + 4, xBend = xBlab + labB + 6, x1 = xBend + treeW;
    const W = x1 + 20;
    const XA = (nd) => x0 + LA.depth.get(nd) / LA.maxD * treeW;
    const XB = (nd) => x1 - LB.depth.get(nd) / LB.maxD * treeW;
    const YA = (nd) => yA(LA.pos.get(nd)), YB = (nd) => yB(LB.pos.get(nd));
    const pal = palette();
    const cid = new Map(); let ci = 0;
    const colorOf = (l) => { if (T.color === "none") return "var(--accent)"; const key = T.color === "A" ? l.a : l.b; if (!cid.has(key)) cid.set(key, pal[ci++ % pal.length]); return cid.get(key); };
    const linked = new Set(T.links.flatMap(l => [l.a, l.b]));
    const parts = [];
    const nm = (s) => esc(s || "unnamed");
    const titleA = $("nameA").value.trim(), titleB = $("nameB").value.trim();
    if (titleA) parts.push(`<text class="ttl" x="${x0}" y="20">${esc(titleA)}</text>`);
    if (titleB) parts.push(`<text class="ttl" x="${x1}" y="20" text-anchor="end">${esc(titleB)}</text>`);
    const drawTree = (tree, L, X, Y, side) => {
      const selRoot = T.selSide === side ? T.sel : null;
      const inSel = (nd) => { if (!selRoot || selRoot.isTip) return false; let x = nd; while (x) { if (x === selRoot) return true; x = x.parent; } return false; };
      for (const nd of Tree.nodes(tree.root)) {
        const g = inSel(nd) ? ' class="in"' : "";
        if (nd.parent) {
          const d = `M${X(nd.parent).toFixed(1)},${Y(nd).toFixed(1)}H${X(nd).toFixed(1)}`;
          parts.push(`<g${g}><path class="hit" data-side="${side}" data-id="${nd.id}" d="${d}"/><path class="br${selRoot === nd ? " hov" : ""}" d="${d}"/></g>`);
        }
        if (!nd.isTip) {
          const c = nd.children; parts.push(`<g${g}><path class="br" d="M${X(nd).toFixed(1)},${Y(c[0]).toFixed(1)}V${Y(c[c.length - 1]).toFixed(1)}"/></g>`);
          if (T.sup && nd.support != null && nd !== tree.root) parts.push(`<text class="sup" x="${(X(nd) + (side === "A" ? -3 : 3)).toFixed(1)}" y="${(Y(nd) - 3).toFixed(1)}" font-size="${f * 0.75}" text-anchor="${side === "A" ? "end" : "start"}">${esc(nd.support)}</text>`);
          const on = selRoot === nd;
          parts.push(`<circle class="${on ? "node on" : "hit"}" data-side="${side}" data-id="${nd.id}" cx="${X(nd).toFixed(1)}" cy="${Y(nd).toFixed(1)}" r="${on ? 3.6 : 6}"${on ? "" : ' style="stroke-width:0;fill:transparent"'}/>`);
        } else {
          const y = Y(nd).toFixed(1), xe = side === "A" ? xAend : xBend;
          if (Math.abs(X(nd) - xe) > 2) parts.push(`<line class="lead" x1="${X(nd).toFixed(1)}" x2="${xe}" y1="${y}" y2="${y}"/>`);
          const cls = "tip" + (linked.has(nd) ? "" : " un") + (T.hi === nd || selRoot === nd ? " on" : "");
          parts.push(`<text class="${cls}" data-side="${side}" data-id="${nd.id}" x="${side === "A" ? xAlab : xBlab + labB}" y="${y}" dy=".34em" font-size="${f}" text-anchor="${side === "A" ? "start" : "end"}">${nm(nd.name)}</text>`);
        }
      }
    };
    drawTree(T.A, LA, XA, YA, "A"); drawTree(T.B, LB, XB, YB, "B");
    const hiSet = T.hi ? new Set(T.links.filter(l => l.a === T.hi || l.b === T.hi)) : null;
    for (const l of T.links) {
      const ya = YA(l.a), yb = YB(l.b), mx = (xLinkA + xLinkB) / 2;
      const cls = "lk" + (hiSet ? (hiSet.has(l) ? " hi" : " dim") : "");
      parts.push(`<path class="${cls}" stroke="${colorOf(l)}" d="M${xLinkA.toFixed(1)},${ya.toFixed(1)}C${mx.toFixed(1)},${ya.toFixed(1)} ${mx.toFixed(1)},${yb.toFixed(1)} ${xLinkB.toFixed(1)},${yb.toFixed(1)}"><title>${esc(l.a.name)} ↔ ${esc(l.b.name)}</title></path>`);
    }
    const ff = getComputedStyle(document.body).fontFamily.replace(/"/g, "'");
    lastSVG = `<svg class="tv tgv" xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(W)}" height="${Math.ceil(Hh)}" viewBox="0 0 ${Math.ceil(W)} ${Math.ceil(Hh)}" font-family="${ff}">${parts.join("")}</svg>`;
    cv.insertAdjacentHTML("beforeend", lastSVG);
    stats();
  }
  function editState(ready) {
    const n = ready ? T.sel : null, side = T.selSide;
    const tr = n ? (side === "A" ? T.A : T.B) : null;
    const name = side === "A" ? ($("nameA").value || "left tree") : ($("nameB").value || "right tree");
    $("tgSelInfo").textContent = !ready ? "Load two trees first." : !n ? "Click a branch, node or taxon in either tree." : `${n.isTip ? (n.name || "Unnamed taxon") : n === tr.root ? "Root" : `Clade of ${Tree.tipCount(n)} taxa`} · ${name}`;
    $("tgEdit").querySelectorAll("button[data-e]").forEach(b => {
      const a = b.dataset.e;
      if (b.dataset.s) { b.disabled = !ready || (a === "midpoint" && !Tree.hasLengths((b.dataset.s === "A" ? T.A : T.B).root)); return; }
      if (a === "undo") { b.disabled = !T.undo.length; return; }
      b.disabled = !n || (a === "reroot" && n === tr.root) || ((a === "flip" || a === "mirror") && n.isTip && !n.parent) || (a === "collapse" && (n.isTip || n === tr.root)) || (a === "prune" && n === tr.root);
    });
  }
  function stats() {
    const box = $("tgStats");
    if (!T.A || !T.B) { box.innerHTML = ""; $("tgNotes").innerHTML = ""; return; }
    const c = count();
    const items = [[T.links.length, "links"], [c, "line crossings" + (T.before != null && T.before !== c ? ` (was ${T.before})` : "")], [T.unA.length, "left taxa unlinked"], [T.unB.length, "right taxa unlinked"]];
    box.innerHTML = items.map(([a, b]) => `<div class="stat"><b>${esc(a)}</b><span>${esc(b)}</span></div>`).join("");
    const notes = [];
    const multi = new Map(); for (const l of T.links) multi.set(l.a, (multi.get(l.a) || 0) + 1);
    const m = [...multi.values()].filter(v => v > 1).length;
    if (m) notes.push({ kind: "ok", text: m === 1 ? "1 left taxon links to more than one right taxon." : `${m} left taxa link to more than one right taxon.` });
    if (!T.links.length) notes.push({ kind: "err", text: "No taxa matched. Try “Species only”, check the names, or paste an association table." });
    const show = (arr, side) => { if (arr.length) notes.push({ text: `Unlinked on the ${side}: ${arr.slice(0, 6).map(t => t.name || "unnamed").join("; ")}${arr.length > 6 ? ` and ${arr.length - 6} more` : ""}` }); };
    show(T.unA, "left"); show(T.unB, "right");
    $("tgNotes").innerHTML = notes.map(n => `<li class="${n.kind || ""}">${esc(n.text)}</li>`).join("");
  }
  function relink() { computeLinks(); T.before = null; T.hi = null; render(); }

  /* ---------- loading ---------- */
  function setSlot(side, tree, label) {
    const t = Tree.clone(tree); T.undo = []; T.sel = null; T.selSide = null;
    T[side] = t; T["orig" + side] = Tree.clone(tree);
    if (label && !$("name" + side).value) $("name" + side).value = label.replace(/\.[^.]+$/, "");
    relink();
  }
  function loadText(side, text, label) {
    try { const trees = Tree.parseAny(text); if (!trees.length) throw new Error("no tree found"); setSlot(side, trees[0], label); if (trees.length > 1) window.TreescanToast(`Used the first of ${trees.length} trees`); }
    catch (e) { window.TreescanToast(`Couldn't read that tree: ${e.message}`); }
  }
  const EX_A = "(((Gilliamella_apicola_wkB1:0.02,Gilliamella_apicola_wkB18:0.03):0.04,(Gilliamella_apicola_Nev3-1:0.03,Gilliamella_apicola_Bim1-2:0.02):0.03):0.05,((Gilliamella_sp._B3801:0.04,(Gilliamella_sp._B2717:0.02,Gilliamella_sp._B3817:0.03):0.02):0.06,(Gilliamella_apicola_HK2:0.05,Gilliamella_sp._ESL0441:0.06):0.04):0.03);";
  const EX_B = "((Gilliamella_sp_B3801_Locus2:0.01,(Gilliamella_sp_B2717_Locus1:0.01,Gilliamella_sp_B3817_Locus1:0.02):0.01):0.12,((Gilliamella_apicola_HK2_Locus1:0.2,Gilliamella_sp_ESL0441_Locus1:0.3):0.1,((Gilliamella_apicola_wkB1_Locus1:0.07,Gilliamella_apicola_Nev3-1_Locus1:0.01):0.02,(Gilliamella_sp_B3801_Locus1:0.01,Gilliamella_apicola_wkB18_Locus1:0.01,Gilliamella_apicola_Bim1-2_Locus1:0.01):0.03):0.08):0.04);";

  function wire() {
    if (T.wired) return; T.wired = true;
    document.querySelectorAll("[data-tg]").forEach(b => b.addEventListener("click", () => {
      const side = b.dataset.s, act = b.dataset.tg;
      if (act === "file") { T.slot = side; $("fTg").click(); }
      if (act === "paste") { T.slot = side; $("tgPasteTitle").textContent = `Paste the ${side === "A" ? "left" : "right"} tree`; $("tgPText").value = ""; $("dTgPaste").showModal(); }
      if (act === "current") { const t = window.TreescanCurrent && window.TreescanCurrent(); if (!t) { window.TreescanToast("There is no tree in Read & edit yet."); return; } setSlot(side, t, "Current tree"); }
    }));
    $("fTg").onchange = async (e) => { const f = e.target.files[0]; if (f) loadText(T.slot, await f.text(), f.name); e.target.value = ""; };
    $("tgPGo").onclick = () => { const t = $("tgPText").value; $("dTgPaste").close(); if (t.trim()) loadText(T.slot, t, ""); };
    $("tgSwap").onclick = () => { [T.A, T.B] = [T.B, T.A]; [T.origA, T.origB] = [T.origB, T.origA]; const a = $("nameA").value; $("nameA").value = $("nameB").value; $("nameB").value = a; relink(); };
    $("tgExample").onclick = () => { $("nameA").value = "Strains (example)"; $("nameB").value = "T4SS loci (example)"; setSlot("A", Tree.parseNewick(EX_A), ""); setSlot("B", Tree.parseNewick(EX_B), ""); };
    const modeHint = () => {
      const m = $("tgMode").value;
      $("tgTable").hidden = m !== "table";
      $("tgModeHint").textContent = { strain: "Genus, species and the strain after it (or after “str.”, “sp.”) must agree. Extra words such as “Locus1” or gene names are ignored, and “G.” matches “Gilliamella”.", species: "Genus and species must agree; strains are ignored. For “sp.” names the strain is still used.", exact: "Labels must be identical, ignoring case, spaces, underscores and punctuation.", table: "One link per line: a left label and a right label. Labels are matched like “Species + strain”." }[m];
    };
    $("tgMode").onchange = () => { T.mode = $("tgMode").value; modeHint(); relink(); };
    $("tgTable").oninput = () => { clearTimeout(T._t); T._t = setTimeout(relink, 300); };
    modeHint();
    $("tgUntangle").onclick = () => { if (!T.A || !T.B) return; if (T.before == null) T.before = count(); $("tgUntangle").disabled = true; setTimeout(() => { const c = untangle($("tgSide").value); $("tgUntangle").disabled = false; render(); window.TreescanToast(`${c} crossing${c === 1 ? "" : "s"} left`); }, 20); };
    $("tgReset").onclick = () => { if (T.A || T.B) T.undo.push(JSON.stringify({ a: Tree.toJSON(T.A.root), am: T.A.meta, b: Tree.toJSON(T.B.root), bm: T.B.meta })); if (T.origA) T.A = Tree.clone(T.origA); if (T.origB) T.B = Tree.clone(T.origB); T.sel = null; T.selSide = null; relink(); };
    const segBtn = (id, cb) => $(id).addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; $(id).querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); cb(b.dataset.v); });
    segBtn("tgLen", (v) => { T.len = v; render(); });
    $("tgColor").onchange = (e) => { T.color = e.target.value; render(); };
    $("tgSup").onchange = (e) => { T.sup = e.target.checked; render(); };
    $("tgFont").oninput = (e) => { T.font = +e.target.value; render(); };
    $("tgRow").oninput = (e) => { T.row = +e.target.value / 100; render(); };
    ["nameA", "nameB"].forEach(id => $(id).addEventListener("input", () => render()));
    $("tgCanvas").addEventListener("click", (e) => {
      const el = e.target.closest("[data-side][data-id]");
      if (!el) { if (T.hi || T.sel) { T.hi = null; T.sel = null; T.selSide = null; render(); } return; }
      const side = el.dataset.side, tree = side === "A" ? T.A : T.B;
      const nd = Tree.nodes(tree.root).find(t => t.id === +el.dataset.id);
      if (!nd) return;
      if (T.sel === nd) { T.sel = null; T.selSide = null; T.hi = null; }
      else { T.sel = nd; T.selSide = side; T.hi = nd.isTip ? nd : null; }
      render();
    });
    // ---- editing ----
    const snap = () => JSON.stringify({ a: Tree.toJSON(T.A.root), am: T.A.meta, b: Tree.toJSON(T.B.root), bm: T.B.meta });
    const edit = (fn, msg) => {
      if (!T.A || !T.B) return;
      const before = snap();
      const r = fn();
      if (r === false) { window.TreescanToast("That edit isn't possible here"); return; }
      T.undo.push(before); if (T.undo.length > 60) T.undo.shift();
      T.sel = null; T.selSide = null; T.hi = null;
      computeLinks(); render();
      if (msg) window.TreescanToast(msg);
    };
    const treeOf = (side) => side === "A" ? T.A : T.B;
    $("tgEdit").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-e]"); if (!b) return;
      const a = b.dataset.e, n = T.sel, side = b.dataset.s || T.selSide;
      const tr = side ? treeOf(side) : null;
      switch (a) {
        case "reroot": return edit(() => Tree.reroot(tr, n, 0.5), "Rerooted");
        case "flip": return edit(() => { Tree.rotate(n.isTip ? n.parent : n); }, "Flipped");
        case "mirror": return edit(() => { Tree.mirror(n.isTip ? n.parent : n); }, "Flipped clade");
        case "collapse": return edit(() => Tree.collapse(tr, n), "Collapsed into a polytomy");
        case "prune": return edit(() => Tree.prune(tr, n), "Deleted");
        case "midpoint": return edit(() => Tree.hasLengths(tr.root) ? Tree.midpointRoot(tr) : false, "Midpoint rooted");
        case "ladUp": return edit(() => { Tree.ladderize(tr.root, true); });
        case "ladDown": return edit(() => { Tree.ladderize(tr.root, false); });
        case "undo": {
          if (!T.undo.length) return;
          const o = JSON.parse(T.undo.pop());
          T.A = { root: Tree.fromJSON(o.a), meta: o.am }; T.B = { root: Tree.fromJSON(o.b), meta: o.bm };
          T.sel = null; T.selSide = null; T.hi = null; computeLinks(); render(); return;
        }
      }
    });
    window.addEventListener("resize", () => { if (!$("workTangle").hidden) { clearTimeout(T._r); T._r = setTimeout(render, 150); } });
    $("tgSvg").onclick = () => {
      const svg = lastSVG.replace(/<svg ([^>]*)>/, (m, a) => `<svg ${a}><style>.br{stroke:#222;stroke-width:1.3;fill:none;stroke-linecap:square}.tip{font-family:'Source Serif 4',Georgia,serif;font-style:italic;fill:#111}.tip.un{fill:#888}.lk{fill:none;stroke-width:1.3;opacity:.85}.lead{stroke:#bbb;stroke-width:1;stroke-dasharray:1 3}.sup{font-family:monospace;fill:#8a5a10}.ttl{font:600 13px sans-serif;fill:#111}</style>`).replace(/stroke="var\(--accent\)"/g, 'stroke="#1d6a4d"').replace(/ class="lk (dim|hi)"/g, ' class="lk"');
      window.TreescanSave("tanglegram.svg", '<?xml version="1.0" encoding="UTF-8"?>\n' + svg, "image/svg+xml");
    };
    $("tgCsv").onclick = () => {
      const q = (s) => /[",\n]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : s;
      const rows = [["left_taxon", "right_taxon", "matched_on"], ...T.links.map(l => [l.a.name, l.b.name, l.key])].map(r => r.map(q).join(","));
      for (const t of T.unA) rows.push([q(t.name), "", "unlinked"].join(","));
      for (const t of T.unB) rows.push(["", q(t.name), "unlinked"].join(","));
      window.TreescanSave("tanglegram_links.csv", rows.join("\n") + "\n", "text/csv");
    };
    $("tgNwk").onclick = () => {
      const txt = `[${$("nameA").value || "left tree"}, branch order as drawn]\n${Tree.toNewick(T.A)}\n[${$("nameB").value || "right tree"}, branch order as drawn]\n${Tree.toNewick(T.B)}\n`;
      window.TreescanSave("tanglegram_trees.nwk", txt, "text/plain");
    };
  }
  function show() { wire(); render(); }
  return { show, nameKey, same, untangle, untangleGreedy, crossings, count, optimizeSide, _state: T, loadText, setSlot };
})();
if (typeof window !== "undefined") window.Tangle = Tangle;
if (typeof module !== "undefined") module.exports = Tangle;
