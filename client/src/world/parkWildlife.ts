import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { ParkEcology, type ParkHabitat, type ParkEnvironment, type Point } from "../../../shared/parkWildlife";
import { psx, psxUniforms } from "../retro/psx";
import { tempest } from "./tempest";
import { levelAt } from "./tide";

/** Fed by the living town, boats and animals. Sampled twice a second, never a scene traversal per frame. */
export const parkLife = {
  ecology: null as ParkEcology|null,
  people: () => [] as Point[], boats: () => [] as Point[], cats: () => [] as Point[], dogs: () => [] as Point[],
  food: [] as Array<Point & { until: number }>,
  feed(x:number,z:number,seconds=16) { this.food.push({x,z,until:psxUniforms.uTime.value+seconds}); },
};

/** Each kind's instances at most (the docks' flocks too); only birds within DRAW_M of the eye are drawn (a duck
 * further off is a pixel or two). */
const CAP=96,DRAW_M=90;
export function createParkWildlife(group:THREE.Object3D,data:ParkHabitat) {
  const ecology=new ParkEcology(data);parkLife.ecology=ecology;
  const root=new THREE.Group();root.name="park_wildlife";group.add(root);
  const meshes=new Map<string,THREE.InstancedMesh>();
  const decoder=new DRACOLoader().setDecoderPath("/draco/");
  const mat=psx(new THREE.MeshLambertMaterial({vertexColors:true}),{affine:0});mat.name="park_animal_feathers_fur";
  new GLTFLoader().setDRACOLoader(decoder).loadAsync("/models/park_animals.glb").then(gltf=>{
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o=>{
      const src=o as THREE.Mesh;if(!src.isMesh)return;
      const mesh=new THREE.InstancedMesh(src.geometry.clone().applyMatrix4(src.matrixWorld),mat,CAP);
      mesh.name=`park_wildlife_${src.name}`;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled=false;mesh.count=0;meshes.set(src.name,mesh);root.add(mesh);
    });
  }).catch(e=>console.warn("Park wildlife model failed",e)).finally(()=>decoder.dispose());
  const transform=new THREE.Object3D(), wing=new THREE.Object3D(), matrix=new THREE.Matrix4();
  let clock=0,sample=0,coarse=0;
  let env:ParkEnvironment={hour:13,rain:0,storm:0,people:[],boats:[],cats:[],dogs:[],food:[]};
  return (dt:number,hour:number,camera:THREE.Camera)=>{
    const visible=ecology.animals.some(a=>Math.hypot(a.x-camera.position.x,a.z-camera.position.z)<DRAW_M);
    root.visible=visible;coarse+=dt;
    if(!visible&&coarse<.5)return;
    dt=coarse;coarse=0;
    clock+=dt;sample-=dt;
    if(sample<=0) {
      sample=.5;parkLife.food=parkLife.food.filter(p=>p.until>psxUniforms.uTime.value);
      env={hour,rain:psxUniforms.uRain.value,storm:tempest.level,people:[camera.position,...parkLife.people()],boats:parkLife.boats(),cats:parkLife.cats(),dogs:parkLife.dogs(),food:parkLife.food,
        waterLevels:ecology.habitat.birds.map(([x,z],i)=>i<data.birds.length?-.34:levelAt(x,z)+.01),focus:{x:camera.position.x,z:camera.position.z}};
    }
    ecology.update(dt,env);
    if(!visible)return;
    for(const m of meshes.values())m.count=0;
    for(const a of ecology.animals) {
      if(a.mode==="caught"&&a.timer<238)continue;
      if(Math.abs(a.x-camera.position.x)>DRAW_M||Math.abs(a.z-camera.position.z)>DRAW_M)continue;
      const kind=a.species==="duck"?(a.young?"duck_young":a.female?"duck_female":"duck_mallard"):a.species==="swan"?(a.young?"swan_young":"swan"):a.species;
      const m=meshes.get(kind);if(!m||m.count>=CAP)continue;
      const fly=a.mode==="flight",climb=a.mode==="climb"&&a.y>.25;
      transform.position.set(a.x,a.y+(a.mode==="swim"?Math.sin(clock*2+a.phase)*.012:0),a.z);
      const eating=(a.mode==="feed"||a.mode==="forage"||a.mode==="swim")&&Math.hypot(a.x-a.target.x,a.z-a.target.z)<.65;
      const peck=eating?-(.15+.15*Math.sin(clock*5+a.phase))*(a.species==="squirrel"?.5:1):0;
      transform.rotation.set(0,a.yaw,a.mode==="caught"?Math.PI/2:climb?Math.PI/2:fly?-.08:peck);
      transform.scale.setScalar(1);transform.updateMatrix();m.setMatrixAt(m.count++,transform.matrix);
      if(fly||a.mode==="defend") {
        const w=meshes.get(a.species==="swan"?"wing_swan":a.species==="goose"?"wing_goose":a.species==="songbird"?"wing_songbird":"wing_duck");if(!w||w.count>CAP-2)continue;
        for(const sign of [-1,1]) {
          wing.position.set(0,a.species==="songbird"?.11:.27,sign*(a.species==="songbird"?.045:.12));
          wing.rotation.set(sign*(fly?Math.sin(clock*(a.species==="swan"?7:a.species==="goose"?10:15)+a.phase)*.8:.75),0,0);
          wing.scale.set(1,1,sign);wing.updateMatrix();matrix.multiplyMatrices(transform.matrix,wing.matrix);w.setMatrixAt(w.count++,matrix);
        }
      }
    }
    for(const m of meshes.values())m.instanceMatrix.needsUpdate=true;
  };
}
