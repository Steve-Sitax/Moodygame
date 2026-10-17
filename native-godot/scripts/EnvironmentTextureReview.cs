using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Security.Cryptography;
using Godot;
using Scheldemist.Native.Game;

// Isolated scenery review: no gameplay, actors, player saves or editor-layout writes.
public partial class EnvironmentTextureReview : Node3D
{
    const string Proof = "res://proof/environment-textures";
    Camera3D camera = null!;
    DirectionalLight3D sun = null!;
    Label caption = null!;
    readonly Dictionary<string, ShaderMaterial> materials = new();
    string output = "";
    static readonly Dictionary<string, Texture2D> textures = new();
    public override async void _Ready()
    {
        try
        {
            NativeGlobals.Ensure();
            bool junction=OS.GetCmdlineUserArgs().Any(a=>a.StartsWith("--junction"));
            if(junction)GetViewport().Msaa3D=Viewport.Msaa.Msaa4X;
            output = ProjectSettings.GlobalizePath(junction ? "res://proof/city-junction" : Proof); Directory.CreateDirectory(output);
            if (OS.GetCmdlineUserArgs().Contains("--promote")) { Promote(); GetTree().Quit(); return; }
            RenderingServer.GlobalShaderParameterSet("psx_fog_near", 9000f);
            RenderingServer.GlobalShaderParameterSet("psx_fog_far", 10000f);
            var environment = new Godot.Environment { BackgroundMode = Godot.Environment.BGMode.Color,
                BackgroundColor = new Color(0.18f, 0.20f, 0.22f), TonemapMode = Godot.Environment.ToneMapper.Filmic };
            AddChild(new WorldEnvironment { Environment = environment });
            sun = new DirectionalLight3D { RotationDegrees = new Vector3(-42, -55, 0), LightEnergy = 1.1f, ShadowEnabled = true };
            AddChild(sun);
            if(OS.GetCmdlineUserArgs().Contains("--no-shadows"))sun.ShadowEnabled=false;
            camera = new Camera3D { Current = true, Fov = 58, Far = 1500, Near = 0.04f }; AddChild(camera);
            var canvas = new CanvasLayer(); AddChild(canvas);
            caption = new Label { Position = new Vector2(20, 16) }; caption.AddThemeFontSizeOverride("font_size", 23);
            caption.AddThemeColorOverride("font_shadow_color", Colors.Black); caption.AddThemeConstantOverride("shadow_offset_x", 2); caption.AddThemeConstantOverride("shadow_offset_y", 2); canvas.AddChild(caption);
            var wall = ResourceLoader.Load<PackedScene>("res://world/town/roots/node-00383.scn").Instantiate<Node3D>(); AddChild(wall);
            if (OS.GetCmdlineUserArgs().Contains("--context"))
                AddChild(ResourceLoader.Load<PackedScene>("res://world/town/roots/node-00004.scn").Instantiate<Node3D>());
            AddChild(ResourceLoader.Load<PackedScene>("res://world/town/roots/node-08213.scn").Instantiate<Node3D>());
            AddChild(ResourceLoader.Load<PackedScene>("res://world/town/roots/node-10185.scn").Instantiate<Node3D>());
            foreach (var mesh in All(this).OfType<MeshInstance3D>().Where(m => m.Mesh != null))
                for (int i = 0; i < mesh.Mesh!.GetSurfaceCount(); i++)
                    if (mesh.GetActiveMaterial(i) is ShaderMaterial m) materials.TryAdd(m.ResourcePath, m);
            if(OS.GetCmdlineUserArgs().Contains("--wall-circuit")) {
                Scheldemist.Paths.NativeDataRoot=ProjectSettings.GlobalizePath("res://world/data");
                Scheldemist.Render.Psx.LoadShared(ProjectSettings.GlobalizePath("res://world/town/maps"));
                foreach(string scenery in new[]{"01225","01524","01526","01527","01528","01529","01530","01531","01532"})AddChild(ResourceLoader.Load<PackedScene>($"res://world/town/roots/node-{scenery}.scn").Instantiate<Node3D>());
                // The native park bank and its separate -0.35 m pond live in the static churches root.
                var parkContext=ResourceLoader.Load<PackedScene>("res://world/town/roots/node-00798.scn").Instantiate<Node3D>();AddChild(parkContext);
                foreach(var detail in All(parkContext).OfType<GeometryInstance3D>())detail.Visible=detail.Name.ToString().StartsWith("park",StringComparison.Ordinal);
                GetViewport().Msaa3D=Viewport.Msaa.Msaa4X;await WallCircuitReview.Run(this,camera,sun,environment,caption);return;
            }
            if(OS.GetCmdlineUserArgs().Contains("--junction-candidate") || OS.GetCmdlineUserArgs().Contains("--junction-promote"))
                CityJunctionRepair.Apply(this,OS.GetCmdlineUserArgs().Contains("--junction-promote"));
            if(OS.GetCmdlineUserArgs().Contains("--junction-promote")) {GD.Print("Junction promoted");GetTree().Quit();return;}
            var manifestPath = ProjectSettings.GlobalizePath("res://assets/materials/environment-20261013/manifest.json");
            string mode = OS.GetCmdlineUserArgs().Contains("--candidate") ? "candidate" : OS.GetCmdlineUserArgs().Contains("--installed") ? "after" : "before";
            if(junction)mode=OS.GetCmdlineUserArgs().Contains("--junction-candidate")?"candidate":OS.GetCmdlineUserArgs().Contains("--junction-installed")?"installed":"before";
            if(OS.GetCmdlineUserArgs().Contains("--atmosphere"))mode+="-atmosphere";
            if(OS.GetCmdlineUserArgs().Contains("--clay"))
            {
                mode+="-clay";
                foreach(var m in All(this).OfType<MeshInstance3D>().Where(m=>m.Name.ToString().StartsWith("wall_chunk_12")))
                    for(int s=0;s<m.Mesh!.GetSurfaceCount();s++)m.SetSurfaceOverrideMaterial(s,new StandardMaterial3D{AlbedoColor=m.Name=="wall_chunk_12_3"?(s==0?new Color(.65f,.1f,.1f):new Color(.1f,.4f,.7f)):new Color(.45f,.45f,.45f),Roughness=.65f,CullMode=BaseMaterial3D.CullModeEnum.Disabled});
            }
            if (!junction && mode == "candidate" && File.Exists(manifestPath))
            {
                var originalGuardPath=Path.Combine(output,"promotion-guard.json");
                if(File.Exists(Path.Combine(output,"promoted.json")) && File.Exists(originalGuardPath))
                {
                    var guard=JsonNode.Parse(File.ReadAllText(originalGuardPath))!.AsObject();
                    foreach(var entry in guard)
                        if(Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(entry.Key)))).ToLowerInvariant()!=entry.Value!.GetValue<string>())
                            throw new InvalidOperationException("Candidate repair requires original resources. Use --installed to inspect the promoted game.");
                }
                foreach (var row in JsonNode.Parse(File.ReadAllText(manifestPath))!.AsArray())
                {
                    if (!materials.TryGetValue(row!["material"]!.GetValue<string>(), out var material)) continue;
                    Apply(material, row);
                }
                RepairIronUv(wall);
                RepairDebris();
            }
            foreach (var weather in new[] { "day", "rain", "night" })
            {
                bool night = weather == "night";
                sun.LightEnergy = night ? 0.015f : weather == "rain" ? 0.45f : 1.1f;
                RenderingServer.GlobalShaderParameterSet("psx_hemi_sky", night ? new Vector4(0.006f, 0.008f, 0.014f, 1) : new Vector4(0.28f, 0.30f, 0.32f, 1));
                RenderingServer.GlobalShaderParameterSet("psx_hemi_ground", night ? new Vector4(0.001f, 0.001f, 0.002f, 1) : new Vector4(0.035f, 0.032f, 0.028f, 1));
                RenderingServer.GlobalShaderParameterSet("psx_wet", weather == "rain" ? 0.85f : 0f);
                RenderingServer.GlobalShaderParameterSet("psx_rain", weather == "rain" ? 0.85f : 0f);
                if(OS.GetCmdlineUserArgs().Contains("--atmosphere"))
                {
                    // Fog/sky values from Daylight's 13 h fog/rain and 21 h fog tables.
                    // Isolated scenery: no actors, player saves or runtime simulation.
                    var fog=Scheldemist.Render.Psx.Hex(night?0x1a1e25:0x51585a);
                    RenderingServer.GlobalShaderParameterSet("psx_fog_near",weather=="rain"?5.4f:3f);
                    RenderingServer.GlobalShaderParameterSet("psx_fog_far",night?19f:weather=="rain"?70f:28f);
                    RenderingServer.GlobalShaderParameterSet("psx_fog_color",new Vector4(fog.R,fog.G,fog.B,1));
                    environment.BackgroundColor=fog.LinearToSrgb();
                    environment.TonemapMode=Godot.Environment.ToneMapper.Linear;
                }
                if(!OS.GetCmdlineUserArgs().Contains("--atmosphere"))environment.BackgroundColor = night ? new Color(0.009f, 0.012f, 0.02f) : new Color(0.18f, 0.20f, 0.22f);
                var lamp = new OmniLight3D { Position = new Vector3(211.0f,3.5f,32.0f), LightColor = new Color(1,0.69f,0.35f), LightEnergy = night ? 1.6f : 0, OmniRange = 7, ShadowEnabled = true }; AddChild(lamp);
                if(junction)
                {
                    var guardLamp=new OmniLight3D{Position=new(222.38f,8.55f,48.5f),LightColor=new(1,.69f,.35f),LightEnergy=night?2.4f:.25f,OmniRange=5,ShadowEnabled=true};AddChild(guardLamp);
                    await Shot($"{mode}-railing-{weather}",new(209.7f,2.1f,33),new(211.1f,1.7f,34.3f));
                    await Shot($"{mode}-steps-{weather}",new(210.6f,.65f,30.1f),new(211.65f,.38f,32));
                    await Shot($"{mode}-newel-{weather}",new(209.8f,1.3f,32.15f),new(210.87f,.79f,31.33f));
                    await Shot($"{mode}-junction-{weather}",new(206.5f,1.4f,29),new(210.7f,.65f,34));
                    await Shot($"{mode}-opposite-{weather}",new(213.6f,3.2f,34.6f),new(210.9f,2.65f,35.8f));
                    await Shot($"{mode}-guardhouse-{weather}",new(218.5f,8.4f,43.5f),new(224,8.2f,48));
                    await Shot($"{mode}-guard-drain-{weather}",new(221.3f,7.7f,47.5f),new(222.5f,6.8f,47.22f));
                    if(!night)
                    {
                        await Shot($"{mode}-house-drain-{weather}",new(202.6f,1.15f,41.3f),new(200.3f,.9f,43.7f));
                        await Shot($"{mode}-gutter-{weather}",new(202.2f,10.9f,41.6f),new(200.2f,10.1f,43.6f));
                        await Shot($"{mode}-drain-context-{weather}",new(206,5,39),new(200.1f,5,43.7f));
                    }
                    guardLamp.QueueFree();lamp.QueueFree();continue;
                }
                await Shot($"{mode}-stairs-{weather}", new Vector3(203, 7.5f, 27), new Vector3(213, 3.2f, 37));
                await Shot($"{mode}-steps-close-{weather}", new Vector3(211.3f, 1.2f, 29.7f), new Vector3(212.3f, 0.65f, 32.5f));
                await Shot($"{mode}-railing-{weather}", new Vector3(209.7f, 2.1f, 33.0f), new Vector3(211.1f, 1.7f, 34.3f));
                if (!night) await Shot($"{mode}-wall-{weather}", new Vector3(217, 3.2f, 38), new Vector3(219, 3.2f, 39));
                if (!night) await Shot($"{mode}-roof-{weather}", new Vector3(210, 10, 20), new Vector3(219, 9.2f, 32));
                if (!night && OS.GetCmdlineUserArgs().Contains("--context")) await Shot($"{mode}-houses-{weather}",new Vector3(15,22,65),new Vector3(45,12,90));
                if (!night) await Shot($"{mode}-poster-{weather}",new Vector3(-280.0f,2.0f,15.5f),new Vector3(-279.092f,1.98f,15.5f));
                if (!night)
                {
                    var debris=All(this).OfType<MeshInstance3D>().First(m=>m.Name=="litter_solid");
                    var arrays=debris.Mesh!.SurfaceGetArrays(0);var vertices=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();var uv=arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
                    var choices=Enumerable.Range(0,vertices.Length).Where(i=>uv[i].X>0.126f && uv[i].X<0.248f && uv[i].Y>0.25f && uv[i].Y<0.376f).ToArray();
                    var index=choices.OrderBy(i=>vertices[i].DistanceSquaredTo(new Vector3(45,0,90))).First();
                    var focus=debris.GlobalTransform*vertices[index];
                    await Shot($"{mode}-debris-{weather}",focus+new Vector3(0.50f,0.36f,0.44f),focus);
                    await Shot($"{mode}-debris-ends-{weather}",focus+new Vector3(-0.55f,0.18f,0.35f),focus+new Vector3(-0.15f,0.02f,0));
                }
                lamp.QueueFree();
            }
            File.WriteAllText(Path.Combine(output, mode + "-render.json"), System.Text.Json.JsonSerializer.Serialize(new { completed = true, materialCount = materials.Count, mode, note = "Check render log for shader errors; completion alone is not validation." }));
            GD.Print("Environment texture review rendered: " + mode); GetTree().Quit();
        }
        catch (Exception e) { GD.PrintErr(e); GetTree().Quit(1); }
    }
    async Task Shot(string name, Vector3 eye, Vector3 target)
    {
        camera.GlobalPosition = eye; camera.LookAt(target); caption.Text = name.Replace('-', ' ') + " | native geometry / game materials";
        for (int i = 0; i < 8; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
        await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        if (GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output, name + ".png")) != Error.Ok) throw new IOException(name);
    }
    static IEnumerable<Node> All(Node node) { yield return node; foreach (var child in node.GetChildren()) foreach (var descendant in All(child)) yield return descendant; }
    void RepairIronUv(Node wall)
    {
        var report = new List<object>(); var cache = new Dictionary<string, ArrayMesh>();
        var points = new Dictionary<(int,int,int), List<Vector3>>();
        Vector3 Weld(Vector3 p)
        {
            const float tolerance = 0.0015f;
            var key = ((int)Mathf.Floor(p.X / tolerance), (int)Mathf.Floor(p.Y / tolerance), (int)Mathf.Floor(p.Z / tolerance));
            for (int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++)
                if(points.TryGetValue((key.Item1+x,key.Item2+y,key.Item3+z),out var neighbours))
                    foreach(var other in neighbours) if(p.DistanceSquaredTo(other)<tolerance*tolerance) return other;
            if(!points.TryGetValue(key,out var bucket)) points[key]=bucket=new(); bucket.Add(p); return p;
        }
        string directory = Path.Combine(output, "uv-drafts"); Directory.CreateDirectory(directory);
        foreach (var instance in All(wall).OfType<MeshInstance3D>().Where(m => m.Mesh is ArrayMesh))
        {
            var source = (ArrayMesh)instance.Mesh!;
            if (!Enumerable.Range(0, source.GetSurfaceCount()).Any(i => source.SurfaceGetMaterial(i)?.ResourceName is "wall_iron" or "wall_stone" or "wall_brick" or "wall_plinth")) continue;
            if (cache.TryGetValue(source.ResourcePath, out var done)) { instance.Mesh = done; continue; }
            var made = new ArrayMesh { ResourceName = source.ResourceName };
            float moved = 0;
            foreach (var key in source.GetMetaList()) made.SetMeta(key, source.GetMeta(key));
            for (int surface = 0; surface < source.GetSurfaceCount(); surface++)
            {
                var arrays = source.SurfaceGetArrays(surface); var material = source.SurfaceGetMaterial(surface);
                if (material?.ResourceName is "wall_stone" or "wall_brick" or "wall_plinth")
                {
                    var positions = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                    for(int i=0;i<positions.Length;i++)
                    {
                        var p=instance.GlobalTransform*positions[i]; var corrected=Weld(p);
                        moved=Mathf.Max(moved,p.DistanceTo(corrected)); positions[i]=instance.GlobalTransform.AffineInverse()*corrected;
                    }
                    arrays[(int)Mesh.ArrayType.Vertex]=positions;
                }
                if (material?.ResourceName is "wall_iron" or "wall_stone")
                {
                    var positions = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                    var normals = arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
                    var uv = new Vector2[positions.Length];
                    for (int i = 0; i < positions.Length; i++)
                    {
                        var p = instance.GlobalTransform * positions[i];
                        var n = (instance.GlobalBasis.Inverse().Transposed() * normals[i]).Normalized();
                        // One metre per repeat on all faces; vertical runoff stays world-down.
                        if (Mathf.Abs(n.Y) > 0.7f) uv[i] = new Vector2(p.X, p.Z);
                        else { var across = new Vector3(n.Z, 0, -n.X).Normalized(); uv[i] = new Vector2(p.Dot(across), -p.Y); }
                        if(material.ResourceName == "wall_stone") uv[i] /= 1.2f;
                    }
                    arrays[(int)Mesh.ArrayType.TexUV] = uv;
                }
                made.AddSurfaceFromArrays(source.SurfaceGetPrimitiveType(surface), arrays);
                made.SurfaceSetMaterial(surface, material);
            }
            made.SetMeta("native_environment_texture_revision", "20261013");
            string draft = Path.Combine(directory, Path.GetFileName(source.ResourcePath));
            // These drafts are for inspection only. Promotion is a separate guarded step.
            if (ResourceSaver.Save(made, draft) != Error.Ok) throw new IOException(draft);
            report.Add(new { original = source.ResourcePath, draft, maxVertexMovementMetres = moved, collisionUnchanged = true, note = "weld only within 1.5 mm; vertex normals, indices and authored transforms retained" });
            cache[source.ResourcePath] = made; instance.Mesh = made;
        }
        File.WriteAllText(Path.Combine(output, "uv-repairs.json"), System.Text.Json.JsonSerializer.Serialize(report, new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
    }
    public static void Apply(ShaderMaterial material, JsonNode row)
    {
        Texture2D Texture(string key) { string path=row[key]!.GetValue<string>();if(textures.TryGetValue(path,out var cached))return cached;var image = Image.LoadFromFile(ProjectSettings.GlobalizePath(path)); image.GenerateMipmaps(); return textures[path]=ImageTexture.CreateFromImage(image); }
        material.SetShaderParameter("tex", Texture("albedo"));
        if (row["height"] != null) { material.SetShaderParameter("bump_map", Texture("height")); material.SetShaderParameter("bump_scale", row["bumpScale"]!.GetValue<float>()); }
        if (row["uvScale"] is JsonArray uv) material.SetShaderParameter("uv_xform", new Vector4(uv[0]!.GetValue<float>(), uv[1]!.GetValue<float>(), 0, 0));
        if (row["albedo"]!.GetValue<string>().EndsWith("/slate.png")) material.SetShaderParameter("albedo",new Color(0.72f,0.76f,0.82f));
        if (row["albedo"]!.GetValue<string>().EndsWith("/house-roofs.png"))
        {
            // Each roof type is its own GPU layer. Mips and anisotropic footprints
            // can no longer bleed red clay across the adjoining slate cell.
            Texture2DArray Layers(string key)
            {
                var image=Image.LoadFromFile(ProjectSettings.GlobalizePath(row[key]!.GetValue<string>()));
                var layers=new Godot.Collections.Array<Image>();
                for(int y=0;y<2;y++) for(int x=0;x<2;x++) {var part=image.GetRegion(new Rect2I(x*512,y*512,512,512));part.GenerateMipmaps();layers.Add(part);}
                var made=new Texture2DArray();if(made.CreateFromImages(layers)!=Error.Ok)throw new IOException("Roof layers");return made;
            }
            var shader=(Shader)material.Shader.Duplicate();
            string code=shader.Code;
            code=code.Replace("shader_type spatial;", "shader_type spatial;\nuniform sampler2DArray environment_roof_colour : source_color, filter_linear_mipmap_anisotropic, repeat_enable;\nuniform sampler2DArray environment_roof_height : filter_linear_mipmap, repeat_enable;\n");
            code=code.Replace("vec4 c = texture(tex, uv);", @"vec4 c = texture(environment_roof_colour, vec3(raw_uv, cell.x + cell.y * 2.0));
                if(cell.x > 0.5 && cell.y < 0.5) {
                    float course=floor(raw_uv.y*8.0);
                    float tile=floor(raw_uv.x*6.0 - mod(course,2.0)*0.5);
                    float tone=mix(0.78,1.18,psx_h11(tile*17.137+course*113.91));
                    float soot=0.94+0.06*sin(world.x*0.47+sin(world.z*0.29))*sin(world.z*0.31+world.y*0.23);
                    c.rgb *= vec3(0.48,0.53,0.61)*tone*soot;
                }
                c.rgb *= 1.0-0.28*clamp(psx_wet,0.0,1.0);");
            if(!code.Contains("global uniform float psx_wet;")) code=code.Replace("shader_type spatial;","shader_type spatial;\nglobal uniform float psx_wet;");
            foreach(string sample in new[]{"raw","raw + dx","raw + dy"})
                code=code.Replace($"textureGrad(bump_map, (cl + fract({sample})) / 2.0, gx, gy)",$"textureGrad(environment_roof_height, vec3({sample}, cl.x + cl.y * 2.0), dx, dy)");
            if(code==shader.Code || !code.Contains("texture(environment_roof_colour"))throw new InvalidOperationException("Unexpected roof shader");
            shader.Code=code;material.Shader=shader;
            material.SetShaderParameter("environment_roof_colour",Layers("albedo"));
            material.SetShaderParameter("environment_roof_height",Layers("height"));
        }
    }

    void RepairDebris()
    {
        var instance=All(this).OfType<MeshInstance3D>().First(m=>m.Name=="litter_solid");var original=(ArrayMesh)instance.Mesh!;
        var a=original.SurfaceGetArrays(0);var p=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();var n=a[(int)Mesh.ArrayType.Normal].AsVector3Array();var uv=a[(int)Mesh.ArrayType.TexUV].AsVector2Array();var col=a[(int)Mesh.ArrayType.Color].AsColorArray();var ix=a[(int)Mesh.ArrayType.Index].AsInt32Array();
        bool Wood(int i)=>uv[i].X>=0.125f && uv[i].X<0.5f && uv[i].Y>=0.25f && uv[i].Y<0.376f;
        var selected=new List<float[]>();var keep=new List<int>();
        for(int j=0;j<ix.Length;j+=3)
        {
            if(Enumerable.Range(0,3).All(k=>Wood(ix[j+k])))for(int k=0;k<3;k++){int i=ix[j+k];selected.Add(new[]{p[i].X,p[i].Y,p[i].Z,uv[i].X,uv[i].Y,col[i].R,col[i].G,col[i].B,col[i].A});}
            else for(int k=0;k<3;k++)keep.Add(ix[j+k]);
        }
        File.WriteAllText(Path.Combine(output,"wood-input.json"),System.Text.Json.JsonSerializer.Serialize(selected));
        string repaired=Path.Combine(output,"wood-repaired.json");if(!File.Exists(repaired))return;
        var rebuilt=System.Text.Json.JsonSerializer.Deserialize<float[][]>(File.ReadAllText(repaired))!;
        var positions=new List<Vector3>();var normals=new List<Vector3>();var uvs=new List<Vector2>();var colours=new List<Color>();
        foreach(int i in keep){positions.Add(p[i]);normals.Add(n[i]);uvs.Add(uv[i]);colours.Add(col[i]);}
        foreach(var v in rebuilt){positions.Add(new Vector3(v[0],v[1],v[2]));normals.Add(new Vector3(v[3],v[4],v[5]));uvs.Add(new Vector2(v[6],v[7]));colours.Add(new Color(v[8],v[9],v[10],v[11]));}
        var arrays=new Godot.Collections.Array();arrays.Resize((int)Mesh.ArrayType.Max);arrays[(int)Mesh.ArrayType.Vertex]=positions.ToArray();arrays[(int)Mesh.ArrayType.Normal]=normals.ToArray();arrays[(int)Mesh.ArrayType.TexUV]=uvs.ToArray();arrays[(int)Mesh.ArrayType.Color]=colours.ToArray();
        var made=new ArrayMesh{ResourceName=original.ResourceName};made.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays);made.SurfaceSetMaterial(0,original.SurfaceGetMaterial(0));
        for(int surface=1;surface<original.GetSurfaceCount();surface++){made.AddSurfaceFromArrays(original.SurfaceGetPrimitiveType(surface),original.SurfaceGetArrays(surface));made.SurfaceSetMaterial(surface,original.SurfaceGetMaterial(surface));}
        // Thin, transparent local contact occlusion for static loose timber on the
        // street plane. No raised plate, solid collision, emission or broad shadow.
        var contact=System.Text.Json.JsonSerializer.Deserialize<float[][]>(File.ReadAllText(Path.Combine(output,"wood-contact.json")))!;
        var ground=new List<(Vector3 a,Vector3 b,Vector3 c)>();
        foreach(var groundMesh in All(this).OfType<MeshInstance3D>().Where(m=>m.Mesh!=null))
            for(int s=0;s<groundMesh.Mesh!.GetSurfaceCount();s++)
                if(groundMesh.Name.ToString() is "ground_earth" or "ground_flags" or "ground_cobble" or "ground_quay")
                {
                    var ga=groundMesh.Mesh.SurfaceGetArrays(s);var gp=ga[(int)Mesh.ArrayType.Vertex].AsVector3Array();var gi=ga[(int)Mesh.ArrayType.Index].AsInt32Array();
                    for(int j=0;j<gi.Length;j+=3)ground.Add((groundMesh.GlobalTransform*gp[gi[j]],groundMesh.GlobalTransform*gp[gi[j+1]],groundMesh.GlobalTransform*gp[gi[j+2]]));
                }
        float GroundY(float x,float z)
        {
            float height=-100;
            foreach(var t in ground)
            {
                if(x<Mathf.Min(t.a.X,Mathf.Min(t.b.X,t.c.X))||x>Mathf.Max(t.a.X,Mathf.Max(t.b.X,t.c.X))||z<Mathf.Min(t.a.Z,Mathf.Min(t.b.Z,t.c.Z))||z>Mathf.Max(t.a.Z,Mathf.Max(t.b.Z,t.c.Z)))continue;
                float d=(t.b.Z-t.c.Z)*(t.a.X-t.c.X)+(t.c.X-t.b.X)*(t.a.Z-t.c.Z);if(Mathf.Abs(d)<0.00001f)continue;
                float u=((t.b.Z-t.c.Z)*(x-t.c.X)+(t.c.X-t.b.X)*(z-t.c.Z))/d;float v=((t.c.Z-t.a.Z)*(x-t.c.X)+(t.a.X-t.c.X)*(z-t.c.Z))/d;
                float y=u*t.a.Y+v*t.b.Y+(1-u-v)*t.c.Y;
                if(u>=-0.0001f&&v>=-0.0001f&&u+v<=1.0001f&&y<0.12f)height=Mathf.Max(height,y);
            }
            return height+0.001f;
        }
        foreach(var v in contact)v[1]=GroundY(v[0],v[2]);
        contact=contact.Chunk(6).Where(group=>group.All(v=>v[1]>-99) && group.Max(v=>v[1])-group.Min(v=>v[1])<0.06f).SelectMany(group=>group).ToArray();
        var contactArrays=new Godot.Collections.Array();contactArrays.Resize((int)Mesh.ArrayType.Max);
        contactArrays[(int)Mesh.ArrayType.Vertex]=contact.Select(v=>new Vector3(v[0],v[1],v[2])).ToArray();
        var corners=new[]{new Vector2(0,0),new Vector2(1,0),new Vector2(1,1),new Vector2(0,0),new Vector2(1,1),new Vector2(0,1)};
        contactArrays[(int)Mesh.ArrayType.TexUV]=Enumerable.Range(0,contact.Length).Select(i=>corners[i%6]).ToArray();
        made.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,contactArrays);
        made.SurfaceSetMaterial(made.GetSurfaceCount()-1,new ShaderMaterial{ResourceName="Timber contact occlusion",Shader=new Shader{Code=@"shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, shadows_disabled;
varying float range_to_eye; void vertex(){range_to_eye=length((MODELVIEW_MATRIX*vec4(VERTEX,1.0)).xyz);} void fragment(){vec2 e=abs(UV*2.0-1.0);float mask=(1.0-smoothstep(0.65,1.0,e.x))*(1.0-smoothstep(0.50,1.0,e.y));ALBEDO=vec3(0.0);ALPHA=mask*0.48*(1.0-smoothstep(5.0,12.0,range_to_eye));}"}});
        foreach(var key in original.GetMetaList())made.SetMeta(key,original.GetMeta(key));made.SetMeta("native_wood_bevel_metres",0.0015f);
        string draft=Path.Combine(output,"uv-drafts",Path.GetFileName(original.ResourcePath));if(ResourceSaver.Save(made,draft)!=Error.Ok)throw new IOException(draft);
        var report=JsonNode.Parse(File.ReadAllText(Path.Combine(output,"uv-repairs.json")))!.AsArray();report.Add(new JsonObject{["original"]=original.ResourcePath,["draft"]=draft,["maxVertexMovementMetres"]=0.0f,["collisionUnchanged"]=true,["note"]="Wood-only 1.5mm bevel with <=12mm end wear. Other triangles preserved. Non-colliding litter."});File.WriteAllText(Path.Combine(output,"uv-repairs.json"),report.ToJsonString());instance.Mesh=made;
    }

    // Explicit promotion uses a pre-recorded hash guard and preserves every scene/ID/transform.
    void Promote()
    {
        if(DisplayServer.GetName()=="headless")throw new InvalidOperationException("Run promotion with Forward+; Texture2DArray persistence needs GPU readback.");
        var rows=JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://assets/materials/environment-20261013/manifest.json")))!.AsArray();
        var meshes=JsonNode.Parse(File.ReadAllText(Path.Combine(output,"uv-repairs.json")))!.AsArray();
        var guard=JsonNode.Parse(File.ReadAllText(Path.Combine(output,"promotion-guard.json")))!.AsObject();
        var paths=rows.Select(r=>r!["material"]!.GetValue<string>()).Concat(meshes.Select(r=>r!["original"]!.GetValue<string>())).Distinct().ToArray();
        string Hash(string path)=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();
        foreach(var path in paths) if(guard[path]?.GetValue<string>()!=Hash(path)) throw new IOException("Resource changed since review: "+path);
        string backup=Path.Combine(output,"original-resources");Directory.CreateDirectory(backup);
        foreach(var path in paths) File.Copy(ProjectSettings.GlobalizePath(path),Path.Combine(backup,Path.GetFileName(path)),false);
        void Save(Resource resource,string path) { if(ResourceSaver.Save(resource,path,ResourceSaver.SaverFlags.Compress)!=Error.Ok)throw new IOException(path);resource.TakeOverPath(path); }
        var updates=new List<(ShaderMaterial material,string path)>();
        foreach(var row in rows)
        {
            string path=row!["material"]!.GetValue<string>();var material=ResourceLoader.Load<ShaderMaterial>(path);Apply(material,row);
            foreach(string parameter in new[]{"tex","bump_map"})
            {
                string key=parameter=="tex"?"albedo":"height";if(row[key]==null)continue;
                var texture=material.GetShaderParameter(parameter).AsGodotObject() as Texture2D;
                Save(texture!,row[key]!.GetValue<string>().Replace(".png","-texture.res"));
            }
            if(row["albedo"]!.GetValue<string>().EndsWith("/house-roofs.png"))
            {
                foreach(string parameter in new[]{"environment_roof_colour","environment_roof_height"})
                    Save((Resource)material.GetShaderParameter(parameter).AsGodotObject(),"res://assets/materials/environment-20261013/"+parameter+".res");
                Save(material.Shader,"res://assets/materials/environment-20261013/house-roofs.gdshader");
            }
            updates.Add((material,path));
        }
        foreach(var update in updates) Save(update.material,update.path);
        foreach(var row in meshes)
        {
            if(row!["maxVertexMovementMetres"]!.GetValue<float>()>0.00151f)throw new IOException("Unsafe weld distance");
            var mesh=ResourceLoader.Load<ArrayMesh>(row["draft"]!.GetValue<string>());Save(mesh,row["original"]!.GetValue<string>());
        }
        File.WriteAllText(Path.Combine(output,"promoted.json"),System.Text.Json.JsonSerializer.Serialize(paths.ToDictionary(p=>p,Hash),new System.Text.Json.JsonSerializerOptions{WriteIndented=true}));
        GD.Print($"Promoted {updates.Count} materials and {meshes.Count} mesh UV/seam repairs; originals backed up.");
    }
}













