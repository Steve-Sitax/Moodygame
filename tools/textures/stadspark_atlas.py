"""Pack the original imagegen RGBA sheet into the existing 64px foliage atlas.

Preserves generated alpha; no colour key, replacement painting or unrelated height pattern.
Run: python tools/textures/stadspark_atlas.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
source = Image.open(ROOT / 'assets/concepts/stadspark/foliage-source.png').convert('RGBA')
assert source.getextrema()[3][0] == 0, 'The source must have real transparency'
strip = Image.new('RGBA', (8 * 64, 64))
for i in range(8):
    col, row = i % 4, i // 4
    cell = source.crop((col * source.width // 4, row * source.height // 2,
                        (col + 1) * source.width // 4, (row + 1) * source.height // 2))
    cell.thumbnail((60, 60), Image.Resampling.LANCZOS)
    strip.paste(cell, (i * 64 + (64-cell.width)//2, 62-cell.height))
strip.save(ROOT / 'tools/blender/art/stadspark_foliage.png')
print('Packed eight RGBA foliage cards, 512 x 64')
