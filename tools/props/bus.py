"""
Buses: `college_bus` (the yellow PES University college bus: Ashok Leyland Sunshine-style school-bus body, yellow
#F2C200 with a green #1E8C3A stripe under the windows, window grilles, "PES UNIVERSITY" board and "COLLEGE BUS" on
the front, KA 51 plates -- reference/CAMPUS_NOTES.md §5, frames 0530, 0532, 1902) and `bmtc_bus` (a BMTC city bus on
the Outer Ring Road: white over blue, two doors, route board).

10.6 x 2.5 x 3.15 m, wheelbase 5.4 m, 8.25-20 tyres (rear duals). The body is one rounded-box loft with boolean wheel
arches; windows, doors, lamps and livery are elevation drawings projected on it and baked into a 2K atlas.
Vehicle frame (u forward, s left, z up); India drives on the left, so doors are on the left (+s) side.
"""
import math
import bpy
import lib
from lib import V, Mat, Proj
from two_wheelers import plate_mat

L2 = 5.30          # half length
W = 2.50
ZB, ZT = 0.45, 3.15
FA, RA = 3.30, -2.10   # axles
RT = 0.49              # tyre radius
BELT = 1.50            # window band bottom


def ring(u, w, zb, zt, rt, rb=0.05, nt=5, nb=2, belt=BELT, tumble=0.035):
    hw = w / 2
    pts = []

    def arc(cs, cz, r, a0, a1, n):
        for k in range(n + 1):
            a = math.radians(a0 + (a1 - a0) * k / n)
            pts.append((cs + r * math.cos(a), cz + r * math.sin(a)))
    arc(hw - rb, zb + rb, rb, -90, 0, nb)                  # bottom-left corner (s > 0)
    pts.append((hw, min(max(belt, zb + rb + 0.01), zt - rt - 0.01)))
    arc(hw - rt, zt - rt, rt, 0, 90, nt)                   # top-left
    arc(-hw + rt, zt - rt, rt, 90, 180, nt)                # top-right
    pts.append((-hw, min(max(belt, zb + rb + 0.01), zt - rt - 0.01)))
    arc(-hw + rb, zb + rb, rb, 180, 270, nb)               # bottom-right
    out = []
    for s, z in pts:
        if z > belt:
            s *= 1.0 - tumble * (z - belt) / max(0.01, zt - belt)
        out.append(V(u, s, z))
    return out


def body_mesh(mat, lod=False):
    front = [(L2, 2.26, 0.62, 2.74, 0.20), (L2 - 0.015, 2.42, 0.50, 2.97, 0.26), (L2 - 0.05, 2.48, 0.46, 3.075, 0.29),
             (L2 - 0.12, W, ZB, 3.135, 0.30), (L2 - 0.26, W, ZB, ZT, 0.30)]
    rear = [(-L2 + 0.26, W, ZB, ZT, 0.30), (-L2 + 0.12, W, ZB, 3.135, 0.30), (-L2 + 0.05, 2.48, 0.46, 3.08, 0.29),
            (-L2 + 0.015, 2.42, 0.50, 3.0, 0.26), (-L2, 2.28, 0.60, 2.80, 0.20)]
    mid = [(u, W, ZB, ZT, 0.30) for u in (3.9, 2.6, 1.0, -1.4, -2.8, -4.2)]
    st = list(reversed(front)) + mid + list(reversed(rear))
    st.sort(key=lambda t: -t[0])
    if lod:
        st = [st[0], st[2], st[4], st[-5], st[-3], st[-1]]
    nt, nb = (5, 2) if not lod else (2, 1)
    secs = [ring(u, w, zb, zt, rt, nt=nt, nb=nb) for u, w, zb, zt, rt in st]
    ob = lib.loft('bus_body', secs, mat, cap0=True, cap1=True, smooth_angle=38)
    # windscreen rake: shear the nose back with height
    for v in ob.data.vertices:
        u = -v.co.y
        if u > L2 - 0.4:
            f = min(1.0, max(0.0, (v.co.z - 0.7) / 2.2))
            v.co.y += 0.09 * f * min(1.0, (u - (L2 - 0.4)) / 0.4)
    ob.data.update()
    # wheel arches
    for uc, r in ((FA, 0.585), (RA, 0.60)):
        cut = lib.cyl('arch_cut', r, 3.2, loc=V(uc, 0, RT), mat=mat, axis='X', segs=28 if not lod else 12)
        md = ob.modifiers.new('arch', 'BOOLEAN')
        md.operation = 'DIFFERENCE'
        md.object = cut
        md.solver = 'EXACT'
        lib.apply_mods(ob)
        bpy.data.objects.remove(cut, do_unlink=True)
    lib.clean(ob)
    lib.delete_faces(ob, lambda c, n: n.z < -0.95 and c.z < ZB + 0.02)     # underside is never seen
    lib.smooth(ob, 38)
    return ob


