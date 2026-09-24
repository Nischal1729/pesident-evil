"""
Two-wheelers: `bike` (Honda Activa 6G-class scooter, the most common two-wheeler on an Indian campus) and
`motorbike` (Hero Splendor-class 100-125 cc commuter motorcycle). Both are tinted per instance (paint = alpha of the
albedo) and ship a `_lod` variant (a few hundred triangles) for rows of parked bikes.

Real dimensions: Activa 6G 1833 x 697 x 1156 mm, wheelbase 1260, seat 692, tyres 90/90-12 front, 90/100-10 rear.
Splendor+ 2000 x 720 x 1052 mm, wheelbase 1236, seat 785, tyres 2.75-18.
Vehicle frame (u forward, s left, z up), origin at the base centre, front = -Y in Blender (+Z in glTF).
"""
import math
from mathutils import Vector
import lib
from lib import V, Mat, Proj


def ring_us(u_f, u_r, w, z, n=16, e_front=2.2, e_rear=3.6):
    """Horizontal D-ish section at height z: superellipse in (u, s), sharper rounding at the rear."""
    uc, a, b = (u_f + u_r) / 2, (u_f - u_r) / 2, w / 2
    pts = []
    for k in range(n):
        t = 2 * math.pi * k / n
        c, s = math.cos(t), math.sin(t)
        e = e_front if c >= 0 else e_rear
        u = uc + a * math.copysign(abs(c) ** (2 / e), c)
        ss = b * math.copysign(abs(s) ** (2 / e), s)
        pts.append(V(u, ss, z))
    return pts


def ring_sz(u, w, zb, zt, n=16, e=3.0, zc_bias=0.0, top_e=None):
    """Vertical section at u: superellipse in (s, z); top_e: different exponent for the upper half."""
    zc, a, b = (zb + zt) / 2, w / 2, (zt - zb) / 2
    pts = []
    for k in range(n):
        t = 2 * math.pi * k / n - math.pi / 2
        c, s = math.cos(t), math.sin(t)
        ee = top_e if (top_e and s > 0) else e
        ss = a * math.copysign(abs(c) ** (2 / ee), c)
        z = zc + b * math.copysign(abs(s) ** (2 / ee), s)
        pts.append(V(u, ss, z))
    return pts


def arc_part(name, uc, zc, r_in, r_out, width, th0, th1, segs, mat, s0=0.0, lip=0.0):
    """Fender-like shell around an axle (axis = s): angles th (deg) measured from +u going up."""
    hw = width / 2
    prof = [(r_in, s0 - hw), (r_out, s0 - hw * 0.96), (r_out + lip, s0), (r_out, s0 + hw * 0.96), (r_in, s0 + hw)]
    a0, a1 = math.radians(270 - th1), math.radians(270 - th0)
    ob = lib.lathe(name, prof, segs, mat, axis='Z', cap=False, arc=(a0, a1), smooth_angle=60)
    ob.data.transform(lib.Matrix.Rotation(math.pi / 2, 4, 'Y'))
    lib.xform(ob, loc=V(uc, 0, zc))
    lib.clean(ob)
    return ob


def wheel(name, uc, r, width, rim_r, mats, segs=24, s=0.0, spokes=5, lod=False, hub_col=None):
    """Tyre + rim disc (both faces textured by a spoke drawing via projection)."""
    tyre_m, rim_m = mats
    if lod:
        t = lib.cyl(name + '_tyre', r, width, loc=V(uc, s, r), mat=tyre_m, axis='X', segs=8)
        return [t]
    t = lib.tyre(name + '_tyre', r, width, rim_r, tyre_m, segs=segs, axis='X', loc=V(uc, s, r), low=True)
    d = lib.disc(name + '_rim', rim_r + 0.004, width * 0.62, rim_m, segs=segs, axis='X', loc=V(uc, s, r), dish=0.012)
    return [t, d]


def spoke_canvas(proj, wheels, ppm, spoke_mat, gap_mat, n=5, twin=True):
    """Side-view drawing of alloy spokes for rim discs: wheels = [(uc, zc, rim_r)]."""
    out = {}
    for view in ('L', 'R'):
        c = proj.canvas(view, ppm, bg=spoke_mat)
        for uc, zc, rr in wheels:
            # dark gaps between spokes (wedges), hub, rim lip
            c.ellipse(uc, zc, rr * 0.93, rr * 0.93, gap_mat)
            for k in range(n):
                a = 2 * math.pi * k / n + 0.3
                pts = []
                for dd, off in ((0.18, -0.10), (0.9, -0.05), (0.9, 0.05), (0.18, 0.10)):
                    aa = a + off * (1.3 if twin else 1.0) / max(dd, 0.2)
                    pts.append((uc + math.cos(aa) * rr * dd, zc + math.sin(aa) * rr * dd))
                c.poly(pts, spoke_mat)
            c.ellipse(uc, zc, rr * 0.24, rr * 0.24, spoke_mat)
            c.ellipse(uc, zc, rr * 0.10, rr * 0.10, Mat('#2a2b2d', 0.5, 0.6))
            for k in range(4):
                a = 2 * math.pi * k / 4
                c.ellipse(uc + math.cos(a) * rr * 0.16, zc + math.sin(a) * rr * 0.16, rr * 0.025, rr * 0.025, Mat('#c8c8c8', 0.3, 1.0))
        out[view] = c.save(f'rim_{id(proj)}')
    return out


