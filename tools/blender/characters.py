"""PESU: Dead Semester - character pipeline (Blender 5.2, headless).

Builds public/models/characters/{male,female}.glb (+ *_lod.glb) from the CC0 Quaternius packs in
tools/blender/_downloads/ (Universal Base Characters [Standard], Universal Animation Library 1 & 2
[Standard]).  Re-runnable:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/characters.py
    optional args after `--`:  --only male|female  --no-render  --no-export  --clips Walk,Run  --no-views

Steps: import body + hair -> rename rig to the contract bone names -> rescale / de-bulk the
"Superhero" body into a normal student build -> tailor clothes (shirt / pants / shoes material
slots with hems) -> retarget + synthesise the contract clips -> export GLB + decimated LOD.
"""
import sys
import os
import re
import math
import json
import time
import subprocess

import bpy
import bmesh
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
DL = os.path.join(HERE, '_downloads')
UBC = os.path.join(DL, 'UBC', 'Universal Base Characters[Standard]')
UAL1_GLB = os.path.join(DL, 'UAL1', 'Animation Library[Standard]', 'Godot', 'AnimationLibrary_Godot_Standard.glb')
UAL2_GLB = os.path.join(DL, 'UAL2', 'Universal Animation Library 2[Standard]', 'Unreal-Godot', 'UAL2_Standard.glb')
OUT_DIR = os.path.join(ROOT, 'public', 'models', 'characters')
RENDER_DIR = os.path.join(HERE, '_renders', 'characters')
TMP_DIR = os.path.join(RENDER_DIR, '_tmp')
FFMPEG = '/opt/homebrew/bin/ffmpeg'
FPS = 24          # source library frame rate (kept to avoid resampling)

BODY = {
    'male': dict(src='Superhero_Male', hair='Hair_SimpleParted', height=1.735),
    'female': dict(src='Superhero_Female', hair='Hair_Long', height=1.600),
}

# default colours (sRGB); the game recolours per instance
COLOURS = {
    'male': dict(skin='b98462', hair='1c1512', shirt='5b7fa6', pants='2e3b52', shoes='e1ded6',
                 accessory='8c1d24', eyes='ffffff'),
    'female': dict(skin='c08a66', hair='17100d', shirt='a83246', pants='2b2833', shoes='5a4a3e',
                   accessory='d4a02f', eyes='ffffff'),
}
ROUGH = dict(skin=0.62, hair=0.5, shirt=0.9, pants=0.92, shoes=0.65, accessory=0.55, eyes=0.25)
MATS = ['skin', 'hair', 'shirt', 'pants', 'shoes', 'accessory', 'eyes']

# UE-style (Universal Base Characters) bone names -> contract names
CONTRACT = {'pelvis': 'Hips', 'spine_01': 'Spine', 'spine_02': 'Spine1', 'spine_03': 'Spine2',
            'neck_01': 'Neck', 'Head': 'Head'}
for s, S in (('l', 'Left'), ('r', 'Right')):
    CONTRACT.update({'clavicle_' + s: S + 'Shoulder', 'upperarm_' + s: S + 'Arm', 'lowerarm_' + s: S + 'ForeArm',
                     'hand_' + s: S + 'Hand', 'thigh_' + s: S + 'UpLeg', 'calf_' + s: S + 'Leg',
                     'foot_' + s: S + 'Foot', 'ball_' + s: S + 'ToeBase'})
    for fsrc, fdst in (('thumb', 'Thumb'), ('index', 'Index'), ('middle', 'Middle'), ('ring', 'Ring'),
                       ('pinky', 'Pinky')):
        for i in (1, 2, 3):
            CONTRACT['%s_0%d_%s' % (fsrc, i, s)] = '%sHand%s%d' % (S, fdst, i)


def ual1_to_ue(n):
    """Universal Animation Library 1 (Godot/Rigify 'DEF-' names) -> UE-style names."""
    if not n.startswith('DEF-'):
        return n
    n = n[4:]
    side = ''
    if n.endswith('.L'):
        side, n = '_l', n[:-2]
    elif n.endswith('.R'):
        side, n = '_r', n[:-2]
    M = {'hips': 'pelvis', 'spine.001': 'spine_01', 'spine.002': 'spine_02', 'spine.003': 'spine_03',
         'neck': 'neck_01', 'head': 'Head', 'shoulder': 'clavicle', 'upper_arm': 'upperarm',
         'forearm': 'lowerarm', 'hand': 'hand', 'thigh': 'thigh', 'shin': 'calf', 'foot': 'foot', 'toe': 'ball'}
    if n in M:
        return M[n] + side
    m = re.match(r'(?:f_)?(index|middle|pinky|ring|thumb)\.0(\d)', n)
    if m:
        return '%s_0%s%s' % (m.group(1), m.group(2), side)
    return n


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    a = dict(only=None, render=True, export=True, clips=None, views=True)
    i = 0
    while i < len(argv):
        k = argv[i]
        if k == '--only':
            a['only'] = argv[i + 1]
            i += 1
        elif k == '--no-render':
            a['render'] = False
        elif k == '--no-export':
            a['export'] = False
        elif k == '--no-views':
            a['views'] = False
        elif k == '--clips':
            a['clips'] = argv[i + 1].split(',')
            i += 1
        i += 1
    return a


# ----------------------------------------------------------------------------------------------
# small math helpers
# ----------------------------------------------------------------------------------------------
def rad(d):
    return math.radians(d)


def clamp(x, a, b):
    return max(a, min(b, x))


