"""
Pesident Evil -- realistic prop toolkit (Blender 5.2, headless). Shared by tools/props/build.py and the per-prop
builder modules in this folder.

Pipeline per prop (see `Baker.finish`):
  1. builders create parts as separate objects with *authoring* materials: procedural PBR (colour noise, grime,
     scratches) or "blueprint projection" materials that project 2D elevation drawings (side / front / rear / top
     views, rasterised by ImageMagick from `Canvas` draw calls) onto the body.
  2. all parts are joined into one mesh, unwrapped into one UV atlas (weighted texel density), and Cycles (Metal GPU)
     bakes base colour, roughness, metalness, tint mask and ambient occlusion into it.
  3. the atlas is composed into two textures: albedo RGBA (alpha = per-instance tint mask, e.g. car / scooter paint)
     and ORM (R = AO, G = roughness, B = metalness) and the mesh is exported as ONE glTF primitive with ONE material.
     Textures are re-encoded to WebP (EXT_texture_webp) by a small GLB post-processor.
  4. optional LOD: a coarser mesh from the same builder gets its own small atlas baked from the finished LOD0 and is
     written as <name>_lod.glb.

Blender coordinates: +X = the prop's left (seen from its front), -Y = front, +Z = up (glTF: +Z front, Y up).
Vehicle builders use (u, s, z) = (forward, left, up) through `V(u, s, z)`.
"""
import bpy, bmesh, math, os, sys, subprocess, time, json, struct, shutil
import numpy as np
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(PROJECT, 'public', 'models', 'props')
WORK = os.path.join(PROJECT, 'tools', 'blender', '_renders', 'props2')      # gitignored intermediates
DOWNLOADS = os.path.join(PROJECT, 'tools', 'blender', '_downloads', 'polyhaven')
MAGICK = '/opt/homebrew/bin/magick'
CWEBP = '/opt/homebrew/bin/cwebp'
FONTS = {
    'arial': '/System/Library/Fonts/Supplemental/Arial.ttf',
    'arialb': '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    'arialblack': '/System/Library/Fonts/Supplemental/Arial Black.ttf',
    'arialnb': '/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf',
    'din': '/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf',
    'dinalt': '/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf',
    'impact': '/System/Library/Fonts/Supplemental/Impact.ttf',
    'verdanab': '/System/Library/Fonts/Supplemental/Verdana Bold.ttf',
    'kannada': '/System/Library/Fonts/Supplemental/Kannada Sangam MN.ttc',
}
os.makedirs(WORK, exist_ok=True)


def log(*a):
    print('[props]', *a, flush=True)


def V(u, s, z):
    """vehicle frame (forward, left, up) -> Blender"""
    return Vector((s, -u, z))


# ================================================================================================ scene
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type != 'CPU'
        sc.cycles.device = 'GPU'
    except Exception as e:  # pragma: no cover
        log('GPU unavailable, baking on CPU', e)
    sc.cycles.samples = 16
    sc.cycles.use_denoising = False
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('world')
    sc.world = w
    w.color = (0.5, 0.5, 0.5)
    try:
        w.light_settings.distance = 0.6
    except Exception:
        pass
    return sc


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def select_only(obs, active=None):
    bpy.context.view_layer.update()
    for o in bpy.context.scene.objects:
        if o is not None:
            o.select_set(False)
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (obs[0] if obs else None)


# ================================================================================================ materials
MATINFO = {}   # material name -> {'metal': socket|float, 'tint': socket|float, 'uv_weight': float}


def _nt(m):
    try:
        m.use_nodes = True
    except Exception:
        pass
    return m.node_tree


class NB:
    """Tiny node-building helper."""

    def __init__(self, nt):
        self.nt = nt
        self.x = -1400

    def n(self, kind, **inputs):
        node = self.nt.nodes.new(kind)
        node.location = (self.x, 0)
        self.x += 60
        for k, v in inputs.items():
            self.set(node.inputs[k], v)
        return node

    def set(self, sock, v):
        if hasattr(v, 'is_output') or isinstance(v, bpy.types.NodeSocket):
            self.nt.links.new(v, sock)
        elif isinstance(v, bpy.types.Node):
            self.nt.links.new(v.outputs[0], sock)
        elif isinstance(v, (tuple, list)):
            if len(v) == 3 and sock.type == 'RGBA':
                v = (*v, 1.0)
            sock.default_value = v
        else:
            sock.default_value = v

    def math(self, op, a, b=0.0, clamp=False):
        node = self.n('ShaderNodeMath')
        node.operation = op
        node.use_clamp = clamp
        self.set(node.inputs[0], a)
        self.set(node.inputs[1], b)
        return node.outputs[0]

    def mix(self, fac, a, b, blend='MIX'):
        node = self.n('ShaderNodeMix')
        node.data_type = 'RGBA'
        node.blend_type = blend
        self.set(node.inputs['Factor'], fac)
        self.set(node.inputs[6], a)
        self.set(node.inputs[7], b)
        return node.outputs[2]

    def mixf(self, fac, a, b):
        node = self.n('ShaderNodeMix')
        node.data_type = 'FLOAT'
        self.set(node.inputs['Factor'], fac)
        self.set(node.inputs[2], a)
        self.set(node.inputs[3], b)
        return node.outputs[0]

    def ramp(self, fac, a, b, pa=0.0, pb=1.0):
        node = self.n('ShaderNodeMapRange')
        self.set(node.inputs['Value'], fac)
        node.inputs['From Min'].default_value = pa
        node.inputs['From Max'].default_value = pb
        node.inputs['To Min'].default_value = a
        node.inputs['To Max'].default_value = b
        node.clamp = True
        return node.outputs[0]

    def objco(self):
        if not hasattr(self, '_tc'):
            self._tc = self.n('ShaderNodeTexCoord')
        return self._tc.outputs['Object']

    def xyz(self):
        if not hasattr(self, '_sep'):
            self._sep = self.n('ShaderNodeSeparateXYZ')
            self.set(self._sep.inputs[0], self.objco())
        return self._sep.outputs

    def noise(self, scale, detail=4.0, rough=0.55, vec=None, dist=0.0):
        node = self.n('ShaderNodeTexNoise')
        node.inputs['Scale'].default_value = scale
        node.inputs['Detail'].default_value = detail
        node.inputs['Roughness'].default_value = rough
        try:
            node.inputs['Distortion'].default_value = dist
        except Exception:
            pass
        self.set(node.inputs['Vector'], vec if vec is not None else self.objco())
        return node.outputs['Fac']

    def image(self, img, vec, extension='EXTEND', interp='Linear'):
        node = self.n('ShaderNodeTexImage')
        node.image = img
        node.extension = extension
        node.interpolation = interp
        self.set(node.inputs['Vector'], vec)
        return node


def new_material(name):
    if name in bpy.data.materials:
        return bpy.data.materials[name], None
    m = bpy.data.materials.new(name)
    nt = _nt(m)
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    return m, nt


def _finish_mat(m, nt, nb, base, rough, metal, tint=0.0, emit=None, emit_strength=0.0, uv_weight=1.0, bump=None):
    bsdf = nb.n('ShaderNodeBsdfPrincipled')
    nb.set(bsdf.inputs['Base Color'], base)
    nb.set(bsdf.inputs['Roughness'], rough)
    nb.set(bsdf.inputs['Metallic'], metal)
    if emit is not None:
        nb.set(bsdf.inputs['Emission Color'], emit)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    if bump is not None:
        bn = nb.n('ShaderNodeBump', Strength=bump[1], Distance=bump[2] if len(bump) > 2 else 0.002)
        nb.set(bn.inputs['Height'], bump[0])
        nb.set(bsdf.inputs['Normal'], bn.outputs['Normal'])
    out = nb.n('ShaderNodeOutputMaterial')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    MATINFO[m.name] = {'metal': metal, 'tint': tint, 'uv_weight': uv_weight, 'bsdf': bsdf, 'base': base}
    return m


