import * as THREE from './vendor/three.module.js';
import {clamp,lerp} from './core.js';
import {bindPose,humanoidGeometry} from './skier-humanoid.js';

const DOWN=new THREE.Vector3(0,-1,0);
const COLORS={shell:0xc51f2a,panel:0xf3efe4,dark:0x1a2734,seam:0x8a1a22,sole:0x121820,metal:0xc9a15b,lime:0xe8d7a0,lens:0x3aa0c8,navy:0x1c3144,glove:0x1a1f24};
const names=['pelvis','torso','head',...[-1,1].flatMap(s=>['thigh','shin','boot','ski','upperArm','forearm','hand','pole'].map(n=>n+s))];
let shared;

// Analytic two-bone joint. The bend hint is projected onto the limb's plane.
// Callers retain the output vector: no vectors are allocated in the pose loop.
export function solveJoint(out,a,b,upper,lower,hint){
 let x=b.x-a.x,y=b.y-a.y,z=b.z-a.z,d=Math.hypot(x,y,z)||1e-8;x/=d;y/=d;z/=d;
 d=clamp(d,Math.abs(upper-lower)+1e-5,upper+lower-1e-5);
 const along=(upper*upper-lower*lower+d*d)/(2*d),radius=Math.sqrt(Math.max(0,upper*upper-along*along)),dot=hint.x*x+hint.y*y+hint.z*z;
 let hx=hint.x-dot*x,hy=hint.y-dot*y,hz=hint.z-dot*z,length=Math.hypot(hx,hy,hz);
 if(length<1e-6){hx=-y;hy=x;hz=0;length=Math.hypot(hx,hy)||1;}
 out.set(a.x+x*along+hx/length*radius,a.y+y*along+hy/length*radius,a.z+z*along+hz/length*radius);return out;
}

function skiGeometry(low=false){
 const positions=[],indices=[],segments=low?16:24;
 for(let i=0;i<=segments;i++){
  const t=i/segments,z=-.86+t*1.92,round=Math.min(1,.3+t*10,.18+(1-t)*10),width=(.054+.016*Math.abs(t-.43)*2)*round,rocker=Math.max(0,t-.82)**2*2.7+Math.max(0,.12-t)**2*.9;
  for(const [x,y]of [[-width,rocker],[width,rocker],[width,rocker+.028],[-width,rocker+.028]])positions.push(x,y,z);
  if(i)for(let j=0;j<4;j++){const a=(i-1)*4+j,b=(i-1)*4+(j+1)%4,c=i*4+j,d=i*4+(j+1)%4;indices.push(a,b,c,b,d,c);}
 }
 const end=segments*4;indices.push(0,3,1,1,3,2,end,end+1,end+3,end+1,end+2,end+3);
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return g;
}
function visorGeometry(width,height,depth,wrap=1.05){
 const positions=[],indices=[],columns=14;
 for(let row=0;row<3;row++)for(let i=0;i<=columns;i++){
  const u=i/columns-.5,yaw=u*wrap,x=Math.sin(yaw)*width*.92,z=depth+Math.cos(yaw)*(.11)-.02,y=(row/2-.5)*height*(1-Math.abs(u)*.18);
  positions.push(x,y,z);if(row&&i){const k=row*(columns+1)+i;indices.push(k-columns-2,k-columns-1,k-1,k-1,k-columns-1,k);}
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return g;
}
function clothNormal(){
 const size=128,data=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const i=(y*size+x)*4,folds=Math.sin(x*.38)*18+Math.sin(y*.22+x*.09)*12+Math.sin((x+y)*.7)*7,seam=Math.abs((x%32)-16)<1.6?14:0;
  data.set([128+Math.round(folds+seam),128+Math.round(Math.sin(y*.31)*16+Math.sin(x*.19)*9-seam*.4),230,255],i);
 }
 const texture=new THREE.DataTexture(data,size,size);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(5,7);texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.needsUpdate=true;return texture;
}
function raceSuitMap(){
 const size=128,data=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const i=(y*size+x)*4,u=x/size,v=y/size,stripe=(((u>.18&&u<.27)||(u>.73&&u<.82))&&v>.12&&v<.88)?1:0,chest=u>.42&&u<.58&&v>.32&&v<.58?1:0;
  const lycra=.86+.08*Math.sin(v*40)+.04*Math.sin(u*18);
  let r=210*lycra,g=36*lycra,b=42*lycra;
  if(stripe){r=g=b=245;}if(chest){r=18;g=24;b=32;}
  data.set([r,g,b,255],i);
 }
 const texture=new THREE.DataTexture(data,size,size);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(1,1);texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.needsUpdate=true;return texture;
}
function applyBind(bones){
 for(const name of names){const p=bindPose[name];bones[name].position.set(...p.pos);bones[name].quaternion.set(p.quat[0],p.quat[1],p.quat[2],p.quat[3]);}
}

