/* ===== Tree core: model, parsers, writers, editing ===== */
const Tree = (() => {
  let uid = 0;
  class TNode {
    constructor(name = "", length = null, support = null) {
      this.id = ++uid;
      this.name = name;
      this.length = length;   // number | null
      this.support = support; // string | null (raw, e.g. "95" or "95/1.00")
      this.children = [];
      this.parent = null;
      this.attrs = null;      // extra annotations (object) | null
      this.flag = null;       // e.g. "estimated" lengths
    }
    get isTip() { return this.children.length === 0; }
    add(c) { c.parent = this; this.children.push(c); return c; }
  }

  const nodes = (root) => { const out = []; const st = [root]; while (st.length) { const n = st.pop(); out.push(n); for (let i = n.children.length - 1; i >= 0; i--) st.push(n.children[i]); } return out; };
  const tips = (root) => nodes(root).filter(n => n.isTip);
  const postorder = (root) => nodes(root).reverse();

  /* ---------- Newick parsing ---------- */
  const SUPPORT_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?(%)?(\s*\/\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?%?)*$/;
  function isSupportLike(s) { return SUPPORT_RE.test(String(s).trim()); }

  function tokenize(str) {
    const toks = []; let i = 0; const n = str.length;
    while (i < n) {
      const c = str[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === "[") {
        let depth = 1, j = i + 1;
        while (j < n && depth) { if (str[j] === "[") depth++; else if (str[j] === "]") depth--; j++; }
        toks.push({ t: "comment", v: str.slice(i + 1, j - 1) }); i = j; continue;
      }
      if ("(),:;".includes(c)) { toks.push({ t: c }); i++; continue; }
      if (c === "'" || c === '"') {
        let j = i + 1, s = "";
        while (j < n) {
          if (str[j] === c) { if (str[j + 1] === c) { s += c; j += 2; continue; } break; }
          s += str[j++];
        }
        toks.push({ t: "label", v: s, quoted: true }); i = j + 1; continue;
      }
      let j = i;
      while (j < n && !"(),:;[".includes(str[j]) && !/\s/.test(str[j])) j++;
      toks.push({ t: "label", v: str.slice(i, j), quoted: false }); i = j;
    }
    return toks;
  }

  function parseAnnot(s, node) {
    // [&key=value,key2={a,b}] (BEAST/FigTree/MrBayes) or [comment]
    if (!s.startsWith("&")) return;
    s = s.replace(/^&+/, "").replace(/^[RU]\s*$/i, "");
    if (!s) return;
    const out = node.attrs || {};
    let depth = 0, cur = "";
    const parts = [];
    for (const ch of s) { if (ch === "{") depth++; if (ch === "}") depth--; if (ch === "," && !depth) { parts.push(cur); cur = ""; } else cur += ch; }
    if (cur) parts.push(cur);
    for (const p of parts) { const k = p.indexOf("="); if (k > 0) out[p.slice(0, k).trim()] = p.slice(k + 1).trim(); }
    node.attrs = out;
    if (node.support == null) {
      for (const key of ["posterior", "prob", "support", "bootstrap", "label"]) if (out[key] != null && isSupportLike(out[key])) { node.support = out[key]; break; }
    }
  }

  function parseNewick(str, opts = {}) {
    const underscores = opts.underscoresToSpaces !== false;
    const toks = tokenize(str);
    let p = 0;
    const peek = () => toks[p];
    function node() {
      const nd = new TNode();
      if (peek() && peek().t === "(") {
        p++;
        nd.add(node());
        while (peek() && peek().t === ",") { p++; nd.add(node()); }
        if (!peek() || peek().t !== ")") throw new Error("Unbalanced parentheses: expected ')' near token " + p);
        p++;
      }
      // label, comments, length
      while (peek() && (peek().t === "label" || peek().t === "comment")) {
        const t = toks[p++];
        if (t.t === "comment") { parseAnnot(t.v, nd); continue; }
        let v = t.v;
        if (!t.quoted && underscores) v = v.replace(/_/g, " ");
        if (nd.children.length && isSupportLike(v) && !t.quoted) nd.support = v.replace(/\s+/g, "");
        else nd.name = (nd.name ? nd.name : "") + v;
      }
      if (peek() && peek().t === ":") {
        p++;
        while (peek() && peek().t === "comment") parseAnnot(toks[p++].v, nd);
        const t = toks[p++];
        if (!t || t.t !== "label") throw new Error("Expected branch length after ':'");
        const v = parseFloat(t.v);
        if (isNaN(v)) throw new Error("Bad branch length: " + t.v);
        nd.length = v;
        while (peek() && peek().t === "comment") parseAnnot(toks[p++].v, nd);
      }
      return nd;
    }
    while (peek() && peek().t === "comment") p++;
    const root = node();
    if (peek() && peek().t !== ";") throw new Error("Unexpected text after tree: '" + (peek().v || peek().t) + "'");
    return { root, meta: {} };
  }

  function parseNexus(text) {
    const trees = [];
    const tb = /begin\s+trees\s*;([\s\S]*?)end\s*;/ig;
    let m;
    while ((m = tb.exec(text))) {
      let body = m[1];
      const trans = {};
      const tm = /translate\s+([\s\S]*?);/i.exec(body);
      if (tm) {
        const items = tm[1].split(",");
        for (const it of items) {
          const mm = /^\s*(\S+)\s+(.+?)\s*$/.exec(it);
          if (mm) trans[mm[1]] = mm[2].replace(/^'(.*)'$/, "$1").replace(/''/g, "'");
        }
        body = body.replace(tm[0], "");
      }
      const tr = /tree\s+(\*\s*)?('[^']*'|\S+)\s*=\s*([\s\S]*?;)/ig;
      let t;
      while ((t = tr.exec(body))) {
        const tree = parseNewick(t[3], { underscoresToSpaces: true });
        if (Object.keys(trans).length) for (const n of tips(tree.root)) {
          const key = n.name.replace(/ /g, "_");
          if (trans[key] != null) n.name = trans[key].replace(/_/g, " ");
          else if (trans[n.name] != null) n.name = trans[n.name].replace(/_/g, " ");
        }
        tree.meta.name = t[2].replace(/^'(.*)'$/, "$1");
        trees.push(tree);
      }
    }
    if (!trees.length) throw new Error("No TREES block found in NEXUS file");
    return trees;
  }

  function parseAny(text) {
    text = text.replace(/^﻿/, "").trim();
    if (/^#nexus/i.test(text)) return parseNexus(text);
    if (/^<\?xml|<phyloxml/i.test(text)) return [parsePhyloXML(text)];
    const parts = text.split(";").map(s => s.trim()).filter(Boolean);
    return parts.map(s => parseNewick(s + ";"));
  }

  function parsePhyloXML(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const ph = doc.querySelector("phylogeny");
    if (!ph) throw new Error("No <phylogeny> element");
    const conv = (el) => {
      const nd = new TNode();
      for (const ch of el.children) {
        const tag = ch.localName;
        if (tag === "name") nd.name = ch.textContent.trim();
        else if (tag === "branch_length") nd.length = parseFloat(ch.textContent);
        else if (tag === "confidence") nd.support = ch.textContent.trim();
        else if (tag === "taxonomy" && !nd.name) { const sn = ch.querySelector("scientific_name"); if (sn) nd.name = sn.textContent.trim(); }
        else if (tag === "clade") nd.add(conv(ch));
      }
      if (el.getAttribute("branch_length")) nd.length = parseFloat(el.getAttribute("branch_length"));
      return nd;
    };
    const top = ph.querySelector(":scope > clade");
    return { root: conv(top), meta: { rooted: ph.getAttribute("rooted") !== "false" } };
  }

  /* ---------- Writers ---------- */
  function fmtNum(v, prec) {
    if (v == null || isNaN(v)) return null;
    if (prec == null) return String(+v.toPrecision(8));
    return String(+v.toFixed(prec));
  }
  function nameToken(s, style) {
    s = String(s ?? "");
    if (!s) return "";
    if (style === "underscore") {
      const u = s.trim().replace(/\s+/g, "_");
      if (/[(),:;\[\]'"]/.test(u)) return "'" + s.replace(/'/g, "''") + "'";
      return u;
    }
    if (/[\s(),:;\[\]'_"]/.test(s)) return "'" + s.replace(/'/g, "''") + "'";
    return s;
  }
  function toNewick(tree, o = {}) {
    const opt = Object.assign({ lengths: true, support: true, names: "underscore", precision: null, internalNames: true, annotations: false }, o);
    const rec = (n) => {
      let s = "";
      if (n.children.length) s = "(" + n.children.map(rec).join(",") + ")";
      if (n.isTip) s += nameToken(n.name, opt.names);
      else {
        let lab = "";
        if (opt.support && n.support != null && n.support !== "" && n !== tree.root) lab = String(n.support);
        else if (opt.internalNames && n.name) lab = nameToken(n.name, opt.names);
        s += lab;
      }
      if (opt.annotations && n.support != null && !n.isTip) s += `[&support=${n.support}]`;
      if (opt.lengths && n.length != null && n !== tree.root) s += ":" + fmtNum(n.length, opt.precision);
      else if (opt.lengths && n === tree.root && n.length) s += ":" + fmtNum(n.length, opt.precision);
      return s;
    };
    return rec(tree.root) + ";";
  }
  function toNexus(tree, o = {}) {
    const tp = tips(tree.root);
    const style = o.names || "quote";
    const names = tp.map(n => nameToken(n.name || "unnamed", style));
    const nw = toNewick(tree, Object.assign({}, o, { names: style }));
    const lines = ["#NEXUS", "", "[Exported by Treescan]", "", "BEGIN TAXA;", `\tDIMENSIONS NTAX=${tp.length};`, "\tTAXLABELS", ...names.map(n => "\t\t" + n), "\t;", "END;", "", "BEGIN TREES;",
      `\tTREE tree_1 = [&${tree.meta?.rooted === false ? "U" : "R"}] ${nw}`, "END;", ""];
    return lines.join("\n");
  }
  const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function toPhyloXML(tree, o = {}) {
    const type = o.supportType || tree.meta?.supportType || "bootstrap";
    const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<phyloxml xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.phyloxml.org http://www.phyloxml.org/1.10/phyloxml.xsd" xmlns="http://www.phyloxml.org">', `  <phylogeny rooted="${tree.meta?.rooted === false ? "false" : "true"}">`];
    const rec = (n, d) => {
      const ind = "  ".repeat(d);
      out.push(`${ind}<clade>`);
      if (n.name) out.push(`${ind}  <name>${xmlEsc(n.name)}</name>`);
      if (n.length != null && n !== tree.root) out.push(`${ind}  <branch_length>${fmtNum(n.length)}</branch_length>`);
      if (n.support != null && !n.isTip) {
        const v = parseFloat(String(n.support));
        if (!isNaN(v)) out.push(`${ind}  <confidence type="${xmlEsc(type)}">${v}</confidence>`);
      }
      for (const c of n.children) rec(c, d + 1);
      out.push(`${ind}</clade>`);
    };
    rec(tree.root, 2);
    out.push("  </phylogeny>", "</phyloxml>", "");
    return out.join("\n");
  }
  function toCSV(tree) {
    const rows = [["node_id", "parent_id", "name", "is_tip", "branch_length", "support", "root_to_node", "n_descendant_tips"]];
    const dist = new Map(); const cnt = new Map();
    for (const n of postorder(tree.root)) cnt.set(n, n.isTip ? 1 : n.children.reduce((a, c) => a + cnt.get(c), 0));
    for (const n of nodes(tree.root)) {
      dist.set(n, n.parent ? dist.get(n.parent) + (n.length || 0) : 0);
      const q = (s) => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      rows.push([n.id, n.parent ? n.parent.id : "", q(n.name || ""), n.isTip ? 1 : 0, n.length ?? "", q(n.support ?? ""), fmtNum(dist.get(n)) ?? "", cnt.get(n)]);
    }
    return rows.map(r => r.join(",")).join("\n") + "\n";
  }

  /* ---------- Serialization for undo ---------- */
  function toJSON(n) { const o = { n: n.name, l: n.length, s: n.support }; if (n.attrs) o.a = n.attrs; if (n.flag) o.f = n.flag; if (n.gx != null) o.g = [n.gx, n.gy]; if (n.px != null) o.p = n.px; if (n.children.length) o.c = n.children.map(toJSON); return o; }
  function fromJSON(o) { const n = new TNode(o.n || "", o.l ?? null, o.s ?? null); if (o.a) n.attrs = o.a; if (o.f) n.flag = o.f; if (o.g) { n.gx = o.g[0]; n.gy = o.g[1]; } if (o.p != null) n.px = o.p; if (o.c) for (const c of o.c) n.add(fromJSON(c)); return n; }
  function clone(tree) { return { root: fromJSON(toJSON(tree.root)), meta: JSON.parse(JSON.stringify(tree.meta || {})) }; }

  /* ---------- Editing ---------- */
  function spliceUnary(tree, n) {
    // remove node with single child, merging branch lengths
    if (n.children.length !== 1) return;
    const c = n.children[0];
    if (!n.parent) { c.parent = null; tree.root = c; c.length = null; return; }
    const p = n.parent;
    c.length = (n.length == null && c.length == null) ? null : (n.length || 0) + (c.length || 0);
    if (c.support == null) c.support = n.support;
    c.parent = p; p.children[p.children.indexOf(n)] = c;
  }

  function reroot(tree, node, frac = 0.5) {
    const old = tree.root;
    if (node === old || !node.parent) return false;
    const p = node.parent;
    const L = node.length;
    const nr = new TNode();
    p.children.splice(p.children.indexOf(node), 1);
    nr.add(node);
    node.length = L == null ? null : L * frac;
    let prev = nr, cur = p, curLen = L == null ? null : L * (1 - frac), curSup = null;
    while (cur) {
      const next = cur.parent, nextLen = cur.length, nextSup = cur.support;
      if (next) next.children.splice(next.children.indexOf(cur), 1);
      cur.parent = prev; prev.children.push(cur); cur.length = curLen; cur.support = curSup;
      prev = cur; curLen = nextLen; curSup = nextSup; cur = next;
    }
    // old root now hangs at the end of the path; remove it if unary
    if (old.children.length === 1) {
      const c = old.children[0], par = old.parent;
      const sup = c.support ?? old.support;
      c.length = (old.length == null && c.length == null) ? null : (old.length || 0) + (c.length || 0);
      c.support = sup; c.parent = par; par.children[par.children.indexOf(old)] = c;
    }
    // the second half of the split root branch carries the same bipartition; show support once
    tree.root = nr; nr.length = null;
    tree.meta.rooted = true;
    return true;
  }

  function distancesFrom(start) {
    // unrooted graph traversal; returns Map node -> {d, prev}
    const res = new Map([[start, { d: 0, prev: null }]]);
    const st = [start];
    while (st.length) {
      const n = st.pop(); const d = res.get(n).d;
      const nb = [...n.children.map(c => [c, c.length ?? 0])];
      if (n.parent) nb.push([n.parent, n.length ?? 0]);
      for (const [m, w] of nb) if (!res.has(m)) { res.set(m, { d: d + w, prev: n }); st.push(m); }
    }
    return res;
  }
  function midpointRoot(tree) {
    const tp = tips(tree.root);
    if (tp.length < 3) return false;
    let r = distancesFrom(tp[0]);
    let a = tp[0]; for (const t of tp) if (r.get(t).d > r.get(a).d) a = t;
    r = distancesFrom(a);
    let b = a; for (const t of tp) if (r.get(t).d > r.get(b).d) b = t;
    const D = r.get(b).d, half = D / 2;
    // walk from b towards a until passing midpoint
    let cur = b;
    while (cur) {
      const prev = r.get(cur).prev; if (!prev) break;
      const dc = r.get(cur).d, dp = r.get(prev).d;
      if (dp <= half && dc >= half) {
        // edge between cur and prev
        if (prev.parent === cur) { // edge stored on prev
          const L = prev.length || 0; const frac = L ? (half - dp) / L : 0.5;
          // frac measured from prev toward cur; reroot frac param = portion on node side
          return reroot(tree, prev, Math.min(1, Math.max(0, frac)));
        } else { // cur.parent === prev, edge stored on cur
          const L = cur.length || 0; const frac = L ? (dc - half) / L : 0.5;
          return reroot(tree, cur, Math.min(1, Math.max(0, frac)));
        }
      }
      cur = prev;
    }
    return false;
  }
  function mrca(nodesList) {
    if (!nodesList.length) return null;
    const anc = (n) => { const a = []; while (n) { a.push(n); n = n.parent; } return a; };
    let common = anc(nodesList[0]);
    for (const n of nodesList.slice(1)) { const s = new Set(anc(n)); common = common.filter(x => s.has(x)); }
    return common[0];
  }
  function rootWithOutgroup(tree, tipList) {
    let m = mrca(tipList);
    if (m === tree.root) {
      // try complement: root on ingroup instead
      const set = new Set(tipList);
      const ing = tips(tree.root).filter(t => !set.has(t));
      m = mrca(ing);
      if (m === tree.root) return false;
    }
    return reroot(tree, m, 0.5);
  }
  function rotate(n) { n.children.reverse(); }
  function mirror(n) { for (const x of nodes(n)) x.children.reverse(); }
  function tipCount(n) { return n.isTip ? 1 : n.children.reduce((a, c) => a + tipCount(c), 0); }
  function ladderize(root, asc = true) {
    const cnt = new Map(); for (const n of postorder(root)) cnt.set(n, n.isTip ? 1 : n.children.reduce((a, c) => a + cnt.get(c), 0));
    for (const n of nodes(root)) n.children.sort((x, y) => asc ? cnt.get(x) - cnt.get(y) : cnt.get(y) - cnt.get(x));
  }
  function collapse(tree, n) {
    if (n.isTip || !n.parent) return false;
    const p = n.parent, i = p.children.indexOf(n);
    for (const c of n.children) { c.parent = p; if (c.length != null || n.length != null) c.length = (c.length || 0) + (n.length || 0); }
    p.children.splice(i, 1, ...n.children);
    return true;
  }
  function collapseBelow(tree, threshold) {
    let k = 0;
    for (const n of postorder(tree.root)) {
      if (n.isTip || n === tree.root || n.support == null) continue;
      const v = parseFloat(n.support);
      if (!isNaN(v) && v < threshold) { collapse(tree, n); k++; }
    }
    return k;
  }
  function prune(tree, n) {
    if (!n.parent) return false;
    const p = n.parent; p.children.splice(p.children.indexOf(n), 1);
    if (p.children.length === 1) spliceUnary(tree, p);
    if (tree.root.children.length === 1 && !tree.root.isTip) spliceUnary(tree, tree.root);
    return true;
  }
  function extract(tree, n) { const t = { root: fromJSON(toJSON(n)), meta: Object.assign({}, tree.meta) }; t.root.length = null; return t; }
  function resolvePolytomy(n) {
    // binary resolution with zero-length branches (left-comb)
    while (n.children.length > 2) {
      const a = n.children.shift(), b = n.children.shift();
      const m = new TNode("", n.children.length || a.length != null ? 0 : null);
      m.parent = n; a.parent = m; b.parent = m; m.children = [a, b]; n.children.unshift(m);
    }
  }
  function scaleLengths(root, f) { for (const n of nodes(root)) if (n.length != null) n.length *= f; }
  function hasLengths(root) { return nodes(root).some(n => n.parent && n.length != null && n.length > 0); }
  function stats(tree) {
    const all = nodes(tree.root); const tp = all.filter(n => n.isTip);
    const internal = all.length - tp.length;
    const binary = all.every(n => n.isTip || n.children.length === 2 || (n === tree.root && n.children.length === 3));
    let total = 0; for (const n of all) if (n.parent && n.length != null) total += n.length;
    const dist = new Map(); let maxD = 0;
    for (const n of all) { const d = n.parent ? dist.get(n.parent) + (n.length || 0) : 0; dist.set(n, d); if (n.isTip) maxD = Math.max(maxD, d); }
    const sup = all.filter(n => !n.isTip && n !== tree.root && n.support != null).length;
    const dupes = []; const seen = new Set(); for (const t of tp) { if (seen.has(t.name)) dupes.push(t.name); seen.add(t.name); }
    const unnamed = tp.filter(t => !t.name).length;
    return { tips: tp.length, internal, binary, total, height: maxD, supported: sup, dupes, unnamed, hasLengths: hasLengths(tree.root) };
  }

  /* clade signatures over tip index (used to compare/transfer between trees) */
  function cladeSets(root, tipIndex) {
    const out = new Map();
    for (const n of postorder(root)) {
      if (n.isTip) out.set(n, [tipIndex.get(n)]);
      else out.set(n, n.children.flatMap(c => out.get(c)));
    }
    const key = new Map();
    for (const [n, arr] of out) key.set(n, arr.slice().sort((a, b) => a - b).join(","));
    return key;
  }

  return { TNode, nodes, tips, postorder, parseNewick, parseNexus, parsePhyloXML, parseAny, isSupportLike, toNewick, toNexus, toPhyloXML, toCSV, toJSON, fromJSON, clone,
    reroot, midpointRoot, rootWithOutgroup, mrca, rotate, mirror, ladderize, collapse, collapseBelow, prune, extract, resolvePolytomy, scaleLengths, hasLengths, stats, tipCount, cladeSets, spliceUnary };
})();
if (typeof module !== "undefined") module.exports = Tree;
