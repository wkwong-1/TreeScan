/* ===== OCR wrapper (Tesseract.js) ===== */
const OCR = (() => {
  let workerP = null, listener = null, failed = null;
  function cfg() {
    if (window.TREESCAN_TESS_CONFIG) return window.TREESCAN_TESS_CONFIG; // e.g. tests serving node_modules
    const local = !!window.TREESCAN_LOCAL_TESS;
    if (local) {
      const base = new URL("tess/", location.href).href;
      return { workerPath: base + "worker.min.js", corePath: base, langJSON: base + "eng.json", workerBlobURL: false, cacheMethod: "none", gzip: true };
    }
    return {
      workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
      corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",
      langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int",
      gzip: true,
    };
  }
  async function worker() {
    if (workerP) return workerP;
    if (failed) throw failed;
    if (!window.Tesseract) throw new Error("The text reader (Tesseract) did not load.");
    workerP = (async () => {
      const c = cfg();
      let lang = "eng";
      if (c.langJSON) {
        // language data ships as base64 JSON next to the page (the viewer serves only common file types)
        const j = await (await fetch(c.langJSON)).json();
        const bin = atob(j.b64), data = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
        lang = [{ code: "eng", data }];
      }
      return Tesseract.createWorker(lang, 1, Object.assign({ logger: (m) => listener && listener(m), errorHandler: (e) => console.warn("tesseract", e) }, c));
    })().catch((e) => { failed = new Error("Text reader failed to start: " + (e && e.message || e)); workerP = null; throw failed; });
    return workerP;
  }
  function toCanvas(img, scale) {
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    const id = img instanceof ImageData ? img : new ImageData(img.data instanceof Uint8ClampedArray ? img.data : new Uint8ClampedArray(img.data), img.width, img.height);
    ctx.putImageData(id, 0, 0);
    if (scale === 1) return c;
    const s = document.createElement("canvas");
    s.width = Math.round(img.width * scale); s.height = Math.round(img.height * scale);
    const sx = s.getContext("2d"); sx.imageSmoothingQuality = "high"; sx.fillStyle = "#fff"; sx.fillRect(0, 0, s.width, s.height);
    sx.drawImage(c, 0, 0, s.width, s.height);
    return s;
  }
  function flattenWords(data) {
    if (data.words && data.words.length) return data.words;
    const out = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) out.push(w);
    return out;
  }
  async function recognize(img, opts = {}, onProgress) {
    const w = await worker();
    const px = img.width * img.height;
    let scale = opts.scale || (Math.max(img.width, img.height) < 1400 ? 2 : 1);
    if (px * scale * scale > 16e6) scale = Math.max(0.5, Math.sqrt(16e6 / px));
    const canvas = toCanvas(img, scale);
    await w.setParameters({ tessedit_pageseg_mode: String(opts.psm || 11), preserve_interword_spaces: "1", user_defined_dpi: "300", tessedit_char_whitelist: opts.whitelist || "" });
    listener = (m) => { if (m.status === "recognizing text" && onProgress) onProgress(m.progress); };
    try {
      const { data } = await w.recognize(canvas, {}, { blocks: true, text: true });
      return flattenWords(data).map(x => ({ text: x.text, conf: x.confidence, x0: x.bbox.x0 / scale, y0: x.bbox.y0 / scale, x1: x.bbox.x1 / scale, y1: x.bbox.y1 / scale }));
    } finally { listener = null; }
  }
  async function available() { try { await worker(); return true; } catch (e) { return false; } }
  return { recognize, available, warm: () => worker().catch(() => {}) };
})();