def wire_canvas(proj, wheels, ppm):
    """Side-view drawing of wire-spoked wheels (36 tangential spokes, chrome rim band, drum hub)."""
    out = {}
    dark = Mat('#161718', 0.7, 0.1)
    steel = Mat('#c9ccce', 0.22, 1.0)
    hub = Mat('#8f9396', 0.4, 0.8)
    for view in ('L', 'R'):
        c = proj.canvas(view, ppm, bg=dark)
        for uc, zc, rr in wheels:
            c.ellipse(uc, zc, rr * 1.02, rr * 1.02, steel)
            c.ellipse(uc, zc, rr * 0.90, rr * 0.90, dark)
            for k in range(36):
                a = 2 * math.pi * k / 36
                off = 0.35 if k % 2 else -0.35
                h = (uc + math.cos(a + off) * rr * 0.17, zc + math.sin(a + off) * rr * 0.17)
                c.line(h[0], h[1], uc + math.cos(a) * rr * 0.91, zc + math.sin(a) * rr * 0.91, steel, 0.0028)
            c.ellipse(uc, zc, rr * 0.30, rr * 0.30, hub)
            c.ellipse(uc, zc, rr * 0.12, rr * 0.12, Mat('#3a3c3e', 0.45, 0.7))
        out[view] = c.save(f'wire_{id(proj)}')
    return out


def plate_mat(name, text, w, h, uc, zc, facing='B', s_c=0.0, font='arialb', color='#f2f2ee', ink='#111111'):
    """Number plate material: a small drawing projected along u onto the plate face."""
    p = Proj(uc - 0.05, uc + 0.05, s_c - w / 2, s_c + w / 2, zc - h / 2, zc + h / 2)
    c = p.canvas(facing, 900, bg=Mat(color, 0.35, 0.0))
    c.rect(s_c - w / 2 + 0.004, zc - h / 2 + 0.004, s_c + w / 2 - 0.004, zc + h / 2 - 0.004, Mat(ink, 0.4), r=0.006)
    c.rect(s_c - w / 2 + 0.007, zc - h / 2 + 0.007, s_c + w / 2 - 0.007, zc + h / 2 - 0.007, Mat(color, 0.35), r=0.005)
    lines = text.split('\n')
    lh = (h - 0.02) / len(lines)
    for i, ln in enumerate(lines):
        size = min(lh * 0.62, (w - 0.03) / max(1, len(ln)) * 1.25)
        c.text(s_c, zc + h / 2 - 0.01 - lh * (i + 0.5), ln, size, Mat(ink, 0.4), font=font, stretch=0.92)
    lay = c.save(name, noise=0.02)
    return lib.proj_material(name, p, {facing: lay}, sharp=4.0, uv_weight=2.5)


# ================================================================================================ scooter
def scooter_materials():
    M = {}
    M['paint'] = None  # set by the projected materials below
    M['dark'] = lib.pbr('sc_dark_plastic', '#1d1e20', 0.55, var=0.05, grime=0.35, grime_z=(0.1, 0.45))
    M['black'] = lib.pbr('sc_black', '#0e0f10', 0.5, var=0.03, grime=0.2, grime_z=(0.0, 0.5))
    M['seat'] = lib.pbr('sc_seat', '#111213', 0.48, var=0.05, var_scale=120, rough_var=0.12)
    M['chrome'] = lib.pbr('sc_chrome', '#d6d7d9', 0.14, 1.0, var=0.02)
    M['alu'] = lib.pbr('sc_alu', '#8e9194', 0.42, 0.8, var=0.08, grime=0.6, grime_z=(0.05, 0.35), grime_col='#4a4136')
    M['tyre'] = lib.pbr('sc_tyre', '#1b1b1c', 0.88, var=0.04, grime=0.55, grime_z=(0.0, 0.25), grime_col='#7a6a55',
                        uv_weight=0.7)
    M['muffler'] = lib.pbr('sc_muffler', '#18191a', 0.45, 0.5, var=0.06, grime=0.3, grime_z=(0.2, 0.35))
    M['red'] = lib.pbr('sc_tail', '#9c0f12', 0.12, 0.0, var=0.02)
    M['amber'] = lib.pbr('sc_amber', '#e0801a', 0.12, 0.0, var=0.02)
    M['mirror'] = lib.pbr('sc_mirror', '#b9c0c6', 0.05, 1.0, var=0.0)
    M['glass'] = lib.pbr('sc_dash', '#0b0d10', 0.08, 0.0, var=0.0)
    M['spring'] = lib.pbr('sc_spring', '#a01818', 0.35, 0.3, stripes=(2, 0.018, 0.55, '#1a1a1a'))
    return M


