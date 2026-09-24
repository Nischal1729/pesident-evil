"""
Pesident Evil -- procedural weapon generator (Blender 5.2, headless).

Run from the project root:
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/weapons.py
    ... -P tools/blender/weapons.py -- pistol rifle        (build a subset)
    ... -P tools/blender/weapons.py -- --no-render         (skip preview renders)

Writes public/models/weapons/<name>.glb and preview PNGs to tools/blender/_renders/weapons/.

Contract (docs/ARCHITECTURE.md, "Weapons"):
  * origin at the grip (where the right hand holds), barrel toward three.js -Z (= Blender +Y), Y up, metres
  * named nodes: muzzle (empty), magazine (mesh), slide|bolt (mesh), leftHandGrip (empty); bat: tip + leftHandGrip
  * <= 3k triangles each
Design coordinates below are Blender: +X = weapon's right, +Y = forward (barrel), +Z = up.
"""
import bpy, bmesh, math, os, sys, subprocess, time
from mathutils import Vector, Matrix, Euler

# ==== BEGIN COMMON (identical in weapons.py and props.py so each script is standalone) ====
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.normpath(os.path.join(HERE, '..', '..'))
FFMPEG = '/opt/homebrew/bin/ffmpeg'
RENDER_HELPERS = []          # objects that exist only for preview renders (never exported)
MATS = {}


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip('#')
    return tuple(srgb_to_lin(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


def reset():
    MATS.clear()
    RENDER_HELPERS.clear()
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.curves, bpy.data.materials,
                 bpy.data.images, bpy.data.cameras, bpy.data.lights, bpy.data.worlds):
        for d in list(coll):
            coll.remove(d)


def _principled(m):
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
    if bsdf is None:
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    if out is None:
        out = nt.nodes.new('ShaderNodeOutputMaterial')
    if not out.inputs['Surface'].is_linked:
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return nt, bsdf


def M(name, col='#808080', rough=0.5, metal=0.0, emit=None, emit_strength=1.0, image=None, double=False):
    """Principled material (cached by name). col/emit are sRGB hex strings. Single-sided unless double."""
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_backface_culling = not double
    nt, bsdf = _principled(m)
    c = hexcol(col)
    bsdf.inputs['Base Color'].default_value = (*c, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    m.diffuse_color = (*c, 1.0)
    m.roughness = rough
    m.metallic = metal
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*hexcol(emit), 1.0)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    if image is not None:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = image
        tex.interpolation = 'Linear'
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    MATS[name] = m
    return m


def make_image(name, w, h, fn):
    """fn(x, y) -> (r, g, b) in sRGB 0..1 (byte images store sRGB directly); returns a packed PNG image."""
    img = bpy.data.images.new(name, w, h, alpha=False)
    px = [0.0] * (w * h * 4)
    for y in range(h):
        for x in range(w):
            r, g, b = fn(x, y)
            i = (y * w + x) * 4
            px[i:i + 4] = (r, g, b, 1.0)
    img.pixels = px
    img.file_format = 'PNG'
    img.pack()
    return img


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def new_obj(name, verts, faces, mat=None, recalc=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.validate()
    me.update()
    ob = link(bpy.data.objects.new(name, me))
    if mat is not None:
        me.materials.append(mat)
    if recalc:
        recalc_normals(ob)
    return ob


def recalc_normals(ob, inside=False):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if inside:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def flip(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()


def xform(ob, loc=(0, 0, 0), rot=(0, 0, 0), scale=None, order='XYZ'):
    """Transform mesh data (objects stay at identity)."""
    mx = Matrix.Translation(Vector(loc)) @ Euler(rot, order).to_matrix().to_4x4()
    if scale is not None:
        mx = mx @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))
    ob.data.transform(mx)
    if scale is not None and scale[0] * scale[1] * scale[2] < 0:
        flip(ob)
    ob.data.update()
    return ob


def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    me.name = old.name
    bpy.data.meshes.remove(old)
    return ob


def bevel(ob, w, seg=1, angle=30, harden=True, clamp=True):
    """Bevel (applied) with hardened normals: flat faces stay flat, chamfers catch light."""
    for p in ob.data.polygons:
        p.use_smooth = True
    md = ob.modifiers.new('bev', 'BEVEL')
    md.width = w
    md.segments = seg
    md.limit_method = 'ANGLE'
    md.angle_limit = math.radians(angle)
    md.harden_normals = harden
    md.use_clamp_overlap = clamp
    md.miter_outer = 'MITER_ARC'
    apply_mods(ob)
    return ob


def smooth(ob, angle=35):
    me = ob.data
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(angle))
    return ob


def flat(ob):
    ob.data.shade_flat()
    return ob


def lift(pts, axis, pos):
    """2D section -> 3D. axis='X': (a,b)->(pos,a,b); 'Y': (a,b)->(a,pos,b); 'Z': (a,b)->(a,b,pos)."""
    if axis == 'X':
        return [(pos, a, b) for a, b in pts]
    if axis == 'Y':
        return [(a, pos, b) for a, b in pts]
    return [(a, b, pos) for a, b in pts]


def loft(name, sections, mat=None, cap_start=True, cap_end=True, closed=True):
    n = len(sections[0])
    verts, faces = [], []
    for s in sections:
        assert len(s) == n
        verts.extend(s)
    for i in range(len(sections) - 1):
        a, b = i * n, (i + 1) * n
        for j in range(n if closed else n - 1):
            j2 = (j + 1) % n
            faces.append((a + j, a + j2, b + j2, b + j))
    if closed and cap_start:
        faces.append(tuple(reversed(range(n))))
    if closed and cap_end:
        faces.append(tuple(range((len(sections) - 1) * n, len(sections) * n)))
    return new_obj(name, verts, faces, mat)


def prism(name, pts, axis, t0, t1, mat=None, bev=0.0, seg=1, angle=30, taper=None):
    """Extrude a 2D outline along `axis` from t0 to t1. taper=(along_idx, v0, s0, v1, s1) scales the
    extrusion-axis coordinate linearly from s0 (at coordinate v0 along along_idx) to s1 (at v1)."""
    ob = loft(name, [lift(pts, axis, t0), lift(pts, axis, t1)], mat)
    if taper is not None:
        ai = 'XYZ'.index(axis)
        idx, v0, s0, v1, s1 = taper
        for v in ob.data.vertices:
            t = min(1.0, max(0.0, (v.co[idx] - v0) / (v1 - v0)))
            v.co[ai] *= s0 + (s1 - s0) * t
    if bev > 0:
        bevel(ob, bev, seg, angle)
    return ob


