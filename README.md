# TreeScan

**Turn images and PDFs of phylogenetic trees into editable tree files, and compare two trees as a tanglegram, all in the browser.**

TreeScan reads a published tree figure (PNG, JPEG, WebP, screenshot, PDF page) or standard tree file formats (Newick, NEXUS, PhyloXML) and reconstructs the tree, including taxon names, branch lengths and support values. You can then edit it and export it in standard formats (Newick, NEXUS, PhyloXML) that other phylogenetics programs can open. A second workspace draws **tanglegrams** for co-phylogenetic comparisons, such as host–symbiont, host–parasite or gene–species trees, and rotates branches to minimise crossing links.

TreeScan is a single HTML file. It needs no installation and no server, and runs in any modern browser.

TreeScan was created with AI coding tools; always perform independent verification of outputs.

---

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Reading a tree from a figure](#reading-a-tree-from-a-figure)
- [Editing trees](#editing-trees)
- [Exporting](#exporting)
- [Tanglegrams](#tanglegrams)
- [How it works](#how-it-works)
- [Accuracy and limitations](#accuracy-and-limitations)
- [Repository layout](#repository-layout)
- [Building from source](#building-from-source)
- [Running the tests](#running-the-tests)
- [Third-party components](#third-party-components)
- [Citation](#citation)
- [License](#license)

---

## Features

**Figure → tree**
- Reads rectangular phylograms, cladograms and circular (fan) trees, with the root on any side.
- Extracts taxon names, branch lengths (calibrated from the scale bar, or from lengths printed on branches), and support values (bootstrap, posterior, combined values such as `95/1.00`).
- Follows dotted or dashed leader lines from tips to aligned labels, and recognises tips drawn as dots, including taxa sitting directly on a vertical line (zero-length branches).
- **PDF input:** when the PDF has embedded text (as most figures exported from R/ggtree, FigTree, iTOL and similar do), names and numbers are taken directly from the file, so the spellings are exact.
- Three readers:
  - **Local:** line tracing plus OCR (Tesseract). Runs fully offline in the browser, so images never leave your computer.
  - **Claude:** a vision model reads the whole figure. Handles unusual layouts, including unrooted/radial trees.
  - **Hybrid:** Claude reads labels, support values and topology, and the line tracer measures exact branch lengths from the pixels.
- An overlay on the source image shows the traced lines, so you can check the result. Uncertain names are flagged for review.

**Editing**
- Reroot on any branch, root with an outgroup, or midpoint-root.
- Flip a node or a whole clade, and ladderize the whole tree or a clade.
- Collapse branches (one at a time, or every branch below a support threshold), resolve polytomies, delete taxa or clades, or keep only one clade.
- Edit names, branch lengths and support values, and rescale or calibrate branch lengths.
- Full undo/redo.

**Formats**
- Import: Newick, PHYLIP tree files (`.ph`, `.phb`, `.dnd`), NEXUS (including `TRANSLATE` tables and BEAST/FigTree `[&…]` annotations), PhyloXML.
- Export: Newick, NEXUS, PhyloXML, a node table (CSV), and SVG figures.

**Tanglegrams**
- Link the tips of two trees by matching species and strain names, by species only, by exact label, or from an association table you supply.
- Many-to-many links: one host can link to several symbionts, genes or loci.
- Minimise crossings with an exact one-sided optimiser plus a two-sided heuristic.
- Reroot, flip, collapse, ladderize and delete within the tanglegram view.
- Export the figure (SVG), the list of links (CSV), and both trees in the branch order drawn (Newick).

---

## Quick start

1. Download `treescan.html` from this repository (or from the [Releases](../../releases) page).
2. Open it in Chrome, Firefox, Safari or Edge.
3. Click **Open image or PDF**, choose a tree figure, and press **Read tree**.
4. Check the result, edit if needed, and click **Export**.

An internet connection is needed the first time, to load the OCR and PDF libraries from public CDNs. A sample figure and its tree are loaded on start-up so you can try the tool straight away.

> **Note:** the **Claude** and **Hybrid** readers only work when TreeScan is opened as an artifact on [claude.ai](https://claude.ai). They then use the viewer's own Claude account. The standalone HTML file uses the **Local** reader.

---

## Reading a tree from a figure

| Setting | Options | Notes |
|---|---|---|
| **Reader** | Hybrid / Claude / Local | Hybrid gives the best overall results. Local is private and works offline. |
| **Layout** | Detect, Rectangular phylogram, Cladogram, Circular / fan, Unrooted radial | Choose *Cladogram* if branch lengths are not meaningful. Unrooted radial trees need the Claude reader. |
| **Root side** | Detect, Left, Right, Top, Bottom | *Detect* tries every orientation and keeps the most consistent tree. |
| **Centre** (circular only) | Auto, or click on the image | Set it by hand if the automatic centre is off. |
| **Claude** | Most careful / Balanced / Fast | Picks the model tier for the Claude and Hybrid readers. |

**Tips for best results**

- Use the highest-resolution image you have. For publications, a vector PDF is ideal.
- Crop away unrelated panels, legends and heat-maps before reading.
- If the figure has no scale bar, branch lengths come out *relative* (deepest tip = 1). Use **Calibrate lengths…** to set the real scale, either from a known root-to-tip height or with a multiplication factor.
- Names drawn in amber were read with low confidence. Check them in the **Taxa** list.

---

## Editing trees

Click a branch, node or taxon to select it. Shift-click several taxa to define an outgroup.

| Action | Where | Shortcut |
|---|---|---|
| Root on the selected branch | *Root here* | `R` |
| Root with selected taxa as outgroup | *Root on outgroup* | |
| Midpoint root | *Midpoint root* | |
| Reverse children of a node | *Flip* | `F` |
| Reverse order throughout a clade | *Flip clade* | |
| Ladderize | *Ladderize ↑ / ↓* | |
| Collapse a branch into a polytomy | *Collapse* | |
| Collapse all branches below a support value | *Collapse support below…* | |
| Delete taxa or a clade | *Delete* | `Delete` |
| Undo / redo | toolbar | `Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z` |

When the tree is rerooted, support values move with their bipartitions, so they stay attached to the correct branches.

---

## Exporting

| Format | Extension | Opens in |
|---|---|---|
| Newick | `.nwk` | Almost all programs (FigTree, iTOL, MEGA, R `ape`/`ggtree`, ETE, Dendroscope, …) |
| NEXUS | `.nex` | FigTree, MrBayes, PAUP\*, BEAST, Mesquite |
| PhyloXML | `.xml` | Archaeopteryx, ETE, Biopython `Bio.Phylo` |
| Node table | `.csv` | Spreadsheets, R, Python |
| Figure | `.svg` | Inkscape, Illustrator, any browser |

Options: include or omit branch lengths and support values, replace spaces with underscores (recommended for PHYLIP-style programs), and set the number of decimals.

> In the claude.ai viewer, files are saved with an extra `.txt` ending (e.g. `tree.nwk.txt`) because of the viewer's download rules. Phylogenetics programs read these files as they are. You can also rename them.

---

## Tanglegrams

Switch to the **Tanglegram** tab in the top bar.

1. **Load two trees.** For each side you can open a file, paste text, or click *Use current tree* to bring in the tree from the *Read & edit* tab. This means you can scan both trees from published figures and compare them.
2. **Choose how taxa are matched.**

   | Mode | Rule |
   |---|---|
   | **Species + strain** (default) | Genus, species and strain identifier must agree. The strain is the word after the species, or after `str.`, `strain`, `isolate` or `sp.`. Extra words (gene or locus names, accessions) are ignored. Case, spaces, underscores and punctuation are ignored, and abbreviated genera match (`G. apicola` = `Gilliamella apicola`). |
   | **Species only** | Genus and species must agree. For `sp.` names the strain is still used. |
   | **Exact label** | Labels must be identical apart from case and punctuation. |
   | **Association table** | Paste `left label, right label` pairs, one per line. Use this when the names have nothing in common (e.g. host species vs. parasite isolates). |

   Example: `Gilliamella sp B3801 Locus1` and `Gilliamella sp B3801 Locus2` both link to `Gilliamella sp. B3801`.

3. **Minimise crossings.** You can rotate both trees, or keep one fixed and rotate only the other. Topology, rooting and branch lengths are not changed.
4. **Edit if needed:** select a branch, node or taxon in either tree to reroot, flip, collapse or delete; midpoint-root or ladderize either tree; undo edits.
5. **Export** the figure (SVG), the links (CSV, including unlinked taxa), or both trees in the order drawn (Newick). These can be used as input for congruence tests such as ParaFit, PACo or Jane, which Treescan does not run itself.

### Crossing minimisation

- **One tree fixed (exact).** When one tree's branch order is fixed, the crossings between two sibling clades of the other tree depend only on which of the two comes first. Each node can therefore be decided independently, in one bottom-up pass, by merging sorted lists of the partner positions. This gives the **optimal** order for the free tree. Polytomies with up to 7 children are solved exactly, and larger ones heuristically.
- **Both trees free (heuristic).** The exact one-sided step alternates between the two trees until it converges. This is repeated from several starting orders (the current order, ladderized orders, random rotations, and a barycentre-plus-flip search), and the best result is polished with single-node flips.

Benchmark on random tree pairs with conflicting branches added and about 20% of taxa linked twice (mean of 5 runs):

| Taxa | Crossings at start | Barycentre + flips | TreeScan | Time |
|---:|---:|---:|---:|---:|
| 30 | 315 | 12.4 | 6.2 | 0.02 s |
| 100 | 3,472 | 409 | 304 | 0.1 s |
| 400 | 52,722 | 11,148 | 10,336 | 1.3 s |

---

## How it works

**Local reader**
1. Separates ink from background (Otsu threshold on colour distance), so coloured trees and JPEG artefacts are handled.
2. Finds connected components and keeps the line art (components containing long straight runs). Text, dotted leaders and scale bars are set aside.
3. Detects horizontal and vertical line segments and joins them into a tree: verticals become internal nodes, horizontals become branches, and the free ends of branches become tips. Filled dots mark tips, including those on zero-length branches.
4. For circular trees, finds the centre and unrolls the image into polar coordinates. Arcs then become vertical lines and radial branches horizontal ones, so the same tracer can be used. Labels are read along each tip's radial direction, the right way up and upside down.
5. Erases the traced lines and runs OCR (Tesseract.js) on the remaining text. Labels are assigned to tips along their row, and numbers to the nearest node (support) or branch midpoint (printed lengths). Doubtful names and support values are re-read from enlarged crops.
6. Calibrates lengths from the scale bar, or from lengths printed on branches.

**Claude reader:** the figure, plus enlarged horizontal strips for small text, is sent to Claude with a structured prompt. The reply is a JSON tree with names, supports, node positions and the scale bar.

**Hybrid:** the line tracer measures the figure, its tips are matched to Claude's tips by drawing order, and pixel-exact branch lengths are copied onto every clade where the two readings agree.

---

## Accuracy and limitations

- **Tested on synthetic figures with a known tree** (12–40 taxa, PNG and JPEG, black and coloured lines, aligned labels with dotted leaders, root on the left or right). The local reader recovered all taxa and the correct topology. Branch lengths were within 0.4–2.2% (median relative error). Support values were 79–100% correct. Names from vector PDFs are exact.
- **Text recognition from images is the weakest step.** Very small, italic or low-resolution labels may be misread. Check flagged names, or use a PDF or the Hybrid reader.
- **Circular trees** are harder for the local reader. Very short branches may be merged into polytomies. The Hybrid reader is recommended.
- **Unrooted (radial) and slanted layouts** require the Claude reader. Branch lengths from Claude alone are estimates, and are shown dashed.
- **Not read from images:** time axes (rulers with tick marks), collapsed-clade triangles (read as single tips), and node bars or other annotations.
- **Two-sided crossing minimisation** is a heuristic: the true minimum can be lower on large, highly conflicting trees.
- **Always compare the result with the original figure** before using it in an analysis.

---

## Repository layout

```
treescan/
├── treescan.html            # standalone build: open this in a browser
├── build.py                 # assembles src/ into treescan.html (and dist/hosted/ with --hosted)
├── package.json             # dev dependencies (tests, hosted build) and npm scripts
├── src/
│   ├── core.js              # tree model, Newick/NEXUS/PhyloXML parsers and writers, editing operations
│   ├── engine.js            # local image reader: line tracing, polar unwrapping, label assignment
│   ├── ocr.js               # Tesseract.js wrapper
│   ├── pdf.js               # PDF rendering and text extraction (PDF.js)
│   ├── vision.js            # Claude reader and hybrid merge
│   ├── tangle.js            # tanglegram matching, crossing minimisation, drawing, editing
│   ├── ui.js                # interface logic
│   ├── body.html            # page markup
│   └── style.css            # styles (light and dark themes)
├── scripts/
│   └── make_fixtures.py     # regenerates the synthetic test figures and their true trees
└── test/
    ├── core.test.js         # parsers, writers, rerooting, midpoint rooting, editing
    ├── tangle.test.js       # taxon-name matching rules
    ├── onesided.test.js     # exact one-sided optimiser vs brute force
    ├── untangle.bench.js    # crossing-minimisation benchmark
    ├── engine.test.js       # end-to-end image/PDF reading in headless Chromium
    ├── harness.html         # page used by engine.test.js
    ├── score.js             # compares a read tree with the true tree
    └── fixtures/            # synthetic figures (PNG, JPEG, PDF) and truth.json
```

## Building from source

The app is plain JavaScript, with no framework or bundler. Python 3.8+ is needed for the build.

```bash
python3 build.py              # writes treescan.html (libraries load from public CDNs)
python3 build.py --hosted     # also writes dist/hosted/: page body plus same-origin OCR and PDF
                              # workers, for hosts that block cross-origin workers (needs npm install)
```

## Running the tests

Node.js 18 or later is required.

```bash
npm install                        # dev dependencies: Tesseract.js, PDF.js, Playwright
npm test                           # core, name matching and optimiser tests (no browser needed)
npx playwright install chromium    # once, for the image-reader test
npm run test:engine                # reads every figure in test/fixtures and checks the result
npm run bench                      # crossing-minimisation benchmark
```

`npm run test:engine` prints a table like this:

| Figure | Taxa | Names | Clades | Supports | Median length error |
|---|---|---|---|---|---|
| rect12.png | 12/12 | 12/12 | 10/10 | 10/10 | 0.5% |
| rect40.jpg | 40/40 | 40/40 | 38/38 | 30/38 | 1.6% |
| lead18r.png (root right, dotted leaders) | 18/18 | 18/18 | 16/16 | 13/16 | 1.9% |
| lead18.pdf | 18/18 | 18/18 | 16/16 | 14/16 | 0.3% |
| circ16.png (circular) | 16/16 | 15/16 | 8/14 | – | – |

To regenerate the figures (needs matplotlib and Pillow): `npm run fixtures`.

---

## Third-party components

Loaded at run time from public CDNs (cdn.jsdelivr.net, cdnjs.cloudflare.com):

| Component | Version | License |
|---|---|---|
| [Tesseract.js](https://github.com/naptha/tesseract.js) and tesseract.js-core | 5.1.1 | Apache-2.0 |
| Tesseract English model (`eng`, `4.0.0_best_int`) | 4.0.0 | Apache-2.0 |
| [PDF.js](https://github.com/mozilla/pdf.js) | 3.11.174 | Apache-2.0 |
| Fonts: Instrument Sans, Source Serif 4, JetBrains Mono (Google Fonts) | – | SIL Open Font License 1.1 |

## Citation

If TreeScan helps your work, please cite this repository:

```
Kwong Lab (2026). TreeScan: reading phylogenetic tree figures and drawing tanglegrams in the browser.
GitHub repository: https://github.com/<your-account>/treescan
```

## License

See LICENSE.txt