def smooth(t):
    t = clamp(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def ease_io(t):
    return 0.5 - 0.5 * math.cos(math.pi * clamp(t, 0, 1))


def keys(t, pts, fn=ease_io):
    if t <= pts[0][0]:
        return pts[0][1]
    for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
        if t <= t1:
            u = fn((t - t0) / (t1 - t0)) if t1 > t0 else 1.0
            return v0 + (v1 - v0) * u
    return pts[-1][1]


def srgb_to_lin(h):
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def closest_on_segment(p, a, b):
    ab = b - a
    t = clamp((p - a).dot(ab) / max(ab.length_squared, 1e-12), 0.0, 1.0)
    return a + ab * t, t


# ----------------------------------------------------------------------------------------------
# scene / import
# ----------------------------------------------------------------------------------------------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = FPS
    return sc


def import_gltf(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path, bone_heuristic='BLENDER')
    new = [o for o in bpy.data.objects if o not in before]
    for o in list(new):
        if o.type == 'MESH' and o.name.startswith('Icosphere'):
            bpy.data.objects.remove(o)
            new.remove(o)
    return new


def import_character(sex):
    cfg = BODY[sex]
    new = import_gltf(os.path.join(UBC, 'Base Characters', 'Godot - UE', cfg['src'] + '_FullBody.gltf'))
    arm = [o for o in new if o.type == 'ARMATURE'][0]
    arm.name = sex + '_rig'
    arm.data.name = sex + '_rig'
    meshes = {}
    for o in new:
        if o.type != 'MESH':
            continue
        if o.name.startswith('Eyes'):
            meshes['eyes'] = o
        elif o.name.startswith('Eyebrows'):
            meshes['brows'] = o
        else:
            meshes['body'] = o
    hnew = import_gltf(os.path.join(UBC, 'Hairstyles', 'Rigged to Head Bone', 'glTF (Godot -Unreal)',
                                    cfg['hair'] + '.gltf'))
    for o in hnew:
        if o.type == 'MESH':
            o.parent = arm
            for m in o.modifiers:
                if m.type == 'ARMATURE':
                    m.object = arm
            meshes['hair'] = o
    for o in hnew:
        if o.type == 'ARMATURE':
            bpy.data.objects.remove(o)
    for o in meshes.values():
        o.parent = arm
        o.matrix_parent_inverse = Matrix.Identity(4)
        me = o.data
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bm.to_mesh(me)
        bm.free()
        clear_custom_normals(o)
    return arm, meshes


def clear_custom_normals(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    try:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    except Exception:
        pass


def rename_and_prune_rig(arm, meshes):
    """Rename to the contract bone names, drop 'root' and the *_leaf end bones."""
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    drop = [b.name for b in eb if b.name == 'root' or 'leaf' in b.name]
    parent_of = {b.name: (b.parent.name if b.parent else None) for b in eb}
    for n in drop:
        for c in eb[n].children:
            c.parent = eb[n].parent if n != 'root' else None
        eb.remove(eb[n])
    bpy.ops.object.mode_set(mode='OBJECT')
    # fold weights of dropped bones into their parents
    for o in meshes.values():
        for n in drop:
            vg = o.vertex_groups.get(n)
            if vg is None:
                continue
            tgt_name = parent_of[n]
            if tgt_name and tgt_name in o.vertex_groups:
                tgt = o.vertex_groups[tgt_name]
                for v in o.data.vertices:
                    for g in v.groups:
                        if g.group == vg.index and g.weight > 0:
                            tgt.add([v.index], g.weight, 'ADD')
            o.vertex_groups.remove(vg)
    for b in arm.data.bones:
        if b.name in CONTRACT:
            b.name = CONTRACT[b.name]
    # vertex groups follow bone renames only for bound meshes; enforce explicitly
    for o in meshes.values():
        for vg in o.vertex_groups:
            if vg.name in CONTRACT:
                vg.name = CONTRACT[vg.name]


def scale_character(arm, meshes, target_h):
    body = meshes['body']
    zs = [v.co.z for v in body.data.vertices]
    k = target_h / (max(zs) - min(zs))
    S = Matrix.Scale(k, 4)
    for o in meshes.values():
        o.data.transform(S)
        o.data.update()
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for b in arm.data.edit_bones:
        b.head = b.head * k
        b.tail = b.tail * k
    bpy.ops.object.mode_set(mode='OBJECT')
    return k


def rest_data(arm):
    B = arm.data.bones
    return {b.name: dict(head=b.head_local.copy(), tail=b.tail_local.copy(), R=b.matrix_local.to_3x3().normalized(),
                         parent=b.parent.name if b.parent else None) for b in B}


# ----------------------------------------------------------------------------------------------
# body shaping: de-bulk the "Superhero" proportions into a normal student build
# ----------------------------------------------------------------------------------------------
SLIM = {
    'male': {'Arm': (0.74, 0.74, 0.74), 'ForeArm': (0.79, 0.79, 0.79), 'Shoulder': (0.82, 0.82, 0.82),
             'Spine2': (0.84, 0.92, 0.96), 'Spine1': (0.90, 0.95, 1.0), 'Spine': (1.02, 0.99, 1.0),
             'Hips': (1.0, 0.98, 1.0), 'Neck': (0.86, 0.86, 1.0), 'UpLeg': (0.90, 0.90, 0.97),
             'Leg': (0.92, 0.92, 1.0)},
    'female': {'Arm': (0.88, 0.88, 0.88), 'ForeArm': (0.94, 0.94, 0.94), 'Shoulder': (0.93, 0.93, 0.93),
               'Spine2': (0.97, 0.88, 1.0), 'Spine1': (1.05, 1.0, 1.0), 'Spine': (1.06, 1.02, 1.0),
               'Hips': (0.95, 0.93, 1.0), 'Neck': (0.95, 0.95, 1.0), 'UpLeg': (0.93, 0.92, 0.98),
               'Leg': (0.96, 0.96, 1.0)},
}
ARM_IN = {'male': 0.022, 'female': 0.008}
HAND_SCALE = {'male': 0.9, 'female': 0.93}


def vgroup_names(obj):
    return {vg.index: vg.name for vg in obj.vertex_groups}


def slim_body(arm, body, sex):
    rest = rest_data(arm)
    names = vgroup_names(body)
    fac = SLIM[sex]
    me = body.data
    arm_chain = ('Arm', 'ForeArm', 'Hand')
    new_co = []
    for v in me.vertices:
        p = v.co.copy()
        d = Vector((0, 0, 0))
        armw = {'Left': 0.0, 'Right': 0.0}
        for g in v.groups:
            bn = names.get(g.group)
            if bn is None or g.weight <= 0:
                continue
            key = bn.replace('Left', '').replace('Right', '')
            side = 'Left' if bn.startswith('Left') else ('Right' if bn.startswith('Right') else None)
            if side and (key in arm_chain or key.startswith('Hand')):
                armw[side] += g.weight
            if key not in fac:
                continue
            c, _ = closest_on_segment(p, rest[bn]['head'], rest[bn]['tail'])
            s = fac[key]
            off = c - p
            d += Vector((off.x * (1 - s[0]), off.y * (1 - s[1]), off.z * (1 - s[2]))) * g.weight
        p += d
        # smaller hands (scale about the wrist)
        for side in ('Left', 'Right'):
            hw = sum(g.weight for g in v.groups if names.get(g.group, '').startswith(side + 'Hand'))
            if hw > 0:
                wr = rest[side + 'Hand']['head']
                p += ((wr + (p - wr) * HAND_SCALE[sex]) - p) * hw
        # narrow the shoulders: pull the whole arm inward
        p.x -= ARM_IN[sex] * armw['Left']
        p.x += ARM_IN[sex] * armw['Right']
        new_co.append(p)
    for v, p in zip(me.vertices, new_co):
        v.co = p
    me.update()
    # move the arm bones with the mesh
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for b in arm.data.edit_bones:
        side = 1 if b.name.startswith('Left') else (-1 if b.name.startswith('Right') else 0)
        key = b.name.replace('Left', '').replace('Right', '')
        if side and (key in arm_chain or key.startswith('Hand')):
            if key.startswith('Hand'):
                wr = rest[('Left' if side > 0 else 'Right') + 'Hand']['head']
                if key != 'Hand':
                    b.head = wr + (b.head - wr) * HAND_SCALE[sex]
                b.tail = wr + (b.tail - wr) * HAND_SCALE[sex]
            b.head.x -= side * ARM_IN[sex]
            b.tail.x -= side * ARM_IN[sex]
        elif side and key == 'Shoulder':
            b.tail.x -= side * ARM_IN[sex]
    bpy.ops.object.mode_set(mode='OBJECT')


def move_meshes_with_arms(arm, meshes, sex):
    """Eyes/brows/hair are head-only; nothing to do (kept for clarity)."""
    return


# ----------------------------------------------------------------------------------------------
# tailoring: shirt / pants / skin split with clean cut lines + hems, feet replaced by shoes
# ----------------------------------------------------------------------------------------------
def face_dominant(f, dl, names):
    acc = {}
    for v in f.verts:
        for gi, w in v[dl].items():
            acc[gi] = acc.get(gi, 0.0) + w
    if not acc:
        return None
    return names.get(max(acc, key=acc.get))


def bisect_faces(bm, faces, co, no):
    geom = set()
    for f in faces:
        geom.add(f)
        geom.update(f.edges)
        geom.update(f.verts)
    if geom:
        bmesh.ops.bisect_plane(bm, geom=list(geom), dist=1e-6, plane_co=co, plane_no=no)


def tailor(arm, body, sex):
    """Returns info dict (landmarks, foot boxes) and leaves material indices:
    0 skin, 2 shirt, 3 pants on the body mesh.  Feet faces are removed."""
    rest = rest_data(arm)
    fem = sex == 'female'
    names = vgroup_names(body)
    me = body.data
    bm = bmesh.new()
    bm.from_mesh(me)
    dl = bm.verts.layers.deform.active
    H = {n: rest[n]['head'] for n in rest}
    T = {n: rest[n]['tail'] for n in rest}
    neck = H['Neck']
    z_hem = (H['LeftUpLeg'].z + 0.005) if not fem else (H['Spine'].z + 0.005)
    z_ankle = H['LeftFoot'].z + 0.028
    sleeve_frac = 0.47 if not fem else 0.92
    # neckline = cylinder around the neck axis with an angle-dependent radius (front / side / back)
    neck_R = (0.080, 0.076, 0.095) if not fem else (0.102, 0.086, 0.095)
    neck_c = Vector((neck.x, neck.y + (0.004 if not fem else 0.0)))

    def neck_radius(c):
        d = Vector((c.x, c.y)) - neck_c
        th = math.atan2(d.x, -d.y)          # 0 = front
        a = abs(th) / math.pi                # 0 front .. 1 back
        R = lerp(neck_R[0], neck_R[1], smooth(a / 0.5)) if a < 0.5 else lerp(neck_R[1], neck_R[2], smooth((a - 0.5) / 0.5))
        return d.length, R, th

    NSEG = 20
    prism = []
    for k in range(NSEG):
        th = 2 * math.pi * (k + 0.5) / NSEG
        n2 = Vector((math.sin(th), -math.cos(th)))
        _, R, _ = neck_radius(Vector((neck_c.x + n2.x * 0.07, neck_c.y + n2.y * 0.07, 0)))
        prism.append((th, Vector((n2.x, n2.y, 0)), Vector((neck_c.x + n2.x * R, neck_c.y + n2.y * R, 0))))

    def sector(c):
        d = Vector((c.x, c.y)) - neck_c
        th = math.atan2(d.x, -d.y) % (2 * math.pi)
        return int(th / (2 * math.pi) * NSEG) % NSEG

    np_co = Vector((neck_c.x, neck_c.y, neck.z - (0.035 if not fem else 0.04)))
    np_n = Vector((0, -0.6, 1)).normalized()

    back_co = Vector((0, 0, neck.z + (0.012 if not fem else 0.004)))

    def in_neckline(c):
        if (c - np_co).dot(np_n) < 0:
            return False
        if c.y > neck_c.y + 0.015 and c.z < back_co.z:
            return False
        q = Vector((c.x, c.y, 0))
        return all((q - P).dot(n) < 0 for _, n, P in prism)

    def dom(f):
        return face_dominant(f, dl, names) or ''

    # --- cuts ---------------------------------------------------------------------------------
    for S in ('Left', 'Right'):
        a, b = H[S + 'Arm'], T[S + 'Arm']
        adir = (b - a).normalized()
        co = a + adir * ((b - a).length * sleeve_frac)
        fs = [f for f in bm.faces if dom(f).startswith(S) and ('Arm' in dom(f)) and
              abs((f.calc_center_median() - co).dot(adir)) < 0.08]
        bisect_faces(bm, fs, co, adir)
    fs = [f for f in bm.faces if abs(f.calc_center_median().z - z_hem) < 0.07 and
          not ('Arm' in dom(f) or 'Hand' in dom(f))]
    bisect_faces(bm, fs, Vector((0, 0, z_hem)), Vector((0, 0, 1)))
    fs = [f for f in bm.faces if abs(f.calc_center_median().z - z_ankle) < 0.06]
    bisect_faces(bm, fs, Vector((0, 0, z_ankle)), Vector((0, 0, 1)))


    # neckline: bisect with a vertical prism approximating the neckline curve
    for k, (th, n, P) in enumerate(prism):
        fs = []
        for f in bm.faces:
            c = f.calc_center_median()
            if c.z < neck.z - 0.22 or c.z > neck.z + 0.12 or 'Arm' in dom(f) or 'Hand' in dom(f):
                continue
            d = Vector((c.x, c.y)) - neck_c
            if d.length < 0.01 or d.length > 0.26:
                continue
            a = math.atan2(d.x, -d.y) % (2 * math.pi)
            da = abs((a - th + math.pi) % (2 * math.pi) - math.pi)
            if da < (math.pi / NSEG) * 2.5:
                fs.append(f)
        bisect_faces(bm, fs, P + Vector((0, 0, neck.z)), n)
    fs = [f for f in bm.faces if (Vector(f.calc_center_median().xy) - neck_c).length < 0.2 and
          -0.22 < f.calc_center_median().z - neck.z < 0.12 and not ('Arm' in dom(f) or 'Hand' in dom(f))]
    bisect_faces(bm, fs, np_co, np_n)
    fs = [f for f in bm.faces if (Vector(f.calc_center_median().xy) - neck_c).length < 0.16 and
          f.calc_center_median().y > neck_c.y - 0.01 and abs(f.calc_center_median().z - back_co.z) < 0.08
          and not ('Arm' in dom(f) or 'Hand' in dom(f))]
    bisect_faces(bm, fs, back_co, Vector((0, 0, 1)))

    # --- classify -------------------------------------------------------------------------------
    labels = {}
    feet_verts = {'Left': [], 'Right': []}
    for f in bm.faces:
        c = f.calc_center_median()
        d = dom(f)
        side = 'Left' if d.startswith('Left') else ('Right' if d.startswith('Right') else None)
        key = d.replace('Left', '').replace('Right', '')
        if key in ('Foot', 'ToeBase') or (key in ('Leg', 'UpLeg') and c.z < z_ankle):
            lab = 'del'
            feet_verts[side or ('Left' if c.x > 0 else 'Right')].extend(v.co.copy() for v in f.verts)
        elif key in ('Arm', 'ForeArm', 'Hand') or key.startswith('Hand'):
            a, b = H[side + 'Arm'], T[side + 'Arm']
            adir = (b - a).normalized()
            t = (c - a).dot(adir) / (b - a).length
            lab = 'shirt' if t < sleeve_frac else 'skin'
        else:
            if in_neckline(c) or c.z > neck.z + 0.10 or (d in ('Head', 'Neck') and c.z > neck.z + 0.025 and c.y < neck_c.y - 0.04):
                lab = 'skin'
            elif c.z > z_hem:
                lab = 'shirt'
            else:
                lab = 'pants'
        labels[f] = lab
    # feet boxes (before deleting)
    boxes = {}
    for s, pts in feet_verts.items():
        if pts:
            boxes[s] = dict(xmin=min(p.x for p in pts), xmax=max(p.x for p in pts), ymin=min(p.y for p in pts),
                            ymax=max(p.y for p in pts), zmax=max(p.z for p in pts))
    bmesh.ops.delete(bm, geom=[f for f, l in labels.items() if l == 'del'], context='FACES')
    labels = {f: l for f, l in labels.items() if f.is_valid}
    MIDX = {'skin': 0, 'shirt': 2, 'pants': 3}
    for f, l in labels.items():
        f.material_index = MIDX[l]

    # --- garment volume with hem ledges ---------------------------------------------------------
    def lab_of(f):
        return labels.get(f, 'skin')
    border = []
    for e in bm.edges:
        if len(e.link_faces) == 2:
            l1, l2 = lab_of(e.link_faces[0]), lab_of(e.link_faces[1])
            if l1 != l2:
                border.append((e, l1, l2))
    rec = []
    keyv = lambda v: (round(v.co.x, 6), round(v.co.y, 6), round(v.co.z, 6))
    for e, l1, l2 in border:
        rec.append((keyv(e.verts[0]), keyv(e.verts[1]), l1, l2))
    bmesh.ops.split_edges(bm, edges=[e for e, _, _ in border])
    # per-region vertex sets
    region = {}
    for f, l in labels.items():
        if not f.is_valid:
            continue
        for v in f.verts:
            region[v] = l
    bm.normal_update()
    # smooth away sculpted muscle definition under the clothes
    for lab, iters, fac in (('shirt', 8, 0.5), ('pants', 4, 0.4)):
        vs = [v for v, l in region.items() if l == lab and not v.is_boundary]
        for _ in range(iters):
            bmesh.ops.smooth_vert(bm, verts=vs, factor=fac, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update()
    knee_z = H['LeftLeg'].z
    lut = {}
    for v, l in region.items():
        lut.setdefault(keyv(v), {})[l] = v
    offs = {}
    for v, l in region.items():
        if l == 'shirt':
            o = 0.010 if not fem else 0.006
        elif l == 'pants':
            if fem:
                o = 0.003
            else:
                o = 0.005 + 0.011 * smooth((knee_z + 0.05 - v.co.z) / (knee_z + 0.05 - z_ankle))
        else:
            continue
        offs[v] = v.normal * o
    for v, o in offs.items():
        v.co += o
    # bridge ledges
    order = {'skin': 0, 'pants': 1, 'shirt': 2}
    for ka, kb, l1, l2 in rec:
        try:
            a1, b1 = lut[ka][l1], lut[kb][l1]
            a2, b2 = lut[ka][l2], lut[kb][l2]
        except KeyError:
            continue
        outer = l1 if order[l1] > order[l2] else l2
        try:
            f = bm.faces.new((a1, b1, b2, a2))
        except ValueError:
            continue
        f.material_index = MIDX[outer]
        f.smooth = False
        f.normal_update()
        ref = (a1.normal + b1.normal + a2.normal + b2.normal)
        if f.normal.dot(ref) < 0:
            f.normal_flip()
    # close the pant cuffs (open tube end at the ankle)
    bm.normal_update()
    cuffs = [e for e in bm.edges if e.is_boundary and abs(e.verts[0].co.z - z_ankle) < 0.03]
    for S, sg in (('Left', 1), ('Right', -1)):
        es = [e for e in cuffs if e.verts[0].co.x * sg > 0]
        vs = list({v for e in es for v in e.verts})
        if len(vs) < 3:
            continue
        c = sum((v.co for v in vs), Vector()) / len(vs)
        cv = bm.verts.new(c - Vector((0, 0, 0.004)))
        cv[dl].clear()
        for gi, w in vs[0][dl].items():
            cv[dl][gi] = w
        for e in es:
            try:
                f = bm.faces.new((e.verts[0], e.verts[1], cv))
                f.material_index = MIDX['pants']
                f.normal_update()
                if f.normal.z > 0:
                    f.normal_flip()
            except ValueError:
                pass
    bm.to_mesh(me)
    bm.free()
    me.update()
    cuff_r = {}
    for S, sg in (('Left', 1), ('Right', -1)):
        pts = [v.co for v in me.vertices if abs(v.co.z - z_ankle) < 0.004 and v.co.x * sg > 0]
        if pts:
            cx = sum(p.x for p in pts) / len(pts)
            cy = sum(p.y for p in pts) / len(pts)
            cuff_r[S] = (Vector((cx, cy, z_ankle)), max((Vector((p.x - cx, p.y - cy))).length for p in pts))
    return dict(z_hem=z_hem, z_ankle=z_ankle, boxes=boxes, cuff=cuff_r)


def ring_pts(center, U, V, a, bf, bb, n=2.0, N=16, ab=None, nb=None):
    pts = []
    for k in range(N):
        th = 2 * math.pi * k / N
        s, c = math.sin(th), math.cos(th)
        ee = 2.0 / (n if (c >= 0 or nb is None) else nb)
        aa = a if ab is None else lerp(a, ab, smooth((0.45 - c) / 0.9))
        x = aa * math.copysign(abs(s) ** ee, s)
        dd = (bf if c >= 0 else bb) * abs(c) ** ee
        y = -dd if c >= 0 else dd
        pts.append(Vector(center) + U * x + V * y)
    return pts


def build_shoes(arm, sex, info):
    """Low-poly sneakers sized to the removed feet; weighted to Foot/ToeBase."""
    rest = rest_data(arm)
    fem = sex == 'female'
    me = bpy.data.meshes.new('shoes')
    bm = bmesh.new()
    dl = bm.verts.layers.deform.verify()
    obj = bpy.data.objects.new('shoes', me)
    bpy.context.scene.collection.objects.link(obj)
    for n in ('LeftFoot', 'LeftToeBase', 'RightFoot', 'RightToeBase'):
        obj.vertex_groups.new(name=n)
    gi = {vg.name: vg.index for vg in obj.vertex_groups}
    X, Zn = Vector((1, 0, 0)), Vector((0, 0, -1))
    for S in ('Left', 'Right'):
        box = info['boxes'][S]
        ball = rest[S + 'ToeBase']['head']
        ankle = rest[S + 'Foot']['head']
        cuff_c, cuff_rad = info['cuff'].get(S, (ankle, 0.05))
        heel = box['ymax'] + 0.012
        toe = box['ymin'] - 0.014
        L = heel - toe
        halfw = (box['xmax'] - box['xmin']) * 0.5 + (0.010 if not fem else 0.006)
        xc = (box['xmax'] + box['xmin']) * 0.5
        top = info['z_ankle'] - 0.006
        # (u along foot 0=heel..1=toe, width factor, z top as fraction of `top`, sole lift)
        prof = [(0.00, 0.62, 0.78, 0.004), (0.06, 0.86, 0.98, 0.0), (0.20, 0.96, 1.0, 0.0),
                (0.36, 1.0, 0.86, 0.0), (0.52, 1.02, 0.68, 0.0), (0.68, 1.02, 0.56, 0.0),
                (0.82, 0.96, 0.49, 0.002), (0.93, 0.78, 0.42, 0.008), (1.0, 0.45, 0.30, 0.016)]
        if fem:
            prof = [(u, w * 0.94, h * 0.86, s) for (u, w, h, s) in prof]
        rings = []
        for (u, wf, hf, lift) in prof:
            y = heel - L * u
            zt = max(top * hf, 0.035)
            zb = lift
            zm = zb + 0.36 * (zt - zb)
            w = halfw * wf
            # contain the pant cuff near the ankle
            if u < 0.4:
                cy = cuff_c.y
                w = max(w, cuff_rad * 0.92)
            pts = ring_pts(Vector((xc, y, zm)), X, Zn, w, zt - zm, zm - zb, 2.4, 14, nb=7.0, ab=w * 1.04)
            for p in pts:
                p.z = max(p.z, zb)
            ring = []
            for p in pts:
                v = bm.verts.new(p)
                t = smooth((ball.y + 0.03 - p.y) / 0.05)
                v[dl][gi[S + 'Foot']] = 1 - t
                if t > 0:
                    v[dl][gi[S + 'ToeBase']] = t
                ring.append(v)
            rings.append(ring)
        for r0, r1 in zip(rings, rings[1:]):
            for k in range(14):
                j = (k + 1) % 14
                f = bm.faces.new((r0[k], r0[j], r1[j], r1[k]))
                f.smooth = True
        for ring, end in ((rings[0], 1), (rings[-1], -1)):
            c = sum((v.co for v in ring), Vector()) / len(ring)
            cv = bm.verts.new(c + Vector((0, 0.008 * end, 0)))
            for g, w in ring[0][dl].items():
                cv[dl][g] = w
            for k in range(14):
                f = bm.faces.new((ring[k], ring[(k + 1) % 14], cv))
                f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return obj


def build_kurti(arm, body, info):
    """Flared kurti skirt (waist -> mid-thigh) with side slits, fitted around the body."""
    rest = rest_data(arm)
    H = {n: rest[n]['head'] for n in rest}
    me_b = body.data
    z_hip = H['LeftUpLeg'].z
    z_top = H['Spine1'].z - 0.01
    z_w = info['z_hem'] + 0.01
    z_bot = z_hip - 0.25
    zs = [z_top, z_w, lerp(z_w, z_hip, 0.55), z_hip - 0.03, lerp(z_hip - 0.03, z_bot, 0.5), z_bot]
    clear = [-0.002, 0.004, 0.011, 0.016, 0.020, 0.026]
    N = 32
    cyc = sum(v.co.y for v in me_b.vertices if abs(v.co.z - z_hip) < 0.02) / max(1, sum(
        1 for v in me_b.vertices if abs(v.co.z - z_hip) < 0.02))
    center = Vector((0, cyc))
    prev_r = None
    rings_r = []
    for zi, z in enumerate(zs):
        pts = [Vector((v.co.x, v.co.y)) for v in me_b.vertices if abs(v.co.z - z) < 0.025 and abs(v.co.x) < 0.3]
        rr = []
        for k in range(N):
            th = 2 * math.pi * k / N
            d = Vector((math.sin(th), -math.cos(th)))
            # support function of the cross-section (convex hull extent) in direction d
            ext = max(((p - center).dot(d) for p in pts), default=0.12)
            rr.append(ext + clear[zi])
        # smooth around the ring
        for _ in range(2):
            rr = [(rr[k - 1] + 2 * rr[k] + rr[(k + 1) % N]) / 4 for k in range(N)]
        if prev_r and zi >= 3:
            rr = [max(r, p - 0.002) for r, p in zip(rr, prev_r)]
        prev_r = rr
        rings_r.append(rr)
    me = bpy.data.meshes.new('kurti')
    obj = bpy.data.objects.new('kurti', me)
    bpy.context.scene.collection.objects.link(obj)
    for n in ('Hips', 'Spine', 'LeftUpLeg', 'RightUpLeg'):
        obj.vertex_groups.new(name=n)
    gi = {vg.name: vg.index for vg in obj.vertex_groups}
    bm = bmesh.new()
    dl = bm.verts.layers.deform.verify()
    legw = [0.0, 0.0, 0.1, 0.45, 0.75, 0.92]

    def mk(p, zi):
        v = bm.verts.new(p)
        fl = smooth((p.x + 0.05) / 0.10)
        lw = legw[zi]
        if zi == 0:
            v[dl][gi['Spine']] = 1.0
        elif zi == 1:
            v[dl][gi['Spine']] = 0.4
            v[dl][gi['Hips']] = 0.6
        else:
            v[dl][gi['Hips']] = 1 - lw
            if lw * fl > 1e-4:
                v[dl][gi['LeftUpLeg']] = lw * fl
            if lw * (1 - fl) > 1e-4:
                v[dl][gi['RightUpLeg']] = lw * (1 - fl)
        return v
    outer, inner = [], []
    for zi, z in enumerate(zs):
        ro, ri = [], []
        for k in range(N):
            th = 2 * math.pi * k / N
            d = Vector((math.sin(th), -math.cos(th), 0))
            p = Vector((center.x, center.y, z)) + d * rings_r[zi][k]
            ro.append(mk(p, zi))
            ri.append(mk(Vector((center.x, center.y, z)) + d * (rings_r[zi][k] - 0.004), zi))
        outer.append(ro)
        inner.append(ri)
    slit = lambda zi, k: zi >= 3 and k in (7, 8, 23, 24)
    for zi in range(len(zs) - 1):
        for k in range(N):
            j = (k + 1) % N
            if slit(zi, k):
                continue
            f = bm.faces.new((outer[zi][k], outer[zi][j], outer[zi + 1][j], outer[zi + 1][k]))
            f.material_index = 0
            f.smooth = True
            if zi >= 2:
                g = bm.faces.new((inner[zi + 1][k], inner[zi + 1][j], inner[zi][j], inner[zi][k]))
                g.smooth = True
    last = len(zs) - 1
    for k in range(N):
        if slit(last - 1, k):
            continue
        j = (k + 1) % N
        f = bm.faces.new((outer[last][j], outer[last][k], inner[last][k], inner[last][j]))
        f.smooth = True
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    inner_set = set(v for r in inner for v in r if v.is_valid)
    bm.normal_update()
    for f in bm.faces:
        c = f.calc_center_median()
        radial = Vector((c.x - center.x, c.y - center.y, 0))
        ins = sum(1 for v in f.verts if v in inner_set)
        if ins == len(f.verts):
            want = -radial
        elif ins == 0:
            want = radial
        else:
            want = Vector((0, 0, -1))
        if f.normal.dot(want) < 0:
            f.normal_flip()
    bm.to_mesh(me)
    bm.free()
    return obj


# ----------------------------------------------------------------------------------------------
# materials / join
# ----------------------------------------------------------------------------------------------
def find_image(obj, contains=None):
    for m in obj.data.materials:
        if m and m.node_tree:
            for n in m.node_tree.nodes:
                if n.type == 'TEX_IMAGE' and n.image and (contains is None or contains.lower() in n.image.name.lower()):
                    if 'normal' in n.image.name.lower() or 'rough' in n.image.name.lower():
                        continue
                    return n.image
    return None


def neutral_texture(img, size, out_path, balance=True, target=0.82):
    """Downscale and (optionally) white-balance a base-colour map so the material colour sets the tone."""
    import numpy as np
    im = img.copy()
    im.scale(size, size)
    px = np.empty(size * size * 4, dtype=np.float32)
    im.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    if balance:
        rgb = px[:, :3]
        lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        mask = (lum > 0.08) & (px[:, 3] > 0.5)
        mean = rgb[mask].mean(axis=0)
        rgb = rgb / mean * target
        px[:, :3] = np.clip(rgb, 0, 1)
    im.pixels.foreach_set(px.ravel())
    im.filepath_raw = out_path
    im.file_format = 'JPEG'
    bpy.context.scene.render.image_settings.quality = 90
    im.save_render(out_path)
    out = bpy.data.images.load(out_path, check_existing=False)
    out.name = os.path.basename(out_path)
    bpy.data.images.remove(im)
    return out


def make_material(name, colour_hex, image=None, rough=0.7):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    col = srgb_to_lin(colour_hex) + [1.0]
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = 0.0
    m.diffuse_color = col
    if image is None:
        bsdf.inputs['Base Color'].default_value = col
    else:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = image
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs['B'].default_value = col
        nt.links.new(tex.outputs['Color'], mix.inputs['A'])
        nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    return m


def build_materials(sex, meshes):
    os.makedirs(TMP_DIR, exist_ok=True)
    C = COLOURS[sex]
    skin_src = None
    for img in bpy.data.images:
        n = img.name.lower()
        if 'superhero' in n and 'normal' not in n and 'rough' not in n:
            skin_src = img
    skin_img = neutral_texture(skin_src, 1024, os.path.join(TMP_DIR, '%s_skin.jpg' % sex), True, 0.84)
    hair_src = find_image(meshes['hair'])
    hair_img = neutral_texture(hair_src, 512, os.path.join(TMP_DIR, '%s_hair.jpg' % sex), True, 0.9)
    eye_src = find_image(meshes['eyes'])
    eye_img = neutral_texture(eye_src, 256, os.path.join(TMP_DIR, '%s_eyes.jpg' % sex), False)
    mats = {}
    for n in MATS:
        img = {'skin': skin_img, 'hair': hair_img, 'eyes': eye_img}.get(n)
        mats[n] = make_material(n, C[n], img, ROUGH[n])
    return mats


def assign_and_join(arm, parts, mats):
    """parts: list of (obj, fixed_slot or None).  Body keeps its per-face indices (0 skin 2 shirt 3 pants)."""
    order = [mats[n] for n in MATS]
    for obj, slot in parts:
        me = obj.data
        # one UV map named UVMap, no colour attributes (keeps the GLB lean)
        while len(me.uv_layers) > 1:
            me.uv_layers.remove(me.uv_layers[-1])
        if len(me.uv_layers) == 0:
            me.uv_layers.new(name='UVMap')
        me.uv_layers[0].name = 'UVMap'
        for ca in list(me.color_attributes):
            me.color_attributes.remove(ca)
        old = [p.material_index for p in me.polygons]
        me.materials.clear()
        for m in order:
            me.materials.append(m)
        for p, oi in zip(me.polygons, old):
            p.material_index = MATS.index(slot) if slot else oi
    body = parts[0][0]
    bpy.ops.object.select_all(action='DESELECT')
    for obj, _ in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body.name = arm.name.replace('_rig', '')
    body.data.name = body.name
    body.parent = arm
    body.matrix_parent_inverse = Matrix.Identity(4)
    mods = [m for m in body.modifiers if m.type == 'ARMATURE']
    if not mods:
        m = body.modifiers.new('Armature', 'ARMATURE')
        mods = [m]
    mods[0].object = arm
    # tidy weights
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.001)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    return body


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# ----------------------------------------------------------------------------------------------
# rendering
# ----------------------------------------------------------------------------------------------
def setup_render(sc, w=700, h=900, engine='EEVEE'):
    sc.render.engine = 'BLENDER_EEVEE' if engine == 'EEVEE' else 'BLENDER_WORKBENCH'
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    if sc.world is None:
        sc.world = bpy.data.worlds.new('World')
        sc.world.use_nodes = True
        bg = sc.world.node_tree.nodes['Background']
        bg.inputs[0].default_value = (0.55, 0.57, 0.6, 1)
        bg.inputs[1].default_value = 0.9
    if 'Sun' not in bpy.data.objects:
        sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
        sc.collection.objects.link(sun)
        sun.data.energy = 3.2
        sun.data.angle = rad(8)
        sun.rotation_euler = (rad(48), 0, rad(35))
    if 'Ground' not in bpy.data.objects:
        bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
        g = bpy.context.active_object
        g.name = 'Ground'
        gm = bpy.data.materials.new('ground')
        gm.use_nodes = True
        gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.32, 0.31, 1)
        g.data.materials.append(gm)
    cam = bpy.data.objects.get('Cam')
    if cam is None:
        cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
        sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def aim_camera(cam, target, direction, dist=8.0, ortho=None, lens=85):
    direction = Vector(direction).normalized()
    cam.location = Vector(target) + direction * dist
    cam.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
    if ortho:
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = ortho
    else:
        cam.data.type = 'PERSP'
        cam.data.lens = lens


def render_to(sc, path):
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def tile(images, out, cols):
    images = [i for i in images if os.path.exists(i)]
    if not images:
        return
    n = len(images)
    args = [FFMPEG, '-y', '-loglevel', 'error']
    for im in images:
        args += ['-i', im]
    if n == 1:
        args += [out]
    else:
        pos = []
        for i in range(n):
            c, r = i % cols, i // cols
            pos.append(('+'.join(['w0'] * c) if c else '0') + '_' + ('+'.join(['h0'] * r) if r else '0'))
        inputs = ''.join('[%d:v]' % i for i in range(n))
        args += ['-filter_complex', '%sxstack=inputs=%d:layout=%s:fill=black' % (inputs, n, '|'.join(pos)), out]
    subprocess.run(args, check=False)


def render_rest_views(sc, name, height):
    cam = setup_render(sc, 560, 900)
    tgt = Vector((0, 0, height * 0.52))
    files = []
    for vn, d in (('front', (0, -1, 0.06)), ('left', (1, 0, 0.06)), ('threeq', (0.75, -1, 0.14)),
                  ('back', (0.3, 1, 0.16))):
        aim_camera(cam, tgt, d, 8.0, ortho=height * 1.18)
        f = os.path.join(TMP_DIR, '%s_rest_%s.png' % (name, vn))
        render_to(sc, f)
        files.append(f)
    tile(files, os.path.join(RENDER_DIR, '%s_rest_sheet.png' % name), 4)
    cam = setup_render(sc, 560, 560)
    hf = []
    for vn, d in (('front', (0, -1, 0.02)), ('threeq', (0.8, -1, 0.1)), ('side', (1, 0, 0.05)),
                  ('back', (0.5, 1, 0.35))):
        aim_camera(cam, Vector((0, 0, height - 0.13)), d, 3.0, ortho=0.42)
        f = os.path.join(TMP_DIR, '%s_head_%s.png' % (name, vn))
        render_to(sc, f)
        hf.append(f)
    tile(hf, os.path.join(RENDER_DIR, '%s_head_sheet.png' % name), 4)
    # over-the-shoulder style view (third-person camera)
    cam = setup_render(sc, 900, 600)
    cam.location = Vector((0.55, 2.6, 1.85))
    cam.rotation_euler = (Vector((0, 0, 1.25)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.type = 'PERSP'
    cam.data.lens = 35
    render_to(sc, os.path.join(RENDER_DIR, '%s_ots.png' % name))


# ----------------------------------------------------------------------------------------------
# animation core: sampling the UAL libraries, retargeting, FK/IK pose editing, keyframing
# ----------------------------------------------------------------------------------------------
class Rig:
    """Rest data of the target armature (contract bone names)."""
    def __init__(self, arm):
        B = arm.data.bones
        self.names = [b.name for b in B]
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in B}
        self.R = {b.name: b.matrix_local.to_3x3().normalized() for b in B}
        self.H = {b.name: b.head_local.copy() for b in B}
        self.children = {}
        for b in B:
            if b.parent:
                self.children.setdefault(b.parent.name, []).append(b.name)
        order, stack = [], [b.name for b in B if b.parent is None]
        while stack:
            n = stack.pop(0)
            order.append(n)
            stack.extend(self.children.get(n, []))
        self.order = order
        self.root = order[0]
        self.off = {}
        for n in order:
            p = self.parent[n]
            if p:
                self.off[n] = self.R[p].transposed() @ (self.H[n] - self.H[p])

    def rest_local(self, b):
        p = self.parent[b]
        return self.R[b].copy() if p is None else self.R[p].transposed() @ self.R[b]


class Pose:
    """Local rotations L (W_child = W_parent @ L_child) + root head position."""
    def __init__(self, rig, L=None, root=None):
        self.rig = rig
        self.L = {b: (L[b].copy() if L and b in L else rig.rest_local(b)) for b in rig.order}
        self.root = (root.copy() if root is not None else rig.H[rig.root].copy())
        self._W, self._X = {}, {}

    def copy(self):
        return Pose(self.rig, self.L, self.root)

    def dirty(self):
        self._W.clear()
        self._X.clear()

    def W(self, b):
        if b not in self._W:
            p = self.rig.parent[b]
            self._W[b] = self.L[b] if p is None else self.W(p) @ self.L[b]
        return self._W[b]

    def X(self, b):
        if b not in self._X:
            p = self.rig.parent[b]
            self._X[b] = self.root.copy() if p is None else self.X(p) + self.W(p) @ self.rig.off[b]
        return self._X[b]

    def set_W(self, b, W):
        p = self.rig.parent[b]
        self.L[b] = W.copy() if p is None else self.W(p).transposed() @ W
        self.dirty()

    def rotate_world(self, b, M, about_parent=False):
        """Apply a world-space rotation M to bone b (children follow)."""
        self.set_W(b, M @ self.W(b))

    def basis(self):
        r = self.rig
        out = {}
        for b in r.order:
            p = r.parent[b]
            m = r.R[b].transposed() @ self.L[b] if p is None else r.R[b].transposed() @ r.R[p] @ self.L[b]
            out[b] = m.to_quaternion().normalized()
        loc = r.R[r.root].transposed() @ (self.root - r.H[r.root])
        return out, loc


def blend_pose(a, b, t, bones=None):
    """Slerp local rotations (and lerp root) from a to b."""
    out = a.copy()
    for n in (bones or a.rig.order):
        qa = a.L[n].to_quaternion()
        qb = b.L[n].to_quaternion()
        out.L[n] = qa.slerp(qb, t).to_matrix()
    out.root = a.root.lerp(b.root, t)
    out.dirty()
    return out


def frame3(h, d):
    h = h.normalized()
    d = (d - h * h.dot(d)).normalized()
    return Matrix((h, d, h.cross(d))).transposed()


def two_bone_ik(pose, upper, lower, end, target, pole, pole_rest, reach=0.9995):
    """Place `end`'s head at target by rotating upper & lower; knee/elbow toward `pole`."""
    r = pose.rig
    A = pose.X(upper)
    L1 = (r.H[lower] - r.H[upper]).length
    L2 = (r.H[end] - r.H[lower]).length
    d1r = (r.H[lower] - r.H[upper]).normalized()
    d2r = (r.H[end] - r.H[lower]).normalized()
    hr = d1r.cross(pole_rest)
    hr.normalize()
    v = Vector(target) - A
    D = clamp(v.length, abs(L1 - L2) + 1e-4, (L1 + L2) * reach)
    u = v.normalized()
    pv = pole - u * u.dot(pole)
    if pv.length < 1e-6:
        pv = pole_rest - u * u.dot(pole_rest)
    pv.normalize()
    ca = clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1)
    sa = math.sqrt(max(0.0, 1 - ca * ca))
    K = A + (u * ca + pv * sa) * L1
    T = A + u * D
    d1 = (K - A).normalized()
    d2 = (T - K).normalized()
    h = u.cross(pv).normalized()
    W1 = frame3(h, d1) @ frame3(hr, d1r).transposed() @ r.R[upper]
    W2 = frame3(h, d2) @ frame3(hr, d2r).transposed() @ r.R[lower]
    pose.set_W(upper, W1)
    pose.set_W(lower, W2)
    return K


def arm_ik(pose, side, wrist, pole):
    return two_bone_ik(pose, side + 'Arm', side + 'ForeArm', side + 'Hand', wrist, Vector(pole).normalized(),
                       Vector((0, 1, 0)))


def leg_ik(pose, side, ankle, pole):
    return two_bone_ik(pose, side + 'UpLeg', side + 'Leg', side + 'Foot', ankle, Vector(pole).normalized(),
                       Vector((0, -1, 0)))


def twist_share(pose, forearm, hand, share=0.5):
    """Move part of the hand's twist about the forearm axis into the forearm (less wrist candy-wrap)."""
    r = pose.rig
    Wf = pose.W(forearm)
    Wh = pose.W(hand)
    axis = (pose.X(hand) - pose.X(forearm)).normalized()
    neutral = Wf @ r.rest_local(hand)
    q = (Wh @ neutral.transposed()).to_quaternion()
    pr = Vector((q.x, q.y, q.z))
    proj = axis * pr.dot(axis)
    tw = Quaternion((q.w, proj.x, proj.y, proj.z))
    if tw.magnitude < 1e-8:
        return
    tw.normalize()
    ang = 2 * math.atan2(Vector((tw.x, tw.y, tw.z)).dot(axis), tw.w)
    ang = (ang + math.pi) % (2 * math.pi) - math.pi
    pose.set_W(forearm, Matrix.Rotation(ang * share, 3, axis) @ Wf)
    pose.set_W(hand, Wh)


class Library:
    """Samples UAL clips (both libraries) into target-rig Poses via rest-offset retargeting."""
    def __init__(self, rig, sc):
        self.rig = rig
        self.sc = sc
        self.src = {}
        self.cache = {}
        for tag, path in (('ual1', UAL1_GLB), ('ual2', UAL2_GLB)):
            before_actions = set(bpy.data.actions)
            new = import_gltf(path)
            arm = [o for o in new if o.type == 'ARMATURE'][0]
            for o in new:
                if o.type == 'MESH':
                    bpy.data.objects.remove(o)
            acts = {}
            for a in bpy.data.actions:
                if a not in before_actions:
                    base = re.sub(r'\.\d{3}$', '', a.name)
                    acts[base] = a
            names = {}
            for b in arm.data.bones:
                ue = ual1_to_ue(b.name)
                if ue in CONTRACT:
                    names[b.name] = CONTRACT[ue]
            Rs = {names[b.name]: b.matrix_local.to_3x3().normalized() for b in arm.data.bones if b.name in names}
            Hs = {names[b.name]: b.head_local.copy() for b in arm.data.bones if b.name in names}
            self.src[tag] = dict(arm=arm, acts=acts, names=names, R=Rs, H=Hs)

    def has(self, tag, name):
        return name in self.src[tag]['acts']

    def clip(self, tag, name):
        key = (tag, name)
        if key in self.cache:
            return [p.copy() for p in self.cache[key]]
        S = self.src[tag]
        arm, act = S['arm'], S['acts'][name]
        ad = arm.animation_data or arm.animation_data_create()
        ad.action = act
        if len(act.slots):
            ad.action_slot = act.slots[0]
        f0, f1 = int(round(act.frame_range[0])), int(round(act.frame_range[1]))
        r = self.rig
        k = r.H['Hips'].z / S['H']['Hips'].z
        poses = []
        for f in range(f0, f1 + 1):
            self.sc.frame_set(f)
            W = {}
            X = None
            for pb in arm.pose.bones:
                dst = S['names'].get(pb.name)
                if not dst or dst not in r.R:
                    continue
                M = pb.matrix
                W[dst] = M.to_3x3().normalized() @ S['R'][dst].transposed() @ r.R[dst]
                if dst == 'Hips':
                    X = M.to_translation()
            p = Pose(r)
            for b in r.order:
                if b in W:
                    p.set_W(b, W[b])
                else:
                    p.set_W(b, (p.W(r.parent[b]) @ r.rest_local(b)) if r.parent[b] else r.R[b])
            hs = S['H']['Hips']
            p.root = r.H['Hips'] + Vector(((X.x - hs.x) * k, (X.y - hs.y) * k, (X.z - hs.z) * k))
            p.dirty()
            poses.append(p)
        ad.action = None
        self.cache[key] = poses
        return [p.copy() for p in poses]

    def cleanup(self):
        for S in self.src.values():
            bpy.data.objects.remove(S['arm'])


def write_action(arm_obj, name, poses, bones):
    act = bpy.data.actions.get(name)
    if act:
        bpy.data.actions.remove(act)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ad = arm_obj.animation_data or arm_obj.animation_data_create()
    ad.action = act
    n = len(poses)
    frames = [p.basis() for p in poses]
    prev = {}
    seq = {b: [] for b in bones}
    for basis, loc in frames:
        for b in bones:
            q = basis[b]
            if b in prev and prev[b].dot(q) < 0:
                q = -q
            prev[b] = q
            seq[b].append(q)
    for b in bones:
        path = 'pose.bones["%s"].rotation_quaternion' % b
        for i in range(4):
            fc = act.fcurve_ensure_for_datablock(arm_obj, path, index=i, group_name=b)
            fc.keyframe_points.add(n)
            co = []
            for f in range(n):
                co += [float(f), seq[b][f][i]]
            fc.keyframe_points.foreach_set('co', co)
            fc.keyframe_points.foreach_set('interpolation', [1] * n)
            fc.update()
    root = bones[0]
    path = 'pose.bones["%s"].location' % root
    for i in range(3):
        fc = act.fcurve_ensure_for_datablock(arm_obj, path, index=i, group_name=root)
        fc.keyframe_points.add(n)
        co = []
        for f in range(n):
            co += [float(f), frames[f][1][i]]
        fc.keyframe_points.foreach_set('co', co)
        fc.keyframe_points.foreach_set('interpolation', [1] * n)
        fc.update()
    act.use_frame_range = True
    act.frame_start = 0
    act.frame_end = max(1, n - 1)
    ad.action = None
    return act


def set_action(arm_obj, act):
    ad = arm_obj.animation_data or arm_obj.animation_data_create()
    ad.action = act
    if act is not None and len(act.slots):
        ad.action_slot = act.slots[0]


def foot_speed(poses):
    """Median planted-foot sliding speed (m/s) and travel direction from the ball joints."""
    vels, dirs = [], Vector((0, 0, 0))
    for s in ('Left', 'Right'):
        P = [p.X(s + 'ToeBase') for p in poses]
        zmin = min(q.z for q in P)
        if zmin > 0.08:
            continue
        for a, b in zip(P, P[1:]):
            if a.z < zmin + 0.012 and b.z < zmin + 0.012:
                v = (b - a) * FPS
                v.z = 0
                vels.append(v.length)
                dirs += v
    if len(vels) < 3:
        return 0.0, (0.0, 0.0)
    vels.sort()
    d = -dirs.normalized() if dirs.length > 1e-6 else Vector()
    return vels[len(vels) // 2], (round(d.x, 2), round(d.y, 2))


# ----------------------------------------------------------------------------------------------
# clip construction
# ----------------------------------------------------------------------------------------------
UPPER = None     # set per rig: spine/neck/head/arms/fingers
LOWER = None     # hips + legs


def split_sets(rig):
    lower = {'Hips'}
    for s in ('Left', 'Right'):
        lower |= {s + 'UpLeg', s + 'Leg', s + 'Foot', s + 'ToeBase'}
    upper = set(rig.order) - lower
    return upper, lower


def resample(poses, n_out, loop=False):
    """Time-resample a pose list to n_out frames (slerp)."""
    n = len(poses)
    out = []
    for i in range(n_out):
        t = i * (n - 1) / max(1, n_out - 1)
        a = int(math.floor(t))
        b = min(n - 1, a + 1)
        out.append(blend_pose(poses[a], poses[b], t - a))
    return out


def layer(lower_poses, upper_poses, upper_set, stabilize=1.0, ref_bone='Spine2'):
    """Legs/hips from lower_poses, spine+arms from upper_poses (cycled), optionally keeping the chest's
    world orientation from the upper source (weapon aim stays steady while the hips move)."""
    out = []
    nu = len(upper_poses)
    for i, lp in enumerate(lower_poses):
        up = upper_poses[i % nu]
        p = lp.copy()
        for b in upper_set:
            p.L[b] = up.L[b].copy()
        p.dirty()
        if stabilize > 0:
            want = up.W(ref_bone)
            have = p.W(ref_bone)
            corr = (want @ have.transposed()).to_quaternion()
            corr = Quaternion().slerp(corr, stabilize).to_matrix()
            p.rotate_world('Spine', corr)
        out.append(p)
    return out


def loopify(poses, blend_frames=4):
    """Make the last frame equal the first by distributing the mismatch over the tail."""
    n = len(poses)
    if n < 3:
        return poses
    out = [p.copy() for p in poses]
    first = poses[0]
    for i in range(max(0, n - blend_frames), n):
        t = (i - (n - blend_frames - 1)) / blend_frames
        out[i] = blend_pose(poses[i], first, clamp(t, 0, 1))
    return out


def spine_bend(p, pitch=0.0, yaw=0.0, roll=0.0, dist=(0.3, 0.35, 0.35)):
    """World-axis bend distributed over the spine (pitch>0 forward, yaw>0 left)."""
    for b, w in zip(('Spine', 'Spine1', 'Spine2'), dist):
        M = (Matrix.Rotation(yaw * w, 3, 'Z') @ Matrix.Rotation(roll * w, 3, 'Y') @
             Matrix.Rotation(-pitch * w, 3, 'X'))
        p.rotate_world(b, M)


def head_turn(p, pitch=0.0, yaw=0.0, roll=0.0, neck_share=0.4):
    for b, w in (('Neck', neck_share), ('Head', 1 - neck_share)):
        M = (Matrix.Rotation(yaw * w, 3, 'Z') @ Matrix.Rotation(roll * w, 3, 'Y') @
             Matrix.Rotation(-pitch * w, 3, 'X'))
        p.rotate_world(b, M)


def hips_yaw(p):
    Rrest = p.rig.R['Hips']
    f = (p.W('Hips') @ Rrest.transposed()) @ Vector((0, -1, 0))
    return math.atan2(f.x, -f.y)


def neutralize(poses, mode):
    """'body': turn the whole character so the mean hips yaw faces forward (static stances).
    'hips': make the pelvis face forward, keep the upper body (aim) and re-plant the feet (weapon clips, so
    they layer cleanly over locomotion hips in-game)."""
    out = []
    if mode == 'body':
        m = sum(hips_yaw(p) for p in poses) / len(poses)
        Rz = Matrix.Rotation(-m, 3, 'Z')
        for p in poses:
            q = p.copy()
            q.root = Rz @ q.root
            q.L['Hips'] = Rz @ q.L['Hips']
            q.dirty()
            out.append(q)
        return out
    for p in poses:
        q = p.copy()
        y = hips_yaw(q)
        feet = {}
        for s in ('Left', 'Right'):
            A, K, T = q.X(s + 'UpLeg'), q.X(s + 'Leg'), q.X(s + 'Foot')
            u = (T - A).normalized()
            kp = (K - A) - u * (K - A).dot(u)
            feet[s] = (T, q.W(s + 'Foot'), q.W(s + 'ToeBase'), kp * 20.0)
        chest = q.W('Spine')
        q.rotate_world('Hips', Matrix.Rotation(-y, 3, 'Z'))
        q.set_W('Spine', chest)
        for s, (ank, Wf, Wt, kd) in feet.items():
            leg_ik(q, s, ank, kd + Vector((0, -0.15, 0)))
            q.set_W(s + 'Foot', Wf)
            q.set_W(s + 'ToeBase', Wt)
        out.append(q)
    return out


def clip_direct(lib, tag, name, speed=1.0):
    ps = lib.clip(tag, name)
    if abs(speed - 1.0) > 1e-3:
        ps = resample(ps, max(2, int(round((len(ps) - 1) / speed)) + 1))
    return ps


# ----------------------------------------------------------------------------------------------
# weapon sockets + hand helpers
# ----------------------------------------------------------------------------------------------
SOCKET_AIM = Matrix(((-1, 0, 0), (0, 0, 1), (0, 1, 0)))     # columns X,Y,Z: -Z = forward(-Y), +Y = up(+Z)


def gun_frame(fwd, up):
    """Blender-space frame for a weapon node: local -Z along fwd, local +Y along up (glTF convention)."""
    f = Vector(fwd).normalized()
    u = Vector(up)
    u = (u - f * f.dot(u)).normalized()
    return Matrix((f.cross(u), u, -f)).transposed()


def fist_center(p, side):
    pts = [p.X('%sHand%s%d' % (side, f, i)) for f in ('Index', 'Middle', 'Ring', 'Pinky') for i in (1, 3)]
    return sum(pts, Vector()) / len(pts)


def calibrate_and_add_sockets(arm, lib):
    """Socket orientation is calibrated on the source Pistol_Idle pose: there the socket's local -Z points
    exactly forward and +Y up, and its origin sits in the centre of the gripping fist."""
    rig = Rig(arm)
    lib.rig = rig
    lib.cache.clear()
    p0 = lib.clip('ual1', 'Pistol_Idle_Loop')[0]
    Wh = p0.W('RightHand')
    grip_local = Wh.transposed() @ (fist_center(p0, 'Right') - p0.X('RightHand'))
    rel = Wh.transposed() @ SOCKET_AIM
    Rh = rig.R['RightHand']
    head = rig.H['RightHand'] + Rh @ grip_local
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    for name, rot in (('RightHandWeapon', Rh @ rel), ('RightHandMelee', Rh @ rel @ Matrix.Rotation(rad(90), 3, 'X'))):
        b = eb.new(name)
        b.head = head
        b.tail = head + rot.col[1] * 0.08
        b.align_roll(rot.col[2])
        b.parent = eb['RightHand']
        b.use_deform = False
    bpy.ops.object.mode_set(mode='OBJECT')
    rig = Rig(arm)
    lib.rig = rig
    lib.cache.clear()
    err = math.degrees((rig.R['RightHandWeapon'].to_quaternion()).rotation_difference((Rh @ rel).to_quaternion()).angle)
    return rig, dict(grip_local=grip_local, rel=rel, err_deg=err)


def local_axis(rig, side, world_dir):
    return (rig.R[side + 'Hand'].transposed() @ Vector(world_dir)).normalized()


def hand_frame(rig, side, fingers_w, palm_w):
    """World rotation for a hand whose fingers point `fingers_w` and palm faces `palm_w`."""
    fr = (rig.H[side + 'HandMiddle1'] - rig.H[side + 'Hand']).normalized()
    f_loc = local_axis(rig, side, fr)
    n_loc = local_axis(rig, side, (0, 0, -1))          # T-pose palms face down
    return frame3(Vector(fingers_w), Vector(palm_w)) @ frame3(f_loc, n_loc).transposed()


def palm_offset(rig, side):
    mid = rig.H[side + 'HandMiddle1'] - rig.H[side + 'Hand']
    return rig.R[side + 'Hand'].transposed() @ (mid * 0.55 + Vector((0, 0, -0.022)))


def place_hand(pose, side, W_hand, point, local_off, pole, share=0.5):
    wrist = Vector(point) - W_hand @ local_off
    arm_ik(pose, side, wrist, pole)
    pose.set_W(side + 'Hand', W_hand)
    twist_share(pose, side + 'ForeArm', side + 'Hand', share)


def grip_right(pose, ctx, S_world, G, pole=(-0.7, 0.4, -1.0)):
    """Right hand so that the RightHandWeapon socket has world frame S_world at point G."""
    Wh = S_world @ ctx['rel'].transposed()
    place_hand(pose, 'Right', Wh, G, ctx['grip_local'], Vector(pole))


def grip_right_melee(pose, ctx, M_world, G, pole=(-0.7, 0.4, -1.0)):
    S = M_world @ Matrix.Rotation(rad(90), 3, 'X').transposed()
    grip_right(pose, ctx, S, G, pole)


def set_fingers(pose, src, side):
    for f in ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky'):
        for i in (1, 2, 3):
            n = '%sHand%s%d' % (side, f, i)
            pose.L[n] = src.L[n].copy()
    pose.dirty()


def open_fingers(pose, side, t=1.0):
    r = pose.rig
    for f in ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky'):
        for i in (1, 2, 3):
            n = '%sHand%s%d' % (side, f, i)
            q = pose.L[n].to_quaternion().slerp(r.rest_local(n).to_quaternion(), t)
            pose.L[n] = q.to_matrix()
    pose.dirty()


def curl_fingers(pose, side, ang):
    """Curl all fingers (not thumb) about their local X by ang (rad)."""
    for f in ('Index', 'Middle', 'Ring', 'Pinky'):
        for i in (1, 2, 3):
            n = '%sHand%s%d' % (side, f, i)
            pose.L[n] = pose.L[n] @ Matrix.Rotation(ang, 3, 'X')
    pose.dirty()


# ----------------------------------------------------------------------------------------------
# rifle / pistol / bat upper bodies
# ----------------------------------------------------------------------------------------------
def rifle_upper(p, ctx, kick=0.0, gun=None, left=None, spine_yaw=rad(-6)):
    """Rifle shouldered, aimed straight forward.  gun=(G, fwd, up) overrides the default hold.
    left: None = support hand on the handguard, or a world point for the left palm (reload)."""
    k = ctx['k']
    if spine_yaw:
        spine_bend(p, yaw=spine_yaw)
        head_turn(p, yaw=-spine_yaw * 0.95, pitch=rad(7), roll=rad(-5))
    if gun is None:
        S = p.X('RightArm')
        G = S + Vector((0.055, -0.30, -0.075)) * k
        fwd, up = Vector((0, -1, 0)), Vector((0, 0, 1))
    else:
        G, fwd, up = gun
    if kick:
        G = G + Vector((0, 0.035, 0.012)) * kick
        fwd = (Matrix.Rotation(rad(6) * kick, 3, 'X') @ fwd).normalized()
        up = (Matrix.Rotation(rad(6) * kick, 3, 'X') @ up).normalized()
    Sw = gun_frame(fwd, up)
    grip_right(p, ctx, Sw, G, pole=(-0.8, 0.35, -1.0))
    if left is None:
        hg = G + fwd * 0.30 * k + up * 0.035
        Wl = hand_frame(ctx['rig'], 'Left', (fwd * 0.35 + Vector((-0.9, 0, 0)) + up * 0.25).normalized(),
                        (up - fwd * 0.2 + Vector((-0.25, 0, 0))).normalized())
        place_hand(p, 'Left', Wl, hg, palm_offset(ctx['rig'], 'Left'), Vector((0.35, 0.15, -1.0)))
    else:
        pt, Wl = left
        place_hand(p, 'Left', Wl, pt, palm_offset(ctx['rig'], 'Left'), Vector((0.5, 0.3, -1.0)))
    return G, fwd, up


def bat_rest_frame(p, ctx):
    """Bat resting on the right shoulder: grip point + melee socket frame (blade along -Z)."""
    k = ctx['k']
    G = p.X('RightArm') + Vector((0.03, -0.17, -0.20)) * k
    blade = Vector((-0.35, 0.62, 0.70)).normalized()
    side = Vector((-0.3, 0.8, -0.5))
    return G, gun_frame(blade, side)


def bat_hold(p, ctx, G, M):
    """Both hands on the handle; right hand at G (melee socket frame M), left hand lower on the handle."""
    k = ctx['k']
    blade = -M.col[2]
    grip_right_melee(p, ctx, M, G, pole=(-0.9, 0.3, -1.0))
    lp = G - blade * 0.10 * k
    fing = (-M.col[1]).normalized()
    Wl = hand_frame(ctx['rig'], 'Left', fing, fing.cross(blade).normalized())
    place_hand(p, 'Left', Wl, lp, palm_offset(ctx['rig'], 'Left'), Vector((0.6, 0.2, -1.0)))


# ----------------------------------------------------------------------------------------------
# procedural legs: side-step strafe gait (in place, IK)
# ----------------------------------------------------------------------------------------------
def strafe_legs(base, ctx, direction, v=0.9, T=0.667, duty=0.55):
    """direction +1 = strafe LEFT (character +X), -1 = strafe RIGHT.  base: a standing pose (upper body kept).
    Returns (poses, speed).  Stance feet slide opposite to travel at exactly v m/s."""
    rig = ctx['rig']
    k = ctx['k']
    n = int(round(T * FPS))
    S = v * duty * T
    gap = 0.13 * k
    lead = 'Left' if direction > 0 else 'Right'
    trail = 'Right' if direction > 0 else 'Left'
    x_lead0 = direction * (S * 1.91 + gap) / 2          # landing lateral position of the leading foot
    x_trail0 = direction * (S - (S * 1.91 + gap) / 2)
    home_y = {'Left': -0.035 * k, 'Right': 0.035 * k}
    ankle_z = rig.H['LeftFoot'].z
    out = []
    for i in range(n + 1):
        ph = i / n
        p = base.copy()
        feet = {}
        for side, x0, off in ((lead, x_lead0, 0.0), (trail, x_trail0, 0.5)):
            q = (ph + off) % 1.0
            if q < duty:
                u = q / duty
                x = x0 - direction * S * u
                z = ankle_z
            else:
                u = (q - duty) / (1 - duty)
                xa = x0 - direction * S
                x = xa + (x0 - xa) * ease_io(u)
                z = ankle_z + 0.055 * k * math.sin(math.pi * u)
            feet[side] = Vector((x, home_y[side], z))
        # hips: shift over the stance, bob, slight roll
        sway = direction * 0.02 * k * math.sin(2 * math.pi * ph)
        p.root = p.root + Vector((sway + 0.0, 0, -0.035 * k - 0.012 * k * math.cos(4 * math.pi * ph)))
        p.dirty()
        # keep the legs reachable
        L = (rig.H['LeftLeg'] - rig.H['LeftUpLeg']).length + (rig.H['LeftFoot'] - rig.H['LeftLeg']).length
        dz = 0.0
        for side, a in feet.items():
            A = p.X(side + 'UpLeg')
            h2 = (L * 0.985) ** 2 - (a.x - A.x) ** 2 - (a.y - A.y) ** 2
            if h2 > 0:
                dz = max(dz, (A.z - a.z) - math.sqrt(h2))
        if dz > 0:
            p.root.z -= dz
            p.dirty()
        for side, a in feet.items():
            sg = 1 if side == 'Left' else -1
            leg_ik(p, side, a, Vector((0.25 * sg, -1, 0)))
            p.set_W(side + 'Foot', rig.R[side + 'Foot'])
            p.set_W(side + 'ToeBase', rig.R[side + 'ToeBase'])
        out.append(p)
    return out, v


def standing_pose(src):
    """Neutral standing lower body (hips + legs) from a source idle pose."""
    return src.copy()


def reverse(poses):
    return [p.copy() for p in reversed(poses)]


def fix_foot_heights(poses, ctx):
    """Keep the lowest stance foot on the ground (compensates small leg-length differences)."""
    out = []
    for p in poses:
        z = min(p.X('LeftToeBase').z, p.X('RightToeBase').z, p.X('LeftFoot').z - 0.06, p.X('RightFoot').z - 0.06)
        out.append(p)
    return out


def ground_offset(p, ctx):
    """Approximate lowest body-surface height from joint positions (for lying poses)."""
    radii = {'Hips': 0.11, 'Spine': 0.11, 'Spine1': 0.12, 'Spine2': 0.12, 'Neck': 0.06, 'Head': 0.10,
             'LeftUpLeg': 0.08, 'RightUpLeg': 0.08, 'LeftLeg': 0.06, 'RightLeg': 0.06, 'LeftFoot': 0.05,
             'RightFoot': 0.05, 'LeftArm': 0.05, 'RightArm': 0.05, 'LeftForeArm': 0.04, 'RightForeArm': 0.04,
             'LeftHand': 0.03, 'RightHand': 0.03, 'LeftToeBase': 0.03, 'RightToeBase': 0.03}
    return min(p.X(b).z - r * ctx['k'] for b, r in radii.items())


# ----------------------------------------------------------------------------------------------
# clip table
# ----------------------------------------------------------------------------------------------
def build_clips(lib, rig, sex, ctx, only=None):
    upper, lower = split_sets(rig)
    k = ctx['k']
    C = {}

    def want(*names):
        return only is None or any(n in only for n in names)

    def upper_with_sockets():
        return upper
    # --- direct library clips ------------------------------------------------------------------
    direct = [('Idle', 'ual1', 'Idle_Loop', True, 1.0), ('Walk', 'ual1', 'Walk_Loop', True, 1.0),
              ('Run', 'ual1', 'Jog_Fwd_Loop', True, 1.0), ('PistolIdle', 'ual1', 'Pistol_Idle_Loop', True, 1.0),
              ('PistolFire', 'ual1', 'Pistol_Shoot', False, 1.0), ('PistolReload', 'ual1', 'Pistol_Reload', False, 1.0),
              ('HitReact', 'ual1', 'Hit_Chest', False, 1.0), ('Death', 'ual1', 'Death01', False, 1.0),
              ('ZombieIdle', 'ual2', 'Zombie_Idle_Loop', True, 1.0),
              ('ZombieAttack', 'ual2', 'Zombie_Scratch', False, 1.5),
              ('ZombieDeath', 'ual2', 'Hit_Knockback', False, 1.0)]
    fix = {'Idle': 'body', 'PistolIdle': 'hips', 'PistolFire': 'hips', 'PistolReload': 'hips'}
    for name, tag, src, loop, spd in direct:
        if want(name):
            ps = clip_direct(lib, tag, src, spd)
            if name in fix:
                ps = neutralize(ps, fix[name])
            C[name] = (ps, loop)

    idle = neutralize(lib.clip('ual1', 'Idle_Loop'), 'body')
    walk = lib.clip('ual1', 'Walk_Loop')
    jog = lib.clip('ual1', 'Jog_Fwd_Loop')
    pistol = neutralize(lib.clip('ual1', 'Pistol_Idle_Loop'), 'hips')

    # --- rifle -----------------------------------------------------------------------------------
    rifle_idle = []
    for p in pistol:
        q = p.copy()
        rifle_upper(q, ctx)
        rifle_idle.append(q)
    if want('RifleIdle'):
        C['RifleIdle'] = (rifle_idle, True)
    if want('RifleWalk'):
        C['RifleWalk'] = (layer(walk, rifle_idle, upper, 1.0), True)
    if want('RifleRun'):
        C['RifleRun'] = (layer(jog, rifle_idle, upper, 0.85), True)
    if want('RifleWalkBack'):
        C['RifleWalkBack'] = (layer(reverse(walk), rifle_idle, upper, 1.0), True)
    for name, d in (('RifleStrafeLeft', 1), ('RifleStrafeRight', -1)):
        if want(name):
            legs, _ = strafe_legs(rifle_idle[0], ctx, d)
            C[name] = (layer(legs, rifle_idle, upper, 1.0), True)
    if want('RifleFire'):
        base = rifle_idle[0]
        out = []
        for i, kick in enumerate((0.0, 1.0, 0.75, 0.35, 0.0)):
            q = pistol[0].copy()
            rifle_upper(q, ctx, kick=kick)
            spine_bend(q, pitch=-rad(2.5) * kick)
            out.append(q)
        C['RifleFire'] = (out, False)
    if want('RifleReload'):
        C['RifleReload'] = (rifle_reload(pistol, ctx), False)

    # --- pistol walk -----------------------------------------------------------------------------
    if want('PistolWalk'):
        C['PistolWalk'] = (layer(walk, pistol, upper, 1.0), True)

    # --- bat ---------------------------------------------------------------------------------------
    bat_idle = []
    for p in idle[:int(2.0 * FPS) + 1] if len(idle) > 2.0 * FPS else idle:
        q = p.copy()
        G, M = bat_rest_frame(q, ctx)
        bat_hold(q, ctx, G, M)
        set_fingers(q, pistol[0], 'Right')
        set_fingers(q, pistol[0], 'Left')
        bat_idle.append(q)
    bat_idle = loopify(bat_idle, 6)
    if want('BatIdle'):
        C['BatIdle'] = (bat_idle, True)
    if want('BatSwing'):
        C['BatSwing'] = (bat_swing(bat_idle[0], pistol[0], ctx), False)

    # --- misc ------------------------------------------------------------------------------------
    if want('Jump'):
        C['Jump'] = (jump_clip(lib, ctx), False)
    if want('Wave'):
        C['Wave'] = (wave_clip(idle, ctx), False)
    if want('Downed'):
        C['Downed'] = (downed_clip(lib, ctx)[0], True)
    if want('Revive'):
        C['Revive'] = (revive_clip(lib, ctx), True)

    # --- zombies ---------------------------------------------------------------------------------
    if want('ZombieWalk'):
        C['ZombieWalk'] = (zombie_walk(lib, ctx), True)
    if want('ZombieRun'):
        C['ZombieRun'] = (zombie_run(jog, ctx), True)
    if want('ZombieDeathForward'):
        C['ZombieDeathForward'] = (zombie_death_forward(lib, ctx), False)
    if want('ZombieCrawl'):
        crawl, v = zombie_crawl(lib, ctx)
        C['ZombieCrawl'] = (crawl, True)
        ctx['crawl_speed'] = v
    return C


# ----------------------------------------------------------------------------------------------
# synthesized clips
# ----------------------------------------------------------------------------------------------
def rifle_reload(pistol, ctx, dur=2.0):
    k = ctx['k']
    rig = ctx['rig']
    n = int(round(dur * FPS))
    out = []
    for i in range(n + 1):
        t = i / FPS
        p = pistol[i % len(pistol)].copy()
        spine_bend(p, yaw=rad(-6))
        w = keys(t, [(0, 0.0), (0.28, 1.0), (1.62, 1.0), (1.95, 0.0)])
        head_turn(p, yaw=rad(6), pitch=rad(7) + rad(14) * w, roll=rad(-5))
        S = p.X('RightArm')
        G = S + Vector((0.055, -0.30, -0.075)) * k + Vector((0.05, 0.07, -0.08)) * k * w
        f0 = Vector((0, -1, 0))
        fwd = (Matrix.Rotation(rad(14) * w, 3, 'X') @ f0).normalized()
        up = (Matrix.Rotation(rad(28) * w, 3, fwd) @ (Matrix.Rotation(rad(14) * w, 3, 'X') @ Vector((0, 0, 1)))).normalized()
        r = fwd.cross(up)
        hg = G + fwd * 0.30 * k + up * 0.035
        mag = G + fwd * 0.10 * k - up * 0.075 * k
        pouch = p.X('Hips') + Vector((0.14, -0.13, 0.03)) * k
        ch = G - fwd * 0.05 * k + up * 0.085 * k + r * 0.035 * k
        path = [(0.0, hg), (0.22, hg), (0.42, mag), (0.55, mag - up * 0.13 * k), (0.85, pouch), (0.95, pouch),
                (1.13, mag - up * 0.10 * k), (1.24, mag + up * 0.01 * k), (1.30, mag), (1.47, ch), (1.52, ch),
                (1.60, ch - fwd * 0.075 * k), (1.66, ch - fwd * 0.075 * k), (1.95, hg), (dur, hg)]
        pt = keys(t, path)
        W_sup = hand_frame(rig, 'Left', (fwd * 0.35 + Vector((-0.9, 0, 0)) + up * 0.25).normalized(),
                           (up - fwd * 0.2 + Vector((-0.25, 0, 0))).normalized())
        W_mag = hand_frame(rig, 'Left', (fwd * 0.5 + up * 0.6 - r * 0.2).normalized(), r)
        W_ch = hand_frame(rig, 'Left', (r * 0.7 - fwd * 0.3 + up * 0.2).normalized(), -up)
        a = keys(t, [(0.0, 0.0), (0.22, 0.0), (0.42, 1.0), (1.30, 1.0), (1.47, 2.0), (1.66, 2.0), (1.95, 0.0)])
        if a <= 1.0:
            Wl = W_sup.to_quaternion().slerp(W_mag.to_quaternion(), a).to_matrix()
        else:
            Wl = W_mag.to_quaternion().slerp(W_ch.to_quaternion(), a - 1.0).to_matrix()
        rifle_upper(p, ctx, gun=(G, fwd, up), left=(pt, Wl), spine_yaw=0.0)
        out.append(p)
    return out


def bat_swing(rest_pose, finger_src, ctx, dur=0.8):
    k = ctx['k']
    n = int(round(dur * FPS))
    G0, M0 = bat_rest_frame(rest_pose, ctx)
    C = rest_pose.X('Spine2')
    # (t, spine yaw, hand offset from chest, blade dir, secondary axis)
    K = [(0.00, 0.0, None, None, None),
         (0.20, rad(-38), Vector((-0.22, 0.00, 0.10)), Vector((-0.15, 0.70, 0.70)), Vector((-0.7, -0.7, 0.0))),
         (0.36, rad(-8), Vector((-0.20, -0.30, -0.12)), Vector((-0.85, 0.50, 0.10)), Vector((0.0, -0.3, 1.0))),
         (0.44, rad(22), Vector((0.02, -0.42, -0.12)), Vector((0.10, -1.0, 0.03)), Vector((0.0, 0.0, 1.0))),
         (0.56, rad(58), Vector((0.30, -0.24, -0.02)), Vector((0.85, 0.45, 0.20)), Vector((0.2, -0.3, 1.0))),
         (0.80, 0.0, None, None, None)]

    def kf(i):
        t, yaw, off, bd, sd = K[i]
        if off is None:
            return t, yaw, G0 - C, M0.to_quaternion()
        return t, yaw, off * k, gun_frame(bd, sd).to_quaternion()
    out = []
    for i in range(n + 1):
        t = i / FPS * (dur / (n / FPS))
        j = max(0, min(len(K) - 2, max(a for a in range(len(K) - 1) if K[a][0] <= t)))
        t0, y0, o0, q0 = kf(j)
        t1, y1, o1, q1 = kf(j + 1)
        u = ease_io((t - t0) / (t1 - t0))
        yaw = lerp(y0, y1, u)
        off = o0.lerp(o1, u)
        if q0.dot(q1) < 0:
            q1 = -q1
        M = q0.slerp(q1, u).to_matrix()
        p = rest_pose.copy()
        p.rotate_world('Hips', Matrix.Rotation(yaw * 0.3, 3, 'Z'))
        spine_bend(p, yaw=yaw * 0.7, pitch=rad(6) * math.sin(math.pi * clamp(t / dur, 0, 1)))
        head_turn(p, yaw=-yaw * 0.6)
        bat_hold(p, ctx, C + off, M)
        set_fingers(p, finger_src, 'Right')
        set_fingers(p, finger_src, 'Left')
        out.append(p)
    return out


def jump_clip(lib, ctx):
    js = lib.clip('ual1', 'Jump_Start')
    jl = lib.clip('ual1', 'Jump_Land')
    fm = lambda p: min(p.X('LeftToeBase').z, p.X('RightToeBase').z)
    g0 = fm(js[0])
    take = next((i for i, p in enumerate(js) if fm(p) > g0 + 0.05), len(js) // 2)
    touch = next((i for i, p in enumerate(jl) if i > 0 and fm(p) < g0 + 0.02), len(jl) // 3)
    a = js[max(0, take - 7): take + 5]
    b = jl[max(0, touch - 4): touch + 11]
    xf = 3
    mid = [blend_pose(a[-xf + i], b[i], (i + 1) / (xf + 1)) for i in range(xf)]
    return a[:-xf] + mid + b[xf:]


def wave_clip(idle, ctx, dur=2.0):
    k = ctx['k']
    rig = ctx['rig']
    n = int(round(dur * FPS))
    out = []
    arm_bones = ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand'] + \
        ['RightHand%s%d' % (f, i) for f in ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky') for i in (1, 2, 3)]
    for i in range(n + 1):
        t = i / FPS
        base = idle[i % len(idle)]
        w = keys(t, [(0, 0.0), (0.35, 1.0), (1.62, 1.0), (2.0, 0.0)])
        q = base.copy()
        q.rotate_world('RightShoulder', Matrix.Rotation(rad(-8), 3, 'Y'))
        osc = math.sin(2 * math.pi * 2.4 * max(0.0, t - 0.3)) * smooth((t - 0.3) / 0.15) * (1 - smooth((t - 1.5) / 0.2))
        wr = q.X('RightArm') + Vector((-0.15 - 0.07 * osc, -0.10, 0.34)) * k
        Wh = hand_frame(rig, 'Right', Vector((-0.35 * osc, 0.1, 1.0)).normalized(), Vector((0, -1, 0)))
        arm_ik(q, 'Right', wr, Vector((-1, 0.25, -0.35)))
        q.set_W('RightHand', Wh)
        twist_share(q, 'RightForeArm', 'RightHand', 0.5)
        open_fingers(q, 'Right', 0.85)
        head_turn(q, yaw=rad(-6) * w, pitch=rad(-3) * w)
        out.append(blend_pose(base, q, w))
    return out


def downed_clip(lib, ctx, dur=2.0):
    k = ctx['k']
    rig = ctx['rig']
    src = lib.clip('ual2', 'LayToIdle')
    # sitting on the ground, torso up, hips low
    cand = [(i, p) for i, p in enumerate(src) if p.X('Hips').z < 0.30 * k and p.X('Head').z > 0.62 * k]
    idx, base = cand[len(cand) // 3] if cand else (len(src) // 3, src[len(src) // 3])
    free = 'Right' if base.X('RightHand').z >= base.X('LeftHand').z else 'Left'
    sg = 1 if free == 'Left' else -1
    n = int(round(dur * FPS))
    out = []
    for i in range(n + 1):
        t = i / FPS
        ph = 2 * math.pi * t / dur
        p = base.copy()
        spine_bend(p, pitch=rad(2.0) * math.sin(ph), roll=rad(1.0) * math.sin(ph + 0.5))
        head_turn(p, yaw=rad(10) * math.sin(ph + 1.0), pitch=rad(-4))
        wr = p.X(free + 'Arm') + Vector((sg * 0.06 + 0.05 * sg * math.sin(2 * ph), -0.16, 0.44)) * k
        arm_ik(p, free, wr, Vector((sg * 1.0, 0.4, -0.2)))
        p.set_W(free + 'Hand', hand_frame(rig, free, Vector((0.25 * sg * math.sin(2 * ph), -0.15, 1.0)).normalized(),
                                          Vector((0, -1, 0.1))))
        twist_share(p, free + 'ForeArm', free + 'Hand', 0.5)
        open_fingers(p, free, 0.8)
        out.append(p)
    return out, idx


def pose_dist(a, b, bones):
    return sum(a.L[n].to_quaternion().rotation_difference(b.L[n].to_quaternion()).angle for n in bones)


def revive_clip(lib, ctx):
    src = lib.clip('ual1', 'Fixing_Kneeling')
    k = ctx['k']
    kneel = [i for i, p in enumerate(src) if p.X('Hips').z < 0.62 * k]
    if not kneel:
        return src
    a0, a1 = kneel[0] + 8, kneel[-1] - 8
    bones = ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm']
    best = None
    for a in range(a0, max(a0 + 1, a1 - 30), 2):
        for b in range(a + 30, min(a1, a + 64)):
            d = pose_dist(src[a], src[b], bones) + 0.2 * (src[a].root - src[b].root).length
            if best is None or d < best[0]:
                best = (d, a, b)
    _, a, b = best
    return loopify(src[a:b + 1], 6)


def zombie_walk(lib, ctx):
    src = lib.clip('ual2', 'Zombie_Walk_Fwd_Loop')
    out = []
    n = len(src)
    for i, p in enumerate(src):
        q = p.copy()
        ph = 2 * math.pi * i / (n - 1)
        for side, ang, inward in (('Right', rad(78), rad(12)), ('Left', rad(52), rad(-10))):
            sg = 1 if side == 'Left' else -1
            q.rotate_world(side + 'Shoulder', Matrix.Rotation(rad(-8), 3, 'X') @ Matrix.Rotation(sg * rad(-4), 3, 'Y'))
            M = Matrix.Rotation(inward, 3, 'Z') @ Matrix.Rotation(-(ang + rad(5) * math.sin(ph + (0 if sg > 0 else 1.2))), 3, 'X')
            q.rotate_world(side + 'Arm', M)
        head_turn(q, roll=rad(9) * math.sin(ph * 0.5 + 0.3), pitch=rad(4))
        out.append(q)
    return out


def zombie_run(jog, ctx, speed=0.83):
    k = ctx['k']
    rig = ctx['rig']
    src = resample(jog, int(round((len(jog) - 1) / speed)) + 1)
    out = []
    n = len(src)
    for i, p in enumerate(src):
        q = p.copy()
        ph = 2 * math.pi * i / (n - 1)
        q.rotate_world('Hips', Matrix.Rotation(-rad(10), 3, 'X'))
        spine_bend(q, pitch=rad(20), roll=rad(5) * math.sin(ph))
        head_turn(q, pitch=rad(-34), roll=rad(7) * math.sin(ph + 1.0))
        for side in ('Left', 'Right'):
            sg = 1 if side == 'Left' else -1
            a = ph + (0 if sg > 0 else math.pi)
            wr = q.X(side + 'Arm') + Vector((sg * (0.02 + 0.04 * math.sin(a)), -0.44 - 0.12 * math.sin(a),
                                             -0.10 + 0.10 * math.cos(a))) * k
            arm_ik(q, side, wr, Vector((sg * 1.0, 0.35, -0.6)))
            q.set_W(side + 'Hand', hand_frame(rig, side, Vector((sg * 0.1, -1.0, 0.1 * math.cos(a))).normalized(),
                                                Vector((0, 0.2, -1.0))))
            twist_share(q, side + 'ForeArm', side + 'Hand', 0.5)
            open_fingers(q, side, 0.9)
            curl_fingers(q, side, rad(30))
        out.append(q)
    return out


def straighten_prone_legs(p):
    for side, spread in (('Left', rad(-6)), ('Right', rad(6))):
        p.L[side + 'UpLeg'] = p.rig.rest_local(side + 'UpLeg')
        p.L[side + 'Leg'] = p.rig.rest_local(side + 'Leg')
        p.L[side + 'Foot'] = p.rig.rest_local(side + 'Foot')
        p.dirty()
        p.rotate_world(side + 'UpLeg', Matrix.Rotation(spread, 3, 'Z'))
        p.rotate_world(side + 'Foot', Matrix.Rotation(rad(70), 3, 'X'))


def swim_prone(lib, ctx):
    swim = lib.clip('ual1', 'Swim_Fwd_Loop')
    return swim


def zombie_death_forward(lib, ctx, dur=1.4):
    k = ctx['k']
    start = lib.clip('ual2', 'Zombie_Idle_Loop')[0]
    kneel_src = lib.clip('ual1', 'Fixing_Kneeling')
    kneel = min(kneel_src, key=lambda p: p.X('Hips').z)
    prone = lib.clip('ual1', 'Swim_Fwd_Loop')[0]
    straighten_prone_legs(prone)
    prone.root = prone.root + Vector((0, -0.55 * k, 0))
    prone.dirty()
    prone.root.z -= ground_offset(prone, ctx)
    prone.dirty()
    buck = blend_pose(start, kneel, 0.45)
    buck.root = start.root.lerp(kneel.root, 0.45)
    n = int(round(dur * FPS))
    out = []
    for i in range(n + 1):
        t = i / FPS
        if t < 0.25:
            p = blend_pose(start, buck, ease_io(t / 0.25))
        elif t < 0.72:
            s = ((t - 0.25) / 0.47) ** 1.6
            p = blend_pose(buck, prone, s)
            p.root = buck.root.lerp(prone.root, s)
            p.root.z += 0.10 * k * math.sin(math.pi * s) * (1 - s)
            p.dirty()
        else:
            p = prone.copy()
            b = max(0.0, 1 - (t - 0.72) / 0.18)
            p.root.z += 0.025 * k * math.sin(math.pi * (1 - b)) * b
            p.dirty()
        out.append(p)
    return out


def zombie_crawl(lib, ctx, T=1.6, duty=0.58):
    k = ctx['k']
    rig = ctx['rig']
    swim = lib.clip('ual1', 'Swim_Fwd_Loop')
    base = swim[0].copy()
    straighten_prone_legs(base)
    # legs straight and relaxed from the swim pose; arch the chest up, head looking forward
    spine_bend(base, pitch=rad(-18))
    head_turn(base, pitch=rad(-30))
    base.root.z -= ground_offset(base, ctx)
    base.dirty()
    shoulder_y = 0.5 * (base.X('LeftArm').y + base.X('RightArm').y)
    base.root.y -= shoulder_y - (-0.05 * k)
    base.dirty()
    shoulder_y = 0.5 * (base.X('LeftArm').y + base.X('RightArm').y)
    n = int(round(T * FPS))
    yf, yb = shoulder_y - 0.44 * k, shoulder_y - 0.06 * k
    S = yb - yf
    v = S / (duty * T)
    out = []
    for i in range(n + 1):
        ph = i / n
        p = base.copy()
        roll = rad(7) * math.sin(2 * math.pi * ph)
        p.rotate_world('Hips', Matrix.Rotation(roll * 0.5, 3, 'Y'))
        spine_bend(p, roll=roll, yaw=rad(5) * math.sin(2 * math.pi * ph))
        head_turn(p, roll=-roll * 0.8, yaw=rad(-6) * math.sin(2 * math.pi * ph + 0.6))
        for side, off in (('Left', 0.0), ('Right', 0.5)):
            sg = 1 if side == 'Left' else -1
            q = (ph + off) % 1.0
            x = sg * 0.23 * k
            if q < duty:
                u = q / duty
                y = yf + S * u
                z = 0.035 * k
            else:
                u = (q - duty) / (1 - duty)
                y = yb - S * ease_io(u)
                z = 0.035 * k + 0.10 * k * math.sin(math.pi * u)
            arm_ik(p, side, Vector((x, y, z)), Vector((sg * 1.0, 0.7, 0.9)))
            p.set_W(side + 'Hand', hand_frame(rig, side, Vector((sg * 0.25, -1.0, -0.15)).normalized(), Vector((0, 0, -1))))
            twist_share(p, side + 'ForeArm', side + 'Hand', 0.5)
            open_fingers(p, side, 0.7)
            curl_fingers(p, side, rad(20))
        for side, off in (('Left', 0.0), ('Right', 0.5)):
            bend = rad(8) + rad(10) * max(0.0, math.sin(2 * math.pi * (ph + off)))
            p.rotate_world(side + 'Leg', Matrix.Rotation(-bend, 3, 'X'))
        out.append(p)
    return out, v


def export_glb(arm, meshes, path, animations=True):
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = arm
    set_action(arm, None)
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.scene.frame_set(0)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True,
        export_animations=animations, export_animation_mode='ACTIONS', export_skins=True, export_yup=True,
        export_cameras=False, export_lights=False, export_force_sampling=True, export_frame_step=1,
        export_optimize_animation_size=True, export_def_bones=False, export_rest_position_armature=True,
        export_reset_pose_bones=True, export_texcoords=True, export_normals=True, export_materials='EXPORT',
        export_image_format='AUTO', export_morph=False, export_anim_slide_to_zero=True, export_extras=False,
        export_influence_nb=4)


def slim_glb(path):
    """Drop animation channels that never change (bone scale, non-root translation, weapon sockets) and
    prune/dedup unused data with gltf-transform (plain glTF, no compression extensions)."""
    import struct
    d = open(path, 'rb').read()
    L = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + L])
    rest = d[20 + L:]          # BIN chunk (header + data), unchanged
    names = {i: n.get('name') for i, n in enumerate(j['nodes'])}
    for a in j.get('animations', []):
        keep, remap, samplers = [], {}, []
        for ch in a['channels']:
            nm = names.get(ch['target']['node'])
            path_ = ch['target']['path']
            if path_ == 'scale' or (path_ == 'translation' and nm != 'Hips') or nm in ('RightHandWeapon', 'RightHandMelee'):
                continue
            si = ch['sampler']
            if si not in remap:
                remap[si] = len(samplers)
                samplers.append(a['samplers'][si])
            ch['sampler'] = remap[si]
            keep.append(ch)
        a['channels'], a['samplers'] = keep, samplers
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    out = (struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + len(rest)) + struct.pack('<II', len(js), 0x4E4F534A) +
           js + rest)
    tmp = path + '.tmp.glb'
    open(tmp, 'wb').write(out)
    npx = '/opt/homebrew/bin/npx'
    env = dict(os.environ, PATH='/opt/homebrew/bin:' + os.environ.get('PATH', ''))
    ok = False
    if os.path.exists(npx):
        r1 = subprocess.run([npx, '--yes', '@gltf-transform/cli', 'prune', tmp, tmp], cwd=ROOT, env=env,
                            capture_output=True, text=True)
        r2 = subprocess.run([npx, '--yes', '@gltf-transform/cli', 'dedup', tmp, tmp], cwd=ROOT, env=env,
                            capture_output=True, text=True)
        ok = r1.returncode == 0 and r2.returncode == 0
        if not ok:
            print('gltf-transform failed:', r1.stderr[-500:], r2.stderr[-500:])
    os.replace(tmp, path)
    return ok