def rrect(w, h, r=0.0, n=2, cx=0.0, cy=0.0):
    """Rounded rectangle, CCW, starting at the right edge top."""
    r = max(0.0, min(r, w / 2 - 1e-5, h / 2 - 1e-5))
    pts = []
    corners = [(w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90),
               (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)]
    for x, y, a0 in corners:
        if r <= 0 or n == 0:
            pts.append((cx + math.copysign(w / 2, x), cy + math.copysign(h / 2, y)))
        else:
            for k in range(n + 1):
                a = math.radians(a0 + 90.0 * k / n)
                pts.append((cx + x + r * math.cos(a), cy + y + r * math.sin(a)))
    return pts


def circle2d(r, n, cx=0.0, cy=0.0, phase=0.0):
    return [(cx + r * math.cos(phase + 2 * math.pi * k / n), cy + r * math.sin(phase + 2 * math.pi * k / n))
            for k in range(n)]


def box(name, size, loc=(0, 0, 0), mat=None, bev=0.0, seg=1, rot=(0, 0, 0)):
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    pts = [(sx, sz), (-sx, sz), (-sx, -sz), (sx, -sz)]
    ob = loft(name, [lift(pts, 'Y', -sy), lift(pts, 'Y', sy)], mat)
    xform(ob, loc, rot)
    if bev > 0:
        bevel(ob, bev, seg)
    return ob


def lathe(name, prof, segs, mat=None, axis='Z', loc=(0, 0, 0), rot=(0, 0, 0), cap=True, phase=None,
          sharp=35, scale=None):
    """Revolve profile [(r, h), ...] around an axis. r == 0 at the ends makes a pole vertex."""
    if phase is None:
        phase = math.pi / segs
    verts, faces, rows = [], [], []
    for r, h in prof:
        if r <= 1e-7:
            rows.append([len(verts)])
            verts.append((0.0, 0.0, h))
        else:
            row = []
            for k in range(segs):
                a = phase + 2 * math.pi * k / segs
                row.append(len(verts))
                verts.append((r * math.cos(a), r * math.sin(a), h))
            rows.append(row)
    for i in range(len(rows) - 1):
        A, B = rows[i], rows[i + 1]
        if len(A) == 1 and len(B) == 1:
            continue
        for k in range(segs):
            k2 = (k + 1) % segs
            if len(A) == 1:
                faces.append((A[0], B[k], B[k2]))
            elif len(B) == 1:
                faces.append((A[k], A[k2], B[0]))
            else:
                faces.append((A[k], A[k2], B[k2], B[k]))
    if cap:
        if len(rows[0]) > 1:
            faces.append(tuple(reversed(rows[0])))
        if len(rows[-1]) > 1:
            faces.append(tuple(rows[-1]))
    ob = new_obj(name, verts, faces, mat)
    if axis == 'Y':
        ob.data.transform(Matrix.Rotation(-math.pi / 2, 4, 'X'))   # +Z -> +Y
    elif axis == 'X':
        ob.data.transform(Matrix.Rotation(math.pi / 2, 4, 'Y'))    # +Z -> +X
    if scale is not None:
        xform(ob, scale=scale)
    xform(ob, loc, rot)
    if sharp is not None:
        smooth(ob, sharp)
    return ob


def cyl(name, r, depth, loc=(0, 0, 0), mat=None, axis='Z', segs=16, r2=None, rot=(0, 0, 0), bev=0.0,
        seg=1, sharp=40):
    r2 = r if r2 is None else r2
    ob = lathe(name, [(r, -depth / 2), (r2, depth / 2)], segs, mat, axis, loc, rot, sharp=None)
    if bev > 0:
        bevel(ob, bev, seg, angle=50)
    elif sharp is not None:
        smooth(ob, sharp)
    return ob


def ring(name, R, w, h, segs=32, mat=None, axis='Z', loc=(0, 0, 0), rot=(0, 0, 0), sharp=40):
    """Flat band / washer: radial width w, axial height h (rectangular cross-section)."""
    prof = [(R - w / 2, -h / 2), (R + w / 2, -h / 2), (R + w / 2, h / 2), (R - w / 2, h / 2), (R - w / 2, -h / 2)]
    ob = lathe(name, prof, segs, mat, axis, loc, rot, cap=False, sharp=sharp)
    recalc_normals(ob)
    smooth(ob, sharp)
    return ob


def sphere(name, r, loc=(0, 0, 0), mat=None, segs=12, rings=8, scale=None):
    prof = [(0, -r)] + [(r * math.sin(math.pi * i / rings), -r * math.cos(math.pi * i / rings))
                        for i in range(1, rings)] + [(0, r)]
    return lathe(name, prof, segs, mat, 'Z', loc, scale=scale, sharp=60)


def fillet(pts, rad, n=3):
    """Round the interior corners of a polyline with quadratic curves."""
    P = [Vector(p) for p in pts]
    out = [P[0]]
    for i in range(1, len(P) - 1):
        a, b, c = P[i - 1], P[i], P[i + 1]
        d1, d2 = (b - a), (c - b)
        r1 = min(rad, d1.length * 0.45)
        r2 = min(rad, d2.length * 0.45)
        p0 = b - d1.normalized() * r1
        p2 = b + d2.normalized() * r2
        for k in range(n + 1):
            t = k / n
            out.append((1 - t) ** 2 * p0 + 2 * (1 - t) * t * b + t * t * p2)
    out.append(P[-1])
    return out


def tube(name, pts, r, segs=8, mat=None, cap=True, closed=False, sharp=50):
    """Sweep a circle along a polyline (parallel-transport frames, mitred joints)."""
    P = [Vector(p) for p in pts]
    if closed:
        P = P + [P[0]]
    n = len(P)
    T = []
    for i in range(n):
        if closed and (i == 0 or i == n - 1):
            t = (P[1] - P[0]).normalized() + (P[-1] - P[-2]).normalized()
        elif i == 0:
            t = P[1] - P[0]
        elif i == n - 1:
            t = P[-1] - P[-2]
        else:
            t = (P[i + 1] - P[i]).normalized() + (P[i] - P[i - 1]).normalized()
        T.append(t.normalized())
    up = Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((1, 0, 0))
    N = (up - up.project(T[0])).normalized()
    verts, faces = [], []
    for i in range(n):
        if i > 0:
            N = (T[i - 1].rotation_difference(T[i]) @ N)
            N = (N - N.project(T[i])).normalized()
        B = T[i].cross(N)
        k_dir, scl = None, 1.0
        if 0 < i < n - 1 or closed:
            d1 = (P[i] - P[i - 1]).normalized() if i > 0 else (P[-1] - P[-2]).normalized()
            cosh = max(0.3, d1.dot(T[i]))
            scl = 1.0 / cosh
            kd = d1 - d1.project(T[i])
            if kd.length > 1e-6:
                k_dir = kd.normalized()
        for k in range(segs):
            a = 2 * math.pi * k / segs
            off = N * math.cos(a) * r + B * math.sin(a) * r
            if k_dir is not None:
                off = off + k_dir * off.dot(k_dir) * (scl - 1.0)
            verts.append(P[i] + off)
    for i in range(n - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            faces.append((i * segs + k, i * segs + k2, (i + 1) * segs + k2, (i + 1) * segs + k))
    if cap and not closed:
        faces.append(tuple(reversed(range(segs))))
        faces.append(tuple(range((n - 1) * segs, n * segs)))
    ob = new_obj(name, verts, faces, mat)
    if closed:
        recalc_normals(ob)
    smooth(ob, sharp)
    return ob


def text_mesh(name, body, size, depth, mat=None, offset=0.0, res=2, spacing=1.0, bevel_depth=0.0):
    """Text -> mesh, centred, lying in XY facing +Z, extruded +-depth/2."""
    cu = bpy.data.curves.new(name + '_crv', 'FONT')
    cu.body = body
    cu.size = size
    cu.extrude = depth / 2
    cu.offset = offset
    cu.resolution_u = res
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.space_character = spacing
    cu.bevel_depth = bevel_depth
    cu.bevel_resolution = 0
    tmp = link(bpy.data.objects.new(name + '_tmp', cu))
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg), depsgraph=dg)
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(cu)
    me.name = name
    ob = link(bpy.data.objects.new(name, me))
    me.materials.clear()
    if mat is not None:
        me.materials.append(mat)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(me)
    bm.free()
    flat(ob)
    return ob


