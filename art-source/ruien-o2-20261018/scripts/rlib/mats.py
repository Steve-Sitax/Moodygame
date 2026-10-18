# Materials. Images are linked from textures/ with paths relative to the .blend.
import bpy, os
import spec

TEX = '//textures/'
_root = None

def set_root(root):
    global _root
    _root = root

def img(rel, data=False):
    name = os.path.basename(rel)
    im = bpy.data.images.get(name)
    if im is None:
        im = bpy.data.images.load(os.path.join(_root, 'textures', rel), check_existing=True)
        im.name = name
        im.filepath = TEX + rel
    if data:
        im.colorspace_settings.name = 'Non-Color'
        im.alpha_mode = 'CHANNEL_PACKED'
    return im

class NB:
    """Tiny node-building helper."""
    def __init__(self, mat):
        if not mat.node_tree:
            mat.use_nodes = True
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.x = 0
    def _set(self, node, key, val):
        sock = node.inputs[key]
        if isinstance(val, bpy.types.NodeSocket):
            self.nt.links.new(val, sock)
        elif val is not None:
            try:
                sock.default_value = val
            except TypeError:
                sock.default_value = (val, val, val, 1.0) if len(sock.default_value) == 4 else (val, val, val)
    def node(self, t, ins=None, **props):
        n = self.nt.nodes.new(t)
        n.location = (self.x, 0)
        self.x += 30
        for k, v in props.items():
            setattr(n, k, v)
        if ins:
            for k, v in ins.items():
                self._set(n, k, v)
        return n
    def math(self, op, a, b=0.0, clamp=False):
        n = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        self._set(n, 0, a)
        self._set(n, 1, b)
        return n.outputs[0]
    def madd(self, a, b, c):
        n = self.node('ShaderNodeMath', operation='MULTIPLY_ADD')
        self._set(n, 0, a); self._set(n, 1, b); self._set(n, 2, c)
        return n.outputs[0]
    def mixf(self, f, a, b):
        n = self.node('ShaderNodeMix', data_type='FLOAT')
        self._set(n, 0, f); self._set(n, 2, a); self._set(n, 3, b)
        return n.outputs[0]
    def mixc(self, f, a, b, blend='MIX'):
        n = self.node('ShaderNodeMix', data_type='RGBA', blend_type=blend)
        self._set(n, 0, f); self._set(n, 6, a); self._set(n, 7, b)
        return n.outputs[2]
    def vmath(self, op, a, b=None, scale=None):
        n = self.node('ShaderNodeVectorMath', operation=op)
        self._set(n, 0, a)
        if b is not None:
            self._set(n, 1, b)
        if scale is not None:
            self._set(n, 'Scale', scale)
        return n.outputs[0]
    def tex(self, im, vec, interp='Linear', proj='FLAT', blend=0.0, ext='REPEAT'):
        n = self.node('ShaderNodeTexImage', image=im, interpolation=interp, projection=proj, extension=ext)
        n.projection_blend = blend
        self._set(n, 'Vector', vec)
        return n
    def sep(self, col):
        n = self.node('ShaderNodeSeparateColor')
        self._set(n, 0, col)
        return n.outputs
    def attr(self, name):
        n = self.node('ShaderNodeAttribute', attribute_name=name, attribute_type='GEOMETRY')
        return n
    def objinfo(self):
        return self.node('ShaderNodeObjectInfo')
    def texco(self):
        return self.node('ShaderNodeTexCoord')
    def geo(self):
        return self.node('ShaderNodeNewGeometry')
    def noise(self, vec, scale, detail=4.0, rough=0.55, dist=0.0, dim='3D'):
        n = self.node('ShaderNodeTexNoise', noise_dimensions=dim)
        self._set(n, 'Vector', vec)
        self._set(n, 'Scale', scale)
        self._set(n, 'Detail', detail)
        self._set(n, 'Roughness', rough)
        self._set(n, 'Distortion', dist)
        return n
    def ramp(self, f, a, b):
        """Smooth 0..1 from a to b (map range smoothstep)."""
        n = self.node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
        self._set(n, 'Value', f)
        self._set(n, 'From Min', a)
        self._set(n, 'From Max', b)
        return n.outputs[0]
    def maprange(self, f, a, b, c, d, clamp=True):
        n = self.node('ShaderNodeMapRange', interpolation_type='LINEAR', clamp=clamp)
        self._set(n, 'Value', f)
        self._set(n, 'From Min', a); self._set(n, 'From Max', b)
        self._set(n, 'To Min', c); self._set(n, 'To Max', d)
        return n.outputs[0]
    def comb(self, x, y, z):
        n = self.node('ShaderNodeCombineXYZ')
        self._set(n, 0, x); self._set(n, 1, y); self._set(n, 2, z)
        return n.outputs[0]
    def sepxyz(self, v):
        n = self.node('ShaderNodeSeparateXYZ')
        self._set(n, 0, v)
        return n.outputs
    def principled(self, **ins):
        n = self.node('ShaderNodeBsdfPrincipled')
        for k, v in ins.items():
            self._set(n, k, v)
        return n
    def out(self, surf=None, disp=None, vol=None):
        o = self.node('ShaderNodeOutputMaterial', target='ALL')
        if surf is not None:
            self.nt.links.new(surf, o.inputs['Surface'])
        if disp is not None:
            self.nt.links.new(disp, o.inputs['Displacement'])
        if vol is not None:
            self.nt.links.new(vol, o.inputs['Volume'])
        return o
    def bump(self, h, strength, dist, normal=None):
        n = self.node('ShaderNodeBump')
        self._set(n, 'Height', h)
        self._set(n, 'Strength', strength)
        self._set(n, 'Distance', dist)
        if normal is not None:
            self._set(n, 'Normal', normal)
        return n.outputs[0]

def new_mat(name):
    m = bpy.data.materials.get(name)
    if m:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name)
    return m

DAYLIGHT = [(-146.95, 92.5, 3.2), (-149.5, 120.81, 3.2), (-158.9, 136.6, 3.0), (-146.1, 72.0, 5.0)]

def daylight_factor(nb, pos, base=0.0):
    """1 near openings that let daylight in (grate, air shaft, stair hatch, outlet), 0 in the dark."""
    sx = nb.sepxyz(pos)
    f = base
    for (gx, gz, r) in DAYLIGHT:
        dx = nb.math('SUBTRACT', sx[0], gx)
        dz = nb.math('ADD', sx[1], gz)
        d = nb.math('SQRT', nb.math('ADD', nb.math('MULTIPLY', dx, dx), nb.math('MULTIPLY', dz, dz)))
        f = nb.math('MAXIMUM', f, nb.ramp(nb.math('SUBTRACT', r, d), 0.0, r * 0.6))
    return f

def stone_zone(nb, uvn, mode):
    """Bluestone zones in a brick surface. 'rib_soffit' / 'rib_side': voussoirs on the intrados of an arch ring,
    radial, every 0.9 m of arc, long and short alternating across the soffit. 'pier': quoins wrapping the four
    corners of a pier shaft, long and short alternating by course. Returns (mask, joint groove)."""
    u = nb.sepxyz(uvn)
    x, y = u[0], u[1]
    def win(v, a, b, e=0.01):
        return nb.math('MULTIPLY', nb.ramp(v, a - e, a + e), nb.math('SUBTRACT', 1.0, nb.ramp(v, b - e, b + e)))
    if mode in ('rib_soffit', 'rib_side'):
        q = nb.math('SUBTRACT', y, 0.25)
        k = nb.math('FLOOR', nb.math('DIVIDE', q, 0.9))
        loc = nb.math('SUBTRACT', q, nb.math('MULTIPLY', k, 0.9))
        along = win(loc, 0.0, 0.3)
        par = nb.math('FLOORED_MODULO', k, 2.0)
        if mode == 'rib_soffit':
            lo = nb.mixf(par, 0.44, 0.27)
            hi = nb.math('SUBTRACT', 2 * spec.PIER_W / 2, nb.mixf(par, 0.27, 0.44))
            across = nb.math('MAXIMUM', nb.math('SUBTRACT', 1.0, nb.ramp(x, nb.math('SUBTRACT', lo, 0.01), nb.math('ADD', lo, 0.01))),
                             nb.ramp(x, nb.math('SUBTRACT', hi, 0.01), nb.math('ADD', hi, 0.01)))
        else:
            across = nb.math('SUBTRACT', 1.0, nb.ramp(x, 0.25, 0.27))
        mask = nb.math('MULTIPLY', along, across)
    else:
        course = nb.math('FLOOR', nb.math('DIVIDE', nb.math('ADD', y, 4.95), 0.27))
        mask = 0.0
        side = 1.085
        for kc in range(5):
            ck = kc * side + 0.0275
            par = nb.math('FLOORED_MODULO', nb.math('ADD', course, float(kc)), 2.0)
            a_ = nb.mixf(par, 0.42, 0.26)
            b_ = nb.mixf(par, 0.26, 0.42)
            d = nb.math('SUBTRACT', x, ck)
            m_ = nb.math('MULTIPLY', nb.ramp(d, nb.math('SUBTRACT', 0.0, nb.math('ADD', a_, 0.01)), nb.math('SUBTRACT', 0.0, nb.math('SUBTRACT', a_, 0.01))),
                         nb.math('SUBTRACT', 1.0, nb.ramp(d, nb.math('SUBTRACT', b_, 0.01), nb.math('ADD', b_, 0.01))))
            mask = nb.math('MAXIMUM', mask, m_)
    groove = nb.math('MULTIPLY', nb.math('MULTIPLY', mask, nb.math('SUBTRACT', 1.0, mask)), 4.0)
    return mask, groove

