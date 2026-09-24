"""
Furniture and pickups:
  `plastic_chair`   red monobloc chair (Poly Haven "Plastic Monobloc Chair 01", CC0, recoloured + decimated)
  `cafe_table_set`  canteen table (black laminate top, steel pedestal) with four of those chairs
  `ammo_crate`      Poly Haven "Old Military Crate" (CC0), closed crate, decimated and fitted to 0.92 x 0.46 x 0.345 m
  `medkit`          white ABS first-aid case with red cross and a bilingual label
  `sandbags`        three-course sandbag wall, hessian (Poly Haven "hessian_230", CC0) filled with sand
  `pes_globe`       the gold PES armillary globe: original geometry, re-materialled (brushed gold, green-grey stone)
Sources are in tools/blender/_downloads/polyhaven/ (gitignored); licences in README credits.
"""
import math, os, random
import bpy
import lib
from lib import V, Mat, Proj
from mathutils import Vector, Matrix

PH = lib.DOWNLOADS


def recolour_ph_material(mat, rgb, rough_mul=1.0):
    """Multiply an imported Poly Haven material's base colour by rgb (linear) -- e.g. white plastic -> red plastic."""
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bc = bsdf.inputs['Base Color']
    nb = lib.NB(nt)
    if bc.is_linked:
        src = bc.links[0].from_socket
        mixed = nb.mix(1.0, src, rgb, 'MULTIPLY')
        nt.links.new(mixed, bc)
        if mat.name in lib.MATINFO:
            lib.MATINFO[mat.name]['base'] = mixed
    else:
        bc.default_value = (rgb[0], rgb[1], rgb[2], 1)
    lib.MATINFO.setdefault(mat.name, {'metal': 0.0, 'tint': 0.0, 'uv_weight': 1.0})


def monobloc(decimate_ratio, colour='#b3161b'):
    obs = lib.import_gltf(os.path.join(PH, 'plastic_monobloc_chair_01', 'plastic_monobloc_chair_01_1k.gltf'))
    ch = lib.join(obs, 'chair')
    for m in ch.data.materials:
        recolour_ph_material(m, lib.col(colour))
    if decimate_ratio < 1.0:
        lib.decimate(ch, decimate_ratio)
    return ch


def plastic_chair():
    ch = monobloc(0.42)
    bk = lib.Baker('plastic_chair', tex=512, orm=256, ao_dist=0.25)
    bk.add(ch)
    return bk.finish()


def cafe_table_set():
    top_m = lib.pbr('table_top', '#161718', 0.3, var=0.05, var_scale=30, scratch=0.5)
    steel = lib.pbr('table_steel', '#b9bdc0', 0.3, 0.9, var=0.05, grime=0.4, grime_z=(0.0, 0.2))
    P = []
    P.append(lib.box('table_top', (0.80, 0.80, 0.03), loc=(0, 0, 0.745), mat=top_m, bev=0.006, seg=2))
    P.append(lib.box('table_edge', (0.81, 0.81, 0.012), loc=(0, 0, 0.727), mat=steel))
    P.append(lib.cyl('table_col', 0.035, 0.70, loc=(0, 0, 0.37), mat=steel, segs=12))
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        P.append(lib.box('table_foot', (0.34, 0.05, 0.03), loc=(math.cos(a) * 0.17, math.sin(a) * 0.17, 0.02), mat=steel, rot=(0, 0, a)))
    P.append(lib.box('table_under', (0.40, 0.40, 0.02), loc=(0, 0, 0.715), mat=steel))
    base = monobloc(0.26)
    for k, (dx, dy, yaw) in enumerate(((0, -0.64, 0.0), (0.66, 0.02, math.pi / 2), (0.02, 0.66, math.pi), (-0.64, -0.03, -math.pi / 2))):
        c = lib.dup(base, f'chair{k}')
        c.data.transform(Matrix.Rotation(yaw + (k - 1.5) * 0.06, 4, 'Z'))
        c.data.transform(Matrix.Translation((dx, dy, 0)))
        P.append(c)
    bpy.data.objects.remove(base, do_unlink=True)
    bk = lib.Baker('cafe_table_set', tex=512, orm=256, ao_dist=0.3)
    bk.add(*P)
    return bk.finish()


def ammo_crate():
    keep = lambda o: o.name.endswith('_a') and 'cloth' not in o.name
    obs = lib.import_gltf(os.path.join(PH, 'old_military_crate', 'old_military_crate_1k.gltf'), keep=keep)
    cr = lib.join(obs, 'crate')
    # centre on the origin, fit to the station footprint
    xs = [v.co for v in cr.data.vertices]
    mn = Vector([min(c[i] for c in xs) for i in range(3)])
    mx = Vector([max(c[i] for c in xs) for i in range(3)])
    cr.data.transform(Matrix.Translation((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z)))
    sx, sy, sz = 0.92 / (mx.x - mn.x), 0.46 / (mx.y - mn.y), 0.345 / (mx.z - mn.z)
    cr.data.transform(Matrix.Diagonal((sx, sy, sz, 1.0)))
    lib.decimate(cr, 0.22)
    for m in cr.data.materials:
        lib.MATINFO.setdefault(m.name, {'metal': 0.0, 'tint': 0.0, 'uv_weight': 1.0})
    bk = lib.Baker('ammo_crate', tex=512, orm=256, ao_dist=0.2)
    bk.add(cr)
    return bk.finish()