def hexcol(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def col(c):
    return hexcol(c) if isinstance(c, str) else tuple(c)


def pbr(name, color, rough=0.5, metal=0.0, *, var=0.06, var_scale=40.0, grime=0.0, grime_z=(0.0, 0.5),
        grime_col='#6e5f4c', scratch=0.0, tint=0.0, emit=None, emit_strength=0.0, uv_weight=1.0, rough_var=0.08,
        bump=0.0, bump_scale=300.0, stripes=None):
    """Procedural PBR: base colour with low-frequency variation, dust/grime rising from the ground (object Z),
    optional edge-less scratches and a micro bump (baked into nothing but roughness variation)."""
    m, nt = new_material(name)
    if nt is None:
        return m
    nb = NB(nt)
    c = col(color)
    base = nb.n('ShaderNodeRGB')
    base.outputs[0].default_value = (*c, 1.0)
    cur = base.outputs[0]
    r_cur = rough
    if var > 0:
        nz = nb.noise(var_scale, 5.0, 0.6)
        f = nb.math('MULTIPLY', nb.math('SUBTRACT', nz, 0.5), var * 2.0)
        cur = nb.mix(1.0, cur, nb.math('ADD', 1.0, f), 'MULTIPLY')
    if rough_var > 0:
        nz2 = nb.noise(var_scale * 1.7, 3.0, 0.5)
        r_cur = nb.math('ADD', rough, nb.math('MULTIPLY', nb.math('SUBTRACT', nz2, 0.5), rough_var * 2), clamp=True)
    if scratch > 0:
        sv = nb.n('ShaderNodeTexVoronoi')
        sv.feature = 'DISTANCE_TO_EDGE'
        sv.inputs['Scale'].default_value = 18.0
        nb.set(sv.inputs['Vector'], nb.objco())
        s_mask = nb.math('LESS_THAN', sv.outputs['Distance'], 0.012 * scratch)
        s_mask = nb.math('MULTIPLY', s_mask, nb.math('GREATER_THAN', nb.noise(6.0, 2.0), 0.55))
        cur = nb.mix(nb.math('MULTIPLY', s_mask, 0.6), cur, col('#b8b4ac'))
        r_cur = nb.mixf(s_mask, r_cur, min(1.0, rough + 0.25))
    if grime > 0:
        z = nb.xyz()[2]
        g = nb.ramp(z, 1.0, 0.0, grime_z[0], grime_z[1])
        n3 = nb.noise(8.0, 6.0, 0.7)
        g = nb.math('MULTIPLY', g, nb.ramp(n3, 0.35, 1.0, 0.3, 0.7))
        g = nb.math('MULTIPLY', g, grime, clamp=True)
        cur = nb.mix(g, cur, col(grime_col))
        r_cur = nb.mixf(g, r_cur, 0.9)
    if stripes is not None:     # (axis, period, duty, colour) e.g. hazard stripes
        ax, period, duty, c2 = stripes
        coord = nb.xyz()[ax] if not isinstance(ax, tuple) else nb.math('ADD', nb.xyz()[ax[0]], nb.xyz()[ax[1]])
        w = nb.math('FRACT', nb.math('DIVIDE', coord, period))
        cur = nb.mix(nb.math('LESS_THAN', w, duty), cur, col(c2))
    bump_def = None
    if bump > 0:
        bump_def = (nb.noise(bump_scale, 2.0, 0.5), bump, 0.001)
    return _finish_mat(m, nt, nb, cur, r_cur, metal, tint=tint, emit=col(emit) if emit else None,
                       emit_strength=emit_strength, uv_weight=uv_weight, bump=bump_def)


def image_mat(name, img, vec_fn, rough=0.5, metal=0.0, tint=0.0, uv_weight=1.0, rough_img=None, metal_img=None,
              tint_img=None, grime=0.0, grime_z=(0.0, 0.5), grime_col='#6e5f4c', extension='EXTEND'):
    """Material from an image texture addressed by vec_fn(nb) -> vector socket (e.g. a planar projection)."""
    m, nt = new_material(name)
    if nt is None:
        return m
    nb = NB(nt)
    vec = vec_fn(nb)
    t = nb.image(img, vec, extension)
    cur = t.outputs['Color']
    r = rough if rough_img is None else nb.image(rough_img, vec, extension).outputs['Color']
    mt = metal if metal_img is None else nb.image(metal_img, vec, extension).outputs['Color']
    tn = tint if tint_img is None else nb.image(tint_img, vec, extension).outputs['Color']
    if grime > 0:
        z = nb.xyz()[2]
        g = nb.ramp(z, 1.0, 0.0, grime_z[0], grime_z[1])
        g = nb.math('MULTIPLY', g, nb.ramp(nb.noise(8.0, 6.0, 0.7), 0.35, 1.0, 0.3, 0.7))
        g = nb.math('MULTIPLY', g, grime, clamp=True)
        cur = nb.mix(g, cur, col(grime_col))
        if rough_img is None:
            r = nb.mixf(g, r, 0.9)
    return _finish_mat(m, nt, nb, cur, r, mt, tint=tn, uv_weight=uv_weight)


def load_image(path, colorspace='sRGB'):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = colorspace
    return img


# ------------------------------------------------------------------------------------------------ projection
class Proj:
    """Blueprint projection: world box [u0,u1]x[s0,s1]x[z0,z1] (vehicle frame). Each view image covers the box
    face-on as a viewer standing there sees it (text reads correctly): 'L' (from the vehicle's left side: front on the
    image left), 'R' (from the right: front on the image right),
    'F' (from the front, vehicle's left on the image right), 'B' (from behind), 'T' (from above, front up)."""

    def __init__(self, u0, u1, s0, s1, z0, z1):
        self.u0, self.u1, self.s0, self.s1, self.z0, self.z1 = u0, u1, s0, s1, z0, z1

    def canvas(self, view, ppm, **kw):
        if view in 'LR':
            a0, a1, b0, b1 = self.u0, self.u1, self.z0, self.z1
        elif view in 'FB':
            a0, a1, b0, b1 = self.s0, self.s1, self.z0, self.z1
        else:
            a0, a1, b0, b1 = self.s0, self.s1, self.u0, self.u1
        return Canvas(view, a0, a1, b0, b1, ppm, **kw)

    def uv_socket(self, nb, view):
        """Object coords -> image UV for a view. Blender: x = s, y = -u, z = z."""
        x, y, z = nb.xyz()
        u = nb.math('MULTIPLY', y, -1.0)
        s = x
        du, ds, dz = self.u1 - self.u0, self.s1 - self.s0, self.z1 - self.z0
        if view == 'L':     # seen from the left side the front is on the image left
            a, b = nb.math('DIVIDE', nb.math('SUBTRACT', self.u1, u), du), nb.math('DIVIDE', nb.math('SUBTRACT', z, self.z0), dz)
        elif view == 'R':   # seen from the right side the front is on the image right
            a, b = nb.math('DIVIDE', nb.math('SUBTRACT', u, self.u0), du), nb.math('DIVIDE', nb.math('SUBTRACT', z, self.z0), dz)
        elif view == 'F':   # from the front: vehicle's right (s0) on the image left
            a, b = nb.math('DIVIDE', nb.math('SUBTRACT', s, self.s0), ds), nb.math('DIVIDE', nb.math('SUBTRACT', z, self.z0), dz)
        elif view == 'B':   # from behind: vehicle's left (s1) on the image left
            a, b = nb.math('DIVIDE', nb.math('SUBTRACT', self.s1, s), ds), nb.math('DIVIDE', nb.math('SUBTRACT', z, self.z0), dz)
        else:               # 'T' from above, front at the image top: x = right..left? keep x = s (right on left)
            a, b = nb.math('DIVIDE', nb.math('SUBTRACT', self.s1, s), ds), nb.math('DIVIDE', nb.math('SUBTRACT', u, self.u0), du)
        cmb = nb.n('ShaderNodeCombineXYZ')
        nb.set(cmb.inputs[0], a)
        nb.set(cmb.inputs[1], b)
        return cmb.outputs[0]


def proj_material(name, proj, views, *, sharp=6.0, uv_weight=1.0, grime=0.0, grime_z=(0.0, 0.5),
                  grime_col='#6e5f4c', base_rough=0.4, fallback=None):
    """views: {'L': layers, 'R': layers, 'F': ..., 'B': ..., 'T': ...} where layers = Canvas.save() result
    (dict albedo/rough/metal/tint image paths). Blends the views by the (object-space) normal."""
    m, nt = new_material(name)
    if nt is None:
        return m
    nb = NB(nt)
    geo = nb.n('ShaderNodeNewGeometry')
    nsep = nb.n('ShaderNodeSeparateXYZ')
    nb.set(nsep.inputs[0], geo.outputs['Normal'])
    nx, ny, nz = nsep.outputs   # Blender normal: x = +s (left), y = -u, z = up
    # weights: |n|^sharp, split by sign
    def pos(v):
        return nb.math('POWER', nb.math('MAXIMUM', v, 0.0), sharp)

    def neg(v):
        return nb.math('POWER', nb.math('MAXIMUM', nb.math('MULTIPLY', v, -1.0), 0.0), sharp)
    wts = {'L': pos(nx), 'R': neg(nx), 'F': neg(ny), 'B': pos(ny), 'T': pos(nz), 'D': neg(nz)}
    chans = {'albedo': None, 'rough': None, 'metal': None, 'tint': None}
    total = None
    acc = {k: None for k in chans}
    for view, w in wts.items():
        if view not in views:
            continue
        lay = views[view]
        vec = proj.uv_socket(nb, view if view != 'D' else 'T')
        total = w if total is None else nb.math('ADD', total, w)
        for ch in chans:
            if ch not in lay:
                continue
            img = load_image(lay[ch], 'sRGB' if ch == 'albedo' else 'Non-Color')
            s = nb.image(img, vec).outputs['Color']
            if ch == 'albedo':
                term = _scale_rgb(nb, s, w)
                acc[ch] = term if acc[ch] is None else nb.mix(1.0, acc[ch], term, 'ADD')
            else:
                term = nb.math('MULTIPLY', s, w)
                acc[ch] = term if acc[ch] is None else nb.math('ADD', acc[ch], term)
    inv = nb.math('DIVIDE', 1.0, nb.math('MAXIMUM', total, 1e-4))
    albedo = _scale_rgb(nb, acc['albedo'], inv)
    rough = nb.math('MULTIPLY', acc['rough'], inv) if acc['rough'] is not None else base_rough
    metal = nb.math('MULTIPLY', acc['metal'], inv) if acc['metal'] is not None else 0.0
    tint = nb.math('MULTIPLY', acc['tint'], inv) if acc['tint'] is not None else 0.0
    if grime > 0:
        z = nb.xyz()[2]
        g = nb.ramp(z, 1.0, 0.0, grime_z[0], grime_z[1])
        g = nb.math('MULTIPLY', g, nb.ramp(nb.noise(6.0, 6.0, 0.7), 0.3, 1.0, 0.3, 0.7))
        g = nb.math('MULTIPLY', g, grime, clamp=True)
        albedo = nb.mix(g, albedo, col(grime_col))
        rough = nb.mixf(g, rough, 0.85)
    # subtle large-scale variation so flat paint isn't CG-flat
    nz = nb.noise(3.0, 4.0, 0.6)
    albedo = nb.mix(1.0, albedo, nb.math('ADD', 0.97, nb.math('MULTIPLY', nz, 0.06)), 'MULTIPLY')
    return _finish_mat(m, nt, nb, albedo, rough, metal, tint=tint, uv_weight=uv_weight)


def _scale_rgb(nb, color, f):
    node = nb.n('ShaderNodeVectorMath')
    node.operation = 'SCALE'
    nb.set(node.inputs[0], color)
    nb.set(node.inputs['Scale'], f)
    return node.outputs[0]


# ------------------------------------------------------------------------------------------------ canvas (ImageMagick)
class Canvas:
    """2D elevation drawing in world metres, rasterised with ImageMagick into albedo / rough / metal / tint layers.
    Material spec for every draw call: M(colour, rough, metal, tint)."""

    def __init__(self, view, a0, a1, b0, b1, ppm, bg=None):
        self.view, self.a0, self.a1, self.b0, self.b1, self.ppm = view, a0, a1, b0, b1, ppm
        self.w = max(8, int(round((a1 - a0) * ppm)))
        self.h = max(8, int(round((b1 - b0) * ppm)))
        self.cmds = {'albedo': [], 'rough': [], 'metal': [], 'tint': []}
        self.bg = bg or Mat('#808080', 0.5, 0.0, 0.0)
        self.post = []    # extra magick args for the albedo layer (noise etc.)

    def P(self, a, b):
        """world (a, b) -> pixel (x, y). For L/R views a = u, b = z; F/B: a = s, b = z; T: a = s, b = u.
        The mirroring per view matches Proj.uv_socket."""
        if self.view == 'L':
            x = (self.a1 - a) / (self.a1 - self.a0)
        elif self.view == 'R':
            x = (a - self.a0) / (self.a1 - self.a0)
        elif self.view == 'F':
            x = (a - self.a0) / (self.a1 - self.a0)
        else:   # B, T
            x = (self.a1 - a) / (self.a1 - self.a0)
        y = (b - self.b0) / (self.b1 - self.b0)
        return x * self.w, (1.0 - y) * self.h

    def _emit(self, mat, shape_fn):
        for layer in self.cmds:
            fill = mat.layer(layer)
            if fill is None:
                continue
            self.cmds[layer].append(shape_fn(fill, layer))

    def poly(self, pts, mat, stroke=None):
        P = [self.P(a, b) for a, b in pts]
        s = ' '.join(f'{x:.2f},{y:.2f}' for x, y in P)
        self._emit(mat, lambda f, l: f"fill '{f}' stroke none polygon {s}")

    def polyline(self, pts, mat, width_m):
        P = [self.P(a, b) for a, b in pts]
        s = ' '.join(f'{x:.2f},{y:.2f}' for x, y in P)
        sw = max(0.6, width_m * self.ppm)
        self._emit(mat, lambda f, l: f"fill none stroke '{f}' stroke-width {sw:.2f} stroke-linejoin round stroke-linecap round polyline {s}")

    def rect(self, a0, b0, a1, b1, mat, r=0.0):
        x0, y0 = self.P(a0, b0)
        x1, y1 = self.P(a1, b1)
        x0, x1 = min(x0, x1), max(x0, x1)
        y0, y1 = min(y0, y1), max(y0, y1)
        rp = r * self.ppm
        if rp > 0.3:
            self._emit(mat, lambda f, l: f"fill '{f}' stroke none roundrectangle {x0:.2f},{y0:.2f} {x1:.2f},{y1:.2f} {rp:.2f},{rp:.2f}")
        else:
            self._emit(mat, lambda f, l: f"fill '{f}' stroke none rectangle {x0:.2f},{y0:.2f} {x1:.2f},{y1:.2f}")

    def ellipse(self, a, b, ra, rb, mat):
        x, y = self.P(a, b)
        self._emit(mat, lambda f, l: f"fill '{f}' stroke none ellipse {x:.2f},{y:.2f} {ra * self.ppm:.2f},{rb * self.ppm:.2f} 0,360")

    def line(self, a0, b0, a1, b1, mat, width_m):
        self.polyline([(a0, b0), (a1, b1)], mat, width_m)

    def text(self, a, b, txt, height_m, mat, font='arialb', anchor='center', kern=0.0, stretch=1.0, rot=0.0):
        """Text anchored at world (a, b) (centre, or 'w'/'e' = left/right edge centre). height_m ~ cap height."""
        x, y = self.P(a, b)
        size = height_m * self.ppm * 1.38
        f = FONTS.get(font, font)
        self._emit(mat, lambda fill, layer: ('TEXT', txt, f, size, fill, x, y, anchor, kern, stretch, rot))

    def image(self, path, a, b, w_m, h_m, layers=('albedo',)):
        """Composite an image (e.g. a logo) centred at (a, b), w_m x h_m metres, on the given layers only."""
        x, y = self.P(a, b)
        for layer in layers:
            self.cmds[layer].append(('IMAGE', path, x, y, w_m * self.ppm, h_m * self.ppm))

    def stext(self, a, b, txt, height_m, mat, font='Kannada Sangam MN', anchor='center'):
        """Shaped text (CoreText via render_text.swift) -- for Kannada. height_m = full glyph box height."""
        x, y = self.P(a, b)
        self._emit(mat, lambda fill, layer: ('SHAPED', txt, font, fill, x, y, height_m * self.ppm, anchor))

    _measure_cache = {}

    @staticmethod
    def _label_args(txt, font, size, fill, kern, stretch, rot):
        a = ['-background', 'none', '-fill', fill, '-font', font, '-pointsize', f'{size:.1f}',
             '-kerning', f'{kern * size:.2f}', f'label:{txt}', '-trim', '+repage']
        if stretch != 1.0:
            a += ['-resize', f'{stretch * 100:.2f}%x100%!']
        if rot:
            a += ['-rotate', f'{rot:.2f}']
        return a

    def _measure(self, txt, font, size, kern, stretch, rot):
        key = (txt, font, round(size, 1), kern, stretch, rot)
        if key not in self._measure_cache:
            args = [MAGICK] + self._label_args(txt, font, size, '#ffffff', kern, stretch, rot) + ['-format', '%w %h', 'info:']
            wh = subprocess.run(args, capture_output=True, text=True).stdout.split()
            self._measure_cache[key] = (int(wh[0]), int(wh[1])) if len(wh) == 2 else (0, 0)
        return self._measure_cache[key]

    def save(self, name, noise=0.0, blur=0.0):
        """Rasterise all layers -> {layer: png path}."""
        out = {}
        for layer, cmds in self.cmds.items():
            path = os.path.join(WORK, f'{name}_{self.view}_{layer}.png')
            bgc = self.bg.layer(layer) or '#000000'
            args = [MAGICK, '-size', f'{self.w}x{self.h}', f'xc:{bgc}']
            batch = []
            nb = [0]

            def flush():
                if batch:
                    mvg = os.path.join(WORK, f'{name}_{self.view}_{layer}_{nb[0]}.mvg')
                    nb[0] += 1
                    with open(mvg, 'w') as fh:
                        fh.write('\n'.join(batch))
                    args.extend(['-draw', f'@{mvg}'])
                    batch.clear()
            for c in cmds:
                if isinstance(c, tuple) and c[0] == 'TEXT':
                    flush()
                    _, txt, font, size, fill, x, y, anchor, kern, stretch, rot = c
                    tw, th = self._measure(txt, font, size, kern, stretch, rot)
                    ox = x - tw / 2 if anchor == 'center' else (x if anchor == 'w' else x - tw)
                    oy = y - th / 2
                    args += ['('] + self._label_args(txt, font, size, fill, kern, stretch, rot) + [')',
                             '-geometry', f'{ox:+.0f}{oy:+.0f}', '-compose', 'over', '-composite']
                elif isinstance(c, tuple) and c[0] == 'SHAPED':
                    flush()
                    _, txt, font, fill, x, y, hpx, anchor = c
                    p = shaped_png(txt, font, fill)
                    wh = subprocess.run([MAGICK, 'identify', '-format', '%w %h', p], capture_output=True, text=True).stdout.split()
                    tw, th = int(wh[0]), int(wh[1])
                    wpx = tw * hpx / th
                    ox = x - wpx / 2 if anchor == 'center' else (x if anchor == 'w' else x - wpx)
                    args += ['(', p, '-resize', f'{wpx:.0f}x{hpx:.0f}!', ')', '-geometry', f'{ox:+.0f}{y - hpx / 2:+.0f}',
                             '-compose', 'over', '-composite']
                elif isinstance(c, tuple) and c[0] == 'IMAGE':
                    flush()
                    _, p, x, y, wpx, hpx = c
                    args += ['(', p, '-resize', f'{wpx:.0f}x{hpx:.0f}!', ')', '-geometry',
                             f'{x - wpx / 2:+.0f}{y - hpx / 2:+.0f}', '-compose', 'over', '-composite']
                else:
                    batch.append(c)
            flush()
            if layer == 'albedo':
                if noise > 0:
                    args += ['-attenuate', f'{noise}', '+noise', 'Gaussian']
                if blur > 0:
                    args += ['-blur', f'0x{blur}']
            elif blur > 0:
                args += ['-blur', f'0x{blur}']
            args += ['-alpha', 'off', '-depth', '8', path]
            r = subprocess.run(args, capture_output=True, text=True)
            if r.returncode != 0:
                raise RuntimeError('magick failed: ' + r.stderr[-2000:])
            out[layer] = path
        return out


_SWIFT_BIN = os.path.join(WORK, 'render_text')


def shaped_png(txt, font, fill):
    """Render shaped text to a transparent PNG (cached). Compiles tools/props/render_text.swift on first use."""
    import hashlib
    if not os.path.exists(_SWIFT_BIN):
        subprocess.run(['/usr/bin/swiftc', '-O', os.path.join(HERE, 'render_text.swift'), '-o', _SWIFT_BIN], check=True)
    key = hashlib.md5(f'{txt}|{font}|{fill}'.encode()).hexdigest()[:12]
    out = os.path.join(WORK, f'txt_{key}.png')
    if not os.path.exists(out):
        subprocess.run([_SWIFT_BIN, txt, font, '160', fill, out], check=True)
    return out


class Mat:
    """2D material for Canvas: colour (sRGB hex), roughness, metalness, tint (paint mask)."""

    def __init__(self, color, rough=0.5, metal=0.0, tint=0.0):
        self.color, self.rough, self.metal, self.tint = color, rough, metal, tint

    def layer(self, layer):
        if layer == 'albedo':
            return self.color
        v = {'rough': self.rough, 'metal': self.metal, 'tint': self.tint}[layer]
        if v is None:
            return None
        g = int(round(max(0.0, min(1.0, v)) * 255))
        return f'#{g:02x}{g:02x}{g:02x}'


# ================================================================================================ geometry
def new_obj(name, verts, faces, mat=None, smooth_angle=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.validate()
    me.update()
    ob = link(bpy.data.objects.new(name, me))
    if mat is not None:
        me.materials.append(mat)
    clean(ob)
    if smooth_angle is not None:
        smooth(ob, smooth_angle)
    return ob


def clean(ob, dist=1e-6, recalc=True, inside=False):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=dist)
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        if inside:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def smooth(ob, angle=35):
    me = ob.data
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(angle))
    return ob


