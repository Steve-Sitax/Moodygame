# More materials and the full material set used by the build.
import spec
from .mats import NB, new_mat, img, world_z, calcite, masonry, daylight_factor, runoff_mat, bluestone, iron, oak, wood_debris, silt, water, water_film, water_vol, drip_ring, \
    simple, lime_crust, burlap, glass_lamp, flame, paving

def brick_loose(name):
    """Loose and ring bricks: one colour per brick from a palette, fine grain from the Codex brick."""
    m = new_mat(name)
    m.displacement_method = 'BUMP'
    nb = NB(m)
    oi = nb.objinfo()
    tc = nb.texco()
    ramp = nb.node('ShaderNodeValToRGB')
    nb._set(ramp, 'Fac', oi.outputs['Random'])
    els = ramp.color_ramp.elements
    els[0].position = 0.0
    els[0].color = (0.16, 0.06, 0.035, 1)
    els[1].position = 1.0
    els[1].color = (0.05, 0.035, 0.03, 1)
    for pos, col in ((0.2, (0.2, 0.085, 0.045, 1)), (0.4, (0.11, 0.05, 0.035, 1)), (0.6, (0.24, 0.12, 0.06, 1)), (0.8, (0.08, 0.045, 0.04, 1))):
        e = els.new(pos)
        e.color = col
    ramp.color_ramp.interpolation = 'CONSTANT'
    co = nb.vmath('MULTIPLY', nb.vmath('ADD', tc.outputs['Object'], nb.vmath('MULTIPLY', oi.outputs['Random'], (5.1, 2.3, 7.7))), (1.6, 1.6, 1.6))
    D = nb.tex(img('t01-brick-old_seamless.png'), co, proj='BOX', blend=0.3).outputs[0]
    Dl = nb.math('MULTIPLY', nb.sepxyz(D)[0], 2.2)
    col = nb.mixc(1.0, ramp.outputs[0], nb.comb(Dl, Dl, Dl), 'MULTIPLY')
    H = nb.tex(img('t01-brick-old_height.png', True), co, proj='BOX', blend=0.3).outputs[0]
    z = world_z(nb)
    wet = nb.ramp(nb.math('SUBTRACT', spec.LEDGE_Y + 0.4, z), 0.0, 0.6)
    col = nb.mixc(nb.math('MULTIPLY', wet, 0.4), col, nb.mixc(1.0, col, col, 'MULTIPLY'))
    b = nb.principled(**{'Base Color': col, 'Roughness': nb.mixf(wet, 0.82, 0.35), 'Normal': nb.bump(H, 0.5, 0.003)})
    nb.out(b.outputs[0])
    return m

def skin_wet(name, col=(0.11, 0.115, 0.1, 1)):
    m = new_mat(name)
    nb = NB(m)
    pos = nb.texco().outputs['Object']
    n = nb.noise(pos, 6, 5, 0.6).outputs[0]
    n2 = nb.noise(pos, 40, 3).outputs[0]
    c = nb.mixc(n, col, (col[0] * 0.5, col[1] * 0.55, col[2] * 0.45, 1))
    b = nb.principled(**{'Base Color': c, 'Roughness': 0.35, 'Subsurface Weight': 0.15, 'Subsurface Radius': (0.05, 0.03, 0.02),
                         'Coat Weight': 0.4, 'Coat Roughness': 0.2, 'Normal': nb.bump(nb.math('ADD', n, nb.math('MULTIPLY', n2, 0.3)), 0.5, 0.01)})
    nb.out(b.outputs[0])
    return m

def weed(name):
    m = new_mat(name)
    nb = NB(m)
    pos = nb.texco().outputs['Object']
    n = nb.noise(pos, 20, 3).outputs[0]
    c = nb.mixc(n, (0.014, 0.02, 0.007, 1), (0.035, 0.04, 0.014, 1))
    b = nb.principled(**{'Base Color': c, 'Roughness': 0.3, 'Subsurface Weight': 0.3, 'Subsurface Radius': (0.01, 0.02, 0.005),
                         'Coat Weight': 0.5, 'Coat Roughness': 0.1})
    nb.out(b.outputs[0])
    return m

