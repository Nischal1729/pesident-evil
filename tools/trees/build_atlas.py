"""
Builds the vegetation texture atlases used by src/world/vegetation/* from CC0 sources.

  python3 tools/trees/build_atlas.py            (needs pillow, numpy, scipy)

Sources (all CC0, downloaded into tools/trees/_downloads/ by tools/trees/download.sh):
  Poly Haven  jacaranda_tree, tree_small_02, island_tree_01, pachira_aquatica_01, grass_bermuda_01,
              grass_medium_02, shrub_04, fern_02 (leaf / blade textures)
              chinese_hackberry_bark, palm_tree_bark, japanese_sycamore (+ bark_brown_02 already in public/textures)
  ambientCG   Grass005 (lawn)

Outputs (public/textures/foliage/):
  leaves.webp    2048x2048 RGBA, 4x4 cells of 512 px (see CELL_* below and src/world/vegetation/atlas.ts)
  bark.jpg       2048x1024, 4 bark columns (512 px wide each), bark_n.jpg = matching OpenGL normal maps
  lawn.jpg       1024 lawn albedo, lawn_n.jpg = normal map

Cell conventions (the geometry code relies on them):
  'twig'    the card attaches at the bottom centre (u 0.5, v 0) and grows up (v 1)
  'rosette' the card attaches at the centre (u 0.5, v 0.5) and is laid flat
  'frond'   the card attaches at the left centre (u 0, v 0.5), the rachis runs along v = 0.5
"""
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DL = os.path.join(ROOT, 'tools', 'trees', '_downloads')
PH = os.path.join(DL, 'ph')
OUT = os.path.join(ROOT, 'public', 'textures', 'foliage')
os.makedirs(OUT, exist_ok=True)

CELL = 512
SS = 2  # supersampling for composition
C = CELL * SS


def rgba(diff, alpha):
    c = np.asarray(Image.open(os.path.join(PH, diff)).convert('RGB'), dtype=np.float32) / 255.0
    a = np.asarray(Image.open(os.path.join(PH, alpha)).convert('L'), dtype=np.float32) / 255.0
    return np.dstack([c, a])


SRC = {
    'jac': ('jacaranda_tree/leaves_diff_1k.jpg', 'jacaranda_tree/leaves_alpha_1k.jpg'),
    'small': ('tree_small_02/leaves_diff_1k.jpg', 'tree_small_02/leaves_alpha_1k.jpg'),
    'island': ('island_tree_01/leaves_diff_1k.jpg', 'island_tree_01/leaves_alpha_1k.jpg'),
    'pachira': ('pachira_aquatica_01/leaves_diff_1k.jpg', 'pachira_aquatica_01/leaves_alpha_1k.jpg'),
    'bermuda': ('grass_bermuda_01/Diffuse_1k.jpg', 'grass_bermuda_01/Alpha_1k.jpg'),
    'gm2': ('grass_medium_02/Diffuse_1k.jpg', 'grass_medium_02/Alpha_1k.jpg'),
    'shrub4': ('shrub_04/Diffuse_1k.jpg', 'shrub_04/Alpha_1k.jpg'),
    'fern': ('fern_02/Diffuse_1k.jpg', 'fern_02/Alpha_1k.jpg'),
}
_cache = {}


def src(name):
    if name not in _cache:
        img = rgba(*SRC[name])
        lab, n = ndimage.label(img[..., 3] > 0.5)
        _cache[name] = (img, lab, ndimage.find_objects(lab))
    return _cache[name]


