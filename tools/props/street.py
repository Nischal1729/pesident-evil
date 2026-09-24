"""
Street furniture: `bench` (monolithic grey granite block bench of the campus walkways, CAMPUS_NOTES §4), `folding_barricade`
(yellow tubular mobile barricade on castor feet, frames 0022/0024), `metro_barrier` (galvanised frame + green shade net
on precast feet, ORR metro works), `trash_bin` (blue HDPE swing-lid bin), `water_cooler` (stainless drinking-water
cooler with a bilingual sign) and `street_lamp` (charcoal Gamma-shaped LED pole).
Local frame: +X = the prop's left, -Y = front, +Z = up; origin at the base centre.
"""
import math, os
import lib
from lib import V, Mat, Proj
from mathutils import Vector

TEX = os.path.join(lib.PROJECT, 'public', 'textures')


def box_proj_image(name, img_path, scale_m, tint_rgb=(1, 1, 1), rough=0.5, metal=0.0, grime=0.0, grime_z=(0.0, 0.3),
                   grime_col='#6e5f4c', uv_weight=1.0, contrast=1.0, edge_wear=0.0):
    """Material sampling a tiling photo texture with box (triplanar) projection in object space."""
    m, nt = lib.new_material(name)
    if nt is None:
        return m
    nb = lib.NB(nt)
    img = lib.load_image(img_path, 'sRGB')
    tc = nb.objco()
    mp = nb.n('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1 / scale_m, 1 / scale_m, 1 / scale_m)
    nb.set(mp.inputs['Vector'], tc)
    t = nb.n('ShaderNodeTexImage')
    t.image = img
    t.projection = 'BOX'
    t.projection_blend = 0.25
    nb.set(t.inputs['Vector'], mp.outputs['Vector'])
    cur = t.outputs['Color']
    if contrast != 1.0:
        bc = nb.n('ShaderNodeBrightContrast')
        nb.set(bc.inputs['Color'], cur)
        bc.inputs['Contrast'].default_value = contrast - 1.0
        cur = bc.outputs['Color']
    cur = nb.mix(1.0, cur, tint_rgb, 'MULTIPLY')
    r = rough
    if grime > 0:
        z = nb.xyz()[2]
        g = nb.ramp(z, 1.0, 0.0, grime_z[0], grime_z[1])
        g = nb.math('MULTIPLY', g, nb.ramp(nb.noise(6.0, 6.0, 0.7), 0.3, 1.0, 0.3, 0.7))
        g = nb.math('MULTIPLY', g, grime, clamp=True)
        cur = nb.mix(g, cur, lib.col(grime_col))
        r = nb.mixf(g, r, 0.9)
    return lib._finish_mat(m, nt, nb, cur, r, metal, uv_weight=uv_weight)


# ------------------------------------------------------------------------------------------------ bench
def granite_mat(name, rough=0.42, top=False):
    """Procedural speckled grey granite (feldspar / quartz / mica grains), honed; ground dust on the sides."""
    m, nt = lib.new_material(name)
    if nt is None:
        return m
    nb = lib.NB(nt)
    base = nb.mix(nb.ramp(nb.noise(3.0, 4.0, 0.6), 0.0, 1.0, 0.3, 0.7), lib.col('#7d7e80'), lib.col('#95969a'))
    v1 = nb.n('ShaderNodeTexVoronoi')
    v1.inputs['Scale'].default_value = 140.0
    nb.set(v1.inputs['Vector'], nb.objco())
    dark = nb.math('GREATER_THAN', v1.outputs['Distance'] if 'Distance' in v1.outputs else v1.outputs[0], 0.36)
    base = nb.mix(nb.math('MULTIPLY', dark, 0.85), base, lib.col('#2e2f31'))
    n2 = nb.noise(260.0, 2.0, 0.5)
    light = nb.math('GREATER_THAN', n2, 0.68)
    base = nb.mix(nb.math('MULTIPLY', light, 0.8), base, lib.col('#d4d4d2'))
    n3 = nb.noise(520.0, 1.0, 0.5)
    base = nb.mix(nb.math('MULTIPLY', nb.math('GREATER_THAN', n3, 0.72), 0.7), base, lib.col('#1b1b1c'))
    r = rough
    if not top:
        z = nb.xyz()[2]
        g = nb.math('MULTIPLY', nb.ramp(z, 1.0, 0.0, 0.0, 0.2), nb.ramp(nb.noise(6.0, 6.0, 0.7), 0.3, 1.0, 0.3, 0.7))
        g = nb.math('MULTIPLY', g, 0.6)
        base = nb.mix(g, base, lib.col('#6e5f4c'))
        r = nb.mixf(g, rough, 0.9)
    return lib._finish_mat(m, nt, nb, base, r, 0.0)


def bench():
    # 2.0 x 0.5 x 0.45 m honed granite block, small chamfers, slightly polished top from use
    granite = granite_mat('granite_block', 0.45)
    top = granite_mat('granite_top', 0.28, top=True)
    blk = lib.box('bench_block', (2.0, 0.50, 0.45), loc=(0, 0, 0.225), mat=granite, bev=0.012, seg=2, smooth_angle=30)
    lib.assign_faces(blk, top, lambda c, n: n.z > 0.9)
    bk = lib.Baker('bench', tex=512, orm=256, ao_dist=0.25)
    bk.add(blk)
    return bk.finish()


# ------------------------------------------------------------------------------------------------ barricade
def barricade_parts(lod=False):
    yel = lib.pbr('barr_yellow', '#e9b714', 0.45, 0.2, scratch=1.0, grime=0.55, grime_z=(0.0, 0.35), grime_col='#6b4a2a',
                  var=0.08) if not lod else lib.pbr('barr_lod', '#808080')
    blk = lib.pbr('barr_black', '#151515', 0.6, var=0.05) if not lod else yel
    refl = lib.pbr('barr_sign', '#f4f4f0', 0.3, stripes=((0, 2), 0.14, 0.5, '#c8141c')) if not lod else yel
    P = []
    seg = 8 if not lod else 4
    W, H = 1.9, 1.05
    hw = W / 2
    frame = [V(0, -hw, 0.16), V(0, -hw, H), V(0, hw, H), V(0, hw, 0.16)]
    P.append(lib.tube('barr_frame', lib.fillet(frame, 0.08, 3), 0.021, seg, yel))
    P.append(lib.tube('barr_rail', [V(0, -hw, 0.30), V(0, hw, 0.30)], 0.017, seg, yel))
    P.append(lib.tube('barr_rail2', [V(0, -hw, 0.70), V(0, hw, 0.70)], 0.014, seg, yel))
    n = 15 if not lod else 7
    for i in range(1, n):
        s = -hw + W * i / n
        P.append(lib.tube('barr_bar', [V(0, s, 0.30), V(0, s, H - 0.03)], 0.008 if not lod else 0.012, 6 if not lod else 3, yel))
    for sg in (-1, 1):      # splayed feet with castors
        P.append(lib.tube('barr_foot', [V(-0.26, sg * (hw - 0.02), 0.07), V(0.26, sg * (hw - 0.02), 0.07)], 0.019, seg, yel))
        P.append(lib.tube('barr_leg', [V(0, sg * hw, 0.16), V(0, sg * (hw - 0.02), 0.07)], 0.02, seg, yel))
        if not lod:
            for uu in (-0.24, 0.24):
                P.append(lib.cyl('barr_castor', 0.035, 0.025, loc=V(uu, sg * (hw - 0.02), 0.035), mat=blk, axis='X', segs=10))
                P.append(lib.box('barr_fork', (0.03, 0.04, 0.03), loc=V(uu, sg * (hw - 0.02), 0.055), mat=blk))
    if not lod:
        P.append(lib.box('barr_plate', (0.62, 0.012, 0.16), loc=V(0.012, 0, 0.86), mat=refl))
    return P


def folding_barricade():
    bk = lib.Baker('folding_barricade', tex=512, orm=256, ao_dist=0.25, lod_tex=128)
    bk.add(*barricade_parts())
    return bk.finish(lod=lambda: barricade_parts(lod=True))


# ------------------------------------------------------------------------------------------------ metro barrier
def metro_barrier():
    galv = lib.pbr('mb_galv', '#a8adb0', 0.45, 0.85, var=0.12, var_scale=12, scratch=0.6, grime=0.5, grime_z=(0.0, 0.5), grime_col='#5e5140')
    net_m, nt = lib.new_material('mb_net')
    nb = lib.NB(nt)
    # woven green shade net: fine checker of two greens + holes darker, faded top-to-bottom, dust at the base
    x, y, z = nb.xyz()
    wx = nb.math('FRACT', nb.math('DIVIDE', nb.math('ADD', x, y), 0.008))
    wz = nb.math('FRACT', nb.math('DIVIDE', z, 0.008))
    weave = nb.math('MULTIPLY', nb.math('GREATER_THAN', wx, 0.5), nb.math('GREATER_THAN', wz, 0.5))
    base = nb.mix(weave, lib.col('#1f5a2a'), lib.col('#2b6e35'))
    holes = nb.math('MULTIPLY', nb.math('LESS_THAN', wx, 0.18), nb.math('LESS_THAN', wz, 0.18))
    base = nb.mix(holes, base, lib.col('#0c1a0f'))
    fade = nb.ramp(z, 0.0, 0.25, 0.4, 2.0)
    base = nb.mix(fade, base, lib.col('#6d8f6a'))
    dust = nb.math('MULTIPLY', nb.ramp(z, 1.0, 0.0, 0.2, 0.9), nb.ramp(nb.noise(5.0, 5.0, 0.7), 0.2, 1.0, 0.3, 0.7))
    base = nb.mix(nb.math('MULTIPLY', dust, 0.6), base, lib.col('#7a6a55'))
    lib._finish_mat(net_m, nt, nb, base, 0.85, 0.0, uv_weight=0.8)
    # sagging folds between the ties (vertical shading bands) on top of the weave
    fold = nb.math('SINE', nb.math('MULTIPLY', x, 9.0))
    lib.MATINFO['mb_net']['base'] = nb.mix(nb.math('MULTIPLY', nb.math('ADD', fold, 1.0), 0.12), lib.MATINFO['mb_net']['base'], lib.col('#0d2412'))
    lib.MATINFO['mb_net']['bsdf'].inputs['Base Color'].default_value = (0, 0, 0, 1)
    nt.links.new(lib.MATINFO['mb_net']['base'], lib.MATINFO['mb_net']['bsdf'].inputs['Base Color'])
    # printed hoarding band across the net (front only), bilingual "metro work in progress"
    proj = Proj(-0.3, 0.3, -1.32, 1.32, 0.0, 2.05)
    fc = proj.canvas('F', 260, bg=Mat('#1f5a2a', 0.85))
    fc.rect(-1.28, 1.20, 1.28, 1.62, Mat('#f1f1ec', 0.6))
    fc.rect(-1.28, 1.20, 1.28, 1.26, Mat('#1e7a3c', 0.6))
    fc.stext(0.0, 1.49, 'ಮೆಟ್ರೋ ಕಾಮಗಾರಿ ಪ್ರಗತಿಯಲ್ಲಿದೆ', 0.13, Mat('#1b3f8f', 0.6))
    fc.text(0.0, 1.33, 'METRO WORK IN PROGRESS', 0.07, Mat('#1b3f8f', 0.6), font='arialblack')
    banner = lib.proj_material('mb_banner', proj, {'F': fc.save('mb_banner_F', noise=0.02)}, sharp=2.0, grime=0.3, grime_z=(1.0, 1.7))
    stripe = lib.pbr('mb_hazard', '#f2f2ee', 0.45, stripes=((0, 2), 0.25, 0.5, '#c4161c'), grime=0.4, grime_z=(0.0, 0.4))
    conc = lib.pbr('mb_concrete', '#9a978f', 0.9, var=0.15, var_scale=8, grime=0.6, grime_z=(0.0, 0.3), grime_col='#6a5a45')
    P = []
    W, H = 2.60, 2.0
    hw = W / 2
    for sg in (-1, 1):
        P.append(lib.box('mb_post', (0.05, 0.05, H), loc=V(0, sg * hw, H / 2), mat=galv, bev=0.004))
        P.append(lib.box('mb_foot', (0.34, 0.30, 0.14), loc=V(-0.02, sg * (hw - 0.02), 0.07), mat=conc, bev=0.02, seg=2))
        P.append(lib.box('mb_brace', (0.03, 0.03, 0.62), loc=V(-0.24, sg * (hw - 0.02), 0.30), mat=galv, rot=(math.radians(-50), 0, 0)))
    for zz in (H - 0.02, 0.28):
        P.append(lib.box('mb_rail', (W, 0.04, 0.04), loc=V(0, 0, zz), mat=galv))
    P.append(lib.box('mb_net', (W - 0.04, 0.012, H - 0.36), loc=V(0, 0, 0.29 + (H - 0.36) / 2), mat=net_m))
    P.append(lib.box('mb_banner', (W - 0.08, 0.004, 0.42), loc=V(0.009, 0, 1.41), mat=banner))
    P.append(lib.box('mb_hazard', (W - 0.04, 0.015, 0.22), loc=V(0.003, 0, 0.15), mat=stripe))
    for sg in (-1, 0, 1):       # cable ties along the top
        P.append(lib.box('mb_tie', (0.01, 0.03, 0.05), loc=V(0.01, sg * 0.7, H - 0.05), mat=conc))
    bk = lib.Baker('metro_barrier', tex=512, orm=256, ao_dist=0.3)
    bk.add(*P)
    return bk.finish()


# ------------------------------------------------------------------------------------------------ trash bin
def trash_bin():
    blue = lib.pbr('bin_blue', '#1d55a8', 0.45, var=0.09, var_scale=18, grime=0.55, grime_z=(0.0, 0.35), grime_col='#4d4539')
    dark = lib.pbr('bin_dark', '#15181c', 0.6, var=0.05)
    white = lib.pbr('bin_label', '#f1f1ec', 0.4)
    P = []
    secs = []
    for zz, w in ((0.0, 0.36), (0.03, 0.38), (0.70, 0.43), (0.74, 0.445)):
        ring = []
        for k in range(16):
            t = 2 * math.pi * k / 16
            c, s = math.cos(t), math.sin(t)
            e = 4.0
            ring.append(Vector((w / 2 * math.copysign(abs(c) ** (2 / e), c), w / 2 * 0.95 * math.copysign(abs(s) ** (2 / e), s), zz)))
        secs.append(ring)
    P.append(lib.loft('bin_body', secs, blue, cap0=True, cap1=True, smooth_angle=50))
    # dome lid with swing flap
    lid = []
    for zz, w in ((0.74, 0.455), (0.80, 0.45), (0.88, 0.40), (0.93, 0.30), (0.95, 0.16)):
        ring = []
        for k in range(16):
            t = 2 * math.pi * k / 16
            c, s = math.cos(t), math.sin(t)
            ring.append(Vector((w / 2 * math.copysign(abs(c) ** 0.6, c), w / 2 * 0.95 * math.copysign(abs(s) ** 0.6, s), zz)))
        lid.append(ring)
    P.append(lib.loft('bin_lid', lid, blue, cap0=True, cap1=True, smooth_angle=50))
    P.append(lib.box('bin_flap', (0.26, 0.012, 0.13), loc=V(0.215, 0, 0.84), mat=dark, rot=(math.radians(-22), 0, 0)))
    P.append(lib.box('bin_label', (0.16, 0.004, 0.10), loc=V(0.206, 0, 0.45), mat=white, rot=(math.radians(-3.5), 0, 0)))
    for sg in (-1, 1):
        P.append(lib.box('bin_handle', (0.02, 0.10, 0.03), loc=V(0, sg * 0.225, 0.66), mat=blue))
    bk = lib.Baker('trash_bin', tex=512, orm=256, ao_dist=0.2)
    bk.add(*P)
    return bk.finish()


# ------------------------------------------------------------------------------------------------ water cooler
def water_cooler():
    m, nt = lib.new_material('wc_steel')
    nb = lib.NB(nt)
    x, y, z = nb.xyz()
    sv = nb.n('ShaderNodeCombineXYZ')
    nb.set(sv.inputs[0], nb.math('MULTIPLY', x, 3.0))
    nb.set(sv.inputs[1], nb.math('MULTIPLY', y, 3.0))
    nb.set(sv.inputs[2], nb.math('MULTIPLY', z, 260.0))       # vertical brush streaks
    streak = nb.noise(1.0, 3.0, 0.5, vec=sv.outputs[0])
    base = nb.mix(nb.ramp(streak, 0.0, 1.0, 0.35, 0.65), lib.col('#a3a8ac'), lib.col('#cfd3d6'))
    rough = nb.ramp(streak, 0.32, 0.48, 0.3, 0.7)
    g = nb.math('MULTIPLY', nb.ramp(z, 1.0, 0.0, 0.0, 0.3), nb.ramp(nb.noise(6.0, 5.0, 0.7), 0.2, 1.0, 0.3, 0.7))
    base = nb.mix(nb.math('MULTIPLY', g, 0.55), base, lib.col('#6a5d4b'))
    lib._finish_mat(m, nt, nb, base, rough, 0.55)
    proj = Proj(-0.40, 0.40, -0.36, 0.36, 0.0, 1.42)
    f = proj.canvas('F', 500, bg=Mat('#b2b6ba', 0.33, 0.95))
    f.rect(-0.22, 1.12, 0.22, 1.30, Mat('#1f4f9c', 0.35, 0.0), r=0.01)
    f.text(0.0, 1.245, 'DRINKING WATER', 0.028, Mat('#f4f4f0', 0.35, 0.0), font='arialblack')
    f.stext(0.0, 1.165, 'ಕುಡಿಯುವ ನೀರು', 0.05, Mat('#f4f4f0', 0.35, 0.0))
    for k in range(9):              # louvres at the bottom front
        zz = 0.10 + k * 0.035
        f.rect(-0.26, zz, 0.26, zz + 0.012, Mat('#2a2c2e', 0.5, 0.6))
    f.rect(-0.25, 0.58, 0.25, 0.60, Mat('#1a1b1c', 0.5, 0.5))
    for k in range(14):             # drip tray grille
        s0 = -0.24 + k * 0.035
        f.rect(s0, 0.60, s0 + 0.018, 0.64, Mat('#d8dadc', 0.25, 1.0))
    front = lib.proj_material('wc_front', proj, {'F': f.save('wc_F', noise=0.01)}, sharp=3.0)
    dark = lib.pbr('wc_dark', '#1b1c1d', 0.5, 0.4)
    chrome = lib.pbr('wc_chrome', '#dadcde', 0.12, 1.0, var=0.02)
    P = []
    body = lib.box('wc_body', (0.66, 0.60, 1.34), loc=(0, 0, 0.69), mat=m, bev=0.012, seg=2, smooth_angle=30)
    lib.assign_faces(body, front, lambda c, n: n.y < -0.9)
    P.append(body)
    P.append(lib.box('wc_top', (0.68, 0.62, 0.04), loc=(0, 0, 1.38), mat=m, bev=0.01))
    P.append(lib.box('wc_recess', (0.56, 0.06, 0.40), loc=(0, -0.29, 0.80), mat=dark))
    for k in (-1, 0, 1):
        P.append(lib.cyl('wc_tap', 0.018, 0.08, loc=(k * 0.15, -0.34, 0.98), mat=chrome, axis='Y', segs=10))
        P.append(lib.box('wc_button', (0.05, 0.03, 0.04), loc=(k * 0.15, -0.33, 1.03), mat=chrome, bev=0.008))
    P.append(lib.box('wc_tray', (0.54, 0.10, 0.03), loc=(0, -0.33, 0.62), mat=chrome, bev=0.005))
    for sg in (-1, 1):
        P.append(lib.box('wc_foot', (0.06, 0.06, 0.03), loc=(sg * 0.28, 0.0, 0.015), mat=dark))
    bk = lib.Baker('water_cooler', tex=512, orm=256, ao_dist=0.3)
    bk.add(*P)
    return bk.finish()


# ------------------------------------------------------------------------------------------------ street lamp
def street_lamp():
    paint = lib.pbr('lamp_paint', '#33373c', 0.45, 0.55, var=0.06, scratch=0.4, grime=0.5, grime_z=(0.0, 0.6))
    lens = lib.pbr('lamp_lens', '#e8ecef', 0.1, 0.0, emit='#fff4dc', emit_strength=0.0)
    P = []
    P.append(lib.cyl('lamp_base', 0.13, 0.35, loc=(0, 0, 0.175), mat=paint, segs=12, r2=0.10))
    P.append(lib.cyl('lamp_pole', 0.085, 5.9, loc=(0, 0, 3.2), mat=paint, segs=12, r2=0.055))
    P.append(lib.tube('lamp_arm', lib.fillet([Vector((0, 0.0, 6.0)), Vector((0, 0.0, 6.15)), Vector((0, -1.25, 6.15))], 0.12, 4), 0.045, 10, paint))
    P.append(lib.box('lamp_head', (0.28, 0.62, 0.09), loc=(0, -1.30, 6.12), mat=paint, bev=0.02, seg=2))
    P.append(lib.box('lamp_led', (0.22, 0.52, 0.01), loc=(0, -1.30, 6.07), mat=lens))
    P.append(lib.box('lamp_door', (0.10, 0.02, 0.28), loc=(0, -0.11, 0.65), mat=paint, bev=0.005))
    bk = lib.Baker('street_lamp', tex=256, orm=128, ao_dist=0.3)
    bk.add(*P)
    return bk.finish()


PROPS = {'bench': bench, 'folding_barricade': folding_barricade, 'metro_barrier': metro_barrier, 'trash_bin': trash_bin,
         'water_cooler': water_cooler, 'street_lamp': street_lamp}
