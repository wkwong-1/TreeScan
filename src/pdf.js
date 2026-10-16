/* ===== PDF input (pdf.js): render a page and keep its text with positions ===== */
const PDFIn = (() => {
  const VER = "3.11.174";
  let libP = null;
  function lib() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!libP) libP = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${VER}/pdf.min.js`;
      s.onload = () => {
        const L = window.pdfjsLib;
        L.GlobalWorkerOptions.workerSrc = window.TREESCAN_LOCAL_TESS ? new URL("pdf/pdf.worker.min.js", location.href).href : `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${VER}/pdf.worker.min.js`;
        res(L);
      };
      s.onerror = () => { libP = null; rej(new Error("The PDF reader could not be loaded.")); };
      document.head.append(s);
    });
    return libP;
  }
  async function open(file) {
    const L = await lib();
    return L.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  }
  async function render(doc, pageNo, maxSide = 3000) {
    const L = await lib();
    const page = await doc.getPage(pageNo);
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(8, maxSide / Math.max(v1.width, v1.height));
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const tc = await page.getTextContent();
    const words = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const m = L.Util.transform(vp.transform, it.transform);
      const fh = Math.hypot(m[2], m[3]) || 8;
      const ang = Math.atan2(m[1], m[0]);
      const len = (it.width || 0) * scale || it.str.length * fh * 0.5;
      const dir = [Math.cos(ang), Math.sin(ang)], up = [Math.sin(ang), -Math.cos(ang)];
      const x = m[4], y = m[5];
      words.push({
        text: it.str.replace(/\s+/g, " ").trim(), conf: 99, ang, len, h: fh,
        x0: x, x1: x + len, y0: y - 0.78 * fh, y1: y + 0.22 * fh,
        cx: x + dir[0] * len / 2 + up[0] * fh * 0.3, cy: y + dir[1] * len / 2 + up[1] * fh * 0.3,
        rot: Math.abs(Math.sin(ang)) > 0.09 || Math.cos(ang) < 0,
      });
    }
    return { canvas: c, words, pages: doc.numPages };
  }
  // words follow the image when it is rotated by 90/180/270 degrees clockwise
  function rotateWords(words, rot, W, H) {
    if (!rot) return words;
    const P = (x, y) => rot === 90 ? [H - y, x] : rot === 270 ? [y, W - x] : [W - x, H - y];
    return words.map(w => {
      const a = w.ang + rot * Math.PI / 180;
      const [cx, cy] = P(w.cx, w.cy);
      const horiz = Math.abs(Math.sin(a)) <= 0.09 && Math.cos(a) > 0;
      const half = w.len / 2;
      return Object.assign({}, w, { ang: a, cx, cy, rot: !horiz, x0: cx - half, x1: cx + half, y0: cy - 0.5 * w.h, y1: cy + 0.5 * w.h });
    });
  }
  return { open, render, rotateWords };
})();