def orient(ob, x_to, y_to, loc=(0, 0, 0)):
    """Rotate mesh so its local +X maps to x_to and +Y to y_to (both world vectors), then move."""
    X = Vector(x_to).normalized()
    Y = Vector(y_to).normalized()
    Z = X.cross(Y)
    mx = Matrix((X, Y, Z)).transposed().to_4x4()
    ob.data.transform(mx)
    xform(ob, loc)
    return ob


def dup(ob, name=None, loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    o2 = ob.copy()
    o2.data = ob.data.copy()
    o2.name = name or ob.name
    link(o2)
    if scale is not None:
        xform(o2, scale=scale)
    xform(o2, loc, rot)
    return o2


def mirror_x(ob, name=None):
    return dup(ob, name, scale=(-1, 1, 1))


def join(objs, name):
    objs = [o for o in objs if o is not None]
    base = objs[0]
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=base, object=base, selected_objects=objs,
                                       selected_editable_objects=objs):
            bpy.ops.object.join()
    base.name = name
    base.data.name = name
    return base


def assign_by(ob, mats, fn):
    """Per-face material: fn(face_center: Vector, face_normal: Vector) -> index into mats."""
    me = ob.data
    slot = {}
    for m in mats:
        if m.name not in [x.name for x in me.materials if x]:
            me.materials.append(m)
    names = [x.name for x in me.materials]
    for p in me.polygons:
        i = fn(p.center, p.normal)
        p.material_index = names.index(mats[i].name)
    return ob


def boolean_cut(ob, cutters, op='DIFFERENCE'):
    """Boolean with each cutter (applied), cut faces take the cutter's material; cutters are deleted."""
    for c in cutters:
        md = ob.modifiers.new('bool', 'BOOLEAN')
        md.operation = op
        for solver in ('EXACT', 'MANIFOLD', 'FAST'):
            try:
                md.solver = solver
                break
            except Exception:
                continue
        md.object = c
        try:
            md.material_mode = 'TRANSFER'
        except Exception:
            pass
        c.hide_render = True
        apply_mods(ob)
    for c in cutters:
        bpy.data.meshes.remove(c.data)
    return ob


def planar_uv(ob, fn):
    """UVs from a function of the loop's vertex position: fn(Vector co, Vector face_normal) -> (u, v)."""
    me = ob.data
    uvl = me.uv_layers.new(name='UVMap') if not me.uv_layers else me.uv_layers[0]
    for p in me.polygons:
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uvl.data[li].uv = fn(co, p.normal)
    return ob


def human_ref(x, y=0.0):
    """1.75 m mannequin placed next to props in preview renders only (never exported)."""
    mat = M('preview_human', '#8f9aa6', 0.7)
    parts = [cyl('h_legs', 0.13, 0.85, (x, y, 0.425), mat, segs=12),
             cyl('h_torso', 0.19, 0.62, (x, y, 1.16), mat, segs=12, r2=0.15),
             sphere('h_head', 0.11, (x, y, 1.64), mat, 12, 8)]
    ob = join(parts, 'preview_human')
    RENDER_HELPERS.append(ob)
    return ob


def empty(name, loc=(0, 0, 0), size=0.03):
    e = link(bpy.data.objects.new(name, None))
    e.empty_display_type = 'PLAIN_AXES'
    e.empty_display_size = size
    e.location = loc
    return e


def set_origin(ob, p):
    p = Vector(p)
    ob.data.transform(Matrix.Translation(-p))
    ob.location = p
    return ob


def shift_all(objs, off):
    off = Vector(off)
    for o in objs:
        if o.type == 'MESH':
            o.data.transform(Matrix.Translation(off))
        else:
            o.location = o.location + off


def assemble(root_name, children):
    root = empty(root_name, (0, 0, 0), 0.05)
    for c in children:
        c.parent = root
    return root


def tri_count(root):
    n = 0
    for o in [root] + list(root.children_recursive):
        if o.type == 'MESH':
            n += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return n


def export_glb(root, path, texcoords=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for o in bpy.context.scene.objects:
        o.select_set(False)
    objs = [root] + list(root.children_recursive)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_cameras=False, export_lights=False,
                              export_animations=False, export_extras=False, export_texcoords=texcoords,
                              export_normals=True, export_materials='EXPORT')
    return os.path.getsize(path)


# ---------- preview rendering ----------
def setup_render(res=(640, 640)):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    try:
        sc.eevee.taa_render_samples = 48
        sc.eevee.use_raytracing = True
        sc.eevee.use_shadows = True
    except Exception:
        pass
    for vt in ('Standard', 'AgX', 'Filmic'):
        try:
            sc.view_settings.view_transform = vt
            break
        except Exception:
            continue
    w = bpy.data.worlds.new('preview_world')
    sc.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = next((n for n in w.node_tree.nodes if n.type == 'BACKGROUND'), None)
    if bg is not None:
        bg.inputs[0].default_value = (0.50, 0.52, 0.55, 1.0)
        bg.inputs[1].default_value = 0.85
    sun = link(bpy.data.objects.new('preview_sun', bpy.data.lights.new('preview_sun', 'SUN')))
    sun.data.energy = 3.2
    sun.data.angle = math.radians(4)
    sun.rotation_euler = Euler((math.radians(48), 0, math.radians(-38)))
    fill = link(bpy.data.objects.new('preview_fill', bpy.data.lights.new('preview_fill', 'SUN')))
    fill.data.energy = 0.8
    fill.data.angle = math.radians(20)
    fill.rotation_euler = Euler((math.radians(70), 0, math.radians(150)))
    cam = link(bpy.data.objects.new('preview_cam', bpy.data.cameras.new('preview_cam')))
    sc.camera = cam
    RENDER_HELPERS.extend([sun, fill, cam])
    return cam