def world_z(nb):
    return nb.sepxyz(nb.geo().outputs['Position'])[2]

# ------------------------------------------------------------------ masonry
def masonry(name, wet_base=0.12, slime_global=0.0, tint=(1, 1, 1), sand_ok=True, disp_scale=0.65, bond='flemish', tide_y=-3.9, grime=1.0, flecks=0.25, daylight=0.0, stone=None):
    """Brick (three colour variants on one layout per bond) + sandstone + lime crust + bloom + moss + soot + slime + silt.
    Needs UV 'UVMap' in metres and colour attributes
    wxA (lime, soot, slime, silt), wxB (sandstone, repair, streak direction, displacement fade),
    wxC (fallen-out damage, efflorescence bloom, puddle, runoff trail).
    Wetness by cause: saturated below the tide band (tide_y), runoff trails above it, dull and dry higher up."""
    m = new_mat(name)
    m.displacement_method = 'BOTH'
    nb = NB(m)
    pre = 'gen/brick_%s_' % bond
    uvn = nb.node('ShaderNodeUVMap', uv_map='UVMap').outputs[0]
    oi = nb.objinfo()
    off = nb.vmath('MULTIPLY', oi.outputs['Random'], (17.31, 9.13, 0))
    uv = nb.vmath('ADD', uvn, off)
    tw, th = spec.BRICK_TILE
    ub = nb.vmath('MULTIPLY', uv, (1 / tw, 1 / th, 1))
    Hb = nb.tex(img(pre + 'height.png', True), ub, 'Cubic').outputs[0]
    Cd = nb.tex(img(pre + 'dry.png'), ub).outputs[0]
    Cs = nb.tex(img(pre + 'slime.png'), ub).outputs[0]
    Cl = nb.tex(img(pre + 'lime.png'), ub).outputs[0]
    M1 = nb.tex(img(pre + 'masks.png', True), ub)
    M1c = nb.sep(M1.outputs[0])   # R mortar, G id, B streak toward -v
    M1a = M1.outputs[1]           # A streak toward +v
    M2 = nb.tex(img(pre + 'masks2.png', True), ub)
    M2c = nb.sep(M2.outputs[0])   # R cavity, G fresh break, B missing
    mortar = M1c[0]
    cav = M2c[0]
    brickm = nb.math('SUBTRACT', 1.0, mortar)
    # the course behind: same bond, shifted half a brick and one course, for the backs of holes
    ub2 = nb.vmath('ADD', ub, (0.0198, 0.025, 0))
    Hb2 = nb.tex(img(pre + 'height.png', True), ub2, 'Cubic').outputs[0]
    Cd2 = nb.tex(img(pre + 'dry.png'), ub2).outputs[0]
    A = nb.attr('wxA')
    Ac = nb.sep(A.outputs['Color'])
    lime_a, soot_a, slime_a = Ac[0], Ac[1], Ac[2]
    silt_a = A.outputs['Alpha']
    B = nb.attr('wxB')
    Bc = nb.sep(B.outputs['Color'])
    sand_a, repair_a, sdir_a = Bc[0], Bc[1], Bc[2]
    dfade = B.outputs['Alpha']
    Cw = nb.attr('wxC')
    Cc_ = nb.sep(Cw.outputs['Color'])
    dmg_a, bloom_a, puddle_a = Cc_[0], Cc_[1], Cc_[2]
    runoff_a = Cw.outputs['Alpha']
    pos = nb.geo().outputs['Position']
    z = world_z(nb)
    nbig = nb.noise(pos, 0.9, 5, 0.6).outputs[0]
    nmid = nb.noise(pos, 4.5, 4, 0.6).outputs[0]
    nvert = nb.noise(nb.vmath('MULTIPLY', pos, (9.0, 9.0, 0.7)), 1.0, 4, 0.6).outputs[0]   # streaks that run down
    # ---- zones
    tide = nb.ramp(nb.math('ADD', nb.math('SUBTRACT', tide_y, z), nb.math('MULTIPLY', nb.math('SUBTRACT', nmid, 0.5), 0.18)), -0.06, 0.1)
    fringe = nb.math('MULTIPLY', nb.ramp(nb.math('SUBTRACT', tide_y + 0.7, z), 0.0, 0.5), nb.math('SUBTRACT', 1.0, tide))
    streak = nb.mixf(sdir_a, M1c[2], M1a)
    runoff = nb.math('MULTIPLY', runoff_a, nb.maprange(nvert, 0.35, 0.7, 0.2, 1.3), clamp=True)
    runoff = nb.math('MAXIMUM', runoff, nb.math('MULTIPLY', nb.math('MULTIPLY', runoff_a, streak), 1.2))
    slime = nb.math('ADD', nb.math('ADD', slime_a, slime_global), nb.math('MULTIPLY', tide, 0.9))
    slime = nb.math('MULTIPLY', slime, nb.maprange(nbig, 0.3, 0.7, 0.65, 1.35))
    slime = nb.math('ADD', slime, nb.math('MULTIPLY', runoff, 0.25))
    slime = nb.ramp(slime, 0.3, 0.8)
    # moss and algae: damp joints, just above the tide band, along runoff and leaks, near silt
    moss = nb.math('ADD', nb.math('ADD', nb.math('MULTIPLY', fringe, 0.9), nb.math('MULTIPLY', runoff, 0.8)), nb.math('ADD', nb.math('MULTIPLY', slime_a, 0.6), nb.math('MULTIPLY', silt_a, 0.35)))
    moss = nb.math('MULTIPLY', moss, nb.math('ADD', nb.math('MULTIPLY', mortar, 0.9), nb.math('MULTIPLY', cav, 0.6)))
    moss = nb.math('MULTIPLY', moss, nb.maprange(nb.noise(pos, 3.0, 5, 0.65).outputs[0], 0.35, 0.65, 0.2, 1.6))
    moss = nb.math('MULTIPLY', nb.ramp(moss, 0.18, 0.5), grime)
    # ---- colour
    col = nb.mixc(slime, Cd, Cs)
    film = nb.mixc(nb.noise(pos, 7, 4).outputs[0], (0.01, 0.014, 0.006, 1), (0.028, 0.034, 0.014, 1))
    col = nb.mixc(nb.math('MULTIPLY', nb.math('MAXIMUM', nb.math('MULTIPLY', slime, tide), nb.math('MULTIPLY', tide, 0.7)), 0.9), col, film)
    col = nb.mixc(nb.math('MULTIPLY', repair_a, 0.55), col, nb.mixc(0.5, col, (0.36, 0.22, 0.12, 1), 'MULTIPLY'))
    tintv = nb.maprange(M1c[1], 0, 1, 0.8, 1.15)
    col = nb.mixc(brickm, col, nb.mixc(1.0, col, nb.comb(tintv, nb.math('MULTIPLY', tintv, 0.97), nb.math('MULTIPLY', tintv, 0.94)), 'MULTIPLY'))
    if stone:
        smask, sgroove = stone_zone(nb, uvn, stone)
        bsc = nb.vmath('MULTIPLY', nb.vmath('ADD', uvn, nb.vmath('MULTIPLY', oi.outputs['Random'], (5.0, 3.0, 0))), (1 / 2.4, 1 / 2.4, 1))
        Bs = nb.tex(img('gen/bluestone_plain.png'), bsc).outputs[0]
        Bh = nb.tex(img('gen/bluestone_plain_height.png', True), bsc, 'Cubic').outputs[0]
        stcol = nb.mixc(1.0, Bs, (0.5, 0.51, 0.53, 1), 'MULTIPLY')
    else:
        smask, sgroove, Bh = 0.0, 0.0, 0.5
    us = nb.vmath('MULTIPLY', nb.vmath('ADD', uv, (3.7, 1.1, 0)), (1 / spec.SAND_TILE, 1 / spec.SAND_TILE, 1))
    Sa = nb.tex(img('t07-sandstone_seamless.png'), us).outputs[0]
    Sh = nb.tex(img('t07-sandstone_height.png', True), us, 'Cubic').outputs[0]
    sand = nb.ramp(nb.math('ADD', sand_a, nb.math('MULTIPLY', nb.math('SUBTRACT', nmid, 0.5), 0.5)), 0.45, 0.55) if sand_ok else 0.0
    Sa_d = nb.mixc(0.45, Sa, (0.22, 0.2, 0.15, 1), 'MULTIPLY')
    Sa_d = nb.mixc(nb.math('MULTIPLY', slime, 0.8), Sa_d, (0.05, 0.06, 0.035, 1))
    col = nb.mixc(sand, col, Sa_d)
    # general grime: dirt packed in every joint and cavity, a dark film over the old brick
    # grey lime mortar (the photo), then dirt in cavities only
    # mortar: dirty dark grey, washed lighter only in places
    mwash = nb.ramp(nb.noise(pos, 1.3, 4, 0.6).outputs[0], 0.58, 0.7)
    mcol = nb.mixc(nb.noise(pos, 20, 3).outputs[0], (0.075, 0.07, 0.062, 1), (0.13, 0.12, 0.105, 1))
    mcol = nb.mixc(nb.math('MULTIPLY', mwash, 0.7), mcol, (0.22, 0.21, 0.19, 1))
    col = nb.mixc(nb.math('MULTIPLY', mortar, 0.8), col, mcol)
    # per brick fired colour: some overfired purple-black, some pale salmon
    over = nb.math('LESS_THAN', M1c[1], 0.11)
    pale = nb.math('GREATER_THAN', M1c[1], 0.93)
    col = nb.mixc(nb.math('MULTIPLY', nb.math('MULTIPLY', over, brickm), 0.8), col, nb.mixc(1.0, col, (0.32, 0.22, 0.27, 1), 'MULTIPLY'))
    col = nb.mixc(nb.math('MULTIPLY', nb.math('MULTIPLY', pale, brickm), 0.6), col, nb.mixc(1.0, col, (1.35, 1.2, 1.05, 1), 'MULTIPLY'))
    # ancient grime: dirt packed in every cavity and joint edge, a dark film broken by large patches
    col = nb.mixc(nb.math('MULTIPLY', cav, 0.6 * grime), col, (0.03, 0.025, 0.02, 1))
    col = nb.mixc(nb.math('MULTIPLY', nb.maprange(nbig, 0.25, 0.75, 0.12, 0.55), grime), col, nb.mixc(0.65, col, (0.035, 0.032, 0.028, 1)))
    # dirt gathers low: a grime gradient toward the water, under the tide band slime takes over
    col = nb.mixc(nb.math('MULTIPLY', nb.ramp(nb.math('SUBTRACT', tide_y + 1.1, z), 0.0, 1.1), 0.7 * grime), col, nb.mixc(0.4, col, (0.03, 0.028, 0.02, 1)))
    # dark damp trails below every leak, and black grime streaks from the vault
    col = nb.mixc(nb.math('MULTIPLY', runoff, 0.8), col, nb.mixc(1.0, col, (0.25, 0.24, 0.22, 1), 'MULTIPLY'))
    gstreak = nb.math('MULTIPLY', nb.ramp(nvert, 0.55, 0.68), nb.ramp(nb.noise(pos, 0.6, 3).outputs[0], 0.45, 0.6))
    col = nb.mixc(nb.math('MULTIPLY', gstreak, 0.6 * grime), col, (0.02, 0.018, 0.016, 1))
    # lime: follows leaks; pale crust where it is thick, lime-variant brick round it
    lime = nb.math('MULTIPLY', lime_a, nb.math('ADD', nb.math('ADD', nb.math('MULTIPLY', streak, 1.4), nb.math('MULTIPLY', mortar, 0.5)), nb.math('MULTIPLY', nvert, 0.6)))
    lime = nb.math('MULTIPLY', lime, nb.maprange(nmid, 0.35, 0.65, 0.5, 1.4))
    lime_v = nb.ramp(lime, 0.12, 0.4)
    lime_c = nb.ramp(lime, 0.42, 0.85)
    col = nb.mixc(lime_v, col, Cl)
    crust = nb.mixc(nb.noise(pos, 30, 3).outputs[0], (0.5, 0.48, 0.4, 1), (0.66, 0.63, 0.55, 1))
    col = nb.mixc(lime_c, col, crust)
    # efflorescence bloom: white salts in the joints above the tide band
    bloom = nb.math('MULTIPLY', nb.math('MULTIPLY', bloom_a, mortar), nb.ramp(nb.noise(pos, 22, 3).outputs[0], 0.42, 0.6))
    bloom = nb.math('MULTIPLY', bloom, nb.math('SUBTRACT', 1.0, tide))
    col = nb.mixc(bloom, col, (0.62, 0.6, 0.55, 1))
    # white speckled efflorescence over the brick, denser near leaks
    fleck = nb.math('GREATER_THAN', nb.noise(pos, 150.0, 2, 0.5).outputs[0], nb.math('SUBTRACT', 0.74, nb.math('MULTIPLY', nb.math('ADD', lime_a, nb.math('MULTIPLY', runoff_a, 0.4)), 0.12)))
    fleck = nb.math('MULTIPLY', fleck, nb.math('MULTIPLY', nb.math('ADD', flecks, nb.math('MULTIPLY', lime_a, 1.2)), nb.ramp(nb.noise(pos, 2.0, 3).outputs[0], 0.35, 0.6)))
    fleck = nb.math('MULTIPLY', nb.math('MINIMUM', fleck, 1.0), nb.math('SUBTRACT', 1.0, tide))
    col = nb.mixc(fleck, col, (0.68, 0.66, 0.6, 1))
    # moss needs light: true moss (t10) only near shafts, the stair door and the outlet; bacterial mats elsewhere
    lightf = daylight_factor(nb, pos, daylight)
    um = nb.vmath('MULTIPLY', uv, (1 / 1.2, 1 / 1.2, 1))
    Tm = nb.tex(img('t10-moss_seamless.png'), um).outputs[0]
    Tl = nb.sepxyz(Tm)
    green = nb.ramp(nb.math('SUBTRACT', Tl[1], nb.math('MULTIPLY', nb.math('ADD', Tl[0], Tl[2]), 0.5)), 0.0, 0.06)
    lmoss = nb.math('MULTIPLY', nb.math('MULTIPLY', nb.math('ADD', moss, nb.math('MULTIPLY', mortar, 0.5)), lightf), green)
    lmoss = nb.ramp(lmoss, 0.15, 0.45)
    col = nb.mixc(lmoss, col, nb.mixc(1.0, Tm, (0.55, 0.6, 0.5, 1), 'MULTIPLY'))
    bact = nb.mixc(nb.ramp(nb.noise(pos, 4.0, 4).outputs[0], 0.4, 0.6), (0.012, 0.015, 0.007, 1), (0.055, 0.036, 0.018, 1))
    dmoss = nb.math('MULTIPLY', moss, nb.math('SUBTRACT', 1.0, lightf))
    col = nb.mixc(dmoss, col, bact)
    # soot and black grime streaks on the drier, higher brick
    soot = nb.math('MULTIPLY', soot_a, nb.maprange(nbig, 0.3, 0.7, 0.6, 1.3))
    soot = nb.math('ADD', soot, nb.math('MULTIPLY', nb.math('MULTIPLY', nb.ramp(nvert, 0.5, 0.7), nb.ramp(z, -3.2, -2.0)), 0.5 * grime), clamp=True)
    col = nb.mixc(nb.math('MULTIPLY', soot, 0.85), col, (0.016, 0.014, 0.012, 1))
    # silt crusted on upward faces, in joints and corners
    nz = nb.sepxyz(nb.geo().outputs['Normal'])[2]
    up = nb.ramp(nz, 0.2, 0.7)
    silt = nb.math('MULTIPLY', silt_a, nb.math('ADD', nb.math('MULTIPLY', up, 0.7), nb.math('MULTIPLY', cav, 0.7)))
    silt = nb.math('ADD', silt, nb.math('MULTIPLY', nb.math('MULTIPLY', up, cav), 0.4 * grime))
    silt = nb.ramp(nb.math('MULTIPLY', silt, nb.maprange(nmid, 0.3, 0.7, 0.6, 1.4)), 0.22, 0.55)
    Sc = nb.tex(img('t04-silt-mud_seamless.png'), nb.vmath('MULTIPLY', pos, (0.45, 0.45, 0.45)), proj='BOX', blend=0.3).outputs[0]
    col = nb.mixc(silt, col, nb.mixc(0.45, Sc, (0.08, 0.065, 0.05, 1), 'MULTIPLY'))
    col = nb.mixc(1.0, col, (tint[0], tint[1], tint[2], 1), 'MULTIPLY')
    # ---- fallen-out bricks: irregular clusters, whole bricks out, neighbours half broken, a back course behind
    dmg = nb.math('MULTIPLY', dmg_a, nb.maprange(nb.noise(pos, 2.2, 4, 0.7).outputs[0], 0.3, 0.7, 0.2, 1.6))
    miss = nb.math('MULTIPLY', nb.math('LESS_THAN', M1c[1], nb.math('MULTIPLY', dmg, 0.8)), nb.math('SUBTRACT', 1.0, sand))
    miss = nb.math('MULTIPLY', miss, nb.math('LESS_THAN', mortar, 0.5))
    halfb = nb.math('MULTIPLY', nb.math('LESS_THAN', M1c[1], nb.math('MULTIPLY', dmg, 1.3)), nb.math('GREATER_THAN', nb.noise(pos, 16, 3).outputs[0], 0.5))
    halfb = nb.math('MULTIPLY', nb.math('MULTIPLY', halfb, nb.math('SUBTRACT', 1.0, miss)), brickm)
    if stone:
        stc = nb.mixc(nb.math('MULTIPLY', nb.maprange(nbig, 0.3, 0.75, 0.0, 0.5), grime), stcol, (0.05, 0.048, 0.045, 1))
        stc = nb.mixc(nb.math('MULTIPLY', runoff, 0.5), stc, nb.mixc(1.0, stc, (0.45, 0.45, 0.42, 1), 'MULTIPLY'))
        stc = nb.mixc(nb.math('MULTIPLY', lime_c, 0.8), stc, crust)
        col = nb.mixc(smask, col, stc)
        col = nb.mixc(nb.math('MULTIPLY', sgroove, 0.85), col, (0.05, 0.045, 0.04, 1))
    # ---- wetness and roughness
    wet = nb.math('MAXIMUM', tide, runoff)
    wet = nb.math('MAXIMUM', wet, nb.math('MULTIPLY', slime, 0.8))
    wet = nb.math('MAXIMUM', wet, nb.math('MULTIPLY', lime_c, 0.55))
    wet = nb.math('MAXIMUM', wet, nb.math('MULTIPLY', wet_base, nb.maprange(nbig, 0.2, 0.8, 0.4, 1.6)))
    puddle = nb.math('MULTIPLY', puddle_a, nb.ramp(nb.noise(pos, 1.6, 3).outputs[0], 0.45, 0.55))
    col = nb.mixc(nb.math('MULTIPLY', wet, 0.55), col, nb.mixc(1.0, col, col, 'MULTIPLY'))
    col = nb.mixc(nb.math('MULTIPLY', wet, 0.25), col, nb.mixc(1.0, col, (0.6, 0.6, 0.6, 1), 'MULTIPLY'))
    back = nb.mixc(0.86, Cd2, (0.03, 0.022, 0.017, 1))
    back = nb.mixc(nb.math('MULTIPLY', tide, 0.8), back, (0.012, 0.015, 0.008, 1))
    back = nb.mixc(nb.ramp(nb.noise(pos, 30, 3).outputs[0], 0.5, 0.6), back, (0.05, 0.04, 0.03, 1))
    col = nb.mixc(miss, col, back)
    col = nb.mixc(nb.math('MULTIPLY', halfb, nb.math('MULTIPLY', 0.6, nb.math('SUBTRACT', 1.0, nb.math('MULTIPLY', slime, 0.7)))), col, nb.mixc(0.5, col, (0.11, 0.065, 0.04, 1)))
    col = nb.mixc(nb.math('MULTIPLY', puddle, 0.7), col, nb.mixc(1.0, col, (0.35, 0.35, 0.35, 1), 'MULTIPLY'))
    rough_dry = nb.mixf(mortar, 0.86, 0.95)
    rough_dry = nb.mixf(bloom, rough_dry, 0.98)
    rough = nb.mixf(wet, rough_dry, 0.34)
    rough = nb.mixf(nb.math('MULTIPLY', slime, tide), rough, 0.14)
    rough = nb.mixf(moss, rough, 0.6)
    rough = nb.mixf(silt, rough, 0.5)
    rough = nb.mixf(miss, rough, 0.9)
    rough = nb.mixf(puddle, rough, 0.03)
    coat = nb.math('MULTIPLY', nb.math('MAXIMUM', nb.math('MULTIPLY', tide, 0.6), nb.math('MULTIPLY', runoff, 0.35)), nb.math('SUBTRACT', 1.0, miss))
    coat = nb.math('MAXIMUM', coat, puddle)
    # ---- height
    hb = nb.madd(Hb, spec.BRICK_HMAX - spec.BRICK_HMIN, spec.BRICK_HMIN)
    hs = nb.madd(Sh, 0.04, -0.028)
    h = nb.mixf(sand, hb, hs)
    h = nb.math('ADD', h, nb.math('MULTIPLY', lime_c, 0.007))
    h = nb.math('MAXIMUM', h, nb.math('SUBTRACT', nb.math('MULTIPLY', silt, 0.012), 0.008))
    h = nb.math('MAXIMUM', h, nb.math('SUBTRACT', nb.math('MULTIPLY', moss, 0.002), 0.002))
    h = nb.math('MAXIMUM', h, nb.math('SUBTRACT', nb.math('MULTIPLY', lmoss, nb.math('ADD', 0.006, nb.math('MULTIPLY', nb.noise(pos, 90, 2).outputs[0], 0.01))), 0.006))
    h = nb.math('SUBTRACT', h, nb.math('MULTIPLY', nb.math('MULTIPLY', mortar, dmg), 0.02))
    h = nb.math('SUBTRACT', h, nb.math('MULTIPLY', halfb, 0.022))
    hole_h = nb.math('ADD', -0.075, nb.math('MULTIPLY', nb.madd(Hb2, spec.BRICK_HMAX - spec.BRICK_HMIN, spec.BRICK_HMIN), 0.8))
    h = nb.mixf(miss, h, hole_h)
    h = nb.math('MAXIMUM', h, nb.math('SUBTRACT', nb.math('MULTIPLY', puddle, 0.0035), 0.0035))
    if stone:
        h = nb.mixf(smask, h, nb.math('MULTIPLY', nb.math('SUBTRACT', Bh, 0.5), 0.004))
        h = nb.math('SUBTRACT', h, nb.math('MULTIPLY', sgroove, 0.014))
    h = nb.math('MULTIPLY', h, nb.math('MULTIPLY', dfade, disp_scale))
    bsdf = nb.principled(**{'Base Color': col, 'Roughness': rough, 'Coat Weight': coat,
                            'Coat Roughness': 0.08, 'Specular IOR Level': 0.45})
    disp = nb.node('ShaderNodeDisplacement', {'Height': h, 'Midlevel': 0.0, 'Scale': 1.0}, space='OBJECT')
    nb.out(bsdf.outputs[0], disp.outputs[0])
    return m

