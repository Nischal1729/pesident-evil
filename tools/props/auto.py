"""
`auto_rickshaw`: Bajaj RE-style three-wheeler in the Bengaluru livery: green lower body, yellow upper panels, black
canvas canopy, yellow commercial plates (2635 x 1300 x 1700 mm, wheelbase 2000, 4.00-8 tyres). Open sides, so the
cabin (rexine bench, driver seat, floor mat, dash, fare meter) is modelled. `_lod` for distant traffic.
Vehicle frame (u forward, s left, z up).
"""
import math
import lib
from lib import V, Mat, Proj
from two_wheelers import plate_mat, ring_sz, ring_us, arc_part

FW, RW, RT = 1.07, -0.93, 0.215
GREEN, YELLOW, CANVAS = '#1d7438', '#f2c200', '#161616'


def M(c, rough=0.4, metal=0.0, tint=0.0):
    return Mat(c, rough, metal, tint)


def livery(proj):
    green, yellow, canvas = M(GREEN, 0.35), M(YELLOW, 0.35), M(CANVAS, 0.85)
    black, chrome = M('#121212', 0.5), M('#d6d8da', 0.12, 1.0)
    views = {}
    for view in ('L', 'R'):
        c = proj.canvas(view, 260, bg=green)
        c.rect(-1.4, 0.80, 1.4, 1.36, yellow)
        c.rect(-1.4, 1.36, 1.4, 1.80, canvas)
        c.rect(-1.4, 0.785, 1.4, 0.80, black)
        c.rect(-1.4, 0.31, 1.4, 0.35, black)                        # rubbing strip / chassis edge
        c.text(-1.02, 0.60, 'PASS 3+1', 0.045, M('#f4f4f0', 0.4), font='arialb')
        c.rect(-1.25, 1.44, -1.05, 1.60, M('#2a3036', 0.1))         # rear quarter window in the canvas
        views[view] = c.save(f'auto_{view}', noise=0.012)
    f = proj.canvas('F', 320, bg=green)
    f.rect(-0.70, 0.80, 0.70, 1.36, yellow)
    f.rect(-0.70, 1.36, 0.70, 1.80, canvas)
    f.ellipse(0.0, 0.83, 0.085, 0.085, black)
    f.ellipse(0.0, 0.83, 0.07, 0.07, chrome)
    f.ellipse(0.0, 0.83, 0.058, 0.058, M('#e8edf1', 0.05, 0.8))
    for sg in (-1, 1):
        f.rect(sg * 0.36 - 0.035, 0.78, sg * 0.36 + 0.035, 0.84, M('#e3901e', 0.1), r=0.01)
    f.rect(-0.30, 0.935, 0.30, 0.955, chrome)                         # chrome strip on the cowl
    views['F'] = f.save('auto_F', noise=0.012)
    b = proj.canvas('B', 320, bg=green)
    b.rect(-0.70, 0.80, 0.70, 1.00, yellow)
    b.rect(-0.70, 1.00, 0.70, 1.80, canvas)
    b.rect(-0.30, 1.12, 0.30, 1.34, M('#2a3036', 0.1))               # rear canvas window
    for sg in (-1, 1):
        b.rect(sg * 0.52 - 0.05, 0.62, sg * 0.52 + 0.05, 0.72, M('#a8121a', 0.08), r=0.01)
    b.stext(0.0, 0.90, 'ನಮ್ಮ ಬೆಂಗಳೂರು', 0.09, M('#c2121a', 0.35))
    b.text(0.0, 0.53, 'HORN  OK  PLEASE', 0.04, M('#f4f4f0', 0.4), font='arialblack')
    views['B'] = b.save('auto_B', noise=0.012)
    t = proj.canvas('T', 120, bg=canvas)
    t.rect(-0.55, 1.0, 0.55, 1.30, M(YELLOW, 0.35))                   # cowl top
    views['T'] = t.save('auto_T', noise=0.02)
    return lib.proj_material('auto_body', proj, views, sharp=6.0, grime=0.55, grime_z=(0.25, 0.8), grime_col='#7b6a52')


