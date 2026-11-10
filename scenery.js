import * as THREE from './vendor/three.module.js';
import {clamp,lerp,seededRandom} from './core.js';
import {branchGeometry} from './terrain.js';
import {windMaterial} from './environment.js';
import {buildingFrame,footprintGeometry,footprintMaterial,roofSnowMaterial} from './architecture.js';

export function freeze(mesh){mesh.updateMatrix();mesh.updateMatrixWorld(true);mesh.matrixAutoUpdate=false;mesh.matrixWorldAutoUpdate=false;return mesh;}
function combine(parts){
  const p=[],n=[],c=[];
  for(const [geometry,color] of parts){const g=geometry.index?geometry.toNonIndexed():geometry;for(let i=0;i<g.attributes.position.count;i++){p.push(g.attributes.position.getX(i),g.attributes.position.getY(i),g.attributes.position.getZ(i));n.push(g.attributes.normal.getX(i),g.attributes.normal.getY(i),g.attributes.normal.getZ(i));if(color)c.push(color.r,color.g,color.b);}if(g!==geometry)g.dispose();geometry.dispose();}
  const out=new THREE.BufferGeometry();out.setAttribute('position',new THREE.Float32BufferAttribute(p,3));out.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));if(c.length)out.setAttribute('color',new THREE.Float32BufferAttribute(c,3));return out;
}
function buckets(items,size,xIndex=0,zIndex=1){const result=new Map();for(const p of items){const ix=Math.floor(p[xIndex]/size),iz=Math.floor(p[zIndex]/size),key=`${ix},${iz}`;if(!result.has(key))result.set(key,{x:ix*size,z:iz*size,size,items:[]});result.get(key).items.push(p);}return [...result.values()];}
function distanceTo(c,position){return Math.hypot(position.x-clamp(position.x,c.x,c.x+c.size),position.z-clamp(position.z,c.z,c.z+c.size));}