# ------------------------------------------------------------------ bluestone (dressed Belgian hardsteen)
def bluestone(name, wet_line=spec.WATER_Y, slime_top=None, darken=0.4, disp=False):
    m = new_mat(name)
    m.displacement_method = 'BOTH' if disp else 'BUMP'
    nb = NB(m)
    tc = nb.texco()
    oi = nb.objinfo()
    co = nb.vmath('ADD', tc.outputs['Object'], nb.vmath('MULTIPLY', oi.outputs['Random'], (7.7, 3.3, 5.1)))
    co = nb.vmath('MULTIPLY', co, (1 / (spec.BLUE_TILE * 1.6),) * 3)
    C = nb.tex(img('gen/bluestone_plain.png'), co, proj='BOX', blend=0.25).outputs[0]
    H = nb.tex(img('gen/bluestone_plain_height.png', True), co, 'Cubic', proj='BOX', blend=0.25).outputs[0]
    pos = nb.geo().outputs['Position']
    z = world_z(nb)
    nbig = nb.noise(pos, 1.3, 5, 0.6).outputs[0]
    col = nb.mixc(1.0, C, (darken, darken, darken * 1.02, 1), 'MULTIPLY')
    grime = nb.maprange(nb.noise(pos, 3.0, 6, 0.65).outputs[0], 0.3, 0.7, 0.55, 1.1)
    col = nb.mixc(1.0, col, nb.comb(grime, grime, nb.math('MULTIPLY', grime, 0.97)), 'MULTIPLY')
    # fresh chips are lighter grey: use pointiness of the block mesh
    pt = nb.geo().outputs['Pointiness']
    chip = nb.ramp(pt, 0.52, 0.6)
    col = nb.mixc(nb.math('MULTIPLY', chip, 0.5), col, (0.3, 0.31, 0.32, 1))
    # tide line / water band
    st = slime_top if slime_top is not None else wet_line + 0.45
    band = nb.ramp(nb.math('SUBTRACT', st, z), -0.05, 0.35)
    band = nb.math('MULTIPLY', band, nb.maprange(nbig, 0.3, 0.7, 0.6, 1.3), clamp=True)
    col = nb.mixc(nb.math('MULTIPLY', band, 0.9), col, (0.022, 0.03, 0.014, 1))
    mossb = nb.math('MULTIPLY', nb.ramp(nb.math('SUBTRACT', st + 0.5, z), 0.0, 0.4), nb.ramp(nb.noise(pos, 6, 5, 0.65).outputs[0], 0.5, 0.62))
    col = nb.mixc(nb.math('MULTIPLY', mossb, 0.85), col, (0.025, 0.038, 0.012, 1))
    grimeb = nb.ramp(nb.noise(pos, 1.0, 4).outputs[0], 0.35, 0.7)
    col = nb.mixc(nb.math('MULTIPLY', grimeb, 0.5), col, (0.03, 0.03, 0.028, 1))
    # dirt in a lower zone, splash and silt
    nz = nb.sepxyz(nb.geo().outputs['Normal'])[2]
    silt = nb.math('MULTIPLY', nb.ramp(nz, 0.5, 0.9), nb.ramp(nb.math('SUBTRACT', st + 1.2, z), 0.0, 0.8))
    silt = nb.math('MULTIPLY', silt, nb.ramp(nb.noise(pos, 2.5, 4).outputs[0], 0.45, 0.65))
    col = nb.mixc(nb.math('MULTIPLY', silt, 0.8), col, (0.09, 0.075, 0.055, 1))
    wet = nb.math('ADD', 0.35, nb.math('MULTIPLY', band, 0.7), clamp=True)
    col = nb.mixc(nb.math('MULTIPLY', wet, 0.3), col, nb.mixc(1.0, col, col, 'MULTIPLY'))
    rough = nb.mixf(wet, 0.7, 0.32)
    bsdf = nb.principled(**{'Base Color': col, 'Roughness': rough, 'Coat Weight': nb.math('MULTIPLY', wet, 0.15), 'Coat Roughness': 0.2})
    h = nb.math('MULTIPLY', nb.math('SUBTRACT', H, 0.5), 0.0012)
    d = nb.node('ShaderNodeDisplacement', {'Height': h, 'Midlevel': 0.0, 'Scale': 1.0}, space='OBJECT')
    nb.out(bsdf.outputs[0], d.outputs[0])
    return m

