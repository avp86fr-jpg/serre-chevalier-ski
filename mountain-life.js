import * as THREE from './vendor/three.module.js';
import {clamp,lerp,seededRandom,DIFFICULTIES} from './core.js';
import {pisteWidth} from './open-world.js';
function routeLine(route,height){const points=[],distances=[0];for(let i=1;i<route.points.length;i++){const a=route.points[i-1],b=route.points[i],steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/8));for(let j=0;j<steps;j++){const x=lerp(a[0],b[0],j/steps),z=lerp(a[1],b[1],j/steps);points.push({x,y:height(x,z),z});}}const end=route.points.at(-1);points.push({x:end[0],y:height(...end),z:end[1]});if(points[0].y<points.at(-1).y)points.reverse();for(let i=1;i<points.length;i++)distances.push(distances.at(-1)+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y,points[i].z-points[i-1].z));return{route,points,distances,length:distances.at(-1)};}
export function lineAt(line,d){d=clamp(d,0,line.length);let a=0,b=line.points.length-1;while(b-a>1){const m=(a+b)>>1;if(line.distances[m]<d)a=m;else b=m;}const p=line.points[a],q=line.points[b],t=(d-line.distances[a])/(line.distances[b]-line.distances[a]||1);return{x:lerp(p.x,q.x,t),y:lerp(p.y,q.y,t),z:lerp(p.z,q.z,t),heading:Math.atan2(q.x-p.x,q.z-p.z)};}
function joined(parts){const position=[],normal=[];for(const geometry of parts){const g=geometry.index?geometry.toNonIndexed():geometry;position.push(...g.attributes.position.array);normal.push(...g.attributes.normal.array);if(g!==geometry)g.dispose();geometry.dispose();}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(position,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));return g;}
export class MountainLife{
 constructor(world){this.world=world;this.lines=world.data.routes.map(r=>routeLine(r,world.height));this.timer=0;this.clock=0;this.lastView=null;this.makeMarkers();
  const torso=joined([new THREE.CapsuleGeometry(.22,.36,3,6).translate(0,1.2,0),new THREE.CapsuleGeometry(.075,.4,3,5).rotateZ(.25).translate(-.32,1.08,0),new THREE.CapsuleGeometry(.075,.4,3,5).rotateZ(-.25).translate(.32,1.08,0)]),gear=joined([new THREE.SphereGeometry(.18,8,6).translate(0,1.68,0),new THREE.BoxGeometry(.12,.05,1.7).translate(-.2,.08,.15),new THREE.BoxGeometry(.12,.05,1.7).translate(.2,.08,.15),new THREE.CapsuleGeometry(.1,.5,3,5).translate(-.16,.61,0),new THREE.CapsuleGeometry(.1,.5,3,5).translate(.16,.61,0)]);
  this.bodies=new THREE.InstancedMesh(torso,new THREE.MeshStandardMaterial({roughness:.85}),48);this.gear=new THREE.InstancedMesh(gear,new THREE.MeshStandardMaterial({color:0x344c59,roughness:.6}),48);this.bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.gear.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.bodies.frustumCulled=this.gear.frustumCulled=false;this.bodies.count=this.gear.count=0;world.scene.add(this.bodies,this.gear);this.pose=new THREE.Object3D();this.color=new THREE.Color();this.population=[];const rand=seededRandom(708);
  for(const line of this.lines)for(let i=0;i<3;i++)this.population.push({line,phase:rand()*line.length,speed:4+rand()*7,offset:(rand()-.5)*Math.min(8,pisteWidth(line.route)*.6),color:rand()});
 }

