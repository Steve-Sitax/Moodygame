"""Submit a reproducible Antigoon shape pass to the existing local Hunyuan3D installation."""
import json
import shutil
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COMFY = Path('D:/ComfyUI_windows_portable/ComfyUI')
URL = 'http://127.0.0.1:8191'
shutil.copy2(ROOT / 'references/appearance-v01.png', COMFY / 'input/antigoon-appearance-v01.png')

def node(kind, **inputs):
    return {'class_type': kind, 'inputs': inputs}

# Square padding and alpha conditioning are tensor preprocessing for the 3D model.
# The original generated reference remains untouched.
graph = {
    '1': node('LoadImage', image='antigoon-appearance-v01.png'),
    '2': node('InvertMask', mask=['1', 1]),
    '3': node('ThresholdMask', mask=['2', 0], value=0.8),
    '4': node('EmptyImage', width=1792, height=1792, batch_size=1, color=16777215),
    '5': node('ImageCompositeMasked', destination=['4', 0], source=['1', 0], x=384, y=128, resize_source=False, mask=['3', 0]),
    '6': node('ImageScale', image=['5', 0], upscale_method='lanczos', width=512, height=512, crop='disabled'),
    '7': node('MaskToImage', mask=['3', 0]),
    '8': node('EmptyImage', width=1792, height=1792, batch_size=1, color=0),
    '9': node('ImageCompositeMasked', destination=['8', 0], source=['7', 0], x=384, y=128, resize_source=False),
    '10': node('ImageScale', image=['9', 0], upscale_method='bilinear', width=512, height=512, crop='disabled'),
    '11': node('ImageToMask', image=['10', 0], channel='red'),
    '20': node('Hy3DModelLoader', model='hunyuan3d-dit-v2-0-fp16.safetensors', attention_mode='sdpa', cublas_ops=False),
    '21': node('Hy3DGenerateMesh', pipeline=['20', 0], image=['6', 0], mask=['11', 0], guidance_scale=5.5, steps=40, seed=18731014, scheduler='FlowMatchEulerDiscreteScheduler', force_offload=False),
    '22': node('Hy3DVAEDecode', vae=['20', 1], latents=['21', 0], box_v=1.01, octree_resolution=512, num_chunks=12000, mc_level=0.0, mc_algo='mc', enable_flash_vdm=True, force_offload=True),
    '23': node('Hy3DExportMesh', trimesh=['22', 0], filename_prefix='antigoon/shape-v01', file_format='glb', save_file=True),
}
(ROOT / 'source/shape-workflow-v01.json').write_text(json.dumps(graph, indent=2))
request = urllib.request.Request(URL + '/prompt', data=json.dumps({'prompt': graph, 'client_id': 'antigoon-model-review'}).encode(), headers={'Content-Type': 'application/json'})
try:
    result = json.load(urllib.request.urlopen(request))
except urllib.error.HTTPError as error:
    print(error.read().decode())
    raise
(ROOT / 'source/shape-job-v01.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result))
