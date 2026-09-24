"""
`car_hatchback`: a Maruti Swift-class hatchback, India's most common car (3845 x 1735 x 1530 mm, wheelbase 2450,
185/65 R15). Body = one smooth loft of cross-sections (sill, shoulder, narrow greenhouse with tumblehome, roof crown)
with boolean wheel arches; glass, doors, lamps, grille and plates are elevation drawings projected on it and baked.
Paint is tinted per instance (albedo alpha); `_lod` for distant rows.
Vehicle frame (u forward, s left, z up).
"""
import math
import bpy
import lib
from lib import V, Mat, Proj
from two_wheelers import plate_mat, spoke_canvas

FA, RA, RT = 1.225, -1.225, 0.311


def section(u, zb, zbelt, zte, zt, wl, wb, wr, n_side=5, n_roof=3):
    """Half profile (s >= 0) from the bottom centre over the sill, door, shoulder, greenhouse and roof to the roof
    centre, mirrored to a closed ring."""
    half = [(0.0, zb), (wl - 0.10, zb), (wl - 0.02, zb + 0.05), (wl, zb + 0.22), (wl - 0.004, zbelt - 0.14),
            (wb, zbelt)]
    # greenhouse side with tumblehome (curved)
    for k in range(1, n_side):
        t = k / n_side
        s = wb + (wr - wb) * (t ** 0.9)
        z = zbelt + (zte - zbelt) * t
        half.append((s - 0.012 * math.sin(math.pi * t), z))
    half.append((wr, zte))
    for k in range(1, n_roof + 1):
        t = k / (n_roof + 1)
        half.append((wr * (1 - t) ** 1.0 * 0.98 if k < n_roof + 1 else 0.0, zte + (zt - zte) * math.sin(t * math.pi / 2)))
    half.append((0.0, zt))
    ring = half + [(-s, z) for s, z in reversed(half[1:-1])]
    return [V(u, s, z) for s, z in ring]


STATIONS = [  # u, zb, zbelt, zt_edge, zt, w_low, w_belt, w_roof   (half widths)
    (-1.925, 0.33, 0.84, 0.88, 0.90, 0.76, 0.70, 0.62),
    (-1.905, 0.26, 0.95, 1.02, 1.04, 0.835, 0.80, 0.68),
    (-1.86, 0.225, 1.00, 1.12, 1.15, 0.858, 0.83, 0.655),
    (-1.75, 0.205, 1.02, 1.26, 1.30, 0.866, 0.835, 0.63),
    (-1.55, 0.195, 1.025, 1.375, 1.42, 0.868, 0.838, 0.615),
    (-1.30, 0.185, 1.02, 1.43, 1.475, 0.868, 0.84, 0.61),
    (-0.90, 0.175, 1.01, 1.455, 1.50, 0.868, 0.842, 0.613),
    (-0.30, 0.17, 0.995, 1.458, 1.503, 0.868, 0.843, 0.615),
    (0.25, 0.17, 0.985, 1.44, 1.49, 0.866, 0.842, 0.612),
    (0.55, 0.172, 0.978, 1.37, 1.42, 0.863, 0.84, 0.605),
    (0.78, 0.178, 0.975, 1.22, 1.26, 0.86, 0.836, 0.64),
    (0.98, 0.186, 0.972, 1.05, 1.08, 0.856, 0.83, 0.70),
    (1.20, 0.196, 0.945, 0.962, 0.982, 0.848, 0.822, 0.74),
    (1.48, 0.21, 0.895, 0.915, 0.935, 0.838, 0.808, 0.74),
    (1.72, 0.235, 0.825, 0.845, 0.862, 0.815, 0.775, 0.71),
    (1.86, 0.265, 0.735, 0.755, 0.77, 0.77, 0.72, 0.66),
    (1.925, 0.31, 0.60, 0.625, 0.64, 0.66, 0.60, 0.55),
]


