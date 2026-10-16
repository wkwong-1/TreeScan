"""Generate the synthetic test figures in test/fixtures/ together with their true trees.

Usage:  python3 scripts/make_fixtures.py test/fixtures

Each figure is drawn with matplotlib from a random tree; truth.json maps the figure name to
the tree's Newick string, which the engine tests compare against. Requires matplotlib and Pillow.
"""
import random, math, json, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

GENERA = ["Homo", "Pan", "Gorilla", "Pongo", "Macaca", "Mus", "Rattus", "Bos", "Ovis", "Canis",
          "Felis", "Equus", "Sus", "Danio", "Gallus", "Xenopus", "Anolis", "Myotis", "Sorex", "Lepus"]
EPI = ["sapiens", "troglodytes", "gorilla", "abelii", "mulatta", "musculus", "norvegicus", "taurus",
       "aries", "lupus", "catus", "caballus", "scrofa", "rerio", "gallus", "laevis", "carolinensis",
       "lucifugus", "araneus", "europaeus"]


class N:
    def __init__(s, name=None, length=0.0, support=None):
        s.name, s.length, s.support, s.children = name, length, support, []


def rand_tree(n, seed):
    rng = random.Random(seed)
    names = [f"{g} {e}" for g, e in zip(GENERA, EPI)]
    rng.shuffle(names)
    nodes = [N(names[i % len(names)] + ("" if i < len(names) else f" {i}"), round(rng.uniform(0.01, 0.12), 3)) for i in range(n)]
    while len(nodes) > 1:
        a, b = rng.sample(range(len(nodes)), 2)
        x, y = nodes[a], nodes[b]
        p = N(None, round(rng.uniform(0.01, 0.08), 3), rng.choice([100, 100, 99, 97, 88, 76, 64, 52]))
        p.children = [x, y]
        nodes = [m for i, m in enumerate(nodes) if i not in (a, b)] + [p]
    root = nodes[0]
    root.length = 0
    root.support = None
    return root


def newick(n):
    if n.children:
        s = "(" + ",".join(newick(c) for c in n.children) + ")"
        if n.support is not None:
            s += str(n.support)
    else:
        s = n.name.replace(" ", "_")
    return s + (f":{n.length:g}" if n.length else "")


def layout(n, depth=0.0, cnt=[0], clado=False, maxd=None):
    n.x = depth
    if not n.children:
        n.y = cnt[0]; cnt[0] += 1
    else:
        for c in n.children:
            layout(c, depth + (1 if clado else c.length), cnt, clado)
        n.y = (n.children[0].y + n.children[-1].y) / 2


def leaves(n):
    return [n] if not n.children else [l for c in n.children for l in leaves(c)]


def depth_to_tips(n):
    return 0 if not n.children else 1 + max(depth_to_tips(c) for c in n.children)


def clado_x(n, total):
    # cladogram: tips aligned at right
    n.x = total - depth_to_tips(n)
    for c in n.children:
        clado_x(c, total)


