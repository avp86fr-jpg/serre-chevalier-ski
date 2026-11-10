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
  const seed=seededRandom(911);
  for(const [x,z,h,r] of world.mountain.forest){
    const y=world.height(x,z);if(y<=2420&&!world.nearPiste(x,z,14)&&Math.abs(world.height(x+8,z)-y)<=12)trees.push([x,z,y,h,r]);
    // Fill larch belts below ~2000 m and mixed stands just above, staying off the pistes.
    if(y>=1300&&y<=2080&&!world.nearPiste(x,z,16)&&Math.abs(world.height(x+8,z)-y)<=8){
      const ang=r*Math.PI*6,spread=7+r*6,nx=x+Math.sin(ang)*spread,nz=z+Math.cos(ang)*spread,ny=world.height(nx,nz);
      if(Math.abs(ny-y)<6&&!world.nearPiste(nx,nz,14))trees.push([nx,nz,ny,h*(.85+seed()*.2), (r+.37)%1]);
      if(y<1900&&seed()>.28){const bx=x-Math.cos(ang)*10,bz=z+Math.sin(ang)*10,by=world.height(bx,bz);if(Math.abs(by-y)<6&&!world.nearPiste(bx,bz,14))trees.push([bx,bz,by,h*(.8+seed()*.25),(r+.61)%1]);}
      // Extra stems on sunny south faces (+Z) in the larch belt down to the Guisane.
      if(y<2000&&world.height(x,z-10)>y+1.6&&seed()>.22){const sx=x+Math.sin(ang+1.1)*8,sz=z+Math.cos(ang+1.1)*8,sy=world.height(sx,sz);if(Math.abs(sy-y)<7&&!world.nearPiste(sx,sz,14))trees.push([sx,sz,sy,h*(.82+seed()*.22),(r+.19)%1]);}
    }
  }
  world.treeObstacles=trees;
  const bark=new THREE.MeshStandardMaterial({color:0x4e4034,roughness:1}),leaves=new THREE.MeshStandardMaterial({color:0x1f4a3a,roughness:1}),snowMat=new THREE.MeshStandardMaterial({color:0xf2f7f8,roughness:.82});
  const trunkGeo=new THREE.CylinderGeometry(.11,.24,1,6),foliageGeo=branchGeometry(),snowGeo=branchGeometry(true);
  const farGeo=combine([[new THREE.ConeGeometry(1.05,1.05,7,1,true).translate(0,.5,0),new THREE.Color(0x1a3f32)],[new THREE.ConeGeometry(.9,.62,7,1,true).translate(0,.66,0),new THREE.Color(0x16382d)],[new THREE.ConeGeometry(.72,.5,6,1,true).translate(0,.88,0),new THREE.Color(0x1f4a38)],[new THREE.ConeGeometry(.48,.36,6,1,true).translate(0,1.05,0),new THREE.Color(0xeff5f6)]]),farMat=maskedMaterial(new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));
  const o=new THREE.Object3D(),color=new THREE.Color();
  const larchNear=larchGeometry(),larchSnow=larchGeometry(false,true),larchFar=larchGeometry(true),larchMat=maskedMaterial(new THREE.MeshStandardMaterial({color:0x9a7840,roughness:1,side:THREE.DoubleSide})),branchMat=new THREE.MeshStandardMaterial({color:0x8d6a38,roughness:1});
  for(const mat of [bark,leaves,snowMat,farMat,larchMat,branchMat])windMaterial(mat,world.environment?.uniforms);
  for(const winterLarch of [true,false]){const species=trees.filter(p=>(p[2]<2000)===winterLarch);
  // Far trees use large batches. Near clusters only change small visibility buffers.
  for(const chunk of buckets(species,2048)){
    const far=new THREE.InstancedMesh(maskedGeometry(winterLarch?larchFar:farGeo,chunk.items.length),winterLarch?larchMat:farMat,chunk.items.length);
    chunk.items.forEach((p,i)=>{const [x,z,y,h,r]=p;o.rotation.y=r*Math.PI*2;o.position.set(x,y,z);o.scale.set(winterLarch?h:h*(.18+r*.045),h,winterLarch?h:h*(.18+r*.045));o.updateMatrix();far.setMatrixAt(i,o.matrix);if(winterLarch)color.setRGB(.80+r*.16,.64+r*.10,.36+r*.08);else color.setScalar(.82+r*.18);far.setColorAt(i,color);p[5]=[far,i];});far.computeBoundingSphere();world.trees.add(freeze(far));
  }
  for(const chunk of buckets(species,512)){
    const near=new THREE.Group(),trunk=new THREE.InstancedMesh(trunkGeo,bark,chunk.items.length),foliage=new THREE.InstancedMesh(winterLarch?larchNear:foliageGeo,winterLarch?branchMat:leaves,chunk.items.length),snow=new THREE.InstancedMesh(winterLarch?larchSnow:snowGeo,snowMat,chunk.items.length);
    chunk.items.forEach(([x,z,y,h,r],i)=>{o.rotation.y=r*Math.PI*2;o.position.set(x,y+h*(winterLarch?.475:.34),z);o.scale.set(h*.11,h*(winterLarch?.95:.68),h*.11);o.updateMatrix();trunk.setMatrixAt(i,o.matrix);o.position.y=y;o.scale.set(winterLarch?h:h*(.18+r*.045),h,winterLarch?h:h*(.18+r*.045));o.updateMatrix();foliage.setMatrixAt(i,o.matrix);snow.setMatrixAt(i,o.matrix);if(winterLarch)color.setRGB(.78+r*.18,.62+r*.12,.32+r*.08);else color.setRGB(.48+r*.32,.62+r*.23,.56+r*.25);foliage.setColorAt(i,color);});
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
  const farGeo=combine([[new THREE.BoxGeometry(1,1,1),new THREE.Color(0x8a6a48)],[roofGeometry().scale(1.12,.52,1.12).translate(0,.5,0),new THREE.Color(0x6d7278)]]),farMat=maskedMaterial(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95}));
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
  const landmarks=new THREE.Group();landmarks.name='Village landmarks';
  const snowRoof=roofSnowMaterial(world.environment?.uniforms);
  const villageLook=name=>{const n=(name||'').toLowerCase();return n.includes('chantemerle')?{nave:0xc99a62,stone:0x7a4a2c,spire:0x5a3420}:n.includes('villeneuve')?{nave:0xe8e2d4,stone:0xb8c2c8,spire:0x6a6662}:n.includes('monêtier')||n.includes('monetier')?{nave:0x746c62,stone:0x4a4440,spire:0x322e2a}:{nave:0xc9c2b4,stone:0x8a8680,spire:0x5a4e42};};
  for(const v of world.data.villages||[]){
    const pal=villageLook(v.name),naveMat=new THREE.MeshStandardMaterial({color:pal.nave,roughness:.9}),stoneMat=new THREE.MeshStandardMaterial({color:pal.stone,roughness:.85}),spireMat=new THREE.MeshStandardMaterial({color:pal.spire,roughness:.7});
    const [x,z]=v.position,y=world.height(x,z),g=new THREE.Group();
    const nave=new THREE.Mesh(new THREE.BoxGeometry(9,6,16),naveMat);nave.position.set(x,y+3,z);
    const apse=new THREE.Mesh(new THREE.BoxGeometry(7,5,6),naveMat);apse.position.set(x,y+2.6,z+10);
    const tower=new THREE.Mesh(new THREE.BoxGeometry(4.2,14,4.2),stoneMat);tower.position.set(x,y+7,z-10);
    const roof=new THREE.Mesh(roofGeometry(),snowRoof);roof.position.set(x,y+6.1,z);roof.scale.set(10.4,4.2,17.6);
    const spire=new THREE.Mesh(new THREE.ConeGeometry(2.1,7,6),spireMat);spire.position.set(x,y+17.5,z-10);
    const cap=new THREE.Mesh(new THREE.SphereGeometry(1.1,8,6),snowRoof);cap.position.set(x,y+21.2,z-10);
    for(const m of [nave,apse,tower,roof,spire,cap]){m.castShadow=m.receiveShadow=true;g.add(m);}
    // A tight ring of extra chalets so the hamlet reads from the overview.
    for(let i=0;i<6;i++){
      const a=i*Math.PI/3+0.3,cx=x+Math.cos(a)*22,cz=z+Math.sin(a)*22,cy=world.height(cx,cz),w=7+i%3,d=9+i%2;
      const house=new THREE.Mesh(new THREE.BoxGeometry(w,4.2,d),i%2?naveMat:stoneMat);house.position.set(cx,cy+2.1,cz);house.rotation.y=a+Math.PI/2;
      const hr=new THREE.Mesh(roofGeometry(),snowRoof);hr.position.set(cx,cy+4.3,cz);hr.rotation.y=a+Math.PI/2;hr.scale.set(w*1.12,3,d*1.12);
      house.castShadow=hr.castShadow=house.receiveShadow=hr.receiveShadow=true;g.add(house,hr);
    }
    if(/brian[cç]on/i.test(v.name||'')){
      const rampart=new THREE.MeshStandardMaterial({color:0x8a8680,roughness:.92}),keepMat=new THREE.MeshStandardMaterial({color:0x7a756c,roughness:.9});
      let cx=x+90,cz=z+130,cy=world.height(cx,cz);
      for(const [dx,dz] of [[70,90],[110,150],[40,160],[130,80]]){const ty=world.height(x+dx,z+dz);if(ty>cy){cx=x+dx;cz=z+dz;cy=ty;}}
      const keep=new THREE.Mesh(new THREE.BoxGeometry(18,22,16),keepMat);keep.position.set(cx,cy+11,cz);
      const keepRoof=new THREE.Mesh(roofGeometry(),snowRoof);keepRoof.position.set(cx,cy+22,cz);keepRoof.scale.set(20,7,18);
      g.add(keep,keepRoof);
      for(let i=0;i<8;i++){
        const a=i*Math.PI/4+.12,len=i%2?52:38,wx=cx+Math.cos(a)*28,wz=cz+Math.sin(a)*28,wy=world.height(wx,wz);
        const wall=new THREE.Mesh(new THREE.BoxGeometry(len,8.5,3.2),rampart);wall.position.set(wx,wy+4.2,wz);wall.rotation.y=a+Math.PI/2;
        const bastion=new THREE.Mesh(new THREE.CylinderGeometry(4.2,4.8,10,8),rampart);bastion.position.set(cx+Math.cos(a)*46,world.height(cx+Math.cos(a)*46,cz+Math.sin(a)*46)+5,cz+Math.sin(a)*46);
        wall.castShadow=bastion.castShadow=wall.receiveShadow=bastion.receiveShadow=true;g.add(wall,bastion);
      }
    }
    landmarks.add(g);
  }
  world.buildings.add(freeze(landmarks));
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
    if(!surface){const a=supports[0],b=supports.at(-1),a2=supports[1]||b,b2=supports.at(-2)||a;stations.push([a.x,a.z,world.height(a.x,a.z),20,13,9.2,Math.atan2(a2.x-a.x,a2.z-a.z),gondola],[b.x,b.z,world.height(b.x,b.z),20,13,9.2,Math.atan2(b.x-b2.x,b.z-b2.z),gondola]);}
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
  const stationHall=combine([
    [new THREE.BoxGeometry(1,.72,1).translate(0,-.04,0),new THREE.Color(0x8d8a83)],
    [new THREE.BoxGeometry(.92,.4,.12).translate(0,0,.46),new THREE.Color(0x4d7586)],
    [new THREE.BoxGeometry(.38,.5,.5).translate(.58,-.06,-.12),new THREE.Color(0x5f6a70)],
    [new THREE.BoxGeometry(.2,.2,1.05).translate(0,.2,0),new THREE.Color(0xc43b2a)],
    [new THREE.BoxGeometry(1.05,.06,1.08).translate(0,.36,0),new THREE.Color(0xe7eef1)]
  ]);
  const stationCanopy=combine([[new THREE.BoxGeometry(1,.08,1),new THREE.Color(0xe7eef1)],[new THREE.BoxGeometry(.08,.45,.08).translate(-.45,-.2,-.4),new THREE.Color(0x6c7c83)],[new THREE.BoxGeometry(.08,.45,.08).translate(.45,-.2,-.4),new THREE.Color(0x6c7c83)],[new THREE.BoxGeometry(.08,.45,.08).translate(-.45,-.2,.4),new THREE.Color(0x6c7c83)],[new THREE.BoxGeometry(.08,.45,.08).translate(.45,-.2,.4),new THREE.Color(0x6c7c83)]]);
  const hallMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.55,metalness:.2}),bases=new THREE.InstancedMesh(stationHall,hallMat,stations.length),roofs=new THREE.InstancedMesh(roofGeometry(),snowMat,stations.length),canopies=new THREE.InstancedMesh(stationCanopy,hallMat,stations.length);
  stations.forEach(([x,z,y,w,d,h,angle],i)=>{
    o.rotation.set(0,angle||0,0);o.position.set(x,y+h*.42,z);o.scale.set(w,h,d);o.updateMatrix();bases.setMatrixAt(i,o.matrix);
    o.position.y=y+h*.88;o.scale.set(w*1.16,Math.max(2.4,h*.42),d*1.18);o.updateMatrix();roofs.setMatrixAt(i,o.matrix);
    const fx=Math.sin(angle||0)*((d*.5)+6),fz=Math.cos(angle||0)*((d*.5)+6);
    o.position.set(x+fx,y+3.1,z+fz);o.scale.set(w*.85,.7,9);o.updateMatrix();canopies.setMatrixAt(i,o.matrix);
  });
  world.lifts.add(freeze(bases),freeze(roofs),freeze(canopies));
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
    const zoom=world.orbit?.distance??2e4;if(world.trees)world.trees.visible=world.options.trees!==false&&(ride||zoom<13000);
    for(const c of world.forestChunks??[]){const d=distanceTo(c,position),threshold=(world.quality==='high'?1200:world.quality==='low'?220:700)+(c.detailed?120:0);const detailed=(ride||zoom<5500)&&d<threshold;if(detailed!==c.detailed)showFar(c.refs,!detailed);c.detailed=detailed;c.near.visible=detailed;for(const mesh of c.near.children)mesh.castShadow=d<180;}
    for(const c of world.buildingChunks??[]){const d=distanceTo(c,position),lim=world.quality==='low'?520:(c.detailed?1700:1400),detailed=(ride||zoom<6000)&&d<lim;if(detailed!==c.detailed)showFar(c.refs,!detailed);c.detailed=detailed;c.group.visible=detailed;c.chimneys.visible=ride&&d<(world.quality==='low'?180:650);c.box.castShadow=c.roof.castShadow=c.chimneys.castShadow=ride&&d<220&&world.quality!=='low';}
    for(const c of world.liftChunks??[]){const near=ride&&distanceTo(c,position)<220;for(const mesh of c.group.children)mesh.castShadow=near;}
    for(const r of world.liftRuns??[]){const reach=world.quality==='low'?1600:3200;r.group.visible=world.options.lifts&&(ride||zoom<8000)&&r.box.distanceToPoint(position)<reach;for(const mesh of r.group.children)mesh.castShadow=world.quality!=='low'&&r.box.distanceToPoint(position)<180;}
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
        if(dist>=nextSign){const side=(Math.floor(dist/40)%2?1:-1)* (8.5+(dist%7)*.15);signs.push([x+nx*side,z+nz*side,Math.atan2(tx,tz),grade]);nextSign+=48+((dist*13)%28);}
        if(dist>=nextGun){const side=(Math.floor(dist/90)%2?1:-1)*11.5;guns.push([x+nx*side,z+nz*side,Math.atan2(tx,tz)]);nextGun+=160+((dist*7)%50);}
        if(dist>=nextNet && /black|red/.test(grade)){const side=-11;nets.push([x+nx*side,z+nz*side,Math.atan2(tx,tz)]);nextNet+=220;}
      }
    }
  }
  const o=new THREE.Object3D();
  const pole=new THREE.CylinderGeometry(.06,.07,2.7,6),disc=new THREE.CircleGeometry(.48,10),plate=new THREE.BoxGeometry(.03,.72,.72);
  const steel=new THREE.MeshStandardMaterial({color:0x8a9296,metalness:.45,roughness:.45}),white=new THREE.MeshStandardMaterial({color:0xf4f6f7,roughness:.7});
  const poles=new THREE.InstancedMesh(pole,steel,signs.length),plates=new THREE.InstancedMesh(plate,white,signs.length);
  const color=new THREE.Color();
  signs.forEach(([x,z,angle,grade],i)=>{const y=world.height(x,z);o.rotation.set(0,angle,0);o.position.set(x,y+1.35,z);o.scale.set(1,1,1);o.updateMatrix();poles.setMatrixAt(i,o.matrix);o.position.y=y+2.6;o.updateMatrix();plates.setMatrixAt(i,o.matrix);color.set(COLORS[grade]||COLORS.red);plates.setColorAt(i,color);});
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