function maskedMaterial(material){
  material.onBeforeCompile=shader=>{shader.vertexShader='attribute float instanceVisible;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed*=instanceVisible;');};material.customProgramCacheKey=()=> 'alpine-masked-scenery-v3';return material;
}
function maskedGeometry(geometry,count){const g=geometry.clone();g.setAttribute('instanceVisible',new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1),1).setUsage(THREE.DynamicDrawUsage));return g;}
function showFar(refs,show){for(const [mesh,index] of refs){const a=mesh.geometry.attributes.instanceVisible;a.array[index]=show?1:0;a.addUpdateRange(index,1);a.needsUpdate=true;}}
export function larchGeometry(far=false,snow=false){
  const parts=[],positions=[];
  for(let tier=0;tier<(far?4:9);tier++){
    const y=.12+tier*(far?.2:.09),radius=(1-y*.85)*.32;
    for(let j=0;j<(far?3:6);j++){
      const angle=j*Math.PI*2/(far?3:6)+tier*.71,root=new THREE.Vector3(0,y,0),tip=new THREE.Vector3(Math.cos(angle)*radius,y-.06-tier*.01,Math.sin(angle)*radius);
      if(far){positions.push(0,y+.018,0,tip.x,tip.y,tip.z,0,y-.018,0);}
      else{const direction=tip.clone().sub(root),g=new THREE.CylinderGeometry(snow?.003:.004,snow?.008:.01,direction.length(),4);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.clone().normalize()));g.translate(...root.clone().add(tip).multiplyScalar(.5).add(new THREE.Vector3(0,snow?.01:0,0)).toArray());parts.push([g]);
        if(snow){const clump=new THREE.SphereGeometry(.035+tier*.004,5,4);clump.translate(tip.x*.82,tip.y+.03,tip.z*.82);parts.push([clump]);}}
    }
  }
  if(far){positions.push(-.01,0,0,.01,0,0,0,1,0,0,0,-.01,0,0,.01,0,1,0);const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();return g;}
  return combine(parts);
}
export function makeForests(world){
  const trees=[];world.forestChunks=[];world.trees=new THREE.Group();world.trees.name='Woodland';world.scene.add(world.trees);
  for(const [x,z,h,r] of world.mountain.forest){const y=world.height(x,z);if(y<=2420&&!world.nearPiste(x,z,14)&&Math.abs(world.height(x+8,z)-y)<=10)trees.push([x,z,y,h,r]);}
  world.treeObstacles=trees;
  const bark=new THREE.MeshStandardMaterial({color:0x4e4034,roughness:1}),leaves=new THREE.MeshStandardMaterial({color:0x1f4a3a,roughness:1}),snowMat=new THREE.MeshStandardMaterial({color:0xf2f7f8,roughness:.82});
  const trunkGeo=new THREE.CylinderGeometry(.11,.24,1,6),foliageGeo=branchGeometry(),snowGeo=branchGeometry(true);
  const farGeo=combine([[new THREE.ConeGeometry(1.05,1.05,7,1,true).translate(0,.5,0),new THREE.Color(0x1a3f32)],[new THREE.ConeGeometry(.9,.62,7,1,true).translate(0,.66,0),new THREE.Color(0x16382d)],[new THREE.ConeGeometry(.72,.5,6,1,true).translate(0,.88,0),new THREE.Color(0x1f4a38)],[new THREE.ConeGeometry(.48,.36,6,1,true).translate(0,1.05,0),new THREE.Color(0xeff5f6)]]),farMat=maskedMaterial(new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));
  const o=new THREE.Object3D(),color=new THREE.Color();
  const larchNear=larchGeometry(),larchSnow=larchGeometry(false,true),larchFar=larchGeometry(true),larchMat=maskedMaterial(new THREE.MeshStandardMaterial({color:0x756650,roughness:1,side:THREE.DoubleSide})),branchMat=new THREE.MeshStandardMaterial({color:0x685947,roughness:1});
  for(const mat of [bark,leaves,snowMat,farMat,larchMat,branchMat])windMaterial(mat,world.environment?.uniforms);
  for(const winterLarch of [true,false]){const species=trees.filter(p=>(p[4]<.72)===winterLarch);
  // Far trees use large batches. Near clusters only change small visibility buffers.
  for(const chunk of buckets(species,2048)){
    const far=new THREE.InstancedMesh(maskedGeometry(winterLarch?larchFar:farGeo,chunk.items.length),winterLarch?larchMat:farMat,chunk.items.length);
    chunk.items.forEach((p,i)=>{const [x,z,y,h,r]=p;o.rotation.y=r*Math.PI*2;o.position.set(x,y,z);o.scale.set(winterLarch?h:h*(.18+r*.045),h,winterLarch?h:h*(.18+r*.045));o.updateMatrix();far.setMatrixAt(i,o.matrix);color.setScalar(.82+r*.18);far.setColorAt(i,color);p[5]=[far,i];});far.computeBoundingSphere();world.trees.add(freeze(far));
  }
  for(const chunk of buckets(species,512)){
    const near=new THREE.Group(),trunk=new THREE.InstancedMesh(trunkGeo,bark,chunk.items.length),foliage=new THREE.InstancedMesh(winterLarch?larchNear:foliageGeo,winterLarch?branchMat:leaves,chunk.items.length),snow=new THREE.InstancedMesh(winterLarch?larchSnow:snowGeo,snowMat,chunk.items.length);
    chunk.items.forEach(([x,z,y,h,r],i)=>{o.rotation.y=r*Math.PI*2;o.position.set(x,y+h*(winterLarch?.475:.34),z);o.scale.set(h*.11,h*(winterLarch?.95:.68),h*.11);o.updateMatrix();trunk.setMatrixAt(i,o.matrix);o.position.y=y;o.scale.set(winterLarch?h:h*(.18+r*.045),h,winterLarch?h:h*(.18+r*.045));o.updateMatrix();foliage.setMatrixAt(i,o.matrix);snow.setMatrixAt(i,o.matrix);if(winterLarch)color.setScalar(.85+r*.15);else color.setRGB(.48+r*.32,.62+r*.23,.56+r*.25);foliage.setColorAt(i,color);});
    for(const mesh of [trunk,foliage,snow]){mesh.receiveShadow=true;mesh.computeBoundingSphere();freeze(mesh);}near.add(trunk,foliage,snow);near.visible=false;world.trees.add(near);world.forestChunks.push({...chunk,refs:chunk.items.map(p=>p[5]),items:undefined,near,detailed:false});
  }
  }
}

