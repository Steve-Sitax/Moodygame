using Godot;
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using System.Security.Cryptography;

// Isolated candidate construction; promotion preserves scene nodes and permanent IDs.
public static class CityJunctionRepair
{
    const string Folder="res://proof/city-junction";
    static string PathOf(string file)=>ProjectSettings.GlobalizePath(Folder+"/"+file);
    static IEnumerable<Node> All(Node n) { yield return n; foreach(var c in n.GetChildren()) foreach(var d in All(c)) yield return d; }
    public static void Apply(Node root,bool promote)
    {
        var reviewed=promote?JsonSerializer.Deserialize<Dictionary<string,string>>(File.ReadAllText(PathOf("candidate-resources.json")))!:null;
        var meshes=All(root).OfType<MeshInstance3D>().Where(m=>m.Mesh!=null).ToArray();
        var changed=new Dictionary<string,Resource>();
        var originalHashes=new Dictionary<string,string>();
        void Track(string path,Resource resource)
        {
            changed[path]=resource; originalHashes[path]=Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path))));
            if(reviewed!=null && (!reviewed.TryGetValue(path,out var hash)||hash!=originalHashes[path]))throw new IOException("Source changed since candidate review: "+path);
        }
        var mats=new Dictionary<string,ShaderMaterial>();
        var soilImage=Image.LoadFromFile(ProjectSettings.GlobalizePath("res://assets/materials/environment-20261013/earth.png"));soilImage.GenerateMipmaps();var soilTexture=ImageTexture.CreateFromImage(soilImage);
        foreach(var id in new[]{"r000630","r000642","r000648","r000615","r000016","r000024","r000007","r000045","r000636","r000735","r000657","r000195","r000202"})
        {
            string path=$"res://world/town/resources/{id}.res";
            var old=ResourceLoader.Load<ShaderMaterial>(path); var mat=(ShaderMaterial)old.Duplicate(true);
            var shader=(Shader)mat.Shader.Duplicate(); string code=shader.Code;
            if(code.Contains("junction_weather")) throw new InvalidOperationException("Already installed: inspect using --junction-installed.");
            bool iron=id=="r000615";
            bool basic=new[]{"r000630","r000642","r000648","r000615","r000636","r000735"}.Contains(id);
            if(!code.Contains("global uniform float psx_wet"))code=code.Replace("void fragment()","global uniform float psx_wet;\nvoid fragment()");
            if(basic)
            {
                if(!iron)mat.SetShaderParameter("foot",0f);
                code=code.Replace("void fragment()",File.ReadAllText(ProjectSettings.GlobalizePath("res://shaders/surface_normal.gdshaderinc"))+"\nvoid fragment()");
                float height=id=="r000630"?.004f:id=="r000642"?.006f:iron?.00018f:.0007f;
                code=code.Replace("NORMAL = bump_normal(VERTEX, NORMAL, bump_dh(raw_uv, vec2(0.0), VIEWPORT_SIZE.y / 270.0));",$"NORMAL = metric_surface_normal(VERTEX, NORMAL, texture(bump_map, raw_uv).r * {height.ToString(System.Globalization.CultureInfo.InvariantCulture)});");
                code=code.Replace("specular_disabled, ","");
                code=code.Replace("// three's matt face:","// three's matt face:");
                string diffuse="DIFFUSE_LIGHT += max(dot(NORMAL, LIGHT), 0.0) * a * LIGHT_COLOR / PI;";
                code=code.Replace(diffuse,diffuse+"\n vec3 jh=normalize(LIGHT+VIEW); float js=mix(10.0,55.0,psx_wet); SPECULAR_LIGHT+=LIGHT_COLOR*a*pow(max(dot(NORMAL,jh),0.0),js)*max(dot(NORMAL,LIGHT),0.0)*(0.018+psx_wet*0.12);\n");
            }
            if(id=="r000636" || id=="r000735")
            {
                var stone=ResourceLoader.Load<ShaderMaterial>("res://world/town/resources/r000648.res");
                mat.SetShaderParameter("tex",stone.GetShaderParameter("tex")); mat.SetShaderParameter("bump_map",stone.GetShaderParameter("bump_map"));
                mat.SetShaderParameter("albedo",id=="r000636"?new Color(1.08f,1.045f,.94f):new Color(.88f,.89f,.87f));
                code=code.Replace("vec2 raw_uv = uv;","vec3 jn=normalize((INV_VIEW_MATRIX*vec4(NORMAL,0.0)).xyz); uv=abs(jn.y)>.7?world.xz/1.2:vec2(dot(world,normalize(vec3(jn.z,0.0,-jn.x))),-world.y)/1.2; vec2 raw_uv = uv;");
            }
            if(id=="r000657") {mat.SetShaderParameter("relief_depth",.008f);mat.SetShaderParameter("relief_bump",.40f);mat.SetShaderParameter("relief_dome",.20f);}
            if(id=="r000648")
            {
                mat.SetShaderParameter("junction_soil",soilTexture);
                code=code.Replace("void fragment()","uniform sampler2D junction_soil : source_color,filter_linear_mipmap_anisotropic,repeat_enable;\nvoid fragment()");
                code=code.Replace("c.rgb *= COLOR.rgb;",@"c.rgb *= COLOR.rgb;
                vec2 jq=world.xz-vec2(212.9183,30.7344);
                float ja=dot(jq,vec2(.16092,.98697)),jo=dot(jq,vec2(.98697,-.16092));
                float je=1.0-smoothstep(-.70,-.54+junction_noise(world.xz*23.0)*.11,ja);
                je*=smoothstep(-3.5,-3.2,jo)*(1.0-smoothstep(.00,.035,world.y));
                c.rgb=mix(c.rgb,texture(junction_soil,world.xz/1.8).rgb,je*.88);");
            }
            if(basic)
            {
                // A thin wet film reflects the current sky; it becomes dark when the sky does.
                code=code.Replace("FOG = vec4(fogc + halo, fog_k);",@"float jf=pow(1.0-clamp(dot(normalize(-VERTEX),NORMAL),0.0,1.0),4.0);
                float jw=psx_wet*(.25+.75*junction_noise(world.xz*2.7));
                EMISSION+=psx_hemi_sky.rgb*jf*jw*.12;
                FOG = vec4(fogc + halo, fog_k);");
            }
            if(id=="r000007")
            {
                mat.SetShaderParameter("tex",soilTexture);
                mat.SetShaderParameter("relief_depth",0f);
                code=code.Replace("vec2 uv = UV;","vec2 uv = world.xz / 1.8;");
                // The old pebbled height map must not survive beneath the new fine soil.
                code=code.Replace("return texture(relief_h, uv).r;","return dot(texture(tex,uv).rgb,vec3(.333));").Replace("return texture(relief_h, uv, 2.0).r;","return dot(texture(tex,uv,2.0).rgb,vec3(.333));");
                mat.SetShaderParameter("relief_bump",.25f);mat.SetShaderParameter("relief_dome",.1f);
                code=code.Replace("ground_tilt(world, UV, sl", "ground_tilt(world, uv, sl");
            }
            if(id=="r000195")
            {
                var wood=Image.LoadFromFile(ProjectSettings.GlobalizePath("res://../art-source/environment-20261013/wood-v3.png"));wood.GenerateMipmaps();mat.SetShaderParameter("junction_wood",ImageTexture.CreateFromImage(wood));
                code=code.Replace("void fragment()","uniform sampler2D junction_wood : source_color,filter_linear_mipmap_anisotropic,repeat_enable;\nvoid fragment()");
                code=code.Replace("c *= albedo;",@"c *= albedo;
                if(abs(cell.x-7.0)<.01 && abs(cell.y-3.0)<.01) {
                    float grain=dot(texture(junction_wood,raw_uv).rgb,vec3(.333));
                    float chipped=smoothstep(.66,.78,junction_noise(world.zy*vec2(74.0,240.0)));
                    c.rgb=mix(vec3(.40,.385,.30)*(0.83+grain*.5),vec3(.16,.105,.055),chipped*.34);
                }
                if(world.x>199.87 && world.x<199.89 && world.z>3.9 && world.z<44.1 && world.y<3.01 && abs(cell.x-4.0)<.01 && abs(cell.y-1.0)<.01) {
                    float wav=junction_noise(world.zy*vec2(8.0,.7));
                    c.rgb=vec3(.014,.022,.026)*(0.8+wav*.4);
                }");
                code=code.Replace("NORMAL = normalize(NORMAL + (VIEW_MATRIX * vec4(wall_dn, 0.0)).xyz);","NORMAL = normalize(NORMAL + (VIEW_MATRIX * vec4(wall_dn * 0.23, 0.0)).xyz);");
                code=code.Replace("c.rgb *= wall_relief(layer, g_t.xy, g_t.z, g_n, len, g_gx, g_gy, wall_dn);","c.rgb *= mix(1.0,wall_relief(layer, g_t.xy, g_t.z, g_n, len, g_gx, g_gy, wall_dn),0.30);");
            }
            if(id=="r000202")code=code.Replace("vec2 raw_uv = uv;","if(cell.x>.5 && cell.y<.5)uv*=1.65; vec2 raw_uv = uv;");
            if(id=="r000630")code=code.Replace("vec2 raw_uv = uv;","vec3 jn=normalize((INV_VIEW_MATRIX*vec4(NORMAL,0.0)).xyz); uv=vec2(dot(world,normalize(vec3(jn.z,0.0,-jn.x)))/1.84,-world.y/1.56); uv.x+=floor(junction_hash(vec2(floor(uv.y),17.0))*8.0)/8.0; vec2 raw_uv = uv;");
            code=code.Replace("void fragment()",WeatherFunctions+"\nvoid fragment()");
            string marker="c.rgb *= COLOR.rgb;";
            if(!code.Contains(marker)) marker="c *= COLOR;";
            if(!code.Contains(marker)) marker="ALBEDO = c.rgb * k3;";
            if(!code.Contains(marker)) throw new InvalidOperationException("Missing colour marker "+id);
            var weather="\n c.rgb = junction_weather(c.rgb, world, "+(iron?"1.0":"0.0")+");\n";
            code=code.Replace(marker,marker.StartsWith("ALBEDO")?weather+marker:marker+weather);
            shader.Code=code; mat.Shader=shader; mats[path]=mat; Track(path,mat);
        }
        foreach(var instance in meshes)
        {
            var original=instance.Mesh!; string path=original.ResourcePath;
            string id=System.IO.Path.GetFileNameWithoutExtension(path);
            bool geometry=new[]{"r000879","r000880","r000884","r000878","r000877","r000888","r000881","r000046","r000017","r000008","r000025","r000031","r000263","r000264","r000265"}.Contains(id);
            bool material=Enumerable.Range(0,original.GetSurfaceCount()).Any(s=>mats.ContainsKey(instance.GetActiveMaterial(s)?.ResourcePath??""));
            if(!geometry && !material)continue;
            if(!geometry)
            {
                for(int s=0;s<original.GetSurfaceCount();s++)
                    if(mats.TryGetValue(instance.GetActiveMaterial(s)?.ResourcePath??"",out var replacement))instance.SetSurfaceOverrideMaterial(s,replacement);
                continue;
            }
            var made=new ArrayMesh{ResourceName=original.ResourceName};
            foreach(var key in original.GetMetaList())made.SetMeta(key,original.GetMeta(key));
            for(int s=0;s<original.GetSurfaceCount();s++)
            {
                var mat=instance.GetActiveMaterial(s); if(mat!=null && mats.TryGetValue(mat.ResourcePath,out var replacement))mat=replacement;
                if(id=="r000878")mat=mats["res://world/town/resources/r000630.res"];
                var arrays=geometry && s==0?ReadRows(id+"-repaired.json",instance.GlobalTransform):original.SurfaceGetArrays(s);
                var flags=arrays[(int)Mesh.ArrayType.Custom0].VariantType!=Variant.Type.Nil?(Mesh.ArrayFormat)((long)Mesh.ArrayCustomFormat.RgFloat<<(int)Mesh.ArrayFormat.FormatCustom0Shift):0;
                made.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays,null,null,flags); made.SurfaceSetMaterial(made.GetSurfaceCount()-1,mat);
            }
            if(id=="r000879")Add("ashlar-additions.json","r000648");
            if(id=="r000878")Add("quoin-additions.json","r000636");
            if(id=="r000880")Add("construction-stone.json","r000648");
            if(id=="r000884")Add("construction-iron.json","r000615");
            if(id=="r000880")Add("plants.json","r000648");
            if(id=="r000263")Add("window-joinery.json","r000195");
            void Add(string file,string mat) { var a=ReadRows(file,instance.GlobalTransform);var f=a[(int)Mesh.ArrayType.Custom0].VariantType!=Variant.Type.Nil?(Mesh.ArrayFormat)((long)Mesh.ArrayCustomFormat.RgFloat<<(int)Mesh.ArrayFormat.FormatCustom0Shift):0;made.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,a,null,null,f); made.SurfaceSetMaterial(made.GetSurfaceCount()-1,mats[$"res://world/town/resources/{mat}.res"]); }
            instance.Mesh=made;
            // Material-only meshes keep their resources: material path updates suffice in the live game.
            if(geometry)Track(path,made);
        }
        File.WriteAllText(PathOf("candidate-resources.json"),JsonSerializer.Serialize(originalHashes,new JsonSerializerOptions{WriteIndented=true}));
        if(!promote)return;
        var backup=PathOf("original-resources"); Directory.CreateDirectory(backup);
        foreach(var entry in changed)
        {
            var absolute=ProjectSettings.GlobalizePath(entry.Key);
            if(Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(absolute)))!=originalHashes[entry.Key])throw new IOException("Resource changed while reviewing: "+entry.Key);
            var destination=System.IO.Path.Combine(backup,System.IO.Path.GetFileName(entry.Key));
            if(File.Exists(destination))throw new IOException("Refusing to overwrite repair backup: "+destination);
            File.Copy(absolute,destination);
        }
        // Give replacement materials their existing paths before mesh serialization.
        foreach(var entry in changed.Where(e=>e.Value is ShaderMaterial))
        { if(ResourceSaver.Save(entry.Value,entry.Key)!=Error.Ok)throw new IOException(entry.Key); entry.Value.TakeOverPath(entry.Key); }
        foreach(var entry in changed.Where(e=>e.Value is ArrayMesh))
            if(ResourceSaver.Save(entry.Value,entry.Key)!=Error.Ok)throw new IOException(entry.Key);
        File.WriteAllText(PathOf("promotion.json"),JsonSerializer.Serialize(new{resources=changed.Keys,originalHashes,completed=true},new JsonSerializerOptions{WriteIndented=true}));
    }
    static Godot.Collections.Array ReadRows(string file,Transform3D transform)
    {
        var rows=JsonSerializer.Deserialize<float[][]>(File.ReadAllText(PathOf(file)))!;
        var p=new Vector3[rows.Length]; var n=new Vector3[rows.Length]; var uv=new Vector2[rows.Length]; var uv2=new Vector2[rows.Length]; var c=new Color[rows.Length]; var inverse=transform.AffineInverse();
        for(int i=0;i<rows.Length;i++)
        {var r=rows[i]; p[i]=inverse*new Vector3(r[0],r[1],r[2]); n[i]=(transform.Basis.Transposed()*new Vector3(r[3],r[4],r[5])).Normalized();uv[i]=new(r[6],r[7]);uv2[i]=new(r[8],r[9]);c[i]=new(r[10],r[11],r[12],r[13]);}
        var a=new Godot.Collections.Array();a.Resize((int)Mesh.ArrayType.Max);a[(int)Mesh.ArrayType.Vertex]=p;a[(int)Mesh.ArrayType.Normal]=n;a[(int)Mesh.ArrayType.TexUV]=uv;a[(int)Mesh.ArrayType.TexUV2]=uv2;a[(int)Mesh.ArrayType.Color]=c;
        if(rows.Length>0 && rows[0].Length>=16)a[(int)Mesh.ArrayType.Custom0]=rows.SelectMany(r=>new[]{r[14],r[15]}).ToArray();
        return a;
    }
    const string WeatherFunctions=@"