# ------------------------------------------------------------------ iron
def iron(name, rust=0.6, cast=True, wet_line=None):
    m = new_mat(name)
    m.displacement_method = 'BUMP'
    nb = NB(m)
    tc = nb.texco()
    oi = nb.objinfo()
    co = nb.vmath('ADD', tc.outputs['Object'], nb.vmath('MULTIPLY', oi.outputs['Random'], (3.1, 5.3, 1.7)))
    co_r = nb.vmath('MULTIPLY', co, (1 / spec.RUST_TILE,) * 3)
    R = nb.tex(img('t06-rust-iron_seamless.png'), co_r, proj='BOX', blend=0.3).outputs[0]
    RH = nb.tex(img('t06-rust-iron_height.png', True), co_r, proj='BOX', blend=0.3).outputs[0]
    n = nb.noise(co, 6.0, 5, 0.6).outputs[0]
    rm = nb.ramp(nb.math('ADD', n, rust - 0.5), 0.35, 0.6)
    base = (0.035, 0.034, 0.033, 1) if cast else (0.04, 0.037, 0.035, 1)
    Rd = nb.mixc(0.75, R, (0.3, 0.24, 0.2, 1), 'MULTIPLY')
    Rd = nb.mixc(0.35, Rd, (0.05, 0.035, 0.025, 1))
    col = nb.mixc(rm, base, Rd)
    metal = nb.mixf(rm, 0.65, 0.0)
    rough = nb.mixf(rm, 0.48, 0.88)
    if wet_line is not None:
        z = world_z(nb)
        wet = nb.ramp(nb.math('SUBTRACT', wet_line, z), -0.1, 0.3)
        col = nb.mixc(nb.math('MULTIPLY', wet, 0.7), col, (0.03, 0.035, 0.022, 1))
        rough = nb.mixf(wet, rough, 0.25)
    bump = nb.bump(nb.mixf(rm, nb.math('MULTIPLY', n, 0.2), RH), 0.6, 0.002)
    bsdf = nb.principled(**{'Base Color': col, 'Metallic': metal, 'Roughness': rough, 'Normal': bump})
    nb.out(bsdf.outputs[0])
    return m