def make_lod(body, target_tris):
    lod = body.copy()
    lod.data = body.data.copy()
    lod.name = body.name + '_lod'
    lod.data.name = lod.name
    bpy.context.scene.collection.objects.link(lod)
    for m in list(lod.modifiers):
        if m.type != 'ARMATURE':
            lod.modifiers.remove(m)
    dec = lod.modifiers.new('Decimate', 'DECIMATE')
    dec.decimate_type = 'COLLAPSE'
    dec.ratio = min(1.0, target_tris / max(1, tri_count(body)))
    dec.use_collapse_triangulate = True
    bpy.ops.object.select_all(action='DESELECT')
    lod.select_set(True)
    bpy.context.view_layer.objects.active = lod
    with bpy.context.temp_override(object=lod, active_object=lod, selected_objects=[lod]):
        bpy.ops.object.modifier_move_to_index(modifier='Decimate', index=0)
        bpy.ops.object.modifier_apply(modifier='Decimate')
    # re-limit influences after collapse interpolation
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    return lod


GROUND_FIX = {'Death': 'end', 'ZombieDeath': 'end', 'ZombieDeathForward': 'end', 'Downed': 'all',
              'Revive': 'all', 'ZombieCrawl': 'all'}


def mesh_min_z(body):
    import numpy as np
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    co = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get('co', co)
    z = float(co[2::3].min())
    ev.to_mesh_clear()
    return z