def arch_liner(uc, r, mat, segs=14):
    """Closed rectangular-section band around the upper wheel (dark wheel well seen through the arch)."""
    hw = W / 2 - 0.01
    prof = [(r - 0.02, -hw), (r, -hw), (r, hw), (r - 0.02, hw), (r - 0.02, -hw)]
    ob = lib.lathe('arch', prof, segs, mat, axis='Z', cap=False, arc=(math.radians(270 - 175), math.radians(270 - 5)), smooth_angle=50)
    ob.data.transform(lib.Matrix.Rotation(math.pi / 2, 4, 'Y'))
    lib.xform(ob, loc=V(uc, 0, RT))
    return ob


# ------------------------------------------------------------------------------------------------ livery drawings
C = {
    'yellow': '#f2c200', 'green': '#1e8c3a', 'navy': '#1a2a6c', 'glass': '#182026', 'black': '#0f1011',
    'alu': '#b9bdc0', 'white': '#f1f1ee', 'orange': '#f07a1a', 'red': '#b3141a', 'amber': '#e8961e', 'seat': '#2c3446',
    'blue': '#1d4f9e', 'cream': '#eeeae0',
}


def M(key, rough=0.35, metal=0.0, tint=0.0):
    return Mat(C.get(key, key), rough, metal, tint)


def window_row(c, u0, u1, z0, z1, n, bars=True, seats=True, frame='black', split=True):
    pitch = (u1 - u0) / n
    for i in range(n):
        a, b = u0 + i * pitch + 0.045, u0 + (i + 1) * pitch - 0.045
        c.rect(a, z0, b, z1, M('glass', 0.05), r=0.05)
        if seats:
            for k in range(2):
                sa = a + (b - a) * (0.08 + 0.5 * k)
                c.rect(sa, z0, sa + (b - a) * 0.36, z0 + (z1 - z0) * 0.28, M('seat', 0.06), r=0.04)
        if split:
            c.line((a + b) / 2, z0, (a + b) / 2, z1, M('alu', 0.3, 0.9), 0.022)
        c.line(a, z1 - 0.12, b, z1 - 0.12, M('alu', 0.3, 0.9), 0.018)     # sliding window top rail
        if bars:
            for zz in (z0 + 0.13, z0 + 0.27, z0 + 0.41):
                c.line(a, zz, b, zz, M('#c4c8ca', 0.28, 1.0), 0.02)


def rim_drawing(c, uc, zc=RT, r=0.27, dual=False):
    c.ellipse(uc, zc, r, r, M('#a9adb0', 0.4, 0.7))
    c.ellipse(uc, zc, r * 0.82, r * 0.82, M('#8d9195', 0.45, 0.6))
    for k in range(8 if not dual else 10):
        a = 2 * math.pi * k / (8 if not dual else 10)
        c.ellipse(uc + math.cos(a) * r * 0.58, zc + math.sin(a) * r * 0.58, r * 0.10, r * 0.13, M('#151617', 0.7))
    c.ellipse(uc, zc, r * 0.38, r * 0.38, M('#6c7074', 0.4, 0.8))
    for k in range(10):
        a = 2 * math.pi * k / 10
        c.ellipse(uc + math.cos(a) * r * 0.30, zc + math.sin(a) * r * 0.30, 0.012, 0.012, M('#d0d2d4', 0.3, 1.0))
    c.ellipse(uc, zc, r * 0.16, r * 0.16, M('#3a3c3e', 0.4, 0.8))


def arch_trim(c, uc, r):
    pts = [(uc + math.cos(math.radians(a)) * r, RT + math.sin(math.radians(a)) * r) for a in range(0, 181, 10)]
    c.polyline(pts, M('black', 0.6), 0.05)