SEDAN = [  # same front as the hatch; boot instead of a tailgate (Dzire-class, 3995 mm)
    (-2.07, 0.35, 0.86, 0.90, 0.92, 0.74, 0.70, 0.62),
    (-2.05, 0.28, 0.95, 1.00, 1.02, 0.82, 0.79, 0.70),
    (-1.98, 0.24, 0.99, 1.03, 1.05, 0.85, 0.82, 0.74),
    (-1.70, 0.21, 1.00, 1.035, 1.055, 0.862, 0.832, 0.76),
    (-1.45, 0.20, 1.005, 1.06, 1.08, 0.866, 0.836, 0.72),
    (-1.20, 0.19, 1.008, 1.26, 1.30, 0.868, 0.838, 0.66),
    (-0.95, 0.18, 1.008, 1.41, 1.455, 0.868, 0.84, 0.62),
    (-0.60, 0.175, 1.002, 1.46, 1.505, 0.868, 0.842, 0.615),
] + STATIONS[7:]


def body(mat, lod=False, kind='hatch'):
    S = STATIONS if kind == 'hatch' else SEDAN
    st = S if not lod else [S[i] for i in (0, 2, 4, 7, 9, 11, 12, 14, 16)]
    ns, nr = (5, 3) if not lod else (2, 1)
    secs = [section(*t, n_side=ns, n_roof=nr) for t in st]
    ob = lib.loft('car_body', secs, mat, cap0=True, cap1=True, smooth_angle=55)
    for uc in (FA, RA):
        cut = lib.cyl('arch_cut', 0.352, 2.2, loc=V(uc, 0, RT + 0.005), mat=mat, axis='X', segs=26 if not lod else 12)
        md = ob.modifiers.new('arch', 'BOOLEAN')
        md.operation = 'DIFFERENCE'
        md.object = cut
        md.solver = 'EXACT'
        lib.apply_mods(ob)
        bpy.data.objects.remove(cut, do_unlink=True)
    lib.clean(ob)
    lib.delete_faces(ob, lambda c, n: n.z < -0.95 and c.z < 0.25)
    lib.smooth(ob, 55)
    return ob


C = {'glass': '#10151a', 'black': '#111213', 'trim': '#1b1c1e', 'chrome': '#d4d6d8', 'lens': '#e4e9ee',
     'red': '#9c1016', 'amber': '#e08a1f', 'paint': '#ebebea', 'seat': '#2a2b2e', 'grey': '#3a3c3f'}


def M(k, rough=0.35, metal=0.0, tint=0.0):
    return Mat(C.get(k, k), rough, metal, tint)


PAINT = Mat('#ececea', 0.18, 0.0, 1.0)