# ------------------------------------------------------------------ oak door planks (UVMap = atlas, UV2 = door stain space)
def oak(name, slime_line=-3.9, dark=0.62):
    m = new_mat(name)
    m.displacement_method = 'BUMP'
    nb = NB(m)
    uv = nb.node('ShaderNodeUVMap', uv_map='UVMap').outputs[0]
    uv2 = nb.node('ShaderNodeUVMap', uv_map='UV2').outputs[0]
    C = nb.tex(img('gen/oak_atlas.png'), uv).outputs[0]
    H = nb.tex(img('gen/oak_atlas_height.png', True), uv).outputs[0]
    S = nb.sep(nb.tex(img('gen/door_stains.png', True), uv2, ext='EXTEND').outputs[0])
    z = world_z(nb)
    pos = nb.geo().outputs['Position']
    col = nb.mixc(1.0, C, (dark, dark * 0.96, dark * 0.9, 1), 'MULTIPLY')
    rust = nb.math('MULTIPLY', S[0], 0.85)
    col = nb.mixc(rust, col, (0.16, 0.06, 0.025, 1))
    slime = nb.ramp(nb.math('SUBTRACT', slime_line, z), -0.2, 0.5)
    slime = nb.math('MULTIPLY', slime, nb.maprange(nb.noise(pos, 3, 4).outputs[0], 0.3, 0.7, 0.5, 1.4), clamp=True)
    col = nb.mixc(slime, col, (0.018, 0.026, 0.01, 1))
    mosso = nb.math('MULTIPLY', nb.ramp(nb.math('SUBTRACT', slime_line + 0.6, z), 0.0, 0.5), nb.ramp(nb.noise(pos, 5, 5, 0.65).outputs[0], 0.45, 0.6))
    col = nb.mixc(nb.math('MULTIPLY', mosso, 0.9), col, (0.03, 0.045, 0.012, 1))
    wet = nb.math('ADD', S[1], slime, clamp=True)
    col = nb.mixc(nb.math('MULTIPLY', wet, 0.4), col, nb.mixc(1.0, col, col, 'MULTIPLY'))
    rough = nb.mixf(wet, 0.75, 0.3)
    bump = nb.bump(H, 0.8, 0.004)
    bsdf = nb.principled(**{'Base Color': col, 'Roughness': rough, 'Normal': bump, 'Coat Weight': nb.math('MULTIPLY', wet, 0.25)})
    nb.out(bsdf.outputs[0])
    return m

def wood_debris(name, dark=0.5):
    m = new_mat(name)
    nb = NB(m)
    tc = nb.texco()
    oi = nb.objinfo()
    co = nb.vmath('ADD', tc.outputs['Object'], nb.vmath('MULTIPLY', oi.outputs['Random'], (1.9, 0.0, 4.4)))
    # grain along object X: map atlas v along X
    sx = nb.sepxyz(co)
    uv = nb.comb(nb.math('MULTIPLY', nb.math('ADD', sx[1], nb.math('MULTIPLY', oi.outputs['Random'], 0.9)), 1.0 / (spec.OAK_PLANK_W * spec.OAK_ATLAS_COLS)),
                 nb.math('MULTIPLY', sx[0], 1.0 / spec.OAK_ATLAS_H_M), 0)
    C = nb.tex(img('gen/oak_atlas.png'), uv).outputs[0]
    H = nb.tex(img('gen/oak_atlas_height.png', True), uv).outputs[0]
    z = world_z(nb)
    col = nb.mixc(1.0, C, (dark, dark * 0.92, dark * 0.82, 1), 'MULTIPLY')
    wet = nb.ramp(nb.math('SUBTRACT', spec.WATER_Y + 0.25, z), -0.1, 0.3)
    col = nb.mixc(nb.math('MULTIPLY', wet, 0.6), col, (0.03, 0.025, 0.015, 1))
    bsdf = nb.principled(**{'Base Color': col, 'Roughness': nb.mixf(wet, 0.8, 0.3), 'Normal': nb.bump(H, 0.7, 0.003)})
    nb.out(bsdf.outputs[0])
    return m

