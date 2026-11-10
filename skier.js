import * as THREE from './vendor/three.module.js';
import {clamp,lerp} from './core.js';

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
function visorGeometry(width,height,depth){
 const positions=[],indices=[],columns=12;
 for(let row=0;row<3;row++)for(let i=0;i<=columns;i++){const x=(i/columns-.5)*width;positions.push(x,(row/2-.5)*height,depth+Math.sqrt(Math.max(0,.20**2-x*x)));if(row&&i){const k=row*(columns+1)+i;indices.push(k-columns-2,k-columns-1,k-1,k-1,k-columns-1,k);}}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return g;
}
function clothNormal(){
 const size=64,data=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(y*size+x)*4;data.set([128+Math.round(Math.sin(x*Math.PI/1.4)*26+Math.sin(y*.7)*8),128+Math.round(Math.sin(y*Math.PI/1.4)*26+Math.sin(x*.7)*8),240,255],i);}
 const texture=new THREE.DataTexture(data,size,size);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(7,8);texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.needsUpdate=true;return texture;
}
function buildGeometry(bones,low=false){
 const buckets=Array.from({length:3},()=>({position:[],normal:[],uv:[],color:[],skinIndex:[],skinWeight:[],indices:[]}));
 const add=(name,geometry,color,material=0,position=[0,0,0],rotation=[0,0,0],scale=[1,1,1])=>{
  const index=names.indexOf(name),bone=bones[name],local=new THREE.Matrix4().compose(new THREE.Vector3(...position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),new THREE.Vector3(...scale));
  geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(bone.matrixWorld,local));const g=geometry,b=buckets[material],c=new THREE.Color(color),count=g.attributes.position.count,base=b.position.length/3;
  if(g.index)for(const i of g.index.array)b.indices.push(base+i);else for(let i=0;i<count;i++)b.indices.push(base+i);
  b.position.push(...g.attributes.position.array);b.normal.push(...g.attributes.normal.array);if(g.attributes.uv)b.uv.push(...g.attributes.uv.array);else for(let i=0;i<count;i++)b.uv.push(0,0);
  for(let i=0;i<count;i++){b.color.push(g.attributes.color?.getX(i)??c.r,g.attributes.color?.getY(i)??c.g,g.attributes.color?.getZ(i)??c.b);b.skinIndex.push(index,0,0,0);b.skinWeight.push(1,0,0,0);}
  geometry.dispose();
 };
 const box=(bone,size,color,mat,pos,rot,scale)=>add(bone,new THREE.BoxGeometry(...size),color,mat,pos,rot,scale);
 const capsule=(bone,r,length,color,mat,pos,rot,scale)=>add(bone,new THREE.CapsuleGeometry(r,length,low?2:3,low?6:8),color,mat,pos,rot,scale);
 // Tailored shell, tapered waist, contrasting shoulders, collar, zipper and pockets.
 const profile=[[.18,0],[.21,.045],[.22,.16],[.247,.32],[.247,.322],[.25,.34],[.22,.43],[.155,.48]].map(([r,y])=>new THREE.Vector2(r,y));
 const shell=new THREE.LatheGeometry(profile,low?12:16),panelColors=[];for(let i=0;i<shell.attributes.position.count;i++){const c=new THREE.Color(shell.attributes.position.getY(i)>.32&&Math.abs(shell.attributes.position.getX(i))>.13?COLORS.panel:COLORS.shell);panelColors.push(c.r,c.g,c.b);}shell.setAttribute('color',new THREE.Float32BufferAttribute(panelColors,3));
 add('torso',shell,COLORS.shell,0,[0,0,0],[0,0,0],[1,1,.66]);
 capsule('pelvis',.16,.12,COLORS.dark,0,[0,-.025,0],[0,0,Math.PI/2],[1,1,.73]);
 add('torso',new THREE.TorusGeometry(.116,.038,5,16),COLORS.dark,0,[0,.46,0],[Math.PI/2,0,0],[1,1,.85]);
 box('torso',[.014,.38,.009],COLORS.sole,1,[0,.23,.155]);box('torso',[.018,.035,.01],COLORS.metal,1,[0,.34,.164]);
 for(const side of [-1,1]){
  box('torso',[.009,.12,.008],COLORS.seam,0,[side*.135,.15,.146],[0,0,-side*.33]);
  box('torso',[.032,.075,.014],COLORS.lime,0,[side*.18,.34,-.137],[0,0,side*.15]);
  // quilted shell folds and sleeve cuff contrast
  for(const y of [.10,.20,.30])box('torso',[.20,.012,.01],COLORS.seam,0,[side*.02,y,.148],[0,0,side*.04]);
 }
 box('torso',[.16,.13,.02],COLORS.panel,0,[0,.28,.15]);
 box('torso',[.11,.09,.012],COLORS.dark,0,[0,.27,.162]);
 box('torso',[.09,.018,.008],COLORS.metal,1,[0,.30,.17]);
 // Helmet shell with ear pads, a wraparound strap, opaque mirrored lens and vents.
 add('head',new THREE.SphereGeometry(.154,12,8),COLORS.dark,0,[0,-.025,.005],[0,0,0],[1,1.08,1.12]);
 add('head',new THREE.SphereGeometry(.174,low?12:16,low?8:10,0,Math.PI*2,0,Math.PI*.60),COLORS.panel,1,[0,.025,0],[0,0,0],[1,1.04,1.12]);
 capsule('head',.075,.12,COLORS.sole,0,[0,-.115,-.015],[0,0,0],[1,.65,.9]);
 add('head',new THREE.TorusGeometry(.171,.017,4,20),COLORS.sole,1,[0,.015,0],[Math.PI/2,0,0],[1,1.1,1]);
 add('head',visorGeometry(.372,.118,.06),COLORS.sole,1,[0,.03,0]);
 add('head',visorGeometry(.336,.092,.082),COLORS.lens,2,[0,.03,0]);
 add('head',new THREE.SphereGeometry(.025,8,6),0xba8d73,0,[0,-.04,.185],[0,0,0],[.65,1,1]);
 for(const side of [-1,1]){
  capsule('head',.046,.045,COLORS.dark,1,[side*.16,-.055,-.005],[0,0,0],[.45,1,1]);
  for(const z of [-.06,.015,.09])box('head',[.014,.009,.041],COLORS.sole,1,[side*.057,.179-Math.abs(z)*.24,z],[z*.8,0,side*-.2]);
  capsule('thigh'+side,.101,.23,COLORS.dark,0,[0,-.21,0],[0,0,0],[1,1,1.06]);
  capsule('shin'+side,.085,.25,COLORS.dark,0,[0,-.20,0]);
  capsule('shin'+side,.088,.055,COLORS.sole,0,[0,-.02,.015],[0,0,0],[1,.8,1]);
  box('thigh'+side,[.014,.19,.065],COLORS.panel,0,[side*.095,-.19,0]);
  box('boot'+side,[.175,.045,.32],COLORS.sole,1,[0,.055,.045]);
  capsule('boot'+side,.08,.15,COLORS.sole,1,[0,.12,.065],[Math.PI/2,0,0],[1,1,.8]);
  capsule('boot'+side,.087,.13,COLORS.panel,1,[0,.205,-.025],[.10,0,0],[1,1,.9]);
  for(const y of [.15,.23])box('boot'+side,[.18,.025,.045],COLORS.metal,1,[0,y,.035]);
  box('boot'+side,[.018,.1,.035],COLORS.lime,1,[side*.09,.20,-.01]);
  add('ski'+side,skiGeometry(low),COLORS.lime,1);
  box('ski'+side,[.075,.007,.7],COLORS.dark,1,[0,.033,-.28]);box('ski'+side,[.085,.008,.22],COLORS.shell,1,[0,.034,.56],[0,side*.13,0]);box('ski'+side,[.086,.005,1.7],COLORS.metal,1,[0,.018,0]);
  box('ski'+side,[.14,.065,.12],COLORS.metal,1,[0,.065,.23]);box('ski'+side,[.145,.08,.12],COLORS.sole,1,[0,.072,-.16]);
  capsule('upperArm'+side,.079,.17,COLORS.shell,0,[0,-.13,0]);
  capsule('upperArm'+side,.083,.045,COLORS.panel,0,[0,-.035,0]);
  capsule('forearm'+side,.068,.15,COLORS.shell,0,[0,-.12,0]);
  capsule('forearm'+side,.071,.025,COLORS.dark,0,[0,-.235,0]);
  capsule('hand'+side,.072,.055,COLORS.glove,1,[0,-.02,.02],[.25,0,0],[.95,1,1.05]);box('hand'+side,[.05,.04,.07],COLORS.glove,1,[0,-.05,.04]);
  add('pole'+side,new THREE.CylinderGeometry(.009,.007,1.06,6),COLORS.metal,1,[0,-.58,0]);
  capsule('pole'+side,.022,.085,COLORS.sole,1,[0,-.03,0]);
  add('pole'+side,new THREE.TorusGeometry(.07,.011,5,10),COLORS.sole,1,[0,-1.04,0],[Math.PI/2,0,0]);add('pole'+side,new THREE.CircleGeometry(.068,10),COLORS.dark,1,[0,-1.04,0],[Math.PI/2,0,0]);
  add('pole'+side,new THREE.ConeGeometry(.01,.08,5),COLORS.sole,1,[0,-1.14,0],[Math.PI,0,0]);
 }
 const geometry=new THREE.BufferGeometry(),arrays={position:[],normal:[],uv:[],color:[],skinIndex:[],skinWeight:[]};let start=0;const indices=[];
 buckets.forEach((b,i)=>{const base=arrays.position.length/3;for(const key in arrays)arrays[key].push(...b[key]);for(const index of b.indices)indices.push(base+index);const count=b.indices.length;geometry.addGroup(start,count,i);start+=count;});
 geometry.setIndex(indices);
 for(const [name,size]of [['position',3],['normal',3],['uv',2],['color',3],['skinIndex',4],['skinWeight',4]])geometry.setAttribute(name,name==='skinIndex'?new THREE.Uint16BufferAttribute(arrays[name],size):new THREE.Float32BufferAttribute(arrays[name],size));
 geometry.computeBoundingSphere();return geometry;
}

