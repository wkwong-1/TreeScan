/* ===== UI ===== */
(() => {
  const $ = (id) => document.getElementById(id);
  const S = {
    tree: null, undo: [], redo: [], sel: new Set(), primary: null,
    view: { mode: "rect", sup: true, len: false, nodes: false, font: 13, zoom: 1, find: "" },
    img: null,        // {blob, name, data: ImageData (oriented), canvas, rot}
    engine: "hybrid", center: null, picking: false, last: null, abort: null, example: false,
  };
  const inViewer = !!(window.claude && typeof window.claude.use === "function");
  let downloads = null;
  if (inViewer) window.claude.use("downloads").then(d => { downloads = d; }).catch(() => {});

  /* ---------- helpers ---------- */
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 2600); }
  function setStatus(msg, p) { $("status").textContent = msg || ""; $("prog").style.width = p == null ? "0" : Math.round(p * 100) + "%"; }
  function notes(list) { $("notes").innerHTML = list.map(n => `<li class="${n.kind || ""}">${esc(n.text)}</li>`).join(""); }
  const fmt = (v) => v == null ? "" : String(+(+v).toPrecision(6));
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast("Copied"); }
    catch (e) { toast("Copy was blocked here. Select the text and copy it yourself."); }
  }

  /* ---------- tree state ---------- */
  function setTree(t, { keepUndo = false, label } = {}) {
    if (S.tree && !keepUndo) { S.undo.push(snap()); if (S.undo.length > 80) S.undo.shift(); S.redo = []; }
    S.tree = t; S.sel.clear(); S.primary = null; S.example = false;
    refresh();
  }
  const snap = () => JSON.stringify({ r: Tree.toJSON(S.tree.root), m: S.tree.meta });
  const unsnap = (s) => { const o = JSON.parse(s); return { root: Tree.fromJSON(o.r), meta: o.m }; };
  function edit(fn, msg) {
    if (!S.tree) return;
    const before = snap();
    const keepId = S.primary ? S.primary.id : null;
    const r = fn(S.tree);
    if (r === false) { if (msg) toast("That edit isn't possible here"); return; }
    S.undo.push(before); if (S.undo.length > 80) S.undo.shift(); S.redo = [];
    if (r && r.tree) S.tree = r.tree;
    // keep the selection if the node still exists
    if (keepId) { const n = Tree.nodes(S.tree.root).find(x => x.id === keepId); S.primary = n || null; if (!n) S.sel.clear(); }
    refresh();
    if (msg) toast(msg);
  }
  function undo() { if (!S.undo.length) return; S.redo.push(snap()); S.tree = unsnap(S.undo.pop()); S.sel.clear(); S.primary = null; refresh(); }
  function redo() { if (!S.redo.length) return; S.undo.push(snap()); S.tree = unsnap(S.redo.pop()); S.sel.clear(); S.primary = null; refresh(); }

  function refresh() {
    $("bUndo").disabled = !S.undo.length; $("bRedo").disabled = !S.redo.length; $("bExport").disabled = !S.tree;
    renderTree(); renderInspector(); renderTaxa(); renderStats();
    $("nwkOut").value = S.tree ? Tree.toNewick(S.tree) : "";
    drawImage();
  }

  /* ---------- layout & drawing ---------- */
  function layout(tree, mode) {
    const tips = Tree.tips(tree.root);
    const useLen = mode !== "clado" && Tree.hasLengths(tree.root);
    const pos = new Map();
    const depth = new Map(), height = new Map();
    for (const n of Tree.postorder(tree.root)) height.set(n, n.isTip ? 0 : 1 + Math.max(...n.children.map(c => height.get(c))));
    const H = height.get(tree.root);
    for (const n of Tree.nodes(tree.root)) {
      if (useLen) depth.set(n, n.parent ? depth.get(n.parent) + Math.max(0, n.length || 0) : 0);
      else depth.set(n, H - height.get(n));
    }
    tips.forEach((t, i) => pos.set(t, i));
    for (const n of Tree.postorder(tree.root)) if (!n.isTip) { const c = n.children; pos.set(n, (pos.get(c[0]) + pos.get(c[c.length - 1])) / 2); }
    const maxD = Math.max(1e-12, ...tips.map(t => depth.get(t)));
    return { tips, pos, depth, maxD, useLen };
  }
  function textW(s, f) { return (s || "").length * f * 0.52 + 4; }
  function niceScale(maxD) { const raw = maxD / 5, p = Math.pow(10, Math.floor(Math.log10(raw))); const m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }

  function inSubtree(n) { if (!S.primary || S.primary.isTip) return false; let x = n; while (x) { if (x === S.primary) return true; x = x.parent; } return false; }

  function renderTree() {
    const cv = $("canvas");
    cv.querySelectorAll("svg").forEach(e => e.remove());
    $("empty").hidden = !!S.tree;
    if (!S.tree) return;
    const v = S.view, f = v.font, mode = v.mode;
    const L = layout(S.tree, mode);
    const find = v.find.trim().toLowerCase();
    const maxLab = Math.max(40, ...L.tips.map(t => textW(t.name || "unnamed", f)));
    const parts = [];
    const supTxt = (n) => v.sup && !n.isTip && n.support != null && n !== S.tree.root ? String(n.support) : "";
    const lenTxt = (n) => v.len && n.parent && n.length != null ? fmt(n.length) : "";
    const tipCls = (t) => "tip" + (!t.name ? " unnamed" : "") + (t.flag === "check" ? " flag" : "") + (S.sel.has(t) ? " on" : "") + (find && t.name.toLowerCase().includes(find) ? " match" : "");
    let W, Hh;
    if (mode !== "circ") {
      const row = Math.max(f * 1.45, 8) * v.zoom;
      const availW = Math.max(320, cv.clientWidth - 30);
      const plotW = Math.max(160, (availW - maxLab - 40) * Math.max(0.4, Math.min(2.5, v.zoom)));
      const sx = plotW / L.maxD, x0 = 20, y0 = 24;
      const X = (n) => x0 + L.depth.get(n) * sx, Y = (n) => y0 + L.pos.get(n) * row;
      W = x0 + plotW + maxLab + 30; Hh = y0 + L.tips.length * row + 50;
      for (const n of Tree.nodes(S.tree.root)) {
        const on = inSubtree(n) ? " in" : "";
        if (n.parent) {
          const d = `M${X(n.parent).toFixed(1)},${Y(n).toFixed(1)}H${X(n).toFixed(1)}`;
          parts.push(`<g class="${on}"><path class="hit" data-id="${n.id}" d="${d}"/><path class="br${n.flag === "estimated" ? " est" : ""}${S.primary === n ? " hov" : ""}" d="${d}"/></g>`);
          const lt = lenTxt(n); if (lt) parts.push(`<text class="len" x="${((X(n.parent) + X(n)) / 2).toFixed(1)}" y="${(Y(n) - 3).toFixed(1)}" font-size="${f * 0.72}" text-anchor="middle">${lt}</text>`);
        }
        if (!n.isTip) {
          const c = n.children;
          parts.push(`<g class="${on}"><path class="br" d="M${X(n).toFixed(1)},${Y(c[0]).toFixed(1)}V${Y(c[c.length - 1]).toFixed(1)}"/></g>`);
          const st = supTxt(n); if (st) parts.push(`<text class="sup" x="${(X(n) - 3).toFixed(1)}" y="${(Y(n) - 3).toFixed(1)}" font-size="${f * 0.75}" text-anchor="end">${esc(st)}</text>`);
          if (v.nodes || S.primary === n) parts.push(`<circle class="node${S.primary === n ? " on" : ""}" data-id="${n.id}" cx="${X(n).toFixed(1)}" cy="${Y(n).toFixed(1)}" r="3.6"/>`);
          else parts.push(`<circle class="hit" data-id="${n.id}" cx="${X(n).toFixed(1)}" cy="${Y(n).toFixed(1)}" r="5" style="stroke-width:0;fill:transparent"/>`);
        } else {
          parts.push(`<text class="${tipCls(n)}" data-id="${n.id}" x="${(X(n) + 5).toFixed(1)}" y="${Y(n).toFixed(1)}" dy=".34em" font-size="${f}">${esc(n.name || "unnamed")}</text>`);
        }
      }
      if (L.useLen) {
        const sv = niceScale(L.maxD), y = Hh - 22;
        parts.push(`<g class="scale"><line x1="${x0}" x2="${(x0 + sv * sx).toFixed(1)}" y1="${y}" y2="${y}"/><text x="${x0}" y="${y + 15}" font-size="${f * 0.75}">${fmt(sv)}${S.tree.meta.lengthUnits && !/relative|none|scale-bar/.test(S.tree.meta.lengthUnits) ? " " + esc(S.tree.meta.lengthUnits) : ""}</text></g>`);
      }
    } else {
      const n = L.tips.length;
      const base = Math.max(140, n * f * 1.25 / (2 * Math.PI)) * v.zoom;
      const R = base, pad = maxLab + 20;
      W = Hh = 2 * (R + pad);
      const cx = W / 2, cy = Hh / 2, span = 2 * Math.PI * (n > 2 ? (n - 0.4) / n : 0.9);
      const A = (node) => -Math.PI / 2 + L.pos.get(node) / Math.max(1, n) * span;
      const Rr = (node) => L.depth.get(node) / L.maxD * R;
      const P = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      for (const nd of Tree.nodes(S.tree.root)) {
        const on = inSubtree(nd) ? " in" : "";
        if (nd.parent) {
          const a = A(nd), [x1, y1] = P(Rr(nd.parent), a), [x2, y2] = P(Rr(nd), a);
          const d = `M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}`;
          parts.push(`<g class="${on}"><path class="hit" data-id="${nd.id}" d="${d}"/><path class="br${nd.flag === "estimated" ? " est" : ""}" d="${d}"/></g>`);
        }
        if (!nd.isTip) {
          const c = nd.children, a0 = A(c[0]), a1 = A(c[c.length - 1]), r = Rr(nd);
          const [x0, y0] = P(r, a0), [x1, y1] = P(r, a1);
          parts.push(`<g class="${on}"><path class="br" d="M${x0.toFixed(1)},${y0.toFixed(1)}A${r.toFixed(1)},${r.toFixed(1)} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}"/></g>`);
          const [nx, ny] = P(r, A(nd));
          const st = supTxt(nd); if (st) parts.push(`<text class="sup" x="${nx.toFixed(1)}" y="${(ny - 3).toFixed(1)}" font-size="${f * 0.7}" text-anchor="middle">${esc(st)}</text>`);
          parts.push(`<circle class="${v.nodes || S.primary === nd ? "node" + (S.primary === nd ? " on" : "") : "hit"}" data-id="${nd.id}" cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="${v.nodes || S.primary === nd ? 3.4 : 5}" ${v.nodes || S.primary === nd ? "" : 'style="stroke-width:0;fill:transparent"'}/>`);
        } else {
          const a = A(nd), [tx, ty] = P(Rr(nd) + 5, a), deg = a * 180 / Math.PI;
          const flip = Math.cos(a) < 0;
          parts.push(`<text class="${tipCls(nd)}" data-id="${nd.id}" x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" dy=".34em" font-size="${f}" text-anchor="${flip ? "end" : "start"}" transform="rotate(${(flip ? deg + 180 : deg).toFixed(2)} ${tx.toFixed(1)} ${ty.toFixed(1)})">${esc(nd.name || "unnamed")}</text>`);
        }
      }
      if (L.useLen) { const sv = niceScale(L.maxD); parts.push(`<g class="scale"><line x1="20" x2="${(20 + sv / L.maxD * R).toFixed(1)}" y1="${Hh - 20}" y2="${Hh - 20}"/><text x="20" y="${Hh - 6}" font-size="${f * 0.75}">${fmt(sv)}</text></g>`); }
    }
    const svg = `<svg class="tv${mode === "circ" ? " circ" : ""}" xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(W)}" height="${Math.ceil(Hh)}" viewBox="0 0 ${Math.ceil(W)} ${Math.ceil(Hh)}" font-family="${getComputedStyle(document.body).fontFamily.replace(/"/g, "'")}">${parts.join("")}</svg>`;
    cv.insertAdjacentHTML("beforeend", svg);
  }

  function exportSVG() {
    const svg = $("canvas").querySelector("svg"); if (!svg) return "";
    const cs = getComputedStyle(document.documentElement);
    const css = `.br{stroke:#222;stroke-width:1.4;fill:none;stroke-linecap:square}.br.est{stroke-dasharray:4 3}.hit{display:none}.tip{font-family:'Source Serif 4',Georgia,serif;font-style:italic;fill:#111}.sup{font-family:'JetBrains Mono',monospace;fill:#8a5a10}.len{font-family:'JetBrains Mono',monospace;fill:#555}.node{fill:#fff;stroke:#222}.scale line{stroke:#222;stroke-width:1.4}.scale text{font-family:'JetBrains Mono',monospace;fill:#444}`;
    const clone = svg.cloneNode(true);
    clone.querySelectorAll(".hit").forEach(e => e.remove());
    clone.querySelectorAll(".in,.on,.match,.hov").forEach(e => e.classList.remove("in", "on", "match", "hov"));
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style"); style.textContent = css; clone.prepend(style);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + clone.outerHTML;
  }

  /* ---------- selection & inspector ---------- */
  function byId(id) { return S.tree ? Tree.nodes(S.tree.root).find(n => n.id === +id) : null; }
  $("canvas").addEventListener("click", (e) => {
    const el = e.target.closest("[data-id]");
    if (!el) { if (e.target.closest("svg")) { S.sel.clear(); S.primary = null; renderTree(); renderInspector(); renderTaxa(); drawImage(); } return; }
    const n = byId(el.dataset.id); if (!n) return;
    if (e.shiftKey && n.isTip) { if (S.sel.has(n)) S.sel.delete(n); else S.sel.add(n); S.primary = n; }
    else { S.sel.clear(); if (n.isTip) S.sel.add(n); S.primary = n; }
    renderTree(); renderInspector(); renderTaxa(); drawImage();
  });
  function renderInspector() {
    const n = S.primary;
    $("selForm").hidden = $("selActs").hidden = !n;
    if (!n) { $("selHint").textContent = S.tree ? "Click a branch, node or taxon. Shift-click taxa to pick an outgroup." : "Nothing loaded yet."; return; }
    const kind = n === S.tree.root ? "Root" : n.isTip ? "Taxon" : `Clade of ${Tree.tipCount(n)} taxa`;
    $("selHint").textContent = S.sel.size > 1 ? `${S.sel.size} taxa selected` : kind + (n.flag === "estimated" ? " · length estimated by Claude" : n.flag === "check" ? " · name read with low confidence" : "");
    $("iName").value = n.name || ""; $("iLen").value = n.length == null ? "" : +n.length.toPrecision(8); $("iSup").value = n.support ?? "";
    $("iSup").disabled = n.isTip; $("iLen").disabled = n === S.tree.root;
    const multi = S.sel.size > 1;
    for (const b of $("selActs").querySelectorAll("button")) {
      const a = b.dataset.act;
      b.disabled = (a === "reroot" && (n === S.tree.root || multi)) || (a === "outgroup" && !S.sel.size) || (["flip", "mirror", "ladderUp", "resolve"].includes(a) && n.isTip && !n.parent)
        || (a === "collapse" && (n.isTip || n === S.tree.root)) || (a === "resolve" && n.children.length < 3) || (a === "extract" && (n.isTip || n === S.tree.root)) || (a === "prune" && n === S.tree.root);
    }
  }
  const commitField = (field) => (e) => {
    const n = S.primary; if (!n) return;
    const raw = e.target.value.trim();
    edit(() => {
      if (field === "name") n.name = raw;
      if (field === "len") { n.length = raw === "" ? null : +raw; n.flag = null; }
      if (field === "sup") n.support = raw === "" ? null : raw;
      if (field === "name" && n.flag === "check") n.flag = null;
    });
  };
  $("iName").addEventListener("change", commitField("name"));
  $("iLen").addEventListener("change", commitField("len"));
  $("iSup").addEventListener("change", commitField("sup"));

  function act(a) {
    const n = S.primary;
    switch (a) {
      case "reroot": return edit(t => Tree.reroot(t, n, 0.5), "Rerooted");
      case "outgroup": return edit(t => Tree.rootWithOutgroup(t, [...S.sel].length ? [...S.sel] : [n]), "Rooted on outgroup");
      case "flip": return edit(() => { Tree.rotate(n.isTip ? n.parent : n); }, "Flipped");
      case "mirror": return edit(() => { Tree.mirror(n.isTip ? n.parent : n); }, "Flipped clade");
      case "ladderUp": return edit(() => { Tree.ladderize(n.isTip ? n.parent : n, true); });
      case "collapse": return edit(t => Tree.collapse(t, n), "Collapsed into a polytomy");
      case "resolve": return edit(() => { Tree.resolvePolytomy(n); });
      case "extract": return edit(t => ({ tree: Tree.extract(t, n) }), "Kept the selected clade");
      case "prune": return edit(t => { const list = S.sel.size > 1 ? [...S.sel] : [n]; let ok = false; for (const x of list) ok = Tree.prune(t, x) || ok; S.sel.clear(); S.primary = null; return ok; }, "Deleted");
      case "midpoint": return edit(t => Tree.hasLengths(t.root) ? Tree.midpointRoot(t) : false, "Midpoint rooted");
      case "ladderAsc": return edit(t => { Tree.ladderize(t.root, true); });
      case "ladderDesc": return edit(t => { Tree.ladderize(t.root, false); });
      case "collapseWeak": { const th = +$("nCollapse").value; let k = 0; edit(t => { k = Tree.collapseBelow(t, th); return k > 0; }); toast(k ? `Collapsed ${k} branch${k > 1 ? "es" : ""}` : "No branches below that support"); return; }
      case "calibrate": return openCal();
    }
  }
  document.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", () => act(b.dataset.act)));

  function renderTaxa() {
    const box = $("taxa");
    if (!S.tree) { box.innerHTML = ""; $("taxaCount").textContent = "0"; return; }
    const tips = Tree.tips(S.tree.root);
    $("taxaCount").textContent = tips.length;
    box.innerHTML = tips.map((t, i) => `<div class="t${t.flag === "check" ? " flag" : ""}${S.sel.has(t) ? " on" : ""}"><span>${i + 1}</span><input type="text" id="tx${t.id}" data-id="${t.id}" value="${esc(t.name)}" placeholder="unnamed" aria-label="Taxon ${i + 1}"></div>`).join("");
  }
  $("taxa").addEventListener("change", (e) => { const n = byId(e.target.dataset.id); if (!n) return; const v = e.target.value.trim(); edit(() => { n.name = v; if (n.flag === "check") n.flag = null; }); });
  $("taxa").addEventListener("focusin", (e) => { const n = byId(e.target.dataset.id); if (!n) return; S.sel.clear(); S.sel.add(n); S.primary = n; renderTree(); renderInspector(); drawImage(); });

  function renderStats() {
    if (!S.tree) { $("stats").innerHTML = ""; return; }
    const st = Tree.stats(S.tree);
    const u = S.tree.meta.lengthUnits;
    const items = [[st.tips, "taxa"], [st.internal, "internal nodes"], [st.supported, "with support"], [st.binary ? "yes" : "no", "fully bifurcating"],
      [st.hasLengths ? fmt(st.height) : "–", "root-to-tip" + (u && st.hasLengths ? ` (${u})` : "")], [st.hasLengths ? fmt(st.total) : "–", "tree length"]];
    $("stats").innerHTML = items.map(([a, b]) => `<div class="stat"><b>${esc(a)}</b><span>${esc(b)}</span></div>`).join("") +
      (st.dupes.length ? `<div class="stat" style="grid-column:1/-1"><span style="color:var(--danger)">Duplicate names: ${esc(st.dupes.slice(0, 4).join(", "))}${st.dupes.length > 4 ? "…" : ""}. Many programs reject these.</span></div>` : "") +
      (st.unnamed ? `<div class="stat" style="grid-column:1/-1"><span style="color:var(--danger)">${st.unnamed} unnamed taxa. Name them before exporting.</span></div>` : "");
  }

  /* ---------- view controls ---------- */
  function seg(id, cb) { const el = $(id); el.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; el.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); cb(b.dataset.v); }); }
  seg("segView", (v) => { S.view.mode = v; renderTree(); });
  seg("segEngine", (v) => { S.engine = v; engineHint(); });
  $("cSup").onchange = (e) => { S.view.sup = e.target.checked; renderTree(); };
  $("cLen").onchange = (e) => { S.view.len = e.target.checked; renderTree(); };
  $("cNodes").onchange = (e) => { S.view.nodes = e.target.checked; renderTree(); };
  $("rFont").oninput = (e) => { S.view.font = +e.target.value; renderTree(); };
  $("rZoom").oninput = (e) => { S.view.zoom = +e.target.value / 100; renderTree(); };
  $("tFind").oninput = (e) => { S.view.find = e.target.value; renderTree(); };
  window.addEventListener("resize", () => { clearTimeout(S._rs); S._rs = setTimeout(renderTree, 120); });
  $("sLayout").onchange = () => { $("centerRow").hidden = $("sLayout").value !== "circular"; };

  let visionOK = null;
  async function engineHint() {
    if (visionOK === null) visionOK = await Vision.available();
    const h = $("engineHint");
    $("tierRow").hidden = S.engine === "local"; $("tNote").hidden = S.engine === "local";
    if (S.engine === "local") h.textContent = "Runs entirely in your browser: traces the lines and reads text with Tesseract. Best for clean rectangular and circular trees.";
    else if (!visionOK.ok) h.textContent = visionOK.why + (S.engine === "hybrid" ? " Hybrid will fall back to the local reader." : " Choose Hybrid or Local here.");
    else h.textContent = S.engine === "hybrid" ? "Claude reads labels, support values and branching; the line tracer then measures exact branch lengths. Uses your Claude usage." : "Claude reads everything, including estimated branch lengths. Works on any layout. Uses your Claude usage.";
  }

  /* ---------- image handling ---------- */
  async function loadImage(blob, name, keepPdf) {
    try {
      const bmp = await createImageBitmap(blob);
      let w = bmp.width, h = bmp.height;
      const maxSide = 3200; const k = Math.min(1, maxSide / Math.max(w, h));
      w = Math.round(w * k); h = Math.round(h * k);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(bmp, 0, 0, w, h);
      S.img = { blob, name: name || "figure", base: c, rot: 0, overlay: null, words: null, texts: null };
      if (!keepPdf) { S.pdf = null; $("pdfRow").hidden = true; }
      S.center = null; $("centerVal").textContent = "auto";
      $("bRead").disabled = false; $("ovRow").hidden = false;
      setStatus(`${name || "Image"} · ${bmp.width}×${bmp.height}px`); notes([]);
      return k;
      drawImage();
    } catch (e) { toast("That file couldn't be opened as an image."); }
  }
  async function loadPDF(file) {
    try {
      setStatus("Opening the PDF", 0.1);
      const doc = await PDFIn.open(file);
      S.pdf = { doc, name: file.name, page: 1 };
      $("nPage").max = doc.numPages; $("nPage").value = 1;
      $("pdfInfo").textContent = `of ${doc.numPages}`;
      await showPdfPage(1);
    } catch (e) { setStatus(""); notes([{ kind: "err", text: "Couldn't open that PDF: " + (e.message || e) }]); }
  }
  async function showPdfPage(n) {
    const P = S.pdf; if (!P) return;
    setStatus(`Rendering page ${n}`, 0.3);
    const r = await PDFIn.render(P.doc, n);
    const blob = await new Promise(res => r.canvas.toBlob(res, "image/png"));
    const k = await loadImage(blob, `${P.name.replace(/\.pdf$/i, "")}${P.doc.numPages > 1 ? " p" + n : ""}.png`, true);
    // keep the PDF's own text, in the same pixel space as the (possibly downscaled) image
    S.img.words = r.words.map(w => Object.assign({}, w, { x0: w.x0 * k, x1: w.x1 * k, y0: w.y0 * k, y1: w.y1 * k, cx: w.cx * k, cy: w.cy * k, len: w.len * k, h: w.h * k }));
    S.img.texts = [...new Set(r.words.map(w => w.text))];
    $("pdfRow").hidden = P.doc.numPages < 2;
    setStatus(`${P.name} · page ${n} of ${P.doc.numPages}` + (r.words.length ? ` · ${r.words.length} text items found, used instead of OCR` : " · no embedded text, labels will be read by OCR"));
  }
  $("nPage").onchange = (e) => { const n = Math.max(1, Math.min(+e.target.value || 1, S.pdf ? S.pdf.doc.numPages : 1)); e.target.value = n; showPdfPage(n); };
  const isPdf = (f) => f && (f.type === "application/pdf" || /\.pdf$/i.test(f.name || ""));
  function openFile(f) { if (isPdf(f)) loadPDF(f); else if (f.type.startsWith("image/")) loadImage(f, f.name); else f.text().then(t => loadTreeText(t, f.name)); }

  function orientedCanvas(rot) {
    const b = S.img.base; if (!rot) return b;
    const c = document.createElement("canvas"); const sw = rot % 180 !== 0;
    c.width = sw ? b.height : b.width; c.height = sw ? b.width : b.height;
    const x = c.getContext("2d"); x.translate(c.width / 2, c.height / 2); x.rotate(rot * Math.PI / 180); x.drawImage(b, -b.width / 2, -b.height / 2);
    return c;
  }
  function drawImage() {
    const d = $("drop");
    if (!S.img) { d.classList.remove("has"); d.querySelector("canvas")?.remove(); $("dropMsg").hidden = false; return; }
    d.classList.add("has"); $("dropMsg").hidden = true;
    let c = d.querySelector("canvas"); if (!c) { c = document.createElement("canvas"); d.prepend(c); }
    const src = orientedCanvas(S.img.rot);
    c.width = src.width; c.height = src.height;
    const x = c.getContext("2d"); x.drawImage(src, 0, 0);
    const ov = S.img.overlay;
    if (ov && $("cOverlay").checked) {
      const lw = Math.max(1.5, src.width / 500);
      x.lineWidth = lw; x.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--overlay").trim() || "red";
      const sp = ov.space;
      const line = (a, b, c2, d2) => { const [p, q] = sp.toImg(a, b), [r, s] = sp.toImg(c2, d2); x.beginPath(); x.moveTo(p, q); x.lineTo(r, s); x.stroke(); };
      (function walk(g) {
        for (const ch of g.children) { const y = ch.inY ?? ch.y; if (sp.kind === "polar") { for (let k = 0; k < 1; k++) line(g.x, y, ch.x, y); } else line(g.x, y, ch.x, y); walk(ch); }
        if (!g.tip && g.children.length) {
          const y0 = g.children[0].inY ?? g.children[0].y, y1 = g.children[g.children.length - 1].inY ?? g.children[g.children.length - 1].y;
          if (sp.kind === "polar") { const st = Math.max(1, (y1 - y0) / 40); for (let y = y0; y < y1; y += st) line(g.x, y, g.x, Math.min(y1, y + st)); }
          else line(g.x, y0, g.x, y1);
        }
      })(ov.asm.root);
      x.fillStyle = x.strokeStyle;
      (function dots(g) { if (g.tip) { const [p, q] = sp.toImg(g.x, g.y); x.beginPath(); x.arc(p, q, lw * 1.6, 0, 7); x.fill(); } g.children.forEach(dots); })(ov.asm.root);
    }
    if (S.primary && S.primary.gx != null && S.img.overlay) {
      const [p, q] = S.img.overlay.space.toImg(S.primary.gx, S.primary.gy);
      x.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(); x.lineWidth = Math.max(2, src.width / 300);
      x.beginPath(); x.arc(p, q, Math.max(8, src.width / 60), 0, 7); x.stroke();
    }
    if (S.center && $("sLayout").value === "circular") { x.fillStyle = "#1d6a4d"; x.beginPath(); x.arc(S.center.cx, S.center.cy, Math.max(4, src.width / 120), 0, 7); x.fill(); }
    let cap = d.querySelector(".cap"); if (!cap) { cap = document.createElement("span"); cap.className = "cap"; d.append(cap); }
    cap.textContent = S.example ? "Example figure" : S.img.name;
  }
  $("cOverlay").onchange = drawImage;
  $("bClear").onclick = () => { S.img = null; $("bRead").disabled = true; $("ovRow").hidden = true; drawImage(); setStatus(""); };
  $("bOpenImg").onclick = () => $("fImg").click();
  $("drop").addEventListener("click", (e) => {
    if (S.picking && S.img) {
      const c = $("drop").querySelector("canvas"); const r = c.getBoundingClientRect();
      S.center = { cx: (e.clientX - r.left) * c.width / r.width, cy: (e.clientY - r.top) * c.height / r.height };
      S.picking = false; $("drop").classList.remove("picking"); $("centerVal").textContent = `${Math.round(S.center.cx)}, ${Math.round(S.center.cy)}`; drawImage(); return;
    }
    if (!S.img) $("fImg").click();
  });
  $("drop").addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && !S.img) { e.preventDefault(); $("fImg").click(); } });
  $("bCenter").onclick = () => { if (!S.img) return; S.picking = true; $("drop").classList.add("picking"); toast("Click the centre of the circle on the image"); };
  $("fImg").onchange = (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ""; };
  ["dragenter", "dragover"].forEach(ev => document.addEventListener(ev, (e) => { e.preventDefault(); $("drop").classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === "drop" || e.target === document.documentElement) $("drop").classList.remove("over"); }));
  document.addEventListener("drop", (e) => {
    const f = e.dataTransfer && e.dataTransfer.files[0]; if (!f) return;
    openFile(f);
  });
  document.addEventListener("paste", (e) => {
    if (e.target.closest("input,textarea")) return;
    const items = [...(e.clipboardData?.items || [])];
    const im = items.find(i => i.type.startsWith("image/"));
    if (im) { loadImage(im.getAsFile(), "pasted image"); e.preventDefault(); return; }
    const txt = e.clipboardData.getData("text"); if (txt && /[(;]/.test(txt)) { loadTreeText(txt, "pasted text"); e.preventDefault(); }
  });

  /* ---------- tree files ---------- */
  function loadTreeText(text, name) {
    try {
      const trees = Tree.parseAny(text);
      if (!trees.length) throw new Error("No tree found");
      const t = trees[0]; t.meta = Object.assign({ source: "file", lengthUnits: Tree.hasLengths(t.root) ? "" : "none" }, t.meta);
      setTree(t);
      notes([{ kind: "ok", text: `Loaded ${name}${trees.length > 1 ? ` (first of ${trees.length} trees)` : ""}.` }]);
    } catch (e) { notes([{ kind: "err", text: `Couldn't read ${name}: ${e.message}` }]); }
  }
  $("bOpenTree").onclick = () => $("fTree").click();
  $("fTree").onchange = async (e) => { const f = e.target.files[0]; if (f) loadTreeText(await f.text(), f.name); e.target.value = ""; };
  $("bPaste").onclick = () => { $("pText").value = ""; $("dPaste").showModal(); };
  $("pGo").onclick = () => { const t = $("pText").value; $("dPaste").close(); if (t.trim()) loadTreeText(t, "pasted tree"); };

  /* ---------- reading ---------- */
  async function imageDataFor(rot) { const c = orientedCanvas(rot); return c.getContext("2d").getImageData(0, 0, c.width, c.height); }
  const ROT = { left: 0, right: 0, top: 270, bottom: 90 };
  async function runLocal(layoutChoice, rootSide, withOCR, onP) {
    const layoutL = layoutChoice === "circular" ? "circular" : layoutChoice === "cladogram" ? "cladogram" : "rectangular";
    const tryOne = async (side) => {
      const rot = layoutL === "circular" ? 0 : ROT[side] || 0;
      const img = await imageDataFor(rot);
      const words = S.img.words && S.img.words.length ? PDFIn.rotateWords(S.img.words, rot, S.img.base.width, S.img.base.height) : null;
      const opts = { layout: layoutL, mirror: side === "right" && layoutL !== "circular", center: layoutL === "circular" ? S.center : null, ocr: withOCR, words: withOCR ? words : null };
      const r = await Engine.read(img, opts, withOCR ? OCR.recognize : null, onP);
      r.rot = rot; r.side = side; return r;
    };
    if (layoutL === "circular" || (rootSide && rootSide !== "auto")) return tryOne(rootSide && rootSide !== "auto" ? rootSide : "left");
    // detect the root side from geometry alone
    let best = null;
    for (const side of ["left", "right", "top", "bottom"]) {
      try {
        const img = await imageDataFor(ROT[side]);
        const r = await Engine.read(img, { layout: layoutL, mirror: side === "right", ocr: false }, null, () => {});
        const sc = Tree.tips(r.tree.root).length - 4 * r.debug.asm.fragments - r.debug.asm.lostTips;
        if (!best || sc > best.sc) best = { sc, side };
      } catch (e) { /* not this way round */ }
    }
    if (!best) throw new Error("No tree-like lines were found in any orientation.");
    return tryOne(best.side);
  }

  async function read() {
    if (!S.img) return;
    const layoutChoice = $("sLayout").value, rootSide = $("sRoot").value;
    let engine = S.engine;
    if (visionOK === null) visionOK = await Vision.available();
    const out = [];
    if (engine !== "local" && !visionOK.ok) { out.push({ text: visionOK.why + " Using the local reader instead." }); engine = "local"; }
    if (engine === "local" && layoutChoice === "unrooted") { notes([{ kind: "err", text: "Unrooted radial layouts need Claude. Open this page on claude.ai and choose Claude." }]); return; }
    $("bRead").disabled = true; $("bStop").hidden = false;
    const ctl = new AbortController(); S.abort = ctl;
    const onP = (m, p) => setStatus(m, p);
    try {
      let tree, overlay = null;
      if (engine === "local") {
        setStatus("Starting the local reader", 0.02);
        const r = await runLocal(layoutChoice, rootSide, true, onP);
        tree = r.tree; overlay = r.debug; S.img.rot = r.rot;
        r.warnings.forEach(w => out.push({ text: w }));
        out.unshift({ kind: "ok", text: `Local reader: ${Tree.tips(tree.root).length} taxa, root on the ${r.side === "left" && r.debug.space.kind === "polar" ? "centre" : r.side}.` });
      } else {
        setStatus("Sending the figure to Claude", 0.05);
        let t0 = Date.now();
        const res = await Vision.read(S.img.blob, { layout: layoutChoice, rootSide, tier: $("sTier").value, note: $("tNote").value.trim(), texts: S.img.texts },
          (chars) => setStatus(`Claude is writing the tree… ${(chars / 1000).toFixed(1)}k characters`, Math.min(0.85, 0.1 + chars / 40000)), ctl.signal);
        tree = res.tree;
        out.push({ kind: "ok", text: `Claude read ${Tree.tips(tree.root).length} taxa (${tree.meta.layout || "layout unknown"}, root ${tree.meta.rootSide || "?"}) in ${Math.round((Date.now() - t0) / 1000)} s.` });
        if (res.notes) out.push({ text: "Claude: " + res.notes });
        res.uncertain.slice(0, 6).forEach(u => out.push({ text: "Check: " + u }));
        if (engine === "hybrid" && ["rectangular", "cladogram", "circular"].includes(tree.meta.layout)) {
          if (tree.meta.layout === "cladogram") out.push({ kind: "ok", text: "Cladogram: branch lengths are not meaningful, so none were measured." });
          else {
            setStatus("Measuring branch lengths from the lines", 0.9);
            try {
              const side = tree.meta.layout === "circular" ? "left" : (["left", "right", "top", "bottom"].includes(tree.meta.rootSide) ? tree.meta.rootSide : "left");
              const loc = await runLocal(tree.meta.layout === "circular" ? "circular" : "rectangular", side, false, () => {});
              const m = Vision.merge(tree, loc, tree.meta.layout === "circular");
              if (m.ok) { out.push({ kind: "ok", text: `Measured lengths from the lines: ${m.matched} of ${m.total} clades matched, ${m.moved} branches updated.` }); overlay = loc.debug; S.img.rot = loc.rot; }
              else out.push({ text: m.why });
            } catch (e) { out.push({ text: "Line tracing failed (" + (e.message || e) + "), so Claude's estimated lengths were kept (shown dashed)." }); }
          }
        } else if (tree.meta.lengthUnits !== "none") out.push({ text: "Branch lengths are Claude's estimates from the drawing (dashed). Check them against the scale bar." });
      }
      if (tree.meta.lengthUnits === "relative" && !out.some(o => /relative/.test(o.text))) out.push({ text: "Lengths are relative (deepest tip = 1). Use Calibrate if you know the scale." });
      if (layoutChoice === "cladogram" || tree.meta.layout === "cladogram") { for (const n of Tree.nodes(tree.root)) { n.length = null; if (n.flag === "estimated") n.flag = null; } tree.meta.lengthUnits = "none"; }
      S.img.overlay = overlay;
      setTree(tree);
      if (tree.meta.layout === "circular") { S.view.mode = "circ"; } else { S.view.mode = tree.meta.lengthUnits === "none" ? "clado" : "rect"; }
      $("segView").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === S.view.mode));
      renderTree();
      setStatus("Done. Review the tree, then export.", 1);
    } catch (e) {
      const code = e && e.code;
      const msg = code === "cancelled" ? "Stopped." : code === "not_granted" ? "Claude access wasn't allowed for this page. Choose Local, or allow it from the page's permissions." :
        code === "rate_limited" ? "Claude is busy or you've hit a usage limit. Try again later or use Local." : code === "invalid_json" ? "Claude's answer couldn't be parsed. Try again, or try Balanced." :
        code === "refused" ? "Claude declined this image." : code === "image_rejected" ? "The image was rejected: try a PNG or JPEG under 20 MB." : (e && e.message) || String(e);
      setStatus(msg, null); out.push({ kind: "err", text: msg });
      if (code === "not_granted" || code === "sampling_disabled") visionOK = { ok: false, why: msg };
    } finally {
      notes(out); $("bRead").disabled = !S.img; $("bStop").hidden = true; S.abort = null;
    }
  }
  $("bRead").onclick = read;
  $("bStop").onclick = () => S.abort && S.abort.abort();

  /* ---------- export ---------- */
  const EXT = { newick: "nwk", nexus: "nex", phyloxml: "xml", csv: "csv", svg: "svg" };
  function exportText() {
    const f = $("xFmt").value, dec = $("xDec").value === "" ? null : +$("xDec").value;
    const o = { lengths: $("xLen").checked, support: $("xSup").checked, names: $("xUnd").checked ? "underscore" : "quote", precision: dec };
    $("xOpts").hidden = f === "csv" || f === "svg";
    if (f === "newick") return Tree.toNewick(S.tree, o);
    if (f === "nexus") return Tree.toNexus(S.tree, o);
    if (f === "phyloxml") return Tree.toPhyloXML(S.tree, o);
    if (f === "csv") return Tree.toCSV(S.tree);
    return exportSVG();
  }
  function updateExport() {
    $("xText").value = exportText();
    const f = $("xFmt").value;
    const st = Tree.stats(S.tree);
    const w = [];
    if (st.dupes.length) w.push("Duplicate taxon names will break most programs.");
    if (st.unnamed) w.push(`${st.unnamed} taxa have no name.`);
    if (inViewer && !["csv", "svg"].includes(f)) w.push(`In this viewer the file is saved with a .txt ending (e.g. tree.${EXT[f]}.txt). Phylogenetics programs open it as is; rename it if you prefer.`);
    $("xHint").textContent = w.join(" ");
  }
  $("bExport").onclick = () => { if (!S.tree) return; updateExport(); $("dExport").showModal(); };
  ["xFmt", "xLen", "xSup", "xUnd", "xDec"].forEach(id => $(id).addEventListener("input", updateExport));
  $("xCopy").onclick = () => copyText($("xText").value);
  $("bCopyNwk").onclick = () => copyText($("nwkOut").value);
  $("xSave").onclick = async () => {
    const f = $("xFmt").value, text = $("xText").value;
    const base = (S.img && S.img.name ? S.img.name.replace(/\.[^.]+$/, "") : "tree").replace(/[^\w.-]+/g, "_") || "tree";
    if (inViewer) {
      if (!downloads) { toast("Downloads aren't available here. Use Copy instead."); return; }
      const name = ["csv", "svg"].includes(f) ? `${base}.${EXT[f]}` : `${base}.${EXT[f]}.txt`;
      try { await downloads.save({ filename: name, data: text }); toast("Saved " + name); }
      catch (e) { if (e && e.code !== "declined") toast("Couldn't save the file. Use Copy instead."); }
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: f === "svg" ? "image/svg+xml" : f === "phyloxml" ? "application/xml" : "text/plain" }));
    a.download = `${base}.${EXT[f]}`; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  /* ---------- calibrate ---------- */
  function openCal() {
    if (!S.tree) return;
    const st = Tree.stats(S.tree); const m = S.tree.meta;
    $("calInfo").textContent = !st.hasLengths ? "This tree has no branch lengths." :
      `Current root-to-tip height: ${fmt(st.height)} ${m.lengthUnits || ""}.` + (m.scale && m.scale.px ? ` A scale bar of ${Math.round(m.scale.px)} px was measured.` : "");
    $("calBar").disabled = !(m.scale && m.scale.px && (m.pxScale || m.pxPerUnit));
    $("calBar").value = ""; $("calH").value = ""; $("calF").value = ""; $("calU").value = /relative|none|scale-bar/.test(m.lengthUnits || "") ? "" : (m.lengthUnits || "");
    $("dCal").showModal();
  }
  $("calGo").onclick = () => {
    const m = S.tree.meta, st = Tree.stats(S.tree);
    const bar = +$("calBar").value, h = +$("calH").value, f = +$("calF").value, u = $("calU").value.trim();
    let factor = null;
    if (bar > 0 && m.scale && m.scale.px) {
      // lengths currently = px / (pxPerUnit or pxScale)
      const cur = m.pxPerUnit ? m.scale.px / m.pxPerUnit : m.pxScale ? m.scale.px / m.pxScale : null;
      if (cur) factor = bar / cur;
    } else if (h > 0 && st.height > 0) factor = h / st.height;
    else if (f > 0) factor = f;
    $("dCal").close();
    if (!factor && !u) return;
    edit(t => { if (factor) Tree.scaleLengths(t.root, factor); if (u) t.meta.lengthUnits = u; else if (factor && t.meta.lengthUnits === "relative") t.meta.lengthUnits = ""; if (factor && m.pxPerUnit) t.meta.pxPerUnit = m.pxPerUnit / factor; if (factor && m.pxScale) t.meta.pxScale = m.pxScale / factor; }, "Lengths updated");
  };

  /* ---------- keyboard ---------- */
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input,textarea,select")) return;
    if ($("workEdit").hidden) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    else if (S.primary && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); act("prune"); }
    else if (S.primary && e.key.toLowerCase() === "f") act("flip");
    else if (S.primary && e.key.toLowerCase() === "r" && S.primary !== S.tree.root) act("reroot");
    else if (e.key === "Escape") { S.sel.clear(); S.primary = null; renderTree(); renderInspector(); renderTaxa(); }
  });
  $("bUndo").onclick = undo; $("bRedo").onclick = redo;

  /* ---------- workspaces ---------- */
  window.TreescanCurrent = () => S.tree;
  window.TreescanToast = toast; window.TreescanCopy = copyText;
  window.TreescanSave = async (filename, text, mime) => {
    if (inViewer) {
      if (!downloads) { toast("Downloads aren't available here. Use Copy instead."); return; }
      const ext = filename.split(".").pop();
      const name = ["csv", "svg", "txt", "json", "html"].includes(ext) ? filename : filename + ".txt";
      try { await downloads.save({ filename: name, data: text }); toast("Saved " + name); } catch (e) { if (e && e.code !== "declined") toast("Couldn't save the file."); }
      return;
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: mime || "text/plain" })); a.download = filename; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  seg("segMode", (v) => {
    $("workEdit").hidden = v !== "edit"; $("workTangle").hidden = v !== "tangle";
    ["bOpenImg", "bOpenTree", "bPaste", "bUndo", "bRedo", "bExport"].forEach(id => { $(id).hidden = v !== "edit"; });
    if (v === "tangle") window.Tangle && window.Tangle.show(); else renderTree();
  });

  /* ---------- start with an example ---------- */
  (async () => {
    engineHint();
    if (window.TREESCAN_EXAMPLE) {
      const b64 = window.TREESCAN_EXAMPLE.img.split(",")[1], bin = atob(b64), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const blob = new Blob([arr], { type: "image/png" });
      await loadImage(blob, "example-phylogram.png");
      const t = Tree.parseNewick(window.TREESCAN_EXAMPLE.newick); t.meta = { source: "example", lengthUnits: "substitutions/site" };
      S.tree = t; S.example = true; refresh();
      setStatus("Example figure and its tree are loaded. Press Read tree to try the reader, or open your own figure.");
    }
    if (!inViewer) OCR.warm && setTimeout(() => {}, 0);
  })();
})();