def bounds(root, extra=()):
    pts = []
    for o in [root] + list(root.children_recursive) + list(extra):
        if o.type == 'MESH':
            mw = o.matrix_world
            pts.extend(mw @ v.co for v in o.data.vertices)
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


def render_views(root, name, outdir, views, res=(640, 640), ground_z=None, fov=32, pad=1.08,
                 ground_col='#b9b7ae', extra=(), extra_views=()):
    """views: list of (azimuth_deg, elevation_deg); az 0 = looking from -Y (asset front for props).
    `extra` objects (e.g. a scale mannequin) are only visible/framed in the view indices `extra_views`."""
    os.makedirs(os.path.join(outdir, 'views'), exist_ok=True)
    bpy.context.view_layer.update()
    cam = setup_render(res)
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.angle_y = math.radians(fov)
    mn0, _ = bounds(root)
    gz = mn0.z if ground_z is None else ground_z
    gp = new_obj('preview_ground', [(-80, -80, gz), (80, -80, gz), (80, 80, gz), (-80, 80, gz)], [(0, 1, 2, 3)],
                 M('preview_ground', ground_col, 0.95, double=True))
    RENDER_HELPERS.append(gp)
    vh = math.radians(fov) / 2
    hh = math.atan(math.tan(vh) * res[0] / res[1])
    files = []
    for i, (az, el) in enumerate(views):
        show = i in extra_views
        for o in extra:
            o.hide_render = not show
        mn, mx = bounds(root, extra if show else ())
        c = (mn + mx) / 2
        corners = [Vector((x, y, z)) for x in (mn.x, mx.x) for y in (mn.y, mx.y) for z in (mn.z, mx.z)]
        a, e = math.radians(az), math.radians(el)
        d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
        q = (-d).to_track_quat('-Z', 'Y')
        right = q @ Vector((1, 0, 0))
        up = q @ Vector((0, 1, 0))
        dist = 0.0
        for p in corners:
            v = p - c
            depth = v.dot(d)
            dist = max(dist, depth + abs(v.dot(right)) * pad / math.tan(hh),
                       depth + abs(v.dot(up)) * pad / math.tan(vh))
        cam.location = c + d * dist
        cam.rotation_euler = q.to_euler()
        cam.data.clip_start = dist * 0.01
        cam.data.clip_end = dist * 10
        f = os.path.join(outdir, 'views', f'{name}_v{i}.png')
        bpy.context.scene.render.filepath = f
        bpy.ops.render.render(write_still=True)
        files.append(f)
    for o in RENDER_HELPERS:
        if o.name in bpy.data.objects:
            bpy.data.objects.remove(o)
    RENDER_HELPERS.clear()
    # strip into one image per asset
    sheet = os.path.join(outdir, f'{name}.png')
    args = [FFMPEG, '-v', 'error', '-y']
    for f in files:
        args += ['-i', f]
    args += ['-filter_complex', f'hstack=inputs={len(files)}' if len(files) > 1 else 'null', sheet]
    subprocess.run(args, check=False)
    return sheet, files


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    flags = {a for a in argv if a.startswith('--')}
    names = [a for a in argv if not a.startswith('--')]
    return names, flags


# ==== END COMMON ====

# =====================================================================================
# weapons
# =====================================================================================
OUT_DIR = os.path.join(PROJECT, 'public', 'models', 'weapons')
RENDER_DIR = os.path.join(HERE, '_renders', 'weapons')


def finish(name, parts, grip, named):
    """Shift so `grip` is the origin, parent everything under a root empty named `name`."""
    allobjs = parts + list(named.values())
    shift_all(allobjs, -Vector(grip))
    for key, ob in named.items():
        if ob.type == 'MESH':
            # origin of animated parts at their own centre (identity rotation)
            mn = Vector([min(v.co[i] for v in ob.data.vertices) for i in range(3)])
            mx = Vector([max(v.co[i] for v in ob.data.vertices) for i in range(3)])
            pivot = (mn + mx) / 2
            if key == 'magazine':
                pivot.z = mx.z          # magazine pivots at its top (insertion point)
            set_origin(ob, pivot)
    return assemble(name, allobjs)


# ----------------------------------------------------------------------------- pistol
def build_pistol():
    slideM = M('pistol_slide', '#3a3d42', 0.32, 0.8)
    frameM = M('pistol_frame', '#232427', 0.7, 0.0)
    darkM = M('pistol_dark', '#0b0b0c', 0.45, 0.4)
    magM = M('pistol_mag', '#1a1b1d', 0.55, 0.2)
    # slide (moves back on fire)
    s_body = prism('slide_body', [(-0.031, 0.040), (0.160, 0.040), (0.160, 0.064), (0.153, 0.0715),
                                  (-0.025, 0.0715), (-0.031, 0.066)], 'X', -0.0155, 0.0155, slideM, 0.0028, 2)
    port = box('port', (0.004, 0.042, 0.011), (0.0142, 0.062, 0.064), darkM)
    fsight = box('fsight', (0.0045, 0.007, 0.0055), (0, 0.150, 0.074), darkM, 0.001)
    rsight = box('rsight', (0.018, 0.007, 0.0055), (0, -0.019, 0.074), darkM, 0.001)
    notch = box('rnotch', (0.004, 0.0072, 0.004), (0, -0.019, 0.077), slideM)
    bore = cyl('bore', 0.0062, 0.004, (0, 0.1605, 0.0555), darkM, 'Y', 12)
    serr = [box(f'serr{i}', (0.0322, 0.0018, 0.022), (0, -0.026 + i * 0.0045, 0.0555), darkM) for i in range(5)]
    slide = join([s_body, port, fsight, rsight, notch, bore] + serr, 'slide')
    # frame + grip
    frame = prism('frame', [(0.152, 0.041), (0.152, 0.027), (0.066, 0.025), (0.040, 0.022), (0.031, 0.016),
                            (0.027, 0.006), (0.012, -0.057), (0.008, -0.066), (-0.036, -0.066), (-0.041, -0.059),
                            (-0.025, 0.026), (-0.037, 0.031), (-0.039, 0.037), (-0.031, 0.041)],
                  'X', -0.0145, 0.0145, frameM, 0.003, 2)
    rail = box('rail', (0.022, 0.03, 0.006), (0, 0.125, 0.025), frameM, 0.0015)
    guard = prism('guard', [(0.069, 0.026), (0.069, 0.006), (0.061, -0.004), (0.024, -0.004),
                            (0.025, 0.002), (0.056, 0.002), (0.063, 0.009), (0.063, 0.025)],
                  'X', -0.0065, 0.0065, frameM, 0.0015, 1)
    trigger = prism('trigger', [(0.041, 0.022), (0.047, 0.022), (0.045, 0.011), (0.041, 0.004), (0.038, 0.006),
                                (0.041, 0.012)], 'X', -0.003, 0.003, darkM)
    # texture panel on grip sides (slightly raised stipple patch)
    patch_pts = [(0.022, 0.002), (0.010, -0.050), (-0.032, -0.050), (-0.022, 0.006)]
    patchL = prism('patchL', patch_pts, 'X', -0.0152, -0.0140, magM)
    patchR = prism('patchR', patch_pts, 'X', 0.0140, 0.0152, magM)
    body = join([frame, rail, guard, trigger, patchL, patchR], 'pistol_body')
    # magazine (inside grip; baseplate visible)
    m_body = prism('mag_body', [(0.021, 0.014), (0.009, -0.064), (-0.035, -0.064), (-0.022, 0.014)],
                   'X', -0.011, 0.011, magM)
    m_base = prism('mag_base', [(0.011, -0.063), (0.011, -0.0725), (-0.040, -0.0725), (-0.040, -0.063)],
                   'X', -0.0150, 0.0150, magM, 0.0018)
    mag = join([m_body, m_base], 'magazine')
    muzzle = empty('muzzle', (0, 0.162, 0.0555))
    lhg = empty('leftHandGrip', (-0.017, 0.016, -0.018))
    return finish('pistol', [body], (0, -0.006, -0.012),
                  {'slide': slide, 'magazine': mag, 'muzzle': muzzle, 'leftHandGrip': lhg})