def scooter_paint(proj):
    """Projected paint for body panels: side views (panel seams, reflector, badge) + front (headlamp, garnish)."""
    paint = Mat('#e9e9e6', 0.22, 0.0, 1.0)
    seam = Mat('#141414', 0.6, 0.0, 0.0)
    chrome = Mat('#dcdcdc', 0.12, 1.0, 0.0)
    lens = Mat('#e8eef2', 0.05, 0.85, 0.0)
    dark = Mat('#16171a', 0.35, 0.0, 0.0)
    amber = Mat('#e38a22', 0.1, 0.0, 0.0)
    red = Mat('#a41218', 0.1, 0.0, 0.0)
    views = {}
    for view in ('L', 'R'):
        c = proj.canvas(view, 700, bg=paint)
        # seam between the rear body side cover and the centre cover, and a lower trim line
        c.polyline([(0.02, 0.33), (-0.05, 0.45), (-0.10, 0.60)], seam, 0.003)
        c.polyline([(-0.20, 0.36), (-0.55, 0.39), (-0.80, 0.46), (-0.90, 0.53)], seam, 0.0025)
        c.polyline([(-0.72, 0.62), (-0.93, 0.585)], seam, 0.0025)
        # small chrome badge + reflector
        c.rect(-0.40, 0.505, -0.26, 0.52, chrome, r=0.004)
        c.rect(-0.86, 0.555, -0.80, 0.57, red, r=0.004)
        # front panel side: indicator lens near the top, seam
        c.polyline([(0.52, 0.93), (0.60, 0.72), (0.64, 0.56)], seam, 0.0025)
        views[view] = c.save('scooter_paint', noise=0.01)
    f = proj.canvas('F', 900, bg=paint)
    # headlamp: chrome reflector with LED strip, inside a dark surround, below a chrome V garnish
    f.poly([(-0.10, 0.84), (0.10, 0.84), (0.075, 0.72), (0.0, 0.69), (-0.075, 0.72)], dark)
    f.poly([(-0.088, 0.83), (0.088, 0.83), (0.066, 0.73), (0.0, 0.705), (-0.066, 0.73)], lens)
    f.rect(-0.05, 0.765, 0.05, 0.775, Mat('#ffffff', 0.05, 0.0), r=0.004)
    f.poly([(-0.14, 0.905), (0.0, 0.855), (0.14, 0.905), (0.14, 0.89), (0.0, 0.84), (-0.14, 0.89)], chrome)
    f.ellipse(0.0, 0.62, 0.028, 0.02, chrome)       # emblem
    for sgn in (-1, 1):
        f.poly([(sgn * 0.12, 0.925), (sgn * 0.175, 0.905), (sgn * 0.17, 0.89), (sgn * 0.115, 0.91)], amber)
    views['F'] = f.save('scooter_paint', noise=0.01)
    b = proj.canvas('B', 900, bg=paint)
    b.rect(-0.085, 0.585, 0.085, 0.645, red, r=0.012)
    b.rect(-0.07, 0.605, 0.07, 0.63, Mat('#d42a2a', 0.08), r=0.01)
    for sgn in (-1, 1):
        b.rect(sgn * 0.10 - 0.02, 0.595, sgn * 0.10 + 0.02, 0.625, amber, r=0.006)
    views['B'] = b.save('scooter_paint', noise=0.01)
    t = proj.canvas('T', 500, bg=paint)
    views['T'] = t.save('scooter_paint')
    return lib.proj_material('sc_paint', proj, views, sharp=5.0, grime=0.25, grime_z=(0.15, 0.45), uv_weight=1.2)


