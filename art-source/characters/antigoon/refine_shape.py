"""Higher-detail native ComfyUI Hunyuan 2.1 reconstruction, retaining v01."""
import json
import urllib.request
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent
graph = json.loads((ROOT / 'source/shape-workflow-v01.json').read_text())
graph = {k:v for k,v in graph.items() if int(k) < 20}
tag='head-v01' if '--head' in sys.argv else 'shape-v02'
if '--head' in sys.argv:
    graph['1']['inputs']['image']='antigoon-head-v01.png'
if '--blond' in sys.argv:
    tag='head-blond-v02'
    graph['1']['inputs']['image']='antigoon-head-blond-v02.png'
def n(kind, **inputs): return {'class_type':kind, 'inputs':inputs}
graph.update({
    '30': n('ImageOnlyCheckpointLoader', ckpt_name='hunyuan_3d_v2.1.safetensors'),
    '31': n('CLIPVisionEncode', clip_vision=['30',1], image=['6',0], crop='none'),
    '32': n('Hunyuan3Dv2Conditioning', clip_vision_output=['31',0]),
    '33': n('EmptyLatentHunyuan3Dv2', resolution=8192, batch_size=1),
    '34': n('KSampler', model=['30',0], seed=18731014, steps=40, cfg=5.5, sampler_name='euler', scheduler='simple', positive=['32',0], negative=['32',1], latent_image=['33',0], denoise=1.0),
    '35': n('VAEDecodeHunyuan3D', samples=['34',0], vae=['30',2], num_chunks=8000, octree_resolution=384 if '--head' in sys.argv else 512),
    '36': n('AntigoonVoxelToMesh', voxel=['35',0], threshold=0.6),
    '37': n('SaveGLB', mesh=['36',0], filename_prefix='antigoon/'+tag),
})
(ROOT / ('source/'+tag+'-workflow.json')).write_text(json.dumps(graph, indent=2))
request=urllib.request.Request('http://127.0.0.1:8191/prompt',data=json.dumps({'prompt':graph,'client_id':'antigoon-model-review'}).encode(),headers={'Content-Type':'application/json'})
try: result=json.load(urllib.request.urlopen(request))
except urllib.error.HTTPError as e:
    print(e.read().decode()); raise
(ROOT/('source/'+tag+'-job.json')).write_text(json.dumps(result,indent=2))
print(json.dumps(result))
