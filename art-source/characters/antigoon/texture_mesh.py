"""Texture the selected 3D reconstruction with the locally installed paint model."""
import json
import urllib.request
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
graph=json.loads((ROOT/'source/shape-workflow-v01.json').read_text())
graph={k:v for k,v in graph.items() if int(k)<20}
head='--head' in sys.argv
tag='head-v01' if head else 'v02'
if head:
 graph['1']['inputs']['image']='antigoon-head-v01.png'
blond='--blond' in sys.argv
if blond:
 tag='head-blond-v02'
 graph['1']['inputs']['image']='antigoon-head-blond-v02.png'
def n(kind,**inputs): return {'class_type':kind,'inputs':inputs}
graph.update({
 '40':n('Hy3DLoadMesh',glb_path=str(ROOT/('source/head-blond-v02-outward.glb' if blond else ('source/head-v01-outward.glb' if head else 'source/shape-v02-outward.glb')))),
 '41':n('Hy3DPostprocessMesh',trimesh=['40',0],remove_floaters=True,remove_degenerate_faces=True,reduce_faces=True,max_facenum=50000 if head else 80000,smooth_normals=False),
 '42':n('Hy3DMeshUVWrap',trimesh=['41',0]),
 '43':n('Hy3DRenderMultiView',trimesh=['42',0],render_size=1024,texture_size=2048,normal_space='world'),
 '44':n('DownloadAndLoadHy3DPaintModel',model='hunyuan3d-paint-v2-0'),
 '45':n('Hy3DSampleMultiView',pipeline=['44',0],ref_image=['6',0],normal_maps=['43',0],position_maps=['43',1],view_size=512,steps=30,seed=18731014,denoise_strength=1.0),
 '46':n('Hy3DBakeFromMultiview',images=['45',0],renderer=['43',2]),
 '53':n('Hy3DMeshVerticeInpaintTexture',texture=['46',0],mask=['46',1],renderer=['46',2]),
 '47':n('CV2InpaintTexture',texture=['53',0],mask=['53',1],inpaint_radius=3,inpaint_method='telea'),
 '48':n('Hy3DApplyTexture',texture=['47',0],renderer=['46',2]),
 '49':n('Hy3DExportMesh',trimesh=['48',0],filename_prefix='antigoon/textured-'+tag,file_format='glb',save_file=True),
 '50':n('SaveImage',images=['45',0],filename_prefix='antigoon/paint-views-'+tag),
 '51':n('SaveImage',images=['43',0],filename_prefix='antigoon/paint-normals-'+tag),
 '52':n('SaveImage',images=['47',0],filename_prefix='antigoon/albedo-'+tag),
})
(ROOT/('source/texture-workflow-'+tag+'.json')).write_text(json.dumps(graph,indent=2))
request=urllib.request.Request('http://127.0.0.1:8191/prompt',data=json.dumps({'prompt':graph,'client_id':'antigoon-model-review'}).encode(),headers={'Content-Type':'application/json'})
try: result=json.load(urllib.request.urlopen(request))
except urllib.error.HTTPError as e:
 print(e.read().decode()); raise
(ROOT/('source/texture-job-'+tag+'.json')).write_text(json.dumps(result,indent=2))
print(json.dumps(result))