export class Skier{
 constructor({ghost=false}={}){
  this.root=new THREE.Group();this.root.name=ghost?'Best-run skier':'Alpine skier';this.bones={};
  for(const name of names){const bone=new THREE.Bone();bone.name=name;this.bones[name]=bone;this.root.add(bone);}
  this.state={tuck:0,brake:0,turn:0,walk:0,push:0,speed:0,clock:0,air:0,crash:0,grab:0};this.initialized=false;
  this.scratch=Array.from({length:20},()=>new THREE.Vector3());this.q=new THREE.Quaternion();this.euler=new THREE.Euler();this.inverse=new THREE.Matrix4();this.forwardHint=new THREE.Vector3(0,0,1);
  this.contacts=[new THREE.Vector3(),new THREE.Vector3()];this.worldContacts=[{x:0,y:0,z:0,tx:0,tz:1},{x:0,y:0,z:0,tx:0,tz:1}];this.edge=0;
  this.pose(null,0,0);this.root.updateMatrixWorld(true);
  if(!shared){const geometry=buildGeometry(this.bones),fabric=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.78,normalMap:clothNormal(),normalScale:new THREE.Vector2(.55,.55)}),gear=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.4,metalness:.18}),lens=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.06,metalness:.92});shared={geometry,lowGeometry:buildGeometry(this.bones,true),materials:[fabric,gear,lens]};}
  this.skeleton=new THREE.Skeleton(names.map(name=>this.bones[name]));
  this.mesh=new THREE.SkinnedMesh(ghost?shared.lowGeometry:shared.geometry,ghost?new THREE.MeshBasicMaterial({color:0xbfe8e0,transparent:true,opacity:.24,depthWrite:false}):shared.materials);
  this.mesh.name=ghost?'Ghost body':'Skier shell, equipment and lens';this.mesh.bind(this.skeleton);this.mesh.castShadow=!ghost;this.mesh.receiveShadow=!ghost;this.mesh.frustumCulled=false;this.root.add(this.mesh);this.root.visible=false;
 }
 setQuality(low){this.mesh.geometry=low?shared.lowGeometry:shared.geometry;}
 bone(name,position,rotation){const b=this.bones[name];b.position.copy(position);if(rotation)b.quaternion.copy(rotation);else b.quaternion.identity();return b;}
 limb(name,a,b){const bone=this.bones[name];bone.position.copy(a);this.scratch[19].subVectors(b,a).normalize();bone.quaternion.setFromUnitVectors(DOWN,this.scratch[19]);}
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
  const pelvis=v[4].set(-turn*.13+crash*.22,.88+ground-tuck*.21-s.brake*.045-edge*.035+breath-crash*.42+air*.04,-.055-tuck*.12+air*.08-crash*.2);
  this.bone('pelvis',pelvis);this.q.setFromEuler(this.euler.set(.12+tuck*.70+air*.25+crash*.9,-turn*.11+crash*.4,turn*.11-crash*.5,'YXZ'));this.bone('torso',pelvis,this.q);
  const head=v[5].set(0,.635,.015).applyQuaternion(this.q).add(pelvis);this.q.setFromEuler(this.euler.set(-.03-tuck*.10+crash*.6,-turn*.18,turn*.05));this.bone('head',head,this.q);
  for(let i=0;i<2;i++){
   const side=i?1:-1,hip=v[6].set(pelvis.x+side*.16,pelvis.y,pelvis.z),knee=v[7];solveJoint(knee,hip,v[i+2],.43,.42,this.forwardHint);this.limb('thigh'+side,hip,knee);this.limb('shin'+side,knee,v[i+2]);
   const shoulder=v[8].set(side*.235,.385,0).applyQuaternion(b.torso.quaternion).add(pelvis),stroke=Math.sin(s.clock*6+(s.walk>.5?(side>0?Math.PI:0):side*.3))*s.push;
   let hx=side*(.35-tuck*.09+s.brake*.07)-turn*.07,hy=pelvis.y+.16+tuck*.06,hz=.19+tuck*.32+stroke*.15;
   if(air>.4){hx=side*(.28+grab*.16);hy=pelvis.y+.08-grab*.22;hz=.02+grab*side*.02-grab*.12;}
   if(crash>.4){hx=side*.55;hy=pelvis.y-.05;hz=-.15;}
   const hand=v[9].set(hx,hy,hz),elbow=v[10],hint=v[11].set(side,air>.4?-.05:-.3,air>.4?.2:-.4);
   solveJoint(elbow,shoulder,hand,.29,.28,hint);this.limb('upperArm'+side,shoulder,elbow);this.limb('forearm'+side,elbow,hand);this.bone('hand'+side,hand,b['forearm'+side].quaternion);
   const tip=v[12].set(hand.x+side*.08,air>.4||crash>.4?hand.y-1.05:this.ground(hand.x+side*.08,hand.z-.5,height),hand.z-.5);
   const clearance=clamp(hand.y-tip.y,.15,1.17)*(1-tuck*.62)*(1-air*.15);const reach=Math.sqrt(Math.max(.01,1.18**2-clearance**2));tip.z=hand.z-reach*(air>.4?.4:1);tip.y=hand.y-clearance+(s.push?Math.max(0,stroke)*.17:0);this.limb('pole'+side,hand,tip);
  }
  this.edge=turn*.23;
 }
}