def ground_fix(sc, arm, body, rig, poses, mode):
    act = write_action(arm, '_tmp_ground', poses, rig.order)
    set_action(arm, act)
    n = len(poses)
    frames = [n - 1] if mode == 'end' else list(range(n))
    zs = {}
    for f in frames:
        sc.frame_set(f)
        zs[f] = mesh_min_z(body)
    set_action(arm, None)
    bpy.data.actions.remove(act)
    out = [p.copy() for p in poses]
    if mode == 'end':
        dz = -zs[n - 1]
        st = int(n * 0.45)
        for i in range(n):
            out[i].root.z += dz * smooth((i - st) / max(1, (n - 1 - st)))
            out[i].dirty()
    else:
        for i in frames:
            out[i].root.z -= zs[i]
            out[i].dirty()
    return out


def make_proxy(arm, kind):
    """Preview-only weapon proxy parented to the socket (NOT exported): shows socket orientation."""
    me = bpy.data.meshes.new('proxy_' + kind)
    bm = bmesh.new()

    def box(x0, x1, y0, y1, z0, z1):
        vs = [bm.verts.new((x, y, z)) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
        for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
            bm.faces.new([vs[i] for i in f])
    if kind == 'rifle':      # local -Z forward, +Y up, origin at grip
        box(-0.02, 0.02, 0.03, 0.09, -0.30, 0.26)     # receiver + stock
        box(-0.012, 0.012, 0.05, 0.075, -0.62, -0.30)  # barrel
        box(-0.015, 0.015, -0.06, 0.04, -0.02, 0.03)   # grip
        box(-0.013, 0.013, -0.10, 0.03, -0.14, -0.08)  # magazine
    elif kind == 'pistol':
        box(-0.013, 0.013, 0.02, 0.055, -0.17, 0.02)
        box(-0.013, 0.013, -0.07, 0.03, -0.02, 0.03)
    else:                    # bat: blade along -Z of RightHandMelee
        box(-0.016, 0.016, -0.016, 0.016, -0.30, 0.13)
        box(-0.05, 0.05, -0.02, 0.02, -0.85, -0.30)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('proxy_' + kind, me)
    bpy.context.scene.collection.objects.link(ob)
    bone = 'RightHandMelee' if kind == 'bat' else 'RightHandWeapon'
    ob.parent = arm
    ob.parent_type = 'BONE'
    ob.parent_bone = bone
    ob.location = (0, -arm.data.bones[bone].length, 0)
    m = bpy.data.materials.new('proxy_' + kind)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.05, 0.05, 0.05, 1) if kind != 'bat' else (0.55, 0.4, 0.2, 1)
    me.materials.append(m)
    return ob