def flat(ob):
    ob.data.shade_flat()
    return ob


def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)
    return ob


def bevel(ob, w, seg=1, angle=30, harden=False):
    md = ob.modifiers.new('bev', 'BEVEL')
    md.width = w
    md.segments = seg
    md.limit_method = 'ANGLE'
    md.angle_limit = math.radians(angle)
    md.harden_normals = harden
    md.use_clamp_overlap = True
    md.miter_outer = 'MITER_ARC'
    apply_mods(ob)
    return ob


def subdivide(ob, levels=1, simple=False):
    md = ob.modifiers.new('sub', 'SUBSURF')
    md.levels = levels
    md.render_levels = levels
    if simple:
        md.subdivision_type = 'SIMPLE'
    apply_mods(ob)
    return ob


def decimate(ob, ratio):
    md = ob.modifiers.new('dec', 'DECIMATE')
    md.ratio = ratio
    md.use_collapse_triangulate = True
    apply_mods(ob)
    return ob


def xform(ob, loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    mx = Matrix.Translation(Vector(loc)) @ Euler(rot, 'XYZ').to_matrix().to_4x4()
    if scale is not None:
        mx = mx @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))
    ob.data.transform(mx)
    if scale is not None and scale[0] * scale[1] * scale[2] < 0:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(ob.data)
        bm.free()
    ob.data.update()
    return ob