def moss_cushion(name):
    """Low dark-green fuzzy moss cushions: dark albedo, green sheen fuzz, fine fibre bump, no gloss."""
    m = new_mat(name)
    nb = NB(m)
    wp = nb.geo().outputs['Position']
    n1 = nb.noise(wp, 18, 4, 0.6).outputs[0]
    fz = nb.noise(wp, 900, 2, 0.5).outputs[0]
    c = nb.mixc(n1, (0.008, 0.016, 0.004, 1), (0.024, 0.042, 0.009, 1))
    c = nb.mixc(nb.math('MULTIPLY', nb.ramp(n1, 0.6, 0.75), 0.6), c, (0.03, 0.022, 0.01, 1))
    b = nb.principled(**{'Base Color': c, 'Roughness': 0.95, 'Specular IOR Level': 0.2, 'Sheen Weight': 0.5, 'Sheen Roughness': 0.3,
                         'Sheen Tint': (0.25, 0.45, 0.12, 1), 'Normal': nb.bump(nb.math('ADD', fz, nb.math('MULTIPLY', n1, 0.3)), 1.0, 0.003)})
    nb.out(b.outputs[0])
    return m

def barrel_oak(name):
    """Matte rough wet oak with slime low down: the drift barrels."""
    m = new_mat(name)
    nb = NB(m)
    tc = nb.texco(); oi = nb.objinfo()
    co = nb.vmath('ADD', tc.outputs['Object'], nb.vmath('MULTIPLY', oi.outputs['Random'], (1.9, 0.0, 4.4)))
    sx = nb.sepxyz(co)
    uv = nb.comb(nb.math('MULTIPLY', nb.math('ADD', sx[0], sx[1]), 1.0 / (spec.OAK_PLANK_W * spec.OAK_ATLAS_COLS)), nb.math('MULTIPLY', sx[2], 1.0 / spec.OAK_ATLAS_H_M * 3), 0)
    C = nb.tex(img('gen/oak_atlas.png'), uv).outputs[0]
    H = nb.tex(img('gen/oak_atlas_height.png', True), uv).outputs[0]
    col = nb.mixc(1.0, C, (0.24, 0.2, 0.15, 1), 'MULTIPLY')
    wp = nb.geo().outputs['Position']
    z = world_z(nb)
    slime = nb.math('MULTIPLY', nb.ramp(nb.math('SUBTRACT', spec.WATER_Y + 0.2, z), -0.05, 0.25), nb.ramp(nb.noise(wp, 5, 4).outputs[0], 0.35, 0.55))
    col = nb.mixc(slime, col, (0.015, 0.02, 0.009, 1))
    rot = nb.ramp(nb.noise(wp, 12, 5, 0.7).outputs[0], 0.55, 0.7)
    col = nb.mixc(nb.math('MULTIPLY', rot, 0.6), col, (0.02, 0.016, 0.012, 1))
    b = nb.principled(**{'Base Color': col, 'Roughness': nb.mixf(slime, 0.82, 0.45), 'Specular IOR Level': 0.3,
                         'Normal': nb.bump(nb.math('ADD', H, nb.math('MULTIPLY', rot, 0.5)), 1.0, 0.004)})
    nb.out(b.outputs[0])
    return m

