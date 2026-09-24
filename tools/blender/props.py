"""
Pesident Evil -- procedural campus prop generator (Blender 5.2, headless).

Run from the project root:
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/props.py
    ... -P tools/blender/props.py -- auto_rickshaw bench     (build a subset)
    ... -P tools/blender/props.py -- --no-render             (skip preview renders)

Writes public/models/props/<name>.glb, preview strips to tools/blender/_renders/props/<name>.png and a
contact sheet tools/blender/_renders/props/_contact_sheet.png.

Contract (docs/ARCHITECTURE.md, "Props"): origin at the base centre (ground y = 0), facing +Z in glTF
(= Blender -Y), metres, <= 6k triangles (bus <= 10k). Everything is generated from scratch -- no downloads.
Design coordinates below are Blender: +X = prop's left when looking at its front, -Y = front, +Z = up.
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
# props
# =====================================================================================
OUT_DIR = os.path.join(PROJECT, 'public', 'models', 'props')
RENDER_DIR = os.path.join(HERE, '_renders', 'props')


def finish_prop(name, parts, nodes=()):
    body = join(parts, name + '_mesh')
    return assemble(name, [body] + list(nodes))


def wheel(name, r, w, loc, tyreM, rimM, hubM=None, segs=20, rim_frac=0.62, spokes=0, outward=1):
    """Wheel on an X axle. outward=+1: the rim face looks toward +X; -1 toward -X."""
    rr = r * rim_frac
    tyre = lathe(name + '_tyre', [(rr * 0.99, -w * 0.40), (r * 0.90, -w * 0.5), (r, -w * 0.30), (r, w * 0.30),
                                  (r * 0.90, w * 0.5), (rr * 0.99, w * 0.40), (rr * 0.99, -w * 0.40)],
                 segs, tyreM, 'X', cap=False, sharp=50)
    recalc_normals(tyre)
    smooth(tyre, 50)
    rim = lathe(name + '_rim', [(0.0, -w * 0.20), (rr, -w * 0.38), (rr, w * 0.40), (rr * 0.86, w * 0.36),
                                (rr * 0.30, w * 0.18), (0.0, w * 0.22)], segs, rimM, 'X', sharp=40)
    parts = [tyre, rim]
    if hubM is not None:
        parts.append(cyl(name + '_hub', rr * 0.26, w * 0.08, (w * 0.25, 0, 0), hubM, 'X', 10))
    for k in range(spokes):
        a = 2 * math.pi * k / spokes
        sp = box(name + f'_sp{k}', (w * 0.10, rr * 0.16, rr * 0.62), (w * 0.33, 0, rr * 0.52), rimM)
        xform(sp, rot=(a, 0, 0))
        parts.append(sp)
    wh = join(parts, name)
    if outward < 0:
        xform(wh, scale=(-1, 1, 1))
    xform(wh, loc)
    return wh


def arc_band(name, center_yz, r0, r1, a0, a1, x0, x1, mat, n=10, bev=0.0):
    """Arc-shaped band in the YZ plane (angles in degrees, 0 = +Y, 90 = +Z), extruded along X."""
    cy, cz = center_yz
    outer = [(cy + r1 * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
              cz + r1 * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]
    inner = [(cy + r0 * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
              cz + r0 * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]
    return prism(name, outer + list(reversed(inner)), 'X', x0, x1, mat, bev, 1)


# ----------------------------------------------------------------------------- PES globe
def build_pes_globe():
    gold = M('gold', '#C9A23A', 0.30, 1.0)
    goldP = M('gold_letters', '#E0B84C', 0.20, 1.0)
    granite = M('granite_dark', '#4a4847', 0.45, 0.0)
    graniteL = M('granite', '#8a8680', 0.55, 0.0)
    S = 40
    parts = [
        lathe('plinth_base', [(0, 0), (1.52, 0), (1.52, 0.10), (1.47, 0.14), (0, 0.14)], S, granite),
        lathe('plinth_drum', [(0, 0.14), (1.34, 0.14), (1.34, 0.50), (0, 0.50)], S, graniteL),
        lathe('plinth_cap', [(0, 0.50), (1.40, 0.50), (1.40, 0.555), (1.35, 0.60), (0, 0.60)], S, granite),
        lathe('pedestal', [(0, 0.60), (0.34, 0.60), (0.34, 0.64), (0.16, 0.70), (0.11, 0.80), (0.20, 0.86),
                           (0, 0.86)], 20, gold),
    ]
    R, zc = 1.10, 1.94
    # longitude rings (great circles through the vertical axis)
    for k in range(6):
        rg = ring(f'mer{k}', R, 0.055, 0.09, S, gold, 'Y', sharp=40)
        xform(rg, rot=(0, 0, math.radians(15 + 30 * k)))
        xform(rg, (0, 0, zc))
        parts.append(rg)
    # latitude bands
    for lat, h in ((0, 0.15), (32, 0.10), (-32, 0.10), (62, 0.09), (-62, 0.09)):
        la = math.radians(lat)
        parts.append(ring(f'lat{lat}', R * math.cos(la), 0.06, h, S, gold, 'Z', (0, 0, zc + R * math.sin(la)),
                          sharp=40))
    parts.append(cyl('axis', 0.035, 2 * R + 0.20, (0, 0, zc), gold, 'Z', 10))
    parts.append(sphere('pole_top', 0.09, (0, 0, zc + R + 0.08), gold, 12, 8))
    # "PES" letters wrapped on the front of the globe
    txt = text_mesh('pes_text', 'PES', 0.95, 0.16, goldP, offset=0.045, res=3, spacing=1.12)
    orient(txt, (1, 0, 0), (0, 0, 1))
    Rb = R + 0.12
    for v in txt.data.vertices:
        x, y, z = v.co
        th = x / Rb
        rho = Rb - y
        v.co = (rho * math.sin(th), -rho * math.cos(th), z + zc)
    txt.data.update()
    # letter backing brackets so the text visibly attaches to the equator band
    for x in (-0.55, 0.0, 0.55):
        th = x / Rb
        br = box(f'bracket{x}', (0.06, 0.16, 0.05), (0, 0, 0), gold)
        xform(br, (0, -(R + 0.02), 0))
        xform(br, rot=(0, 0, th))
        xform(br, (0, 0, zc - 0.20))
        parts.append(br)
    parts.append(txt)
    return finish_prop('pes_globe', parts)


# ----------------------------------------------------------------------------- auto-rickshaw
def build_auto_rickshaw():
    green = M('auto_green', '#1d7a3c', 0.42, 0.1)
    yellow = M('auto_yellow', '#f3c416', 0.40, 0.05)
    canvas = M('auto_canvas', '#161616', 0.92, 0.0)
    black = M('auto_black', '#0f0f0f', 0.55, 0.2)
    chrome = M('auto_chrome', '#c9cdd2', 0.22, 1.0)
    tyreM = M('tyre', '#171717', 0.9, 0.0)
    rimM = M('auto_rim', '#d7d9dc', 0.35, 0.8)
    glass = M('auto_glass', '#2a3940', 0.06, 0.3)
    seatM = M('auto_seat', '#2c1d17', 0.7, 0.0)
    lens = M('auto_lens', '#f2f0e6', 0.12, 0.0)
    red = M('auto_taillight', '#c2141b', 0.3, 0.0)
    amber = M('auto_amber', '#f08c12', 0.3, 0.0)
    plateM = M('auto_plate', '#f7d23a', 0.5, 0.0)
    parts = []

    def two_tone(ob, zsplit):
        assign_by(ob, [green, yellow], lambda c, n: 1 if c.z > zsplit else 0)
        return ob

    # front cowl (nose)
    def cs(y, wb, wt, z0, z1, c):
        pts = [(wb / 2, z0), (wt / 2, z1 - c), (wt / 2 - c, z1), (-wt / 2 + c, z1), (-wt / 2, z1 - c), (-wb / 2, z0)]
        return lift(pts, 'Y', y)
    cowl = loft('cowl', [cs(-1.31, 0.30, 0.54, 0.56, 1.00, 0.10), cs(-1.24, 0.46, 0.88, 0.50, 1.04, 0.10),
                         cs(-1.10, 0.62, 1.12, 0.47, 1.06, 0.10), cs(-0.92, 0.82, 1.24, 0.45, 1.06, 0.08),
                         cs(-0.80, 0.92, 1.26, 0.30, 1.06, 0.08)], green)
    bevel(cowl, 0.025, 2, 25)
    two_tone(cowl, 0.80)
    parts.append(cowl)
    # headlight + indicators + front plate + bumper guard
    parts.append(lathe('headlamp', [(0, 0.0), (0.095, 0.0), (0.100, -0.035), (0.085, -0.060), (0, -0.055)], 18,
                       chrome, 'Y', (0, -1.300, 0.885)))
    parts.append(lathe('headlens', [(0, -0.061), (0.074, -0.061), (0.074, -0.052), (0, -0.052)], 18, lens, 'Y',
                       (0, -1.300, 0.885)))
    for sx in (-1, 1):
        parts.append(box(f'ind{sx}', (0.07, 0.05, 0.045), (sx * 0.21, -1.262, 0.985), amber, 0.008))
    parts.append(box('fplate', (0.26, 0.012, 0.12), (0, -1.318, 0.690), plateM, 0.004))
    parts.append(tube('fguard', fillet([(-0.30, -1.16, 0.53), (-0.22, -1.37, 0.50), (0.22, -1.37, 0.50),
                                        (0.30, -1.16, 0.53)], 0.08, 3), 0.017, 8, chrome))
    # windshield
    ws = box('windshield', (1.12, 0.012, 0.46), (0, 0, 0.23), glass)
    xform(ws, rot=(math.radians(-10), 0, 0))
    xform(ws, (0, -0.84, 1.06))
    parts.append(ws)
    top = Vector((0, -0.84, 1.06)) + Vector((0, math.sin(math.radians(10)) * 0.46, math.cos(math.radians(10)) * 0.46))
    frame_pts = [(-0.58, -0.84, 1.05), (-0.58, top.y, top.z), (0.58, top.y, top.z), (0.58, -0.84, 1.05)]
    parts.append(tube('wsframe', frame_pts, 0.024, 8, yellow, closed=True))
    parts.append(box('meter', (0.15, 0.08, 0.11), (-0.36, -0.80, 1.12), black, 0.01))
    # canopy shell (black canvas) with thickness
    def canopy_sec(y, zs, zt, hw, t=0.028, n=10):
        outer, inner = [], []
        for i in range(n + 1):
            x = -hw + 2 * hw * i / n
            e = math.sqrt(max(0.0, 1 - (x / hw) ** 2))
            outer.append((x, y, zs + (zt - zs) * e))
        for i in range(n, -1, -1):
            x = -(hw - t) + 2 * (hw - t) * i / n
            e = math.sqrt(max(0.0, 1 - (x / (hw - t)) ** 2))
            inner.append((x, y, zs + (zt - zs - t) * e))
        return outer + inner
    canopy = loft('canopy', [canopy_sec(-0.88, 1.50, 1.60, 0.62), canopy_sec(-0.80, 1.53, 1.69, 0.665),
                             canopy_sec(0.98, 1.53, 1.71, 0.665), canopy_sec(1.17, 1.47, 1.65, 0.665),
                             canopy_sec(1.29, 1.36, 1.52, 0.645), canopy_sec(1.335, 1.20, 1.31, 0.60)], canvas)
    smooth(canopy, 40)
    parts.append(canopy)
    for sx in (-1, 1):
        # yellow canopy side rail
        parts.append(tube(f'rail{sx}', [(sx * 0.655, -0.80, 1.525), (sx * 0.655, 1.12, 1.500)], 0.022, 8, yellow))
        # rear pillars
        parts.append(tube(f'pillar{sx}', [(sx * 0.640, 0.95, 0.96), (sx * 0.650, 0.95, 1.53)], 0.022, 8, black))
        # rear quarter canvas
        q = prism(f'quarter{sx}', [(0.95, 0.97), (1.315, 0.97), (1.315, 1.34), (1.20, 1.48), (0.95, 1.525)], 'X',
                  0.622, 0.648, canvas)
        if sx < 0:
            xform(q, scale=(-1, 1, 1))
        parts.append(q)
        # mirror on a stalk
        parts.append(tube(f'mstalk{sx}', [(sx * 0.58, -0.83, 1.22), (sx * 0.70, -0.88, 1.30), (sx * 0.74, -0.90, 1.30)],
                          0.008, 6, black))
        m = cyl(f'mirror{sx}', 0.055, 0.02, (sx * 0.76, -0.905, 1.31), black, 'Y', 12)
        parts.append(m)
    parts.append(box('rearcanvas', (1.22, 0.03, 0.40), (0, 1.315, 1.17), canvas))
    parts.append(box('rearwin', (0.52, 0.012, 0.15), (0, 1.335, 1.20), glass, 0.004))
    # floor, sills
    parts.append(box('floor', (1.18, 1.24, 0.06), (0, -0.20, 0.33), black))
    for sx in (-1, 1):
        sill = box(f'sill{sx}', (0.05, 1.24, 0.14), (sx * 0.61, -0.20, 0.37), green, 0.012)
        parts.append(sill)
    # rear tub
    parts.append(box('seatbase', (1.20, 0.94, 0.22), (0, 0.84, 0.54), green, 0.03))
    for sx in (-1, 1):
        wall = prism(f'wall{sx}', [(0.36, 0.44), (1.32, 0.44), (1.32, 1.00), (0.92, 1.00), (0.62, 0.92), (0.46, 0.78),
                                   (0.36, 0.62)], 'X', 0.600, 0.656, green, 0.012, 1)
        if sx < 0:
            xform(wall, scale=(-1, 1, 1))
        two_tone(wall, 0.76)
        parts.append(wall)
    rw = box('rearwall', (1.31, 0.04, 0.56), (0, 1.318, 0.72), green, 0.01)
    two_tone(rw, 0.76)
    parts.append(rw)
    parts.append(box('rbumper', (1.12, 0.06, 0.06), (0, 1.36, 0.49), black, 0.01))
    for sx in (-1, 1):
        parts.append(box(f'tail{sx}', (0.10, 0.02, 0.07), (sx * 0.50, 1.343, 0.84), red, 0.004))
    parts.append(box('rplate', (0.30, 0.012, 0.13), (0, 1.343, 0.62), plateM, 0.004))
    # seats
    parts.append(box('bench', (1.12, 0.46, 0.10), (0, 0.64, 0.70), seatM, 0.03, 2))
    br = box('backrest', (1.12, 0.09, 0.44), (0, 0, 0.22), seatM, 0.03, 2)
    xform(br, rot=(math.radians(-12), 0, 0))
    xform(br, (0, 1.07, 0.74))
    parts.append(br)
    parts.append(box('dpedestal', (0.30, 0.26, 0.34), (0, -0.30, 0.52), black, 0.02))
    parts.append(box('dseat', (0.42, 0.32, 0.09), (0, -0.30, 0.735), seatM, 0.03, 2))
    parts.append(box('dback', (0.40, 0.06, 0.20), (0, -0.12, 0.88), seatM, 0.02, 2))
    # handlebar
    parts.append(tube('column', [(0, -0.84, 0.96), (0, -0.68, 1.13)], 0.022, 8, black))
    parts.append(tube('handlebar', fillet([(-0.36, -0.60, 1.10), (-0.20, -0.67, 1.145), (0.20, -0.67, 1.145),
                                           (0.36, -0.60, 1.10)], 0.06, 2), 0.014, 8, chrome))
    for sx in (-1, 1):
        parts.append(cyl(f'grip{sx}', 0.020, 0.10, (sx * 0.40, -0.585, 1.095), black, 'X', 10,
                         rot=(0, 0, sx * math.radians(-24))))
    # front wheel, fork, mudguard
    parts.append(wheel('fwheel', 0.21, 0.11, (0, -1.05, 0.21), tyreM, rimM, black, 18, 0.55))
    for sx in (-1, 1):
        parts.append(tube(f'fork{sx}', [(sx * 0.075, -1.05, 0.21), (sx * 0.075, -1.00, 0.56)], 0.018, 8, black))
    parts.append(arc_band('fguard_mud', (-1.05, 0.21), 0.235, 0.255, 15, 165, -0.075, 0.075, green, 12, 0.004))
    # rear wheels + mudguards
    for sx in (-1, 1):
        parts.append(wheel(f'rwheel{sx}', 0.21, 0.12, (sx * 0.555, 0.80, 0.21), tyreM, rimM, black, 18, 0.55,
                           outward=sx))
        parts.append(arc_band(f'rmud{sx}', (0.80, 0.21), 0.235, 0.25, 0, 180, sx * 0.48 - 0.07, sx * 0.48 + 0.07,
                              black, 12))
    return finish_prop('auto_rickshaw', parts)


# ----------------------------------------------------------------------------- hatchback
def build_car_hatchback():
    body = M('body', '#b01e2a', 0.32, 0.35)
    glass = M('glass', '#1b2429', 0.06, 0.3)
    trim = M('trim', '#121212', 0.6, 0.1)
    tyreM = M('tyre', '#161616', 0.9, 0.0)
    rimM = M('rim', '#b9bdc2', 0.3, 0.9)
    lampM = M('headlamp', '#e8eef2', 0.08, 0.2)
    tailM = M('taillamp', '#b0101a', 0.2, 0.1)
    plateM = M('plate', '#f2f2ee', 0.5, 0.0)
    wellM = M('wheelwell', '#0b0b0b', 0.9, 0.0)
    parts = []

    def sec(y, w, z0, z1):
        hw, h = w / 2, z1 - z0
        right = [(hw - 0.10, z0), (hw - 0.01, z0 + 0.10), (hw, z0 + 0.30 * h), (hw, z0 + 0.62 * h),
                 (hw - 0.03, z1 - 0.06), (hw - 0.15, z1)]
        left = [(-x, z) for x, z in reversed(right)]
        return lift(right + left, 'Y', y)
    shell = loft('shell', [sec(-1.93, 1.46, 0.26, 0.64), sec(-1.87, 1.62, 0.21, 0.74), sec(-1.66, 1.69, 0.19, 0.80),
                           sec(-1.20, 1.70, 0.18, 0.86), sec(-0.90, 1.70, 0.18, 0.915), sec(1.50, 1.70, 0.18, 0.965),
                           sec(1.80, 1.66, 0.20, 0.975), sec(1.93, 1.54, 0.28, 0.955)], body)
    wy = (-1.21, 1.25)
    cutters = []
    for y in wy:
        for sx in (-1, 1):
            cutters.append(cyl(f'cut{y}{sx}', 0.355, 0.40, (sx * 0.88, y, 0.30), wellM, 'X', 24))
    boolean_cut(shell, cutters)
    bevel(shell, 0.02, 1, 32)
    # black lower cladding (sills + lower bumpers)
    if trim.name not in [m.name for m in shell.data.materials]:
        shell.data.materials.append(trim)
    names = [m.name for m in shell.data.materials]
    for pl in shell.data.polygons:
        if names[pl.material_index] == body.name and pl.center.z < 0.285:
            pl.material_index = names.index(trim.name)
    parts.append(shell)
    # greenhouse (glass) + roof in body colour
    gh_pts = [(-0.98, 0.88), (-0.12, 1.47), (1.40, 1.47), (1.68, 1.40), (1.90, 0.90)]
    tp = (2, 0.88, 1.0, 1.47, 0.83)
    gh = prism('greenhouse', gh_pts, 'X', -0.76, 0.76, glass, taper=tp)
    bevel(gh, 0.03, 2, 25)
    assign_by(gh, [glass, body], lambda c, n: 1 if n.z > 0.93 else 0)
    parts.append(gh)
    for sx in (-1, 1):
        for nm, pts, mat in (('dpil', [(1.12, 0.89), (1.12, 1.474), (1.40, 1.474), (1.685, 1.404), (1.905, 0.89)], body),
                             ('bpil', [(0.27, 0.89), (0.27, 1.474), (0.37, 1.474), (0.37, 0.89)], trim),
                             ('apil', [(-0.985, 0.88), (-0.125, 1.474), (-0.04, 1.474), (-0.89, 0.88)], body)):
            pl = prism(f'{nm}{sx}', pts, 'X', 0.70, 0.767, mat, taper=tp)
            if sx < 0:
                xform(pl, scale=(-1, 1, 1))
            parts.append(pl)
        # beltline trim
        bl = prism(f'belt{sx}', [(-0.90, 0.905), (1.62, 0.950), (1.62, 0.970), (-0.90, 0.925)], 'X', 0.838, 0.853, trim)
        if sx < 0:
            xform(bl, scale=(-1, 1, 1))
        parts.append(bl)
        # door seams and handles
        for y in (-0.84, 0.30, 1.22):
            parts.append(box(f'seam{sx}{y}', (0.006, 0.007, 0.52), (sx * 0.851, y, 0.60), trim))
        for y in (-0.10, 1.00):
            parts.append(box(f'handle{sx}{y}', (0.014, 0.12, 0.028), (sx * 0.853, y, 0.84), trim, 0.004))
        # mirrors
        parts.append(box(f'mirror{sx}', (0.10, 0.10, 0.11), (sx * 0.90, -0.80, 1.00), body, 0.02))
        parts.append(box(f'mstalk{sx}', (0.10, 0.05, 0.03), (sx * 0.83, -0.82, 0.96), trim))
        # headlamps (swept), tail lamps
        hl = box(f'hl{sx}', (0.36, 0.04, 0.115), (0, 0, 0), lampM, 0.01)
        xform(hl, rot=(math.radians(-31), 0, sx * math.radians(12)))
        xform(hl, (sx * 0.50, -1.893, 0.688))
        parts.append(hl)
        hlc = box(f'hlc{sx}', (0.10, 0.042, 0.07), (0, 0, 0), trim, 0.01)
        xform(hlc, rot=(math.radians(-31), 0, sx * math.radians(12)))
        xform(hlc, (sx * 0.44, -1.905, 0.683))
        parts.append(hlc)
        tl = box(f'tl{sx}', (0.16, 0.12, 0.26), (0, 0, 0), tailM, 0.02)
        xform(tl, rot=(0, 0, sx * math.radians(-18)))
        xform(tl, (sx * 0.68, 1.845, 1.00))
        parts.append(tl)
    parts.append(box('grille', (0.64, 0.05, 0.13), (0, -1.915, 0.56), trim, 0.015))
    parts.append(box('intake', (0.86, 0.05, 0.11), (0, -1.915, 0.35), trim, 0.015))
    parts.append(box('fplate', (0.50, 0.012, 0.12), (0, -1.94, 0.455), plateM, 0.004))
    parts.append(box('rplate', (0.50, 0.012, 0.12), (0, 1.94, 0.62), plateM, 0.004))
    parts.append(box('rbumper', (1.42, 0.05, 0.09), (0, 1.925, 0.36), trim, 0.012))
    sp = box('spoiler', (1.10, 0.20, 0.03), (0, 0, 0), body, 0.01)
    xform(sp, rot=(math.radians(-14), 0, 0))
    xform(sp, (0, 1.56, 1.452))
    parts.append(sp)
    for y in wy:
        for sx in (-1, 1):
            parts.append(wheel(f'wh{y}{sx}', 0.30, 0.19, (sx * 0.735, y, 0.30), tyreM, rimM, trim, 20, 0.62,
                               spokes=5, outward=sx))
    return finish_prop('car_hatchback', parts)


# ----------------------------------------------------------------------------- BMTC bus
def build_bmtc_bus():
    blue = M('bus_blue', '#1d4fa3', 0.4, 0.1)
    white = M('bus_white', '#eef0ee', 0.45, 0.05)
    glass = M('bus_glass', '#1a2328', 0.06, 0.3)
    trim = M('bus_trim', '#141414', 0.6, 0.1)
    tyreM = M('tyre', '#161616', 0.9, 0.0)
    rimM = M('bus_rim', '#9a9ea3', 0.4, 0.8)
    lampM = M('bus_lamp', '#e8eef2', 0.08, 0.2)
    tailM = M('bus_tail', '#b0101a', 0.2, 0.1)
    ledM = M('bus_led', '#ff8a1a', 0.3, 0.0, emit='#ff8a1a', emit_strength=1.5)
    wellM = M('bus_well', '#0b0b0b', 0.9, 0.0)
    L2, hw = 5.5, 1.275
    levels = [0.42, 0.62, 1.00, 1.18, 1.26, 2.34, 2.46, 2.95, 3.12]

    def sec(y, inset, zb, zt):
        right = [(hw - inset - 0.10, zb)] + [(hw - inset, z) for z in levels[1:-1]] + [(hw - inset - 0.14, zt)]
        left = [(-x, z) for x, z in reversed(right)]
        return lift(right + left, 'Y', y)
    shell = loft('shell', [sec(-L2, 0.05, 0.45, 3.04), sec(-L2 + 0.12, 0.0, 0.42, 3.12), sec(L2 - 0.10, 0.0, 0.42, 3.12),
                           sec(L2, 0.04, 0.45, 3.06)], blue)
    cutters = []
    for y in (-3.30, 2.60):
        for sx in (-1, 1):
            cutters.append(cyl(f'cut{y}{sx}', 0.60, 0.50, (sx * 1.30, y, 0.52), wellM, 'X', 24))
    boolean_cut(shell, cutters)
    bevel(shell, 0.04, 1, 30)

    def livery(c, n):
        if abs(n.y) > 0.9:
            return 1        # front / rear faces white (details overlaid)
        if c.z > 2.9:
            return 1        # roof
        if 1.26 < c.z < 2.34:
            return 2        # window band
        if 1.0 < c.z < 1.26 or 2.34 < c.z < 2.95:
            return 1
        return 0
    assign_by(shell, [blue, white, glass], livery)
    parts = [shell]
    # window pillars on both sides; doors on +X (kerb side in India)
    for sx in (-1, 1):
        ys = [-4.6 + 1.05 * i for i in range(10)]
        for y in ys:
            if sx > 0 and (-4.95 < y < -3.9 or 0.0 < y < 1.3):
                continue
            parts.append(box(f'pil{sx}{y:.2f}', (0.03, 0.10, 1.10), (sx * (hw + 0.012), y, 1.80), white))
        if sx > 0:
            for (y0, y1) in ((-4.95, -3.95), (0.05, 1.25)):
                parts.append(box(f'door{y0}', (0.03, y1 - y0, 2.2), (hw + 0.013, (y0 + y1) / 2, 1.55), glass, 0.01))
                parts.append(box(f'doorf{y0}', (0.035, 0.05, 2.2), (hw + 0.016, (y0 + y1) / 2, 1.55), trim))
                parts.append(box(f'doorb{y0}', (0.035, y1 - y0, 0.06), (hw + 0.016, (y0 + y1) / 2, 1.20), trim))
        # side mirror arms (front)
        parts.append(tube(f'marm{sx}', [(sx * 1.20, -5.45, 2.60), (sx * 1.45, -5.62, 2.55), (sx * 1.48, -5.62, 2.20)],
                          0.02, 6, trim))
        parts.append(box(f'mirror{sx}', (0.06, 0.18, 0.32), (sx * 1.48, -5.62, 2.05), trim, 0.02))
    # front
    fy = -L2 - 0.012
    parts.append(box('windshield', (2.30, 0.03, 1.30), (0, fy, 1.92), glass, 0.02))
    parts.append(box('wsdivider', (0.05, 0.035, 1.30), (0, fy - 0.004, 1.92), trim))
    parts.append(box('destboard', (2.0, 0.03, 0.28), (0, fy, 2.80), trim, 0.01))
    parts.append(box('destled', (1.6, 0.035, 0.12), (0, fy - 0.004, 2.80), ledM))
    parts.append(box('fbumper', (2.52, 0.10, 0.30), (0, -L2 - 0.03, 0.55), trim, 0.03))
    parts.append(box('grille', (1.2, 0.03, 0.26), (0, fy, 0.92), trim, 0.01))
    parts.append(box('fplate', (0.52, 0.02, 0.12), (0, -L2 - 0.085, 0.60), M('bus_plate', '#f7d23a', 0.5), 0.004))
    for sx in (-1, 1):
        parts.append(box(f'hl{sx}', (0.34, 0.04, 0.18), (sx * 0.92, fy, 0.92), lampM, 0.02))
        parts.append(box(f'wiper{sx}', (0.7, 0.02, 0.02), (sx * 0.5, fy - 0.02, 1.32), trim))
    # rear
    ry = L2 + 0.012
    parts.append(box('rearwin', (2.0, 0.03, 0.80), (0, ry, 2.15), glass, 0.02))
    parts.append(box('rbumper', (2.52, 0.10, 0.30), (0, L2 + 0.03, 0.55), trim, 0.03))
    parts.append(box('rgrille', (1.6, 0.03, 0.40), (0, ry, 1.05), trim, 0.01))
    for sx in (-1, 1):
        parts.append(box(f'tl{sx}', (0.16, 0.04, 0.50), (sx * 1.10, ry, 1.05), tailM, 0.02))
    # roof hatches
    for y in (-2.0, 2.0):
        parts.append(box(f'hatch{y}', (0.8, 0.8, 0.10), (0, y, 3.15), white, 0.03))
    # wheels (front single, rear dual)
    for y, w in ((-3.30, 0.30), (2.60, 0.56)):
        for sx in (-1, 1):
            parts.append(wheel(f'wh{y}{sx}', 0.50, w, (sx * (hw - w / 2 - 0.02), y, 0.50), tyreM, rimM, trim, 22,
                               0.58, outward=sx))
    return finish_prop('bmtc_bus', parts)


# ----------------------------------------------------------------------------- street lamp
def build_street_lamp():
    paint = M('lamp_paint', '#4a4e54', 0.45, 0.6)
    dark = M('lamp_dark', '#2a2c30', 0.5, 0.4)
    emitM = M('lamp_emit', '#fff6e0', 0.3, 0.0, emit='#fff3d6', emit_strength=4.0)
    parts = [box('baseplate', (0.36, 0.36, 0.025), (0, 0, 0.0125), dark, 0.004)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(cyl(f'bolt{sx}{sy}', 0.014, 0.05, (sx * 0.14, sy * 0.14, 0.045), dark, segs=6))
    parts.append(lathe('basecover', [(0, 0.025), (0.13, 0.025), (0.125, 0.45), (0.095, 0.52), (0, 0.52)], 8, paint,
                       sharp=50))
    parts.append(lathe('pole', [(0.095, 0.50), (0.058, 5.90), (0.0, 5.90)], 12, paint, sharp=40))
    arm_pts = fillet([(0, 0.0, 5.80), (0, 0.0, 6.02), (0, -0.30, 6.12), (0, -0.95, 6.16)], 0.16, 4)
    parts.append(tube('arm', arm_pts, 0.042, 10, paint))
    # LED head: slim rounded slab, tilted 5 deg up at the front
    head = prism('head', rrect(0.30, 0.66, 0.08, 3), 'Z', -0.035, 0.035, paint, 0.012, 2)
    panel = prism('panel', rrect(0.22, 0.52, 0.05, 2), 'Z', -0.045, -0.030, emitM)
    fins = [box(f'fin{i}', (0.012, 0.44, 0.022), (-0.09 + 0.045 * i, 0, 0.045), dark) for i in range(5)]
    hd = join([head, panel] + fins, 'head')
    xform(hd, (0, -0.33, 0))
    xform(hd, rot=(math.radians(5), 0, 0))
    xform(hd, (0, -0.72, 6.16))
    parts.append(hd)
    # light empty just under the emitter panel centre
    c = Vector((0, -0.33, -0.05))
    c = Euler((math.radians(5), 0, 0)).to_matrix() @ c + Vector((0, -0.72, 6.16))
    light = empty('light', tuple(c), 0.2)
    return finish_prop('street_lamp', parts, [light])


# ----------------------------------------------------------------------------- bench
def build_bench():
    frame = M('bench_frame', '#33363a', 0.45, 0.7)
    wood = M('bench_wood', '#8a5a33', 0.6, 0.0)
    parts = []
    for sx in (-1, 1):
        x0 = sx * 0.86
        leg_f = prism(f'legf{sx}', [(-0.26, 0.0), (-0.19, 0.0), (-0.18, 0.43), (-0.23, 0.43)], 'X', -0.03, 0.03, frame, 0.008)
        leg_b = prism(f'legb{sx}', [(0.16, 0.0), (0.23, 0.0), (0.21, 0.42), (0.34, 0.86), (0.29, 0.87), (0.15, 0.43)],
                      'X', -0.03, 0.03, frame, 0.008)
        rail = prism(f'rail{sx}', [(-0.25, 0.39), (0.22, 0.39), (0.22, 0.43), (-0.25, 0.43)], 'X', -0.03, 0.03, frame, 0.006)
        arm = prism(f'arm{sx}', [(-0.27, 0.62), (0.22, 0.62), (0.24, 0.66), (-0.25, 0.67)], 'X', -0.035, 0.035, frame,
                    0.01, 2)
        armpost = prism(f'armp{sx}', [(-0.235, 0.42), (-0.195, 0.42), (-0.205, 0.63), (-0.245, 0.63)], 'X', -0.025, 0.025,
                        frame, 0.006)
        foot = box(f'foot{sx}', (0.08, 0.56, 0.02), (0, -0.015, 0.01), frame, 0.004)
        side = join([leg_f, leg_b, rail, arm, armpost, foot], f'side{sx}')
        xform(side, (x0, 0, 0))
        parts.append(side)
    for i in range(5):
        y = -0.21 + 0.098 * i
        parts.append(box(f'seat{i}', (1.84, 0.082, 0.035), (0, y, 0.448), wood, 0.008, 2))
    for i in range(3):
        t = 0.52 + 0.13 * i
        y = 0.21 + (0.34 - 0.21) * ((t - 0.42) / 0.44) + 0.02
        s = box(f'back{i}', (1.84, 0.03, 0.095), (0, 0, 0), wood, 0.008, 2)
        xform(s, rot=(math.radians(-17), 0, 0))
        xform(s, (0, y, t))
        parts.append(s)
    return finish_prop('bench', parts)


# ----------------------------------------------------------------------------- food-court table + chairs
def build_cafe_table_set():
    red = M('chair_red', '#c81e1e', 0.42, 0.0)
    top = M('table_top', '#ecebe6', 0.35, 0.0)
    steel = M('steel', '#aeb2b7', 0.3, 0.9)
    parts = [box('tabletop', (0.80, 0.80, 0.03), (0, 0, 0.735), top, 0.008, 2),
             box('apron', (0.70, 0.70, 0.05), (0, 0, 0.695), steel, 0.005),
             cyl('column', 0.035, 0.68, (0, 0, 0.35), steel, segs=12),
             lathe('tbase', [(0, 0.0), (0.26, 0.0), (0.26, 0.012), (0.20, 0.03), (0, 0.03)], 20, steel)]

    def chair(nm):
        seat = prism(nm + 'seat', [(-0.21, 0.43), (0.19, 0.44), (0.20, 0.47), (-0.21, 0.465), (-0.225, 0.45)], 'X',
                     -0.215, 0.215, red, 0.012, 2)
        # curved backrest (arc band in top view), leaning back
        n = 8
        outer = [(0.23 * math.sin(math.radians(-60 + 120 * i / n)) / math.sin(math.radians(60)),
                  0.30 - 0.23 / math.tan(math.radians(60)) + 0.23 * math.cos(math.radians(-60 + 120 * i / n))
                  / math.sin(math.radians(60)) - 0.12) for i in range(n + 1)]
        R0 = 0.23 / math.sin(math.radians(60))
        cy = -R0 * math.cos(math.radians(60))
        outer = [(R0 * math.sin(math.radians(-60 + 120 * i / n)), cy + R0 * math.cos(math.radians(-60 + 120 * i / n)))
                 for i in range(n + 1)]
        R1 = R0 - 0.022
        inner = [(R1 * math.sin(math.radians(-60 + 120 * i / n)), cy + R1 * math.cos(math.radians(-60 + 120 * i / n)))
                 for i in range(n, -1, -1)]
        back = prism(nm + 'back', outer + inner, 'Z', 0.0, 0.25, red, 0.008, 2)
        xform(back, rot=(math.radians(-10), 0, 0))
        xform(back, (0, 0.19, 0.58))
        legs = []
        for sx in (-1, 1):
            legs.append(tube(nm + f'lf{sx}', [(sx * 0.18, -0.17, 0.44), (sx * 0.215, -0.215, 0.0)], 0.017, 8, red))
            legs.append(tube(nm + f'lb{sx}', [(sx * 0.215, 0.25, 0.0), (sx * 0.185, 0.17, 0.44),
                                              (sx * 0.20, 0.215, 0.70)], 0.017, 8, red))
        stretcher = [tube(nm + f'st{sx}', [(sx * 0.20, -0.19, 0.14), (sx * 0.20, 0.21, 0.14)], 0.009, 6, red)
                     for sx in (-1, 1)]
        return join([seat, back] + legs + stretcher, nm)
    # chairs face the table (chair front is its local -Y)
    placements = [(0, -0.60, 0, 4), (0.62, 0, 90, -6), (0, 0.63, 180, 7), (-0.60, 0.02, 270, -3)]
    for i, (x, y, yaw, jitter) in enumerate(placements):
        ch = chair(f'chair{i}')
        xform(ch, rot=(0, 0, math.radians(yaw + 180 + jitter)))
        xform(ch, (x, y, 0))
        parts.append(ch)
    return finish_prop('cafe_table_set', parts)


# ----------------------------------------------------------------------------- folding (scissor) barricade
def build_folding_barricade():
    yellow = M('barr_yellow', '#f2c21b', 0.45, 0.2)
    red = M('barr_red', '#c61d1d', 0.45, 0.2)
    black = M('barr_black', '#141414', 0.7, 0.0)
    parts = []
    W, n = 2.40, 9
    xs = [-W / 2 + W * i / (n - 1) for i in range(n)]
    z0, z1 = 0.12, 1.02
    for i, x in enumerate(xs):
        end = i in (0, n - 1)
        if end:
            parts.append(box(f'post{i}', (0.05, 0.05, 1.08), (x, 0, 0.54), yellow, 0.008))
            parts.append(box(f'foot{i}', (0.06, 0.50, 0.04), (x, 0, 0.02), yellow, 0.006))
            parts.append(box(f'cap{i}', (0.06, 0.06, 0.02), (x, 0, 1.09), black, 0.004))
        else:
            parts.append(box(f'bar{i}', (0.035, 0.02, z1 - z0), (x, 0, (z0 + z1) / 2), yellow, 0.004))
            parts.append(box(f'fork{i}', (0.03, 0.04, 0.05), (x, 0, z0 - 0.02), black))
            parts.append(cyl(f'castor{i}', 0.035, 0.03, (x, 0, 0.035), black, 'X', 10))
    zm = (z0 + z1) / 2
    for i in range(n - 1):
        xa, xb = xs[i], xs[i + 1]
        for (za, zb) in ((z0 + 0.03, zm), (zm, z1 - 0.03)):
            for k, (p0, p1) in enumerate((((xa, za), (xb, zb)), ((xa, zb), (xb, za)))):
                d = Vector((p1[0] - p0[0], 0, p1[1] - p0[1]))
                mid = Vector(((p0[0] + p1[0]) / 2, (-0.018 if k == 0 else 0.018), (p0[1] + p1[1]) / 2))
                b = box(f'x{i}{za:.2f}{k}', (d.length + 0.03, 0.012, 0.032), (0, 0, 0), red, 0.003)
                xform(b, rot=(0, -math.atan2(d.z, d.x), 0))
                xform(b, mid)
                parts.append(b)
    # pivot rivets at the crossings
    for i in range(n - 1):
        xm = (xs[i] + xs[i + 1]) / 2
        for zz in ((z0 + 0.03 + zm) / 2, (zm + z1 - 0.03) / 2):
            parts.append(cyl(f'rivet{i}{zz:.2f}', 0.012, 0.06, (xm, 0, zz), black, 'Y', 8))
    return finish_prop('folding_barricade', parts)


# ----------------------------------------------------------------------------- metro construction barrier
def build_metro_barrier():
    steel = M('mb_steel', '#8d9297', 0.4, 0.8)
    redM = M('mb_red', '#c8201e', 0.5, 0.0)
    whiteM = M('mb_white', '#efefea', 0.5, 0.0)

    def net_px(x, y):
        # knitted shade-net: bright green threads around darker "holes", slight weave variation
        tx, ty = x % 4, y % 4
        if tx == 0 or ty == 0:
            return (0.36, 0.66, 0.34) if (x // 4 + y // 4) % 2 == 0 else (0.33, 0.62, 0.31)
        if (x * 7 + y * 3) % 11 == 0:
            return (0.30, 0.58, 0.29)
        return (0.20, 0.47, 0.22)
    img = make_image('shade_net', 64, 64, net_px)
    netM = M('mb_net', '#ffffff', 0.9, 0.0, image=img)
    W, H = 2.50, 2.00
    parts = []
    net = box('net', (W - 0.06, 0.012, 1.77), (0, 0, 1.095), netM)
    planar_uv(net, lambda co, n: (co.x / (W - 0.06) * 10.0, (co.z - 0.21) / 1.77 * 7.2))
    parts.append(net)
    for sx in (-1, 1):
        parts.append(box(f'post{sx}', (0.05, 0.05, H), (sx * W / 2, 0, H / 2), steel, 0.006))
        parts.append(box(f'foot{sx}', (0.06, 0.85, 0.04), (sx * W / 2, 0.10, 0.02), steel, 0.006))
        parts.append(tube(f'strut{sx}', [(sx * W / 2, 0.02, 0.70), (sx * W / 2, 0.48, 0.04)], 0.018, 8, steel))
        parts.append(box(f'block{sx}', (0.22, 0.30, 0.14), (sx * W / 2, 0.40, 0.11), M('mb_concrete', '#9c9a93', 0.9),
                         0.015))
    for z in (0.19, 1.05, H - 0.025):
        parts.append(box(f'rail{z}', (W, 0.045, 0.045), (0, 0, z), steel, 0.005))
    # red/white hazard strip along the bottom
    nseg = 12
    for i in range(nseg):
        x = -W / 2 + 0.03 + (W - 0.06) * (i + 0.5) / nseg
        parts.append(box(f'hz{i}', ((W - 0.06) / nseg, 0.02, 0.12), (x, -0.012, 0.10), redM if i % 2 == 0 else whiteM))
    root = finish_prop('metro_barrier', parts)
    return root


# ----------------------------------------------------------------------------- trash bin
def build_trash_bin():
    blue = M('bin_blue', '#1f63c4', 0.45, 0.0)
    blueD = M('bin_blue_dark', '#174a96', 0.45, 0.0)
    dark = M('bin_dark', '#1a1a1a', 0.7, 0.0)
    secs = [lift(rrect(0.36, 0.34, 0.07, 3), 'Z', 0.03), lift(rrect(0.44, 0.42, 0.08, 3), 'Z', 0.70),
            lift(rrect(0.47, 0.45, 0.085, 3), 'Z', 0.72), lift(rrect(0.47, 0.45, 0.085, 3), 'Z', 0.76)]
    bodyb = loft('bin_body', secs, blue)
    smooth(bodyb, 40)
    base = prism('bin_base', rrect(0.34, 0.32, 0.065, 3), 'Z', 0.0, 0.035, dark, 0.005)
    lid = loft('bin_lid', [lift(rrect(0.48, 0.46, 0.09, 3), 'Z', 0.755), lift(rrect(0.46, 0.44, 0.085, 3), 'Z', 0.80),
                           lift(rrect(0.38, 0.36, 0.07, 3), 'Z', 0.90), lift(rrect(0.24, 0.22, 0.05, 3), 'Z', 0.955)],
               blueD)
    bevel(lid, 0.008, 1, 30)
    # swing flap on the front of the lid, slightly open
    hole = box('hole', (0.30, 0.012, 0.15), (0, 0.004, -0.075), dark)
    xform(hole, rot=(math.radians(-30), 0, 0))
    xform(hole, (0, -0.145, 0.93))
    flap = box('flap', (0.29, 0.012, 0.145), (0, -0.004, -0.0725), blue, 0.004)
    xform(flap, rot=(math.radians(-37), 0, 0))
    xform(flap, (0, -0.145, 0.93))
    handles = [box(f'handle{sx}', (0.03, 0.14, 0.03), (sx * 0.232, 0, 0.66), blueD, 0.008) for sx in (-1, 1)]
    return finish_prop('trash_bin', [bodyb, base, lid, hole, flap] + handles)


# ----------------------------------------------------------------------------- water cooler
def build_water_cooler():
    ss = M('stainless', '#c7cbcf', 0.30, 1.0)
    ssD = M('stainless_dark', '#8c9095', 0.35, 1.0)
    dark = M('wc_dark', '#141414', 0.6, 0.0)
    chrome = M('wc_chrome', '#e3e6ea', 0.15, 1.0)
    plate = M('wc_plate', '#1d4f9c', 0.4, 0.0)
    textM = M('wc_text', '#f4f4f0', 0.4, 0.0)
    parts = [box('cabinet', (0.64, 0.50, 1.28), (0, 0, 0.72), ss, 0.012, 2),
             box('lidtop', (0.67, 0.53, 0.035), (0, 0, 1.375), ss, 0.008),
             box('recess', (0.56, 0.02, 0.22), (0, -0.253, 1.02), ssD, 0.004),
             box('tray', (0.58, 0.16, 0.04), (0, -0.31, 0.80), ssD, 0.008)]
    for i in range(9):
        parts.append(box(f'grill{i}', (0.008, 0.14, 0.01), (-0.24 + 0.06 * i, -0.315, 0.825), dark))
    for i, x in enumerate((-0.18, 0.0, 0.18)):
        parts.append(cyl(f'tapbody{i}', 0.018, 0.07, (x, -0.29, 1.02), chrome, 'Y', 10))
        parts.append(cyl(f'spout{i}', 0.010, 0.05, (x, -0.315, 0.99), chrome, 'Z', 8))
        parts.append(box(f'push{i}', (0.03, 0.025, 0.035), (x, -0.325, 1.045), dark, 0.006))
    for i in range(8):
        parts.append(box(f'louvre{i}', (0.46, 0.015, 0.018), (0, -0.253, 0.18 + 0.05 * i), dark))
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(cyl(f'foot{sx}{sy}', 0.025, 0.08, (sx * 0.27, sy * 0.20, 0.04), dark, segs=8))
    parts.append(box('plate', (0.44, 0.008, 0.10), (0, -0.253, 1.22), plate, 0.003))
    txt = text_mesh('wc_text', 'DRINKING WATER', 0.045, 0.002, textM, offset=0.001, res=2)
    orient(txt, (1, 0, 0), (0, 0, 1), (0, -0.2585, 1.22))
    parts.append(txt)
    return finish_prop('water_cooler', parts)


# ----------------------------------------------------------------------------- ammo crate
def build_ammo_crate():
    olive = M('crate_olive', '#4d5a2a', 0.8, 0.0)
    oliveD = M('crate_olive_dark', '#3a441f', 0.85, 0.0)
    metal = M('crate_metal', '#6d7074', 0.45, 0.8)
    rope = M('crate_rope', '#a8905f', 0.95, 0.0)
    stencil = M('crate_stencil', '#e3dca0', 0.7, 0.0)
    L, D, H = 0.80, 0.42, 0.34
    parts = [box('crate', (L, D, H - 0.05), (0, 0, (H - 0.05) / 2), olive, 0.008),
             box('lid', (L + 0.02, D + 0.02, 0.055), (0, 0, H - 0.025), olive, 0.01, 2)]
    for sx in (-1, 1):
        parts.append(box(f'batten{sx}', (0.035, D + 0.03, H - 0.06), (sx * (L / 2 - 0.02), 0, (H - 0.06) / 2 + 0.005),
                         oliveD, 0.006))
        loop = [(sx * (L / 2 + 0.02), -0.09, 0.20), (sx * (L / 2 + 0.05), -0.07, 0.15), (sx * (L / 2 + 0.05), 0.07, 0.15),
                (sx * (L / 2 + 0.02), 0.09, 0.20)]
        parts.append(tube(f'rope{sx}', fillet(loop, 0.03, 2), 0.011, 6, rope))
        for y in (-0.09, 0.09):
            parts.append(box(f'cleat{sx}{y}', (0.03, 0.04, 0.04), (sx * (L / 2 + 0.018), y, 0.20), metal, 0.004))
    for fy in (-1, 1):
        for zz in (0.10, 0.19):
            parts.append(box(f'groove{fy}{zz}', (L - 0.08, 0.004, 0.006), (0, fy * (D / 2 + 0.001), zz), oliveD))
        for x in (-0.22, 0.22):
            parts.append(box(f'latch{fy}{x}', (0.05, 0.02, 0.07), (x, fy * (D / 2 + 0.008), H - 0.055), metal, 0.004))
    for x in (-0.20, 0.20):
        parts.append(box(f'lidbatten{x}', (0.05, D + 0.02, 0.012), (x, 0, H + 0.006), oliveD, 0.003))
    t1 = text_mesh('st1', 'AMMO', 0.085, 0.002, stencil, offset=0.002, res=2, spacing=1.15)
    orient(t1, (1, 0, 0), (0, 0, 1), (0, -D / 2 - 0.002, 0.205))
    t2 = text_mesh('st2', '7.62 MM  BALL  x 400', 0.030, 0.002, stencil, res=2)
    orient(t2, (1, 0, 0), (0, 0, 1), (0, -D / 2 - 0.002, 0.125))
    t3 = text_mesh('st3', 'LOT 26-09', 0.028, 0.002, stencil, res=2)
    orient(t3, (1, 0, 0), (0, 0, 1), (0, -D / 2 - 0.002, 0.070))
    t4 = text_mesh('st4', 'AMMO', 0.06, 0.002, stencil, offset=0.0015, res=2, spacing=1.15)
    orient(t4, (1, 0, 0), (0, 1, 0), (0, 0, H + 0.001))
    parts += [t1, t2, t3, t4]
    return finish_prop('ammo_crate', parts)


# ----------------------------------------------------------------------------- medkit
def build_medkit():
    white = M('medkit_white', '#f1f1ee', 0.4, 0.0)
    red = M('medkit_red', '#d11f26', 0.4, 0.0)
    dark = M('medkit_dark', '#2a2a2a', 0.6, 0.0)
    W, D, H = 0.38, 0.15, 0.27
    parts = [box('case', (W, D, H), (0, 0, H / 2 + 0.01), white, 0.025, 2),
             box('band', (W + 0.006, D + 0.006, 0.022), (0, 0, 0.20), red, 0.006)]
    for fy in (-1, 1):
        parts.append(box(f'crossv{fy}', (0.045, 0.006, 0.13), (0, fy * (D / 2 + 0.003), 0.105), red, 0.002))
        parts.append(box(f'crossh{fy}', (0.13, 0.006, 0.045), (0, fy * (D / 2 + 0.003), 0.105), red, 0.002))
    for x in (-0.13, 0.13):
        parts.append(box(f'clip{x}', (0.04, 0.014, 0.05), (x, -(D / 2 + 0.006), 0.20), dark, 0.004))
    parts.append(box('crosstv', (0.035, 0.09, 0.006), (0, 0, H + 0.013), red, 0.002))
    parts.append(box('crossth', (0.09, 0.035, 0.006), (0, 0, H + 0.013), red, 0.002))
    for x in (-0.09, 0.09):
        parts.append(box(f'hmount{x}', (0.03, 0.03, 0.02), (x, 0, H + 0.02), dark, 0.004))
    parts.append(tube('handle', fillet([(-0.09, 0, H + 0.025), (-0.075, 0, H + 0.065), (0.075, 0, H + 0.065),
                                        (0.09, 0, H + 0.025)], 0.02, 2), 0.011, 8, dark))
    return finish_prop('medkit', parts)


# ----------------------------------------------------------------------------- sandbags
def pillow(name, a, b, h, mat, e1=0.45, e2=0.30, rows=6, cols=12):
    """Superquadric sandbag with a slightly sagging top."""
    def c(w, m):
        return math.copysign(abs(math.cos(w)) ** m, math.cos(w))

    def s(w, m):
        return math.copysign(abs(math.sin(w)) ** m, math.sin(w))
    prof = []
    verts, faces, rowsI = [], [], []
    verts.append((0, 0, -h))
    rowsI.append([0])
    for i in range(1, rows):
        th = -math.pi / 2 + math.pi * i / rows
        row = []
        for j in range(cols):
            ph = 2 * math.pi * j / cols
            x = a * c(th, e1) * c(ph, e2)
            y = b * c(th, e1) * s(ph, e2)
            z = h * s(th, e1)
            if z > 0:
                z *= 1.0 - 0.18 * (1 - min(1.0, abs(x) / a))
            row.append(len(verts))
            verts.append((x, y, z))
        rowsI.append(row)
    verts.append((0, 0, h * 0.82))
    rowsI.append([len(verts) - 1])
    for i in range(len(rowsI) - 1):
        A, B = rowsI[i], rowsI[i + 1]
        for j in range(cols):
            j2 = (j + 1) % cols
            if len(A) == 1:
                faces.append((A[0], B[j2], B[j]))
            elif len(B) == 1:
                faces.append((A[j], A[j2], B[0]))
            else:
                faces.append((A[j], A[j2], B[j2], B[j]))
    ob = new_obj(name, verts, faces, mat)
    smooth(ob, 70)
    return ob


def build_sandbags():
    import random
    rnd = random.Random(7)
    mats = [M('sand_a', '#a8946a', 0.95), M('sand_b', '#9c8a60', 0.95), M('sand_c', '#b3a07a', 0.95)]
    parts = []
    R = 3.2
    bag_l, bag_d, bag_h = 0.56, 0.30, 0.13

    def place(ob, s, depth, z, yaw_j):
        a = s / R
        x = R * math.sin(a)
        y = R - R * math.cos(a)
        nrm = Vector((-math.sin(a), math.cos(a), 0))     # points to +Y side (back)
        p = Vector((x, y, z)) + nrm * depth
        xform(ob, rot=(0, 0, a + yaw_j))
        xform(ob, p)
    courses = [(-0.84, 4, (-0.17, 0.17)), (-0.56, 3, (-0.17, 0.17)), (-0.84, 4, (0.0,)), (-0.56, 3, (0.0,))]
    k = 0
    for ci, (s0, count, depths) in enumerate(courses):
        z = bag_h * 0.95 + ci * bag_h * 1.55
        for d in depths:
            for i in range(count):
                s = s0 + i * bag_l * 1.0 + rnd.uniform(-0.02, 0.02)
                ob = pillow(f'bag{k}', bag_l / 2 * rnd.uniform(0.96, 1.04), bag_d / 2 * rnd.uniform(0.95, 1.05),
                            bag_h * rnd.uniform(0.95, 1.08), mats[k % 3])
                xform(ob, rot=(rnd.uniform(-0.04, 0.04), rnd.uniform(-0.05, 0.05), 0))
                place(ob, s, d, z, rnd.uniform(-0.06, 0.06))
                parts.append(ob)
                k += 1
    return finish_prop('sandbags', parts)


# ----------------------------------------------------------------------------- scooter
def build_bike():
    body = M('body', '#2d5fa8', 0.35, 0.3)
    black = M('bike_black', '#141414', 0.6, 0.1)
    seatM = M('bike_seat', '#1b1b1b', 0.8, 0.0)
    chrome = M('bike_chrome', '#c9cdd2', 0.2, 1.0)
    tyreM = M('tyre', '#161616', 0.9, 0.0)
    rimM = M('bike_rim', '#b5b9be', 0.35, 0.8)
    greyM = M('bike_engine', '#5d6166', 0.5, 0.6)
    lampM = M('bike_lamp', '#eef2f4', 0.08, 0.1)
    red = M('bike_tail', '#c0121b', 0.3, 0.0)
    amber = M('bike_amber', '#f08c12', 0.3, 0.0)
    plateM = M('bike_plate', '#f2f2ee', 0.5, 0.0)
    parts = []
    fy, ry, wr = -0.62, 0.58, 0.225
    parts.append(wheel('fwheel', wr, 0.09, (0, fy, wr), tyreM, rimM, black, 18, 0.50, spokes=5))
    parts.append(wheel('rwheel', wr, 0.10, (0, ry, wr), tyreM, rimM, black, 18, 0.50))
    # front apron / leg shield: loft of curved bands along Z
    def band(z, yc, w, t, n=6):
        front = [(-w / 2 + w * i / n, yc - 0.07 * (1 - (2 * (i / n) - 1) ** 2)) for i in range(n + 1)]
        back = [(x * 0.92, y + t - 0.03 * (1 - (2 * (i / n) - 1) ** 2)) for i, (x, y) in enumerate(reversed(front))]
        return lift(front + back, 'Z', z)
    apron = loft('apron', [band(0.30, -0.56, 0.26, 0.26), band(0.46, -0.61, 0.40, 0.25), band(0.70, -0.60, 0.42, 0.19),
                           band(0.90, -0.56, 0.34, 0.13), band(1.00, -0.535, 0.24, 0.09)], body)
    bevel(apron, 0.012, 1, 35)
    parts.append(apron)
    parts.append(arc_band('fmud', (fy, wr), 0.245, 0.27, 20, 150, -0.07, 0.07, body, 10, 0.004))
    for sx in (-1, 1):
        parts.append(tube(f'fork{sx}', [(sx * 0.06, fy, wr), (sx * 0.05, -0.56, 0.60)], 0.02, 8, black))
    # floorboard + tunnel
    parts.append(box('floor', (0.36, 0.60, 0.05), (0, -0.20, 0.30), black, 0.01))
    parts.append(box('floormat', (0.32, 0.54, 0.01), (0, -0.20, 0.33), M('bike_mat', '#2a2a2a', 0.9), 0.003))
    # rear body cowl
    def rs(y, w, z0, z1, r=0.07):
        return lift(rrect(w, z1 - z0, r, 2, 0, (z0 + z1) / 2), 'Y', y)
    cowl = loft('rearcowl', [rs(0.06, 0.26, 0.30, 0.66, 0.06), rs(0.20, 0.34, 0.30, 0.78), rs(0.40, 0.36, 0.47, 0.80),
                             rs(0.72, 0.34, 0.50, 0.80), rs(0.88, 0.22, 0.56, 0.76, 0.05)], body)
    bevel(cowl, 0.01, 1, 35)
    parts.append(cowl)
    parts.append(box('seat', (0.30, 0.74, 0.09), (0, 0.44, 0.84), seatM, 0.035, 2))
    parts.append(box('engine', (0.12, 0.56, 0.16), (-0.13, 0.40, 0.30), greyM, 0.03))
    parts.append(tube('muffler', [(0.12, 0.35, 0.32), (0.14, 0.62, 0.30), (0.14, 0.86, 0.34)], 0.045, 10, greyM))
    parts.append(tube('grabrail', fillet([(-0.15, 0.62, 0.80), (-0.16, 0.86, 0.82), (0.16, 0.86, 0.82),
                                          (0.15, 0.62, 0.80)], 0.07, 3), 0.014, 8, black))
    parts.append(box('tail', (0.16, 0.03, 0.06), (0, 0.885, 0.70), red, 0.01))
    parts.append(box('rplate', (0.20, 0.01, 0.10), (0, 0.84, 0.50), plateM, 0.003))
    parts.append(arc_band('rmud', (ry, wr), 0.24, 0.26, 20, 110, -0.06, 0.06, black, 8))
    # handlebar cover with headlight, bars, mirrors
    parts.append(box('hcover', (0.40, 0.20, 0.12), (0, -0.52, 1.05), body, 0.04, 2))
    parts.append(box('hlamp', (0.20, 0.03, 0.08), (0, -0.625, 1.05), lampM, 0.015))
    for sx in (-1, 1):
        parts.append(box(f'ind{sx}', (0.05, 0.02, 0.035), (sx * 0.17, -0.62, 1.045), amber, 0.005))
        parts.append(tube(f'bar{sx}', [(sx * 0.18, -0.50, 1.06), (sx * 0.34, -0.47, 1.05)], 0.012, 8, chrome))
        parts.append(cyl(f'grip{sx}', 0.018, 0.10, (sx * 0.37, -0.465, 1.05), black, 'X', 8))
        parts.append(tube(f'mstem{sx}', [(sx * 0.15, -0.50, 1.10), (sx * 0.21, -0.51, 1.26)], 0.006, 6, black))
        m = cyl(f'mirror{sx}', 0.05, 0.015, (sx * 0.22, -0.51, 1.29), black, 'Y', 10)
        xform(m, scale=(1.3, 1, 1))
        parts.append(m)
    parts.append(box('fplate', (0.16, 0.01, 0.08), (0, -0.695, 0.42), plateM, 0.003))
    # centre stand
    for sx in (-1, 1):
        parts.append(tube(f'stand{sx}', [(sx * 0.10, 0.15, 0.30), (sx * 0.14, 0.24, 0.02)], 0.012, 6, black))
    return finish_prop('bike', parts)


PROPS = {
    'pes_globe': build_pes_globe,
    'auto_rickshaw': build_auto_rickshaw,
    'car_hatchback': build_car_hatchback,
    'bmtc_bus': build_bmtc_bus,
    'street_lamp': build_street_lamp,
    'bench': build_bench,
    'cafe_table_set': build_cafe_table_set,
    'folding_barricade': build_folding_barricade,
    'metro_barrier': build_metro_barrier,
    'trash_bin': build_trash_bin,
    'water_cooler': build_water_cooler,
    'ammo_crate': build_ammo_crate,
    'medkit': build_medkit,
    'sandbags': build_sandbags,
    'bike': build_bike,
}
BUDGET = {'bmtc_bus': 10000}
HERO_VIEW = {'pes_globe': (12, 12), 'street_lamp': (35, 12)}


def contact_sheet():
    files = [os.path.join(RENDER_DIR, 'views', f'{n}_v0.png') for n in PROPS]
    files = [f for f in files if os.path.exists(f)]
    if not files:
        return
    args = [FFMPEG, '-v', 'error', '-y']
    for f in files:
        args += ['-i', f]
    cols = 4
    rows = (len(files) + cols - 1) // cols
    # xstack layout
    layout = '|'.join(f'{(i % cols) * 640}_{(i // cols) * 480}' for i in range(len(files)))
    args += ['-filter_complex', f'xstack=inputs={len(files)}:layout={layout}:fill=white',
             os.path.join(RENDER_DIR, '_contact_sheet.png')]
    subprocess.run(args, check=False)


def main():
    names, flags = parse_args()
    names = names or list(PROPS.keys())
    report = []
    for name in names:
        t0 = time.time()
        reset()
        root = PROPS[name]()
        keep = {root.name} | {o.name for o in root.children_recursive}
        for o in list(bpy.context.scene.objects):
            if o.name not in keep:
                bpy.data.objects.remove(o)       # stray construction objects must not show up in renders
        bpy.context.view_layer.update()
        tris = tri_count(root)
        path = os.path.join(OUT_DIR, f'{name}.glb')
        uses_tex = any(m.node_tree and any(n.type == 'TEX_IMAGE' for n in m.node_tree.nodes)
                       for m in bpy.data.materials)
        size = export_glb(root, path, texcoords=uses_tex)
        mn, mx = bounds(root)
        if '--no-render' not in flags:
            human = human_ref(0.0, mx.y + 0.55)
            hero = HERO_VIEW.get(name, (32, 18))
            render_views(root, name, RENDER_DIR, [hero, (215, 22), (90, 8)], res=(640, 480), fov=30,
                         pad=1.04, ground_z=0.0, extra=[human], extra_views={2})
        nodes = sorted(o.name for o in root.children_recursive if o.type == 'EMPTY')
        dims = mx - mn
        report.append((name, tris, size, nodes, dims, time.time() - t0))
        print(f'[props] {name}: {tris} tris, {size / 1024:.1f} KB')
    if '--no-render' not in flags:
        contact_sheet()
    print('\n[props] SUMMARY')
    for name, tris, size, nodes, dims, dt in report:
        lim = BUDGET.get(name, 6000)
        flag = '' if tris <= lim else '  OVER BUDGET'
        print(f'[props] {name:18s} tris={tris:5d}/{lim} size={size / 1024:7.1f}KB '
              f'dims(x,y,z)=({dims.x:.2f},{dims.y:.2f},{dims.z:.2f}) empties={",".join(nodes)} ({dt:.1f}s){flag}')


if __name__ == '__main__':
    main()
