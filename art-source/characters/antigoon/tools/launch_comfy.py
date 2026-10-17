"""Task-specific launcher; does not modify the installed ComfyUI environment."""
import os
import runpy
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
comfy='D:/ComfyUI_windows_portable/ComfyUI'
sys.path.insert(0,comfy)
os.chdir(comfy)
sys.argv=[comfy+'/main.py','--listen','127.0.0.1','--port','8191','--disable-auto-launch','--extra-model-paths-config',str(Path(__file__).with_name('extra-paths.yaml')),'--disable-all-custom-nodes','--whitelist-custom-nodes','comfyui-hunyuan3dwrapper','antigoon_offline']
runpy.run_path(comfy+'/main.py',run_name='__main__')
