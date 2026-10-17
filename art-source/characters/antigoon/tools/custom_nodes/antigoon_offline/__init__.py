"""Offline marching-cubes conversion for this asset's generation workflow."""
import numpy as np
import torch
from skimage.measure import marching_cubes
from comfy_api.latest._util import MESH

class AntigoonVoxelToMesh:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'voxel':('VOXEL',), 'threshold':('FLOAT',{'default':0.0})}}
    RETURN_TYPES=('MESH',)
    FUNCTION='convert'
    CATEGORY='Antigoon offline tools'
    def convert(self,voxel,threshold):
        volume=voxel.data[0].detach().float().cpu().numpy()
        vertices,faces,_,_=marching_cubes(volume,level=threshold)
        vertices=(vertices-np.array(volume.shape,dtype=np.float32)/2)/(max(volume.shape)/2)
        vertices=vertices[:,::-1].copy()
        faces=faces[:,::-1].copy()
        print('Antigoon marching cubes:',len(vertices),'vertices',len(faces),'faces')
        return (MESH(torch.from_numpy(vertices).float().unsqueeze(0),torch.from_numpy(faces).long().unsqueeze(0)),)

NODE_CLASS_MAPPINGS={'AntigoonVoxelToMesh':AntigoonVoxelToMesh}
