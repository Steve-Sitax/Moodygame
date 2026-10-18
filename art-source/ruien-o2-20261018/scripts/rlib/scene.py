# World, mood and check lighting, fog, cameras and render settings.
import numpy as np
import bpy
from mathutils import Vector
import spec
from . import util as U
from . import mats as M

def world(name='Ruien_world'):
    w = bpy.data.worlds.get(name) or bpy.data.worlds.new(name)
    bpy.context.scene.world = w
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = -0.1; mr.inputs['From Max'].default_value = 0.6
    nt.links.new(sep.outputs[2], mr.inputs['Value'])
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    nt.links.new(mr.outputs[0], mix.inputs[0])
    mix.inputs[6].default_value = (0.42, 0.33, 0.28, 1)   # horizon haze, dusk
    mix.inputs[7].default_value = (0.07, 0.085, 0.13, 1)   # zenith
    bg = nt.nodes.new('ShaderNodeBackground')
    nt.links.new(mix.outputs[2], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.0
    bg.name = 'SkyBG'
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(bg.outputs[0], out.inputs['Surface'])
    return w

def light(name, kind, loc_g, coll_, energy, color=(1, 1, 1), size=0.05, rot_to=None, spot_deg=None, blend=0.2, shadow=True):
    L = bpy.data.lights.new(name, kind)
    L.energy = energy
    L.color = color
    if kind in ('POINT', 'SPOT'):
        L.shadow_soft_size = size
    if kind == 'AREA':
        L.shape = 'RECTANGLE'
        L.size, L.size_y = size if isinstance(size, tuple) else (size, size)
    if kind == 'SPOT':
        L.spot_size = np.radians(spot_deg)
        L.spot_blend = blend
    L.use_shadow = shadow
    ob = bpy.data.objects.new(name, L)
    coll_.objects.link(ob)
    ob.location = U.gv(*loc_g)
    if rot_to is not None:
        d = U.gv(*rot_to) - ob.location
        ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    if not shadow:
        ob.visible_glossy = False
        ob.visible_transmission = False
    U.set_hidden_from_export(ob)
    return ob

def fog_box(name, mat, coll_, x0, x1, y0, y1, z0, z1):
    C = U.box_corners(x0, x1, y0, y1, z0, z1)
    V = C
    F = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]
    ob = U.mesh_from_faces(name, V, F, coll_=coll_, mat=mat, smooth=False)
    ob.visible_shadow = False
    U.set_hidden_from_export(ob)
    return ob

def camera(name, pos, target, lens, coll_, shift=(0, 0)):
    cam = bpy.data.cameras.new(name)
    cam.lens = lens
    cam.clip_start = 0.05
    cam.clip_end = 300
    cam.shift_x, cam.shift_y = shift
    ob = bpy.data.objects.new(name, cam)
    coll_.objects.link(ob)
    ob.location = U.gv(*pos)
    d = U.gv(*target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    U.set_hidden_from_export(ob)
    return ob

def render_settings(samples=256):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    p = bpy.context.preferences.addons['cycles'].preferences
    try:
        p.compute_device_type = 'OPTIX'
        p.get_devices()
        for d in p.devices:
            d.use = (d.type == 'OPTIX')
    except Exception:
        p.compute_device_type = 'CUDA'
        p.get_devices()
        for d in p.devices:
            d.use = (d.type == 'CUDA')
    sc.cycles.device = 'GPU'
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.015
    sc.cycles.adaptive_min_samples = 32
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
        sc.cycles.denoising_use_gpu = True
    except Exception:
        pass
    sc.cycles.max_bounces = 8
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 3
    sc.cycles.transmission_bounces = 6
    sc.cycles.volume_bounces = 1
    sc.cycles.transparent_max_bounces = 8
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.cycles.sample_clamp_indirect = 6.0
    sc.cycles.dicing_rate = 1.0
    sc.cycles.offscreen_dicing_scale = 6.0
    sc.cycles.max_subdivisions = 10
    sc.cycles.volume_step_rate = 2.0
    sc.render.resolution_x = 1920
    sc.render.resolution_y = 1080
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 92
    sc.view_settings.view_transform = 'AgX'
    for look in ('AgX - Base Contrast', 'None'):
        try:
            sc.view_settings.look = look
            break
        except Exception:
            continue
