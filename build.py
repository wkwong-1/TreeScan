#!/usr/bin/env python3
"""Assemble Treescan from src/ into a single HTML page.

Usage:
    python3 build.py            # -> treescan.html  (standalone; libraries load from public CDNs)
    python3 build.py --hosted   # -> dist/hosted/   (page body plus tess/ and pdf/ assets, for hosts that
                                #    block CDN workers; needs `npm install` first)

The standalone file opens directly in a browser (file://) and needs internet access the first
time it runs OCR or opens a PDF.
"""
import argparse
import base64
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
FIX = ROOT / "test" / "fixtures"
NODE = ROOT / "node_modules"

# order matters: later modules use earlier ones
MODULES = ["core.js", "engine.js", "ocr.js", "pdf.js", "vision.js", "tangle.js", "ui.js"]
TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"
FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700'
         '&family=JetBrains+Mono:wght@400;600&family=Source+Serif+4:ital,opsz,wght@1,8..60,400;1,8..60,600&display=swap">')


def read(name):
    return (SRC / name).read_text(encoding="utf-8")


def example():
    """Sample figure + its tree, shown when the app opens."""
    img = FIX / "rect12.png"
    truth = json.loads((FIX / "truth.json").read_text())
    return {"img": "data:image/png;base64," + base64.b64encode(img.read_bytes()).decode(), "newick": truth["rect12"]}


def scripts(local_assets):
    cfg = (f"window.TREESCAN_LOCAL_TESS={'true' if local_assets else 'false'};"
           f"window.TREESCAN_EXAMPLE={json.dumps(example())};")
    body = "\n".join(read(m) for m in MODULES)
    return f'<script src="{TESSERACT_CDN}"></script>\n<script>{cfg}</script>\n<script>\n{body}\n</script>'


def head():
    return ('<title>Treescan</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
            f"{FONTS}\n<style>\n{read('style.css')}\n</style>\n")


def build_standalone(out):
    html = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
            f"{head()}</head><body>\n{read('body.html')}{scripts(False)}\n</body></html>\n")
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")


def build_hosted(out_dir):
    """Page body (no <html>/<head>; the host wraps it) plus same-origin worker assets."""
    need = {
        "tesseract.js/dist/worker.min.js": "tess/worker.min.js",
        "tesseract.js-core/tesseract-core-lstm.wasm.js": "tess/tesseract-core-lstm.wasm.js",
        "tesseract.js-core/tesseract-core-simd-lstm.wasm.js": "tess/tesseract-core-simd-lstm.wasm.js",
        "pdfjs-dist/build/pdf.worker.min.js": "pdf/pdf.worker.min.js",
    }
    missing = [k for k in need if not (NODE / k).exists()]
    lang = NODE / "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"
    if not lang.exists():
        missing.append(str(lang.relative_to(NODE)))
    if missing:
        sys.exit("missing node_modules files (run `npm install`):\n  " + "\n  ".join(missing))
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "index.html").write_text(head() + read("body.html") + scripts(True), encoding="utf-8")
    for src, dst in need.items():
        (out_dir / dst).parent.mkdir(parents=True, exist_ok=True)
        data = (NODE / src).read_bytes()
        if dst == "tess/worker.min.js":
            # tesseract.js 5.1.1 passes `data` instead of `code` when languages are given as objects
            data = data.replace(b'return"string"==typeof t?t:t.data}', b'return"string"==typeof t?t:t.code}')
        (out_dir / dst).write_bytes(data)
    # language data as base64 JSON: some hosts only serve common file types
    (out_dir / "tess/eng.json").write_text(json.dumps({"b64": base64.b64encode(lang.read_bytes()).decode()}))
    print(f"wrote {out_dir.relative_to(ROOT)}/ (index.html, tess/, pdf/)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--hosted", action="store_true", help="also build dist/hosted/ with local worker assets")
    a = ap.parse_args()
    build_standalone(ROOT / "treescan.html")
    if a.hosted:
        build_hosted(ROOT / "dist" / "hosted")