def side_view(proj, view, kind='hatch'):
    c = proj.canvas(view, 320, bg=PAINT)
    # greenhouse: black frame band then glass (front door, rear door, rear quarter)
    if kind == 'hatch':
        band = [(0.99, 0.97), (0.55, 1.385), (0.25, 1.445), (-0.9, 1.455), (-1.30, 1.43), (-1.62, 1.33), (-1.86, 1.12), (-1.86, 0.99)]
    else:
        band = [(0.99, 0.97), (0.55, 1.385), (0.25, 1.445), (-0.60, 1.45), (-0.95, 1.40), (-1.20, 1.25), (-1.42, 1.06), (-1.42, 1.0)]
    c.poly(band, M('black', 0.3))
    c.poly([(0.93, 1.0), (0.55, 1.36), (0.26, 1.42), (-0.05, 1.425), (-0.05, 1.01)], M('glass', 0.04))
    c.poly([(-0.10, 1.01), (-0.10, 1.425), (-0.80, 1.43), (-0.95, 1.38), (-0.95, 1.02)], M('glass', 0.04))
    if kind == 'hatch':
        c.poly([(-1.02, 1.03), (-1.02, 1.39), (-1.28, 1.40), (-1.50, 1.33), (-1.62, 1.18), (-1.62, 1.04)], M('glass', 0.04))
    else:
        c.poly([(-1.00, 1.03), (-1.00, 1.36), (-1.18, 1.24), (-1.30, 1.10), (-1.30, 1.04)], M('glass', 0.04))
    for u in (0.12, -0.72):  # headrests seen through the glass
        c.rect(u - 0.09, 1.17, u + 0.09, 1.29, M('seat', 0.06), r=0.04)
    c.rect(-0.105, 0.99, -0.045, 1.46, M('black', 0.3))              # B pillar (blacked out)
    # door cut lines, handles, fuel lid, side indicator, sill
    seam = M('#1a1a1a', 0.6)
    c.polyline([(0.97, 0.98), (0.99, 0.62), (0.96, 0.30), (0.90, 0.22)], seam, 0.004)
    c.polyline([(-0.075, 0.98), (-0.07, 0.25)], seam, 0.004)
    c.polyline([(-1.00, 0.98), (-0.97, 0.62), (-0.80, 0.38), (-0.70, 0.22)], seam, 0.004)
    for u in (0.07, -0.88):
        c.rect(u - 0.075, 0.86, u + 0.075, 0.89, M('trim', 0.4), r=0.012)
    c.rect(-1.52, 0.83, -1.40, 0.93, seam, r=0.02) if view == 'L' else None
    rear = -1.925 if kind == 'hatch' else -2.07
    c.rect(1.28, 0.78, 1.34, 0.80, M('amber', 0.1), r=0.008)
    c.rect(-2.0, 0.17, 2.0, 0.24, M('black', 0.6))                   # sill / lower cladding
    # lamps wrapping round the corners
    c.poly([(1.93, 0.80), (1.76, 0.86), (1.66, 0.87), (1.70, 0.80), (1.90, 0.73)], M('lens', 0.05, 0.8))
    c.poly([(rear, 0.95), (rear + 0.10, 0.97), (rear + 0.14, 0.88), (rear, 0.84)], M('red', 0.08))
    if kind == 'sedan':
        c.polyline([(-1.44, 1.01), (-2.02, 1.0), (-2.06, 0.86)], seam, 0.003)         # boot lid cut
    # bumper split lines
    c.polyline([(1.55, 0.26), (1.60, 0.55), (1.72, 0.66)], seam, 0.003)
    c.polyline([(-1.55, 0.26), (-1.60, 0.55), (-1.75, 0.70)], seam, 0.003)
    return c.save(f'car_{kind}_{view}', noise=0.008)


def front_view(proj):
    c = proj.canvas('F', 380, bg=PAINT)
    c.poly([(-0.70, 0.98), (0.70, 0.98), (0.60, 1.40), (-0.60, 1.40)], M('glass', 0.04))
    for sg in (-1, 1):   # swept headlamps
        c.poly([(sg * 0.40, 0.70), (sg * 0.78, 0.74), (sg * 0.80, 0.83), (sg * 0.50, 0.80)], M('black', 0.2))
        c.poly([(sg * 0.43, 0.715), (sg * 0.76, 0.75), (sg * 0.775, 0.81), (sg * 0.51, 0.785)], M('lens', 0.05, 0.85))
        c.ellipse(sg * 0.62, 0.765, 0.04, 0.03, Mat('#fbfbf7', 0.05, 0.3))
        c.ellipse(sg * 0.60, 0.33, 0.045, 0.035, M('lens', 0.05, 0.7))     # fog lamp
    c.poly([(-0.36, 0.52), (0.36, 0.52), (0.30, 0.68), (-0.30, 0.68)], M('black', 0.35))   # grille
    for z in (0.56, 0.60, 0.64):
        c.line(-0.32, z, 0.32, z, M('grey', 0.4, 0.3), 0.006)
    c.ellipse(0.0, 0.62, 0.05, 0.035, M('chrome', 0.15, 1.0))
    c.rect(-0.55, 0.28, 0.55, 0.42, M('black', 0.5), r=0.05)           # lower intake
    c.rect(-0.8, 0.20, 0.8, 0.26, M('black', 0.6))
    return c.save('car_F', noise=0.008)


