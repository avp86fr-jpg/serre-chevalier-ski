import * as THREE from './vendor/three.module.js';
import {clamp,lerp,seededRandom,DIFFICULTIES} from './core.js';
import {pisteWidth} from './open-world.js';
import {Skier,SUIT_KITS} from './skier.js';
function routeLine(route,height){const points=[],distances=[0];for(let i=1;i<route.points.length;i++){const a=route.points[i-1],b=route.points[i],steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/8));for(let j=0;j<steps;j++){const x=lerp(a[0],b[0],j/steps),z=lerp(a[1],b[1],j/steps);points.push({x,y:height(x,z),z});}}const end=route.points.at(-1);points.push({x:end[0],y:height(...end),z:end[1]});if(points[0].y<points.at(-1).y)points.reverse();for(let i=1;i<points.length;i++)distances.push(distances.at(-1)+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y,points[i].z-points[i-1].z));return{route,points,distances,length:distances.at(-1)};}
export function lineAt(line,d){d=clamp(d,0,line.length);let a=0,b=line.points.length-1;while(b-a>1){const m=(a+b)>>1;if(line.distances[m]<d)a=m;else b=m;}const p=line.points[a],q=line.points[b],t=(d-line.distances[a])/(line.distances[b]-line.distances[a]||1);return{x:lerp(p.x,q.x,t),y:lerp(p.y,q.y,t),z:lerp(p.z,q.z,t),heading:Math.atan2(q.x-p.x,q.z-p.z)};}
function joined(parts){const position=[],normal=[];for(const geometry of parts){const g=geometry.index?geometry.toNonIndexed():geometry;position.push(...g.attributes.position.array);normal.push(...g.attributes.normal.array);if(g!==geometry)g.dispose();geometry.dispose();}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(position,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));return g;}
export class MountainLife{
 constructor(world){this.world=world;this.lines=world.data.routes.map(r=>routeLine(r,world.height));this.timer=0;this.clock=0;this.lastView=null;this.makeMarkers();
  const kits=Object.keys(SUIT_KITS).filter(k=>k!=='hero');
  this.actors=[];for(let i=0;i<10;i++){const skier=new Skier({kit:kits[i%kits.length]});skier.root.visible=false;skier.mesh.castShadow=false;world.scene.add(skier.root);this.actors.push(skier);}this.bodies=new THREE.InstancedMesh(new THREE.BoxGeometry(.1,.1,.1),new THREE.MeshBasicMaterial({visible:false}),16);this.bodies.count=0;this.bodies.visible=false;this.bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.pose=new THREE.Object3D();
  this.population=[];const rand=seededRandom(708);
  for(const line of this.lines){const starts=[30+rand()*40,110+rand()*70,220+rand()*90,rand()*Math.max(80,line.length*.7)];for(const phase of starts)this.population.push({line,phase:phase%line.length,speed:4+rand()*7,offset:(rand()-.5)*Math.min(8,pisteWidth(line.route)*.6),color:rand(),kit:kits[(this.population.length)%kits.length]});}
  this.makeBashers(rand);
 }
 makeBashers(rand){
  const cab=joined([new THREE.BoxGeometry(1.8,1.15,2.4).translate(0,.95,0),new THREE.BoxGeometry(1.6,.55,1.1).translate(0,1.65,-.15),new THREE.BoxGeometry(2.6,.18,1.15).translate(0,.55,1.55),new THREE.BoxGeometry(2.7,.08,.35).translate(0,.28,2.05)]);
  const tracks=joined([new THREE.BoxGeometry(2.2,.45,3.3).translate(0,.28,0),new THREE.BoxGeometry(.18,.22,3.2).translate(-.95,.18,0),new THREE.BoxGeometry(.18,.22,3.2).translate(.95,.18,0)]);
  const paint=new THREE.MeshStandardMaterial({color:0xd6a31e,roughness:.45,metalness:.15}),steel=new THREE.MeshStandardMaterial({color:0x2c3338,roughness:.55,metalness:.35});
  this.basherGroup=new THREE.Group();this.basherGroup.name='Piste bashers';this.world.scene.add(this.basherGroup);
  this.bashers=[];
  const long=this.lines.filter(l=>l.length>600).sort((a,b)=>b.length-a.length).slice(0,4);
  for(let i=0;i<Math.min(3,long.length);i++){
    const line=long[i],group=new THREE.Group(),body=new THREE.Mesh(cab,paint),gear=new THREE.Mesh(tracks,steel),beacon=new THREE.Mesh(new THREE.SphereGeometry(.11,8,6),new THREE.MeshStandardMaterial({color:0xff6a2a,emissive:0xff3c00,emissiveIntensity:1.2,roughness:.4}));
    beacon.position.set(0,2.05,.2);body.castShadow=gear.castShadow=true;group.add(body,gear,beacon);group.visible=false;this.basherGroup.add(group);
    this.bashers.push({line,phase:rand()*(line.length*.7)+40,speed:1.8+rand()*1.4,offset:(rand()-.5)*2,group,beacon});
  }
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
  if(!active||w.options.crowds===false){for(const s of this.actors)s.root.visible=false;if(this.basherGroup)this.basherGroup.visible=false;this.bodies.count=0;return;}
  if(this.basherGroup)this.basherGroup.visible=true;
  for(const b of this.bashers||[]){const d=(b.phase+this.clock*b.speed)%b.line.length,q=lineAt(b.line,d),ahead=lineAt(b.line,Math.min(b.line.length,d+5));
    const x=q.x-Math.cos(q.heading)*b.offset,z=q.z+Math.sin(q.heading)*b.offset,y=w.height(x,z);
    const visible=Math.hypot(x-p.x,z-p.z)<900;b.group.visible=visible;
    if(visible){const slope=(ahead.y-q.y)/Math.max(1,Math.hypot(ahead.x-q.x,ahead.z-q.z));b.group.position.set(x,y,z);b.group.rotation.set(-Math.atan(slope),q.heading,0,'YXZ');if(b.beacon?.material)b.beacon.material.emissiveIntensity=.7+.7*Math.abs(Math.sin(this.clock*8));}
  }
  this.crowdDue=(this.crowdDue||0)-dt;if(this.crowdDue>0&&dt!==0){/* still keep visible actors this frame */ }else this.crowdDue=w.options.mobile?1/20:1/24;
  if(this.crowdDue<=1/20||dt===0){
   const budget=Math.min(this.actors.length,w.quality==='low'?6:w.options.mobile?8:10),candidates=[];
   for(const a of this.population){const d=(a.phase+this.clock*a.speed)%a.line.length,q=lineAt(a.line,d),distance=Math.hypot(q.x-p.x,q.z-p.z);if(distance<1100&&d>6&&d<a.line.length-12)candidates.push({a,q,distance,d});}
   candidates.sort((a,b)=>a.distance-b.distance);let count=0;
   for(const {a,q,d}of candidates){if(count>=budget)break;const turn=Math.sin(this.clock*.65+a.phase)*.8,offset=a.offset+turn,x=q.x-Math.cos(q.heading)*offset,z=q.z+Math.sin(q.heading)*offset;
    if(Math.hypot(x-w.skier.position.x,z-w.skier.position.z)<7)continue;
    const ahead=lineAt(a.line,Math.min(a.line.length,d+3)),slope=(ahead.y-q.y)/Math.max(1,Math.hypot(ahead.x-q.x,ahead.z-q.z)),skier=this.actors[count],y=w.height(x,z)+.10;
    skier.root.visible=true;skier.root.position.set(x,y,z);skier.root.rotation.set(-Math.atan(slope),q.heading,turn*.06,'YXZ');
    skier.update({speed:a.speed,edgeAngle:turn*.25,walking:false,airborne:false,crashed:0,grab:'',softSnow:0},{tuck:a.speed>8},Math.max(0,dt),this.clock,w.height,.2);
    this.pose.position.set(x,y,z);this.pose.rotation.set(-Math.atan(slope),q.heading,turn*.06,'YXZ');this.pose.scale.setScalar(1);this.pose.updateMatrix();this.bodies.setMatrixAt(count,this.pose.matrix);
    count++;
   }
   for(let i=count;i<this.actors.length;i++)this.actors[i].root.visible=false;
   this.bodies.count=count;this.bodies.instanceMatrix.needsUpdate=true;
  }
 }
}
export function liftDestinations(world){return world.liftRuns.map((r,i)=>{const points=r.rideLine.map(p=>({x:p.x,y:p.y,z:p.z}));if(points[0].y>points.at(-1).y)points.reverse();const distances=[0];for(let j=1;j<points.length;j++)distances.push(distances.at(-1)+Math.hypot(points[j].x-points[j-1].x,points[j].y-points[j-1].y,points[j].z-points[j-1].z));const line={points,distances,length:distances.at(-1)},top=points.at(-1),nearest=world.domain.locate(top.x,top.z,2),exit=nearest&&nearest.distance<140?{x:nearest.x,z:nearest.z}:{x:top.x+8,z:top.z};return{id:i,name:r.source.name||'Lift',gondola:r.gondola,bottom:points[0],top,exit,exitHeading:nearest?nearest.heading+(world.height(...nearest.a)<world.height(...nearest.b)?Math.PI:0):0,length:line.length,speed:r.speed,at:d=>lineAt(line,d)};});}