def render_clip_sheets(sc, name, arm, info, height, nshots=6):
    cam = setup_render(sc, 300, 380)
    proxies = {k: make_proxy(arm, k) for k in ('rifle', 'pistol', 'bat')}
    for clip, d in info.items():
        for kname, ob in proxies.items():
            ob.hide_render = not clip.startswith({'rifle': 'Rifle', 'pistol': 'Pistol', 'bat': 'Bat'}[kname])
        set_action(arm, bpy.data.actions[clip])
        n = d['frames']
        if d['loop']:
            shots = [int(i * (n - 1) / nshots) for i in range(nshots)]
        else:
            shots = [int(round(i * (n - 1) / (nshots - 1))) for i in range(nshots)]
        lying = clip.startswith(('Death', 'ZombieDeath', 'Downed', 'ZombieCrawl', 'Revive'))
        view = (1, -0.45, 0.12) if not lying else (1, -0.7, 0.45)
        if clip.startswith(('Rifle', 'Pistol', 'Bat', 'Wave')):
            view = (0.9, -1.0, 0.2)
        files = []
        for i, f in enumerate(shots):
            sc.frame_set(f)
            aim_camera(cam, Vector((0, 0.0 if not lying else 0.3, height * 0.5)), view, 8.0,
                       ortho=height * (1.25 if not lying else 1.6))
            fn = os.path.join(TMP_DIR, '_c%02d.png' % i)
            render_to(sc, fn)
            files.append(fn)
        tile(files, os.path.join(RENDER_DIR, '%s_anim_%s.png' % (name, clip)), nshots)
    set_action(arm, None)
    sc.frame_set(0)
    for ob in proxies.values():
        bpy.data.objects.remove(ob)


