/* ===== Claude vision reader + hybrid merge ===== */
const Vision = (() => {
  let samplePromise = null;
  function getSample() {
    if (!window.claude || typeof window.claude.use !== "function") return Promise.resolve(null);
    if (!samplePromise) samplePromise = window.claude.use("sample").catch(() => null);
    return samplePromise;
  }
  async function available() {
    const s = await getSample(); if (!s) return { ok: false, why: "Claude reading works when this page is opened on claude.ai." };
    try { const l = await s.limits(); if (!l.images) return { ok: false, why: "This view can't send images to Claude." }; return { ok: true, limits: l }; }
    catch (e) { return { ok: false, why: "Claude is not available in this view." }; }
  }

  const PROMPT = (hints, nImgs) => `You are reading a phylogenetic tree figure and converting it to structured data. Accuracy matters more than speed: work through the figure systematically, clade by clade.
${nImgs > 1 ? `Image 1 is the whole figure. Images 2-${nImgs} are enlarged, overlapping horizontal bands of the same figure (top to bottom) so small labels can be read. Give all coordinates relative to image 1.` : ""}
${hints.layout && hints.layout !== "auto" ? `The user says the layout is: ${hints.layout}.` : ""}${hints.rootSide && hints.rootSide !== "auto" ? ` The root is on the ${hints.rootSide}.` : ""}${hints.note ? ` User note: ${hints.note}` : ""}${hints.texts && hints.texts.length ? `\nThe figure came from a PDF. These are the exact text strings embedded in it (use them for spelling; not all are taxa): ${JSON.stringify(hints.texts).slice(0, 8000)}` : ""}

Reply with ONLY one JSON object, no prose, in exactly this shape:
{
  "layout": "rectangular" | "cladogram" | "circular" | "unrooted" | "slanted" | "other",
  "root_side": "left" | "right" | "top" | "bottom" | "center" | "none",
  "rooted": true | false,
  "support_kind": "bootstrap" | "posterior" | "bootstrap/posterior" | "other" | "none",
  "scale_bar": { "value": 0.05, "units": "substitutions/site", "len": 112 } | null,
  "tree": NODE,
  "notes": "one or two sentences about anything unusual",
  "uncertain": ["short descriptions of labels or clades you were unsure about"]
}
NODE = { "n": "label", "s": "support or null", "l": null, "p": 0, "c": [NODE, ...] }
Rules for NODE:
- "n": tip labels exactly as printed (genus, species, strain, accession numbers, everything on the line). Plain text, no italics markup. Internal nodes: "" unless a clade name is printed at the node. Unreadable characters: use "?" for each and list the tip in "uncertain".
- "s": the support value printed at that internal node exactly as shown (e.g. "98", "0.99", "95/1.00", "*"). null for tips, the root, or when none is shown. Do not invent values.
- "l": a branch length only if a number is printed on that branch, else null.
- "p": the node's position along the root-to-tip axis, measured from the root, in thousandths of image 1's width (0 = root). For a rectangular tree with the root on the left this is the x position of the node's vertical bar (or a tip's branch end) minus the root's x. For circular trees use the distance from the centre. Estimate carefully against the scale bar and neighbouring nodes; this is how branch lengths are computed.
- "c": children ordered as drawn: top to bottom (root left or right), left to right (root top or bottom), or clockwise from 12 o'clock (circular). Tips have "c": [].
- Taxon labels are often joined to their tips by dotted or dashed leader lines, sometimes with all labels aligned in one column far from the tips. Follow each leader line along its row to pair every label with the right tip; the tip is where the solid branch ends (often marked by a dot), not where the label starts.
- Taxa that sit directly on a vertical line (a dot on the line, no branch of their own) are children with a near-zero branch: place them in that node's children at their drawn position.
- Keep polytomies as nodes with more than two children. A collapsed clade drawn as a triangle or box becomes one tip whose name is its label.
- "scale_bar.len" is the bar's length in the same thousandths-of-width units as "p". null if there is no scale bar.
- Include every tip. Count the tips before answering and make sure the JSON has the same number.`;

  async function tiles(blob, maxCount) {
    if (maxCount < 2) return [blob];
    const bmp = await createImageBitmap(blob);
    const W = bmp.width, H = bmp.height;
    const out = [blob];
    const need = Math.min(maxCount - 1, Math.ceil((W * H) / 1.2e6 * 0.6), Math.max(1, Math.round(H / (W * 0.9))));
    if (need < 2 && W * H < 1.8e6) return out;
    const n = Math.max(2, need);
    const band = H / n, ov = band * 0.12;
    for (let i = 0; i < n && out.length < maxCount; i++) {
      const y0 = Math.max(0, Math.floor(i * band - ov)), y1 = Math.min(H, Math.ceil((i + 1) * band + ov));
      const c = document.createElement("canvas"); c.width = W; c.height = y1 - y0;
      const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, W, c.height); x.drawImage(bmp, 0, y0, W, y1 - y0, 0, 0, W, y1 - y0);
      out.push(await new Promise(r => c.toBlob(r, "image/png")));
    }
    return out;
  }

  function toTree(j) {
    if (!j || typeof j !== "object" || !j.tree) throw new Error("Claude's answer did not contain a tree.");
    const sb = j.scale_bar && +j.scale_bar.value > 0 && +j.scale_bar.len > 0 ? { value: +j.scale_bar.value, len: +j.scale_bar.len, units: j.scale_bar.units || "" } : null;
    const clado = j.layout === "cladogram";
    let anyP = false;
    const conv = (o, parentP) => {
      const n = new Tree.TNode(String(o.n ?? o.name ?? "").trim());
      const s = o.s ?? o.support;
      if (s != null && s !== "" && String(s).toLowerCase() !== "null") n.support = String(s).trim();
      const p = o.p != null && !isNaN(+o.p) ? +o.p : null;
      if (p != null) anyP = true;
      n.cp = p;
      if (parentP !== undefined) {
        if (o.l != null && !isNaN(+o.l)) { n.length = +o.l; n.attrs = { printed_length: String(o.l) }; }
        else if (!clado && p != null && parentP != null) { const d = Math.max(0, p - parentP); n.length = sb ? d / sb.len * sb.value : d / 1000; n.flag = "estimated"; }
      }
      for (const c of (o.c || o.children || [])) n.add(conv(c, p));
      return n;
    };
    const root = conv(j.tree, undefined);
    const tree = { root, meta: { source: "claude", layout: j.layout, rootSide: j.root_side, rooted: j.rooted !== false, supportType: j.support_kind, scale: sb, lengthUnits: clado ? "none" : sb ? (sb.units || "scale-bar units") : anyP ? "relative" : "none" } };
    for (const n of Tree.postorder(root)) if (!n.isTip && n.children.length === 1 && n.parent) Tree.spliceUnary(tree, n);
    if (tree.meta.lengthUnits === "relative") {
      const st = Tree.stats(tree); if (st.height > 0) Tree.scaleLengths(root, 1 / st.height);
    }
    return { tree, notes: j.notes || "", uncertain: Array.isArray(j.uncertain) ? j.uncertain : [] };
  }

  async function read(blob, hints = {}, onText, signal) {
    const sample = await getSample();
    if (!sample) throw { code: "unavailable", message: "Claude reading works when this page is opened on claude.ai." };
    const lim = await sample.limits();
    const imgs = await tiles(blob, lim.images ? Math.min(4, lim.images.maxCount) : 1);
    const opts = { images: imgs, modelTier: hints.tier || "complex", signal, onText: onText ? ({ text }) => onText(text.length) : undefined };
    if (hints.effort) opts.effort = hints.effort;
    const j = await sample.json(PROMPT(hints, imgs.length), opts);
    return toTree(j);
  }

  /* ---- hybrid: copy pixel-measured lengths onto Claude's topology ---- */
  function tipOrder(tree) { return Tree.tips(tree.root); }
  function matchScore(ta, tb, order) {
    // order: index map for tb tips -> index in ta order
    const ia = new Map(tipOrder(ta).map((n, i) => [n, i]));
    const ib = new Map(tipOrder(tb).map((n, i) => [n, order[i]]));
    const ka = Tree.cladeSets(ta.root, ia), kb = Tree.cladeSets(tb.root, ib);
    const inv = new Map(); for (const [n, k] of kb) if (!n.isTip) inv.set(k, n);
    let hit = 0, tot = 0; const pairs = new Map();
    for (const [n, k] of ka) { if (n.isTip) { continue; } tot++; if (inv.has(k)) { hit++; pairs.set(n, inv.get(k)); } }
    // tips map by order
    const tb2 = tipOrder(tb); tipOrder(ta).forEach((t, i) => { const j = order.indexOf(i); if (j >= 0) pairs.set(t, tb2[j]); });
    return { hit, tot, pairs };
  }
  function merge(ct, local, circular) {
    const A = tipOrder(ct), B = tipOrder(local.tree);
    if (A.length !== B.length) return { ok: false, why: `Claude found ${A.length} tips and the line tracer found ${B.length}, so lengths were not transferred.` };
    const n = A.length; let best = null;
    const tryOrder = (order) => { const r = matchScore(ct, local.tree, order); if (!best || r.hit > best.hit) best = r; };
    const base = [...Array(n).keys()];
    const shifts = circular ? n : 1;
    for (let s = 0; s < shifts; s++) {
      tryOrder(base.map(i => (i + s) % n));
      tryOrder(base.map(i => (n - 1 - i + s) % n));
    }
    if (!best || best.hit < 0.6 * best.tot) return { ok: false, why: `The traced lines and Claude's reading disagree on the branching (${best ? best.hit : 0} of ${best ? best.tot : 0} clades match), so Claude's estimated lengths were kept.` };
    // px per unit
    const sb = ct.meta.scale; const lscale = local.tree.meta.scale;
    let ppu = null;
    if (sb && lscale && lscale.px) ppu = lscale.px / sb.value;
    if (!ppu) {
      const r = []; for (const [a, b] of best.pairs) if (a.length > 0 && b.px > 0 && a.flag === "estimated") r.push(b.px / a.length);
      if (r.length >= 3) ppu = r.sort((x, y) => x - y)[Math.floor(r.length / 2)];
    }
    let moved = 0;
    for (const [a, b] of best.pairs) {
      if (a === ct.root || b.px == null) continue;
      if (a.attrs && a.attrs.printed_length) continue;
      a.length = ppu ? b.px / ppu : b.px; a.flag = null; a.gx = b.gx; a.gy = b.gy; moved++;
    }
    if (!ppu || (!sb && ct.meta.lengthUnits === "relative")) { ct.meta.lengthUnits = "relative"; const st = Tree.stats(ct); if (st.height > 0) Tree.scaleLengths(ct.root, 1 / st.height); }
    return { ok: true, matched: best.hit, total: best.tot, moved, ppu };
  }

  return { available, read, toTree, merge, PROMPT };
})();