def build_scooter(lod=False):
    M = scooter_materials() if not lod else {k: lib.pbr('sc_lod_' + k, '#808080') for k in ('x',)}
    parts = []
    n = 6 if lod else 18
    if not lod:
        proj = Proj(-0.98, 0.72, -0.36, 0.36, 0.0, 1.2)
        paint = scooter_paint(proj)
    else:
        paint = dark = black = seat = tyre = M['x']
    dark = M.get('dark', paint)
    black = M.get('black', paint)
    seatm = M.get('seat', paint)
    tyre = M.get('tyre', paint)

    # --- rear body (side covers + storage), loft along u
    st = [  # u, z bottom, z top, width
        (0.07, 0.30, 0.50, 0.20), (0.04, 0.275, 0.585, 0.27), (0.00, 0.27, 0.61, 0.31), (-0.08, 0.285, 0.62, 0.34),
        (-0.18, 0.31, 0.625, 0.365), (-0.30, 0.33, 0.632, 0.385), (-0.42, 0.35, 0.64, 0.392), (-0.54, 0.37, 0.645, 0.385),
        (-0.65, 0.395, 0.648, 0.36), (-0.75, 0.425, 0.648, 0.325), (-0.83, 0.46, 0.645, 0.285), (-0.89, 0.50, 0.64, 0.235),
        (-0.93, 0.545, 0.632, 0.17), (-0.945, 0.575, 0.62, 0.10)]
    if lod:
        st = [st[1], st[4], st[7], st[10], st[13]]
    secs = [ring_sz(u, w, zb, zt, n=n, e=2.6, top_e=3.4) for u, zb, zt, w in st]
    body = lib.loft('sc_body', secs, paint, cap0=True, cap1=True, smooth_angle=50)
    parts.append(body)

    # --- floorboard: trapezoid loft, black rubber mat on top, dark side covers
    fl = []
    for u in ((0.375, 0.24, 0.10, 0.02) if not lod else (0.375, 0.02)):
        fl.append([V(u, 0.13, 0.172), V(u, 0.17, 0.25), V(u, 0.165, 0.288), V(u, 0.15, 0.295),
                   V(u, -0.15, 0.295), V(u, -0.165, 0.288), V(u, -0.17, 0.25), V(u, -0.13, 0.172)])
    floor = lib.loft('sc_floor', fl, dark, cap0=True, cap1=True, smooth_angle=35)
    if not lod:
        mat_m = lib.pbr('sc_floor_mat', '#161616', 0.8, var=0.08, grime=0.5, grime_z=(0.25, 0.32),
                        stripes=(1, 0.022, 0.3, '#0b0b0b'))
        lib.assign_faces(floor, mat_m, lambda c, nrm: nrm.z > 0.9)
    parts.append(floor)

    # --- front panel (apron) + lower leg shield, loft along z (D sections, flat inner face)
    ap = [(0.52, 0.665, 0.368, 0.34), (0.60, 0.66, 0.36, 0.385), (0.70, 0.628, 0.354, 0.39), (0.80, 0.58, 0.35, 0.362),
          (0.88, 0.53, 0.35, 0.315), (0.935, 0.482, 0.352, 0.245), (0.965, 0.445, 0.36, 0.16)]
    if lod:
        ap = [ap[0], ap[3], ap[6]]
    apron = lib.loft('sc_apron', [ring_us(uf, ur, w, z, n=n) for z, uf, ur, w in ap], paint, cap0=True, cap1=True, smooth_angle=50)
    if not lod:
        lib.assign_faces(apron, dark, lambda c, nrm: -nrm.y < -0.55 and c.z < 0.9)   # inner face points backward (+Y)
        lib.assign_faces(apron, dark, lambda c, nrm: nrm.z < -0.7)
    parts.append(apron)
    ls = [(0.165, 0.39, 0.352, 0.30), (0.28, 0.392, 0.354, 0.335), (0.40, 0.43, 0.358, 0.355), (0.53, 0.48, 0.365, 0.35)]
    if lod:
        ls = [ls[0], ls[3]]
    shield = lib.loft('sc_shield', [ring_us(uf, ur, w, z, n=n, e_front=2.0) for z, uf, ur, w in ls], dark, cap0=True,
                      cap1=True, smooth_angle=50)
    parts.append(shield)

    # --- handlebar headset
    hs = [(0.55, 0.18, 0.905, 0.955), (0.50, 0.32, 0.898, 0.995), (0.43, 0.40, 0.905, 1.018), (0.36, 0.39, 0.915, 1.02),
          (0.31, 0.31, 0.925, 1.0), (0.285, 0.2, 0.935, 0.985)]
    if lod:
        hs = [hs[1], hs[4]]
    head = lib.loft('sc_head', [ring_sz(u, w, zb, zt, n=n, e=2.6) for u, w, zb, zt in hs], paint,
                    cap0=True, cap1=True, smooth_angle=50)
    if not lod:
        lib.assign_faces(head, M['black'], lambda c, nrm: -c.y < 0.40 and nrm.z > 0.3 and nrm.y > 0.0)
        lib.assign_faces(head, M['glass'], lambda c, nrm: 0.32 < -c.y < 0.42 and nrm.z > 0.6 and abs(c.x) < 0.09)
    parts.append(head)

    # --- seat
    se = [(0.06, 0.20, 0.585, 0.655), (0.02, 0.27, 0.60, 0.69), (-0.10, 0.30, 0.61, 0.705), (-0.30, 0.31, 0.62, 0.712),
          (-0.50, 0.32, 0.625, 0.722), (-0.64, 0.31, 0.63, 0.728), (-0.72, 0.28, 0.635, 0.722), (-0.765, 0.22, 0.64, 0.705),
          (-0.785, 0.12, 0.645, 0.685)]
    if lod:
        se = [se[1], se[4], se[7]]
    seat = lib.loft('sc_seat', [ring_sz(u, w, zb, zt, n=n, e=2.4, top_e=3.2) for u, w, zb, zt in se],
                    seatm, cap0=True, cap1=True, smooth_angle=55)
    parts.append(seat)

    # --- wheels + front fender + fork
    fr, rr = 0.233, 0.217
    rim = paint if lod else lib.proj_material('sc_rim', proj, spoke_canvas(proj, [(0.63, fr, 0.152)], 700, Mat('#9a9ea3', 0.35, 0.9), Mat('#141516', 0.6, 0.2)), sharp=8.0)
    parts += wheel('sc_fw', 0.63, fr, 0.09, 0.152, (tyre, rim), segs=18, lod=lod)
    parts += wheel('sc_rw', -0.63, rr, 0.10, 0.127, (tyre, M.get('black', paint)), segs=16, lod=lod)
    parts.append(arc_part('sc_fender', 0.63, fr, fr + 0.016, fr + 0.028, 0.105, 24, 122, 12 if not lod else 3, paint, lip=0.004))
    if not lod:
        for sg in (-1, 1):
            parts.append(lib.tube('sc_fork', [V(0.63, sg * 0.058, fr), V(0.555, sg * 0.058, 0.53)], 0.019, 10, M['chrome']))
            parts.append(lib.tube('sc_forkc', [V(0.63, sg * 0.058, fr - 0.01), V(0.60, sg * 0.058, 0.33)], 0.026, 10, M['alu']))
        parts.append(lib.cyl('sc_fhub', 0.045, 0.13, loc=V(0.63, 0, fr), mat=M['alu'], axis='X', segs=14))
        # rear hub/drum + swing case on the left, muffler on the right, shock
        parts.append(lib.cyl('sc_rhub', 0.075, 0.13, loc=V(-0.63, 0, rr), mat=M['alu'], axis='X', segs=14))
        eng = [ring_sz(u, 0.095, zb, zt, n=12, e=2.4) for u, zb, zt in
               ((-0.06, 0.18, 0.33), (-0.18, 0.15, 0.36), (-0.34, 0.15, 0.33), (-0.50, 0.16, 0.30), (-0.62, 0.15, 0.285), (-0.70, 0.17, 0.265))]
        for sec in eng:
            for v in sec:
                v.x += 0.155
        parts.append(lib.loft('sc_case', eng, M['alu'], cap0=True, cap1=True, smooth_angle=50))
        parts.append(lib.box('sc_airbox', (0.09, 0.26, 0.10), loc=V(-0.36, 0.17, 0.40), mat=M['black'], bev=0.02, seg=2))
        mf = [ring_sz(u, 0.10, zc - 0.055, zc + 0.055, n=12, e=2.3) for u, zc in ((-0.30, 0.28), (-0.42, 0.29), (-0.60, 0.31), (-0.76, 0.33), (-0.84, 0.345))]
        for sec in mf:
            for v in sec:
                v.x -= 0.175
        parts.append(lib.loft('sc_muffler', mf, M['muffler'], cap0=True, cap1=True, smooth_angle=50))
        hsld = [ring_sz(u, 0.03, zc - 0.045, zc + 0.05, n=10, e=2.2) for u, zc in ((-0.45, 0.295), (-0.60, 0.315), (-0.74, 0.332))]
        for sec in hsld:
            for v in sec:
                v.x -= 0.232
        parts.append(lib.loft('sc_heatshield', hsld, M['chrome'], cap0=True, cap1=True, smooth_angle=50))
        parts.append(lib.cyl('sc_tip', 0.02, 0.05, loc=V(-0.865, -0.19, 0.35), mat=M['muffler'], axis='Y', segs=10))
        parts.append(lib.tube('sc_shock', [V(-0.66, 0.16, 0.27), V(-0.53, 0.165, 0.56)], 0.022, 10, M['spring']))
        # grab rail, tail lamp housing, rear fender + plate
        rail = [V(-0.50, 0.155, 0.655), V(-0.70, 0.15, 0.692), V(-0.83, 0.11, 0.70), V(-0.875, 0.0, 0.70),
                V(-0.83, -0.11, 0.70), V(-0.70, -0.15, 0.692), V(-0.50, -0.155, 0.655)]
        parts.append(lib.tube('sc_rail', lib.fillet(rail, 0.05, 3), 0.013, 8, M['alu']))
        fe = [ring_sz(u, 0.15, zb, zt, n=10, e=2.6) for u, zb, zt in ((-0.86, 0.43, 0.56), (-0.93, 0.40, 0.51), (-0.975, 0.37, 0.45))]
        parts.append(lib.loft('sc_rfender', fe, M['black'], cap0=True, cap1=True, smooth_angle=50))
        plate = lib.box('sc_plate', (0.20, 0.012, 0.11), loc=V(-0.99, 0, 0.415), mat=None, rot=(math.radians(-12), 0, 0))
        lib.set_material(plate, plate_mat('sc_plate_m', 'KA 05\nHK 4827', 0.20, 0.11, -0.99, 0.415, 'B'))
        parts.append(plate)
        # handlebar grips, levers, mirrors
        for sg in (-1, 1):
            parts.append(lib.tube('sc_grip', [V(0.355, sg * 0.20, 0.972), V(0.345, sg * 0.335, 0.968)], 0.018, 10, M['black']))
            parts.append(lib.cyl('sc_barend', 0.019, 0.02, loc=V(0.345, sg * 0.345, 0.968), mat=M['chrome'], axis='X', segs=10))
            parts.append(lib.tube('sc_lever', [V(0.42, sg * 0.18, 0.99), V(0.405, sg * 0.25, 0.99), V(0.39, sg * 0.33, 0.985)], 0.006, 6, M['alu']))
            parts.append(lib.tube('sc_stalk', [V(0.39, sg * 0.21, 1.0), V(0.38, sg * 0.235, 1.07), V(0.355, sg * 0.26, 1.12)], 0.0075, 6, M['black']))
            mh = [ring_sz(u, 0.12, 1.115, 1.19, n=12, e=2.2) for u in (0.365, 0.35, 0.332)]
            for sec in mh:
                for v in sec:
                    v.x += sg * 0.285
            mirror = lib.loft('sc_mirrorhead', mh, M['black'], cap0=True, cap1=True, smooth_angle=50)
            lib.assign_faces(mirror, M['mirror'], lambda c, nrm: nrm.y > 0.8)
            parts.append(mirror)
        # tail lamp lens + front lamp lens bulge
        tl = lib.box('sc_taillens', (0.15, 0.03, 0.05), loc=V(-0.935, 0, 0.605), mat=M['red'], bev=0.012, seg=2)
        parts.append(tl)
        parts.append(lib.tube('sc_stand', [V(-0.02, 0.12, 0.19), V(-0.10, 0.22, 0.02)], 0.011, 6, M['black']))
    else:
        parts.append(lib.box('sc_lgrip', (0.70, 0.035, 0.035), loc=V(0.35, 0, 0.97), mat=paint))
        for sg in (-1, 1):
            parts.append(lib.box('sc_lmirror', (0.11, 0.03, 0.07), loc=V(0.35, sg * 0.28, 1.15), mat=paint))
            parts.append(lib.box('sc_lstalk', (0.015, 0.015, 0.13), loc=V(0.375, sg * 0.24, 1.06), mat=paint))
        parts.append(lib.box('sc_lcase', (0.09, 0.62, 0.15), loc=V(-0.38, 0.155, 0.24), mat=paint))
        parts.append(lib.box('sc_lmuffler', (0.09, 0.5, 0.10), loc=V(-0.57, -0.18, 0.31), mat=paint))
    return parts