function roofGeometry(){
  const a=[[-.5,0,-.5],[.5,0,-.5],[0,1,-.5],[-.5,0,.5],[.5,0,.5],[0,1,.5]],faces=[[0,1,2],[3,5,4],[0,2,3],[2,5,3],[1,4,2],[4,5,2]],positions=[];
  for(const f of faces)for(const i of f)positions.push(...a[i]);const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();return g;
}
export function makeVillages(world){
  world.buildings=new THREE.Group();world.buildings.name='Village buildings';world.scene.add(world.buildings);world.buildingChunks=[];
  const roofGeo=roofGeometry(),chimneyGeo=new THREE.BoxGeometry(.45,1.4,.5),roofMat=roofSnowMaterial(world.environment?.uniforms),chimneyMat=new THREE.MeshStandardMaterial({color:0x6a5346,roughness:1}),o=new THREE.Object3D(),color=new THREE.Color(),rand=seededRandom(241);
  const farGeo=combine([[new THREE.BoxGeometry(1,1,1),new THREE.Color(0x8a6a48)],[roofGeometry().scale(1.12,.52,1.12).translate(0,.5,0),new THREE.Color(0xf0f5f7)]]),farMat=maskedMaterial(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95}));
  const compileFar=farMat.onBeforeCompile;farMat.onBeforeCompile=shader=>{compileFar(shader);shader.vertexShader='attribute float roofRise;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('transformed*=instanceVisible;','if(position.y>.5)transformed.y=.5+(position.y-.5)/.42*roofRise;transformed*=instanceVisible;');};farMat.customProgramCacheKey=()=> 'alpine-far-roofs-v3';
  const buildings=world.data.buildings.map((p,i)=>[...p,undefined,world.data.architecture?.[i]]);
  for(const chunk of buckets(buildings,3072)){
    const far=new THREE.InstancedMesh(maskedGeometry(farGeo,chunk.items.length),farMat,chunk.items.length);far.geometry.setAttribute('roofRise',new THREE.InstancedBufferAttribute(new Float32Array(chunk.items.map(p=>Math.min(5,buildingFrame(p).w*.24)/p[4])),1));
    chunk.items.forEach((p,i)=>{const h=p[4],{x,z,w,d,angle}=buildingFrame(p);o.rotation.set(0,angle,0);o.position.set(x,world.height(x,z)+h*.5,z);o.scale.set(w,h,d);o.updateMatrix();far.setMatrixAt(i,o.matrix);p[5]=[far,i];});far.computeBoundingSphere();world.buildings.add(freeze(far));
  }
  for(const chunk of buckets(buildings,768)){
    const group=new THREE.Group(),box=new THREE.Mesh(footprintGeometry(chunk.items,world.height),footprintMaterial()),roof=new THREE.InstancedMesh(roofGeo,roofMat,chunk.items.length),chimneys=new THREE.InstancedMesh(chimneyGeo,chimneyMat,chunk.items.length);
    chunk.items.forEach((p,i)=>{const h=p[4],{x,z,w,d,angle}=buildingFrame(p),y=world.height(p[0],p[1]),rise=p[6]?.roof==='flat'?.2:Math.min(5,w*.24);o.rotation.set(0,angle,0);o.position.set(x,y+h,z);o.scale.set(w*1.10,rise*1.15,d*1.10);o.updateMatrix();roof.setMatrixAt(i,o.matrix);const c=Math.cos(angle),s=Math.sin(angle);o.position.set(x+c*w*.15-s*d*.2,y+h+rise*.7+.4,z-s*w*.15-c*d*.2);o.scale.set(1,1,1);o.updateMatrix();chimneys.setMatrixAt(i,o.matrix);});
    for(const mesh of [box,roof,chimneys]){mesh.receiveShadow=true;if(mesh.isInstancedMesh)mesh.computeBoundingSphere();freeze(mesh);group.add(mesh);}group.visible=false;world.buildings.add(group);world.buildingChunks.push({...chunk,refs:chunk.items.map(p=>p[5]),items:undefined,group,box,roof,chimneys,detailed:false});
  }
}