def mirror_x(ob, merge=True):
    """Mirror across Blender X (vehicle left/right)."""
    md = ob.modifiers.new('mir', 'MIRROR')
    md.use_axis = (True, False, False)
    md.use_clip = merge
    md.use_mirror_merge = merge
    md.merge_threshold = 1e-4
    apply_mods(ob)
    return ob


def dup(ob, name=None):
    o2 = ob.copy()
    o2.data = ob.data.copy()
    if name:
        o2.name = name
    link(o2)
    return o2


def join(obs, name):
    obs = [o for o in obs if o is not None]
    base = obs[0]
    if len(obs) > 1:
        select_only(obs, base)
        with bpy.context.temp_override(active_object=base, object=base, selected_objects=obs,
                                       selected_editable_objects=obs):
            bpy.ops.object.join()
    base.name = name
    base.data.name = name
    return base


def loft(name, sections, mat=None, closed=True, cap0=False, cap1=False, smooth_angle=45):
    n = len(sections[0])
    verts, faces = [], []
    for s in sections:
        assert len(s) == n, (name, len(s), n)
        verts.extend(s)
    m = len(sections)
    for i in range(m - 1):
        a, b = i * n, (i + 1) * n
        for j in range(n if closed else n - 1):
            j2 = (j + 1) % n
            faces.append((a + j, a + j2, b + j2, b + j))
    if cap0:
        faces.append(tuple(reversed(range(n))))
    if cap1:
        faces.append(tuple(range((m - 1) * n, m * n)))
    return new_obj(name, verts, faces, mat, smooth_angle)


