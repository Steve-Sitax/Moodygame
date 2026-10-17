using Godot;
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using System.Security.Cryptography;

public static class WallCircuitRepair
{
    const string Folder="res://proof/wall-circuit";
    static string P(string file)=>ProjectSettings.GlobalizePath(Folder+"/"+file);
    static string Hash(string path)=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();
    static IEnumerable<Node> All(Node n){yield return n;foreach(var c in n.GetChildren())foreach(var d in All(c))yield return d;}
    public static void Apply(Node root,bool promote)
    {
        if(promote&&OS.GetCmdlineUserArgs().Any(a=>(a.StartsWith("--circuit-")&&a!="--circuit-promote")||a=="--no-shadows"))throw new IOException("Diagnostic views cannot be promoted.");
        var geometry=JsonDocument.Parse(File.ReadAllText(P("mesh-manifest.json"))).RootElement;
        var hashes=JsonSerializer.Deserialize<Dictionary<string,string>>(File.ReadAllText(P("source-hashes.json")))!;
        var changed=new Dictionary<string,Resource>();var mats=new Dictionary<string,ShaderMaterial>();
        string[] ids={"r000630","r000642","r000648","r000615","r000636","r000735","r000657","r000016","r000024","r000007","r000045","r000609","r000677","r000761","r000030","r000767","r000729","r000671","r000796","r000195"};
        var sourceMaterials=promote?JsonSerializer.Deserialize<Dictionary<string,string>>(File.ReadAllText(P("candidate-material-hashes.json")))!:new();
        var materialHashes=new Dictionary<string,string>();
        foreach(var id in ids)
        {
            string path=$"res://world/town/resources/{id}.res";var old=ResourceLoader.Load<ShaderMaterial>(path);
            if(old==null)throw new IOException(path);
            string hash=Hash(path);materialHashes[path]=hash;
            if(promote&&sourceMaterials[path]!=hash)throw new IOException("Material changed since review: "+path);
            var mat=(ShaderMaterial)(id=="r000729"?ResourceLoader.Load<ShaderMaterial>("res://world/town/resources/r000648.res"):old).Duplicate(true);var shader=(Shader)mat.Shader.Duplicate();string code=shader.Code;
            if(id=="r000195")
            {
                // Generated house damp and the generic foot shader stacked to almost black.
                // Bound their combined darkening while retaining the underlying brick grain.
                code=code.Replace("vec4 c = texture(tex, uv);","vec4 c = texture(tex, uv); vec3 circuit_pre_damp=c.rgb;");
                code=code.Replace("float g_top =", "circuit_pre_damp=c.rgb; float g_top =");
                code=code.Replace("ALBEDO = c.rgb * k3;","c.rgb=max(c.rgb,circuit_pre_damp*COLOR.rgb*0.45); ALBEDO = c.rgb * k3;");
                shader.Code=code;mat.Shader=shader;mats[path]=mat;changed[path]=mat;continue;
            }
            code=code.Replace("bump_map : filter_linear_mipmap,","bump_map : filter_linear_mipmap_anisotropic,");
            // Keep legacy noise in its intended domain before powers. This bound removes
            // the observed black streaks; exact GPU intermediate values were not measured.
            code=code.Replace("return mix(mix(junction_hash(i),junction_hash(i+vec2(1,0)),f.x),mix(junction_hash(i+vec2(0,1)),junction_hash(i+vec2(1,1)),f.x),f.y);",
                "return clamp(mix(mix(junction_hash(i),junction_hash(i+vec2(1,0)),f.x),mix(junction_hash(i+vec2(0,1)),junction_hash(i+vec2(1,1)),f.x),f.y),0.0,1.0);");
            // High-resolution material grain and circuit weather replace the old coarse colour mottle.
            mat.SetShaderParameter("mottle",0f);
            // Retire the coarse floating moss cutouts; circuit_weather lives on the real stone surface.
            if(id=="r000796"){mat.SetShaderParameter("albedo",new Color(1,1,1,0));mat.SetShaderParameter("alpha_cut",.5f);}
            if(code.Contains("circuit_weather"))throw new IOException("Repair already installed; use --circuit-installed.");
            if(!code.Contains("global uniform float psx_wet"))code=code.Replace("void fragment()","global uniform float psx_wet;\nvoid fragment()");
            code=code.Replace("void fragment()",Weather()+"\nvoid fragment()");
            string marker="c.rgb *= COLOR.rgb;";
            if(!code.Contains(marker))marker="c *= COLOR;";
            if(!code.Contains(marker))marker="ALBEDO = c.rgb * k3;";
            string weather="\n c.rgb=circuit_weather(c.rgb,world,"+(id=="r000615"?"1.0":"0.0")+");\n";
            code=code.Replace(marker,marker.StartsWith("ALBEDO")?weather+marker:marker+weather);
            if(id=="r000630")
            {
                (mat.GetShaderParameter("tex").AsGodotObject() as Texture2D)?.GetImage().SavePng(P("active-brick-texture.png"));
                mat.SetShaderParameter("bump_map",Texture("wall-brick-height-soft.png"));
                code=code.Replace("uv.x+=floor(junction_hash", "if(UV2.x>76.5)uv=UV; vec2 circuit_dx=dFdx(uv),circuit_dy=dFdy(uv); uv.x+=floor(junction_hash");
                // Shift entire courses at measured mortar centres. The photographed bond
                // is irregular: idealized horizontal cell boundaries can cut real bricks.
                code=code.Replace("uv.x+=floor(junction_hash(vec2(floor(uv.y),17.0))*8.0)/8.0;",
                    "float circuit_y=fract(uv.y)*1161.0; float circuit_row=0.0; float circuit_joints[23]=float[23](45.0,94.0,143.0,192.0,242.0,290.0,338.0,385.0,434.0,482.0,532.0,579.0,629.0,677.0,725.0,772.0,821.0,869.0,917.0,966.0,1016.0,1064.0,1114.0); for(int ci=0;ci<23;ci++){circuit_row+=step(circuit_joints[ci],circuit_y);} circuit_row+=floor(uv.y)*24.0; float circuit_phase=mod(circuit_row,2.0)<0.5?0.0325:(mod(circuit_row,4.0)<2.0?0.0625:0.0025); uv.x=mod(uv.x+floor(junction_hash(vec2(circuit_row,17.0))*7.0)/8.0-circuit_phase,0.875)+circuit_phase;");
                code=code.Replace("texture(tex, uv)","textureGrad(tex,uv,circuit_dx,circuit_dy)").Replace("texture(bump_map, raw_uv)","textureGrad(bump_map,raw_uv,circuit_dx,circuit_dy)");
                code=code.Replace("void fragment()",BrickNormal()+"\nvoid fragment()");
                code=code.Replace("metric_surface_normal(VERTEX, NORMAL, textureGrad(bump_map,raw_uv,circuit_dx,circuit_dy).r * 0.004)","circuit_brick_normal(VERTEX,NORMAL,raw_uv,circuit_dx,circuit_dy)");
            }
            if(id is "r000630" or "r000648")
            {
                // Approximate warm reflected light only inside the four enclosed gate vaults.
                // It follows the actual lamp power/range and stops when that lamp is off.
                code=code.Replace("vec3 spill_one(",VaultBounce()+"\nvec3 spill_one(");
                code=code.Replace("psx_lamp_cap(D.y, d.y / max(dl, 1e-4))", "circuit_vault_cap(P,A.xyz,D.y,d.y/max(dl,1e-4))");
            }
            if(id=="r000648"||id=="r000729")code=code.Replace("je*=smoothstep(-3.5,-3.2,jo)","je*=smoothstep(-1.0,-.85,ja)*(1.0-smoothstep(-2.2,-1.8,jo))*smoothstep(-3.5,-3.2,jo)");
            if(id is "r000648" or "r000636" or "r000735" or "r000729")
                code=code.Replace("texture(bump_map, raw_uv).r * 0.0007","dot(texture(tex,raw_uv).rgb,vec3(.333)) * 0.00025");
            if(id=="r000636"||id=="r000735")
                code=code.Replace("vec3 jn=normalize((INV_VIEW_MATRIX*vec4(NORMAL,0.0)).xyz); uv=abs(jn.y)>.7?world.xz/1.2:vec2(dot(world,normalize(vec3(jn.z,0.0,-jn.x))),-world.y)/1.2; ","");
            if(id=="r000729")mat.SetShaderParameter("albedo",new Color(.36f,.30f,.23f));
            if(id=="r000671")
            {
                code=code.Replace("vec4 c = texture(tex, uv);","vec4 c=vec4(vec3(.025,.036,.042)*(0.9+0.1*circuit_noise(world.xy*15.0)),1.0);");
                code=code.Replace("NORMAL = bump_normal(VERTEX, NORMAL, bump_dh(raw_uv, vec2(0.0), VIEWPORT_SIZE.y / 270.0));","");
            }
            if(id=="r000609"||id=="r000677")
            {
                mat.SetShaderParameter("tex",Texture(id=="r000609"?"wall-wood.png":"wall-crest.png"));
                code=code.Replace("void fragment()",File.ReadAllText(ProjectSettings.GlobalizePath("res://shaders/surface_normal.gdshaderinc"))+"\nvoid fragment()");
                code=code.Replace("NORMAL = bump_normal(VERTEX, NORMAL, bump_dh(raw_uv, vec2(0.0), VIEWPORT_SIZE.y / 270.0));","NORMAL=metric_surface_normal(VERTEX,NORMAL,dot(texture(tex,raw_uv).rgb,vec3(.333))*"+(id=="r000609"?".0012":".004")+");");
                mat.SetShaderParameter("albedo",Colors.White);
                if(id=="r000609")
                {
                    mat.SetShaderParameter("uv_xform",new Vector4(1,1,0,0));
                    code=code.Replace("c *= albedo;",@"c *= albedo;
                    if(UV2.x>77.5){float rings=.5+.5*sin(length(uv*vec2(1.0,1.3))*160.0+circuit_noise(uv*20.0)*3.0);c.rgb*=.78+.22*rings;}");
                }
                if(id=="r000677")
                {
                    mat.SetShaderParameter("circuit_stone",Texture("stair-stone.png"));
                    code=code.Replace("void fragment()","uniform sampler2D circuit_stone:source_color,filter_linear_mipmap_anisotropic,repeat_enable;\nvoid fragment()");
                    code=code.Replace("vec2 uv = UV;","vec2 uv=vec2((UV.x-.5)*2.27+.5,UV.y);");
                    code=code.Replace("vec4 c = texture(tex, uv);","vec4 c=uv.x>=0.0&&uv.x<=1.0?texture(tex,uv):texture(circuit_stone,UV*vec2(3.5,1.54));");
                }
            }
            if(id=="r000761"||id=="r000030")
            {
                mat.SetShaderParameter("tex",Texture("wall-grass.png"));mat.SetShaderParameter("relief_depth",0f);mat.SetShaderParameter("relief_bump",.14f);mat.SetShaderParameter("relief_dome",.08f);
                code=code.Replace("vec2 uv = UV;","vec2 uv=world.xz/2.0;");
                code=code.Replace("return texture(relief_h, uv).r;","return dot(texture(tex,uv).rgb,vec3(.333));").Replace("return texture(relief_h, uv, 2.0).r;","return dot(texture(tex,uv,2.0).rgb,vec3(.333));");
                code=code.Replace("ground_tilt(world, UV, sl","ground_tilt(world, uv, sl");
                mat.SetShaderParameter("albedo",new Color(.9f,.92f,.83f));
            }
            if(id=="r000767")
            {
                mat.SetShaderParameter("tex",Texture("wall-grass.png"));mat.SetShaderParameter("circuit_earth",Texture("earth.png"));mat.SetShaderParameter("albedo",Colors.White);
                code=code.Replace("void fragment()","uniform sampler2D circuit_earth:source_color,filter_linear_mipmap_anisotropic,repeat_enable;\nvoid fragment()");
                code=code.Replace("vec4 c = texture(tex, uv);",@"float edge=uv.y>.5?smoothstep(.53,.88,uv.y):1.0-smoothstep(.12,.25,abs(uv.y-.25));
                float breakup=circuit_noise(world.xz*29.0)*.20+circuit_noise(world.xz*7.0)*.16;
                float mask=smoothstep(.23,.65,edge-breakup);
                vec4 c=uv.y>.5?texture(tex,world.xz/2.0):texture(circuit_earth,world.xz/1.8);c.a=mask;");
            }
            if(OS.GetCmdlineUserArgs().Contains("--circuit-nobump"))code=System.Text.RegularExpressions.Regex.Replace(code,@"NORMAL = (metric_surface_normal|circuit_brick_normal)\([^;]+;","NORMAL=NORMAL;");
            if(OS.GetCmdlineUserArgs().Contains("--circuit-cull"))code=code.Replace("cull_disabled","cull_back");
            if(OS.GetCmdlineUserArgs().Contains("--circuit-raw"))code=code.Replace("c.rgb *= COLOR.rgb;","").Replace("c *= COLOR;","").Replace("c.rgb = junction_weather(c.rgb, world, 0.0);","").Replace("c.rgb=circuit_weather(c.rgb,world,0.0);","");
            if(OS.GetCmdlineUserArgs().Contains("--circuit-noweather"))code=code.Replace("c.rgb=circuit_weather(c.rgb,world,0.0);","");
            if(OS.GetCmdlineUserArgs().Contains("--circuit-nojunction"))code=code.Replace("c.rgb = junction_weather(c.rgb, world, 0.0);","");
            if(OS.GetCmdlineUserArgs().Contains("--circuit-nocolor"))code=code.Replace("c.rgb *= COLOR.rgb;","").Replace("c *= COLOR;","");
            shader.Code=code;mat.Shader=shader;mats[path]=mat;changed[path]=mat;
            if(id=="r000630")File.WriteAllText(P("candidate-brick.gdshader"),code);
            if(OS.GetCmdlineUserArgs().Contains("--circuit-flat"))
            {
                shader.Code=System.Text.RegularExpressions.Regex.Replace(code,@"NORMAL = metric_surface_normal\([^;]+;","NORMAL=NORMAL;").Replace("ALBEDO = c.rgb * k3;","c=vec4(.5);ALBEDO = c.rgb * k3;");mat.SetShaderParameter("mottle",0f);mat.SetShaderParameter("foot",0f);
            }
            if(id=="r000636") {File.WriteAllText(P("candidate-quoin.gdshader"),code);GD.Print("Quoin UV transform: "+mat.GetShaderParameter("uv_xform"));}
            if(id=="r000648")GD.Print("Stone UV "+mat.GetShaderParameter("uv_xform")+" foot "+mat.GetShaderParameter("foot")+" tex "+mat.GetShaderParameter("tex"));
        }
        foreach(var instance in All(root).OfType<MeshInstance3D>().Where(m=>m.Mesh!=null).ToArray())
        {
            var old=instance.Mesh!;string path=old.ResourcePath;
            if(!geometry.TryGetProperty(path,out var spec))
            {
                for(int s=0;s<old.GetSurfaceCount();s++)if(mats.TryGetValue(instance.GetActiveMaterial(s)?.ResourcePath??"",out var m))instance.SetSurfaceOverrideMaterial(s,m);
                continue;
            }
            if(Hash(path)!=hashes[path])throw new IOException("Source mesh changed after export: "+path);
            var mesh=new ArrayMesh{ResourceName=old.ResourceName};foreach(var key in old.GetMetaList())mesh.SetMeta(key,old.GetMeta(key));
            foreach(var surface in spec.EnumerateArray())
            {
                if(surface.GetProperty("vertices").GetInt32()==0)continue;
                var arrays=Read(surface,instance.GlobalTransform);
                var flags=surface.GetProperty("custom0").GetBoolean()?(Mesh.ArrayFormat)((long)Mesh.ArrayCustomFormat.RgFloat<<(int)Mesh.ArrayFormat.FormatCustom0Shift):0;
                mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays,null,null,flags);
                if(path.EndsWith("r000878.res"))
                {
                    var input=arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();var decoded=mesh.SurfaceGetArrays(mesh.GetSurfaceCount()-1)[(int)Mesh.ArrayType.TexUV].AsVector2Array();float error=0;
                    for(int k=0;k<input.Length;k++)error=Math.Max(error,input[k].DistanceTo(decoded[k]));GD.Print("Quoin UV storage error: "+error);
                }
                string mp=surface.GetProperty("material").GetString()!;
                mesh.SurfaceSetMaterial(mesh.GetSurfaceCount()-1,mats.TryGetValue(mp,out var mat)?mat:ResourceLoader.Load<Material>(mp));
            }
            instance.Mesh=mesh;changed[path]=mesh;
        }
        File.WriteAllText(P("candidate-material-hashes.json"),JsonSerializer.Serialize(materialHashes,new JsonSerializerOptions{WriteIndented=true}));
        GD.Print("Wall circuit candidate: "+changed.Count+" resources");
        if(!promote)return;
        Directory.CreateDirectory(P("original-resources"));
        foreach(var e in changed)
        {
            string expected=hashes.TryGetValue(e.Key,out var h)?h:materialHashes[e.Key];
            if(Hash(e.Key)!=expected)throw new IOException("Concurrent change: "+e.Key);
            File.Copy(ProjectSettings.GlobalizePath(e.Key),P("original-resources/"+Path.GetFileName(e.Key)),false);
        }
        foreach(var e in changed.Where(e=>e.Value is ShaderMaterial)){if(ResourceSaver.Save(e.Value,e.Key)!=Error.Ok)throw new IOException(e.Key);e.Value.TakeOverPath(e.Key);}
        foreach(var e in changed.Where(e=>e.Value is ArrayMesh))if(ResourceSaver.Save(e.Value,e.Key)!=Error.Ok)throw new IOException(e.Key);
        File.WriteAllText(P("promotion.json"),JsonSerializer.Serialize(new{resources=changed.Keys,installedHashes=changed.Keys.ToDictionary(p=>p,Hash),sourceMeshes=hashes,sourceMaterials=materialHashes},new JsonSerializerOptions{WriteIndented=true}));
    }
    static Texture2D Texture(string file){var image=Image.LoadFromFile(ProjectSettings.GlobalizePath("res://assets/materials/environment-20261013/"+file));image.GenerateMipmaps();return ImageTexture.CreateFromImage(image);}
    static Godot.Collections.Array Read(JsonElement spec,Transform3D transform)
    {
        var bytes=File.ReadAllBytes(P("geometry/"+spec.GetProperty("file").GetString()));var data=new float[bytes.Length/4];Buffer.BlockCopy(bytes,0,data,0,bytes.Length);int count=data.Length/16;
        var pos=new Vector3[count];var norm=new Vector3[count];var uv=new Vector2[count];var uv2=new Vector2[count];var col=new Color[count];var custom=new float[count*2];var inv=transform.AffineInverse();
        for(int i=0;i<count;i++){int j=i*16;pos[i]=inv*new Vector3(data[j],data[j+1],data[j+2]);norm[i]=(transform.Basis.Transposed()*new Vector3(data[j+3],data[j+4],data[j+5])).Normalized();uv[i]=new(data[j+6],data[j+7]);uv2[i]=new(data[j+8],data[j+9]);col[i]=new(data[j+10],data[j+11],data[j+12],data[j+13]);custom[i*2]=data[j+14];custom[i*2+1]=data[j+15];}
        var a=new Godot.Collections.Array();a.Resize((int)Mesh.ArrayType.Max);a[(int)Mesh.ArrayType.Vertex]=pos;a[(int)Mesh.ArrayType.Normal]=norm;a[(int)Mesh.ArrayType.TexUV]=uv;a[(int)Mesh.ArrayType.TexUV2]=uv2;a[(int)Mesh.ArrayType.Color]=col;
        if(spec.GetProperty("custom0").GetBoolean())a[(int)Mesh.ArrayType.Custom0]=custom;
        return a;
    }
    static string VaultBounce()
    {
        var gates=JsonDocument.Parse(File.ReadAllText(P("coverage.json"))).RootElement.GetProperty("layout").GetProperty("gates");
        string F(float v)=>v.ToString("0.00000",System.Globalization.CultureInfo.InvariantCulture);
        string zones="";
        foreach(var gate in gates.EnumerateArray())
        {
            float x=0,z=0;foreach(var corner in gate.GetProperty("house").EnumerateArray()){x+=corner[0].GetSingle()/4;z+=corner[1].GetSingle()/4;}
            var normal=gate.GetProperty("out");float nx=normal[0].GetSingle(),nz=normal[1].GetSingle();
            zones+=$"{{vec2 c=vec2({F(x)},{F(z)}),q=p.xz-c;float side=abs(dot(q,vec2({F(-nz)},{F(nx)})));float depth=abs(dot(q,vec2({F(nx)},{F(nz)})));zone=max(zone,(1.0-smoothstep(2.5,2.8,side))*(1.0-smoothstep(5.8,6.3,depth))*(1.0-smoothstep(.4,.9,length(lamp.xz-c))));}}\n";
        }
        return "float circuit_vault_cap(vec3 p,vec3 lamp,float decay,float up){float original=psx_lamp_cap(decay,up);if(abs(decay-1.7)>.001)return original;float zone=0.0;\n"+zones+@"
 zone*=smoothstep(2.8,3.3,p.y)*(1.0-smoothstep(6.3,6.8,p.y));
 float reflected=.42*(.18+.82*(1.0-smoothstep(.3,1.0,up)));
 return mix(original,reflected,zone*smoothstep(.2,.35,up));
}
";
    }
    static string BrickNormal()=>@"
vec3 circuit_brick_normal(vec3 position,vec3 normal,vec2 uv,vec2 dx,vec2 dy){
 vec2 step_uv=2.0/vec2(textureSize(bump_map,0));
 float hx=(textureGrad(bump_map,uv+vec2(step_uv.x,0),dx,dy).r-textureGrad(bump_map,uv-vec2(step_uv.x,0),dx,dy).r)/ (2.0*step_uv.x);
 float hy=(textureGrad(bump_map,uv+vec2(0,step_uv.y),dx,dy).r-textureGrad(bump_map,uv-vec2(0,step_uv.y),dx,dy).r)/ (2.0*step_uv.y);
 vec2 gradient_uv=vec2(hx,hy)*.004;
 vec3 sx=dFdx(position),sy=dFdy(position),r1=cross(sy,normal),r2=cross(normal,sx);
 float determinant=dot(sx,r1);
 vec3 gradient=sign(determinant)*(dot(gradient_uv,dx)*r1+dot(gradient_uv,dy)*r2);
 return normalize(max(abs(determinant),1e-12)*normal-gradient);
}
";
    static string Weather()
    {
        var cov=JsonDocument.Parse(File.ReadAllText(P("coverage.json"))).RootElement;
        string F(float v)=>v.ToString("0.00000",System.Globalization.CultureInfo.InvariantCulture);
        string V(JsonElement a)=>"vec2("+F(a[0].GetSingle())+","+F(a[1].GetSingle())+")";
        string segments="";
        foreach(var s in cov.GetProperty("layout").GetProperty("segments").EnumerateArray())segments+=$"{{vec2 q=p.xz-{V(s.GetProperty("o"))};float a=dot(q,{V(s.GetProperty("t"))});float o=dot(q,{V(s.GetProperty("n"))});float end=max(-a,a-{F(s.GetProperty("len").GetSingle())});float edge=p.y>6.3?min(abs(o+6.58),abs(o+.65)):min(abs(o+7.0),abs(o));d=min(d,length(vec2(max(end,0.0),edge)));}}\n";
        foreach(var st in cov.GetProperty("stairs").EnumerateArray())segments+=$"{{vec2 q=p.xz-{V(st.GetProperty("foot"))};float a=dot(q,{V(st.GetProperty("t"))});float o=dot(q,{V(st.GetProperty("n"))});d=min(d,length(vec2(max(max(-a,a-{F(st.GetProperty("run").GetSingle())}),0.0),abs(o+2.3))));}}\n";
        string huts="";
        foreach(var h in cov.GetProperty("huts").EnumerateArray())huts+=$"{{vec2 q=p.xz-{V(h.GetProperty("center"))};vec2 a=abs(vec2(dot(q,{V(h.GetProperty("front"))}),dot(q,{V(h.GetProperty("side"))})));float edge=abs(max(a.x,a.y)-1.88);if(max(a.x,a.y)<3.4&&p.y>6.35){{d=min(d,edge);base=6.5;}}}}\n";
        return @"
float circuit_hash(vec2 q){return fract(sin(dot(q,vec2(127.1,311.7)))*43758.5453);}
float circuit_noise(vec2 q){q+=vec2(sin(q.y*.71),cos(q.x*.63))*.37;return clamp(.5+.22*sin(q.x*1.37+sin(q.y*1.81))+.16*sin(q.y*2.11+cos(q.x*.93))+.12*sin(q.x*3.71+q.y*2.79),0.0,1.0);}
vec3 circuit_weather(vec3 color,vec3 p,float iron){float d=1000.0;float base=0.0;
"+segments+huts+@"
if(p.y>6.3&&p.y<8.0&&d<1.6)base=6.5;
if(p.x> -319.0&&p.x< -278.0&&p.z>294.0&&p.z<329.0&&p.y<2.0)base=-.35;
float y=p.y-base;float noise=.50*circuit_noise(p.xz*1.7+vec2(p.y*.93,-p.y*.63))+.30*circuit_noise(vec2(dot(p.xz,vec2(.61,.79))*4.7,p.y*4.3))+.20*circuit_noise(vec2(dot(p.xz,vec2(-.79,.61))*11.0,p.y*13.0));
float band=(1.0-smoothstep(.04,.42+noise*.85,y))*exp(-d*1.4)*smoothstep(-.18,-.015,y);
float fine=circuit_noise(vec2(dot(p.xz,vec2(.79,.61))*27.0,p.y*29.0));float damp=band*(.35+.65*noise);
color=mix(color,color*vec3(.28,.30,.22),damp*.94);
float moss=band*smoothstep(.40,.72,noise)*(.2+.8*fine)*(1.0-iron);
color=mix(color,color*vec3(.36,.51,.21),moss*.82);
float contact=exp(-max(y,0.0)*5.0)*exp(-d*1.5)*(.55+.45*noise)*smoothstep(-.18,-.015,y);
float vertical=1.0-smoothstep(.55,.85,abs(normalize(cross(dFdx(p),dFdy(p))).y));
color=mix(color,color*vec3(.08,.105,.055),contact*mix(.72,.94,vertical));
// Persistent wet joints at the pond have a visible narrow algae/splash zone.
float waterline=base<-.3?(1.0-smoothstep(.03,.31+noise*.18,y))*smoothstep(-.12,-.01,y):0.0;
color=mix(color,vec3(.024,.046,.012)*(.8+.4*fine),waterline*(.62+.25*fine));
color*=1.0-psx_wet*.12;
float age=circuit_noise(p.xz*.17+vec2(p.y*.21));color*=.91+.12*age;
return color;
}
";
    }
}