def canopy_ring(u, w, z0, zc, th, n):
    """Thin arched roof section: outer arch then inner arch (closed ring)."""
    out, inn = [], []
    for k in range(n + 1):
        a = math.pi * k / n
        s = math.cos(a) * w / 2
        z = z0 + (zc - z0) * math.sin(a) ** 0.55
        out.append(V(u, s, z))
        inn.append(V(u, s * (1 - th / (w / 2)), z - th))
    return out + list(reversed(inn))


def build_auto(lod=False):
    parts = []
    n = 14 if not lod else 6
    if not lod:
        proj = Proj(-1.36, 1.36, -0.70, 0.70, 0.0, 1.80)
        body = livery(proj)
        seat = lib.pbr('auto_seat', '#151515', 0.45, var=0.06, var_scale=90)
        mat_m = lib.pbr('auto_mat', '#1c1c1c', 0.85, var=0.08, grime=0.6, grime_z=(0.4, 0.7), stripes=(1, 0.03, 0.4, '#101010'))
        dark = lib.pbr('auto_dark', '#1a1b1c', 0.6, var=0.05, grime=0.4, grime_z=(0.1, 0.5))
        chrome = lib.pbr('auto_chrome', '#d2d4d6', 0.15, 1.0, var=0.02)
        glass = lib.pbr('auto_glass', '#1a2228', 0.05, 0.0, var=0.0)
        tyre = lib.pbr('auto_tyre', '#1b1b1c', 0.9, var=0.04, grime=0.6, grime_z=(0.0, 0.25), grime_col='#7a6a55', uv_weight=0.6)
        rim = lib.pbr('auto_rim', '#b9bcbf', 0.35, 0.8, var=0.05, grime=0.5, grime_z=(0.0, 0.3))
        yellow = lib.pbr('auto_yellow', YELLOW, 0.35, var=0.04, grime=0.2, grime_z=(0.5, 1.2))
        canvas = lib.pbr('auto_canvas', CANVAS, 0.85, var=0.08, var_scale=60, rough_var=0.1)
    else:
        body = seat = mat_m = dark = chrome = glass = tyre = rim = yellow = canvas = lib.pbr('auto_lod', '#808080')

    # lower tub (floor slab) along u; rear body (engine + luggage) higher
    tub = [(-1.30, 0.32, 0.46, 1.06), (-1.20, 0.29, 0.46, 1.22), (-0.30, 0.29, 0.44, 1.29), (0.30, 0.30, 0.44, 1.20),
           (0.72, 0.32, 0.44, 1.08), (0.88, 0.36, 0.46, 0.98)]
    if lod:
        tub = [tub[0], tub[2], tub[4], tub[5]]
    secs = []
    for u, zb, zt, w in tub:
        secs.append(ring_sz(u, w, zb, zt, n=n, e=4.0))
    tubob = lib.loft('auto_tub', secs, body, cap0=True, cap1=True, smooth_angle=40)
    if not lod:
        lib.assign_faces(tubob, mat_m, lambda c, nr: nr.z > 0.9 and -0.95 < -c.y < 0.95)
    parts.append(tubob)
    # rear body block (behind the bench: engine hood + luggage) up to the canopy drape
    rb = [(-0.90, 0.44, 1.00, 1.26), (-1.12, 0.40, 1.00, 1.24), (-1.30, 0.36, 0.98, 1.10)]
    parts.append(lib.loft('auto_rear', [ring_sz(u, w, zb, zt, n=n, e=4.0) for u, zb, zt, w in rb], body, cap0=True, cap1=True, smooth_angle=40))
    # front cowl (apron) + front mudguard + front wheel
    cw = [(0.48, 1.33, 0.96, 0.98), (0.55, 1.35, 1.04, 1.02), (0.70, 1.34, 1.035, 1.02), (0.85, 1.315, 1.02, 0.96), (0.97, 1.285, 1.01, 0.86),
          (1.03, 1.25, 1.01, 0.70)]
    if lod:
        cw = [cw[0], cw[2], cw[4], cw[5]]
    parts.append(lib.loft('auto_cowl', [ring_us(uf, ur, w, z, n=n, e_front=2.2, e_rear=5.0) for z, uf, ur, w in cw], body, cap0=True, cap1=True, smooth_angle=45))
    parts.append(arc_part('auto_fguard', FW, RT, RT + 0.02, RT + 0.03, 0.16, 20, 120, 8 if not lod else 3, body, lip=0.004))
    # canopy (black canvas shell) + rear drape
    cn = [(1.12, 1.26, 1.38, 1.62), (1.00, 1.30, 1.37, 1.68), (0.40, 1.31, 1.36, 1.70), (-0.40, 1.31, 1.36, 1.70), (-1.10, 1.30, 1.36, 1.69), (-1.30, 1.28, 1.36, 1.65)]
    if lod:
        cn = [cn[0], cn[2], cn[4], cn[5]]
    parts.append(lib.loft('auto_canopy', [canopy_ring(u, w, z0, zc, 0.025, n) for u, w, z0, zc in cn], canvas if not lod else body, cap0=True, cap1=True, smooth_angle=50))
    parts.append(lib.box('auto_drape', (1.26, 0.03, 0.42), loc=V(-1.29, 0, 1.17), mat=body))
    # windscreen + frame, pillars
    parts.append(lib.box('auto_ws', (1.00, 0.02, 0.52), loc=V(1.02, 0, 1.305), mat=glass, rot=(math.radians(-9), 0, 0)))
    if not lod:
        parts.append(lib.box('auto_wsf', (1.04, 0.035, 0.04), loc=V(1.04, 0, 1.56), mat=yellow))
        for sg in (-1, 1):
            parts.append(lib.tube('auto_apillar', [V(1.00, sg * 0.52, 1.02), V(1.06, sg * 0.53, 1.58)], 0.022, 8, yellow))
            parts.append(lib.tube('auto_bpillar', [V(0.15, sg * 0.62, 0.60), V(0.15, sg * 0.63, 1.37)], 0.02, 8, yellow))
            parts.append(lib.tube('auto_cpillar', [V(-0.98, sg * 0.63, 0.98), V(-0.98, sg * 0.64, 1.37)], 0.02, 8, yellow))
            parts.append(lib.tube('auto_rail', [V(0.12, sg * 0.64, 1.05), V(-0.95, sg * 0.645, 1.05)], 0.013, 6, chrome))
        parts.append(lib.tube('auto_wiper', [V(1.07, 0.05, 1.07), V(1.03, 0.30, 1.40)], 0.006, 5, dark))
        # cabin: bench, back rest, driver seat, dash, handlebar, fare meter
        parts.append(lib.box('auto_benchbase', (0.98, 0.40, 0.26), loc=V(-0.66, 0, 0.57), mat=body))
        parts.append(lib.box('auto_bench', (1.00, 0.46, 0.10), loc=V(-0.66, 0, 0.75), mat=seat, bev=0.03, seg=2))
        parts.append(lib.box('auto_back', (1.00, 0.12, 0.40), loc=V(-0.90, 0, 1.02), mat=seat, bev=0.03, seg=2, rot=(math.radians(8), 0, 0)))
        parts.append(lib.box('auto_dped', (0.26, 0.26, 0.22), loc=V(0.38, 0, 0.55), mat=dark))
        parts.append(lib.box('auto_dseat', (0.36, 0.34, 0.10), loc=V(0.38, 0, 0.71), mat=seat, bev=0.03, seg=2))
        for sg in (-1, 1):   # rear quarter panels over the rear wheels
            parts.append(lib.box('auto_quarter', (0.15, 0.92, 0.52), loc=V(-0.84, sg * 0.57, 0.70), mat=body, bev=0.04, seg=2))
        parts.append(lib.box('auto_dseatb', (0.40, 0.08, 0.24), loc=V(0.20, 0, 0.88), mat=seat, bev=0.02, seg=2))
        parts.append(lib.box('auto_dash', (0.92, 0.10, 0.12), loc=V(0.92, 0, 1.02), mat=dark, bev=0.02))
        bar = [V(0.72, -0.34, 1.02), V(0.78, -0.18, 1.05), V(0.80, 0.0, 1.07), V(0.78, 0.18, 1.05), V(0.72, 0.34, 1.02)]
        parts.append(lib.tube('auto_bar', lib.fillet(bar, 0.06, 3), 0.014, 8, dark))
        parts.append(lib.box('auto_meter', (0.16, 0.08, 0.12), loc=V(0.95, 0.44, 1.18), mat=dark, bev=0.01))
        parts.append(lib.box('auto_meterface', (0.10, 0.012, 0.05), loc=V(0.91, 0.44, 1.19), mat=lib.pbr('auto_lcd', '#c23a1a', 0.2, emit='#ff4a1a', emit_strength=0.0)))
        for sg in (-1, 1):   # mirrors on stalks from the windscreen frame
            parts.append(lib.tube('auto_mstalk', [V(1.05, sg * 0.52, 1.35), V(1.12, sg * 0.66, 1.40)], 0.008, 6, dark))
            mh = lib.box('auto_mhead', (0.10, 0.03, 0.07), loc=V(1.12, sg * 0.70, 1.40), mat=dark, bev=0.01)
            lib.assign_faces(mh, chrome, lambda c, nr: nr.y > 0.8)
            parts.append(mh)
        fp = lib.box('auto_fplate', (0.26, 0.012, 0.13), loc=V(1.285, 0, 0.60), rot=(math.radians(-12), 0, 0))
        lib.set_material(fp, plate_mat('auto_fplate_m', 'KA 01\nC 4721', 0.26, 0.13, 1.285, 0.60, 'F', color='#f2cf1f'))
        rp = lib.box('auto_rplate', (0.30, 0.012, 0.13), loc=V(-1.315, 0, 0.62))
        lib.set_material(rp, plate_mat('auto_rplate_m', 'KA 01 C 4721', 0.30, 0.13, -1.315, 0.62, 'B', color='#f2cf1f'))
        parts += [fp, rp]
        parts.append(lib.box('auto_under', (0.9, 1.9, 0.10), loc=V(-0.2, 0, 0.27), mat=dark))
        parts.append(lib.tube('auto_fork', [V(FW, 0.07, RT), V(1.03, 0.07, 0.62)], 0.018, 8, dark))
        parts.append(lib.tube('auto_fork', [V(FW, -0.07, RT), V(1.03, -0.07, 0.62)], 0.018, 8, dark))
    # wheels
    for uc, s in ((FW, 0.0), (RW, 0.575), (RW, -0.575)):
        if lod:
            parts.append(lib.cyl('auto_tyre', RT, 0.11, loc=V(uc, s, RT), mat=tyre, axis='X', segs=8))
        else:
            parts.append(lib.tyre('auto_tyre', RT, 0.11, 0.105, tyre, segs=20, axis='X', loc=V(uc, s, RT)))
            parts.append(lib.disc('auto_rim', 0.11, 0.07, rim, segs=16, axis='X', loc=V(uc, s + (0.02 if s > 0 else -0.02 if s < 0 else 0), RT), dish=0.01))
    if not lod:
        for sg in (-1, 1):
            parts.append(arc_part('auto_rguard', RW, RT, RT + 0.02, RT + 0.03, 0.13, 40, 150, 8, body, s0=sg * 0.575, lip=0.003))
    return parts


def auto():
    bk = lib.Baker('auto_rickshaw', tex=1024, orm=512, ao_dist=0.45, tinted=False, lod_tex=256)
    bk.add(*build_auto())
    return bk.finish(lod=lambda: build_auto(lod=True))


PROPS = {'auto_rickshaw': auto}