def lathe(name, prof, segs, mat=None, axis='Z', loc=(0, 0, 0), rot=(0, 0, 0), cap=True, phase=None,
          smooth_angle=40, arc=None):
    """Revolve profile [(r, h)] around Z (then rotated to `axis`). r == 0 makes a pole. arc=(a0, a1) partial."""
    if phase is None:
        phase = math.pi / segs
    full = arc is None
    verts, faces, rows = [], [], []
    nseg = segs if full else segs + 1
    for r, h in prof:
        if r <= 1e-7:
            rows.append([len(verts)])
            verts.append((0.0, 0.0, h))
        else:
            row = []
            for k in range(nseg):
                a = (phase + 2 * math.pi * k / segs) if full else (arc[0] + (arc[1] - arc[0]) * k / segs)
                row.append(len(verts))
                verts.append((r * math.cos(a), r * math.sin(a), h))
            rows.append(row)
    for i in range(len(rows) - 1):
        A, B = rows[i], rows[i + 1]
        if len(A) == 1 and len(B) == 1:
            continue
        for k in range(segs):
            k2 = (k + 1) % nseg if full else k + 1
            if len(A) == 1:
                faces.append((A[0], B[k], B[k2]))
            elif len(B) == 1:
                faces.append((A[k], A[k2], B[0]))
            else:
                faces.append((A[k], A[k2], B[k2], B[k]))
    if cap and full:
        if len(rows[0]) > 1:
            faces.append(tuple(reversed(rows[0])))
        if len(rows[-1]) > 1:
            faces.append(tuple(rows[-1]))
    ob = new_obj(name, verts, faces, mat)
    if axis == 'Y':
        ob.data.transform(Matrix.Rotation(-math.pi / 2, 4, 'X'))
    elif axis == 'X':
        ob.data.transform(Matrix.Rotation(math.pi / 2, 4, 'Y'))
    xform(ob, loc, rot)
    if smooth_angle is not None:
        smooth(ob, smooth_angle)
    return ob


def rrect(w, h, r=0.0, n=2, cx=0.0, cy=0.0):
    """Rounded rectangle points (CCW) in 2D."""
    r = max(0.0, min(r, w / 2 - 1e-5, h / 2 - 1e-5))
    pts = []
    corners = [(w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)]
    for x, y, a0 in corners:
        if r <= 0 or n == 0:
            pts.append((cx + math.copysign(w / 2, x), cy + math.copysign(h / 2, y)))
        else:
            for k in range(n + 1):
                a = math.radians(a0 + 90.0 * k / n)
                pts.append((cx + x + r * math.cos(a), cy + y + r * math.sin(a)))
    return pts


def superellipse(a, b, n, e=2.5, cx=0.0, cy=0.0, phase=0.0):
    pts = []
    for k in range(n):
        t = phase + 2 * math.pi * k / n
        c, s = math.cos(t), math.sin(t)
        pts.append((cx + a * math.copysign(abs(c) ** (2 / e), c), cy + b * math.copysign(abs(s) ** (2 / e), s)))
    return pts