function cableProfile(world,points,clearance){
  const supports=[];let distance=0,next=0;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    while(next<=distance+length){const t=(next-distance)/(length||1),x=lerp(a[0],b[0],t),z=lerp(a[1],b[1],t);supports.push(new THREE.Vector3(x,world.height(x,z)+clearance,z));next+=95;}
    distance+=length;
  }
  const end=points.at(-1);supports.push(new THREE.Vector3(end[0],world.height(...end)+clearance,end[1]));
  const lane=clearance<10?.8:2.6;
  for(const p of supports){let ground=world.height(p.x,p.z);for(const dx of [-lane,0,lane])for(const dz of [-lane,0,lane])ground=Math.max(ground,world.height(p.x+dx,p.z+dz));p.y=ground+clearance;}
  // Add a support where an unsurveyed span would put its cable into a convex ridge.
  for(let i=1;i<supports.length&&supports.length<1000;){
    const a=supports[i-1],b=supports[i],span=a.distanceTo(b),plan=Math.hypot(b.x-a.x,b.z-a.z),tx=(b.x-a.x)/(plan||1),tz=(b.z-a.z)/(plan||1);let worst=clearance*.55,candidate=null;
    const steps=Math.ceil(plan/5);
    for(let j=1;j<steps;j++){const t=j/steps,p=a.clone().lerp(b,t);p.y-=Math.min(1.8,span*.012)*4*t*(1-t);const ground=Math.max(world.height(p.x,p.z),world.height(p.x-tz*lane,p.z+tx*lane),world.height(p.x+tz*lane,p.z-tx*lane)),gap=p.y-ground;if(gap<worst){worst=gap;candidate=new THREE.Vector3(p.x,ground+clearance,p.z);}}
    if(candidate&&plan>10)supports.splice(i,0,candidate);else i++;
  }
  const line=[];
  for(let i=1;i<supports.length;i++){const a=supports[i-1],b=supports[i],span=a.distanceTo(b),steps=Math.max(2,Math.ceil(span/12));for(let j=0;j<steps;j++){const t=j/steps,p=a.clone().lerp(b,t);p.y-=Math.min(1.8,span*.012)*4*t*(1-t);line.push(p);}}
  line.push(supports.at(-1));return {supports,line};
}
function cableLoop(line,width){
  const lane=(i,side)=>{const p=line[i],a=line[Math.max(0,i-1)],b=line[Math.min(line.length-1,i+1)],l=Math.hypot(b.x-a.x,b.z-a.z)||1;return p.clone().add(new THREE.Vector3(-(b.z-a.z)/l*width*side,0,(b.x-a.x)/l*width*side));};
  const loop=[];for(let i=0;i<line.length;i++)loop.push(lane(i,-1));
  for(const end of [true,false]){
    const p=end?line.at(-1):line[0],other=end?line.at(-2):line[1],forward=p.clone().sub(other);forward.y=0;forward.normalize();const right=new THREE.Vector3(-forward.z,0,forward.x);
    for(let i=1;i<=8;i++){const angle=i/8*Math.PI;loop.push(p.clone().addScaledVector(right,-Math.cos(angle)*width).addScaledVector(forward,Math.sin(angle)*width));}
    if(end)for(let i=line.length-2;i>=0;i--)loop.push(lane(i,1));
  }
  loop.push(loop[0].clone());const distances=[0];for(let i=1;i<loop.length;i++)distances.push(distances.at(-1)+loop[i].distanceTo(loop[i-1]));
  return {points:loop,distances,length:distances.at(-1)};
}
export function cableAt(loop,d,out=new THREE.Vector3()){
  d=((d%loop.length)+loop.length)%loop.length;let lo=0,hi=loop.distances.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(loop.distances[mid]>d)hi=mid;else lo=mid;}
  return out.copy(loop.points[lo]).lerp(loop.points[hi],(d-loop.distances[lo])/(loop.distances[hi]-loop.distances[lo]||1));
}
export function makeCableways(world){
  world.lifts=new THREE.Group();world.lifts.name='Lift network';world.scene.add(world.lifts);world.liftRuns=[];
  const cables=[],towers=[],stations=[],steel=new THREE.MeshStandardMaterial({color:0x6c7c83,metalness:.65,roughness:.42}),dark=new THREE.MeshStandardMaterial({color:0x243d49,metalness:.35,roughness:.3}),snowMat=new THREE.MeshStandardMaterial({color:0xdbe7e9,roughness:.8});
  const cabinGeo=combine([[new THREE.BoxGeometry(1.85,1.15,1.45).translate(0,-.15,0),new THREE.Color(0xb01e1a)],[new THREE.BoxGeometry(1.88,.55,1.48).translate(0,.62,0),new THREE.Color(0x8e1816)],[new THREE.BoxGeometry(1.7,.12,1.55).translate(0,.95,0),new THREE.Color(0xe8eef0)]]),chairGeo=combine([[new THREE.BoxGeometry(2.15,.12,.85).translate(0,-.32,0),new THREE.Color(0x1d333f)],[new THREE.BoxGeometry(2.15,.18,.7).translate(0,-.22,0),new THREE.Color(0xc43b2a)],[new THREE.BoxGeometry(2.15,.7,.1).translate(0,.05,-.38),new THREE.Color(0x1d333f)],[new THREE.BoxGeometry(.07,1.05,.07).translate(-.95,.22,-.32),new THREE.Color(0x8a96a0)],[new THREE.BoxGeometry(.07,1.05,.07).translate(.95,.22,-.32),new THREE.Color(0x8a96a0)],[new THREE.BoxGeometry(2.05,.05,.05).translate(0,.18,.42),new THREE.Color(0xe0c14a)]]),hangerGeo=new THREE.CylinderGeometry(.04,.04,1.7,6),canopyGeo=new THREE.BoxGeometry(2.05,.14,1.6);
  for(const lift of world.data.lifts){
    if(lift.points.length<2)continue;const surface=/platter|t-bar|drag_lift|magic_carpet|rope_tow/.test(lift.type),gondola=/gondola|cable_car/.test(lift.type),clearance=surface?5:14;
    const {supports,line}=cableProfile(world,lift.points,clearance);if(line.length<2)continue;
    const loop=cableLoop(line,surface?.6:2.2);if(loop.length<2)continue;
    for(let i=1;i<loop.points.length;i++)cables.push(...loop.points[i-1].toArray(),...loop.points[i].toArray());
    supports.forEach((p,i)=>{const next=supports[Math.min(i+1,supports.length-1)],prev=supports[Math.max(i-1,0)];towers.push([p.x,p.z,p.y,Math.atan2(next.x-prev.x,next.z-prev.z),p.y-world.height(p.x,p.z),surface?2:6]);});
    if(!surface)for(const p of [supports[0],supports.at(-1)])stations.push([p.x,p.z,world.height(p.x,p.z),7,4,p.y-world.height(p.x,p.z)]);
    if(surface)continue;
    const count=Math.max(2,Math.ceil(loop.length/110)),group=new THREE.Group(),cabins=new THREE.InstancedMesh(gondola?cabinGeo:chairGeo,dark,count),hangers=new THREE.InstancedMesh(hangerGeo,steel,count),canopies=new THREE.InstancedMesh(canopyGeo,snowMat,count);
    group.add(cabins,hangers);if(gondola){const glazing=new THREE.InstancedMesh(new THREE.BoxGeometry(1.83,.86,1.43),new THREE.MeshStandardMaterial({color:0x466b7b,metalness:.55,roughness:.16}),count);group.add(canopies,glazing);cabins.material=new THREE.MeshStandardMaterial({vertexColors:true,color:0xaf3029,roughness:.42,metalness:.25});group.userData.glazing=glazing;}group.visible=false;world.lifts.add(group);
    const box=new THREE.Box3().setFromPoints(loop.points),run={source:lift,rideLine:loop.points.slice(0,line.length),loop,count,group,cabins,hangers,canopies,gondola,speed:gondola?4:2.5,box};world.liftRuns.push(run);placeCarriers(run,0);
    for(const mesh of group.children){mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.computeBoundingSphere();mesh.boundingSphere.expandByPoint(box.min.clone().addScalar(-4));mesh.boundingSphere.expandByPoint(box.max.clone().addScalar(4));freeze(mesh);}
  }
  const lines=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x3c505b,transparent:true,opacity:.8}));lines.geometry.setAttribute('position',new THREE.Float32BufferAttribute(cables,3));world.lifts.add(freeze(lines));
  const o=new THREE.Object3D();world.liftChunks=[];
  const poleGeo=combine([
    [new THREE.CylinderGeometry(.055,.09,1,5).translate(-.16,0,0)],
    [new THREE.CylinderGeometry(.055,.09,1,5).translate(.16,0,0)],
    [new THREE.CylinderGeometry(.055,.09,1,5).translate(0,0,-.16)],
    [new THREE.CylinderGeometry(.055,.09,1,5).translate(0,0,.16)],
    [new THREE.BoxGeometry(.42,.05,.05).translate(0,.18,0)],
    [new THREE.BoxGeometry(.42,.05,.05).translate(0,-.12,0)],
    [new THREE.BoxGeometry(.42,.05,.05).translate(0,.42,0)]
  ]),barGeo=new THREE.BoxGeometry(1,.22,.28);
  for(const chunk of buckets(towers,2048)){
    const group=new THREE.Group(),poles=new THREE.InstancedMesh(poleGeo,steel,chunk.items.length),bars=new THREE.InstancedMesh(barGeo,steel,chunk.items.length);
    chunk.items.forEach(([x,z,y,angle,h,w],i)=>{o.rotation.y=angle;o.position.set(x,y-h/2,z);o.scale.set(Math.max(1,w*.28),h,Math.max(1,w*.28));o.updateMatrix();poles.setMatrixAt(i,o.matrix);o.position.y=y;o.scale.set(w,1,1);o.updateMatrix();bars.setMatrixAt(i,o.matrix);});
    for(const mesh of [poles,bars]){mesh.computeBoundingSphere();group.add(freeze(mesh));}world.lifts.add(group);world.liftChunks.push({...chunk,items:undefined,group});
  }
  const stationGeo=new THREE.BoxGeometry(1,1,1),roofGeo=new THREE.BoxGeometry(1,.5,1),bases=new THREE.InstancedMesh(stationGeo,steel,stations.length),roofs=new THREE.InstancedMesh(roofGeo,snowMat,stations.length);
  stations.forEach(([x,z,y,w,d,h],i)=>{o.rotation.y=0;o.position.set(x,y+h/2,z);o.scale.set(w,h,d);o.updateMatrix();bases.setMatrixAt(i,o.matrix);o.position.y=y+h+.3;o.scale.set(w+1,1,d+1);o.updateMatrix();roofs.setMatrixAt(i,o.matrix);});world.lifts.add(freeze(bases),freeze(roofs));
}
const carrierObject=new THREE.Object3D(),carrierPosition=new THREE.Vector3(),carrierAhead=new THREE.Vector3();
export function placeCarriers(run,time){
  for(let i=0;i<run.count;i++){
    const d=i/run.count*run.loop.length+time*run.speed,p=cableAt(run.loop,d,carrierPosition),ahead=cableAt(run.loop,d+1,carrierAhead);carrierObject.rotation.set(0,Math.atan2(ahead.x-p.x,ahead.z-p.z),0);carrierObject.scale.set(1,1,1);
    carrierObject.position.copy(p);carrierObject.position.y-=.8;carrierObject.updateMatrix();run.hangers.setMatrixAt(i,carrierObject.matrix);
    carrierObject.position.y=p.y-2.4;carrierObject.updateMatrix();run.cabins.setMatrixAt(i,carrierObject.matrix);
    if(run.gondola){carrierObject.position.y=p.y-2.12;carrierObject.updateMatrix();run.group.userData.glazing.setMatrixAt(i,carrierObject.matrix);carrierObject.position.y=p.y-1.5;carrierObject.updateMatrix();run.canopies.setMatrixAt(i,carrierObject.matrix);}
  }
  run.cabins.instanceMatrix.needsUpdate=run.hangers.instanceMatrix.needsUpdate=true;if(run.gondola){run.canopies.instanceMatrix.needsUpdate=true;run.group.userData.glazing.instanceMatrix.needsUpdate=true;}
}
export function updateScenery(world,dt,time=0){
  world.sceneryTimer=(world.sceneryTimer??0)-dt;
  if(world.sceneryTimer<=0){
    world.sceneryTimer=.25;const ride=world.mode==='ride',position=world.camera.position;
    for(const c of world.forestChunks??[]){const d=distanceTo(c,position),threshold=(world.quality==='high'?460:world.quality==='low'?180:300)+(c.detailed?80:0);const detailed=ride&&d<threshold;if(detailed!==c.detailed)showFar(c.refs,!detailed);c.detailed=detailed;c.near.visible=detailed;for(const mesh of c.near.children)mesh.castShadow=d<180;}
    for(const c of world.buildingChunks??[]){const d=distanceTo(c,position),detailed=ride&&d<(c.detailed?860:720);if(detailed!==c.detailed)showFar(c.refs,!detailed);c.detailed=detailed;c.group.visible=detailed;c.chimneys.visible=ride&&d<450;c.box.castShadow=c.roof.castShadow=c.chimneys.castShadow=ride&&d<220;}
    for(const c of world.liftChunks??[]){const near=ride&&distanceTo(c,position)<220;for(const mesh of c.group.children)mesh.castShadow=near;}
    for(const r of world.liftRuns??[]){r.group.visible=world.options.lifts&&ride&&r.box.distanceToPoint(position)<2100;for(const mesh of r.group.children)mesh.castShadow=r.box.distanceToPoint(position)<180;}
  }
  for(const r of world.liftRuns??[])if(r.group.visible&&dt>0)placeCarriers(r,time);
}