def scooter():
    bk = lib.Baker('bike', tex=1024, orm=512, ao_dist=0.35, tinted=True, lod_tex=256)
    bk.add(*build_scooter())
    return bk.finish(lod=lambda: build_scooter(lod=True))




# ================================================================================================ motorcycle
def moto_paint(proj):
    """Tank / side panel / tail paint with Splendor-style stripe graphics (the stripes don't take the tint)."""
    paint = Mat('#e8e8e5', 0.2, 0.0, 1.0)
    stripe = Mat('#b8bcc0', 0.25, 0.6, 0.0)
    stripe2 = Mat('#2a2c30', 0.3, 0.0, 0.0)
    black = Mat('#121314', 0.45, 0.0, 0.0)
    chrome = Mat('#dadada', 0.12, 1.0, 0.0)
    red = Mat('#a3121a', 0.1, 0.0, 0.0)
    amber = Mat('#e38a22', 0.1, 0.0, 0.0)
    lens = Mat('#e6ecf0', 0.05, 0.85, 0.0)
    views = {}
    for view in ('L', 'R'):
        c = proj.canvas(view, 650, bg=paint)
        # tank graphic: two swept stripes + a badge
        c.poly([(0.33, 0.855), (0.12, 0.83), (-0.02, 0.80), (-0.02, 0.785), (0.12, 0.812), (0.34, 0.84)], stripe)
        c.poly([(0.30, 0.815), (0.10, 0.79), (0.00, 0.77), (0.00, 0.76), (0.10, 0.778), (0.31, 0.803)], stripe2)
        c.rect(0.14, 0.845, 0.24, 0.862, chrome, r=0.005)
        # side panel graphic
        c.poly([(-0.06, 0.66), (-0.30, 0.70), (-0.30, 0.685), (-0.06, 0.645)], stripe)
        c.text(-0.18, 0.62, '125', 0.03, stripe2, font='arialb')
        # tail: stripe + reflector
        c.poly([(-0.36, 0.72), (-0.70, 0.77), (-0.70, 0.76), (-0.36, 0.707)], stripe)
        c.rect(-0.70, 0.705, -0.64, 0.72, red, r=0.004)
        views[view] = c.save('moto_paint', noise=0.01)
    f = proj.canvas('F', 900, bg=paint)
    f.ellipse(0.0, 0.86, 0.085, 0.075, black)
    f.ellipse(0.0, 0.86, 0.072, 0.063, chrome)
    f.ellipse(0.0, 0.86, 0.062, 0.054, lens)
    for sg in (-1, 1):
        f.rect(sg * 0.15 - 0.03, 0.835, sg * 0.15 + 0.03, 0.86, amber, r=0.008)
    views['F'] = f.save('moto_paint', noise=0.01)
    b = proj.canvas('B', 900, bg=paint)
    b.rect(-0.07, 0.715, 0.07, 0.765, red, r=0.01)
    views['B'] = b.save('moto_paint', noise=0.01)
    views['T'] = proj.canvas('T', 400, bg=paint).save('moto_paint')
    return lib.proj_material('mb_paint', proj, views, sharp=5.0, grime=0.2, grime_z=(0.2, 0.5), uv_weight=1.3)