# ----------------------------------------------------------------------------- shotgun
def build_shotgun():
    metalM = M('sg_metal', '#2a2c30', 0.35, 0.8)
    darkM = M('sg_dark', '#0d0d0e', 0.5, 0.4)
    woodM = M('sg_wood', '#7a4524', 0.5, 0.0)
    padM = M('sg_pad', '#141414', 0.9, 0.0)
    brassM = M('sg_bead', '#d8b45a', 0.3, 1.0)
    # receiver
    recv = prism('recv', [(0.020, 0.004), (0.245, 0.004), (0.245, 0.061), (0.234, 0.070), (0.050, 0.070),
                          (0.020, 0.063)], 'X', -0.0175, 0.0175, metalM, 0.0035, 2)
    port = box('port', (0.004, 0.07, 0.022), (0.0162, 0.140, 0.046), darkM)
    guard = prism('guard', [(0.035, 0.006), (0.038, -0.020), (0.050, -0.032), (0.100, -0.032), (0.112, -0.020),
                            (0.115, 0.006), (0.108, 0.006), (0.106, -0.016), (0.097, -0.025), (0.053, -0.025),
                            (0.045, -0.016), (0.042, 0.006)], 'X', -0.0075, 0.0075, metalM, 0.002)
    trig = prism('trig', [(0.070, 0.005), (0.077, 0.005), (0.074, -0.010), (0.068, -0.018), (0.065, -0.015),
                          (0.069, -0.006)], 'X', -0.003, 0.003, darkM)
    barrel = lathe('barrel', [(0.0, 0.245), (0.0130, 0.245), (0.0130, 0.740), (0.0085, 0.740), (0.0085, 0.735),
                              (0.0, 0.735)], 16, metalM, 'Y', (0, 0, 0.047), sharp=40)
    xform(barrel, (0, 0, 0))
    rib = box('rib', (0.0065, 0.49, 0.005), (0, 0.492, 0.0625), metalM, 0.0012)
    bead = sphere('bead', 0.0032, (0, 0.733, 0.067), brassM, 8, 5)
    clamp = lathe('clamp', [(0.0, -0.008), (0.021, -0.008), (0.021, 0.008), (0.0, 0.008)], 12, metalM, 'Y',
                  (0, 0.672, 0.032), scale=(0.75, 1, 1.45))
    # stock (wood) + butt pad
    stock_pts = [(0.024, 0.063), (-0.030, 0.058), (-0.200, 0.048), (-0.352, 0.040), (-0.364, 0.030),
                 (-0.378, -0.098), (-0.250, -0.068), (-0.130, -0.046), (-0.075, -0.042), (-0.040, -0.034),
                 (-0.012, -0.018), (0.010, -0.004), (0.024, 0.004)]
    stock = prism('stock', stock_pts, 'X', -0.020, 0.020, woodM, 0.006, 2,
                  taper=(1, 0.0, 0.75, -0.36, 1.12))
    pad = prism('pad', [(-0.351, 0.041), (-0.372, 0.041), (-0.393, -0.101), (-0.373, -0.099)], 'X',
                -0.0235, 0.0235, padM, 0.004, 2)
    body = join([recv, port, guard, trig, barrel, rib, bead, clamp, stock, pad], 'shotgun_body')
    # magazine tube (separate for reload anim)
    mag = lathe('magazine', [(0.0, 0.230), (0.0115, 0.230), (0.0115, 0.700), (0.0128, 0.700), (0.0128, 0.716),
                             (0.0090, 0.720), (0.0, 0.720)], 14, metalM, 'Y', (0, 0, 0.018), sharp=40)
    # pump forend (the "slide": moves back on fire / pump)
    prof = [(0.0, 0.335)]
    y = 0.335
    ribs = 8
    L = 0.20
    for i in range(ribs):
        y0 = 0.335 + L * i / ribs
        y1 = 0.335 + L * (i + 0.62) / ribs
        y2 = 0.335 + L * (i + 1) / ribs
        prof += [(0.0245, y0 + 0.002), (0.0245, y1), (0.0215, y1 + 0.003), (0.0215, y2 - 0.002)]
    prof[1] = (0.0215, 0.335)
    prof += [(0.0215, 0.535), (0.0, 0.535)]
    pump = lathe('pump', prof, 14, woodM, 'Y', (0, 0, 0.024), scale=(1.12, 1, 1.0), sharp=40)
    barL = box('barL', (0.003, 0.14, 0.006), (-0.0135, 0.29, 0.028), metalM)
    barR = box('barR', (0.003, 0.14, 0.006), (0.0135, 0.29, 0.028), metalM)
    slide = join([pump, barL, barR], 'slide')
    muzzle = empty('muzzle', (0, 0.742, 0.047))
    lhg = empty('leftHandGrip', (-0.016, 0.435, 0.004))
    return finish('shotgun', [body], (0, -0.002, 0.024),
                  {'slide': slide, 'magazine': mag, 'muzzle': muzzle, 'leftHandGrip': lhg})