export function makePisteFurniture(world){
  const group=new THREE.Group();group.name='Piste furniture';world.scene.add(group);
  const signs=[],guns=[],posts=[],nets=[];
  const COLORS={black:0x1a1a1a,green:0x2f7a3a,blue:0x2a5fa8,red:0xb31f24,white:0xf2f4f6};
  for(const route of world.data.routes){
    const pts=route.points;if(!pts||pts.length<2)continue;
    let dist=0,nextSign=40,nextGun=90,nextNet=160;
    const grade=route.difficulty||'red';
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1],b=pts[i],len=Math.hypot(b[0]-a[0],b[1]-a[1])||1,tx=(b[0]-a[0])/len,tz=(b[1]-a[1])/len,nx=-tz,nz=tx;
      const step=Math.max(8,Math.min(20,len));
      for(let d=0;d<len;d+=step){
        dist+=step;const t=d/len,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
        if(dist>=nextSign){const side=(Math.floor(dist/40)%2?1:-1)* (8.5+(dist%7)*.15);signs.push([x+nx*side,z+nz*side,Math.atan2(tx,tz),grade]);nextSign+=70+((dist*13)%40);}
        if(dist>=nextGun){const side=(Math.floor(dist/90)%2?1:-1)*11.5;guns.push([x+nx*side,z+nz*side,Math.atan2(tx,tz)]);nextGun+=160+((dist*7)%50);}
        if(dist>=nextNet && /black|red/.test(grade)){const side=-11;nets.push([x+nx*side,z+nz*side,Math.atan2(tx,tz)]);nextNet+=220;}
      }
    }
  }
  const o=new THREE.Object3D();
  const pole=new THREE.CylinderGeometry(.05,.06,2.2,6),disc=new THREE.CircleGeometry(.38,10),plate=new THREE.BoxGeometry(.02,.55,.55);
  const steel=new THREE.MeshStandardMaterial({color:0x8a9296,metalness:.45,roughness:.45}),white=new THREE.MeshStandardMaterial({color:0xf4f6f7,roughness:.7});
  const poles=new THREE.InstancedMesh(pole,steel,signs.length),plates=new THREE.InstancedMesh(plate,white,signs.length);
  const color=new THREE.Color();
  signs.forEach(([x,z,angle,grade],i)=>{const y=world.height(x,z);o.rotation.set(0,angle,0);o.position.set(x,y+1.1,z);o.scale.set(1,1,1);o.updateMatrix();poles.setMatrixAt(i,o.matrix);o.position.y=y+2.15;o.updateMatrix();plates.setMatrixAt(i,o.matrix);color.set(COLORS[grade]||COLORS.red);plates.setColorAt(i,color);});
  plates.instanceColor && (plates.instanceColor.needsUpdate=true);
  const gunPole=new THREE.CylinderGeometry(.07,.1,2.8,6),barrel=new THREE.CylinderGeometry(.09,.07,1.3,7),mound=new THREE.SphereGeometry(.7,7,5);
  const gunsG=new THREE.Group(),gp=new THREE.InstancedMesh(gunPole,steel,guns.length),gb=new THREE.InstancedMesh(barrel,new THREE.MeshStandardMaterial({color:0x2a3238,metalness:.5,roughness:.35}),guns.length),gm=new THREE.InstancedMesh(mound,new THREE.MeshStandardMaterial({color:0xeef4f6,roughness:.9}),guns.length);
  guns.forEach(([x,z,angle],i)=>{const y=world.height(x,z);o.rotation.set(0,angle,0);o.position.set(x,y+1.4,z);o.scale.set(1,1,1);o.updateMatrix();gp.setMatrixAt(i,o.matrix);o.position.set(x,y+2.55,z);o.rotation.set(.7,angle,0);o.updateMatrix();gb.setMatrixAt(i,o.matrix);o.rotation.set(0,angle,0);o.position.set(x,y+.15,z);o.scale.set(1,.45,1);o.updateMatrix();gm.setMatrixAt(i,o.matrix);});
  gunsG.add(gp,gb,gm);
  const netGeo=new THREE.PlaneGeometry(8,1.8,1,1),postGeo=new THREE.CylinderGeometry(.05,.06,1.9,5);
  const netMat=new THREE.MeshStandardMaterial({color:0xc9d36a,transparent:true,opacity:.38,side:THREE.DoubleSide,roughness:.8});
  const netMesh=new THREE.InstancedMesh(netGeo,netMat,nets.length),postMesh=new THREE.InstancedMesh(postGeo,steel,nets.length*2);
  nets.forEach(([x,z,angle],i)=>{const y=world.height(x,z);o.rotation.set(0,angle,0);o.position.set(x,y+1.15,z);o.scale.set(1,1,1);o.updateMatrix();netMesh.setMatrixAt(i,o.matrix);for(const s of [-1,1]){o.position.set(x+Math.cos(angle)*s*3.8,y+.95,z-Math.sin(angle)*s*3.8);o.updateMatrix();postMesh.setMatrixAt(i*2+(s<0?0:1),o.matrix);}});
  for(const mesh of [poles,plates,gp,gb,gm,netMesh,postMesh]){mesh.frustumCulled=true;mesh.computeBoundingSphere();if(mesh.boundingSphere)mesh.boundingSphere.radius=20000;freeze(mesh);}
  group.add(poles,plates,gunsG,netMesh,postMesh);group.visible=false;return group;
}