def box(name, size, loc=(0, 0, 0), mat=None, bev=0.0, seg=1, rot=(0, 0, 0), smooth_angle=35):
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    v = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz), (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ob = new_obj(name, v, f, mat)
    if bev > 0:
        bevel(ob, bev, seg, harden=False)
    xform(ob, loc, rot)
    smooth(ob, smooth_angle)
    return ob


def cyl(name, r, depth, loc=(0, 0, 0), mat=None, axis='Z', segs=16, r2=None, rot=(0, 0, 0), cap=True, smooth_angle=40):
    r2 = r if r2 is None else r2
    return lathe(name, [(r, -depth / 2), (r2, depth / 2)], segs, mat, axis, loc, rot, cap=cap, smooth_angle=smooth_angle)


def tube(name, pts, r, segs=8, mat=None, cap=True, closed=False, smooth_angle=50, r_end=None):
    """Sweep a circle along a polyline (parallel transport frames, mitred joints)."""
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
            N = T[i - 1].rotation_difference(T[i]) @ N
            N = (N - N.project(T[i])).normalized()
        B = T[i].cross(N)
        rr = r if r_end is None else r + (r_end - r) * i / max(1, n - 1)
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
            off = N * math.cos(a) * rr + B * math.sin(a) * rr
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
    return new_obj(name, verts, faces, mat, smooth_angle)


def bezier(p0, p1, p2, p3=None, n=8):
    """Quadratic (3 pts) or cubic (4 pts) Bezier -> n+1 points."""
    P0, P1, P2 = Vector(p0), Vector(p1), Vector(p2)
    out = []
    for k in range(n + 1):
        t = k / n
        if p3 is None:
            out.append((1 - t) ** 2 * P0 + 2 * (1 - t) * t * P1 + t * t * P2)
        else:
            P3 = Vector(p3)
            out.append((1 - t) ** 3 * P0 + 3 * (1 - t) ** 2 * t * P1 + 3 * (1 - t) * t * t * P2 + t ** 3 * P3)
    return out


def fillet(pts, rad, n=3):
    P = [Vector(p) for p in pts]
    out = [P[0]]
    for i in range(1, len(P) - 1):
        a, b, c = P[i - 1], P[i], P[i + 1]
        d1, d2 = (b - a), (c - b)
        r1, r2 = min(rad, d1.length * 0.45), min(rad, d2.length * 0.45)
        p0 = b - d1.normalized() * r1
        p2 = b + d2.normalized() * r2
        for k in range(n + 1):
            t = k / n
            out.append((1 - t) ** 2 * p0 + 2 * (1 - t) * t * b + t * t * p2)
    out.append(P[-1])
    return out


def prism(name, pts2d, axis, t0, t1, mat=None, bev=0.0, seg=1, smooth_angle=35):
    """Extrude a closed 2D outline along an axis. axis 'X': (a,b) -> (t, a, b); 'Y': (a, t, b); 'Z': (a, b, t)."""
    def lift(t):
        if axis == 'X':
            return [(t, a, b) for a, b in pts2d]
        if axis == 'Y':
            return [(a, t, b) for a, b in pts2d]
        return [(a, b, t) for a, b in pts2d]
    ob = loft(name, [lift(t0), lift(t1)], mat, cap0=True, cap1=True, smooth_angle=None)
    if bev > 0:
        bevel(ob, bev, seg)
    smooth(ob, smooth_angle)
    return ob


def tyre(name, r_out, width, r_rim, mat, segs=24, prof_n=5, axis='X', loc=(0, 0, 0), sidewall_bulge=0.12, low=False):
    """Tyre as a lathe around the axle: rounded crown + sidewalls down to the rim bead (open inner hole).
    low=True: 6-point profile (for props placed in large numbers)."""
    hw = width / 2
    prof = []
    # from inner bead on one side, up the sidewall, across the crown, down the other side
    rim_h = r_rim + 0.01
    if low:
        side = [(rim_h, -hw * 0.85), (r_out - width * 0.22, -hw * 1.0), (r_out - width * 0.03, -hw * 0.62)]
    else:
        side = [(rim_h, -hw * 0.82), (r_rim + (r_out - r_rim) * 0.45, -hw * (1.0 + sidewall_bulge * 0.3)),
                (r_out - width * 0.18, -hw * 0.98), (r_out - width * 0.04, -hw * 0.7)]
    crown = [(r_out, -hw * 0.35), (r_out, hw * 0.35)] if not low else [(r_out, 0.0)]
    prof = side + crown + [(r, -h) for r, h in reversed(side)]
    ob = lathe(name, [(r, h) for r, h in prof], segs, mat, axis='Z', cap=False, smooth_angle=70)
    if axis == 'X':
        ob.data.transform(Matrix.Rotation(math.pi / 2, 4, 'Y'))
    elif axis == 'Y':
        ob.data.transform(Matrix.Rotation(-math.pi / 2, 4, 'X'))
    xform(ob, loc)
    return ob


def disc(name, r, depth, mat, segs=24, axis='X', loc=(0, 0, 0), dish=0.0, hub_r=0.0):
    """Wheel disc / rim face: a shallow dished cylinder closed on both sides."""
    prof = [(0, -depth / 2 - dish), (hub_r, -depth / 2 - dish) if hub_r else (r * 0.3, -depth / 2 - dish * 0.8),
            (r * 0.92, -depth / 2), (r, -depth / 2 + depth * 0.2), (r, depth / 2), (0, depth / 2)]
    ob = lathe(name, prof, segs, mat, axis='Z', cap=False, smooth_angle=35)
    if axis == 'X':
        ob.data.transform(Matrix.Rotation(math.pi / 2, 4, 'Y'))
    elif axis == 'Y':
        ob.data.transform(Matrix.Rotation(-math.pi / 2, 4, 'X'))
    xform(ob, loc)
    return ob


def delete_faces(ob, pred):
    """Delete faces whose (centre, normal) satisfy pred (object space)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    dead = [f for f in bm.faces if pred(f.calc_center_median(), f.normal)]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def tri_count(ob):
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)


def set_material(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    for p in ob.data.polygons:
        p.material_index = 0
    return ob


def assign_faces(ob, mat, pred):
    """Give faces satisfying pred(centre, normal) material `mat` (appended as a new slot if needed)."""
    me = ob.data
    idx = None
    for i, m in enumerate(me.materials):
        if m == mat:
            idx = i
    if idx is None:
        me.materials.append(mat)
        idx = len(me.materials) - 1
    for p in me.polygons:
        if pred(p.center, p.normal):
            p.material_index = idx
    return ob


# ================================================================================================ bake + export
def _uv_unwrap(ob, margin_px, size):
    """Weighted texel density: faces grouped by their material's uv_weight are unwrapped separately, rescaled to a
    common density x weight, then packed together."""
    me = ob.data
    # bake into a fresh 'atlas' layer; any existing layers (e.g. an imported asset's own UVs, which its image nodes
    # read through UV Map nodes) are kept as bake sources and dropped at export
    atlas = me.uv_layers.get('atlas') or me.uv_layers.new(name='atlas')
    me.uv_layers.active = atlas
    atlas.active_render = True
    # UV operators correct for the aspect of each material's *active image node* (our projection images are not
    # square) -> make a square dummy image the active node everywhere first
    sq = bpy.data.images.get('__square__') or bpy.data.images.new('__square__', 64, 64)
    _bake_target([ob], sq)
    select_only([ob], ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(me)
    uvl = bm.loops.layers.uv.verify()
    weights = {}
    for f in bm.faces:
        mname = me.materials[f.material_index].name if me.materials else ''
        w = MATINFO.get(mname, {}).get('uv_weight', 1.0)
        weights.setdefault(w, []).append(f.index)
    bmesh.update_edit_mesh(me)
    for w, idxs in weights.items():
        bpy.ops.mesh.select_all(action='DESELECT')
        bm = bmesh.from_edit_mesh(me)
        bm.faces.ensure_lookup_table()
        for i in idxs:
            bm.faces[i].select = True
        bmesh.update_edit_mesh(me)
        bpy.ops.uv.smart_project(angle_limit=math.radians(58), island_margin=0.002)
        # rescale these UVs to density sqrt(area3d / areaUV) * w
        bm = bmesh.from_edit_mesh(me)
        bm.faces.ensure_lookup_table()
        uvl = bm.loops.layers.uv.verify()
        a3 = 0.0
        a2 = 0.0
        for i in idxs:
            f = bm.faces[i]
            a3 += f.calc_area()
            uvs = [l[uvl].uv for l in f.loops]
            s = 0.0
            for k in range(len(uvs)):
                x1, y1 = uvs[k]
                x2, y2 = uvs[(k + 1) % len(uvs)]
                s += x1 * y2 - x2 * y1
            a2 += abs(s) / 2
        k = math.sqrt(a3 / max(a2, 1e-12)) * w
        for i in idxs:
            for l in bm.faces[i].loops:
                l[uvl].uv *= k
        bmesh.update_edit_mesh(me)
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    try:
        bpy.ops.uv.pack_islands(rotate=True, margin=margin_px / size * 1.5, shape_method='CONCAVE', scale=True)
    except TypeError:
        bpy.ops.uv.pack_islands(rotate=True, margin=margin_px / size * 1.5)
    bpy.ops.object.mode_set(mode='OBJECT')


def _bake_target(obs, img):
    """Every material on the objects gets an active image node pointing at img."""
    for ob in obs:
        for m in ob.data.materials:
            nt = m.node_tree
            n = nt.nodes.get('__bake__')
            if n is None:
                n = nt.nodes.new('ShaderNodeTexImage')
                n.name = '__bake__'
            n.image = img
            for nn in nt.nodes:
                nn.select = False
            n.select = True
            nt.nodes.active = n


def _emission_rewire(obs, key, default=0.0):
    """Temporarily output MATINFO[mat][key] (float or socket) as emission. Returns restore list."""
    restore = []
    for ob in obs:
        for m in ob.data.materials:
            nt = m.node_tree
            out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
            prev = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].links else None
            em = nt.nodes.new('ShaderNodeEmission')
            em.name = '__emit__'
            info = MATINFO.get(m.name, {})
            v = info.get(key, default)
            if key == 'base' and key not in info:     # unknown material: read its Principled base colour
                bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
                if bsdf is not None:
                    bc = bsdf.inputs['Base Color']
                    v = bc.links[0].from_socket if bc.is_linked else tuple(bc.default_value)
            if isinstance(v, bpy.types.NodeSocket):
                nt.links.new(v, em.inputs['Color'])
            elif isinstance(v, bpy.types.Node):
                nt.links.new(v.outputs[0], em.inputs['Color'])
            elif isinstance(v, (tuple, list)) or hasattr(v, '__len__'):
                c = tuple(v)
                em.inputs['Color'].default_value = (c[0], c[1], c[2], 1.0)
            else:
                em.inputs['Color'].default_value = (float(v), float(v), float(v), 1.0)
            em.inputs['Strength'].default_value = 1.0
            nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
            restore.append((nt, out, prev, em))
    return restore


def _emission_restore(restore):
    for nt, out, prev, em in restore:
        if prev is not None:
            nt.links.new(prev, out.inputs['Surface'])
        nt.nodes.remove(em)


def _img(name, size, float_buf=True):
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=float_buf)
    img.colorspace_settings.name = 'Non-Color'
    return img


def _px(img):
    a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def _lin2srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def _save_png(arr, path, alpha=True):
    """arr: HxWx4 float (already display-encoded where needed), rows bottom-up (Blender) -> PNG."""
    h, w, _ = arr.shape
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=alpha, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(np.ascontiguousarray(arr, dtype=np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    return path


def _bake(obs, kind, img, *, samples=16, margin=8, selected_to_active=False, extrusion=0.02, max_ray=0.06, pass_filter=None):
    sc = bpy.context.scene
    sc.cycles.samples = samples
    _bake_target([o for o in obs if o.get('__target__')] or obs, img)
    kw = dict(type=kind, margin=margin, use_clear=True, target='IMAGE_TEXTURES')
    if pass_filter:
        kw['pass_filter'] = pass_filter
    if selected_to_active:
        kw.update(use_selected_to_active=True, cage_extrusion=extrusion, max_ray_distance=max_ray)
    t = time.time()
    bpy.ops.object.bake(**kw)
    log(f'   bake {kind:9s} {img.size[0]}px {time.time() - t:5.1f}s')


def build_final_material(name, albedo_png, orm_png, tinted):
    """glTF-exportable material: base colour (RGBA, alpha = tint mask, not wired) + ORM."""
    m = bpy.data.materials.new(name)
    nt = _nt(m)
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    nb = NB(nt)
    a = bpy.data.images.load(albedo_png)
    a.colorspace_settings.name = 'sRGB'
    a.alpha_mode = 'CHANNEL_PACKED'
    o = bpy.data.images.load(orm_png)
    o.colorspace_settings.name = 'Non-Color'
    ta = nb.n('ShaderNodeTexImage')
    ta.image = a
    to = nb.n('ShaderNodeTexImage')
    to.image = o
    sep = nb.n('ShaderNodeSeparateColor')
    nt.links.new(to.outputs['Color'], sep.inputs['Color'])
    bsdf = nb.n('ShaderNodeBsdfPrincipled')
    nt.links.new(ta.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    out = nb.n('ShaderNodeOutputMaterial')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    # glTF occlusion via the exporter's custom group
    grp = bpy.data.node_groups.get('glTF Material Output')
    if grp is None:
        grp = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        try:
            grp.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
            grp.interface.new_socket('Thickness', in_out='INPUT', socket_type='NodeSocketFloat')
        except Exception:
            grp.inputs.new('NodeSocketFloat', 'Occlusion')
    gn = nt.nodes.new('ShaderNodeGroup')
    gn.node_tree = grp
    nt.links.new(sep.outputs['Red'], gn.inputs['Occlusion'])
    m['pe_tinted'] = 1 if tinted else 0
    return m


class Baker:
    """Collects parts, then bakes + exports. Usage:
        bk = Baker('bike', tex=1024, orm=512)
        bk.add(obj, ...)      # authoring objects
        bk.finish(lod=builder_fn_for_lod)  -> writes public/models/props/bike.glb (+ bike_lod.glb)"""

    def __init__(self, name, tex=1024, orm=None, ao_dist=0.5, ao_mix=0.55, margin=8, tinted=False, ground=True,
                 ao_samples=64, lod_tex=256):
        self.name, self.tex, self.orm = name, tex, orm or tex // 2
        self.ao_dist, self.ao_mix, self.margin, self.tinted, self.ground = ao_dist, ao_mix, margin, tinted, ground
        self.ao_samples, self.lod_tex = ao_samples, lod_tex
        self.parts = []

    def add(self, *obs):
        for o in obs:
            if o is not None:
                self.parts.append(o)
        return obs[0] if len(obs) == 1 else obs

    # -------------------------------------------------------------------------------------------
    def _bake_atlas(self, target, size, orm_size, sources=None, ao=True, extrusion=0.02, max_ray=0.08):
        """Bake albedo/rough/metal/tint(+AO) into target's UVs. sources=None: bake target's own materials."""
        s2a = sources is not None
        bake_obs = (sources or []) + [target]
        target['__target__'] = 1
        if s2a:
            select_only(bake_obs, target)
        else:
            select_only([target], target)
        imgs = {}
        # base colour
        src_obs = sources if s2a else [target]
        imgs['albedo'] = _img(f'{target.name}_albedo', size)
        r = _emission_rewire(src_obs, 'base', (0.5, 0.5, 0.5))
        _bake(bake_obs, 'EMIT', imgs['albedo'], selected_to_active=s2a, extrusion=extrusion, max_ray=max_ray,
              margin=self.margin)
        _emission_restore(r)
        imgs['rough'] = _img(f'{target.name}_rough', orm_size)
        _bake(bake_obs, 'ROUGHNESS', imgs['rough'], selected_to_active=s2a, extrusion=extrusion, max_ray=max_ray,
              margin=self.margin)
        src_obs = sources if s2a else [target]
        for key in ('metal', 'tint'):
            r = _emission_rewire(src_obs, key)
            imgs[key] = _img(f'{target.name}_{key}', orm_size if key == 'metal' else size)
            _bake(bake_obs, 'EMIT', imgs[key], selected_to_active=s2a, extrusion=extrusion, max_ray=max_ray,
                  margin=self.margin)
            _emission_restore(r)
        if ao:
            hidden = []
            for o in (sources or []):
                o.hide_render = True
                hidden.append(o)
            gp = None
            if self.ground:
                bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, -0.001))
                gp = bpy.context.active_object
            try:
                bpy.context.scene.world.light_settings.distance = self.ao_dist
            except Exception:
                pass
            select_only([target], target)
            imgs['ao'] = _img(f'{target.name}_ao', orm_size)
            _bake([target], 'AO', imgs['ao'], samples=self.ao_samples, margin=self.margin)
            if gp:
                bpy.data.objects.remove(gp, do_unlink=True)
            for o in hidden:
                o.hide_render = False
        del target['__target__']
        return imgs

    def _compose(self, imgs, tag, size, orm_size, ao_mix=None):
        ao_mix = self.ao_mix if ao_mix is None else ao_mix
        alb = _px(imgs['albedo'])[..., :3]
        tint = _px(imgs['tint'])[..., 0]
        if 'ao' in imgs:
            ao = _px(imgs['ao'])[..., 0]
            ao_big = _resize(ao, alb.shape[0])
            alb = alb * (1.0 - ao_mix + ao_mix * ao_big[..., None])
        else:
            ao = np.ones((orm_size, orm_size), np.float32)
        rough = _px(imgs['rough'])[..., 0]
        metal = _px(imgs['metal'])[..., 0]
        rgba = np.zeros((alb.shape[0], alb.shape[1], 4), np.float32)
        rgba[..., :3] = _lin2srgb(alb)
        rgba[..., 3] = np.clip(tint, 0, 1) if self.tinted else 1.0
        orm = np.zeros((orm_size, orm_size, 4), np.float32)
        orm[..., 0] = _resize(ao, orm_size)
        orm[..., 1] = np.clip(_resize(rough, orm_size), 0.03, 1.0)
        orm[..., 2] = np.clip(_resize(metal, orm_size), 0.0, 1.0)
        orm[..., 3] = 1.0
        pa = _save_png(rgba, os.path.join(WORK, f'{self.name}{tag}_albedo.png'), alpha=True)
        po = _save_png(orm, os.path.join(WORK, f'{self.name}{tag}_orm.png'), alpha=False)
        return pa, po

    def finish(self, lod=None, keep=False):
        t0 = time.time()
        # 1. target = joined copy of all parts (authoring materials kept for baking from itself)
        target = join([dup(p) for p in self.parts], self.name)
        _drop_empty_slots(target)
        for p in self.parts:
            bpy.data.objects.remove(p, do_unlink=True)
        self.parts = []
        _uv_unwrap(target, self.margin, self.tex)
        imgs = self._bake_atlas(target, self.tex, self.orm)
        pa, po = self._compose(imgs, '', self.tex, self.orm)
        mat = build_final_material(self.name, pa, po, self.tinted)
        # keep an authoring copy for LOD baking (selected-to-active needs the finished look -> use final material)
        target.data.materials.clear()
        target.data.materials.append(mat)
        for p in target.data.polygons:
            p.material_index = 0
        _only_atlas_uv(target)
        tris = tri_count(target)
        _export(target, os.path.join(OUT, f'{self.name}.glb'), {os.path.basename(pa): (pa, True), os.path.basename(po): (po, False)})
        log(f'{self.name}: {tris} tris, tex {self.tex}/{self.orm}, {time.time() - t0:.1f}s')
        result = {'tris': tris}
        if lod is not None:
            MATINFO[mat.name] = {'metal': _final_metal_socket(mat), 'tint': _final_tint_socket(mat), 'uv_weight': 1.0,
                                 'base': _final_tint_socket(mat).node.outputs['Color']}
            lparts = lod()
            lob = join([p for p in lparts], self.name + '_lod')
            for m in list(lob.data.materials):
                pass
            # LOD gets a single throwaway material for UV weights; bake from the finished LOD0
            lmat = pbr(self.name + '_lodtmp', '#808080')
            lob.data.materials.clear()
            lob.data.materials.append(lmat)
            for p in lob.data.polygons:
                p.material_index = 0
            _uv_unwrap(lob, 3, self.lod_tex)
            limgs = self._bake_atlas(lob, self.lod_tex, self.lod_tex, sources=[target], ao=False,
                                     extrusion=0.06, max_ray=0.15)
            lpa, lpo = self._compose(limgs, '_lod', self.lod_tex, self.lod_tex, ao_mix=0.0)
            # LOD's ORM red channel: AO is already in the LOD0 albedo it was baked from -> 1.0
            lmat2 = build_final_material(self.name + '_lod', lpa, lpo, self.tinted)
            lob.data.materials.clear()
            lob.data.materials.append(lmat2)
            _only_atlas_uv(lob)
            ltris = tri_count(lob)
            _export(lob, os.path.join(OUT, f'{self.name}_lod.glb'), {os.path.basename(lpa): (lpa, True), os.path.basename(lpo): (lpo, False)})
            log(f'{self.name}_lod: {ltris} tris')
            result['lod_tris'] = ltris
            if not keep:
                bpy.data.objects.remove(lob, do_unlink=True)
        if not keep:
            bpy.data.objects.remove(target, do_unlink=True)
        return result


def _only_atlas_uv(ob):
    me = ob.data
    for l in list(me.uv_layers):
        if l.name != 'atlas':
            me.uv_layers.remove(l)


def import_gltf(path, keep=None):
    """Import a glTF, apply transforms, give every mesh's image nodes an explicit UV Map node on its current UV layer
    (renamed 'src') so the asset's own textures can be baked into our atlas. Returns the mesh objects."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH' and (keep is None or keep(o))]
    for o in new:
        if o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()
    for o in meshes:
        o.modifiers.clear()          # the importer may add a 'Smooth by Angle' node-group modifier
        mw = o.matrix_world.copy()
        o.parent = None
        o.data = o.data.copy()
        o.data.transform(mw)
        o.matrix_world = Matrix.Identity(4)
        if o.data.uv_layers:
            o.data.uv_layers[0].name = 'src'
        for m in o.data.materials:
            if m is None:
                continue
            nt = m.node_tree
            for n in list(nt.nodes):
                if n.type == 'TEX_IMAGE' and not n.inputs['Vector'].is_linked:
                    uvn = nt.nodes.new('ShaderNodeUVMap')
                    uvn.uv_map = 'src'
                    nt.links.new(uvn.outputs['UV'], n.inputs['Vector'])
            bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if bsdf is not None and m.name not in MATINFO:
                mt = bsdf.inputs['Metallic']
                bc = bsdf.inputs['Base Color']
                MATINFO[m.name] = {'metal': mt.links[0].from_socket if mt.is_linked else mt.default_value, 'tint': 0.0,
                                   'uv_weight': 1.0, 'bsdf': bsdf,
                                   'base': bc.links[0].from_socket if bc.is_linked else tuple(bc.default_value)}
    for o in list(bpy.data.objects):
        if o.type == 'EMPTY':
            bpy.data.objects.remove(o, do_unlink=True)
    return meshes


