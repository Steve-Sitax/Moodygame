import bpy,statistics
from pathlib import Path
R=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(R/'source/antigoon-v13-highres-keeper-fit-game.blend'))
o=bpy.data.objects['Antigoon_body_high'];im=next(n.image for n in o.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE' and 'basecolor' in n.image.name);pix=list(im.pixels);w,h=im.size
for low,high in [(2.3,2.4),(2.4,2.5),(2.5,2.6),(2.6,2.7),(2.7,2.8),(2.8,2.9),(2.9,3.0)]:
 allp=[];skin=[];cols=[]
 for p in o.data.polygons:
  c=p.center
  if c.x<.75 or not low<c.z<high:continue
  allp.append(c.copy());uv=o.data.uv_layers.active.data[p.loop_start].uv;i=(int(uv.y*h)*w+int(uv.x*w))*4;colour=pix[i:i+3]
  if len(colour)==3 and colour[0]>.45 and colour[1]>.35:skin.append(c.copy());cols.append(colour)
 print(low,'all',len(allp),'skin',len(skin),'skin centre', [round(statistics.mean(p[k] for p in skin),3) for k in range(3)] if skin else None,'full range',[(round(min(p[k] for p in allp),3),round(max(p[k] for p in allp),3)) for k in range(2)],'skin colour',[round(statistics.mean(p[k] for p in cols),3) for k in range(3)] if cols else None,flush=True)