def pes_logo(c, u, z, r):
    c.ellipse(u, z, r, r, M('orange', 0.35))
    c.ellipse(u, z, r * 0.72, r * 0.72, M('white', 0.35))
    c.ellipse(u, z, r * 0.55, r * 0.55, M('orange', 0.35))
    for k in range(8):
        a = 2 * math.pi * k / 8
        c.line(u, z, u + math.cos(a) * r * 0.5, z + math.sin(a) * r * 0.5, M('white', 0.35), r * 0.08)


def pes_side(proj, view):
    c = proj.canvas(view, 170, bg=M('yellow', 0.38))
    left = view == 'L'   # kerb / door side
    c.rect(-L2, BELT, L2, 2.52, M('black', 0.3))                        # window band
    c.rect(-L2, 2.55, L2, 2.585, M('alu', 0.3, 0.9))                   # rain gutter
    c.rect(-L2, 1.455, L2, 1.478, M('alu', 0.3, 0.9))                  # waist rail
    c.rect(-L2, 1.30, L2, 1.44, M('green', 0.38))                      # green stripe
    c.rect(-L2, 1.215, L2, 1.24, M('green', 0.38))
    c.rect(-L2, 0.60, L2, 0.625, M('alu', 0.3, 0.9))                   # skirt rail
    for u in (-3.9, -2.6, -1.0, 0.4, 1.7, 4.1):                        # panel joints
        c.line(u, 0.46, u, 1.29, M('#8a7200', 0.5), 0.006)
    if left:
        window_row(c, -5.05, 1.60, 1.56, 2.46, 6)
        # front door: two leaf glass door + step, behind the front axle
        c.rect(1.70, 0.46, 2.66, 2.50, M('black', 0.35))
        for a, b in ((1.74, 2.17), (2.19, 2.62)):
            c.rect(a, 1.20, b, 2.44, M('glass', 0.05), r=0.03)
            c.rect(a, 0.62, b, 1.12, M('yellow', 0.38), r=0.02)
            c.line(a + 0.04, 1.6, b - 0.04, 1.6, M('alu', 0.3, 0.9), 0.02)
        c.rect(1.70, 0.46, 2.66, 0.60, M('#1a1a1a', 0.7))
        window_row(c, 2.75, 4.95, 1.56, 2.46, 2, bars=False, split=True)
        # PES name + logo + Kannada name between the arches, "COLLEGE BUS" + logo behind the rear arch
        c.text(0.1, 1.05, 'PES UNIVERSITY', 0.20, M('navy', 0.35), font='arialblack')
        c.stext(0.1, 0.76, 'ಪಿಇಎಸ್ ವಿಶ್ವವಿದ್ಯಾಲಯ', 0.17, M('navy', 0.35))
        pes_logo(c, -4.75, 0.98, 0.22)
        c.text(-3.75, 0.98, 'COLLEGE BUS', 0.11, M('green', 0.38), font='arialblack')
    else:
        window_row(c, -5.05, 3.70, 1.56, 2.46, 8)
        c.rect(3.82, 1.36, 4.98, 2.46, M('glass', 0.05), r=0.05)       # driver's window (RHD)
        c.line(4.40, 1.36, 4.40, 2.46, M('alu', 0.3, 0.9), 0.025)
        pes_logo(c, 1.95, 1.0, 0.22)
        c.text(0.05, 1.05, 'PES UNIVERSITY', 0.20, M('navy', 0.35), font='arialblack')
        c.stext(0.05, 0.76, 'ಪಿಇಎಸ್ ವಿಶ್ವವಿದ್ಯಾಲಯ', 0.17, M('navy', 0.35))
        c.text(-3.85, 0.98, 'COLLEGE BUS', 0.11, M('green', 0.38), font='arialblack')
        c.text(-4.2, 2.66, 'EMERGENCY EXIT', 0.06, M('red', 0.35), font='arialb')
        c.rect(-3.2, 0.90, -3.05, 1.02, M('#9a9a96', 0.4, 0.5), r=0.02)   # fuel filler
    for u in (-4.6, -2.9, -0.4, 1.3, 4.4):                               # side marker lamps
        c.rect(u - 0.05, 0.50, u + 0.05, 0.56, M('amber', 0.1))
    for uc, r in ((FA, 0.60), (RA, 0.615)):
        arch_trim(c, uc, r + 0.02)
    rim_drawing(c, FA)
    rim_drawing(c, RA, dual=True)
    return c.save(f'pes_{view}', noise=0.012)