def element(name, comp, base='thin', pad=6):
    """Cut one connected component out of a source and rotate it so its base is at the bottom centre, tip up.
    base='thin': the end with less mass is the base (petioles); 'wide': the end with more mass (grass blades)."""
    img, lab, objs = src(name)
    sl = objs[comp]
    y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
    y0 = max(0, y0 - pad); x0 = max(0, x0 - pad); y1 = min(img.shape[0], y1 + pad); x1 = min(img.shape[1], x1 + pad)
    crop = img[y0:y1, x0:x1].copy()
    mask = (lab[y0:y1, x0:x1] == comp + 1)
    # keep the soft alpha only around this component
    grow = ndimage.binary_dilation(mask, iterations=3)
    crop[..., 3] *= grow
    ys, xs = np.nonzero(mask)
    pts = np.stack([xs, ys], 1).astype(np.float64)
    mu = pts.mean(0)
    cov = np.cov((pts - mu).T)
    w, v = np.linalg.eigh(cov)
    axis = v[:, np.argmax(w)]
    t = (pts - mu) @ axis
    lo, hi = t.min(), t.max()
    span = hi - lo
    m_lo = np.sum(t < lo + span * 0.18)
    m_hi = np.sum(t > hi - span * 0.18)
    base_is_lo = (m_lo < m_hi) if base == 'thin' else (m_lo > m_hi)
    if not base_is_lo:
        axis = -axis
        t = -t
        lo, hi = -hi, -lo
    # tip direction = axis. Rotate so the axis points up (-y in image coords)
    ang = math.degrees(math.atan2(axis[1], axis[0]))  # angle of axis in image coords
    rot = -90 - ang  # rotate so axis -> (0,-1)
    im = Image.fromarray((np.clip(crop, 0, 1) * 255).astype(np.uint8), 'RGBA')
    im = im.rotate(rot, resample=Image.BICUBIC, expand=True)
    a = np.asarray(im)[..., 3]
    ys, xs = np.nonzero(a > 20)
    im = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    return im


def recolor(im, mul=(1, 1, 1), add=(0, 0, 0), sat=1.0, gamma=1.0):
    a = np.asarray(im).astype(np.float32) / 255.0
    rgb = a[..., :3]
    lum = (rgb @ np.array([0.299, 0.587, 0.114], np.float32))[..., None]
    rgb = lum + (rgb - lum) * sat
    rgb = np.clip(rgb * np.array(mul, np.float32) + np.array(add, np.float32), 0, 1) ** gamma
    out = np.dstack([rgb, a[..., 3]])
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), 'RGBA')


def hue_to(im, target_rgb, keep=0.35):
    """Push the colours toward a target hue (used for the maroon-leaved trees)."""
    a = np.asarray(im).astype(np.float32) / 255.0
    rgb = a[..., :3]
    lum = (rgb @ np.array([0.299, 0.587, 0.114], np.float32))[..., None]
    tgt = np.array(target_rgb, np.float32)
    tl = float(tgt @ np.array([0.299, 0.587, 0.114], np.float32))
    col = tgt / max(tl, 1e-3) * lum
    rgb = rgb * keep + col * (1 - keep)
    return Image.fromarray((np.clip(np.dstack([rgb, a[..., 3]]), 0, 1) * 255).astype(np.uint8), 'RGBA')


def place(canvas, el, anchor, angle, length, squeeze=1.0, flip=False):
    """Draw element `el` (base at bottom centre) with its base at `anchor` (canvas px), rotated `angle` degrees
    clockwise from straight up, scaled so its height is `length` px; `squeeze` scales its width."""
    W, H = el.size
    s = length / H
    sx, sy = s * squeeze * (-1 if flip else 1), s
    th = math.radians(angle)
    ca, sa = math.cos(th), math.sin(th)
    A = np.array([[ca * sx, -sa * sy], [sa * sx, ca * sy]])
    inv = np.linalg.inv(A)
    bx, by = W / 2.0, H
    ax, ay = anchor
    a, b = inv[0]
    d, e = inv[1]
    c = bx - (a * ax + b * ay)
    f = by - (d * ax + e * ay)
    layer = el.transform(canvas.size, Image.AFFINE, (a, b, c, d, e, f), resample=Image.BICUBIC)
    canvas.alpha_composite(layer)


def stem(canvas, pts, width, color):
    d = ImageDraw.Draw(canvas)
    for i in range(1, len(pts)):
        w = max(1, int(round(width * (1 - 0.6 * i / len(pts)))))
        d.line([pts[i - 1], pts[i]], fill=color, width=w)


def new_cell():
    return Image.new('RGBA', (C, C), (0, 0, 0, 0))


def petal_poly(cx, cy, ang, length, width, n=12):
    pts = []
    for i in range(n + 1):
        t = i / n
        r = length * t
        w = width * math.sin(math.pi * min(1.0, t * 1.1)) ** 0.8 * (0.6 + 0.4 * t)
        pts.append((t, r, w))
    poly = []
    ca, sa = math.cos(ang), math.sin(ang)
    for t, r, w in pts:
        poly.append((cx + ca * r - sa * w, cy + sa * r + ca * w))
    for t, r, w in reversed(pts):
        poly.append((cx + ca * r + sa * w, cy + sa * r - ca * w))
    return poly