def _drop_empty_slots(ob):
    """Faces on empty material slots (e.g. from boolean cutters) -> first real slot; remove the empty slots."""
    me = ob.data
    real = [i for i, m in enumerate(me.materials) if m is not None]
    if len(real) == len(me.materials) or not real:
        return
    for p in me.polygons:
        if me.materials[p.material_index] is None:
            p.material_index = real[0]
    for i in reversed(range(len(me.materials))):
        if me.materials[i] is None:
            ob.active_material_index = i
            select_only([ob], ob)
            bpy.ops.object.material_slot_remove()


def _final_metal_socket(mat):
    nt = mat.node_tree
    sep = next(n for n in nt.nodes if n.type == 'SEPARATE_COLOR')
    return sep.outputs['Blue']


def _final_tint_socket(mat):
    nt = mat.node_tree
    ta = next(n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image and n.image.colorspace_settings.name == 'sRGB')
    return ta.outputs['Alpha']


def _resize(a, size):
    """Nearest/box resize of a square HxW float array to size x size."""
    h = a.shape[0]
    if h == size:
        return a
    if h > size and h % size == 0:
        f = h // size
        return a.reshape(size, f, size, f).mean(axis=(1, 3))
    idx = (np.arange(size) * h / size).astype(int)
    return a[idx][:, idx]