def pes_front(proj):
    c = proj.canvas('F', 220, bg=M('yellow', 0.38))
    c.rect(-1.16, 1.40, 1.16, 2.70, M('black', 0.35), r=0.10)           # glazing surround
    for a, b in ((-1.10, -0.035), (0.035, 1.10)):
        c.rect(a, 1.46, b, 2.64, M('glass', 0.04), r=0.06)
    for s0 in (-0.55, 0.45):                                            # parked wipers
        c.line(s0 - 0.35, 1.50, s0 + 0.25, 1.53, M('black', 0.5), 0.02)
    c.rect(-1.02, 2.73, 1.02, 3.00, M('black', 0.35), r=0.04)           # destination board
    c.rect(-0.98, 2.76, 0.98, 2.97, M('white', 0.3))
    pes_logo(c, -0.78, 2.865, 0.085)
    c.text(0.08, 2.87, 'PES UNIVERSITY', 0.10, M('navy', 0.3), font='arialblack')
    c.rect(-0.58, 1.26, 0.58, 1.38, M('black', 0.4), r=0.02)            # grille slot
    for zz in (1.29, 1.32, 1.35):
        c.line(-0.55, zz, 0.55, zz, M('#3a3c3e', 0.4, 0.6), 0.008)
    c.ellipse(0.0, 1.32, 0.05, 0.05, M('alu', 0.2, 1.0))
    c.text(0.0, 1.10, 'COLLEGE BUS', 0.13, M('green', 0.38), font='arialblack')
    for sg in (-1, 1):                                                  # headlamp clusters
        c.rect(sg * 0.72, 0.84, sg * 1.10, 1.04, M('black', 0.3), r=0.04)
        for k in range(2):
            ss = sg * (0.80 + k * 0.13)
            c.ellipse(ss, 0.94, 0.055, 0.055, M('#dfe4e8', 0.05, 0.9))
            c.ellipse(ss, 0.94, 0.03, 0.03, M('#f8f8f4', 0.05, 0.3))
        c.rect(sg * 1.02 - 0.04, 0.86, sg * 1.02 + 0.04, 1.02, M('amber', 0.1))
    c.rect(-1.16, 0.62, 1.16, 0.70, M('#b89500', 0.45))
    return c.save('pes_F', noise=0.012)


def pes_rear(proj):
    c = proj.canvas('B', 220, bg=M('yellow', 0.38))
    c.rect(-1.10, 1.60, 1.10, 2.66, M('black', 0.35), r=0.08)
    c.rect(-1.05, 1.64, 1.05, 2.62, M('glass', 0.04), r=0.06)
    c.rect(-0.62, 2.44, 0.62, 2.58, M('#050505', 0.2))                  # LED board in the rear window
    c.text(0.0, 2.51, 'PES UNIVERSITY', 0.075, Mat('#ff9a2e', 0.2, 0.0), font='arialb')
    c.rect(-1.25, 1.30, 1.25, 1.44, M('green', 0.38))
    c.rect(-1.25, 1.215, 1.25, 1.24, M('green', 0.38))
    for sg in (-1, 1):
        c.rect(sg * 0.93, 0.70, sg * 1.13, 1.26, M('black', 0.3), r=0.03)
        c.rect(sg * 0.95, 1.07, sg * 1.11, 1.23, M('red', 0.08))
        c.rect(sg * 0.95, 0.90, sg * 1.11, 1.05, M('amber', 0.08))
        c.rect(sg * 0.95, 0.73, sg * 1.11, 0.88, M('#e8e8e4', 0.06, 0.3))
    c.text(0.75, 1.55, 'STOP', 0.07, M('red', 0.35), font='arialblack')
    c.text(0.0, 0.92, 'SOUND  HORN', 0.07, M('black', 0.4), font='arialblack')
    c.text(0.0, 1.13, 'COLLEGE BUS', 0.09, M('green', 0.38), font='arialblack')
    c.rect(-1.25, 0.60, 1.25, 0.625, M('alu', 0.3, 0.9))
    return c.save('pes_B', noise=0.012)