# ------------------------------------------------------------------ silt and mud
def silt(name, wet_line=spec.WATER_Y + 0.15, disp=0.05, tile=spec.SILT_TILE, dark=0.6, mud=0.0, swell=0.0):
    m = new_mat(name)
    m.displacement_method = 'BOTH'
    nb = NB(m)
    pos = nb.geo().outputs['Position']
    co = nb.vmath('MULTIPLY', pos, (1 / tile,) * 3)
    # box (tri-planar) projection: steep banks get their own projection instead of a vertical smear
    C = nb.tex(img('t04-silt-mud_seamless.png'), co, proj='BOX', blend=0.35).outputs[0]
    H = nb.tex(img('t04-silt-mud_height.png', True), co, 'Cubic', proj='BOX', blend=0.35).outputs[0]
    co2 = nb.vmath('MULTIPLY', nb.vmath('ADD', pos, (13.1, 7.7, 0)), (1 / (tile * 2.7),) * 3)
    C2 = nb.tex(img('t04-silt-mud_seamless.png'), co2, proj='BOX', blend=0.35).outputs[0]
    nbig = nb.noise(pos, 0.35, 4, 0.6).outputs[0]
    col = nb.mixc(nb.ramp(nbig, 0.4, 0.6), C, C2)
    col = nb.mixc(1.0, col, (dark, dark * 0.95, dark * 0.85, 1), 'MULTIPLY')
    col = nb.mixc(mud, col, nb.mixc(nb.noise(pos, 0.8, 4).outputs[0], (0.022, 0.018, 0.013, 1), (0.045, 0.036, 0.025, 1)))
    z = world_z(nb)
    wet = nb.ramp(nb.math('SUBTRACT', wet_line, z), -0.25, 0.1)
    wet = nb.math('MAXIMUM', wet, nb.ramp(nb.noise(pos, 1.2, 3).outputs[0], 0.5, 0.62))
    pud = nb.math('MAXIMUM', nb.ramp(nb.math('SUBTRACT', 1.0, H), 0.6, 0.68), nb.ramp(nb.noise(pos, 0.7, 3).outputs[0], 0.6, 0.66))
    col = nb.mixc(nb.math('MULTIPLY', wet, 0.45), col, nb.mixc(1.0, col, col, 'MULTIPLY'))
    rough = nb.mixf(wet, 0.7, 0.2)
    rough = nb.mixf(nb.math('MULTIPLY', pud, wet), rough, 0.02)
    col = nb.mixc(nb.math('MULTIPLY', nb.math('MULTIPLY', pud, wet), 0.6), col, nb.mixc(1.0, col, (0.3, 0.3, 0.28, 1), 'MULTIPLY'))
    weedm = nb.ramp(nb.noise(pos, 1.1, 5, 0.7).outputs[0], 0.62, 0.7)
    col = nb.mixc(nb.math('MULTIPLY', weedm, 0.8), col, (0.02, 0.028, 0.01, 1))
    bsdf = nb.principled(**{'Base Color': col, 'Roughness': rough, 'Coat Weight': nb.math('MULTIPLY', wet, 0.4), 'Coat Roughness': 0.05})
    h = nb.math('MULTIPLY', nb.math('SUBTRACT', H, 0.5), disp)
    h = nb.math('ADD', h, nb.math('MULTIPLY', nb.math('SUBTRACT', nbig, 0.5), disp * 0.6))
    h = nb.math('MAXIMUM', h, nb.math('SUBTRACT', nb.math('MULTIPLY', nb.math('MULTIPLY', pud, wet), disp * 0.5), disp * 0.5))
    h = nb.math('ADD', h, nb.math('MULTIPLY', nb.math('SUBTRACT', nb.noise(pos, 0.9, 3, 0.4).outputs[0], 0.5), swell))
    d = nb.node('ShaderNodeDisplacement', {'Height': h, 'Midlevel': 0.0, 'Scale': 1.0}, space='OBJECT')
    nb.out(bsdf.outputs[0], d.outputs[0])
    return m

# ------------------------------------------------------------------ water
def water(name, scum=0.35):
    m = new_mat(name)
    nb = NB(m)
    pos = nb.geo().outputs['Position']
    r1 = nb.noise(nb.vmath('MULTIPLY', pos, (1, 0.35, 1)), 3.0, 3, 0.5).outputs[0]
    r2 = nb.noise(pos, 22.0, 2, 0.5).outputs[0]
    h = nb.math('ADD', nb.math('MULTIPLY', r1, 1.0), nb.math('MULTIPLY', r2, 0.25))
    bump = nb.bump(h, 0.12, 0.02)
    sc = nb.noise(nb.vmath('MULTIPLY', pos, (0.6, 1.6, 1)), 0.9, 6, 0.7, 1.5).outputs[0]
    scm = nb.ramp(sc, 0.62 - scum * 0.2, 0.7 - scum * 0.2)
    fine = nb.noise(pos, 40, 3).outputs[0]
    scum_col = nb.mixc(fine, (0.05, 0.045, 0.03, 1), (0.11, 0.1, 0.07, 1))
    w = nb.principled(**{'Base Color': (0.012, 0.013, 0.009, 1), 'Roughness': 0.03, 'IOR': 1.33, 'Specular IOR Level': 0.5,
                         'Normal': bump})
    s = nb.principled(**{'Base Color': scum_col, 'Roughness': 0.55, 'Normal': nb.bump(fine, 0.4, 0.004)})
    mix = nb.node('ShaderNodeMixShader')
    nb._set(mix, 0, scm)
    nb.nt.links.new(w.outputs[0], mix.inputs[1])
    nb.nt.links.new(s.outputs[0], mix.inputs[2])
    # a little murky volume under the surface
    vol = nb.node('ShaderNodeVolumeAbsorption', {'Color': (0.25, 0.22, 0.12, 1), 'Density': 3.0})
    nb.out(mix.outputs[0])
    return m

def water_film(name):
    """Thin flowing water (dribbles): glassy, slightly brown."""
    m = new_mat(name)
    nb = NB(m)
    g = nb.principled(**{'Base Color': (0.8, 0.75, 0.6, 1), 'Roughness': 0.02, 'Transmission Weight': 1.0, 'IOR': 1.33})
    nb.out(g.outputs[0])
    return m

# ------------------------------------------------------------------ small organic and misc materials
def simple(name, col, rough=0.6, metal=0.0, sss=0.0, noise_scale=0.0, noise_amt=0.0, coat=0.0, bump=0.0, emission=None, estr=0.0, shadow_through=0.0):
    m = new_mat(name)
    nb = NB(m)
    pos = nb.texco().outputs['Object']
    c = col
    nrm = None
    if noise_scale > 0:
        n = nb.noise(pos, noise_scale, 5, 0.6).outputs[0]
        c = nb.mixc(nb.math('MULTIPLY', n, noise_amt), col, (col[0] * 0.4, col[1] * 0.4, col[2] * 0.4, 1))
        if bump > 0:
            nrm = nb.bump(n, bump, 0.003)
    ins = {'Base Color': c, 'Roughness': rough, 'Metallic': metal, 'Coat Weight': coat}
    if sss > 0:
        ins['Subsurface Weight'] = sss
        ins['Subsurface Radius'] = (0.02, 0.01, 0.005)
    if nrm is not None:
        ins['Normal'] = nrm
    if emission is not None:
        ins['Emission Color'] = emission
        ins['Emission Strength'] = estr
    b = nb.principled(**ins)
    nb.out(shadow_pass(nb, b.outputs[0], shadow_through) if shadow_through > 0 else b.outputs[0])
    return m

def lime_crust(name):
    m = new_mat(name)
    nb = NB(m)
    pos = nb.texco().outputs['Object']
    n = nb.noise(pos, 80, 4).outputs[0]
    c = nb.mixc(n, (0.17, 0.155, 0.12, 1), (0.32, 0.29, 0.22, 1))
    b = nb.principled(**{'Base Color': c, 'Roughness': 0.25, 'Subsurface Weight': 0.6, 'Subsurface Radius': (0.01, 0.008, 0.005),
                         'Coat Weight': 0.6, 'Coat Roughness': 0.05, 'Normal': nb.bump(n, 0.3, 0.001)})
    nb.out(b.outputs[0])
    return m