# ----------------------------------------------------------------------------- rifle
def build_rifle():
    metalM = M('rf_metal', '#33363b', 0.38, 0.75)
    darkM = M('rf_dark', '#0c0c0d', 0.5, 0.4)
    polyM = M('rf_polymer', '#1e1f1d', 0.72, 0.0)
    magM = M('rf_mag', '#c97a26', 0.28, 0.0)          # translucent-amber look, solid
    magBaseM = M('rf_mag_base', '#8a4f16', 0.4, 0.0)
    # receiver
    recv = prism('recv', [(-0.100, 0.030), (0.175, 0.030), (0.175, 0.094), (0.168, 0.101), (-0.085, 0.106),
                          (-0.100, 0.098)], 'X', -0.0195, 0.0195, metalM, 0.0055, 2)
    port = box('port', (0.004, 0.075, 0.018), (0.0180, 0.070, 0.079), darkM)
    rsight = prism('rsight', [(-0.080, 0.100), (-0.045, 0.101), (-0.047, 0.118), (-0.075, 0.116)], 'X',
                   -0.013, 0.013, metalM, 0.002)
    selector = box('selector', (0.003, 0.05, 0.009), (0.0205, -0.045, 0.074), darkM, 0.001)
    grip = prism('grip', [(-0.036, 0.032), (0.004, 0.032), (0.000, 0.010), (-0.019, -0.077), (-0.052, -0.080),
                          (-0.055, -0.070), (-0.040, 0.000)], 'X', -0.0165, 0.0165, polyM, 0.004, 2)
    guard = prism('guard', [(0.005, 0.031), (0.004, 0.008), (0.012, 0.000), (0.060, 0.000), (0.068, 0.008),
                            (0.070, 0.031), (0.063, 0.031), (0.062, 0.013), (0.057, 0.007), (0.015, 0.007),
                            (0.011, 0.013), (0.012, 0.031)], 'X', -0.0065, 0.0065, metalM, 0.0015)
    trig = prism('trig', [(0.030, 0.031), (0.036, 0.031), (0.034, 0.019), (0.030, 0.011), (0.027, 0.013),
                          (0.030, 0.021)], 'X', -0.003, 0.003, darkM)
    # handguard (polymer) with vent slots
    hg = prism('handguard', rrect(0.050, 0.078, 0.019, 2, 0, 0.083), 'Y', 0.175, 0.415, polyM, 0.004, 1, 50)
    vents = []
    for side in (-1, 1):
        for i in range(4):
            vents.append(box(f'vent{side}{i}', (0.004, 0.036, 0.010),
                             (side * 0.0243, 0.205 + i * 0.055, 0.088), darkM, 0.0012))
    cap = cyl('hgcap', 0.021, 0.014, (0, 0.420, 0.080), metalM, 'Y', 14)
    barrel = cyl('barrel', 0.0095, 0.18, (0, 0.505, 0.080), metalM, 'Y', 12)
    gastube = cyl('gastube', 0.0085, 0.06, (0, 0.445, 0.108), metalM, 'Y', 10)
    gblock = box('gblock', (0.026, 0.040, 0.040), (0, 0.475, 0.094), metalM, 0.003)
    fs_base = prism('fs_base', [(0.462, 0.112), (0.488, 0.112), (0.484, 0.128), (0.466, 0.128)], 'X',
                    -0.012, 0.012, metalM, 0.0015)
    earL = box('earL', (0.0035, 0.018, 0.030), (-0.0105, 0.475, 0.140), metalM, 0.001)
    earR = box('earR', (0.0035, 0.018, 0.030), (0.0105, 0.475, 0.140), metalM, 0.001)
    post = box('post', (0.0025, 0.004, 0.022), (0, 0.475, 0.137), darkM)
    hider = lathe('hider', [(0.0, 0.590), (0.0125, 0.590), (0.0125, 0.600), (0.0108, 0.603), (0.0108, 0.609),
                            (0.0125, 0.612), (0.0125, 0.622), (0.0108, 0.625), (0.0108, 0.631), (0.0125, 0.634),
                            (0.0125, 0.645), (0.0070, 0.645), (0.0070, 0.640), (0.0, 0.640)], 14, metalM, 'Y',
                  (0, 0, 0.080), sharp=40)
    stock = prism('stock', [(-0.098, 0.101), (-0.200, 0.097), (-0.300, 0.093), (-0.368, 0.090), (-0.378, 0.082),
                            (-0.380, -0.048), (-0.366, -0.054), (-0.290, -0.030), (-0.215, -0.004),
                            (-0.160, 0.018), (-0.125, 0.030), (-0.098, 0.034)], 'X', -0.019, 0.019, polyM,
                  taper=(1, -0.10, 0.82, -0.37, 1.08))
    # skeleton cut-out through the stock (reads at distance, breaks up the slab)
    hole = prism('stock_hole', [(-0.335, 0.052), (-0.330, 0.020), (-0.305, -0.004), (-0.200, 0.030), (-0.185, 0.050),
                                (-0.195, 0.062), (-0.320, 0.064)], 'X', -0.05, 0.05, darkM)
    boolean_cut(stock, [hole])
    bevel(stock, 0.005, 2)
    riser = prism('riser', [(-0.150, 0.098), (-0.330, 0.093), (-0.320, 0.106), (-0.170, 0.108)], 'X', -0.016,
                  0.016, polyM, 0.004, 2)
    pad = prism('pad', [(-0.377, 0.091), (-0.394, 0.091), (-0.396, -0.058), (-0.377, -0.052)], 'X', -0.0215,
                0.0215, darkM, 0.004, 2)
    swivel = ring('swivel', 0.009, 0.003, 0.004, 10, metalM, 'X', (0, -0.300, -0.036))
    body = join([recv, port, rsight, selector, grip, guard, trig, hg] + vents +
                [cap, barrel, gastube, gblock, fs_base, earL, earR, post, hider, stock, riser, pad, swivel], 'rifle_body')
    # curved magazine
    C = Vector((0.600, 0.040))
    R1, R2 = 0.540, 0.480
    back, front = [], []
    steps = 7
    th_max = math.radians(22.5)
    for i in range(steps + 1):
        th = th_max * i / steps
        back.append((C.x - R1 * math.cos(th), C.y - R1 * math.sin(th)))
        front.append((C.x - R2 * math.cos(th), C.y - R2 * math.sin(th)))
    mag_pts = [(back[0][0], 0.066)] + back + list(reversed(front)) + [(front[0][0], 0.066)]
    m_body = prism('mag_body', mag_pts, 'X', -0.0135, 0.0135, magM, 0.003, 1)
    thb = math.radians(21.0)
    base_pts = [(C.x - (R1 + 0.004) * math.cos(thb), C.y - (R1 + 0.004) * math.sin(thb)),
                (C.x - (R1 + 0.004) * math.cos(th_max + 0.012), C.y - (R1 + 0.004) * math.sin(th_max + 0.012)),
                (C.x - (R2 - 0.004) * math.cos(th_max + 0.012), C.y - (R2 - 0.004) * math.sin(th_max + 0.012)),
                (C.x - (R2 - 0.004) * math.cos(thb), C.y - (R2 - 0.004) * math.sin(thb))]
    m_base = prism('mag_base', base_pts, 'X', -0.0155, 0.0155, magBaseM, 0.002)
    ribs = []
    for i, th in enumerate((6.0, 11.0, 16.0)):
        t = math.radians(th)
        rp = [(C.x - (R1 + 0.0) * math.cos(t - 0.004), C.y - (R1 + 0.0) * math.sin(t - 0.004)),
              (C.x - (R1 + 0.0) * math.cos(t + 0.004), C.y - (R1 + 0.0) * math.sin(t + 0.004)),
              (C.x - R2 * math.cos(t + 0.004), C.y - R2 * math.sin(t + 0.004)),
              (C.x - R2 * math.cos(t - 0.004), C.y - R2 * math.sin(t - 0.004))]
        ribs.append(prism(f'mag_rib{i}', rp, 'X', -0.0145, 0.0145, magBaseM))
    mag = join([m_body, m_base] + ribs, 'magazine')
    # bolt carrier + cocking handle (right side, moves back on fire)
    carrier = box('carrier', (0.003, 0.070, 0.012), (0.0205, 0.072, 0.079), metalM)
    arm = cyl('arm', 0.0045, 0.026, (0.033, 0.100, 0.080), metalM, 'X', 8)
    knob = sphere('knob', 0.0085, (0.047, 0.100, 0.080), metalM, 10, 6)
    bolt = join([carrier, arm, knob], 'bolt')
    muzzle = empty('muzzle', (0, 0.645, 0.080))
    lhg = empty('leftHandGrip', (-0.012, 0.300, 0.040))
    return finish('rifle', [body], (0, -0.026, -0.022),
                  {'bolt': bolt, 'magazine': mag, 'muzzle': muzzle, 'leftHandGrip': lhg})