def roof(proj, base):
    c = proj.canvas('T', 60, bg=M(base, 0.45))
    for u in (1.4, -2.4):
        c.rect(-0.35, u - 0.35, 0.35, u + 0.35, M('#8e9092', 0.5, 0.3), r=0.05)
        c.rect(-0.30, u - 0.30, 0.30, u + 0.30, M('#b8bbbd', 0.4, 0.3), r=0.04)
    return c.save(f'roof_{base}', noise=0.02)


def bmtc_side(proj, view):
    c = proj.canvas(view, 170, bg=M('cream', 0.35))
    left = view == 'L'
    c.rect(-L2, 0.45, L2, 1.40, M('blue', 0.35))                       # blue lower body
    c.rect(-L2, 1.40, L2, 1.43, M('white', 0.35))
    c.rect(-L2, 1.43, L2, 1.47, M('#c21f2a', 0.35))                    # red pinstripe
    c.rect(-L2, BELT, L2, 2.50, M('black', 0.3))
    c.rect(-L2, 2.55, L2, 2.58, M('alu', 0.3, 0.9))
    c.rect(-L2, 0.60, L2, 0.62, M('alu', 0.3, 0.9))
    if left:
        window_row(c, -5.05, -0.60, 1.55, 2.46, 4, bars=False, seats=True)
        c.rect(-0.55, 0.46, 0.45, 2.50, M('black', 0.35))              # middle door
        for a, b in ((-0.51, -0.06), (-0.04, 0.41)):
            c.rect(a, 0.62, b, 2.44, M('glass', 0.05), r=0.03)
        window_row(c, 0.55, 3.85, 1.55, 2.46, 3, bars=False, seats=True)
        c.rect(3.95, 0.46, 4.90, 2.50, M('black', 0.35))               # front door
        for a, b in ((3.99, 4.43), (4.45, 4.86)):
            c.rect(a, 0.62, b, 2.44, M('glass', 0.05), r=0.03)
        c.stext(-2.6, 0.98, 'ಬೆಂಗಳೂರು ಮಹಾನಗರ ಸಾರಿಗೆ ಸಂಸ್ಥೆ', 0.16, M('white', 0.35))
        c.text(-2.6, 0.72, 'BMTC', 0.14, M('white', 0.35), font='arialblack')
        c.rect(1.1, 1.95, 2.1, 2.25, M('#060606', 0.2))                # side route LED
        c.text(1.6, 2.10, '500D', 0.16, Mat('#ffa12e', 0.2), font='arialb')
    else:
        window_row(c, -5.05, 3.70, 1.55, 2.46, 7, bars=False, seats=True)
        c.rect(3.82, 1.36, 4.98, 2.46, M('glass', 0.05), r=0.05)
        c.stext(0.4, 0.98, 'ಬೆಂಗಳೂರು ಮಹಾನಗರ ಸಾರಿಗೆ ಸಂಸ್ಥೆ', 0.16, M('white', 0.35))
        c.text(0.4, 0.72, 'BMTC', 0.14, M('white', 0.35), font='arialblack')
    for uc, r in ((FA, 0.60), (RA, 0.615)):
        arch_trim(c, uc, r + 0.02)
    rim_drawing(c, FA)
    rim_drawing(c, RA, dual=True)
    return c.save(f'bmtc_{view}', noise=0.012)


def bmtc_front(proj):
    c = proj.canvas('F', 220, bg=M('cream', 0.35))
    c.rect(-1.25, 0.45, 1.25, 1.40, M('blue', 0.35))
    c.rect(-1.16, 1.40, 1.16, 2.70, M('black', 0.35), r=0.10)
    c.rect(-1.10, 1.46, 1.10, 2.64, M('glass', 0.04), r=0.06)
    c.line(-0.9, 1.50, -0.2, 1.53, M('black', 0.5), 0.02)
    c.line(0.1, 1.50, 0.8, 1.53, M('black', 0.5), 0.02)
    c.rect(-1.02, 2.73, 1.02, 3.00, M('#050505', 0.2), r=0.03)          # LED route board
    c.text(-0.72, 2.865, '500D', 0.15, Mat('#ffa12e', 0.2), font='arialb')
    c.stext(0.30, 2.865, 'ಹೆಬ್ಬಾಳ', 0.17, Mat('#ffa12e', 0.2))
    for sg in (-1, 1):
        c.rect(sg * 0.72, 0.84, sg * 1.10, 1.04, M('black', 0.3), r=0.04)
        for k in range(2):
            ss = sg * (0.80 + k * 0.13)
            c.ellipse(ss, 0.94, 0.055, 0.055, M('#dfe4e8', 0.05, 0.9))
        c.rect(sg * 1.02 - 0.04, 0.86, sg * 1.02 + 0.04, 1.02, M('amber', 0.1))
    c.text(0.0, 1.18, 'BMTC', 0.12, M('white', 0.35), font='arialblack')
    return c.save('bmtc_F', noise=0.012)