def build_moto(lod=False):
    n = 16 if not lod else 6
    if not lod:
        proj = Proj(-1.02, 0.98, -0.38, 0.38, 0.0, 1.1)
        paint = moto_paint(proj)
        M = scooter_materials()
        black, chrome, alu, tyre, seatm = M['black'], M['chrome'], M['alu'], M['tyre'], M['seat']
        fins = lib.pbr('mb_fins', '#1b1c1e', 0.5, 0.3, stripes=(0, 0.012, 0.45, '#9da1a5'), grime=0.3, grime_z=(0.2, 0.5))
        spring = lib.pbr('mb_spring', '#cfd2d4', 0.2, 1.0, stripes=(2, 0.016, 0.5, '#2a2a2a'))
        rim = lib.proj_material('mb_rim', proj, wire_canvas(proj, [(0.618, 0.30, 0.229), (-0.618, 0.30, 0.229)], 900), sharp=8.0)
    else:
        paint = black = chrome = alu = tyre = seatm = fins = spring = rim = lib.pbr('mb_lod', '#808080')
    parts = []
    R = 0.30
    # wheels
    for uc in (0.618, -0.618):
        parts += wheel('mb_w', uc, R, 0.08, 0.229, (tyre, rim), segs=18, lod=lod)
        if not lod:
            parts.append(lib.cyl('mb_hub', 0.06, 0.12, loc=V(uc, 0, R), mat=alu, axis='X', segs=14))
    # front mudguard (paint), rear mudguard (black)
    parts.append(arc_part('mb_ffender', 0.618, R, R + 0.018, R + 0.026, 0.085, 32, 112, 12 if not lod else 3, paint, lip=0.003))
    parts.append(arc_part('mb_rfender', -0.618, R, R + 0.03, R + 0.038, 0.11, 62, 165, 10 if not lod else 3, black, lip=0.003))
    # fuel tank
    tk = [(0.36, 0.14, 0.80, 0.905), (0.30, 0.25, 0.745, 0.935), (0.20, 0.30, 0.72, 0.94), (0.09, 0.31, 0.715, 0.925),
          (0.00, 0.28, 0.72, 0.895), (-0.06, 0.22, 0.73, 0.86)]
    if lod:
        tk = [tk[0], tk[2], tk[5]]
    parts.append(lib.loft('mb_tank', [ring_sz(u, w, zb, zt, n=n, e=2.3, top_e=2.6) for u, w, zb, zt in tk], paint, cap0=True, cap1=True, smooth_angle=55))
    # seat
    se = [(0.02, 0.18, 0.76, 0.80), (-0.06, 0.26, 0.76, 0.815), (-0.20, 0.28, 0.745, 0.82), (-0.38, 0.28, 0.75, 0.83),
          (-0.52, 0.26, 0.76, 0.835), (-0.60, 0.22, 0.77, 0.83), (-0.64, 0.14, 0.78, 0.82)]
    if lod:
        se = [se[0], se[3], se[6]]
    parts.append(lib.loft('mb_seat', [ring_sz(u, w, zb, zt, n=n, e=2.4, top_e=3.4) for u, w, zb, zt in se], seatm, cap0=True, cap1=True, smooth_angle=55))
    # side panels + tail cowl (paint)
    sp = [(-0.02, 0.22, 0.56, 0.74), (-0.12, 0.26, 0.55, 0.755), (-0.26, 0.26, 0.58, 0.76), (-0.38, 0.24, 0.63, 0.765),
          (-0.52, 0.22, 0.67, 0.772), (-0.66, 0.17, 0.70, 0.775), (-0.74, 0.10, 0.715, 0.77)]
    if lod:
        sp = [sp[0], sp[3], sp[6]]
    parts.append(lib.loft('mb_side', [ring_sz(u, w, zb, zt, n=n, e=2.8) for u, w, zb, zt in sp], paint, cap0=True, cap1=True, smooth_angle=50))
    # engine: crankcase + inclined cylinder with fins
    cc = [(0.20, 0.20, 0.25, 0.44), (0.12, 0.27, 0.21, 0.47), (0.00, 0.28, 0.20, 0.47), (-0.10, 0.26, 0.22, 0.45), (-0.16, 0.18, 0.26, 0.42)]
    if lod:
        cc = [cc[0], cc[4]]
    parts.append(lib.loft('mb_case', [ring_sz(u, w, zb, zt, n=n, e=2.6) for u, w, zb, zt in cc], alu, cap0=True, cap1=True, smooth_angle=45))
    cyl_pts = [V(0.12, 0, 0.44), V(0.30, 0, 0.53)]
    parts.append(lib.tube('mb_cyl', cyl_pts, 0.085 if not lod else 0.08, 12 if not lod else 5, fins))
    if not lod:
        parts.append(lib.box('mb_head', (0.20, 0.10, 0.11), loc=V(0.315, 0, 0.545), mat=fins, bev=0.02, seg=2, rot=(math.radians(-26), 0, 0)))
        parts.append(lib.cyl('mb_magneto', 0.09, 0.05, loc=V(0.05, 0.155, 0.33), mat=alu, axis='X', segs=16))
        parts.append(lib.cyl('mb_clutch', 0.10, 0.06, loc=V(0.03, -0.16, 0.34), mat=alu, axis='X', segs=16))
        parts.append(lib.box('mb_carb', (0.10, 0.12, 0.10), loc=V(-0.06, -0.02, 0.56), mat=black, bev=0.02))
        # frame backbone + down tube
        parts.append(lib.tube('mb_frame', lib.fillet([V(0.44, 0, 0.84), V(0.10, 0, 0.66), V(-0.14, 0, 0.44)], 0.08), 0.026, 8, black))
        parts.append(lib.tube('mb_down', [V(0.43, 0, 0.82), V(0.28, 0, 0.46)], 0.022, 8, black))
        parts.append(lib.tube('mb_subframe', [V(-0.10, 0.10, 0.68), V(-0.68, 0.09, 0.74)], 0.014, 6, black))
        parts.append(lib.tube('mb_subframe', [V(-0.10, -0.10, 0.68), V(-0.68, -0.09, 0.74)], 0.014, 6, black))
        # swingarm, chain guard (left), shocks
        for sg in (-1, 1):
            parts.append(lib.box('mb_swing', (0.035, 0.52, 0.045), loc=V(-0.37, sg * 0.085, 0.35), mat=black, rot=(math.radians(-11), 0, 0)))
            parts.append(lib.tube('mb_shock', [V(-0.56, sg * 0.115, 0.33), V(-0.49, sg * 0.12, 0.70)], 0.024, 10, spring))
        parts.append(lib.box('mb_chainguard', (0.03, 0.56, 0.07), loc=V(-0.34, 0.125, 0.39), mat=black, bev=0.01, rot=(math.radians(-11), 0, 0)))
        # saree guard (left, mandatory in India) + grab rail + tail lamp + plate
        parts.append(lib.tube('mb_saree', lib.fillet([V(-0.42, 0.15, 0.66), V(-0.56, 0.16, 0.66), V(-0.70, 0.16, 0.52), V(-0.72, 0.16, 0.36)], 0.06), 0.009, 6, black))
        parts.append(lib.box('mb_sareeplate', (0.004, 0.20, 0.13), loc=V(-0.62, 0.165, 0.47), mat=black, rot=(math.radians(35), 0, 0)))
        rail = [V(-0.40, 0.13, 0.79), V(-0.62, 0.13, 0.80), V(-0.70, 0.08, 0.80), V(-0.70, -0.08, 0.80), V(-0.62, -0.13, 0.80), V(-0.40, -0.13, 0.79)]
        parts.append(lib.tube('mb_rail', lib.fillet(rail, 0.04, 3), 0.012, 8, black))
        parts.append(lib.box('mb_tail', (0.14, 0.05, 0.05), loc=V(-0.75, 0, 0.745), mat=M['red'], bev=0.012, seg=2))
        plate = lib.box('mb_plate', (0.20, 0.012, 0.11), loc=V(-0.93, 0, 0.53), mat=None, rot=(math.radians(-8), 0, 0))
        lib.set_material(plate, plate_mat('mb_plate_m', 'KA 03\nJM 7719', 0.20, 0.11, -0.93, 0.53, 'B'))
        parts.append(plate)
        parts.append(lib.box('mb_platebracket', (0.05, 0.22, 0.02), loc=V(-0.84, 0, 0.60), mat=black, rot=(math.radians(-35), 0, 0)))
        # exhaust: header under the engine to the right, muffler + heat shield
        ex = [V(0.33, -0.03, 0.46), V(0.34, -0.06, 0.30), V(0.20, -0.12, 0.19), V(-0.10, -0.15, 0.20), V(-0.30, -0.155, 0.27)]
        parts.append(lib.tube('mb_header', lib.fillet(ex, 0.08, 3), 0.02, 8, M['muffler']))
        mf = [ring_sz(u, 0.09, zc - 0.05, zc + 0.05, n=12, e=2.2) for u, zc in ((-0.28, 0.265), (-0.45, 0.30), (-0.68, 0.345), (-0.84, 0.37), (-0.88, 0.375))]
        for sec in mf:
            for v in sec:
                v.x -= 0.165
        parts.append(lib.loft('mb_muffler', mf, M['muffler'], cap0=True, cap1=True, smooth_angle=50))
        hs = [ring_sz(u, 0.025, zc - 0.045, zc + 0.045, n=10, e=2.2) for u, zc in ((-0.36, 0.285), (-0.52, 0.315), (-0.66, 0.34))]
        for sec in hs:
            for v in sec:
                v.x -= 0.215
        parts.append(lib.loft('mb_heatshield', hs, chrome, cap0=True, cap1=True, smooth_angle=50))
        # crash guard (chrome, very Indian)
        for sg in (-1, 1):
            cg = [V(0.36, sg * 0.03, 0.62), V(0.36, sg * 0.20, 0.52), V(0.34, sg * 0.25, 0.38), V(0.26, sg * 0.20, 0.22), V(0.16, sg * 0.10, 0.20)]
            parts.append(lib.tube('mb_guard', lib.fillet(cg, 0.07, 3), 0.014, 8, chrome))
            # footrests
            parts.append(lib.tube('mb_peg', [V(-0.02, sg * 0.10, 0.30), V(-0.03, sg * 0.24, 0.30)], 0.014, 8, black))
            parts.append(lib.tube('mb_ppeg', [V(-0.42, sg * 0.12, 0.40), V(-0.44, sg * 0.23, 0.40)], 0.012, 6, black))
        parts.append(lib.tube('mb_stand', [V(-0.08, 0.14, 0.26), V(-0.16, 0.26, 0.02)], 0.011, 6, black))
        # forks + headlamp + console + handlebar + mirrors
        for sg in (-1, 1):
            parts.append(lib.tube('mb_fork', [V(0.618, sg * 0.075, R), V(0.50, sg * 0.075, 0.58)], 0.022, 10, chrome))
            parts.append(lib.tube('mb_forkc', [V(0.50, sg * 0.075, 0.57), V(0.435, sg * 0.075, 0.84)], 0.03, 10, black))
            parts.append(lib.tube('mb_forkl', [V(0.63, sg * 0.075, R - 0.02), V(0.575, sg * 0.075, 0.44)], 0.03, 10, alu))
        hl = [ring_sz(u, w, zb, zt, n=14, e=2.2) for u, w, zb, zt in ((0.56, 0.15, 0.80, 0.92), (0.52, 0.19, 0.78, 0.94), (0.46, 0.17, 0.79, 0.93))]
        parts.append(lib.loft('mb_headlamp', hl, paint, cap0=True, cap1=True, smooth_angle=50))
        parts.append(lib.box('mb_console', (0.18, 0.10, 0.07), loc=V(0.44, 0, 0.965), mat=black, bev=0.02, seg=2, rot=(math.radians(20), 0, 0)))
        parts.append(lib.box('mb_dial', (0.14, 0.02, 0.05), loc=V(0.41, 0, 0.995), mat=M['glass'], rot=(math.radians(50), 0, 0)))
        bar = [V(0.35, 0.36, 1.00), V(0.39, 0.27, 0.99), V(0.43, 0.10, 0.955), V(0.43, -0.10, 0.955), V(0.39, -0.27, 0.99), V(0.35, -0.36, 1.00)]
        parts.append(lib.tube('mb_bar', lib.fillet(bar, 0.05, 3), 0.011, 8, chrome))
        for sg in (-1, 1):
            parts.append(lib.tube('mb_grip', [V(0.37, sg * 0.30, 0.995), V(0.345, sg * 0.37, 1.0)], 0.017, 10, black))
            parts.append(lib.tube('mb_lever', [V(0.42, sg * 0.20, 0.975), V(0.40, sg * 0.28, 0.985), V(0.385, sg * 0.36, 0.99)], 0.006, 6, alu))
            parts.append(lib.tube('mb_stalk', [V(0.41, sg * 0.24, 0.98), V(0.39, sg * 0.27, 1.03), V(0.37, sg * 0.30, 1.03)], 0.0075, 6, black))
            mh = [ring_sz(u, 0.10, 1.00, 1.055, n=12, e=2.2) for u in (0.385, 0.37, 0.352)]
            for sec in mh:
                for v in sec:
                    v.x += sg * 0.335
            mirror = lib.loft('mb_mirror', mh, black, cap0=True, cap1=True, smooth_angle=50)
            lib.assign_faces(mirror, M['mirror'], lambda c, nrm: nrm.y > 0.8)
            parts.append(mirror)
            parts.append(lib.box('mb_indic', (0.05, 0.03, 0.03), loc=V(0.52, sg * 0.15, 0.85), mat=M['amber'], bev=0.01))
            parts.append(lib.box('mb_rindic', (0.05, 0.03, 0.03), loc=V(-0.80, sg * 0.12, 0.72), mat=M['amber'], bev=0.01))
    else:
        for sg in (-1, 1):
            parts.append(lib.box('mb_lfork', (0.04, 0.05, 0.60), loc=V(0.53, sg * 0.075, 0.58), mat=paint, rot=(math.radians(-24), 0, 0)))
            parts.append(lib.box('mb_lmirror', (0.10, 0.03, 0.05), loc=V(0.37, sg * 0.335, 1.03), mat=paint))
        parts.append(lib.box('mb_lbar', (0.74, 0.04, 0.03), loc=V(0.39, 0, 0.985), mat=paint))
        parts.append(lib.box('mb_llamp', (0.19, 0.10, 0.14), loc=V(0.51, 0, 0.86), mat=paint))
        parts.append(lib.box('mb_lmuff', (0.09, 0.62, 0.10), loc=V(-0.58, -0.165, 0.32), mat=paint, rot=(math.radians(-6), 0, 0)))
        parts.append(lib.box('mb_lswing', (0.20, 0.52, 0.06), loc=V(-0.37, 0, 0.35), mat=paint, rot=(math.radians(-11), 0, 0)))
        parts.append(lib.box('mb_lplate', (0.20, 0.03, 0.11), loc=V(-0.92, 0, 0.53), mat=paint))
    return parts


def motorbike():
    bk = lib.Baker('motorbike', tex=1024, orm=512, ao_dist=0.35, tinted=True, lod_tex=256)
    bk.add(*build_moto())
    return bk.finish(lod=lambda: build_moto(lod=True))


PROPS = {'bike': scooter, 'motorbike': motorbike}
