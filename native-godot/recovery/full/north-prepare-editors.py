"""Create additive native editor previews from the reviewed district root manifests.

Run after full-town intake. Existing preview scenes are refused to protect editor edits.
The previews reference the shared root resources and have a separate authored Objects seed.
"""
import argparse
import json
import pathlib
import re


def literal(value):
    return json.dumps(value, ensure_ascii=False)


def vector(kind, values):
    return kind + "(" + ", ".join(str(v) for v in values) + ")"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", default="native-godot")
    parser.add_argument("--pattern", default="north-*.json")
    parser.add_argument("--allow-pending-intake", action="store_true")
    args = parser.parse_args()
    project = pathlib.Path(args.project)
    folder = project / "world/districts"
    plans = sorted(folder.glob(args.pattern))
    if not plans:
        raise ValueError("No district manifests matched")
    pending = []
    for file in plans:
        plan = json.loads(file.read_text(encoding="utf-8"))
        name = plan["id"]
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}", name):
            raise ValueError("Invalid district id")
        roots = sorted(set([r["sourceIndex"] for r in plan["roots"]] + plan["sharedRoots"]))
        for index in roots:
            native = project / f"world/town/roots/node-{index:05d}.scn"
            if not native.exists() and not args.allow_pending_intake:
                raise FileNotFoundError(f"Complete native intake before editor preparation: {native}")
        targets = [folder / (name + suffix) for suffix in [".tscn", ".tres", ".objects.tscn"]]
        if any(target.exists() for target in targets):
            raise FileExistsError("Existing native editor scenes are protected: " + name)
        objects = '[gd_scene format=3]\n\n[node name="Objects" type="Node3D"]\n'
        scene = [f"[gd_scene load_steps={len(roots)+3} format=3]", ""]
        scene += [f'[ext_resource type="PackedScene" path="res://world/town/roots/node-{index:05d}.scn" id="{number}_root"]'
                  for number, index in enumerate(roots, 1)]
        scene += ['[ext_resource type="Script" path="res://src/World/NativeDistrictScene.cs" id="district_script"]',
                  f'[ext_resource type="PackedScene" path="res://world/districts/{name}.objects.tscn" id="objects"]', "",
                  f'[node name={literal(plan["title"])} type="Node3D"]',
                  'script = ExtResource("district_script")',
                  f'metadata/native_district_id = {literal(name)}',
                  'metadata/native_preview_only = true', "",
                  '[node name="Scenery" type="Node3D" parent="."]', ""]
        for number, index in enumerate(roots, 1):
            scene += [f'[node name="source_{index:05d}" parent="Scenery" instance=ExtResource("{number}_root")]', ""]
        scene += ['[node name="Objects" parent="." instance=ExtResource("objects")]', ""]
        resource = ['[gd_resource type="Resource" script_class="AuthorDistrict" load_steps=4 format=3]', "",
                    '[ext_resource type="Script" path="res://src/Authoring/AuthorDistrict.cs" id="script"]',
                    f'[ext_resource type="PackedScene" path="res://world/districts/{name}.tscn" id="scene"]',
                    '[ext_resource type="Resource" path="res://recovered/rijnkaai-recovered/catalog.tres" id="catalog"]', "",
                    '[resource]', 'script = ExtResource("script")', f'Id = {literal(name)}',
                    f'Title = {literal(plan["title"])}', 'Scene = ExtResource("scene")', 'Catalog = ExtResource("catalog")',
                    'Bounds = ' + vector('Rect2', plan['bounds']), 'WalkSpawn = ' + vector('Vector3', plan['walkSpawn']),
                    'FlySpawn = ' + vector('Vector3', plan['flySpawn']), 'FlyYaw = ' + str(plan['flyYaw']),
                    'FlyPitch = ' + str(plan['flyPitch']), ""]
        pending += [(targets[0], "\n".join(scene)), (targets[1], "\n".join(resource)), (targets[2], objects)]
    # Validate every target first. No partially regenerated district follows a protected existing file.
    for target, content in pending:
        target.write_text(content, encoding="utf-8")
    print(f"Created {len(pending)} additive editor files for {len(plans)} districts")


if __name__ == "__main__":
    main()