def make_all():
    W = spec.WATER_Y
    return dict(
        brick_vault=masonry('Brick_gallery_vault', wet_base=0.1, bond='stretcher', flecks=0.55),
        brick_ledge=masonry('Brick_ledge_paving', wet_base=0.4, bond='stretcher'),
        brick_channel=masonry('Brick_channel', wet_base=0.4, bond='flemish'),
        brick_quay=masonry('Brick_quay', wet_base=0.08, tint=(0.95, 0.97, 1.0), bond='flemish', tide_y=spec.HIGH_WATER_Y, daylight=1.0),
        brick_hallvault=masonry('Brick_hall_vault', wet_base=0.1, bond='stretcher', flecks=0.7),
        brick_hallwall=masonry('Brick_hall_wall', wet_base=0.12, bond='flemish'),
        brick_rib=masonry('Brick_rib_headers', wet_base=0.1, bond='header', flecks=0.5),
        brick_rib_soffit=masonry('Brick_rib_soffit', wet_base=0.1, bond='header', flecks=0.5, stone='rib_soffit'),
        brick_rib_side=masonry('Brick_rib_side', wet_base=0.1, bond='header', flecks=0.5, stone='rib_side'),
        brick_pier=masonry('Brick_pier', wet_base=0.12, bond='flemish', stone='pier'),
        calcite=calcite('Calcite_flowstone'),
        lime_runnel=runoff_mat('Runoff_lime', 'lime'),
        wet_trail=runoff_mat('Runoff_wet', 'wet'),
        iron_trail=runoff_mat('Runoff_iron', 'iron'),
        lime_splash=runoff_mat('Runoff_splash', 'splash'),
        brick_loose=brick_loose('Brick_loose'),
        bluestone=bluestone('Bluestone', wet_line=W, slime_top=-3.82),
        bluestone_quoin=bluestone('Bluestone_quoin', wet_line=W, slime_top=-3.75, darken=0.36),
        bluestone_wet=bluestone('Bluestone_wet', wet_line=W, slime_top=W + 0.35),
        bluestone_tidal=bluestone('Bluestone_tidal', wet_line=W, slime_top=spec.HIGH_WATER_Y, darken=0.34),
        bluestone_dry=bluestone('Bluestone_street', wet_line=-3.0, slime_top=-3.0, darken=0.6),
        bluestone_step=bluestone('Bluestone_step', wet_line=W, slime_top=-3.3, darken=0.3),
        iron=iron('Iron_cast', rust=0.55, wet_line=W + 0.2),
        iron_wet=iron('Iron_wet', rust=0.75, cast=False, wet_line=spec.HIGH_WATER_Y),
        brass=simple('Brass_lamp', (0.32, 0.22, 0.09, 1), rough=0.35, metal=1.0, noise_scale=40, noise_amt=0.6),
        gauze=simple('Lamp_gauze', (0.05, 0.045, 0.04, 1), rough=0.6, metal=0.8, shadow_through=0.65),
        glass=glass_lamp('Lamp_glass'),
        flame=flame('Lamp_flame', strength=60.0),
        soot_black=simple('Soot_black', (0.008, 0.007, 0.006, 1), rough=0.9),
        oak=oak('Oak_tide_door', slime_line=-3.35),
        wood=wood_debris('Wood_debris'),
        silt=silt('Silt', dark=0.5, wet_line=W + 0.5, mud=0.4, tile=4.0),
        silt_vliet=silt('Silt_vliet', wet_line=W + 1.6, disp=0.006, dark=0.3, mud=1.0, tile=6.0, swell=0.06),
        water=water_vol('Water_sewer'),
        water_river=water_vol('Water_river', scum=0.12, absorb=(0.5, 0.45, 0.25, 1), absorb_d=4.0, scatter_d=0.2),
        water_ring=drip_ring('Water_drip_ring'),
        wood_wet=barrel_oak('Wood_wet_oak'),
        iron_rust=iron('Iron_rust', rust=1.0, cast=False, wet_line=W + 0.3),
        wicker=simple('Wicker', (0.11, 0.08, 0.045, 1), rough=0.75, noise_scale=40, noise_amt=0.6, bump=0.4),
        fur=simple('Rat_fur', (0.045, 0.04, 0.034, 1), rough=0.6, noise_scale=80, noise_amt=0.5, coat=0.5, bump=0.3),
        skin_pale=simple('Rat_skin', (0.24, 0.16, 0.14, 1), rough=0.4, sss=0.2),
        cork=simple('Cork', (0.26, 0.18, 0.1, 1), rough=0.8, noise_scale=90, noise_amt=0.5),
        glass_green=simple('Glass_bottle', (0.03, 0.06, 0.03, 1), rough=0.1, coat=0.8),
        rope=burlap('Rope_hemp', dark=0.7),
        moss=moss_cushion('Moss_t10'),
        straw=simple('Straw_wet', (0.22, 0.17, 0.08, 1), rough=0.5, noise_scale=30, noise_amt=0.5),
        water_film=water_film('Water_film'),
        lime=lime_crust('Lime_straw'),
        bone=simple('Bone', (0.3, 0.25, 0.17, 1), rough=0.45, noise_scale=30, noise_amt=0.9, bump=0.5, sss=0.1, coat=0.3),
        offal=simple('Offal', (0.12, 0.02, 0.02, 1), rough=0.2, noise_scale=12, noise_amt=0.8, bump=0.4, coat=0.6, sss=0.3),
        sack=burlap('Sacking', dark=0.3),
        weed=weed('Weed_slime'),
        paving=paving('Paving_setts'),
        cloth=simple('Cloth_dark', (0.03, 0.028, 0.025, 1), rough=0.85, noise_scale=50, noise_amt=0.3),
        coat=simple('Coat_oilcloth', (0.06, 0.05, 0.03, 1), rough=0.35, noise_scale=15, noise_amt=0.4, coat=0.3, bump=0.2),
        skin=simple('Skin', (0.35, 0.22, 0.17, 1), rough=0.5, sss=0.2),
        giant=skin_wet('Giant_skin'),
        glass_dark=simple('Glass_dark', (0.01, 0.012, 0.014, 1), rough=0.08, coat=0.5),
        house=simple('House_dark', (0.04, 0.035, 0.032, 1), rough=0.8, noise_scale=3, noise_amt=0.5),
        window=simple('Window_lit', (0.02, 0.012, 0.005, 1), rough=0.3, emission=(1.0, 0.5, 0.18, 1), estr=1.6, shadow_through=1.0, noise_scale=6, noise_amt=0.9),
    )