def medkit():
    proj = Proj(-0.10, 0.10, -0.21, 0.21, 0.0, 0.37)
    white = Mat('#eeeeea', 0.35, 0.0)
    f = proj.canvas('F', 1400, bg=white)
    f.rect(-0.04, 0.10, 0.04, 0.24, Mat('#c8141c', 0.3))
    f.rect(-0.07, 0.13, 0.07, 0.21, Mat('#c8141c', 0.3))
    f.text(0.0, 0.070, 'FIRST AID', 0.02, Mat('#c8141c', 0.35), font='arialblack')
    f.stext(0.0, 0.040, 'ಪ್ರಥಮ ಚಿಕಿತ್ಸೆ', 0.026, Mat('#c8141c', 0.35))
    b = proj.canvas('B', 800, bg=white)
    b.rect(-0.09, 0.14, 0.09, 0.28, Mat('#d9d9d4', 0.4), r=0.01)
    case = lib.proj_material('medkit_case', proj, {'F': f.save('medkit_F', noise=0.015), 'B': b.save('medkit_B', noise=0.015)},
                             sharp=3.0, grime=0.35, grime_z=(0.0, 0.12))
    side = lib.pbr('medkit_side', '#e9e9e4', 0.38, var=0.04, scratch=0.3, grime=0.3, grime_z=(0.0, 0.12))
    grey = lib.pbr('medkit_grey', '#5a5e63', 0.4, 0.3)
    dark = lib.pbr('medkit_dark', '#1c1d1f', 0.5)
    P = []
    body = lib.box('medkit_body', (0.38, 0.16, 0.30), loc=(0, 0, 0.16), mat=side, bev=0.025, seg=3, smooth_angle=40)
    lib.assign_faces(body, case, lambda c, n: abs(n.y) > 0.9)
    P.append(body)
    P.append(lib.box('medkit_seam', (0.385, 0.165, 0.012), loc=(0, 0, 0.265), mat=grey, bev=0.004))
    for sg in (-1, 1):
        P.append(lib.box('medkit_latch', (0.04, 0.02, 0.05), loc=(sg * 0.12, -0.085, 0.265), mat=grey, bev=0.006))
        P.append(lib.box('medkit_hinge', (0.05, 0.015, 0.02), loc=(sg * 0.12, 0.085, 0.265), mat=grey))
        P.append(lib.box('medkit_foot', (0.03, 0.12, 0.012), loc=(sg * 0.15, 0, 0.006), mat=dark))
    handle = [Vector((-0.08, 0, 0.31)), Vector((-0.07, 0, 0.35)), Vector((0.07, 0, 0.35)), Vector((0.08, 0, 0.31))]
    P.append(lib.tube('medkit_handle', lib.fillet(handle, 0.02, 3), 0.011, 8, dark))
    bk = lib.Baker('medkit', tex=512, orm=128, ao_dist=0.1)
    bk.add(*P)
    return bk.finish()


def sandbag(name, mat, L=0.56, Wd=0.32, H=0.14, seed=0):
    """Filled bag, ~100 tris: loft of rounded sections along its length, fat in the middle, flat-ish bottom,
    folded end and a pinched tied end."""
    R = random.Random(seed)
    prof = [(-1.0, 0.55, 0.45), (-0.86, 0.9, 0.85), (-0.5, 1.0, 1.0), (0.0, 1.02, 1.04), (0.5, 0.98, 0.98), (0.84, 0.8, 0.75), (1.0, 0.35, 0.3)]
    secs = []
    for t, sw, sh in prof:
        ring = []
        for k in range(8):
            a = 2 * math.pi * k / 8 + math.pi / 8
            c, s = math.cos(a), math.sin(a)
            y = math.copysign(abs(c) ** 0.8, c) * Wd / 2 * sw * (1 + (R.random() - 0.5) * 0.08)
            z = math.copysign(abs(s) ** 0.8, s) * H / 2 * sh
            if z < 0:
                z *= 0.75
            ring.append(Vector((t * L / 2 * (1 - 0.04 * abs(s)), y, z + H * 0.1)))
        secs.append(ring)
    ob = lib.loft(name, secs, mat, cap0=True, cap1=True, smooth_angle=85)
    return ob