def flower(d, cx, cy, size, petals, colors, center, rng, spin=0.0, standard=None):
    base = rng.random() * math.tau
    for k in range(petals):
        ang = base + k * math.tau / petals + spin
        col = colors[rng.randrange(len(colors))]
        if standard is not None and k == 0:
            col = standard
        d.polygon(petal_poly(cx, cy, ang, size, size * 0.42), fill=col)
    r = size * 0.18
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=center)


def to_cell(img):
    return img.resize((CELL, CELL), Image.LANCZOS)


# ------------------------------------------------------------------------------------------------ cells

def bipinnate_twig(rng, fronds, green, n=7, spread=62, twig_col=(88, 72, 52, 255)):
    """Twig with bipinnate fronds (rain tree / gulmohar / copperpod)."""
    cell = new_cell()
    base = (C / 2, C - 8)
    top = (C / 2 + rng.uniform(-40, 40), C * 0.42)
    pts = [base, ((base[0] + top[0]) / 2 + rng.uniform(-25, 25), (base[1] + top[1]) / 2), top]
    order = list(range(n))
    rng.shuffle(order)
    for i in order:
        t = 0.25 + 0.75 * i / max(1, n - 1)
        # anchor along the twig
        ax = pts[0][0] + (pts[2][0] - pts[0][0]) * t
        ay = pts[0][1] + (pts[2][1] - pts[0][1]) * t
        side = -1 if i % 2 else 1
        ang = side * spread * (1.0 - 0.75 * t) + rng.uniform(-12, 12)
        if i == n - 1:
            ang = rng.uniform(-10, 10)
        L = C * (0.5 + 0.14 * math.sin(math.pi * t)) * rng.uniform(0.85, 1.05)
        L = min(L, (ay - 10) / max(0.35, math.cos(math.radians(ang))))
        el = fronds[rng.randrange(len(fronds))]
        place(cell, recolor(el, **green), (ax, ay), ang, L, squeeze=rng.uniform(0.85, 1.05), flip=rng.random() < 0.5)
    stem(cell, pts, 7, twig_col)
    return cell


def leaf_twig(rng, leaves, n, green, length=(0.3, 0.42), spread=55, droop=0.0, twig_col=(84, 70, 52, 255), squeeze=(0.8, 1.0), twig_len=0.75):
    cell = new_cell()
    base = (C / 2, C - 8)
    top = (C / 2 + rng.uniform(-30, 30), C * (1 - twig_len))
    for i in range(n):
        t = 0.15 + 0.85 * (i / max(1, n - 1))
        ax = base[0] + (top[0] - base[0]) * t + rng.uniform(-6, 6)
        ay = base[1] + (top[1] - base[1]) * t
        side = -1 if i % 2 else 1
        ang = side * (spread * (1 - 0.5 * t) + rng.uniform(-10, 10)) + droop * side
        if i >= n - 1:
            ang = rng.uniform(-8, 8)
        L = C * rng.uniform(*length) * (1.0 - 0.25 * t)
        L = min(L, (ay - 8) / max(0.3, math.cos(math.radians(ang))) if abs(ang) < 80 else L)
        el = leaves[rng.randrange(len(leaves))]
        place(cell, recolor(el, **green), (ax, ay), ang, L, squeeze=rng.uniform(*squeeze), flip=rng.random() < 0.5)
    stem(cell, [base, top], 6, twig_col)
    return cell


def rosette(rng, leaves, n, green, length=(0.36, 0.46), rings=1, squeeze=(0.7, 0.9), center_hole=0.04):
    cell = new_cell()
    cx, cy = C / 2, C / 2
    for ring in range(rings):
        k = n if ring == 0 else int(n * 0.7)
        off = rng.random() * math.tau
        for i in range(k):
            ang = off + i * math.tau / k + rng.uniform(-0.15, 0.15)
            L = C * rng.uniform(*length) * (1 - 0.25 * ring)
            r0 = C * center_hole
            ax, ay = cx + math.cos(ang) * r0, cy + math.sin(ang) * r0
            el = leaves[rng.randrange(len(leaves))]
            place(cell, recolor(el, **green), (ax, ay), math.degrees(ang) + 90, L, squeeze=rng.uniform(*squeeze), flip=rng.random() < 0.5)
    return cell