def burlap(name, dark=0.5):
    m = new_mat(name)
    nb = NB(m)
    uv = nb.texco().outputs['Object']
    w = nb.node('ShaderNodeTexWave', wave_type='BANDS', bands_direction='X')
    nb._set(w, 'Vector', uv); nb._set(w, 'Scale', 120); nb._set(w, 'Distortion', 2)
    w2 = nb.node('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Z')
    nb._set(w2, 'Vector', uv); nb._set(w2, 'Scale', 120); nb._set(w2, 'Distortion', 2)
    weave = nb.math('MULTIPLY', w.outputs[0], w2.outputs[0])
    n = nb.noise(uv, 3, 5).outputs[0]
    c = nb.mixc(n, (0.2 * dark, 0.15 * dark, 0.09 * dark, 1), (0.36 * dark, 0.28 * dark, 0.17 * dark, 1))
    stain = nb.ramp(nb.noise(uv, 1.5, 4).outputs[0], 0.45, 0.65)
    c = nb.mixc(nb.math('MULTIPLY', stain, 0.8), c, (0.07, 0.015, 0.01, 1))
    b = nb.principled(**{'Base Color': c, 'Roughness': nb.mixf(stain, 0.9, 0.35), 'Normal': nb.bump(weave, 0.4, 0.002)})
    nb.out(b.outputs[0])
    return m

def shadow_pass(nb, shader_out, amount=1.0):
    """Let shadow rays through (lamp glass, flame, gauze), so the light inside a lamp reaches the room."""
    lp = nb.node('ShaderNodeLightPath')
    tr = nb.node('ShaderNodeBsdfTransparent')
    mix = nb.node('ShaderNodeMixShader')
    nb._set(mix, 0, nb.math('MULTIPLY', lp.outputs['Is Shadow Ray'], amount))
    nb.nt.links.new(shader_out, mix.inputs[1])
    nb.nt.links.new(tr.outputs[0], mix.inputs[2])
    return mix.outputs[0]

def glass_lamp(name):
    m = new_mat(name)
    nb = NB(m)
    g = nb.principled(**{'Base Color': (0.9, 0.85, 0.7, 1), 'Roughness': 0.15, 'Transmission Weight': 1.0, 'IOR': 1.5})
    nb.out(shadow_pass(nb, g.outputs[0], 0.92))
    return m

def flame(name, strength=40.0, color=(1.0, 0.55, 0.18, 1)):
    m = new_mat(name)
    nb = NB(m)
    e = nb.node('ShaderNodeEmission', {'Color': color, 'Strength': strength})
    nb.out(shadow_pass(nb, e.outputs[0], 1.0))
    return m

def fog(name, density=0.06, top=-3.2, floor_y=spec.WATER_Y, base=0.0055, color=(0.6, 0.62, 0.6, 1)):
    m = new_mat(name)
    nb = NB(m)
    pos = nb.geo().outputs['Position']
    z = world_z(nb)
    layer = nb.ramp(nb.math('SUBTRACT', top, z), 0.0, top - floor_y)
    n = nb.noise(nb.vmath('MULTIPLY', pos, (0.6, 0.6, 1.5)), 0.7, 4, 0.6, 0.6).outputs[0]
    dens = nb.math('MULTIPLY', layer, nb.maprange(n, 0.35, 0.7, 0.2, 1.5))
    dens = nb.math('ADD', nb.math('MULTIPLY', dens, density), base)
    v = nb.node('ShaderNodeVolumePrincipled', {'Color': color, 'Density': dens, 'Anisotropy': 0.3})
    nb.out(vol=v.outputs[0])
    return m

def paving(name):
    m = new_mat(name)
    m.displacement_method = 'BOTH'
    nb = NB(m)
    pos = nb.geo().outputs['Position']
    co = nb.vmath('MULTIPLY', pos, (1 / 3.2,) * 3)
    C = nb.tex(img('t03-bluestone_seamless.png'), co).outputs[0]
    H = nb.tex(img('t03-bluestone_height.png', True), co, 'Cubic').outputs[0]
    n = nb.noise(pos, 0.5, 4).outputs[0]
    wet = nb.ramp(n, 0.45, 0.6)
    col = nb.mixc(1.0, C, (0.5, 0.5, 0.52, 1), 'MULTIPLY')
    col = nb.mixc(nb.math('MULTIPLY', wet, 0.4), col, nb.mixc(1.0, col, col, 'MULTIPLY'))
    b = nb.principled(**{'Base Color': col, 'Roughness': nb.mixf(wet, 0.65, 0.15)})
    d = nb.node('ShaderNodeDisplacement', {'Height': nb.math('MULTIPLY', nb.math('SUBTRACT', H, 0.6), 0.012), 'Midlevel': 0.0, 'Scale': 1.0}, space='OBJECT')
    nb.out(b.outputs[0], d.outputs[0])
    return m


# ================================================================== round 2 materials
def water_vol(name, scum=0.35, absorb=(0.42, 0.36, 0.16, 1), absorb_d=5.0, scatter=(0.3, 0.28, 0.14, 1), scatter_d=0.25):
    """Murky water on a closed volume: a transmissive surface with broad slow ripples and fine stir,
    scum and grease patches, brown-green absorption and silty scatter below. Shadow rays pass the
    surface (no caustics) so the murk under a lamp glows faintly."""
    m = new_mat(name)
    nb = NB(m)
    pos = nb.geo().outputs['Position']
    broad = nb.noise(pos, 2.2, 2, 0.45).outputs[0]
    stir = nb.noise(pos, 9.0, 3, 0.5).outputs[0]
    fine = nb.noise(pos, 38.0, 2, 0.5).outputs[0]
    h = nb.math('ADD', nb.math('ADD', nb.math('MULTIPLY', broad, 0.35), nb.math('MULTIPLY', stir, 0.12)), nb.math('MULTIPLY', fine, 0.025))
    bump = nb.bump(h, 0.06, 0.008)
    sc = nb.noise(pos, 1.4, 5, 0.6, 0.0).outputs[0]
    scm = nb.math('MULTIPLY', nb.ramp(sc, 0.66 - scum * 0.1, 0.72 - scum * 0.1), 0.85)
    grease = nb.math('MULTIPLY', nb.ramp(nb.noise(pos, 3.0, 3, 0.5, 0.0).outputs[0], 0.6, 0.66), 0.0)
    fine2 = nb.noise(pos, 40, 3).outputs[0]
    scum_col = nb.mixc(fine2, (0.018, 0.017, 0.011, 1), (0.04, 0.036, 0.024, 1))
    # surface: Fresnel mix of a glossy reflection and straight-through transparency (no refraction).
    # Refraction of the uneven silt at grazing angles caused the stretched smears seen in rounds 2 and 3.
    gl = nb.node('ShaderNodeBsdfGlossy', {'Color': (0.75, 0.74, 0.7, 1), 'Roughness': 0.2})
    nb._set(gl, 'Normal', bump)
    tr = nb.node('ShaderNodeBsdfTransparent', {'Color': (1, 1, 1, 1)})
    fr = nb.node('ShaderNodeFresnel', {'IOR': 1.33})
    nb._set(fr, 'Normal', bump)
    wmix = nb.node('ShaderNodeMixShader')
    nb.nt.links.new(fr.outputs[0], wmix.inputs[0])
    nb.nt.links.new(tr.outputs[0], wmix.inputs[1])
    nb.nt.links.new(gl.outputs[0], wmix.inputs[2])
    class _W: pass
    w = _W(); w.outputs = [wmix.outputs[0]]
    s_ = nb.principled(**{'Base Color': scum_col, 'Roughness': 0.6, 'Normal': nb.bump(fine2, 0.4, 0.004)})
    mix = nb.node('ShaderNodeMixShader')
    nb._set(mix, 0, scm)
    nb.nt.links.new(w.outputs[0], mix.inputs[1])
    nb.nt.links.new(s_.outputs[0], mix.inputs[2])
    surf = shadow_pass(nb, mix.outputs[0], 1.0)
    va = nb.node('ShaderNodeVolumeAbsorption', {'Color': absorb, 'Density': absorb_d})
    vs = nb.node('ShaderNodeVolumeScatter', {'Color': scatter, 'Density': scatter_d, 'Anisotropy': 0.2})
    add = nb.node('ShaderNodeAddShader')
    nb.nt.links.new(va.outputs[0], add.inputs[0])
    nb.nt.links.new(vs.outputs[0], add.inputs[1])
    nb.out(surf, vol=add.outputs[0])
    return m

def drip_ring(name):
    """Expanding rings where drips land: a glossy ripple patch that fades out to transparent."""
    m = new_mat(name)
    nb = NB(m)
    co = nb.texco().outputs['Object']
    r = nb.vmath('LENGTH', co)
    rr = nb.node('ShaderNodeVectorMath', operation='LENGTH')
    nb._set(rr, 0, co)
    dist = rr.outputs['Value']
    ring = nb.math('SINE', nb.math('MULTIPLY', dist, 90.0))
    ring = nb.math('MULTIPLY', ring, nb.ramp(nb.math('SUBTRACT', 0.2, dist), 0.0, 0.12))
    bump = nb.bump(ring, 0.6, 0.004)
    g = nb.principled(**{'Base Color': (0.02, 0.02, 0.015, 1), 'Roughness': 0.12, 'Normal': bump, 'IOR': 1.33, 'Specular IOR Level': 0.3})
    tr = nb.node('ShaderNodeBsdfTransparent')
    mix = nb.node('ShaderNodeMixShader')
    nb._set(mix, 0, nb.ramp(nb.math('SUBTRACT', 0.21, dist), 0.0, 0.06))
    nb.nt.links.new(tr.outputs[0], mix.inputs[1])
    nb.nt.links.new(g.outputs[0], mix.inputs[2])
    nb.out(shadow_pass(nb, mix.outputs[0], 1.0))
    return m