# ------------------------------------------------------------------------------------------------ export
def _export(ob, path, images):
    """Export ob alone as GLB, then swap its PNG textures for WebP (EXT_texture_webp)."""
    select_only([ob], ob)
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
              export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='AUTO',
              export_cameras=False, export_lights=False, export_extras=False, export_animations=False,
              export_skins=False, export_morph=False)
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color='NONE')
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    webpify(path)


def webpify(path, q_color=88, q_data=92):
    """Rewrite a GLB: PNG/JPEG images -> WebP via cwebp, EXT_texture_webp, keeps alpha (tint mask)."""
    with open(path, 'rb') as fh:
        data = fh.read()
    magic, ver, length = struct.unpack_from('<III', data, 0)
    jlen, jtype = struct.unpack_from('<II', data, 12)
    js = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen, btype = struct.unpack_from('<II', data, off)
    binbuf = data[off + 8: off + 8 + blen]
    views = js['bufferViews']
    # classify images: albedo (used as baseColorTexture) vs data
    color_imgs = set()
    for m in js.get('materials', []):
        t = m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        if t is not None:
            color_imgs.add(js['textures'][t['index']]['source'])
    new_chunks = []   # rebuild the binary buffer
    order = sorted(range(len(views)), key=lambda i: views[i].get('byteOffset', 0))
    img_views = {}
    for ii, im in enumerate(js.get('images', [])):
        if 'bufferView' in im and im.get('mimeType') in ('image/png', 'image/jpeg'):
            img_views[im['bufferView']] = ii
    out = bytearray()
    for vi in range(len(views)):
        v = views[vi]
        raw = binbuf[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]
        if vi in img_views:
            ii = img_views[vi]
            ext = '.png' if js['images'][ii]['mimeType'] == 'image/png' else '.jpg'
            tmp_in = os.path.join(WORK, f'_webp_in_{os.getpid()}{ext}')
            tmp_out = os.path.join(WORK, f'_webp_out_{os.getpid()}.webp')
            with open(tmp_in, 'wb') as fh:
                fh.write(raw)
            is_color = ii in color_imgs
            args = [CWEBP, '-quiet', '-q', str(q_color if is_color else q_data), '-m', '6', '-sharp_yuv' if is_color else '-mt']
            if is_color:
                args += ['-alpha_q', '100', '-exact']
            args += [tmp_in, '-o', tmp_out]
            r = subprocess.run(args, capture_output=True, text=True)
            if r.returncode != 0:
                raise RuntimeError('cwebp failed: ' + r.stderr)
            with open(tmp_out, 'rb') as fh:
                raw = fh.read()
            js['images'][ii]['mimeType'] = 'image/webp'
        while len(out) % 4:
            out.append(0)
        v['byteOffset'] = len(out)
        v['byteLength'] = len(raw)
        out.extend(raw)
    while len(out) % 4:
        out.append(0)
    js['buffers'][0]['byteLength'] = len(out)
    # textures -> EXT_texture_webp
    if any(im.get('mimeType') == 'image/webp' for im in js.get('images', [])):
        for t in js.get('textures', []):
            src = t.pop('source', None)
            if src is not None:
                t.setdefault('extensions', {})['EXT_texture_webp'] = {'source': src}
        used = set(js.get('extensionsUsed', []))
        used.add('EXT_texture_webp')
        js['extensionsUsed'] = sorted(used)
        req = set(js.get('extensionsRequired', []))
        req.add('EXT_texture_webp')
        js['extensionsRequired'] = sorted(req)
    jbytes = json.dumps(js, separators=(',', ':')).encode()
    while len(jbytes) % 4:
        jbytes += b' '
    total = 12 + 8 + len(jbytes) + 8 + len(out)
    with open(path, 'wb') as fh:
        fh.write(struct.pack('<III', 0x46546C67, 2, total))
        fh.write(struct.pack('<II', len(jbytes), 0x4E4F534A))
        fh.write(jbytes)
        fh.write(struct.pack('<II', len(out), 0x004E4942))
        fh.write(bytes(out))


# ------------------------------------------------------------------------------------------------ preview
def preview(glb, png, cam_dir=(1.0, -1.2, 0.55), size=(900, 640), lens=50, extra=None):
    """Render an exported GLB (as three.js would see it: the baked textures) with a sky and a ground plane."""
    reset()
    sc = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=glb)
    obs = [o for o in sc.objects if o.type == 'MESH']
    mn = Vector((1e9,) * 3)
    mx = Vector((-1e9,) * 3)
    for o in obs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector(map(min, mn, w))
            mx = Vector(map(max, mx, w))
    ctr = (mn + mx) / 2
    rad = (mx - mn).length / 2
    w = sc.world
    w.use_nodes = True if hasattr(w, 'use_nodes') else None
    nt = w.node_tree
    bg = nt.nodes.get('Background') or nt.nodes.new('ShaderNodeBackground')
    sky = nt.nodes.new('ShaderNodeTexSky')
    try:
        sky.sky_type = 'NISHITA'
        sky.sun_elevation = math.radians(35)
        sky.sun_rotation = math.radians(210)
    except Exception:
        pass
    nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 0.35
    out = nt.nodes.get('World Output') or nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.2
    sun.angle = math.radians(2)
    so = link(bpy.data.objects.new('sun', sun))
    so.rotation_euler = (math.radians(50), 0, math.radians(35))
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
    gp = bpy.context.active_object
    gm = pbr('ground_prev', '#8c8a84', 0.9, var=0.05)
    gp.data.materials.append(gm)
    cam = bpy.data.cameras.new('cam')
    cam.lens = lens
    co = link(bpy.data.objects.new('cam', cam))
    d = Vector(cam_dir).normalized()
    dist = rad / math.tan(math.atan(18 / lens)) * 1.08
    co.location = ctr + d * dist
    co.rotation_euler = (ctr - co.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = co
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.view_settings.view_transform = 'AgX' if 'AgX' in [v for v in ['AgX']] else 'Filmic'
    sc.render.filepath = png
    bpy.ops.render.render(write_still=True)