 makeMarkers(){
  const w=this.world;this.markerCells=new Map();this.markerCount=0;
  for(const line of this.lines)for(let d=22;d<line.length-15;d+=45){const p=lineAt(line,d),width=pisteWidth(line.route);
   for(const side of [-1,1]){const x=p.x-Math.cos(p.heading)*width*side,z=p.z+Math.sin(p.heading)*width*side;
    // Leave the middle of junctions open; a neighboring piste can contain this edge.
    if(w.snowSurface.sample(x,z).margin>2.5)continue;
    const item={x,y:w.height(x,z),z,color:DIFFICULTIES[line.route.difficulty]?.color||'#3d8eb8'},key=Math.floor(x/512)+','+Math.floor(z/512);
    if(!this.markerCells.has(key))this.markerCells.set(key,[]);this.markerCells.get(key).push(item);this.markerCount++;
   }
  }
  const shaft=joined([new THREE.CylinderGeometry(.035,.045,1.4,5).translate(0,.7,0),new THREE.CylinderGeometry(.063,.063,.12,5).translate(0,1.83,0)]),colors=[],white=new THREE.Color('#e4e9df'),orange=new THREE.Color('#f29c4b');
  for(let i=0;i<shaft.attributes.position.count;i++){const c=shaft.attributes.position.getY(i)>1.6?orange:white;colors.push(c.r,c.g,c.b);}shaft.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  this.markerShafts=new THREE.InstancedMesh(shaft,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8}),256);
  this.markerBands=new THREE.InstancedMesh(new THREE.CylinderGeometry(.066,.066,.4,5).translate(0,1.58,0),new THREE.MeshStandardMaterial({roughness:.75}),256);
  this.markerShafts.name='Piste edge poles';this.markerBands.name='Piste difficulty bands';
  for(const mesh of [this.markerShafts,this.markerBands]){mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);w.scene.add(mesh);}this.markerPose=new THREE.Object3D();this.markerColor=new THREE.Color();
 }
 updateMarkers(active){
  const w=this.world;if(!active||w.options.pistes===false){this.markerShafts.count=this.markerBands.count=0;return;}
  const p=w.camera.position,ix=Math.floor(p.x/512),iz=Math.floor(p.z/512),candidates=[],range=w.quality==='low'?280:650,budget=w.quality==='low'?64:w.options.mobile?128:256;
  for(let x=ix-2;x<=ix+2;x++)for(let z=iz-2;z<=iz+2;z++)for(const item of this.markerCells.get(x+','+z)||[]){const distance=Math.hypot(item.x-p.x,item.z-p.z);if(distance<range)candidates.push({item,distance});}
  candidates.sort((a,b)=>a.distance-b.distance);const count=Math.min(budget,candidates.length);
  for(let i=0;i<count;i++){const p=candidates[i].item;this.markerPose.position.set(p.x,p.y,p.z);this.markerPose.updateMatrix();this.markerShafts.setMatrixAt(i,this.markerPose.matrix);this.markerBands.setMatrixAt(i,this.markerPose.matrix);this.markerBands.setColorAt(i,this.markerColor.set(p.color));}
  this.markerShafts.count=this.markerBands.count=count;this.markerShafts.instanceMatrix.needsUpdate=this.markerBands.instanceMatrix.needsUpdate=true;if(this.markerBands.instanceColor)this.markerBands.instanceColor.needsUpdate=true;
 }

 update(dt){const w=this.world;this.clock+=Math.max(0,dt);this.timer-=dt;const active=w.mode==='ride';const p=w.camera.position;
  if(this.timer<=0||!this.lastView||Math.hypot(p.x-this.lastView.x,p.z-this.lastView.z)>150){this.timer=.25;this.lastView={x:p.x,z:p.z};this.updateMarkers(active);}
  if(!active||w.options.crowds===false){this.bodies.count=this.gear.count=0;return;}
  if(dt===0&&this.bodies.count)return;this.crowdDue=(this.crowdDue||0)-dt;if(this.crowdDue>0&&this.bodies.count)return;this.crowdDue=w.options.mobile?1/24:1/30;
  const budget=w.quality==='low'?12:w.options.mobile?24:48,candidates=[];
  for(const a of this.population){const d=(a.phase+this.clock*a.speed)%a.line.length,q=lineAt(a.line,d),distance=Math.hypot(q.x-p.x,q.z-p.z);if(distance<600&&d>20&&d<a.line.length-20)candidates.push({a,q,distance,d});}
  candidates.sort((a,b)=>a.distance-b.distance);let count=0;
  for(const {a,q,d}of candidates){if(count>=budget)break;const turn=Math.sin(this.clock*.65+a.phase)*.8,offset=a.offset+turn,x=q.x-Math.cos(q.heading)*offset,z=q.z+Math.sin(q.heading)*offset;
   if(Math.hypot(x-w.skier.position.x,z-w.skier.position.z)<7)continue;
   const ahead=lineAt(a.line,Math.min(a.line.length,d+3)),slope=(ahead.y-q.y)/Math.max(1,Math.hypot(ahead.x-q.x,ahead.z-q.z));this.pose.position.set(x,w.height(x,z)+.10,z);this.pose.rotation.set(-Math.atan(slope),q.heading,turn*.06,'YXZ');this.pose.scale.setScalar(.92+a.color*.16);this.pose.updateMatrix();this.bodies.setMatrixAt(count,this.pose.matrix);this.gear.setMatrixAt(count,this.pose.matrix);this.color.setHSL(a.color,.65,.52);this.bodies.setColorAt(count,this.color);count++;
  }
  this.bodies.count=this.gear.count=count;this.bodies.instanceMatrix.needsUpdate=this.gear.instanceMatrix.needsUpdate=true;if(this.bodies.instanceColor)this.bodies.instanceColor.needsUpdate=true;
 }
}
export function liftDestinations(world){return world.liftRuns.map((r,i)=>{const points=r.rideLine.map(p=>({x:p.x,y:p.y,z:p.z}));if(points[0].y>points.at(-1).y)points.reverse();const distances=[0];for(let j=1;j<points.length;j++)distances.push(distances.at(-1)+Math.hypot(points[j].x-points[j-1].x,points[j].y-points[j-1].y,points[j].z-points[j-1].z));const line={points,distances,length:distances.at(-1)},top=points.at(-1),nearest=world.domain.locate(top.x,top.z,2),exit=nearest&&nearest.distance<140?{x:nearest.x,z:nearest.z}:{x:top.x+8,z:top.z};return{id:i,name:r.source.name||'Lift',gondola:r.gondola,bottom:points[0],top,exit,exitHeading:nearest?nearest.heading+(world.height(...nearest.a)<world.height(...nearest.b)?Math.PI:0):0,length:line.length,speed:r.speed,at:d=>lineAt(line,d)};});}