def draw_rect(root, path, clado=False, lw=1.5, fs=10, show_support=True, color="black"):
    layout(root, 0, [0], False)
    if clado:
        clado_x(root, depth_to_tips(root))
    lv = leaves(root)
    maxx = max(l.x for l in lv)
    fig, ax = plt.subplots(figsize=(7, 0.32 * len(lv) + 1.2), dpi=110)

    def rec(n):
        for c in n.children:
            ax.plot([n.x, c.x], [c.y, c.y], color=color, lw=lw, solid_capstyle="butt")
            rec(c)
        if n.children:
            ax.plot([n.x, n.x], [n.children[0].y, n.children[-1].y], color=color, lw=lw, solid_capstyle="projecting")
            if show_support and n.support is not None:
                ax.text(n.x - maxx * 0.01, n.y - 0.15, str(n.support), ha="right", va="bottom", fontsize=fs - 2)
        else:
            ax.text(n.x + maxx * 0.015, n.y, n.name, va="center", fontsize=fs, style="italic")
    rec(root)
    if not clado:
        sb = 0.05
        y = len(lv) + 0.3
        ax.plot([0, sb], [y, y], color=color, lw=lw, solid_capstyle="butt")
        ax.text(sb / 2, y + 0.25, "0.05", ha="center", va="top", fontsize=fs - 1)
    ax.set_ylim(len(lv) + 1.2, -1)
    ax.set_xlim(-maxx * 0.03, maxx * 1.45)
    ax.axis("off")
    fig.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def draw_circ(root, path, lw=1.2, fs=8):
    layout(root, 0, [0], False)
    lv = leaves(root)
    nt = len(lv)
    maxx = max(l.x for l in lv)
    span = 2 * math.pi * 0.92
    ang = lambda y: y / nt * span
    fig, ax = plt.subplots(figsize=(8, 8), dpi=110)

    def pt(r, a):
        return r * math.cos(a), r * math.sin(a)

    def rec(n):
        for c in n.children:
            a = ang(c.y)
            x1, y1 = pt(n.x, a); x2, y2 = pt(c.x, a)
            ax.plot([x1, x2], [y1, y2], color="k", lw=lw, solid_capstyle="butt")
            rec(c)
        if n.children:
            a0, a1 = ang(n.children[0].y), ang(n.children[-1].y)
            ts = [a0 + (a1 - a0) * i / 60 for i in range(61)]
            ax.plot([n.x * math.cos(t) for t in ts], [n.x * math.sin(t) for t in ts], color="k", lw=lw)
        else:
            a = ang(n.y)
            deg = math.degrees(a)
            r = n.x + maxx * 0.03
            x, y = pt(r, a)
            if 90 < deg % 360 < 270:
                ax.text(x, y, n.name, rotation=deg + 180, rotation_mode="anchor", ha="right", va="center", fontsize=fs, style="italic")
            else:
                ax.text(x, y, n.name, rotation=deg, rotation_mode="anchor", ha="left", va="center", fontsize=fs, style="italic")
    rec(root)
    lim = maxx * 1.6
    ax.set_xlim(-lim, lim); ax.set_ylim(-lim, lim); ax.set_aspect("equal"); ax.axis("off")
    fig.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def draw_aligned(root, path, root_right=False, lw=1.2, fs=8):
    """Tip labels aligned in one column, joined to the tips by dotted leader lines; dots at tips."""
    layout(root, 0, [0], False)
    lv = leaves(root)
    maxx = max(l.x for l in lv)
    fig, ax = plt.subplots(figsize=(7, 0.3 * len(lv) + 1), dpi=110)
    sgn = -1 if root_right else 1

    def rec(n):
        for c in n.children:
            ax.plot([sgn * n.x, sgn * c.x], [c.y, c.y], color="k", lw=lw, solid_capstyle="butt")
            rec(c)
        if n.children:
            ax.plot([sgn * n.x] * 2, [n.children[0].y, n.children[-1].y], color="k", lw=lw, solid_capstyle="projecting")
            if n.support is not None:
                ax.text(sgn * n.x - sgn * maxx * 0.01, n.y - 0.15, str(n.support), ha="left" if root_right else "right", va="bottom", fontsize=fs - 1)
        else:
            ax.plot([sgn * n.x, sgn * maxx * 1.05], [n.y, n.y], color="0.4", lw=0.8, ls=(0, (1, 2)))
            ax.plot([sgn * n.x], [n.y], "ko", ms=3)
            ax.text(sgn * maxx * 1.07, n.y, n.name, va="center", ha="right" if root_right else "left", fontsize=fs, style="italic")
    rec(root)
    ax.plot([0, sgn * 0.05], [len(lv) + 0.3] * 2, color="k", lw=lw, solid_capstyle="butt")
    ax.text(sgn * 0.025, len(lv) + 0.55, "0.05", ha="center", va="top", fontsize=fs)
    ax.set_ylim(len(lv) + 1.2, -1)
    ax.set_xlim(*sorted([-sgn * maxx * 0.03, sgn * maxx * 1.6]))
    ax.axis("off")
    fig.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close(fig)


if __name__ == "__main__":
    import os
    from PIL import Image
    matplotlib.rcParams["pdf.fonttype"] = 42  # keep PDF text as real text
    out = sys.argv[1] if len(sys.argv) > 1 else "test/fixtures"
    os.makedirs(out, exist_ok=True)
    truth = {}
    for name, n, seed, kind in [("rect12", 12, 1, "rect"), ("rect20", 20, 7, "rect"), ("clado10", 10, 3, "clado"),
                                ("circ16", 16, 5, "circ"), ("rect20_blue", 20, 11, "rectblue")]:
        r = rand_tree(n, seed)
        f = f"{out}/{name}.png"
        if kind == "rect": draw_rect(r, f)
        elif kind == "rectblue": draw_rect(r, f, color="#3b6fd6", lw=2.2)
        elif kind == "clado": draw_rect(r, f, clado=True)
        else: draw_circ(r, f)
        truth[name] = newick(r) + ";"
    # small text, thin lines, plus a lossy JPEG copy
    r = rand_tree(40, 21)
    draw_rect(r, f"{out}/rect40.png", lw=1.0, fs=8)
    Image.open(f"{out}/rect40.png").convert("RGB").save(f"{out}/rect40.jpg", quality=60)
    truth["rect40"] = newick(r) + ";"
    # aligned labels with dotted leaders, root left and right, PNG and PDF
    r = rand_tree(18, 33)
    for suffix, right in [("", False), ("r", True)]:
        draw_aligned(r, f"{out}/lead18{suffix}.png", root_right=right)
        draw_aligned(r, f"{out}/lead18{suffix}.pdf", root_right=right)
        truth["lead18" + suffix] = newick(r) + ";"
    with open(f"{out}/truth.json", "w") as fh:
        json.dump(truth, fh, indent=1)
    print(f"wrote {len(truth)} fixtures to {out}")
