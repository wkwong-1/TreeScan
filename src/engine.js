/* ===== Local image engine: line geometry + OCR label assignment ===== */
const Engine = (() => {
  const log = (...a) => { if (Engine.debug) console.log("[engine]", ...a); };

  /* ---------- pixels ---------- */
  function bgColor(img) {
    const { width: W, height: H, data } = img;
    const counts = new Map();
    const step = Math.max(1, Math.floor(Math.sqrt(W * H / 60000)));
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      const k = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    let best = 0, bk = 0; for (const [k, v] of counts) if (v > best) { best = v; bk = k; }
    return [((bk >> 10) & 31) * 8 + 4, ((bk >> 5) & 31) * 8 + 4, (bk & 31) * 8 + 4];
  }
  function flattenAlpha(img) {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] < 255) { const a = d[i + 3] / 255; d[i] = d[i] * a + 255 * (1 - a); d[i + 1] = d[i + 1] * a + 255 * (1 - a); d[i + 2] = d[i + 2] * a + 255 * (1 - a); d[i + 3] = 255; }
  }
  function otsu(hist, total) {
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thr = 0;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue; const wF = total - wB; if (!wF) break;
      sumB += t * hist[t]; const mB = sumB / wB, mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; thr = t; }
    }
    return thr;
  }
  function inkMask(img, opts = {}) {
    const { width: W, height: H, data } = img;
    const bg = bgColor(img);
    const dist = new Uint8Array(W * H);
    const hist = new Float64Array(256);
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
      const d = Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2]));
      dist[p] = d; hist[d]++;
    }
    let thr = opts.threshold || otsu(hist, W * H);
    thr = Math.max(40, Math.min(150, thr));
    const m = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) m[p] = dist[p] > thr ? 1 : 0;
    return { mask: m, W, H, bg, thr };
  }

  /* ---------- connected components (8-conn) ---------- */
  function components(mask, W, H) {
    const lab = new Int32Array(W * H);
    const parent = [0];
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) { if (a < b) parent[b] = a; else parent[a] = b; } };
    let next = 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x; if (!mask[p]) continue;
      const nb = [];
      if (x > 0 && mask[p - 1]) nb.push(lab[p - 1]);
      if (y > 0) {
        if (mask[p - W]) nb.push(lab[p - W]);
        if (x > 0 && mask[p - W - 1]) nb.push(lab[p - W - 1]);
        if (x < W - 1 && mask[p - W + 1]) nb.push(lab[p - W + 1]);
      }
      if (!nb.length) { lab[p] = next; parent.push(next); next++; }
      else { let mn = nb[0]; for (const v of nb) if (v < mn) mn = v; lab[p] = mn; for (const v of nb) uni(mn, v); }
    }
    const remap = new Int32Array(next); let k = 0; const comps = [];
    for (let i = 1; i < next; i++) { const r = find(i); if (!remap[r]) { remap[r] = ++k; comps.push({ id: k, n: 0, x0: 1e9, y0: 1e9, x1: -1, y1: -1 }); } remap[i] = remap[r]; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x; if (!lab[p]) continue;
      const c = remap[lab[p]]; lab[p] = c; const o = comps[c - 1];
      o.n++; if (x < o.x0) o.x0 = x; if (x > o.x1) o.x1 = x; if (y < o.y0) o.y0 = y; if (y > o.y1) o.y1 = y;
    }
    for (const c of comps) { c.w = c.x1 - c.x0 + 1; c.h = c.y1 - c.y0 + 1; }
    return { lab, comps };
  }

  /* ---------- runs & segments ---------- */
  function strokeWidth(mask, W, H) {
    const hist = new Uint32Array(40);
    for (let y = 0; y < H; y += 2) { let run = 0; for (let x = 0; x <= W; x++) { const v = x < W && mask[y * W + x]; if (v) run++; else if (run) { if (run < 40) hist[run]++; run = 0; } } }
    for (let x = 0; x < W; x += 2) { let run = 0; for (let y = 0; y <= H; y++) { const v = y < H && mask[y * W + x]; if (v) run++; else if (run) { if (run < 40) hist[run]++; run = 0; } } }
    let best = 1; for (let i = 1; i < 16; i++) if (hist[i] > hist[best]) best = i;
    return best;
  }
  // horizontal segments: runs of length >= minLen grouped across adjacent rows
  function hSegments(mask, W, H, minLen, gapFill = 1) {
    const segs = []; let open = [];
    for (let y = 0; y < H; y++) {
      const runs = []; let x = 0;
      while (x < W) {
        if (!mask[y * W + x]) { x++; continue; }
        let s = x, e = x;
        while (true) {
          while (e + 1 < W && mask[y * W + e + 1]) e++;
          let g = 1; while (g <= gapFill && e + 1 + g < W && !mask[y * W + e + g]) g++;
          if (g <= gapFill && e + g < W && mask[y * W + e + g] && g > 1) { e = e + g; continue; }
          break;
        }
        if (e - s + 1 >= minLen) runs.push([s, e]);
        x = e + 1;
      }
      const nextOpen = [];
      for (const r of runs) {
        let seg = null;
        for (const o of open) { const ov = Math.min(o.last[1], r[1]) - Math.max(o.last[0], r[0]); if (ov >= 0.5 * Math.min(o.last[1] - o.last[0], r[1] - r[0])) { seg = o; break; } }
        if (seg && !seg.taken) { seg.taken = true; seg.rows.push([y, r[0], r[1]]); seg.last = r; nextOpen.push(seg); }
        else { const s = { rows: [[y, r[0], r[1]]], last: r }; segs.push(s); nextOpen.push(s); }
      }
      for (const o of nextOpen) o.taken = false;
      open = nextOpen;
    }
    return segs.map(s => {
      const ys = s.rows.map(r => r[0]);
      // use the longest rows to define extent (robust to anti-aliasing)
      let x1 = 1e9, x2 = -1; for (const r of s.rows) { if (r[1] < x1) x1 = r[1]; if (r[2] > x2) x2 = r[2]; }
      return { y: (ys[0] + ys[ys.length - 1]) / 2, y1: ys[0], y2: ys[ys.length - 1], x1, x2, th: ys.length };
    });
  }
  function transpose(mask, W, H) { const o = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) o[x * H + y] = mask[y * W + x]; return o; }
  function vSegments(mask, W, H, minLen) {
    const t = transpose(mask, W, H);
    return hSegments(t, H, W, minLen).map(s => ({ x: s.y, x1: s.y1, x2: s.y2, y1: s.x1, y2: s.x2, th: s.th }));
  }

  /* ---------- filled dots (tip/node markers) ---------- */
  function findBlobs(m, W, H, t) {
    const k = Math.max(1, Math.round(t)); if (2 * k + 1 < t + 2) return [];
    const S = new Int32Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += m[y * W + x]; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row; } }
    const full = (2 * k + 1) * (2 * k + 1);
    const core = new Uint8Array(W * H); let any = false;
    for (let y = k; y < H - k; y++) for (let x = k; x < W - k; x++) {
      if (!m[y * W + x]) continue;
      const a = S[(y - k) * (W + 1) + x - k], b = S[(y - k) * (W + 1) + x + k + 1], c = S[(y + k + 1) * (W + 1) + x - k], d = S[(y + k + 1) * (W + 1) + x + k + 1];
      if (d - b - c + a === full) { core[y * W + x] = 1; any = true; }
    }
    if (!any) return [];
    const { lab, comps } = components(core, W, H);
    return comps.filter(c => c.w <= 12 * t + 6 && c.h <= 12 * t + 6 && c.w < 3 * c.h + 2 && c.h < 3 * c.w + 2).map(c => ({ x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2, r: Math.max(c.w, c.h) / 2 + k }));
  }

  /* ---------- tree assembly from segments ---------- */
  function assemble(hs, vs, t, opts = {}) {
    const tolX = Math.max(2, Math.ceil(t * 1.0) + 2);
    const tolY = Math.max(t + 2, Math.min(2 * t + 4, 0.35 * (opts.textH || 12)));
    // merge vertical pieces on the same column with small gaps
    let V = vs.map(v => Object.assign({}, v, { w: v.y2 - v.y1 }));
    const bridged = (x, ya, yb) => hs.some(h => h.y >= ya - 1 && h.y <= yb + 1 && h.x1 <= x + tolX && h.x2 >= x - tolX);
    let merged = true;
    while (merged) {
      merged = false;
      V.sort((a, b) => a.y1 - b.y1);
      outer: for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) {
        const u = V[i], v = V[j];
        if (Math.abs(u.x - v.x) > t + 1) continue;
        const gap = v.y1 - u.y2;
        if (gap <= Math.max(2 * t, 3) || (gap < 6 * t + 12 && bridged((u.x + v.x) / 2, u.y2, v.y1))) {
          const wu = u.y2 - u.y1 + 1, wv = v.y2 - v.y1 + 1;
          u.x = (u.x * wu + v.x * wv) / (wu + wv); u.y2 = Math.max(u.y2, v.y2); u.th = Math.max(u.th, v.th);
          V.splice(j, 1); merged = true; break outer;
        }
      }
    }
    if (opts.polarR0) V = V.filter(v => v.x > opts.polarR0 + 2 * tolX);
    // split horizontals that pass through a vertical
    let Hs = hs.map(h => Object.assign({}, h));
    for (const v of V) {
      const out = [];
      for (const h of Hs) {
        if (v.x > h.x1 + tolX && v.x < h.x2 - tolX && h.y >= v.y1 - tolY && h.y <= v.y2 + tolY) {
          out.push(Object.assign({}, h, { x2: v.x })); out.push(Object.assign({}, h, { x1: v.x }));
        } else out.push(h);
      }
      Hs = out;
    }
    Hs = Hs.filter(h => h.x2 - h.x1 >= 1);
    for (const h of Hs) { h.leftV = null; h.rightV = null; }
    for (const v of V) { v.kids = []; v.parentH = null; v.parentV = null; }
    // attach
    for (const h of Hs) {
      let bestL = null, bl = 1e9, bestR = null, br = 1e9;
      const ht = (h.th || 1) / 2;
      for (const v of V) {
        if (h.y < v.y1 - tolY - ht || h.y > v.y2 + tolY + ht) continue;
        const dl = Math.abs(h.x1 - v.x); if (dl <= tolX + v.th / 2 && dl < bl) { bl = dl; bestL = v; }
        const dr = Math.abs(h.x2 - v.x); if (dr <= tolX + v.th / 2 && dr < br && v.x > h.x1 + tolX) { br = dr; bestR = v; }
      }
      if (bestR && bestR === bestL) { if (bl <= br) bestR = null; else bestL = null; }
      h.leftV = bestL; h.rightV = bestR;
    }
    // a vertical receives at most one parent edge; choose the one nearest its middle
    for (const v of V) {
      const ins = Hs.filter(h => h.rightV === v);
      if (ins.length > 1) {
        const mid = (v.y1 + v.y2) / 2; ins.sort((a, b) => Math.abs(a.y - mid) - Math.abs(b.y - mid));
        for (const h of ins.slice(1)) h.rightV = null;
      }
      if (ins.length) v.parentH = ins[0];
    }
    for (const h of Hs) if (h.leftV) h.leftV.kids.push(h);
    // short-branch links: verticals without parent edge that sit just right of another vertical
    for (const v of V) {
      if (v.parentH) continue;
      const mid = (v.y1 + v.y2) / 2;
      let best = null, bd = 1e9;
      for (const u of V) {
        if (u === v) continue;
        const dx = v.x - u.x;
        if (dx <= 0.5 || dx > Math.max(opts.minLen || 0, 3 * t) + tolX + 2) continue;
        if (mid < u.y1 - tolY || mid > u.y2 + tolY) continue;
        if (dx < bd) { bd = dx; best = u; }
      }
      if (best) { v.parentV = best; best.kids.push({ shortTo: v, y: mid, x1: best.x, x2: v.x }); }
    }
    // orphan horizontals (no left vertical) whose left ends line up -> virtual vertical (e.g. root at a point)
    const orphans = Hs.filter(h => !h.leftV && opts.polarR0 && h.x1 <= opts.polarR0 + 2 * tolX);
    if (orphans.length >= 2) {
      const groups = [];
      for (const h of orphans.sort((a, b) => a.x1 - b.x1)) {
        const g = groups.find(g => Math.abs(g.x - h.x1) <= tolX * 1.5);
        if (g) g.hs.push(h); else groups.push({ x: h.x1, hs: [h] });
      }
      for (const g of groups) {
        // a fat wedge near the centre can split into stacked pieces; keep one per overlapping band
        g.hs.sort((a, b) => (b.rightV ? 1 : 0) - (a.rightV ? 1 : 0) || (b.x2 - b.x1) - (a.x2 - a.x1));
        const keep = [];
        for (const h of g.hs) if (!keep.some(k => h.y1 <= k.y2 + 1 && h.y2 >= k.y1 - 1)) keep.push(h); else h.dead = true;
        g.hs = keep;
      }
      Hs = Hs.filter(h => !h.dead);
      for (const g of groups) if (g.hs.length >= 2) {
        const ys = g.hs.map(h => h.y);
        const vx = opts.polarR0 && g.x <= opts.polarR0 + tolX * 2 ? 0 : g.x;
        const vv = { x: vx, y1: Math.min(...ys), y2: Math.max(...ys), th: t, kids: g.hs, parentH: null, virtual: true };
        for (const h of g.hs) h.leftV = vv;
        V.push(vv);
      }
    }
    // build nodes
    const nodeOf = new Map();
    let tipsOut = [];
    const mk = (v) => {
      if (nodeOf.has(v)) return nodeOf.get(v);
      const n = { v, x: v.x, y: v.parentH ? v.parentH.y : (v.y1 + v.y2) / 2, children: [], tip: false };
      nodeOf.set(v, n); return n;
    };
    for (const v of V) {
      const n = mk(v);
      const kids = v.kids.slice().sort((a, b) => a.y - b.y);
      for (const k of kids) {
        let c;
        if (k.shortTo) c = mk(k.shortTo);
        else if (k.rightV) c = mk(k.rightV);
        else { c = { x: k.x2 + 0.5, y: k.y, children: [], tip: true, h: k }; tipsOut.push(c); }
        c.parentRef = n; c.inY = k.y; n.children.push(c);
      }
      // vertical ends without a child edge -> zero-length tips
      if (!v.virtual && v.y2 - v.y1 > 2 * tolY) {
        for (const yEnd of [v.y1, v.y2]) {
          if (!kids.some(k => Math.abs(k.y - yEnd) <= tolY + 1 + (k.th || 1) / 2)) {
            const c = { x: v.x, y: yEnd, children: [], tip: true, zero: true };
            c.parentRef = n; n.children.push(c); tipsOut.push(c);
          }
        }
        n.children.sort((a, b) => (a.inY ?? a.y) - (b.inY ?? b.y));
      }
    }
    // dots sitting on a vertical with no branch of their own = taxa on (near) zero-length branches
    for (const b of (opts.blobs || [])) {
      const near = tipsOut.filter(tp => Math.abs(tp.x - b.x) <= b.r + t + 2 && Math.abs(tp.y - b.y) <= b.r + t + 2);
      if (near.length) { near.forEach(tp => { tp.dot = true; if (!tp.zero && tp.parentRef && b.x > tp.parentRef.x) tp.x = b.x; }); continue; }
      let best = null, bd = 1e9;
      for (const v of V) {
        if (v.virtual) continue;
        const dx = Math.abs(v.x - b.x); if (dx > b.r + t + 2) continue;
        if (b.y < v.y1 - tolY || b.y > v.y2 + tolY) continue;
        if (dx < bd) { bd = dx; best = v; }
      }
      if (!best) continue;
      const n = nodeOf.get(best);
      const nearH = Hs.some(h => (h.leftV === best || h.rightV === best) && Math.abs(h.y - b.y) <= tolY + (h.th || 1) / 2 + 1);
      if (nearH || n.children.some(c => Math.abs((c.inY ?? c.y) - b.y) <= tolY + 1)) continue;
      const c = { x: best.x, y: b.y, children: [], tip: true, zero: true, dot: true };
      c.parentRef = n; c.inY = b.y; n.children.push(c); tipsOut.push(c);
      n.children.sort((a, b2) => (a.inY ?? a.y) - (b2.inY ?? b2.y));
    }
    // a vertical with nothing attached (e.g. a marker dot at a branch end) is a tip
    for (const n of nodeOf.values()) if (!n.children.length && n.v && (opts.blobs || []).some(b => Math.abs(b.x - n.v.x) <= b.r + t + 2 && b.y >= n.v.y1 - b.r && b.y <= n.v.y2 + b.r)) { n.tip = true; n.dot = true; tipsOut.push(n); }
    // roots
    const all = [...nodeOf.values()];
    let roots = all.filter(n => !n.parentRef);
    const size = (n) => n.tip ? 1 : n.children.reduce((a, c) => a + size(c), 0);
    roots.sort((a, b) => size(b) - size(a));
    // second chance: attach fragment roots via their dangling parent edge with a looser tolerance
    for (const r of roots.slice(1)) {
      const ph = r.v && r.v.parentH;
      const x1 = ph ? ph.x1 : r.x - 3 * tolX;
      let best = null, bd = 1e9;
      for (const n of all) {
        if (n === r || n.tip || isDesc(n, r)) continue;
        const v = n.v; if (!v) continue;
        if (r.y < v.y1 - 3 * tolY || r.y > v.y2 + 3 * tolY) continue;
        const d = Math.abs(v.x - x1); if (d < 4 * tolX + 6 && d < bd && v.x < r.x) { bd = d; best = n; }
      }
      if (best) { r.parentRef = best; best.children.push(r); best.children.sort((a, b) => a.y - b.y); }
    }
    roots = all.filter(n => !n.parentRef).sort((a, b) => size(b) - size(a));
    const root = roots[0];
    if (!root) return null;
    const rootStub = root.v && root.v.parentH ? root.x - root.v.parentH.x1 : 0;
    const unused = roots.slice(1).reduce((a, r) => a + size(r), 0);
    return { root, rootStub, fragments: roots.length - 1, lostTips: unused, V, H: Hs, tol: tolX };
    function isDesc(a, b) { while (a) { if (a === b) return true; a = a.parentRef; } return false; }
  }

  /* ---------- geometry pipeline on a mask ---------- */
  function geometry(mask, W, H, opts = {}) {
    const { lab, comps } = components(mask, W, H);
    if (!comps.length) throw new Error("The image looks blank: no dark lines were found.");
    let t = Math.max(1, strokeWidth(mask, W, H));
    // text height estimate: median height of small components
    const small = comps.filter(c => c.h < H / 8 && c.w < W / 8 && c.n > 4).map(c => c.h).sort((a, b) => a - b);
    const textH = opts.textH || (small.length ? small[Math.floor(small.length / 2)] : 12);
    const longLen = Math.max(1.6 * textH, 6 * t, 12);
    // components that contain long straight runs are "line art"
    const lineComp = new Uint8Array(comps.length + 1);
    const hs0 = hSegments(mask, W, H, longLen), vs0 = vSegments(mask, W, H, longLen);
    for (const s of hs0) { const yy = Math.round(s.y), xx = Math.round((s.x1 + s.x2) / 2); const id = lab[yy * W + xx] || lab[Math.round(s.y1) * W + s.x1]; if (id) lineComp[id] = 1; }
    for (const s of vs0) { const xx = Math.round(s.x), yy = Math.round((s.y1 + s.y2) / 2); const id = lab[yy * W + xx] || lab[s.y1 * W + Math.round(s.x1)]; if (id) lineComp[id] = 1; }
    let cands = comps.filter(c => lineComp[c.id]);
    if (!cands.length) throw new Error("No tree-like lines were found. Try a sharper image, or the other engine.");
    // scale-bar-like comps: flat, wide, no tall parts
    const isFlat = (c) => c.h <= Math.max(textH * 0.9, 4 * t + 2) && c.w >= longLen;
    const biggest = cands.slice().sort((a, b) => (b.w + b.h) * Math.sqrt(b.n) - (a.w + a.h) * Math.sqrt(a.n))[0];
    // stroke width of the tree itself (text strokes can differ)
    { const bm = new Uint8Array(W * H); for (let p = 0; p < W * H; p++) if (lab[p] === biggest.id) bm[p] = 1; t = Math.max(1, strokeWidth(bm, W, H)); }
    const bigSize = Math.max(biggest.w, biggest.h);
    // other pieces of line art must be sizeable (bold titles and glyphs are not)
    const treeComps = cands.filter(c => c === biggest || (!isFlat(c) && Math.max(c.w, c.h) >= Math.max(4 * textH, 0.06 * bigSize)));
    // scale bar candidates: flat pieces that are not part of a dashed/dotted row
    const flats = cands.filter(c => c !== biggest && isFlat(c));
    const scaleComps = flats.filter(c => !flats.some(o => o !== c && Math.abs((o.y0 + o.y1) - (c.y0 + c.y1)) <= 4 && (Math.abs(o.x0 - c.x1) < 3 * c.w || Math.abs(c.x0 - o.x1) < 3 * c.w)));
    const keep = new Uint8Array(comps.length + 1); for (const c of treeComps) keep[c.id] = 1;
    const tmask = new Uint8Array(W * H); for (let p = 0; p < W * H; p++) if (lab[p] && keep[lab[p]]) tmask[p] = 1;
    const minLen = Math.max(3, t + 3);
    let hs = hSegments(tmask, W, H, minLen);
    // vertical detection only uses pixels that are not part of a long horizontal run
    const vmask = new Uint8Array(tmask);
    const maxW = 2 * t + 2;
    for (let y = 0; y < H; y++) { let x = 0; while (x < W) { if (!tmask[y * W + x]) { x++; continue; } let e = x; while (e + 1 < W && tmask[y * W + e + 1]) e++; if (e - x + 1 > maxW) for (let k = x; k <= e; k++) vmask[y * W + k] = 0; x = e + 1; } }
    let vs = vSegments(vmask, W, H, minLen).filter(v => v.th <= 2 * t + 3);
    hs = hs.filter(h => !(h.x2 - h.x1 + 1 < minLen));
    // pixels that belong to detected straight lines (used to erase the drawing before OCR)
    const lineMask = new Uint8Array(W * H);
    for (const h of hs) for (let y = Math.max(0, h.y1 - 1); y <= Math.min(H - 1, h.y2 + 1); y++) for (let x = Math.max(0, h.x1 - 1); x <= Math.min(W - 1, h.x2 + 1); x++) if (tmask[y * W + x]) lineMask[y * W + x] = 1;
    for (const v of vs) for (let y = Math.max(0, v.y1 - 1); y <= Math.min(H - 1, v.y2 + 1); y++) for (let x = Math.max(0, Math.floor(v.x1) - 1); x <= Math.min(W - 1, Math.ceil(v.x2) + 1); x++) if (tmask[y * W + x]) lineMask[y * W + x] = 1;
    const blobs = opts.polarR0 ? [] : findBlobs(tmask, W, H, t); 
    const asm = assemble(hs, vs, t, { minLen, polarR0: opts.polarR0, textH, blobs });
    if (!asm) throw new Error("Could not connect the lines into a tree.");
    // scale bar candidates (in this coordinate space)
    const scale = scaleComps.map(c => {
      const segs = hSegments(lab.map((v, i) => v === c.id ? 1 : 0), W, H, longLen);
      const s = segs.sort((a, b) => (b.x2 - b.x1) - (a.x2 - a.x1))[0];
      return s ? { x1: s.x1, x2: s.x2 + 1, y: s.y, len: s.x2 - s.x1 + 1, comp: c } : null;
    }).filter(Boolean);
    return { asm, t, textH, tmask, lineMask, lab, comps, treeComps, scale };
  }

  /* ---------- transforms ---------- */
  function mirrorMask(m, W, H) { const o = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) o[y * W + x] = m[y * W + (W - 1 - x)]; return o; }

  /* polar unwrap: x = r, y = theta index */
  function polarGrid(cx, cy, R, rows, theta0) {
    const dth = 2 * Math.PI / rows;
    return { cx, cy, R, rows, theta0, dth, cols: Math.ceil(R) + 1,
      toXY: (r, row) => { const a = theta0 + row * dth; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; } };
  }
  function unwrapMask(mask, W, H, g) {
    const out = new Uint8Array(g.cols * g.rows);
    for (let row = 0; row < g.rows; row++) {
      const a = g.theta0 + row * g.dth, ca = Math.cos(a), sa = Math.sin(a);
      for (let r = 0; r < g.cols; r++) {
        const fx = g.cx + r * ca, fy = g.cy + r * sa;
        const x = Math.floor(fx), y = Math.floor(fy);
        if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) continue;
        const p = y * W + x;
        if (mask[p] || mask[p + 1] || mask[p + W] || mask[p + W + 1]) out[row * g.cols + r] = 1;
      }
    }
    // close one-pixel gaps along both axes (wobbly anti-aliased strokes)
    const C = g.cols, R = g.rows, o2 = new Uint8Array(out);
    for (let row = 1; row < R - 1; row++) for (let r = 1; r < C - 1; r++) {
      const p = row * C + r; if (out[p]) continue;
      if ((out[p - 1] && out[p + 1]) || (out[p - C] && out[p + C])) o2[p] = 1;
    }
    return o2;
  }
  function unwrapRGBA(img, g) {
    const { width: W, height: H, data } = img;
    const out = new Uint8ClampedArray(g.cols * g.rows * 4);
    for (let row = 0; row < g.rows; row++) {
      const a = g.theta0 + row * g.dth, ca = Math.cos(a), sa = Math.sin(a);
      for (let r = 0; r < g.cols; r++) {
        const fx = g.cx + r * ca, fy = g.cy + r * sa;
        const o = (row * g.cols + r) * 4;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 255; continue; }
        const dx = fx - x0, dy = fy - y0;
        for (let k = 0; k < 3; k++) {
          const i = (y0 * W + x0) * 4 + k;
          out[o + k] = (data[i] * (1 - dx) + data[i + 4] * dx) * (1 - dy) + (data[i + W * 4] * (1 - dx) + data[i + W * 4 + 4] * dx) * dy;
        }
        out[o + 3] = 255;
      }
    }
    return { width: g.cols, height: g.rows, data: out };
  }
  function straightness(mask, W, H, cx, cy, R) {
    // score a candidate centre: long runs in a coarse polar unwrap
    const rows = 360, cols = Math.min(200, Math.ceil(R));
    let score = 0;
    const g = new Uint8Array(rows * cols);
    for (let row = 0; row < rows; row++) {
      const a = row * 2 * Math.PI / rows, ca = Math.cos(a), sa = Math.sin(a);
      for (let c = 0; c < cols; c++) {
        const r = c * R / cols; const x = Math.round(cx + r * ca), y = Math.round(cy + r * sa);
        if (x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x]) g[row * cols + c] = 1;
      }
    }
    // vertical runs (arcs) along rows-direction at fixed column
    const arc = (c) => (c * R / cols) * 2 * Math.PI / rows; // px per row at this column
    for (let c = Math.ceil(cols * 0.04); c < cols; c++) { let run = 0; const k = arc(c); for (let row = 0; row <= rows; row++) { const v = row < rows && g[row * cols + c]; if (v) run++; else { if (run >= 3) { const L = run * k; if (L > 6) score += L * L; } run = 0; } } }
    const rs = R / cols;
    for (let row = 0; row < rows; row++) { let run = 0; for (let c = 0; c <= cols; c++) { const v = c < cols && g[row * cols + c]; if (v) run++; else { if (run >= 3) { const L = run * rs; if (L > 6) score += L * L; } run = 0; } } }
    return score;
  }
  function findCenter(mask, W, H) {
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (mask[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const R = Math.max(x1 - x0, y1 - y0) * 0.75;
    let step = Math.max(x1 - x0, y1 - y0) * 0.08;
    let best = straightness(mask, W, H, cx, cy, R);
    for (let it = 0; it < 4; it++) {
      let bx = cx, by = cy;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        if (!dx && !dy) continue;
        const s = straightness(mask, W, H, cx + dx * step, cy + dy * step, R);
        if (s > best) { best = s; bx = cx + dx * step; by = cy + dy * step; }
      }
      cx = bx; cy = by; step /= 3;
    }
    return { cx, cy };
  }

  /* ---------- OCR post-processing ---------- */
  const NUM_RE = /^[\(\[]?[-+]?(\d+\.?\d*|\.\d+)(%)?(\s*\/\s*[-+]?(\d+\.?\d*|\.\d+)%?)*[\)\]]?$/;
  function cleanWords(words) {
    return words.map(w => {
      let s = (w.text || "").trim();
      s = s.replace(/^[|\\\/_\-—–:;,.'"`~]+(?=\w)/, "").replace(/(?<=\w)[|\\_\-—–:;,'"`~]+$/, "");
      return Object.assign({}, w, { text: s });
    }).filter(w => w.text && /[A-Za-z0-9]/.test(w.text) && (w.conf >= 35 || (NUM_RE.test(w.text) && w.conf >= 20)) && (w.x1 - w.x0) > 1 && (w.y1 - w.y0) > 3);
  }
  function phrases(words) {
    const ws = words.slice().sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);
    const lines = [];
    for (const w of ws) {
      const cy = (w.y0 + w.y1) / 2, h = w.y1 - w.y0;
      const L = lines.find(l => Math.abs(l.cy - cy) <= 0.45 * Math.max(h, l.h));
      if (L) { L.ws.push(w); L.cy = (L.cy * (L.ws.length - 1) + cy) / L.ws.length; L.h = Math.max(L.h, h); } else lines.push({ cy, h, ws: [w] });
    }
    const out = [];
    for (const L of lines) {
      L.ws.sort((a, b) => a.x0 - b.x0);
      let cur = null;
      for (const w of L.ws) {
        const h = w.y1 - w.y0;
        const isNum = NUM_RE.test(w.text);
        if (cur && w.x0 - cur.x1 <= 0.75 * Math.max(h, cur.h) && !isNum && !cur.isNum) {
          cur.text += " " + w.text; cur.x1 = Math.max(cur.x1, w.x1); cur.y0 = Math.min(cur.y0, w.y0); cur.y1 = Math.max(cur.y1, w.y1); cur.conf = Math.min(cur.conf, w.conf); cur.h = cur.y1 - cur.y0;
        } else {
          cur = { text: w.text, x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1, conf: w.conf, h, isNum }; out.push(cur);
        }
      }
    }
    for (const p of out) { p.cy = (p.y0 + p.y1) / 2; p.cx = (p.x0 + p.x1) / 2; p.isNum = NUM_RE.test(p.text); }
    return out;
  }
  function boxDist(p, x, y) {
    const dx = x < p.x0 ? p.x0 - x : x > p.x1 ? x - p.x1 : 0;
    const dy = y < p.y0 ? p.y0 - y : y > p.y1 ? y - p.y1 : 0;
    return Math.hypot(dx, dy);
  }
  function assignLabels(asm, phr, t, treeRight, mirror) {
    const tips = [], internals = [];
    const walk = (n) => { if (n.tip) tips.push(n); else { internals.push(n); n.children.forEach(walk); } };
    walk(asm.root);
    const used = new Set();
    // tips
    const pairs = [];
    const medH = phr.length ? phr.map(p => p.h).sort((a, b) => a - b)[Math.floor(phr.length / 2)] : 12;
    const maxGap = 1e9; // labels may sit far away at the end of dotted/dashed leader lines
    for (const tp of tips) for (const p of phr) {
      if (tp.name) continue;
      if (p.isNum && p.text.length <= 4) continue;
      const dx = p.x0 - tp.x; if (dx < -2 * t - 3 || dx > maxGap) continue;
      const dy = Math.abs(p.cy - tp.y); if (dy > Math.max(0.65 * p.h, 4)) continue;
      pairs.push([dx + 4 * dy, tp, p]);
    }
    pairs.sort((a, b) => a[0] - b[0]);
    const tipDone = new Set();
    for (const [, tp, p] of pairs) { if (tipDone.has(tp) || used.has(p)) continue; tp.label = p; tipDone.add(tp); used.add(p); }
    // extend tip labels with following phrases on the same line (e.g. accession numbers)
    for (const tp of tips) if (tp.label && !tp.name) {
      let last = tp.label; const pieces = [tp.label];
      for (const p of phr.filter(q => !used.has(q) && Math.abs(q.cy - last.cy) < 0.5 * last.h && q.x0 > last.x1).sort((a, b) => a.x0 - b.x0)) {
        if (p.x0 - last.x1 > 1.6 * last.h) break; pieces.push(p); used.add(p); last = p;
      }
      // in a mirrored figure the pieces were collected right-to-left in reading order
      if (mirror) pieces.reverse();
      tp.name = pieces.map(p => p.text).join(" ").replace(/\s+/g, " ").trim(); tp.nameConf = Math.min(...pieces.map(p => p.conf)); tp.nameBox = { x0: Math.min(...pieces.map(p => p.x0)), x1: Math.max(...pieces.map(p => p.x1)), y0: Math.min(...pieces.map(p => p.y0)), y1: Math.max(...pieces.map(p => p.y1)) };
    }
    // numbers -> supports (near node) or branch-length labels (over branch middle)
    const anchors = [];
    for (const n of internals) if (n !== asm.root || n.parentRef) {
      anchors.push({ kind: "node", n, x: n.x, y: n.y });
    }
    for (const n of [...internals, ...tips]) if (n.parentRef) {
      const px = n.parentRef.x; if (n.x - px > 2 * medH) anchors.push({ kind: "mid", n, x: (px + n.x) / 2, y: n.inY ?? n.y });
    }
    const npairs = [];
    for (const p of phr) {
      if (used.has(p) || !p.isNum) continue;
      for (const a of anchors) {
        let d = boxDist(p, a.x, a.y);
        if (a.kind === "node") { if (p.x0 > a.x + 1.5 * medH) d += medH; }
        else d = Math.max(d, Math.abs(p.cx - a.x) * 0.5) + 0.2 * medH;
        if (d <= 2.2 * medH) npairs.push([d, a, p]);
      }
    }
    npairs.sort((a, b) => a[0] - b[0]);
    const nodeDone = new Set(), midDone = new Set();
    for (const [, a, p] of npairs) {
      if (used.has(p)) continue;
      if (a.kind === "node") { if (nodeDone.has(a.n)) continue; nodeDone.add(a.n); a.n.support = p.text.replace(/[\(\)\[\]\s]/g, ""); a.n.supportConf = p.conf; a.n.supportBox = p; }
      else { if (midDone.has(a.n)) continue; midDone.add(a.n); a.n.printedLen = parseFloat(p.text.replace(/[^\d.eE+-]/g, "")); }
      used.add(p);
    }
    return { tips, internals, used };
  }

  /* ---------- convert assembled geometry to Tree ---------- */
  function toTree(asm, pxPerUnit) {
    const conv = (g, parent) => {
      const n = new Tree.TNode(g.name || "");
      if (g.support != null) n.support = g.support;
      if (parent) {
        const px = Math.max(0, g.x - parent.x);
        n.length = pxPerUnit ? px / pxPerUnit : px;
        n.px = px;
        if (g.printedLen != null && !isNaN(g.printedLen)) n.printed = g.printedLen;
      }
      n.gx = g.x; n.gy = g.y;
      if (g.nameConf != null && g.nameConf < 70) n.flag = "check";
      if (!g.tip) for (const c of g.children) n.add(conv(c, g));
      return n;
    };
    const root = conv(asm.root, null);
    // remove unary internal nodes created by detection glitches
    const tree = { root, meta: {} };
    for (const n of Tree.postorder(root)) if (!n.isTip && n.children.length === 1) Tree.spliceUnary(tree, n);
    return tree;
  }

  /* ---------- main entry ---------- */
  // img: ImageData (already oriented so the root is on the left unless opts.mirror)
  // ocr: async (imageData, {psm}) => [{text, conf, x0,y0,x1,y1}] | null
  async function read(img, opts = {}, ocr = null, progress0 = () => {}) {
    const tick = () => new Promise(r => setTimeout(r, 0));
    const progress = (m, p) => { progress0(m, p); };
    const step = async (m, p) => { progress0(m, p); await tick(); };
    flattenAlpha(img);
    const warnings = [];
    await step("Finding ink", 0.05);
    const { mask, W, H } = inkMask(img, opts);
    const circular = opts.layout === "circular";
    let geo, space, words = [], unwrapped = null;
    if (!circular) {
      const m = opts.mirror ? mirrorMask(mask, W, H) : mask;
      await step("Tracing branches", 0.15);
      geo = geometry(m, W, H, opts);
      space = { kind: "rect", W, H, mirror: !!opts.mirror, toImg: (x, y) => [opts.mirror ? W - 1 - x : x, y] };
    } else {
      await step("Locating the centre", 0.1);
      const pre = components(mask, W, H);
      const big = pre.comps.slice().sort((a, b) => b.n - a.n)[0];
      const cm = new Uint8Array(W * H); for (let p = 0; p < W * H; p++) if (pre.lab[p] === big.id) cm[p] = 1;
      const c = opts.center || findCenter(cm, W, H);
      // radius of tree, angular gap
      let R = 0; const bins = new Uint32Array(720);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (cm[y * W + x]) {
        const r = Math.hypot(x - c.cx, y - c.cy); if (r > R) R = r;
        if (r > 3) bins[Math.floor(((Math.atan2(y - c.cy, x - c.cx) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * 720) % 720]++;
      }
      let bestStart = 0, bestLen = -1;
      for (let s = 0; s < 720; s++) { let k = 0; while (k < 720 && bins[(s + k) % 720] === 0) k++; if (k > bestLen) { bestLen = k; bestStart = s; } }
      let theta0 = bestLen > 0 ? (bestStart + bestLen / 2) / 720 * 2 * Math.PI : (bins.indexOf(Math.min(...bins)) / 720) * 2 * Math.PI;
      const Rtext = Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => Math.hypot(x - c.cx, y - c.cy)));
      const Rlab = R * 1.12 + 10;
      let rows = Math.round(2 * Math.PI * Rlab); rows = Math.min(rows, 7000);
      const g = polarGrid(c.cx, c.cy, Math.min(Rtext, R * 2.2 + 40), rows, theta0);
      await step("Unrolling the circle", 0.18);
      const um = unwrapMask(cm, W, H, g);
      // the centre collapses into a blob in polar space; blank the innermost columns
      const t0 = Math.max(1, strokeWidth(cm, W, H));
      let r0 = Math.ceil(3 * t0 + 3);
      for (let r = r0; r < g.cols * 0.5; r++) { let k = 0; for (let row = 0; row < g.rows; row++) k += um[row * g.cols + r]; if (k / g.rows < 0.12) { r0 = r; break; } }
      r0 += t0;
      for (let row = 0; row < g.rows; row++) for (let r = 0; r < r0; r++) um[row * g.cols + r] = 0;
      opts = Object.assign({}, opts, { polarR0: r0 });
      geo = geometry(um, g.cols, g.rows, opts);
      unwrapped = { g, img: null, mask: um };
      space = { kind: "polar", W, H, g, center: c, toImg: (x, y) => g.toXY(x, y) };
      if (bestLen < 4) warnings.push("The circle is closed with no clear gap; the first and last taxa may be split incorrectly.");
    }
    const asm = geo.asm;
    if (asm.fragments) warnings.push(`${asm.fragments} disconnected piece${asm.fragments > 1 ? "s" : ""} of line art (${asm.lostTips} tip${asm.lostTips === 1 ? "" : "s"}) could not be attached and ${asm.fragments > 1 ? "were" : "was"} left out.`);
    if (circular) {
      // remove wobble stubs before reading names, so they don't steal neighbouring labels
      const stub0 = Math.max(3 * geo.t, 1.0 * geo.textH);
      (function prune(n) { if (n.tip) return; const k = n.children; n.children = k.filter((c, i) => !(c.tip && !c.dot && (c.x - n.x) < stub0 && ((i > 0 && i < k.length - 1) || c.zero))); n.children.forEach(prune); })(asm.root);
    }
    // OCR
    let phr = [], clean = null;
    const pdfWords = opts.words && opts.words.length ? opts.words : null;
    if ((ocr || pdfWords) && opts.ocr !== false) {
      await step(pdfWords ? "Using the PDF's text" : "Reading labels", 0.3);
      // erase tree pixels so OCR sees text only
      clean = new ImageData(new Uint8ClampedArray(img.data), W, H);
      const { lab } = circular ? components(mask, W, H) : { lab: null };
      const treeMaskImg = new Uint8Array(W * H);
      if (!circular) {
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const xx = opts.mirror ? W - 1 - x : x; if (geo.lineMask[y * W + x]) treeMaskImg[y * W + xx] = 1; }
      } else {
        const big = components(mask, W, H); const bc = big.comps.slice().sort((a, b) => b.n - a.n)[0];
        for (let p = 0; p < W * H; p++) if (big.lab[p] === bc.id) treeMaskImg[p] = 1;
      }
      const d = clean.data;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let on = 0;
        for (let dy = -1; dy <= 1 && !on; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && xx >= 0 && yy < H && xx < W && treeMaskImg[yy * W + xx]) { on = 1; break; } }
        if (on) { const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; }
      }
      if (!circular) {
        const sc = Math.max(1, Math.min(4, 30 / Math.max(4, geo.textH)));
        words = pdfWords ? pdfWords.filter(w => !w.rot) : await ocr(clean, { psm: 11, scale: sc }, (p) => progress("Reading labels", 0.3 + 0.55 * p));
        words = cleanWords(words);
        phr = phrases(words);
        if (opts.mirror) phr = phr.map(p => Object.assign({}, p, { x0: W - 1 - p.x1, x1: W - 1 - p.x0, cx: W - 1 - p.cx }));
      } else {
        const g = space.g;
        // (1) horizontal text (support values, scale bar): full-image OCR mapped into polar space
        const flat = phrases(cleanWords(pdfWords ? pdfWords.filter(w => !w.rot) : await ocr(clean, { psm: 11 }, (p) => progress("Reading numbers", 0.3 + 0.2 * p))));
        phr = flat.filter(q => q.isNum).map(q => {
          const r = Math.hypot(q.cx - g.cx, q.cy - g.cy);
          let a = Math.atan2(q.cy - g.cy, q.cx - g.cx) - g.theta0; a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          const row = a / g.dth, half = q.h / 2, dr = half / Math.max(1, r * g.dth);
          return Object.assign({}, q, { x0: r - half, x1: r + half, cx: r, y0: row - dr, y1: row + dr, cy: row, h: q.h });
        });
        space.flatPhrases = flat;
        // (2) tip names: OCR a radial strip beyond every tip, both ways up
        const tipsG = []; (function f(n) { if (n.tip) tipsG.push(n); else n.children.forEach(f); })(asm.root);
        tipsG.sort((a, b) => a.y - b.y);
        if (pdfWords) {
          // names straight from the PDF text: the nearest text item out along each tip's ray
          const polar = pdfWords.map(w => { const r = Math.hypot(w.cx - g.cx, w.cy - g.cy); let a = Math.atan2(w.cy - g.cy, w.cx - g.cx) - g.theta0; a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); return { w, r, row: a / g.dth }; });
          const used = new Set();
          for (const tp of tipsG) {
            let best = null, bd = 1e9;
            for (const q of polar) {
              if (used.has(q) || q.r < tp.x - 2) continue;
              const off = Math.abs(q.row - tp.y) * g.dth * q.r; const h = q.w.y1 - q.w.y0 || 8;
              if (off > Math.max(0.9 * h, 4)) continue;
              const d = q.r - tp.x - (q.w.len || 0) / 2 + 3 * off; if (d < bd) { bd = d; best = q; }
            }
            if (best && !/^[\d.\/%]+$/.test(best.w.text)) { used.add(best); tp.name = best.w.text.trim(); tp.nameConf = 99; }
          }
        }
        for (let i = 0; i < tipsG.length && !pdfWords; i++) {
          const tp = tipsG[i];
          progress("Reading taxon names", 0.5 + 0.4 * i / tipsG.length);
          const a = g.theta0 + tp.y * g.dth, dir = [Math.cos(a), Math.sin(a)], up = [Math.sin(a), -Math.cos(a)];
          const rTip = tp.x;
          const gaps = [];
          if (i > 0) gaps.push((tp.y - tipsG[i - 1].y) * g.dth * rTip);
          if (i < tipsG.length - 1) gaps.push((tipsG[i + 1].y - tp.y) * g.dth * rTip);
          const sp = gaps.length ? Math.min(...gaps) : 30;
          const hh = Math.max(6, Math.min(26, 0.62 * sp));
          let L = 0; for (let u = 0; u < 4 * g.R; u += 4) { const x = g.cx + (rTip + u) * dir[0], y = g.cy + (rTip + u) * dir[1]; if (x < 0 || y < 0 || x >= W || y >= H) break; L = u; }
          if (L < 8) continue;
          const start = rTip + 2 * geo.t + 1;
          const sw = Math.ceil(L), sh = Math.ceil(2 * hh);
          const sd = new Uint8ClampedArray(sw * sh * 4); const cd = clean.data;
          for (let j = 0; j < sh; j++) for (let u = 0; u < sw; u++) {
            const fx = g.cx + (start + u) * dir[0] + (hh - j) * up[0], fy = g.cy + (start + u) * dir[1] + (hh - j) * up[1];
            const o = (j * sw + u) * 4; const x0 = Math.floor(fx), y0 = Math.floor(fy);
            if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) { sd[o] = sd[o + 1] = sd[o + 2] = sd[o + 3] = 255; continue; }
            const dx = fx - x0, dy = fy - y0;
            for (let k = 0; k < 3; k++) { const ii = (y0 * W + x0) * 4 + k; sd[o + k] = (cd[ii] * (1 - dx) + cd[ii + 4] * dx) * (1 - dy) + (cd[ii + W * 4] * (1 - dx) + cd[ii + W * 4 + 4] * dx) * dy; }
            sd[o + 3] = 255;
          }
          // trim the strip to where ink is, so OCR sees one line of text
          let lastInk = -1, firstInk = -1;
          for (let u = 0; u < sw; u++) { let ink = false; for (let j = 0; j < sh && !ink; j++) { const o = (j * sw + u) * 4; if (sd[o] + sd[o + 1] + sd[o + 2] < 3 * 160) ink = true; } if (ink) { if (firstInk < 0) firstInk = u; lastInk = u; } else if (firstInk >= 0 && u - lastInk > 3 * hh) break; }
          if (firstInk < 0 || firstInk > 6 * hh) continue;
          const cx0 = Math.max(0, firstInk - 6), cx1 = Math.min(sw, lastInk + 8), cw = cx1 - cx0;
          const pad = 8, crop = new Uint8ClampedArray((cw + 2 * pad) * (sh + 2 * pad) * 4).fill(255);
          for (let j = 0; j < sh; j++) for (let u = 0; u < cw; u++) { const o = (j * sw + u + cx0) * 4, q = ((j + pad) * (cw + 2 * pad) + u + pad) * 4; crop[q] = sd[o]; crop[q + 1] = sd[o + 1]; crop[q + 2] = sd[o + 2]; }
          const strip = { width: cw + 2 * pad, height: sh + 2 * pad, data: crop };
          const sc = Math.max(1, Math.min(4, 40 / (2 * hh)));
          const read = async (im, flipped) => {
            const ws = cleanWords(await ocr(im, { psm: 7, scale: sc })).filter(w => w.conf >= 30);
            const text = ws.map(w => w.text).join(" ").trim();
            const conf = ws.length ? ws.reduce((s0, w) => s0 + w.conf, 0) / ws.length : 0;
            return { text, conf, flipped };
          };
          const r1 = await read(strip, false), r2 = await read(rotate180(strip), true);
          const left = Math.cos(a) < 0;
          const sc2 = (r) => r.text ? r.conf * (left === r.flipped ? 1.35 : 1) * (/^[A-Z][a-z]+\s[a-z]+/.test(r.text) ? 1.25 : 1) * Math.min(1, r.text.length / 5) : 0;
          const best = sc2(r1) >= sc2(r2) ? r1 : r2;
          if (best.text) { tp.name = best.text; tp.nameConf = best.conf; }
        }
        unwrapped.img = null;
      }
    }
    await step("Matching labels to branches", 0.9);
    let treeRight = 0; (function f(n) { treeRight = Math.max(treeRight, n.x); n.children.forEach(f); })(asm.root);
    const lab = assignLabels(asm, phr, geo.t, treeRight, !!opts.mirror && !circular);
    // second look at node support values: digit-only OCR of small crops where labels are expected
    if (!circular && clean && ocr && !pdfWords) {
      const ints = lab.internals.filter(n => n !== asm.root);
      const have = ints.filter(n => n.supportBox);
      if (have.length >= Math.max(2, 0.25 * ints.length)) {
        const med = (arr) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)];
        const toImgX = (x) => opts.mirror ? W - 1 - x : x;
        const offX = med(have.map(n => n.supportBox.cx - n.x)), offY = med(have.map(n => n.supportBox.cy - n.y));
        const bw = med(have.map(n => n.supportBox.x1 - n.supportBox.x0)), bh = med(have.map(n => n.supportBox.y1 - n.supportBox.y0));
        const todo = ints.filter(n => !n.supportBox || n.supportConf < 85 || !/^\d/.test(n.support));
        let k = 0;
        for (const n of todo) {
          progress("Checking support values", 0.86 + 0.04 * (k++ / todo.length));
          const cx = n.supportBox ? n.supportBox.cx : n.x + offX, cy = n.supportBox ? n.supportBox.cy : n.y + offY;
          const w = n.supportBox ? (n.supportBox.x1 - n.supportBox.x0) : bw * 1.6, hgt = bh;
          let x0 = Math.round(cx - w / 2 - hgt * 0.4), x1 = Math.round(cx + w / 2 + hgt * 0.4);
          const y0 = Math.max(0, Math.round(cy - hgt * 0.75)), y1 = Math.min(H, Math.round(cy + hgt * 0.75));
          if (opts.mirror) { const a = toImgX(x1), b = toImgX(x0); x0 = a; x1 = b; }
          x0 = Math.max(0, x0); x1 = Math.min(W, x1);
          if (x1 - x0 < 3 || y1 - y0 < 3) continue;
          const cw = x1 - x0, ch = y1 - y0, pad = 6;
          const cd = new Uint8ClampedArray((cw + 2 * pad) * (ch + 2 * pad) * 4).fill(255);
          for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const si = ((y + y0) * W + x + x0) * 4, di = ((y + pad) * (cw + 2 * pad) + x + pad) * 4; cd[di] = clean.data[si]; cd[di + 1] = clean.data[si + 1]; cd[di + 2] = clean.data[si + 2]; }
          const ws = await ocr({ width: cw + 2 * pad, height: ch + 2 * pad, data: cd }, { psm: 7, scale: Math.max(2, Math.min(6, 36 / Math.max(4, hgt))), whitelist: "0123456789./%" });
          const txt = ws.filter(q => q.conf > 40).map(q => q.text).join("").replace(/^[./]+|[./]+$/g, "");
          const conf = ws.length ? Math.min(...ws.map(q => q.conf)) : 0;
          if (/^\d+(\.\d+)?(\/\d+(\.\d+)?)*%?$/.test(txt) && (!n.supportBox || conf > n.supportConf)) { n.support = txt; n.supportConf = conf; }
        }
      }
    }
    // second look at doubtful taxon names: OCR each label line on its own, enlarged
    if (!circular && clean && ocr && !pdfWords) {
      const doubt = lab.tips.filter(tp => tp.nameBox && tp.nameConf < 88);
      let k = 0;
      for (const tp of doubt) {
        progress("Re-reading unclear names", 0.9 + 0.05 * (k++ / doubt.length));
        const b = tp.nameBox, hgt = b.y1 - b.y0;
        let x0 = b.x0 - hgt * 0.3, x1 = b.x1 + hgt * 0.3;
        if (opts.mirror) { const a = W - 1 - x1, c = W - 1 - x0; x0 = a; x1 = c; }
        x0 = Math.max(0, Math.round(x0)); x1 = Math.min(W, Math.round(x1));
        const y0 = Math.max(0, Math.round(b.y0 - hgt * 0.3)), y1 = Math.min(H, Math.round(b.y1 + hgt * 0.3));
        const cw = x1 - x0, ch = y1 - y0, pad = 8; if (cw < 4 || ch < 4) continue;
        const cd = new Uint8ClampedArray((cw + 2 * pad) * (ch + 2 * pad) * 4).fill(255);
        for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const si = ((y + y0) * W + x + x0) * 4, di = ((y + pad) * (cw + 2 * pad) + x + pad) * 4; cd[di] = clean.data[si]; cd[di + 1] = clean.data[si + 1]; cd[di + 2] = clean.data[si + 2]; }
        const ws = cleanWords(await ocr({ width: cw + 2 * pad, height: ch + 2 * pad, data: cd }, { psm: 7, scale: Math.max(1.5, Math.min(5, 42 / Math.max(4, hgt))) }));
        if (!ws.length) continue;
        const txt = ws.map(w => w.text).join(" ").replace(/\s+/g, " ").trim(), conf = Math.min(...ws.map(w => w.conf));
        if (txt && conf > tp.nameConf + 3 && txt.length >= 0.85 * tp.name.length) { tp.name = txt; tp.nameConf = conf; }
      }
    }
    // drop stubs: very short, unlabelled tips in the middle of a vertical (glyph bits or wobble)
    const stubLen = Math.max(3 * geo.t, 1.0 * geo.textH);
    let dropped = 0;
    (function prune(n) {
      if (n.tip) return;
      const k = n.children;
      const ocrRan = phr.length > 0;
      n.children = k.filter((c, i) => !(c.tip && !c.name && !c.dot && (c.x - n.x) < stubLen && (ocrRan || (i > 0 && i < k.length - 1 && !c.zero))) || (dropped++, false));
      n.children.forEach(prune);
    })(asm.root);
    if (phr.length) {
      const named = []; (function f(n) { if (n.tip && n.name) named.push(n); n.children.forEach(f); })(asm.root);
      (function f(n) { n.children = n.children.filter(c => !(c.tip && !c.name && named.some(m => Math.abs((m.inY ?? m.y) - (c.inY ?? c.y)) < 0.45 * geo.textH + geo.t))); n.children.forEach(f); })(asm.root);
    }
    (function dropEmpty(n) { n.children.forEach(dropEmpty); n.children = n.children.filter(c => c.tip || c.children.length); })(asm.root);
    // scale bar
    let pxPerUnit = null, scaleInfo = null;
    const scaleCands = geo.scale.slice();
    for (const s of scaleCands) {
      let best = null, bd = 1e9;
      for (const p of phr) {
        if (lab.used.has(p)) continue;
        if (!/^\s*[-+]?\d*\.?\d+([eE][-+]?\d+)?(\s*[A-Za-z%/ .-]*)?$/.test(p.text)) continue;
        const m = /([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/.exec(p.text); if (!m) continue;
        const d = Math.abs(p.cy - s.y) + Math.max(0, Math.abs(p.cx - (s.x1 + s.x2) / 2) - (s.x2 - s.x1) / 2);
        if (Math.abs(p.cy - s.y) < 3.5 * p.h && d < bd) { bd = d; best = p; }
      }
      if (best) {
        const v = parseFloat(/([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/.exec(best.text)[1]);
        if (v > 0) { pxPerUnit = s.len / v; scaleInfo = { px: s.len, value: v, text: best.text, units: best.text.replace(/^[^A-Za-z%]*/, "").trim() }; lab.used.add(best); break; }
      }
      if (!scaleInfo) scaleInfo = { px: s.len, value: null };
    }
    if (circular && scaleInfo && !pxPerUnit && scaleInfo.px) { /* bar found in polar space - unreliable */ scaleInfo = null; }
    // calibrate from printed branch lengths if no scale bar value
    const allG = []; (function f(n) { allG.push(n); n.children.forEach(f); })(asm.root);
    const printed = allG.filter(n => n.printedLen > 0 && n.parentRef);
    if (!pxPerUnit && printed.length >= 2) {
      const r = printed.map(n => (n.x - n.parentRef.x) / n.printedLen).sort((a, b) => a - b);
      pxPerUnit = r[Math.floor(r.length / 2)]; scaleInfo = { fromPrinted: printed.length };
    }
    const tree = toTree(asm, pxPerUnit);
    const nTips = Tree.tips(tree.root).length;
    if (opts.layout === "cladogram") { for (const n of Tree.nodes(tree.root)) n.length = null; tree.meta.lengthUnits = "none"; }
    else if (pxPerUnit) tree.meta.lengthUnits = scaleInfo && scaleInfo.units ? scaleInfo.units : "";
    else {
      // relative: scale so the deepest tip is at 1
      const dist = new Map(); let maxD = 0;
      for (const n of Tree.nodes(tree.root)) { const d = n.parent ? dist.get(n.parent) + (n.length || 0) : 0; dist.set(n, d); maxD = Math.max(maxD, d); }
      if (maxD > 0) for (const n of Tree.nodes(tree.root)) if (n.length != null) n.length = n.length / maxD;
      tree.meta.lengthUnits = "relative";
      tree.meta.pxScale = maxD;
      warnings.push("No scale bar value was read, so branch lengths are relative (deepest tip = 1). Use Calibrate to set the real scale.");
    }
    for (const n of Tree.postorder(tree.root)) if (n.printed != null) n.attrs = Object.assign(n.attrs || {}, { printed_length: String(n.printed) });
    const named = Tree.tips(tree.root).filter(n => n.name).length;
    if ((ocr || pdfWords) && opts.ocr !== false && named < nTips) warnings.push(`${nTips - named} of ${nTips} tip labels could not be read and were left blank.`);
    tree.meta.source = "local"; tree.meta.layout = circular ? "circular" : (opts.layout || "rectangular");
    tree.meta.scale = scaleInfo; tree.meta.pxPerUnit = pxPerUnit;
    progress("Done", 1);
    return { tree, warnings, debug: { mask: circular ? null : geo.tmask, W, H, asm, space, phrases: phr, t: geo.t, scale: geo.scale, unwrapped }, tipOrder: Tree.tips(tree.root) };
  }
  function rotate180(img) {
    const { width: W, height: H, data } = img; const out = new Uint8ClampedArray(data.length);
    for (let p = 0, q = W * H - 1; p < W * H; p++, q--) { out[q * 4] = data[p * 4]; out[q * 4 + 1] = data[p * 4 + 1]; out[q * 4 + 2] = data[p * 4 + 2]; out[q * 4 + 3] = 255; }
    return { width: W, height: H, data: out };
  }

  return { read, inkMask, components, geometry, assemble, hSegments, vSegments, phrases, cleanWords, findCenter, debug: false };
})();
if (typeof module !== "undefined") module.exports = Engine;