# ----------------------------------------------------------------------------- smg (optional)
def build_smg():
    metalM = M('smg_metal', '#2f3236', 0.38, 0.75)
    darkM = M('smg_dark', '#0c0c0d', 0.5, 0.4)
    polyM = M('smg_polymer', '#1d1e20', 0.7, 0.0)
    magM = M('smg_mag', '#26282b', 0.45, 0.6)
    recv = prism('recv', rrect(0.036, 0.058, 0.014, 2, 0, 0.074), 'Y', -0.085, 0.205, metalM, 0.003, 1, 50)
    port = box('port', (0.004, 0.05, 0.016), (0.0168, 0.080, 0.080), darkM)
    rdrum = lathe('rdrum', [(0.0, -0.009), (0.013, -0.009), (0.013, 0.009), (0.0, 0.009)], 12, metalM, 'X',
                  (0, -0.060, 0.108))
    rbase = box('rbase', (0.020, 0.03, 0.012), (0, -0.060, 0.100), metalM, 0.002)
    grip = prism('grip', [(-0.036, 0.047), (0.004, 0.047), (0.000, 0.022), (-0.018, -0.066), (-0.050, -0.069),
                          (-0.053, -0.059), (-0.040, 0.012)], 'X', -0.0165, 0.0165, polyM, 0.004, 2)
    lower = prism('lower', [(-0.060, 0.047), (0.075, 0.047), (0.070, 0.036), (-0.050, 0.036)], 'X', -0.017, 0.017,
                  polyM, 0.003)
    guard = prism('guard', [(0.005, 0.037), (0.004, 0.018), (0.012, 0.010), (0.060, 0.010), (0.068, 0.018),
                            (0.070, 0.037), (0.063, 0.037), (0.062, 0.022), (0.057, 0.017), (0.015, 0.017),
                            (0.011, 0.022), (0.012, 0.037)], 'X', -0.0065, 0.0065, polyM, 0.0015)
    trig = prism('trig', [(0.030, 0.037), (0.036, 0.037), (0.034, 0.026), (0.030, 0.019), (0.027, 0.021),
                          (0.030, 0.028)], 'X', -0.003, 0.003, darkM)
    hg = loft('handguard', [lift(rrect(0.044, 0.050, 0.016, 2, 0, 0.066), 'Y', 0.205),
                            lift(rrect(0.050, 0.056, 0.018, 2, 0, 0.064), 'Y', 0.250),
                            lift(rrect(0.046, 0.050, 0.016, 2, 0, 0.066), 'Y', 0.345)], polyM)
    bevel(hg, 0.003, 1, 50)
    ctube = cyl('ctube', 0.0095, 0.17, (0, 0.285, 0.104), metalM, 'Y', 12)
    fsring = ring('fsring', 0.0125, 0.004, 0.012, 14, metalM, 'Y', (0, 0.352, 0.122))
    fspost = box('fspost', (0.018, 0.012, 0.012), (0, 0.352, 0.110), metalM, 0.002)
    barrel = cyl('barrel', 0.009, 0.06, (0, 0.375, 0.066), metalM, 'Y', 12)
    lugs = lathe('lugs', [(0.0, 0.395), (0.0125, 0.395), (0.0125, 0.412), (0.0065, 0.412), (0.0, 0.412)], 12,
                 metalM, 'Y', (0, 0, 0.066), sharp=40)
    rodL = cyl('rodL', 0.0045, 0.21, (-0.014, -0.180, 0.078), metalM, 'Y', 8)
    rodR = cyl('rodR', 0.0045, 0.21, (0.014, -0.180, 0.078), metalM, 'Y', 8)
    butt = prism('butt', [(-0.300, 0.100), (-0.282, 0.100), (-0.282, 0.020), (-0.300, 0.012)], 'X', -0.020,
                 0.020, polyM, 0.004, 2)
    body = join([recv, port, rdrum, rbase, grip, lower, guard, trig, hg, ctube, fsring, fspost, barrel, lugs,
                 rodL, rodR, butt], 'smg_body')
    C = Vector((0.90, 0.060))
    R1, R2 = 0.820, 0.785
    back, front = [], []
    steps = 5
    th_max = math.radians(12.5)
    for i in range(steps + 1):
        th = th_max * i / steps
        back.append((C.x - R1 * math.cos(th), C.y - R1 * math.sin(th)))
        front.append((C.x - R2 * math.cos(th), C.y - R2 * math.sin(th)))
    mag_pts = [(back[0][0], 0.070)] + back + list(reversed(front)) + [(front[0][0], 0.070)]
    m_body = prism('mag_body', mag_pts, 'X', -0.0115, 0.0115, magM, 0.002)
    tb = th_max
    base = box('mag_base', (0.026, 0.044, 0.008), (0, C.x - (R1 + R2) / 2 * math.cos(tb),
                                                      C.y - (R1 + R2) / 2 * math.sin(tb) - 0.003), darkM, 0.0015)
    mag = join([m_body, base], 'magazine')
    arm = box('carm', (0.004, 0.012, 0.010), (-0.0115, 0.300, 0.104), metalM)
    lever = prism('lever', [(0.292, 0.100), (0.306, 0.100), (0.316, 0.128), (0.304, 0.130)], 'X', -0.018, -0.012,
                  metalM, 0.0015)
    bolt = join([arm, lever], 'bolt')
    muzzle = empty('muzzle', (0, 0.412, 0.066))
    lhg = empty('leftHandGrip', (-0.012, 0.270, 0.032))
    return finish('smg', [body], (0, -0.026, -0.010),
                  {'bolt': bolt, 'magazine': mag, 'muzzle': muzzle, 'leftHandGrip': lhg})