def rear_view(proj, kind='hatch'):
    c = proj.canvas('B', 380, bg=PAINT)
    if kind == 'hatch':
        c.poly([(-0.60, 1.07), (0.60, 1.07), (0.54, 1.40), (-0.54, 1.40)], M('glass', 0.04))
        c.rect(-0.12, 1.42, 0.12, 1.445, M('red', 0.1))                      # high stop lamp
    else:
        c.poly([(-0.64, 1.07), (0.64, 1.07), (0.56, 1.40), (-0.56, 1.40)], M('glass', 0.04))
        c.rect(-0.62, 0.92, 0.62, 0.935, M('chrome', 0.15, 1.0))           # boot chrome strip
    for sg in (-1, 1):
        c.poly([(sg * 0.60, 0.84), (sg * 0.80, 0.85), (sg * 0.80, 1.00), (sg * 0.64, 1.05)], M('red', 0.08))
        c.poly([(sg * 0.64, 0.88), (sg * 0.76, 0.885), (sg * 0.76, 0.93), (sg * 0.65, 0.93)], Mat('#e7e7e3', 0.06, 0.3))
        c.rect(sg * 0.72 - 0.05, 0.30, sg * 0.72 + 0.05, 0.33, M('red', 0.1))
    c.polyline([(-0.60, 0.80), (0.60, 0.80)], M('#1a1a1a', 0.6), 0.004)  # tailgate cut
    c.ellipse(0.0, 1.0, 0.045, 0.03, M('chrome', 0.15, 1.0))
    c.rect(-0.8, 0.22, 0.8, 0.34, M('black', 0.55))
    return c.save(f'car_{kind}_B', noise=0.008)


def top_view(proj, kind='hatch'):
    c = proj.canvas('T', 180, bg=PAINT)
    c.poly([(-0.86, 0.99), (0.86, 0.99), (0.70, 0.56), (-0.70, 0.56)], M('black', 0.3))     # A pillars
    c.poly([(-0.72, 0.985), (0.72, 0.985), (0.62, 0.57), (-0.62, 0.57)], M('glass', 0.04))    # windscreen
    if kind == 'hatch':
        c.poly([(-0.60, -1.87), (0.60, -1.87), (0.62, -1.50), (-0.62, -1.50)], M('glass', 0.04))  # rear window
    else:
        c.poly([(-0.64, -1.44), (0.64, -1.44), (0.62, -0.96), (-0.62, -0.96)], M('glass', 0.04))
    for sg in (-1, 1):
        c.line(sg * 0.05, 1.0, sg * 0.45, 0.94, M('black', 0.5), 0.012)    # wipers
    c.rect(-0.38, 1.0, 0.38, 1.03, M('black', 0.4))                         # cowl vent
    return c.save(f'car_{kind}_T', noise=0.008)


def mirror(sg, paint, black, mirror_m):
    sec = []
    for u, w, zb, zt in ((0.80, 0.07, 1.02, 1.10), (0.74, 0.16, 1.00, 1.12), (0.68, 0.16, 1.00, 1.12)):
        ring = []
        for k in range(10):
            t = 2 * math.pi * k / 10
            ring.append(V(u, sg * (0.90 + w / 2 + w / 2 * math.cos(t)), (zb + zt) / 2 + (zt - zb) / 2 * math.sin(t)))
        sec.append(ring)
    ob = lib.loft('car_mirror', sec, paint, cap0=True, cap1=True, smooth_angle=60)
    lib.assign_faces(ob, mirror_m, lambda c, n: n.y > 0.7)
    arm = lib.box('car_marm', (0.10, 0.08, 0.05), loc=V(0.76, sg * 0.86, 1.02), mat=black)
    return [ob, arm]