# ----------------------------------------------------------------------------------------------
def build_character(sex):
    arm, meshes = import_character(sex)
    rename_and_prune_rig(arm, meshes)
    scale_character(arm, meshes, BODY[sex]['height'])
    slim_body(arm, meshes['body'], sex)
    info = tailor(arm, meshes['body'], sex)
    shoes = build_shoes(arm, sex, info)
    parts = [(meshes['body'], None), (meshes['eyes'], 'eyes'), (meshes['brows'], 'hair'), (meshes['hair'], 'hair'),
             (shoes, 'shoes')]
    if sex == 'female':
        parts.append((build_kurti(arm, meshes['body'], info), 'shirt'))
    mats = build_materials(sex, meshes)
    body = assign_and_join(arm, parts, mats)
    return arm, body, info


def main():
    args = parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(TMP_DIR, exist_ok=True)
    report = {}
    for sex in ('male', 'female'):
        if args['only'] and args['only'] != sex:
            continue
        t0 = time.time()
        sc = reset_scene()
        arm, body, info = build_character(sex)
        report[sex] = dict(tris=tri_count(body), verts=len(body.data.vertices))
        print('[%s] tris=%d verts=%d (%.1fs)' % (sex, report[sex]['tris'], report[sex]['verts'], time.time() - t0))
        if args['render'] and args['views']:
            render_rest_views(sc, sex, BODY[sex]['height'])
        lib = Library(Rig(arm), sc)
        rig, sock = calibrate_and_add_sockets(arm, lib)
        ctx = dict(rig=rig, k=BODY[sex]['height'] / 1.735, rel=sock['rel'], grip_local=sock['grip_local'])
        clips = build_clips(lib, rig, sex, ctx, args['clips'])
        lib.cleanup()
        info_clips = {}
        for name, (poses, loop) in clips.items():
            if name in GROUND_FIX:
                poses = ground_fix(sc, arm, body, rig, poses, GROUND_FIX[name])
            write_action(arm, name, poses, rig.order)
            sp, dv = foot_speed(poses)
            if name == 'ZombieCrawl':
                sp, dv = ctx.get('crawl_speed', 0.0), (0.0, -1.0)
            info_clips[name] = dict(duration=round((len(poses) - 1) / FPS, 3), frames=len(poses), loop=loop,
                                    speed=round(sp, 2), dir=dv)
        report[sex]['clips'] = info_clips
        report[sex]['socket'] = dict(grip_local=[round(x, 4) for x in sock['grip_local']], err_deg=round(sock['err_deg'], 3))
        # drop the source-library actions so only the contract clips are exported
        for a in list(bpy.data.actions):
            if a.name not in info_clips:
                bpy.data.actions.remove(a)
        if args['render']:
            render_clip_sheets(sc, sex, arm, info_clips, BODY[sex]['height'])
        if args['export'] and not args['clips']:
            path = os.path.join(OUT_DIR, sex + '.glb')
            export_glb(arm, [body], path, animations=True)
            slim_glb(path)
            lod = make_lod(body, 3950)
            lpath = os.path.join(OUT_DIR, sex + '_lod.glb')
            export_glb(arm, [lod], lpath, animations=False)
            report[sex].update(file=path, bytes=os.path.getsize(path), lod_file=lpath,
                               lod_bytes=os.path.getsize(lpath), lod_tris=tri_count(lod))
            bpy.data.objects.remove(lod)
    print(json.dumps(report, indent=1))


if __name__ == '__main__':
    main()
