using System;

namespace Scheldemist.People;

public sealed partial class NativeMarketLayout
{
    private void Dress(NativeMarketItem it,string[] awnings,Func<double> R,bool rough)
    {
        bool S(string name)=>has("stalls",name);
        void Put(string source,string name,double u,double y,double v,double yaw=0,double[]? scale=null,double[]? tint=null,string? awning=null,bool solid=true)
        {if(has(source,name))it.Puts.Add(new(){Source=source,Name=name,U=u,Y=y,V=v,Yaw=yaw,Scale=scale??new[]{1.0,1,1},Tint=tint,Awning=awning,Solid=solid});}
        void St(string name,double u,double y,double v,double yaw=0,double[]? scale=null,double[]? tint=null,string? awning=null,bool solid=true)=>Put("stalls",name,u,y,v,yaw,scale,tint,awning,solid);
        void Tr(string name,double u,double y,double v,double yaw=0,double[]? scale=null,double[]? tint=null,bool solid=true)=>Put("trades",name,u,y,v,yaw,scale,tint,null,solid);
        double shade=.82+R()*.3;double[] tint={shade*(.92+R()*.16),shade*(.92+R()*.16),shade*(.92+R()*.16)};
        void Mud(bool big,double chance){if(rough&&R()<chance)St(big?"mk2_mud":"mk2_mud_small",(R()-.5)*.4,0,(R()-.5)*.3,(R()-.5)*.6,solid:false);}
        bool ownBack=false;double hl=it.HalfLength,hd=it.HalfDepth;
        switch(it.Kind){
            case "stall":{
                double sx=hl*2/2.8,sy=.93+R()*.14;St("stall_frame",0,0,0,scale:new[]{sx,sy,1});
                int aw=(int)Math.Floor(R()*awnings.Length);string? awning=aw<awnings.Length?awnings[aw]:null;double[] tw={.75+R()*.4,.75+R()*.35,.75+R()*.4};St("stall_awning",0,0,0,scale:new[]{sx,sy,1},tint:tw,awning:awning);
                double top=.85*sy;if(!rough&&it.Goods!="fish")St("stall_cloth",0,0,0,scale:new[]{sx,sy,1});
                switch(it.Goods){
                    case "cheese":case "junk":St("mk2_goods_"+it.Goods,0,top-.785,0,scale:new[]{Math.Min(1.25,sx),1,1});break;
                    case "baskets":Tr("mk_goods_baskets",0,top,0,scale:new[]{Math.Min(1.2,sx),1,1});break;
                    default:St("stall_goods_"+it.Goods,0,0,0,scale:new[]{sx,sy,1});St("stall_more_"+it.Goods,0,0,0,scale:new[]{sx,sy,1});break;
                }
                if(it.Goods!="fish")St("mk2_under",(R()-.5)*.4,0,.05,(R()-.5)*.3);Mud(true,.55);break;
            }
            case "table":{
                bool neat=!rough||it.Goods=="bread";
                if(neat&&it.Goods!="fish"){
                    St("mk2_trestle_cloth",0,0,0,tint:tint);
                    if(it.Goods is"cheese"or"bread"or"junk")St("mk2_goods_"+it.Goods,0,0,0);
                    else if(it.Goods=="veg"){St("shop_goods_veg",0,-.02,-.6);St("shop_more_veg",0,-.02,-.6);}
                    else Tr("mk_goods_"+it.Goods,0,.78,0);
                }else{
                    St("shop_table",0,0,-.6,scale:new[]{1.0,.95+R()*.1,1},tint:tint);string g=it.Goods=="cloth"?"wares":it.Goods;
                    if(S("shop_goods_"+g)){St("shop_goods_"+g,0,0,-.6);St("shop_more_"+g,0,0,-.6);}else Tr("mk_goods_"+it.Goods,0,.8,0);
                }
                Mud(false,.6);break;
            }
            case "fishtable":St("mk2_fish_table",0,0,0,tint:tint);St("mk2_fish_crates",.3,0,-.98,(R()-.5)*.2);it.SellerAt=new(-.45+(R()-.5)*.3,-.95);ownBack=true;break;
            case "vegstall":St("mk2_veg_stall",0,0,0,tint:tint);it.SellerAt=new((R()-.5)*.6,-.95);ownBack=true;break;
            case "pottery":St("mk2_pottery",0,0,0,(R()-.5)*.1);it.SellerAt=new(-.45,-1.05);ownBack=true;Mud(false,.4);break;
            case "brazier":St("mk2_brazier",0,0,0);it.SellerAt=new(.05,-.68);ownBack=true;break;
            case "clothstall":St("mk2_trestle_cloth",0,0,0,tint:tint);St("mk2_cloth_stall",0,0,0);it.SellerAt=new((R()-.5)*.5,-.95);break;
            case "bench":Tr("mk_bench",0,0,0);Mud(false,.7);break;
            case "barrow":Tr(it.Goods=="fish"?"mk_barrow_fish":"mk_barrow_veg",0,0,0,Math.PI/2+(R()-.5)*.3);Mud(false,.5);break;
            case "cart":Tr("mk_cart",-.4,0,0,Math.PI/2+(R()-.5)*.2);Mud(true,.5);break;
            case "baskets":{
                if(it.Goods=="veg"&&R()<.5){St("mk2_ground_baskets",0,0,0,(R()-.5)*.3);ownBack=true;}
                else{int n=hl>.9?2:1;for(int i=0;i<n;i++)Tr(it.Goods=="fish"?"mk_basket_fish":"mk_basket_veg",(i-(n-1)/2.0)*.95-.2,0,.05,R()*6);}Mud(false,.5);break;
            }
        }
        if(!ownBack&&it.Kind!="barrow"&&R()<.75)Tr(it.Goods=="fish"?"mk_crates":R()<.5?"mk_crates":"mk_basket_tall",(R()<.5?-1:1)*(hl-.4),0,-hd-.7,(R()-.5)*.6);
        if(it.Sits){var e=Extent(it.Puts,1.3,it.SellerAt.X-.3,it.SellerAt.X+.3);it.SellerAt=new(it.SellerAt.X,Math.Min(it.SellerAt.Z,e.V0-.3));if(S("mk2_stool"))St("mk2_stool",it.SellerAt.X,0,it.SellerAt.Z,R()*6,solid:false);else Tr("mk_stool",it.SellerAt.X,0,it.SellerAt.Z,R()*6,solid:false);}
        if(it.Goods=="fish"&&it.Kind is"stall"or"bench"or"fishtable"&&R()<.2)Tr("mk_gull",(R()-.5)*hl,it.Kind=="bench"?.8:.86,.1,R()*6,solid:false);
        if(it.Goods=="fish"&&it.Kind!="fishtable"&&R()<.35)Tr("mk_fishbox",(R()<.5?-1:1)*(hl-.3),0,hd+.2,(R()-.5)*.8);
        if(it.Goods=="veg"&&it.Kind!="vegstall"&&R()<.3)Tr("mk_leaves",0,0,hd+.8,R()*6,solid:false);
    }
}