# ----------------------------------------------------------------------------- cricket bat
def build_cricket_bat():
    """Blade toward +Y (three.js -Z). Face (hitting side) toward -X, spine/bulge toward +X, edges up/down."""
    willowM = M('bat_willow', '#e4cb93', 0.62, 0.0)
    gripA = M('bat_grip', '#b3172b', 0.9, 0.0)
    gripB = M('bat_grip_dark', '#6e0d1a', 0.9, 0.0)
    capM = M('bat_cap', '#1a1a1a', 0.8, 0.0)
    stickerM = M('bat_sticker', '#12305c', 0.45, 0.0)
    textM = M('bat_text', '#f0c43a', 0.35, 0.3)
    stripeM = M('bat_stripe', '#b3172b', 0.45, 0.0)
    # handle: banded rubber grip (lathe along Y), oval-ish
    y_top, y_bot = -0.225, 0.095
    bands = 14
    handle_parts = []
    HX = -0.003          # handle axis sits slightly toward the face
    cap = lathe('cap', [(0.0, y_top - 0.012), (0.0150, y_top - 0.012), (0.0190, y_top - 0.004), (0.0190, y_top + 0.002),
                        (0.0, y_top + 0.002)], 16, capM, 'Y', loc=(HX, 0, 0), scale=(0.95, 1, 1.05))
    handle_parts.append(cap)
    for i in range(bands):
        y0 = y_top + (y_bot - y_top) * i / bands
        y1 = y_top + (y_bot - y_top) * (i + 1) / bands
        r = 0.0172
        seg = lathe(f'band{i}', [(r * 0.97, y0), (r, y0 + 0.003), (r, y1 - 0.003), (r * 0.97, y1)], 16,
                    gripA if i % 2 == 0 else gripB, 'Y', loc=(HX, 0, 0), scale=(0.95, 1, 1.05), cap=True)
        handle_parts.append(seg)
    # blade: loft of cross-sections (x, z); face flat at x=-0.021
    def sect(y, half_w, spine, edge_t, face=-0.021):
        e = face + edge_t
        pts = [(face, -half_w * 0.96), (face + 0.002, -half_w), (e, -half_w), (e + (spine - e) * 0.55, -half_w * 0.55),
               (spine, 0.0), (e + (spine - e) * 0.55, half_w * 0.55), (e, half_w), (face + 0.002, half_w),
               (face, half_w * 0.96), (face, 0.0)]
        return [(x, y, z) for x, z in pts]

    def s_small(y, r):
        pts = []
        for k in range(10):
            a = 2 * math.pi * k / 10 + math.pi
            pts.append((r * math.cos(a) * 0.95 - 0.002, y, r * math.sin(a) * 1.05))
        return pts

    secs = [
        sect(0.070, 0.0150, 0.010, 0.022, face=-0.0155),
        sect(0.092, 0.0300, 0.016, 0.030, face=-0.0195),
        sect(0.118, 0.0490, 0.022, 0.032),
        sect(0.135, 0.054, 0.024, 0.033),
        sect(0.250, 0.054, 0.030, 0.035),
        sect(0.400, 0.054, 0.040, 0.038),
        sect(0.500, 0.054, 0.046, 0.040),
        sect(0.580, 0.0535, 0.040, 0.039),
        sect(0.625, 0.051, 0.030, 0.036),
        sect(0.640, 0.044, 0.024, 0.033),
    ]
    blade = loft('blade', secs, willowM)
    bevel(blade, 0.002, 1, 35)
    # sticker panel on the face with "PESU", plus stripes
    face_x = -0.021
    sticker = box('sticker', (0.0012, 0.16, 0.072), (face_x - 0.0004, 0.300, 0.0), stickerM, 0.0004)
    txt = text_mesh('bat_text', 'PESU', 0.050, 0.0008, textM, offset=0.0012, res=2, spacing=1.05)
    orient(txt, (0, -1, 0), (0, 0, 1), (face_x - 0.0012, 0.300, 0.0))
    stripe1 = box('stripe1', (0.0012, 0.012, 0.1045), (face_x - 0.0004, 0.195, 0.0), stripeM)
    stripe2 = box('stripe2', (0.0012, 0.012, 0.1045), (face_x - 0.0004, 0.405, 0.0), stripeM)
    toe_st = box('toe_sticker', (0.0012, 0.05, 0.08), (face_x - 0.0004, 0.575, 0.0), stickerM, 0.0004)
    toe_txt = text_mesh('toe_text', 'PESU', 0.018, 0.0008, textM, offset=0.0006, res=2)
    orient(toe_txt, (0, -1, 0), (0, 0, 1), (face_x - 0.0012, 0.575, 0.0))
    body = join(handle_parts + [blade, sticker, txt, stripe1, stripe2, toe_st, toe_txt], 'cricket_bat_body')
    tip = empty('tip', (0.0, 0.640, 0.0))
    lhg = empty('leftHandGrip', (0.0, -0.120, 0.0))
    return finish('cricket_bat', [body], (0, 0.0, 0.0), {'tip': tip, 'leftHandGrip': lhg})


WEAPONS = {
    'pistol': (build_pistol, [(90, 4), (135, 22), (35, 18)]),
    'shotgun': (build_shotgun, [(90, 4), (140, 22), (35, 18)]),
    'rifle': (build_rifle, [(90, 4), (140, 22), (35, 18)]),
    'smg': (build_smg, [(90, 4), (140, 22), (35, 18)]),
    'cricket_bat': (build_cricket_bat, [(-90, 4), (90, 8), (140, 25)]),
}


def main():
    names, flags = parse_args()
    names = names or list(WEAPONS.keys())
    report = []
    for name in names:
        t0 = time.time()
        reset()
        fn, views = WEAPONS[name]
        root = fn()
        bpy.context.view_layer.update()
        tris = tri_count(root)
        path = os.path.join(OUT_DIR, f'{name}.glb')
        size = export_glb(root, path)
        nodes = sorted(o.name for o in root.children_recursive if o.name in
                       ('muzzle', 'magazine', 'slide', 'bolt', 'leftHandGrip', 'tip'))
        if '--no-render' not in flags:
            render_views(root, name, RENDER_DIR, views, res=(720, 480), fov=30, pad=1.02)
        report.append((name, tris, size, nodes, time.time() - t0))
        print(f'[weapons] {name}: {tris} tris, {size / 1024:.1f} KB, nodes={nodes}')
    print('\n[weapons] SUMMARY')
    for name, tris, size, nodes, dt in report:
        print(f'[weapons] {name:12s} tris={tris:5d} size={size / 1024:7.1f}KB nodes={",".join(nodes)} ({dt:.1f}s)')


if __name__ == '__main__':
    main()
