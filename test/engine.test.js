// End-to-end test of the local image reader on the synthetic figures in test/fixtures.
// Runs the real code in headless Chromium (Playwright) with Tesseract and PDF.js from node_modules.
//   npm install && npx playwright install chromium && node test/engine.test.js
// Set PLAYWRIGHT_CHROMIUM_PATH to use an existing Chromium build instead.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const score = require("./score.js");
const truth = require("./fixtures/truth.json");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".pdf": "application/pdf", ".json": "application/json" };

// file, reader options, minimum expectations
const CASES = [
  ["rect12.png", {}, { tips: 12, names: 12, clades: 10, supports: 9, len: 0.02 }],
  ["rect20.png", {}, { tips: 20, names: 20, clades: 18, supports: 14, len: 0.03 }],
  ["rect20_blue.png", {}, { tips: 20, names: 20, clades: 18, supports: 14, len: 0.03 }],
  ["rect40.png", {}, { tips: 40, names: 38, clades: 34, supports: 24, len: 0.04 }],
  ["rect40.jpg", {}, { tips: 40, names: 38, clades: 34, supports: 24, len: 0.04 }],
  ["clado10.png", { layout: "cladogram" }, { tips: 10, names: 10, clades: 8, supports: 8 }],
  ["lead18.png", {}, { tips: 18, names: 16 }],
  ["lead18r.png", { mirror: true }, { tips: 18, names: 16 }],
  ["lead18.pdf", {}, { tips: 18, names: 18, clades: 16, len: 0.03 }],
  ["lead18r.pdf", { mirror: true }, { tips: 18, names: 18, clades: 16, len: 0.03 }],
  ["circ16.png", { layout: "circular" }, { tips: 16, names: 14 }],
];

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`http://localhost:${port}/test/harness.html`);
  const rows = [];
  let failed = 0;
  for (const [file, opts, want] of CASES) {
    const t0 = Date.now();
    let s, problems = [];
    try {
      const r = await page.evaluate(([f, o]) => window.readFigure(f, o), [`/test/fixtures/${file}`, opts]);
      s = score(r.newick, truth[file.replace(/\.(png|jpg|pdf)$/, "")]);
      if (s.tips !== want.tips) problems.push(`tips ${s.tips}/${want.tips}`);
      for (const k of ["names", "clades", "supports"]) if (want[k] != null && s[k] < want[k]) problems.push(`${k} ${s[k]} < ${want[k]}`);
      if (want.len != null && !(s.medianLenErr <= want.len)) problems.push(`length error ${s.medianLenErr}`);
    } catch (e) { problems.push(e.message); }
    if (problems.length) failed++;
    rows.push({ file, ok: problems.length ? "FAIL" : "ok", tips: s && `${s.tips}/${s.trueTips}`, names: s && `${s.names}/${s.trueTips}`, clades: s && `${s.clades}/${s.trueClades}`,
      supports: s && `${s.supports}/${s.trueSupports}`, "median len err": s && s.medianLenErr != null ? s.medianLenErr.toFixed(3) : "-", seconds: ((Date.now() - t0) / 1000).toFixed(1), problems: problems.join("; ") });
  }
  console.table(rows);
  await browser.close();
  server.close();
  if (failed) { console.error(`${failed} of ${CASES.length} figures below expectations`); process.exitCode = 1; }
  else console.log(`all ${CASES.length} figures read as expected`);
})();