function fabricMaterial(tint){
 const m=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.42,metalness:.16,normalMap:clothNormal(),normalScale:new THREE.Vector2(1.05,1.05),envMapIntensity:1.35});
 m.userData.suitTint=new THREE.Color(tint||COLORS.shell);
 m.onBeforeCompile=shader=>{shader.uniforms.suitTint={value:m.userData.suitTint};shader.vertexShader='attribute float suit;\nvarying float vSuit;varying vec2 vSuitUv;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvSuit=suit;vSuitUv=uv;');shader.fragmentShader='uniform vec3 suitTint;varying float vSuit;varying vec2 vSuitUv;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 vec3 lycra=suitTint*(.78+.22*diffuseColor.rgb);
 float stripe=step(.16,vSuitUv.x)*step(vSuitUv.x,.24)+step(.76,vSuitUv.x)*step(vSuitUv.x,.84);
 float panel=step(.42,vSuitUv.x)*step(vSuitUv.x,.58)*step(.30,vSuitUv.y)*step(vSuitUv.y,.62);
 lycra=mix(lycra,vec3(.93,.93,.91),stripe);
 lycra=mix(lycra,vec3(.08,.10,.14),panel);
 float sheen=pow(max(lycra.r,max(lycra.g,lycra.b)),2.4)*.2;
 diffuseColor.rgb=mix(diffuseColor.rgb,lycra+sheen,vSuit);`);};
 m.customProgramCacheKey=()=>'alpine-suit-v14-'+m.userData.suitTint.getHexString();
 return m;
}

function buildGeometry(bones,low=false){
 const buckets=Array.from({length:3},()=>({position:[],normal:[],uv:[],color:[],skinIndex:[],skinWeight:[],suit:[],indices:[]}));
 const human=humanoidGeometry(low),hp=human.attributes;
 const suit=new Float32Array(hp.position.count);
 for(let i=0;i<hp.position.count;i++){const r=hp.color.getX(i),g=hp.color.getY(i),b=hp.color.getZ(i);suit[i]=(r>.55&&g<.35&&b<.35)?1:0;}
 const b0=buckets[0],base0=0;
 b0.position.push(...hp.position.array);b0.normal.push(...hp.normal.array);b0.uv.push(...hp.uv.array);b0.color.push(...hp.color.array);b0.skinIndex.push(...hp.skinIndex.array);b0.skinWeight.push(...hp.skinWeight.array);b0.suit.push(...suit);
 if(human.index)for(const i of human.index.array)b0.indices.push(i);else for(let i=0;i<hp.position.count;i++)b0.indices.push(i);
 const add=(name,geometry,color,material=0,position=[0,0,0],rotation=[0,0,0],scale=[1,1,1])=>{
  const index=names.indexOf(name),bone=bones[name],local=new THREE.Matrix4().compose(new THREE.Vector3(...position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),new THREE.Vector3(...scale));
  geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(bone.matrixWorld,local));const g=geometry,b=buckets[material],c=new THREE.Color(color),count=g.attributes.position.count,base=b.position.length/3;
  if(g.index)for(const i of g.index.array)b.indices.push(base+i);else for(let i=0;i<count;i++)b.indices.push(base+i);
  b.position.push(...g.attributes.position.array);b.normal.push(...g.attributes.normal.array);if(g.attributes.uv)b.uv.push(...g.attributes.uv.array);else for(let i=0;i<count;i++)b.uv.push(0,0);
  for(let i=0;i<count;i++){b.color.push(g.attributes.color?.getX(i)??c.r,g.attributes.color?.getY(i)??c.g,g.attributes.color?.getZ(i)??c.b);b.skinIndex.push(index,0,0,0);b.skinWeight.push(1,0,0,0);b.suit.push(0);}
  geometry.dispose();
 };
 const box=(bone,size,color,mat,pos,rot,scale)=>add(bone,new THREE.BoxGeometry(...size),color,mat,pos,rot,scale);
 const capsule=(bone,r,length,color,mat,pos,rot,scale)=>add(bone,new THREE.CapsuleGeometry(r,length,low?2:3,low?6:8),color,mat,pos,rot,scale);
 // Helmet cap leaves the face open; strap and mirrored goggles sit over the eyes.
 add('head',new THREE.SphereGeometry(.168,low?10:16,low?8:12,0,Math.PI*2,0,Math.PI*.64),COLORS.panel,1,[0,.128,-.015]);
 add('head',new THREE.TorusGeometry(.162,.018,low?4:6,low?12:18),COLORS.sole,1,[0,.108,.02],[Math.PI/2,0,0]);
 add('head',new THREE.TorusGeometry(.15,.014,low?4:5,low?10:16),COLORS.dark,1,[0,.1,.01],[1.15,0,0]);
 add('head',visorGeometry(.34,.1,.11,1.28),COLORS.sole,1,[0,.102,.028]);
 add('head',visorGeometry(.29,.07,.13,.98),COLORS.lens,2,[0,.102,.042]);
 for(const side of [-1,1]){
  capsule('hand'+side,.048,.05,COLORS.glove,1,[0,-.015,.025],[.25,0,0],[1.05,1,1.08]);
  capsule('upperArm'+side,.072,.20,COLORS.shell,0,[0,.12,0]);
  capsule('forearm'+side,.058,.16,COLORS.shell,0,[0,.10,0]);
  box('boot'+side,[.16,.08,.32],COLORS.sole,1,[0,.04,.08]);
  capsule('boot'+side,.07,.12,COLORS.sole,1,[0,.11,.02],[Math.PI/2,0,0]);
  box('boot'+side,[.17,.02,.06],COLORS.metal,1,[0,.15,.04]);
  add('ski'+side,skiGeometry(low),COLORS.lime,1,[0,.02,-.05]);
  box('ski'+side,[.075,.007,.7],COLORS.dark,1,[0,.05,-.28]);box('ski'+side,[.085,.008,.22],COLORS.shell,1,[0,.052,.52],[0,side*.13,0]);
  box('ski'+side,[.086,.005,1.7],COLORS.metal,1,[0,.036,-.05]);
  box('ski'+side,[.14,.06,.12],COLORS.metal,1,[0,.08,.16]);box('ski'+side,[.145,.075,.12],COLORS.sole,1,[0,.085,-.22]);
  add('pole'+side,new THREE.CylinderGeometry(.009,.007,1.06,6),COLORS.metal,1,[0,-.58,0]);
  capsule('pole'+side,.022,.085,COLORS.sole,1,[0,-.03,0]);
  add('pole'+side,new THREE.TorusGeometry(.07,.011,5,10),COLORS.sole,1,[0,-1.04,0],[Math.PI/2,0,0]);
  add('pole'+side,new THREE.CircleGeometry(.068,10),COLORS.dark,1,[0,-1.04,0],[Math.PI/2,0,0]);
  add('pole'+side,new THREE.ConeGeometry(.01,.08,5),COLORS.sole,1,[0,-1.14,0],[Math.PI,0,0]);
 }
 const geometry=new THREE.BufferGeometry(),arrays={position:[],normal:[],uv:[],color:[],skinIndex:[],skinWeight:[],suit:[]};let start=0;const indices=[];
 buckets.forEach((b,i)=>{const base=arrays.position.length/3;for(const key in arrays)arrays[key].push(...b[key]);for(const index of b.indices)indices.push(base+index);const count=b.indices.length;geometry.addGroup(start,count,i);start+=count;});
 geometry.setIndex(indices);
 for(const [name,size]of [['position',3],['normal',3],['uv',2],['color',3],['skinIndex',4],['skinWeight',4],['suit',1]])geometry.setAttribute(name,name==='skinIndex'?new THREE.Uint16BufferAttribute(arrays[name],size):new THREE.Float32BufferAttribute(arrays[name],size));
 geometry.computeBoundingSphere();return geometry;
}

export const SUIT_KITS={hero:0xc51f2a,navy:0x1e3a6e,lime:0x8fb63c,gold:0xc9892a,teal:0x2a7c8c,violet:0x6b3d8f,white:0xe8e4d8};

export class Skier{
 constructor({ghost=false,kit='hero'}={}){
  this.root=new THREE.Group();this.root.name=ghost?'Best-run skier':'Alpine skier';this.bones={};
  for(const name of names){const bone=new THREE.Bone();bone.name=name;this.bones[name]=bone;this.root.add(bone);}
  this.state={tuck:0,brake:0,turn:0,walk:0,push:0,speed:0,clock:0,air:0,crash:0,grab:0};this.initialized=false;
  this.scratch=Array.from({length:20},()=>new THREE.Vector3());this.q=new THREE.Quaternion();this.euler=new THREE.Euler();this.inverse=new THREE.Matrix4();this.forwardHint=new THREE.Vector3(0,0,1);
  this.contacts=[new THREE.Vector3(),new THREE.Vector3()];this.worldContacts=[{x:0,y:0,z:0,tx:0,tz:1},{x:0,y:0,z:0,tx:0,tz:1}];this.edge=0;this.bindQ={};this.bindQInv={};for(const name of names){const q=bindPose[name].quat;this.bindQ[name]=new THREE.Quaternion(q[0],q[1],q[2],q[3]);this.bindQInv[name]=this.bindQ[name].clone().invert();}this.limbAxis=new THREE.Vector3(0,1,0);
  applyBind(this.bones);this.root.updateMatrixWorld(true);
  if(!shared){const geometry=buildGeometry(this.bones),gear=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.32,metalness:.28}),lens=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.045,metalness:.96,envMapIntensity:1.4});shared={geometry,lowGeometry:buildGeometry(this.bones,true),gear,lens,fabrics:{}};}
  if(!shared.fabrics[kit])shared.fabrics[kit]=fabricMaterial(SUIT_KITS[kit]||SUIT_KITS.hero);
  this.skeleton=new THREE.Skeleton(names.map(name=>this.bones[name]));
  this.mesh=new THREE.SkinnedMesh(ghost?shared.lowGeometry:shared.geometry,ghost?new THREE.MeshBasicMaterial({color:0xbfe8e0,transparent:true,opacity:.24,depthWrite:false}):[shared.fabrics[kit],shared.gear,shared.lens]);
  this.mesh.name=ghost?'Ghost body':'Skier shell, equipment and lens';this.mesh.bind(this.skeleton);this.mesh.castShadow=!ghost;this.mesh.receiveShadow=!ghost;this.mesh.frustumCulled=false;this.root.add(this.mesh);this.root.visible=false;
 }
 setQuality(low){this.mesh.geometry=low?shared.lowGeometry:shared.geometry;}
 bone(name,position,rotation){const b=this.bones[name];b.position.copy(position);if(rotation)b.quaternion.copy(rotation).multiply(this.bindQ[name]);else b.quaternion.copy(this.bindQ[name]);return b;}
 limb(name,a,b){const bone=this.bones[name];bone.position.copy(a);this.scratch[19].subVectors(b,a).normalize();const rest=name.startsWith('pole')?DOWN:this.limbAxis;this.scratch[18].copy(rest).applyQuaternion(this.bindQ[name]);if(this.scratch[18].lengthSq()<1e-8)this.scratch[18].copy(rest);bone.quaternion.setFromUnitVectors(this.scratch[18].normalize(),this.scratch[19]).multiply(this.bindQ[name]);}
 ground(x,z,height){if(!height)return-.075;const v=this.scratch[18].set(x,0,z).applyMatrix4(this.root.matrixWorld);v.y=height(v.x,v.z)+.025;v.applyMatrix4(this.inverse);return v.y;}
 update(run,input,dt,time,height,motion=.35){
  const s=this.state,air=run.airborne?1:0,crash=run.crashed>0?1:0,tuck=input.tuck&&run.speed>4&&!air?1:0,brake=input.brake&&!air&&!crash?1:0,walk=run.walking&&!air?1:0,push=input.tuck&&run.speed<4&&!input.brake&&!air?1:0;
  const alpha=this.initialized?1-Math.exp(-Math.max(0,dt)*9):1;
  for(const [key,target]of [['tuck',tuck],['brake',brake],['turn',clamp(run.edgeAngle/.48,-1,1)],['walk',walk],['push',push],['speed',run.speed],['air',air],['crash',crash],['grab',run.grab?1:0]])s[key]=lerp(s[key],target,alpha);
  s.clock+=Math.max(0,dt);this.initialized=true;this.root.updateMatrixWorld(true);this.inverse.copy(this.root.matrixWorld).invert();this.pose(height,time,motion);this.root.updateMatrixWorld(true);
  for(let i=0;i<2;i++){const bone=this.bones['ski'+(i?1:-1)],m=bone.matrixWorld.elements,out=this.worldContacts[i],length=Math.hypot(m[8],m[10]);out.x=m[12];out.y=m[13];out.z=m[14];out.tx=m[8]/length;out.tz=m[10]/length;}
 }
 pose(height,time,motion){
  const s=this.state,b=this.bones,v=this.scratch,turn=s.turn,edge=Math.abs(turn),air=s.air,crash=s.crash,grab=s.grab,stride=Math.sin(s.clock*7)*s.walk*.19,stance=.42+s.brake*.20+s.walk*.06-air*.12+crash*.28,tuck=s.tuck;

  for(let i=0;i<2;i++){
   const side=i?1:-1,x=side*stance/2,z=side*stride+crash*side*.04,yaw=side*(s.walk*.25-s.brake*.24)+crash*side*.4-turn*.025;
   const follow=air<.5&&crash<.5?height:null;
   const left=this.ground(x-Math.cos(yaw)*.08,z+Math.sin(yaw)*.08,follow),right=this.ground(x+Math.cos(yaw)*.08,z-Math.sin(yaw)*.08,follow),roll=clamp(Math.atan2(right-left,.16)+turn*.23+crash*side*.5,-.85,.85);
   const gy=this.ground(x,z,follow),front=this.ground(x+Math.sin(yaw)*.55,z+Math.cos(yaw)*.55,follow),back=this.ground(x-Math.sin(yaw)*.55,z-Math.cos(yaw)*.55,follow),pitch=clamp(-Math.atan2(front-back,1.1)+air*.18-crash*.55,-.7,.55);
   v[i].set(x,gy+Math.abs(Math.sin(turn*.23))*.064+Math.max(0,side*Math.cos(s.clock*7))*s.walk*.035+air*.05,z+air*.04);
   this.q.setFromEuler(this.euler.set(pitch,yaw,roll,'YXZ'));this.bone('ski'+side,v[i],this.q);this.bone('boot'+side,v[i],this.q);
   this.contacts[i].copy(v[i]);v[i+2].set(0,.205,-.025).applyQuaternion(this.q).add(v[i]);
  }
  const ground=(v[0].y+v[1].y)/2+.075,breath=Math.sin(s.clock*1.8)*.006*(1-clamp(s.speed/4,0,1))*motion*(1-air);
  const pelvis=v[4].set(-turn*.16+crash*.22,.88+ground-tuck*.21-s.brake*.045-edge*.04+breath-crash*.42+air*.04,-.055-tuck*.12+air*.08-crash*.2);
  this.bone('pelvis',pelvis);this.q.setFromEuler(this.euler.set(.12+tuck*.70+air*.25+crash*(.9+s.clock*1.8),-turn*.14+crash*(.4+Math.sin(s.clock*7)*.3),turn*.18-crash*.5,'YXZ'));
  const chest=v[13].set(bindPose.torso.pos[0]-bindPose.pelvis.pos[0],bindPose.torso.pos[1]-bindPose.pelvis.pos[1],bindPose.torso.pos[2]-bindPose.pelvis.pos[2]).applyQuaternion(this.q).add(pelvis);
  this.bone('torso',chest,this.q);
  const head=v[5].set(bindPose.head.pos[0]-bindPose.pelvis.pos[0],bindPose.head.pos[1]-bindPose.pelvis.pos[1],bindPose.head.pos[2]-bindPose.pelvis.pos[2]).applyQuaternion(this.q).add(pelvis);this.q.setFromEuler(this.euler.set(-.03-tuck*.10+crash*.6,-turn*.22,turn*.08));this.bone('head',head,this.q);
  for(let i=0;i<2;i++){
   const side=i?1:-1,hip=v[6].set(pelvis.x+side*.16,pelvis.y,pelvis.z),knee=v[7];solveJoint(knee,hip,v[i+2],.43,.42,this.forwardHint);this.limb('thigh'+side,hip,knee);this.limb('shin'+side,knee,v[i+2]);
   const shoulder=v[8].set(bindPose['upperArm'+side].pos[0]-bindPose.pelvis.pos[0],bindPose['upperArm'+side].pos[1]-bindPose.pelvis.pos[1],bindPose['upperArm'+side].pos[2]-bindPose.pelvis.pos[2]).applyQuaternion(b.torso.quaternion).add(pelvis),stroke=Math.sin(s.clock*6+(s.walk>.5?(side>0?Math.PI:0):side*.3))*s.push;
   let hx=side*(.35-tuck*.09+s.brake*.07)-turn*.07,hy=pelvis.y+.16+tuck*.06,hz=.19+tuck*.32+stroke*.15;
   if(air>.4){hx=side*(.28+grab*.16);hy=pelvis.y+.08-grab*.22;hz=.02+grab*side*.02-grab*.12;}
   if(crash>.4){hx=side*.55;hy=pelvis.y-.05;hz=-.15;}
   const hand=v[9].set(hx,hy,hz);const armReach=hand.distanceTo(shoulder);if(armReach>.56)hand.lerp(shoulder,1-.56/armReach);const elbow=v[10],hint=v[11].set(side,air>.4?-.05:-.3,air>.4?.2:-.4);
   solveJoint(elbow,shoulder,hand,.29,.28,hint);this.limb('upperArm'+side,shoulder,elbow);this.limb('forearm'+side,elbow,hand);b['hand'+side].position.copy(hand);b['hand'+side].quaternion.copy(b['forearm'+side].quaternion).multiply(this.bindQInv['forearm'+side]).multiply(this.bindQ['hand'+side]);
   const plant=Math.max(0,Math.sin(s.clock*5.2+side*1.2))*edge*(1-tuck)*(1-air)*(1-crash)*clamp(s.speed/14,0,1);
   const tip=v[12].set(hand.x+side*.08,air>.4||crash>.4?hand.y-1.05:this.ground(hand.x+side*.08,hand.z-.5,height),hand.z-.5);
   const clearance=clamp(hand.y-tip.y,.15,1.17)*(1-tuck*.62)*(1-air*.15)*(1-plant*.28);const reach=Math.sqrt(Math.max(.01,1.18**2-clearance**2));tip.z=hand.z-reach*(air>.4?.4:1);tip.y=hand.y-clearance+(s.push?Math.max(0,stroke)*.17:0)-plant*.04;this.limb('pole'+side,hand,tip);
  }
  this.edge=turn*.23;
 }
}