float junction_hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float junction_noise(vec2 p) {
 vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
 return mix(mix(junction_hash(i),junction_hash(i+vec2(1,0)),f.x),mix(junction_hash(i+vec2(0,1)),junction_hash(i+vec2(1,1)),f.x),f.y);
}
vec3 junction_weather(vec3 color, vec3 p, float iron) {
 vec2 q=p.xz-vec2(212.9183,30.7344);
 float a=dot(q,vec2(.16092,.98697)), o=dot(q,vec2(.98697,-.16092));
 float local=(1.0-smoothstep(16.0,18.0,a))*smoothstep(-1.0,0.0,a)*(1.0-smoothstep(4.6,5.6,abs(o)));
 float coarse=junction_noise(p.xz*1.8+vec2(p.y*.4));
 float fine=junction_noise(p.xz*13.0+vec2(p.y*11.0));
 float splash=(1.0-smoothstep(.01,.24+coarse*.75,p.y))*local;
 float ground=(1.0-smoothstep(.05,.16,p.y))*exp(-abs(o+2.3)*1.6)*local;
 float dirt=clamp(max(splash*.95,ground*.95)*(.45+.55*coarse),0.0,.90);
 color=mix(color,color*vec3(.39,.37,.30),dirt);
 color=mix(color,color*vec3(.36,.34,.25),ground*(.48+.30*coarse));
 // Vertical runs originate at coping joints; quiet variation breaks regular tile reads.
 float drip=pow(junction_noise(vec2(a*3.0,2.0)),7.0)*exp(-p.y*.9)*local;
 color*=1.0-drip*.26;
 float postA=.25+clamp(round((a-.25)/(11.45/9.0)),0.0,9.0)*(11.45/9.0);
 float socketY=.3+postA*6.5/11.7;
 float rust=exp(-abs(a-postA)*48.0)*exp(-abs(o+2.05)*9.0)*smoothstep(socketY-.5,socketY-.05,p.y)*(1.0-smoothstep(socketY+.015,socketY+.035,p.y))*local*(1.0-iron);
 color=mix(color,color*vec3(.64,.37,.18),rust*.43);
 float moss=smoothstep(.44,.72,coarse)*(.45+.55*fine)*max(splash,ground)*.75*(1.0-iron);
 color=mix(color,color*vec3(.44,.56,.29),moss);
 // Splash from the actual house shoe meets its cross-channel and street gutter.
 float shoe=exp(-length((p.xz-vec2(200.55,43.74))*vec2(1.9,3.6)))*(1.0-smoothstep(.1,.6,p.y));
 color=mix(color,color*vec3(.38,.40,.31),shoe*.55);
 float guard=smoothstep(6.4,6.49,p.y)*(1.0-smoothstep(6.55,7.10+coarse*.3,p.y))*exp(-length(p.xz-vec2(222.55,47.23))*1.5);
 color=mix(color,color*vec3(.36,.42,.27),guard*(.45+.30*coarse));
 float age=junction_noise(p.xz*.29+vec2(p.y*.7));
 color*=.82+.18*age;
 float runoff=pow(junction_noise(vec2(a*2.1,5.7)),4.0)*(.5+.5*junction_noise(vec2(a*8.0,p.y*.35)));
 color*=1.0-local*runoff*.22;
 return color*(1.0-psx_wet*(.22-.10*iron));
}
";
}