def build_car(lod=False, kind='hatch'):
    parts = []
    rear = -1.925 if kind == 'hatch' else -2.07
    if not lod:
        proj = Proj(rear - 0.04, 1.96, -0.92, 0.92, 0.0, 1.56)
        views = {'L': side_view(proj, 'L', kind), 'R': side_view(proj, 'R', kind), 'F': front_view(proj), 'B': rear_view(proj, kind), 'T': top_view(proj, kind)}
        paint = lib.proj_material('car_paint', proj, views, sharp=6.0, grime=0.35, grime_z=(0.2, 0.55), grime_col='#7d6d58')
        black = lib.pbr('car_black', '#121314', 0.55, var=0.05, grime=0.3, grime_z=(0.1, 0.5))
        tyre = lib.pbr('car_tyre', '#1b1b1c', 0.9, var=0.04, grime=0.5, grime_z=(0.0, 0.3), grime_col='#7a6a55', uv_weight=0.6)
        rim = lib.proj_material('car_rim', proj, spoke_canvas(proj, [(FA, RT, 0.19), (RA, RT, 0.19)], 320,
                                Mat('#b4b8bc', 0.3, 0.9), Mat('#18191a', 0.6, 0.2), n=8, twin=False), sharp=8.0)
        mirror_m = lib.pbr('car_mirror_glass', '#b9c0c6', 0.05, 1.0, var=0.0)
        under = lib.pbr('car_under', '#1f2021', 0.8, var=0.1, grime=0.5, grime_z=(0.0, 0.3))
    else:
        paint = black = tyre = rim = mirror_m = under = lib.pbr('car_lod', '#808080')
    parts.append(body(paint, lod, kind))
    for uc in (FA, RA):
        for sg in (-1, 1):
            s = sg * 0.745
            if lod:
                parts.append(lib.cyl('car_tyre', RT, 0.185, loc=V(uc, s, RT), mat=tyre, axis='X', segs=10))
            else:
                parts.append(lib.tyre('car_tyre', RT, 0.185, 0.19, tyre, segs=24, axis='X', loc=V(uc, s, RT)))
                parts.append(lib.disc('car_rim', 0.195, 0.12, rim, segs=24, axis='X', loc=V(uc, s + sg * 0.02, RT), dish=0.015))
    if not lod:
        for sg in (-1, 1):
            parts += mirror(sg, paint, black, mirror_m)
        # under-body pan + wheel-well liners seen through the arches
        parts.append(lib.box('car_pan', (1.5, 3.4, 0.08), loc=V(0.0 if kind == 'hatch' else -0.07, 0, 0.19), mat=under))
        for uc in (FA, RA):
            prof = [(0.33, -0.83), (0.35, -0.83), (0.35, 0.83), (0.33, 0.83), (0.33, -0.83)]
            ob = lib.lathe('car_liner', prof, 12, black, axis='Z', cap=False, arc=(math.radians(95), math.radians(265)), smooth_angle=50)
            ob.data.transform(lib.Matrix.Rotation(math.pi / 2, 4, 'Y'))
            lib.xform(ob, loc=V(uc, 0, RT))
            parts.append(ob)
        fp = lib.box('car_fplate', (0.50, 0.012, 0.12), loc=V(1.935, 0, 0.46))
        lib.set_material(fp, plate_mat('car_fplate_m', 'KA 05 MN 2213', 0.50, 0.12, 1.935, 0.46, 'F', font='arialb'))
        rz = 0.62 if kind == 'hatch' else 0.70
        rp = lib.box('car_rplate', (0.50, 0.012, 0.12), loc=V(rear - 0.005, 0, rz))
        lib.set_material(rp, plate_mat('car_rplate_m', 'KA 05 MN 2213' if kind == 'hatch' else 'KA 41 P 6620', 0.50, 0.12, rear - 0.005, rz, 'B', font='arialb'))
        parts += [fp, rp]
        au, az = (-1.18, 1.49) if kind == 'hatch' else (-0.72, 1.51)
        parts.append(lib.box('car_antenna', (0.02, 0.2, 0.02), loc=V(au, 0, az), mat=black, rot=(math.radians(-20), 0, 0)))
    else:
        for sg in (-1, 1):
            parts.append(lib.box('car_lmirror', (0.14, 0.10, 0.10), loc=V(0.74, sg * 0.97, 1.06), mat=paint))
    return parts


def car():
    bk = lib.Baker('car_hatchback', tex=1024, orm=512, ao_dist=0.5, tinted=True, lod_tex=256)
    bk.add(*build_car())
    return bk.finish(lod=lambda: build_car(lod=True))


def sedan():
    bk = lib.Baker('car_sedan', tex=1024, orm=512, ao_dist=0.5, tinted=True, lod_tex=256)
    bk.add(*build_car(kind='sedan'))
    return bk.finish(lod=lambda: build_car(lod=True, kind='sedan'))


PROPS = {'car_hatchback': car, 'car_sedan': sedan}