def sandbags():
    hess = os.path.join(PH, 'hessian_230', 'diff.jpg')
    m, nt = lib.new_material('sandbag_hessian')
    nb = lib.NB(nt)
    mp = nb.n('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (4.0, 4.0, 4.0)
    nb.set(mp.inputs['Vector'], nb.objco())
    t = nb.n('ShaderNodeTexImage')
    t.image = lib.load_image(hess)
    t.projection = 'BOX'
    t.projection_blend = 0.3
    nb.set(t.inputs['Vector'], mp.outputs['Vector'])
    cur = nb.mix(1.0, t.outputs['Color'], lib.col('#d6c49a'), 'MULTIPLY')
    var = nb.noise(2.5, 3.0, 0.6)
    cur = nb.mix(nb.ramp(var, 0.0, 0.35, 0.3, 0.7), cur, lib.col('#8a7556'))
    z = nb.xyz()[2]
    cur = nb.mix(nb.math('MULTIPLY', nb.ramp(z, 0.8, 0.0, 0.0, 0.35), nb.ramp(nb.noise(6.0, 5.0, 0.7), 0.3, 1.0, 0.3, 0.7)), cur, lib.col('#7a6446'))
    lib._finish_mat(m, nt, nb, cur, 0.92, 0.0)
    P = []
    R = random.Random(7)
    k = 0
    courses = [(0.07, 2, 4, 0.0), (0.205, 2, 4, 0.28), (0.34, 1, 4, 0.0), (0.475, 1, 3, 0.28), (0.61, 1, 3, 0.0)]
    for z, rows, n, off in courses:
        for r in range(rows):
            y = (r - (rows - 1) / 2) * 0.33
            for i in range(n):
                x = (i - (n - 1) / 2) * 0.57 + off - 0.14 + (R.random() - 0.5) * 0.04
                b = sandbag(f'bag{k}', m, seed=k)
                b.data.transform(Matrix.Rotation((R.random() - 0.5) * 0.12, 4, 'Z'))
                b.data.transform(Matrix.Rotation((R.random() - 0.5) * 0.08, 4, 'X'))
                b.data.transform(Matrix.Translation((x, y + (R.random() - 0.5) * 0.03, z)))
                P.append(b)
                k += 1
    bk = lib.Baker('sandbags', tex=512, orm=256, ao_dist=0.25)
    bk.add(*P)
    return bk.finish()


def pes_globe():
    src = os.path.join(lib.WORK, 'src_pes_globe.glb')
    obs = lib.import_gltf(src)
    gold = lib.pbr('globe_gold', '#e0ad45', 0.3, 1.0, var=0.1, var_scale=6, rough_var=0.12, grime=0.35, grime_z=(0.4, 1.6),
                   grime_col='#6b5230')
    letters = lib.pbr('globe_letters', '#ecbd57', 0.24, 1.0, var=0.06, var_scale=8, rough_var=0.08)
    stone_m, nt = lib.new_material('globe_stone')
    nb = lib.NB(nt)
    base = nb.mix(nb.ramp(nb.noise(4.0, 4.0, 0.6), 0.0, 1.0, 0.3, 0.7), lib.col('#46514d'), lib.col('#566260'))
    sp = nb.math('GREATER_THAN', nb.noise(300.0, 2.0, 0.5), 0.68)
    base = nb.mix(nb.math('MULTIPLY', sp, 0.6), base, lib.col('#9aa39f'))
    sp2 = nb.math('GREATER_THAN', nb.noise(420.0, 1.0, 0.5), 0.72)
    base = nb.mix(nb.math('MULTIPLY', sp2, 0.8), base, lib.col('#1e2321'))
    z = nb.xyz()[2]
    g = nb.math('MULTIPLY', nb.ramp(z, 0.7, 0.0, 0.0, 0.25), nb.ramp(nb.noise(6.0, 5.0, 0.7), 0.3, 1.0, 0.3, 0.7))
    base = nb.mix(g, base, lib.col('#6e5f4c'))
    lib._finish_mat(stone_m, nt, nb, base, 0.22, 0.0)
    dark_m = lib.pbr('globe_stone_dark', '#2f3634', 0.3, var=0.06, grime=0.4, grime_z=(0.0, 0.2))
    remap = {'gold': gold, 'gold_letters': letters, 'granite': stone_m, 'granite_dark': dark_m}
    for o in obs:
        for i, m in enumerate(o.data.materials):
            if m is not None and m.name in remap:
                o.data.materials[i] = remap[m.name]
    bk = lib.Baker('pes_globe', tex=1024, orm=512, ao_dist=0.4)
    bk.add(*obs)
    return bk.finish()


PROPS = {'plastic_chair': plastic_chair, 'cafe_table_set': cafe_table_set, 'ammo_crate': ammo_crate, 'medkit': medkit,
         'sandbags': sandbags, 'pes_globe': pes_globe}