def bmtc_rear(proj):
    c = proj.canvas('B', 220, bg=M('cream', 0.35))
    c.rect(-1.25, 0.45, 1.25, 1.40, M('blue', 0.35))
    c.rect(-1.05, 1.64, 1.05, 2.62, M('glass', 0.04), r=0.06)
    c.rect(-0.55, 2.40, 0.55, 2.58, M('#050505', 0.2))
    c.text(0.0, 2.49, '500D', 0.12, Mat('#ffa12e', 0.2), font='arialb')
    for sg in (-1, 1):
        c.rect(sg * 0.93, 0.70, sg * 1.13, 1.26, M('black', 0.3), r=0.03)
        c.rect(sg * 0.95, 1.07, sg * 1.11, 1.23, M('red', 0.08))
        c.rect(sg * 0.95, 0.90, sg * 1.11, 1.05, M('amber', 0.08))
    c.text(0.0, 1.10, 'BMTC', 0.10, M('white', 0.35), font='arialblack')
    return c.save('bmtc_B', noise=0.012)


# ------------------------------------------------------------------------------------------------ build
def build_bus(livery, lod=False):
    parts = []
    if not lod:
        proj = Proj(-L2 - 0.05, L2 + 0.05, -W / 2, W / 2, 0.0, ZT + 0.02)
        if livery == 'pes':
            views = {'L': pes_side(proj, 'L'), 'R': pes_side(proj, 'R'), 'F': pes_front(proj), 'B': pes_rear(proj), 'T': roof(proj, 'yellow')}
        else:
            views = {'L': bmtc_side(proj, 'L'), 'R': bmtc_side(proj, 'R'), 'F': bmtc_front(proj), 'B': bmtc_rear(proj), 'T': roof(proj, 'cream')}
        paint = lib.proj_material(f'{livery}_body', proj, views, sharp=7.0, grime=0.5, grime_z=(0.35, 1.1), grime_col='#7b6a52')
        rim = lib.proj_material(f'{livery}_rim', proj, {'L': views['L'], 'R': views['R']}, sharp=6.0, grime=0.4, grime_z=(0.0, 0.8))
        black = lib.pbr('bus_black', '#141516', 0.55, var=0.05, grime=0.4, grime_z=(0.2, 0.7))
        chassis = lib.pbr('bus_chassis', '#222324', 0.7, 0.2, var=0.08, grime=0.6, grime_z=(0.0, 0.5), grime_col='#5a4d3c')
        tyre = lib.pbr('bus_tyre', '#1a1a1b', 0.9, var=0.05, grime=0.6, grime_z=(0.0, 0.5), grime_col='#7a6a55', uv_weight=0.45)
        mirror_m = lib.pbr('bus_mirror', '#b9c0c6', 0.05, 1.0, var=0.0)
    else:
        paint = rim = black = chassis = tyre = mirror_m = lib.pbr('bus_lod', '#808080')
    parts.append(body_mesh(paint, lod))
    segs = 24 if not lod else 10
    for uc, duals in ((FA, (1.09,)), (RA, (1.08, 0.82))):
        for sg in (-1, 1):
            for i, so in enumerate(duals):
                s = sg * so
                if lod:
                    parts.append(lib.cyl('bus_tyre', RT, 0.25, loc=V(uc, s, RT), mat=tyre, axis='X', segs=segs))
                    continue
                parts.append(lib.tyre('bus_tyre', RT, 0.25, 0.27, tyre, segs=segs, axis='X', loc=V(uc, s, RT)))
                if i == 0:
                    parts.append(lib.disc('bus_rim', 0.275, 0.16, rim, segs=segs, axis='X', loc=V(uc, s + sg * (0.01 if len(duals) == 1 else -0.03), RT), dish=0.03 if len(duals) == 1 else -0.04))
    if not lod:
        # chassis / under-floor boxes, axles, bumpers, mirrors, plates
        parts.append(lib.box('bus_chassis', (1.9, 8.6, 0.22), loc=V(0.55, 0, 0.36), mat=chassis))
        parts.append(lib.box('bus_tank', (0.5, 1.0, 0.36), loc=V(0.3, -0.85, 0.38), mat=chassis, bev=0.04, seg=2))
        parts.append(lib.box('bus_battery', (0.5, 0.7, 0.34), loc=V(-0.8, 0.85, 0.38), mat=chassis, bev=0.02))
        parts.append(lib.cyl('bus_axle', 0.07, 2.0, loc=V(FA, 0, RT), mat=chassis, axis='X', segs=8))
        parts.append(lib.cyl('bus_raxle', 0.09, 1.7, loc=V(RA, 0, RT), mat=chassis, axis='X', segs=8))
        parts.append(lib.box('bus_diff', (0.34, 0.34, 0.30), loc=V(RA, 0, RT), mat=chassis, bev=0.06, seg=2))
        for uu, yaw in ((L2 + 0.07, 0.0), (-L2 - 0.06, 0.0)):
            parts.append(lib.box('bus_bumper', (2.44, 0.16, 0.30), loc=V(uu, 0, 0.52), mat=black, bev=0.05, seg=2))
        fp = lib.box('bus_fplate', (0.50, 0.012, 0.11), loc=V(L2 + 0.155, 0, 0.52))
        lib.set_material(fp, plate_mat(f'{livery}_fplate', 'KA 51 AB 1834' if livery == 'pes' else 'KA 57 F 3102', 0.50, 0.11, L2 + 0.155, 0.52, 'F', font='arialb'))
        rp = lib.box('bus_rplate', (0.50, 0.012, 0.11), loc=V(-L2 - 0.145, 0, 0.52))
        lib.set_material(rp, plate_mat(f'{livery}_rplate', 'KA 51 AB 1834' if livery == 'pes' else 'KA 57 F 3102', 0.50, 0.11, -L2 - 0.145, 0.52, 'B', font='arialb'))
        parts += [fp, rp]
        for sg in (-1, 1):
            arm = [V(L2 - 0.12, sg * 1.20, 2.55), V(L2 + 0.22, sg * 1.36, 2.62), V(L2 + 0.30, sg * 1.42, 2.45), V(L2 + 0.30, sg * 1.42, 2.25)]
            parts.append(lib.tube('bus_marm', lib.fillet(arm, 0.08, 3), 0.018, 8, black))
            mh = lib.box('bus_mhead', (0.24, 0.07, 0.40), loc=V(L2 + 0.30, sg * 1.44, 2.02), mat=black, bev=0.03, seg=2)
            lib.assign_faces(mh, mirror_m, lambda c, n: n.y > 0.8)
            parts.append(mh)
    else:
        for sg in (-1, 1):
            parts.append(lib.box('bus_lm', (0.07, 0.24, 0.40), loc=V(L2 + 0.30, sg * 1.44, 2.02), mat=paint))
        parts.append(lib.box('bus_lch', (1.9, 8.6, 0.2), loc=V(0.55, 0, 0.36), mat=paint))
    return parts


def college_bus():
    bk = lib.Baker('college_bus', tex=2048, orm=1024, ao_dist=0.9, tinted=False, lod_tex=512, ao_samples=48)
    bk.add(*build_bus('pes'))
    return bk.finish(lod=lambda: build_bus('pes', lod=True))


def bmtc_bus():
    bk = lib.Baker('bmtc_bus', tex=2048, orm=1024, ao_dist=0.9, tinted=False, lod_tex=512, ao_samples=48)
    bk.add(*build_bus('bmtc'))
    return bk.finish(lod=lambda: build_bus('bmtc', lod=True))


PROPS = {'college_bus': college_bus, 'bmtc_bus': bmtc_bus}