def main():
    rng = random.Random(1234)
    atlas = Image.new('RGBA', (CELL * 4, CELL * 4), (0, 0, 0, 0))

    fronds = [element('jac', 1), element('jac', 12), element('jac', 18)]
    twigs_small = [element('small', i) for i in (0, 40, 48, 55, 65)]
    island = [element('island', i) for i in range(8)]
    pachira = [element('pachira', i) for i in (0, 1, 2, 3)]
    blades = [element('gm2', i, base='wide') for i in (18, 20, 22, 23, 28)]  # green blades (21, 29 are dry)
    bermuda = [element('bermuda', i, base='wide') for i in (1, 2, 9, 10, 26, 27, 29, 30, 12, 13)]
    shrub_leaves = [element('shrub4', i) for i in (1, 2, 4, 5, 6, 7, 8, 9, 10)]
    fern = [element('fern', i, base='wide') for i in (0, 1, 2, 3, 8)]

    cells = {}
    # 0 rain tree: deep green bipinnate
    cells[0] = bipinnate_twig(rng, fronds, dict(mul=(0.74, 0.94, 0.62), sat=1.3, gamma=1.08), n=8)
    # 1 gulmohar: bright feathery green + a few red-orange flower clusters
    c = bipinnate_twig(rng, fronds, dict(mul=(0.9, 1.1, 0.62), sat=1.35), n=7, spread=70)
    d = ImageDraw.Draw(c)
    for _ in range(3):
        fx, fy = C / 2 + rng.uniform(-300, 300), C * rng.uniform(0.15, 0.6)
        for _k in range(rng.randint(5, 9)):
            flower(d, fx + rng.uniform(-70, 70), fy + rng.uniform(-50, 50), rng.uniform(26, 36), 5,
                   [(226, 62, 26, 255), (240, 86, 34, 255), (205, 44, 22, 255), (250, 110, 40, 255)], (120, 30, 14, 255), rng,
                   standard=(245, 222, 170, 255))
    cells[1] = c
    # 2 copperpod: darker bipinnate + upright yellow panicles
    c = bipinnate_twig(rng, fronds, dict(mul=(0.72, 0.9, 0.56), sat=1.25, gamma=1.1), n=8)
    d = ImageDraw.Draw(c)
    for _ in range(4):
        px, py = C / 2 + rng.uniform(-320, 320), C * rng.uniform(0.25, 0.7)
        h = rng.uniform(120, 220)
        d.line([(px, py), (px + rng.uniform(-20, 20), py - h)], fill=(110, 80, 40, 255), width=4)
        for _k in range(40):
            t = rng.random()
            r = (1 - t) * 18 + 6
            fx, fy = px + rng.uniform(-r, r), py - h * t
            s = rng.uniform(5, 9)
            col = [(245, 197, 24, 255), (255, 212, 59, 255), (232, 177, 12, 255), (214, 150, 20, 255)][rng.randrange(4)]
            d.ellipse([fx - s, fy - s, fx + s, fy + s], fill=col)
    cells[2] = c
    # 3 ficus: dense small glossy dark leaves on a branching twig
    c = new_cell()
    small = [recolor(e, mul=(0.6, 0.8, 0.56), sat=1.15, gamma=1.12) for e in island + shrub_leaves[:4]]
    for k in range(4):
        bx, by = C / 2 + (k - 1.5) * 50, C - 8
        ang0 = (k - 1.5) * 22 + rng.uniform(-6, 6)
        L0 = C * rng.uniform(0.62, 0.8)
        tx, ty = bx + math.sin(math.radians(ang0)) * L0, by - math.cos(math.radians(ang0)) * L0
        for i in range(12):
            t = 0.2 + 0.8 * i / 11
            ax, ay = bx + (tx - bx) * t, by + (ty - by) * t
            side = -1 if i % 2 else 1
            place(c, small[rng.randrange(len(small))], (ax, ay), ang0 + side * rng.uniform(35, 65), C * rng.uniform(0.13, 0.18), squeeze=rng.uniform(0.8, 1.0), flip=rng.random() < 0.5)
        place(c, small[rng.randrange(len(small))], (tx, ty), ang0, C * 0.16)
        stem(c, [(bx, by), (tx, ty)], 4, (98, 88, 72, 255))
    cells[3] = c
    # 4 pongamia / generic glossy broadleaf twig (island leaves, pinnate)
    cells[4] = leaf_twig(rng, island, 11, dict(mul=(0.78, 0.98, 0.68), sat=1.05), length=(0.3, 0.4), spread=58)
    # 5 tabebuia: palmate pachira leaves
    c = new_cell()
    for k in range(5):
        ang = [-50, 45, -15, 20, 0][k] + rng.uniform(-8, 8)
        place(c, recolor(pachira[k % 4], mul=(0.95, 1.05, 0.85), sat=0.95), (C / 2 + rng.uniform(-20, 20), C - 10 - k * 60), ang, C * rng.uniform(0.5, 0.62))
    stem(c, [(C / 2, C - 8), (C / 2, C * 0.35)], 6, (96, 84, 66, 255))
    cells[5] = c
    # 6 maroon-leaved small tree
    c = leaf_twig(rng, shrub_leaves + island[:4], 13, dict(mul=(1, 1, 1)), length=(0.26, 0.36), spread=60)
    cells[6] = recolor(hue_to(c, (0.3, 0.06, 0.1), keep=0.15), mul=(0.62, 0.6, 0.6), sat=0.85, gamma=1.12)
    # 7 ashoka (Polyalthia longifolia): long narrow wavy leaves, narrow fan (card is hung upside down)
    cells[7] = leaf_twig(rng, island, 14, dict(mul=(0.66, 0.86, 0.58), sat=1.1, gamma=1.1), length=(0.42, 0.55), spread=22, squeeze=(0.42, 0.55), twig_len=0.55)
    # 8 frangipani rosette: big lanceolate leaves + white flowers in the centre
    c = rosette(rng, island, 9, dict(mul=(0.85, 1.02, 0.7), sat=1.05), length=(0.38, 0.48), squeeze=(0.62, 0.8), center_hole=0.05)
    d = ImageDraw.Draw(c)
    for _k in range(7):
        a = rng.random() * math.tau
        r = rng.uniform(0, 90)
        flower(d, C / 2 + math.cos(a) * r, C / 2 + math.sin(a) * r, rng.uniform(40, 52), 5,
               [(250, 248, 238, 255), (246, 242, 226, 255), (255, 252, 244, 255)], (246, 200, 60, 255), rng, spin=0.25)
    cells[8] = c
    # 9 terminalia rosette: small obovate leaves in whorls (laid flat)
    cells[9] = rosette(rng, shrub_leaves, 16, dict(mul=(0.78, 1.0, 0.62), sat=1.15), length=(0.3, 0.42), rings=2, squeeze=(0.75, 0.95), center_hole=0.03)
    # 10 palm frond (areca): rachis along the middle, leaflets on both sides pointing toward the tip
    c = new_cell()
    d = ImageDraw.Draw(c)
    x0, x1, yc = 6, C - 6, C / 2
    n = 34
    for i in range(n):
        t = 0.06 + 0.94 * i / (n - 1)
        x = x0 + (x1 - x0) * t
        for side in (-1, 1):
            L = C * 0.46 * (math.sin(math.pi * min(1, t * 0.85 + 0.12)) ** 0.7) * rng.uniform(0.9, 1.05)
            ang = 90 - side * (50 + 18 * t) + rng.uniform(-5, 5)   # clockwise from up; ~40-60 deg from the rachis toward the tip
            ang = (90 - (38 + 22 * (1 - t))) if side < 0 else (90 + (38 + 22 * (1 - t)))
            el = blades[rng.randrange(len(blades))]
            place(c, recolor(el, mul=(0.56, 0.98, 0.42), sat=1.2, gamma=1.02), (x, yc), ang, L, squeeze=rng.uniform(0.9, 1.3))
    d.line([(x0, yc), (x1, yc)], fill=(128, 136, 70, 255), width=7)
    cells[10] = c
    # 11 fountain grass clump: many fine arching blades fanning from the base
    c = new_cell()
    for k in range(95):
        ang = rng.gauss(0, 26)
        L = C * rng.uniform(0.6, 0.98) * (1 - abs(ang) / 150)
        tone = rng.random()
        mul = (0.78 + 0.28 * tone, 1.0 + 0.08 * tone, 0.5 + 0.12 * tone)
        place(c, recolor(blades[rng.randrange(len(blades))], mul=mul, sat=1.1), (C / 2 + rng.uniform(-50, 50), C - 4), ang, L, squeeze=rng.uniform(0.3, 0.5), flip=rng.random() < 0.5)
    cells[11] = c
    # 12 fountain grass plumes (bottlebrush spikes on thin arching stalks)
    c = new_cell()
    d = ImageDraw.Draw(c)
    for k in range(8):
        bx = C / 2 + rng.uniform(-70, 70)
        ang = math.radians(rng.gauss(0, 20))
        L = C * rng.uniform(0.72, 0.96)
        pts = []
        for i in range(31):
            t = i / 30
            bend = t * t * 0.45 * (1 if ang > 0 else -1)
            a = ang + bend
            pts.append((bx + math.sin(a) * L * t, C - 4 - math.cos(a) * L * t))
        d.line(pts, fill=(140, 146, 84, 255), width=5)
        pink = rng.random() < 0.2
        for i in range(700):
            t = 0.58 + 0.42 * rng.random()
            j = int(t * 30)
            px, py = pts[j]
            taper = math.sin(math.pi * min(1.0, (t - 0.58) / 0.42 * 0.9 + 0.1))
            bl = rng.uniform(14, 34) * taper
            ba = rng.random() * math.tau
            if pink:
                col = (int(rng.uniform(176, 200)), int(rng.uniform(150, 170)), int(rng.uniform(130, 150)), 255)
            else:
                col = (int(rng.uniform(178, 206)), int(rng.uniform(176, 198)), int(rng.uniform(120, 146)), 255)
            d.line([(px, py), (px + math.cos(ba) * bl, py + math.sin(ba) * bl * 0.8)], fill=col, width=3)
    cells[12] = c
    # 13 lawn blades strip (bermuda plants side by side)
    c = new_cell()
    for k in range(26):
        x = 20 + (C - 40) * k / 25 + rng.uniform(-10, 10)
        place(c, recolor(bermuda[rng.randrange(len(bermuda))], mul=(0.95, 1.08, 0.8), sat=1.15), (x, C - 2), rng.uniform(-14, 14), C * rng.uniform(0.55, 0.95), squeeze=rng.uniform(0.7, 1.0), flip=rng.random() < 0.5)
    cells[13] = c
    # 14 fern / cycad fronds (shrub clumps)
    c = new_cell()
    for k in range(5):
        ang = [-38, 36, -12, 14, 0][k]
        place(c, recolor(fern[k % len(fern)], mul=(0.9, 1.05, 0.8), sat=1.1), (C / 2 + (k - 2) * 20, C - 4), ang, C * rng.uniform(0.8, 0.95), squeeze=1.1)
    cells[14] = c
    # 15 hedge cluster (murraya): small glossy leaves + tiny white flowers
    c = new_cell()
    small = [recolor(e, mul=(0.66, 0.88, 0.6), sat=1.1, gamma=1.08) for e in island + shrub_leaves]
    for k in range(150):
        a = rng.random() * math.tau
        r = math.sqrt(rng.random()) * C * 0.36
        ax, ay = C / 2 + math.cos(a) * r, C * 0.56 + math.sin(a) * r * 0.9
        place(c, small[rng.randrange(len(small))], (ax, ay), rng.uniform(0, 360), C * rng.uniform(0.09, 0.14), squeeze=rng.uniform(0.8, 1.0), flip=rng.random() < 0.5)
    d = ImageDraw.Draw(c)
    arr = np.asarray(c)
    for _k in range(60):
        fx, fy = rng.uniform(60, C - 60), rng.uniform(60, C - 60)
        if arr[int(fy), int(fx), 3] < 128:
            continue
        flower(d, fx, fy, rng.uniform(9, 13), 5, [(250, 250, 244, 255), (244, 244, 236, 255)], (230, 220, 150, 255), rng)
    cells[15] = c

    for i, img in cells.items():
        atlas.paste(to_cell(img), ((i % 4) * CELL, (i // 4) * CELL))

    # dilate colour into transparent texels so mip levels do not darken the leaf edges
    arr = np.asarray(atlas).astype(np.float32) / 255.0
    a = arr[..., 3:4]
    rgb = arr[..., :3]
    acc = np.zeros_like(rgb)
    wsum = np.zeros_like(a)
    for sigma in (2, 6, 18, 60):
        num = np.stack([ndimage.gaussian_filter(rgb[..., k] * a[..., 0], sigma) for k in range(3)], -1)
        den = ndimage.gaussian_filter(a[..., 0], sigma)[..., None]
        fill = num / np.maximum(den, 1e-5)
        w = (den > 1e-3).astype(np.float32) * (1 - wsum.clip(0, 1))
        acc += fill * w
        wsum += w
    filled = np.where(wsum > 0, acc / np.maximum(wsum, 1e-5), np.array([0.2, 0.25, 0.12], np.float32))
    rgb = rgb * a + filled * (1 - a)
    rgb = np.where(a > 0.02, arr[..., :3] * (a > 0.5) + rgb * (a <= 0.5), rgb)
    out = np.dstack([rgb, a])
    Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), 'RGBA').save(os.path.join(OUT, 'leaves.webp'), 'WEBP', quality=88, method=6)
    prev = Image.new('RGB', atlas.size, (255, 0, 255))
    prev.paste(atlas, mask=atlas.split()[3])
    prev.resize((1024, 1024)).save(os.path.join(DL, 'leaves_preview.jpg'), quality=85)

    # ---------------------------------------------------------------------------------------- bark atlas
    cols = [
        (os.path.join(ROOT, 'public/textures/bark_brown_02/diff.jpg'), os.path.join(ROOT, 'public/textures/bark_brown_02/nor.jpg')),
        (os.path.join(PH, 'chinese_hackberry_bark/Diffuse_1k.jpg'), os.path.join(PH, 'chinese_hackberry_bark/nor_gl_1k.jpg')),
        (os.path.join(PH, 'palm_tree_bark/Diffuse_1k.jpg'), os.path.join(PH, 'palm_tree_bark/nor_gl_1k.jpg')),
        (os.path.join(PH, 'japanese_sycamore/Diffuse_1k.jpg'), os.path.join(PH, 'japanese_sycamore/nor_gl_1k.jpg')),
    ]
    bark = Image.new('RGB', (2048, 1024))
    barkn = Image.new('RGB', (2048, 1024))
    # normalise each column to a plausible bark albedo (sRGB mean luminance) and tame the saturation
    targets = [(118, 0.75), (128, 0.8), (150, 0.7), (160, 0.75)]
    for i, (cf, nf) in enumerate(cols):
        im = Image.open(cf).convert('RGB').resize((512, 1024), Image.LANCZOS)
        a = np.asarray(im).astype(np.float32) / 255.0
        lin = a ** 2.2
        lum = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        tgt = (targets[i][0] / 255.0) ** 2.2
        lin = lin * (tgt / max(1e-4, float(lum.mean())))
        l2 = (lin @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
        lin = l2 + (lin - l2) * targets[i][1]
        im = Image.fromarray((np.clip(lin, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8), 'RGB')
        bark.paste(im, (i * 512, 0))
        barkn.paste(Image.open(nf).convert('RGB').resize((512, 1024), Image.LANCZOS), (i * 512, 0))
    bark.save(os.path.join(OUT, 'bark.jpg'), quality=84, optimize=True, progressive=True)
    barkn.save(os.path.join(OUT, 'bark_n.jpg'), quality=86, optimize=True, progressive=True)

    # ---------------------------------------------------------------------------------------- lawn
    g = os.path.join(DL, 'acg', 'Grass005', 'Grass005_1K-JPG_')
    Image.open(g + 'Color.jpg').convert('RGB').save(os.path.join(OUT, 'lawn.jpg'), quality=85, optimize=True, progressive=True)
    Image.open(g + 'NormalGL.jpg').convert('RGB').save(os.path.join(OUT, 'lawn_n.jpg'), quality=85, optimize=True, progressive=True)
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')


if __name__ == '__main__':
    main()
