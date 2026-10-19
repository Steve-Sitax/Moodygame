extends SceneTree
# Only two existing material resources change. Read generated PNGs directly so this
# utility needs no editor-wide import; external ImageTexture resources hold mipmaps.
# godot --headless --path native-godot --script res://scripts/promote-cathedral-marble.gd -- --record <fresh-folder>
const ASSETS = "res://assets/materials/cathedral-marble-20261019/"

func uniforms(mat: ShaderMaterial) -> Dictionary:
    var result = {}
    for p in mat.shader.get_shader_uniform_list():
        if p.name == "tex": continue
        var v = mat.get_shader_parameter(p.name)
        result[p.name] = v.resource_path if v is Resource else str(v)
    return result

func require(ok: bool, message: String) -> bool:
    if not ok:
        push_error(message)
        quit(1)
    return ok

func _initialize():
    var args = OS.get_cmdline_user_args()
    var pos = args.find("--record")
    if not require(pos >= 0 and pos + 1 < args.size(), "--record <fresh-folder> required"): return
    var record = args[pos + 1]
    if not require(not DirAccess.dir_exists_absolute(record), "Record directory already exists"): return
    DirAccess.make_dir_recursive_absolute(record)
    var report = []
    var manifest = JSON.parse_string(FileAccess.get_file_as_string(ASSETS + "manifest.json"))
    for pair in [["r005888", "white"], ["r005894", "black"]]:
        var path = "res://world/town/resources/" + pair[0] + ".res"
        var mat = load(path) as ShaderMaterial
        if not require(mat != null, "Missing marble material: " + path): return
        var shader_code = mat.shader.code.sha256_text()
        var shader_path = mat.shader.resource_path
        var uid = ResourceLoader.get_resource_uid(path)
        var before = uniforms(mat)
        var original_hash = FileAccess.get_sha256(path)
        var settings = [mat.resource_name, mat.resource_local_to_scene, mat.render_priority]
        if not require(DirAccess.copy_absolute(ProjectSettings.globalize_path(path), record + "/" + pair[0] + ".res") == OK, "Backup failed"): return
        var previous = mat.get_shader_parameter("tex") as Texture2D
        var old_image = previous.get_image()
        if old_image.is_compressed(): old_image.decompress()
        old_image.save_png(record + "/" + pair[1] + "-before.png")
        var source = ASSETS + pair[1] + ".png"
        var specification = manifest.textures.filter(func(t): return t.file == pair[1] + ".png")[0]
        if not require(FileAccess.get_sha256(source) == specification.sha256, "Generated image hash mismatch"): return
        var img = Image.load_from_file(ProjectSettings.globalize_path(source))
        if not require(img != null and img.get_width() == 1024 and img.get_height() == 1024, "Wrong marble dimensions"): return
        img.generate_mipmaps()
        var texture = ImageTexture.create_from_image(img)
        texture.resource_name = "cathedral_marble_" + pair[1]
        var texture_path = ASSETS + pair[1] + "-texture.res"
        if not require(ResourceSaver.save(texture, texture_path, ResourceSaver.FLAG_COMPRESS) == OK, "Texture save failed"): return
        mat.set_shader_parameter("tex", load(texture_path))
        if not require(ResourceSaver.save(mat, path, ResourceSaver.FLAG_COMPRESS) == OK, "Material save failed"): return
        var check = ResourceLoader.load(path, "", ResourceLoader.CACHE_MODE_IGNORE) as ShaderMaterial
        var after = check.get_shader_parameter("tex") as Texture2D
        if not require(check.shader.code.sha256_text() == shader_code and check.shader.resource_path == shader_path, "Marble shader changed"): return
        if not require(uniforms(check) == before, "Non-colour-texture uniform changed"): return
        if not require([check.resource_name, check.resource_local_to_scene, check.render_priority] == settings and ResourceLoader.get_resource_uid(path) == uid, "Material identity/settings changed"): return
        if not require(after.resource_path == texture_path and after.get_width() == 1024 and after.get_height() == 1024 and after.get_image().has_mipmaps(), "Texture reload differs"): return
        report.append({"material": path, "uid": uid, "originalSha256": original_hash, "installedSha256": FileAccess.get_sha256(path), "oldSize": [previous.get_width(), previous.get_height()], "newSize": [after.get_width(), after.get_height()], "texture": texture_path, "textureSha256": FileAccess.get_sha256(texture_path), "shaderSha256": shader_code, "shaderUnchanged": true, "otherUniformsUnchanged": true, "mipmaps": true, "repeatMetres": manifest.repeatMetres})
    FileAccess.open(record + "/promotion.json", FileAccess.WRITE).store_string(JSON.stringify(report, "  "))
    print("Cathedral marble: both1024px textures reloaded; shader, uniforms and resource identity unchanged.")
    quit()