def fog_rot(name, peak=0.1, layer=0.6, base_in=0.0005, base_out=0.004):
    """Rot mist lying on the water (warmer than the air): a 0.3 to 0.8 m layer, drifting noise,
    thick in the hall and still corners, thin over the flowing gallery and the open vliet; clear air above."""
    W = spec.WATER_Y
    m = new_mat(name)
    nb = NB(m)
    pos = nb.geo().outputs['Position']
    sx = nb.sepxyz(pos)
    z = sx[2]
    above = nb.math('SUBTRACT', z, W)
    lay = nb.ramp(nb.math('SUBTRACT', layer, above), 0.0, layer * 0.85)
    lay = nb.math('MULTIPLY', lay, nb.ramp(above, -0.05, 0.05))
    drift = nb.noise(nb.vmath('MULTIPLY', pos, (0.7, 0.35, 2.2)), 0.8, 4, 0.65, 1.4).outputs[0]
    curl = nb.noise(pos, 3.0, 3, 0.6, 0.8).outputs[0]
    patch = nb.math('MULTIPLY', nb.maprange(drift, 0.3, 0.7, 0.15, 1.6), nb.maprange(curl, 0.3, 0.7, 0.6, 1.25))
    # regions: hall (still) 1.0, gallery (flowing) 0.55, open vliet 0.3
    in_hall = nb.math('MULTIPLY', nb.math('MULTIPLY', nb.math('GREATER_THAN', sx[0], spec.HALL_X0 - 1.2), nb.math('LESS_THAN', sx[0], spec.HALL_X1 + 1.2)),
                      nb.math('MULTIPLY', nb.math('GREATER_THAN', sx[1], -spec.HALL_Z1 - 1.2), nb.math('LESS_THAN', sx[1], -spec.HALL_Z0 + 0.5)))
    outside = nb.math('GREATER_THAN', sx[1], -spec.VLIET_Z1)
    reg = nb.mixf(in_hall, 0.55, 1.0)
    reg = nb.mixf(outside, reg, 0.3)
    mist = nb.math('MULTIPLY', nb.math('MULTIPLY', lay, patch), nb.math('MULTIPLY', reg, peak))
    base = nb.mixf(outside, base_in, base_out)
    dens = nb.math('ADD', mist, base)
    v = nb.node('ShaderNodeVolumePrincipled', {'Color': (0.36, 0.37, 0.35, 1), 'Density': dens, 'Anisotropy': 0.6})
    nb.out(vol=v.outputs[0])
    return m

def fog_beam(name, density=0.12):
    """Dust and mist in a light shaft, broken up so the beam does not read as a solid column."""
    m = new_mat(name)
    nb = NB(m)
    pos = nb.geo().outputs['Position']
    n1 = nb.noise(nb.vmath('MULTIPLY', pos, (1.0, 1.0, 0.35)), 2.0, 4, 0.6, 1.6).outputs[0]
    n2 = nb.noise(pos, 9.0, 2, 0.5).outputs[0]
    d = nb.math('MULTIPLY', nb.maprange(n1, 0.3, 0.7, 0.05, 1.8), nb.maprange(n2, 0.3, 0.7, 0.6, 1.3))
    v = nb.node('ShaderNodeVolumePrincipled', {'Color': (0.7, 0.72, 0.72, 1), 'Density': nb.math('MULTIPLY', d, density), 'Anisotropy': 0.4})
    nb.out(vol=v.outputs[0])
    return m


def calcite(name):
    """Flowstone after Steve's photo: matte and rough with fine vertical striations, yellow-grey to ochre,
    darker brown wet bands running down, satin only where water runs, thin translucent young edges.
    Relief from t09 in the sheet UVs (flutes run down) plus striations, faded at the outline by wxF."""
    m = new_mat(name)
    m.displacement_method = 'BOTH'
    nb = NB(m)
    uvn = nb.node('ShaderNodeUVMap', uv_map='UVMap').outputs[0]
    oi = nb.objinfo()
    uv = nb.vmath('ADD', nb.vmath('MULTIPLY', uvn, (1 / 1.8, 1 / 2.6, 1)), nb.vmath('MULTIPLY', oi.outputs['Random'], (3.3, 7.1, 0)))
    C = nb.tex(img('t09-flowstone_seamless.png'), uv).outputs[0]
    Hh = nb.tex(img('t09-flowstone_height.png', True), uv, 'Cubic').outputs[0]
    Fm = nb.sep(nb.attr('wxF').outputs['Color'])[0]
    stri = nb.noise(nb.vmath('MULTIPLY', uvn, (60.0, 1.2, 1)), 1.0, 5, 0.6).outputs[0]
    fib = nb.noise(nb.vmath('MULTIPLY', uvn, (220.0, 5.0, 1)), 1.0, 3, 0.5).outputs[0]
    L = nb.sepxyz(C)
    grey = nb.math('ADD', nb.math('MULTIPLY', L[0], 0.3), nb.math('ADD', nb.math('MULTIPLY', L[1], 0.55), nb.math('MULTIPLY', L[2], 0.15)))
    gv = nb.math('ADD', 0.55, grey)
    tintn = nb.noise(nb.vmath('MULTIPLY', uvn, (2.0, 0.6, 1)), 1.0, 3).outputs[0]
    base = nb.mixc(tintn, (0.26, 0.24, 0.17, 1), (0.34, 0.27, 0.13, 1))
    c = nb.mixc(1.0, base, nb.comb(gv, gv, gv), 'MULTIPLY')
    c = nb.mixc(nb.math('MULTIPLY', nb.math('MAXIMUM', nb.math('SUBTRACT', stri, 0.45), 0.0), 1.4), c, (0.1, 0.085, 0.06, 1))
    band = nb.ramp(nb.noise(nb.vmath('MULTIPLY', uvn, (9.0, 0.3, 1)), 1.0, 4, 0.6).outputs[0], 0.48, 0.62)
    c = nb.mixc(nb.math('MULTIPLY', band, 0.85), c, (0.06, 0.045, 0.028, 1))
    stain = nb.ramp(nb.noise(nb.vmath('MULTIPLY', uvn, (5.0, 0.7, 1)), 1.3, 3).outputs[0], 0.58, 0.72)
    c = nb.mixc(nb.math('MULTIPLY', stain, 0.5), c, (0.22, 0.12, 0.05, 1))
    z = world_z(nb)
    c = nb.mixc(nb.math('MULTIPLY', nb.ramp(nb.math('SUBTRACT', -3.8, z), 0.0, 0.5), 0.8), c, (0.04, 0.045, 0.025, 1))
    rough = nb.mixf(band, 0.78, 0.4)
    b = nb.principled(**{'Base Color': c, 'Roughness': rough, 'Subsurface Weight': 0.3, 'Subsurface Radius': (0.02, 0.016, 0.01),
                         'Coat Weight': nb.math('MULTIPLY', band, 0.35), 'Coat Roughness': 0.2,
                         'Normal': nb.bump(nb.math('ADD', nb.math('MULTIPLY', stri, 0.6), nb.math('MULTIPLY', fib, 0.25)), 0.35, 0.002)})
    tr = nb.node('ShaderNodeBsdfTranslucent', {'Color': (0.5, 0.42, 0.3, 1)})
    mix = nb.node('ShaderNodeMixShader')
    nb._set(mix, 0, nb.math('MULTIPLY', nb.math('SUBTRACT', 1.0, nb.ramp(Fm, 0.0, 0.3)), 0.45))
    nb.nt.links.new(b.outputs[0], mix.inputs[1])
    nb.nt.links.new(tr.outputs[0], mix.inputs[2])
    hgt = nb.math('ADD', nb.math('MULTIPLY', nb.math('SUBTRACT', Hh, 0.45), 0.006), nb.math('MULTIPLY', nb.math('SUBTRACT', stri, 0.5), 0.004))
    hgt = nb.math('MULTIPLY', hgt, Fm)
    d = nb.node('ShaderNodeDisplacement', {'Height': hgt, 'Midlevel': 0.0, 'Scale': 1.0}, space='OBJECT')
    nb.out(mix.outputs[0], d.outputs[0])
    return m
