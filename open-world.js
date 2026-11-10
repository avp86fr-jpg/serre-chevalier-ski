import {clamp,lerp,PHYSICS_STEP} from './core.js';
const key=(x,z,size=128)=>`${Math.floor(x/size)},${Math.floor(z/size)}`;
export const pisteWidth=r=>/chemin|route|liaison|traverse|croix/i.test(r.name)?7:r.difficulty==='novice'?13:18;
export class MountainDomain{
 constructor(data,height,bounds,trees=[]){this.data=data;this.height=height;this.bounds=bounds;this.cells=new Map();this.obstacles=new Map();this.segments=[];
  for(const route of data.routes)for(let i=1;i<route.points.length;i++){const a=route.points[i-1],b=route.points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<.01)continue;const s={a,b,route,length,width:pisteWidth(route)};this.segments.push(s);this.insert(this.cells,s,Math.min(a[0],b[0])-30,Math.min(a[1],b[1])-30,Math.max(a[0],b[0])+30,Math.max(a[1],b[1])+30);}
  (data.buildings||[]).forEach((p,i)=>{const a=data.architecture?.[i];if(a){const o={type:'building',x:p[0],z:p[1],a};this.insert(this.obstacles,o,p[0]-p[2],p[1]-p[3],p[0]+p[2],p[1]+p[3]);}});
  for(const [x,z,,h]of trees){const o={type:'tree',x,z,r:Math.max(.35,h*.015)};this.insert(this.obstacles,o,x-1,z-1,x+1,z+1);}
 }
 insert(map,item,x0,z0,x1,z1){for(let x=Math.floor(x0/128);x<=Math.floor(x1/128);x++)for(let z=Math.floor(z0/128);z<=Math.floor(z1/128);z++){const k=`${x},${z}`;if(!map.has(k))map.set(k,[]);map.get(k).push(item);}}
 nearby(x,z,radius=1){const items=new Set(),ix=Math.floor(x/128),iz=Math.floor(z/128);for(let i=-radius;i<=radius;i++)for(let j=-radius;j<=radius;j++)for(const s of this.cells.get(`${ix+i},${iz+j}`)||[])items.add(s);return items;}
 locate(x,z,radius=0){let best=null;for(const s of radius?this.nearby(x,z,radius):this.cells.get(key(x,z))||[]){const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],t=clamp(((x-s.a[0])*dx+(z-s.a[1])*dz)/(s.length*s.length),0,1),px=s.a[0]+dx*t,pz=s.a[1]+dz*t,d=Math.hypot(x-px,z-pz),bias=t*t*.65;if(!best||d+bias<best.distance+best.bias-1e-9)best={...s,distance:d,bias,t,x:px,z:pz,heading:Math.atan2(dx,dz)};}return best;}
 obstacle(x,z){for(const o of this.obstacles.get(key(x,z))||[]){if(o.type==='tree'){if(Math.hypot(x-o.x,z-o.z)<o.r+.3)return o;continue;}const c=Math.cos(o.a.angle),s=Math.sin(o.a.angle),dx=x-o.x,dz=z-o.z,u=c*dx-s*dz,v=s*dx+c*dz,ring=o.a.ring;let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>v)!==(b[1]>v)&&u<(b[0]-a[0])*(v-a[1])/(b[1]-a[1])+a[0])inside=!inside;}if(inside)return o;}return null;}
}
export function freeSample(run,height){const tx=Math.sin(run.heading),tz=Math.cos(run.heading),p=run.position,a=height(p.x-tx,p.z-tz),b=height(p.x+tx,p.z+tz);return{x:p.x,y:(run.liftRide||run.airborne)?p.y:height(p.x,p.z),z:p.z,tx,tz,heading:run.heading,slope:run.liftRide?0:(a-b)/2,spin:run.spin||0};}
export function safeSpawn(domain,point){const b=domain.bounds,x=clamp(point.x,b[0]+4,b[2]-4),z=clamp(point.z,b[1]+4,b[3]-4);if(!domain.obstacle(x,z))return{x,z};for(let r=4;r<=64;r+=4)for(let i=0;i<16;i++){const px=x+Math.sin(i*Math.PI/8)*r,pz=z+Math.cos(i*Math.PI/8)*r;if(px>b[0]+2&&px<b[2]-2&&pz>b[1]+2&&pz<b[3]-2&&!domain.obstacle(px,pz))return{x:px,z:pz};}return{x,z};}
export function newExplore(domain,spawn,heading=0){spawn=safeSpawn(domain,spawn);const y=domain.height(spawn.x,spawn.z);return{openWorld:true,discipline:'explore',domain,position:{x:spawn.x,y,z:spawn.z},heading,time:0,speed:0,velocity:0,distance:0,totalDistance:0,vertical:0,maxSpeed:0,offset:0,edgeAngle:0,softSnow:0,grade:0,started:false,completed:false,accumulator:0,walking:false,lateral:0,gates:0,combo:0,score:0,penalty:0,nextGate:0,visited:new Set(),sectors:new Set(),liftRide:null,nearPiste:domain.locate(spawn.x,spawn.z),blocked:'',noticeCooldown:0,airborne:false,vy:0,airTime:0,spin:0,grab:'',landing:'',crashed:0,tricks:0,jumpHeld:false};}
export function relocate(run,point,heading=0){point=safeSpawn(run.domain,point);const b=run.domain.bounds;run.position={x:clamp(point.x,b[0]+4,b[2]-4),y:0,z:clamp(point.z,b[1]+4,b[3]-4)};run.position.y=run.domain.height(run.position.x,run.position.z);run.heading=heading;run.velocity=run.speed=run.edgeAngle=run.accumulator=0;run.liftRide=null;run.blocked='';run.nearPiste=run.domain.locate(point.x,point.z);run.grade=0;run.walking=false;run.started=false;run.airborne=false;run.vy=0;run.airTime=0;run.spin=0;run.grab='';run.landing='';run.crashed=0;run.jumpHeld=false;}
export function boardLift(run,lift){if(!run.openWorld||run.liftRide||run.airborne||run.speed>3||Math.hypot(run.position.x-lift.bottom.x,run.position.z-lift.bottom.z)>55)return false;run.liftRide={lift,travel:0};run.velocity=run.speed=0;run.airborne=false;run.vy=0;run.spin=0;run.grab='';return true;}
export function leaveLift(run){if(!run.liftRide)return false;const lift=run.liftRide.lift,accumulator=run.accumulator;relocate(run,lift.exit,lift.exitHeading);run.accumulator=accumulator;return true;}
export function advanceExplore(run,input,dt){if(!Number.isFinite(dt)||dt<=0)return[];run.accumulator+=Math.min(dt,.5);const events=[];while(run.accumulator+1e-10>=PHYSICS_STEP){step(run,input,PHYSICS_STEP,events);run.accumulator-=PHYSICS_STEP;}return events;}
function step(run,input,dt,events){
 const domain=run.domain;run.time+=dt;run.noticeCooldown=Math.max(0,run.noticeCooldown-dt);
 if(run.liftRide){const ride=run.liftRide;ride.travel+=ride.lift.speed*dt;const p=ride.lift.at(Math.min(ride.travel,ride.lift.length)),q=ride.lift.at(Math.min(ride.travel+2,ride.lift.length));run.position={x:p.x,y:p.y-2.4,z:p.z};run.heading=Math.atan2(q.x-p.x,q.z-p.z);run.speed=0;run.edgeAngle=0;run.airborne=false;run.vy=0;run.spin=0;if(ride.travel>=ride.lift.length){leaveLift(run);events.push('lift-exit');}return;}
 if(run.crashed>0){run.crashed=Math.max(0,run.crashed-dt);run.velocity=Math.max(0,run.velocity-18*dt);run.speed=run.velocity;run.vy=0;run.airborne=false;run.grab='';run.position.y=domain.height(run.position.x,run.position.z);run.walking=false;if(run.crashed===0)run.landing=run.landing||'up';return;}
 const steer=clamp(Number.isFinite(input.steer)?input.steer:Number(!!input.right)-Number(!!input.left),-1,1),brake=!!input.brake,tuck=!!input.tuck,jump=!!input.jump;
 const jumpEdge=jump&&!run.jumpHeld;run.jumpHeld=jump;
 if(run.airborne){
  run.spin+=(steer*3.4+(input.spin||0))*dt;run.heading=(run.heading-steer*.35*dt+Math.PI*3)%(Math.PI*2)-Math.PI;
  run.grab=tuck||input.grab? (input.grab|| (steer>0.35?'mute':steer<-0.35?'stalefish':'safety')) :'';
  const tx=Math.sin(run.heading),tz=Math.cos(run.heading),drag=.0011*run.velocity**2;
  run.velocity=Math.max(2.4,run.velocity-drag*dt);run.vy-=9.81*dt;
  const p=run.position,q={x:p.x+tx*run.velocity*dt,z:p.z+tz*run.velocity*dt,y:p.y+run.vy*dt};
  const b=domain.bounds,boundary=q.x<b[0]+2||q.x>b[2]-2||q.z<b[1]+2||q.z>b[3]-2,obstacle=domain.obstacle(q.x,q.z);
  if(boundary||obstacle){run.velocity=run.speed=0;run.vy=0;run.airborne=false;run.crashed=1.8;run.landing='crash';run.blocked=boundary?'Terrain boundary':obstacle.type==='tree'?'Tree ahead':'Building ahead';run.position.y=domain.height(p.x,p.z);events.push({type:'crash',reason:run.blocked});if(run.noticeCooldown===0){events.push('blocked');run.noticeCooldown=2;}return;}
  const ground=domain.height(q.x,q.z);run.airTime+=dt;
  if(q.y<=ground&&run.vy<=0.4){
   const slope=(domain.height(q.x-tx,q.z-tz)-domain.height(q.x+tx,q.z+tz))/2;
   const spinErr=Math.abs(((run.spin+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI);
   const impact=Math.max(0,-run.vy),pitchErr=Math.abs(Math.atan(slope)-Math.atan(-run.vy/Math.max(.2,run.velocity)));
   const ugly=impact>8.2||spinErr>1.15||pitchErr>1.05||run.airTime<.08&&impact>5.5;
   const quality=clamp(1-impact/9-spinErr/2.2-pitchErr/1.6,0,1);
   run.position={x:q.x,y:ground,z:q.z};run.airborne=false;run.vy=0;run.spin=0;run.grab='';run.nearPiste=domain.locate(q.x,q.z);
   if(ugly){run.crashed=1.7;run.velocity=Math.min(run.velocity*.2,3);run.landing='crash';run.combo=0;events.push({type:'crash',quality,impact,airTime:run.airTime});}
   else {run.velocity=Math.max(3,run.velocity*(.86+.1*quality)-impact*.35);run.landing=quality>.72?'clean':quality>.4?'heavy':'sketchy';if(run.airTime>.18){run.tricks++;run.combo++;run.score+=Math.round(40+run.airTime*80+quality*60);}events.push({type:'landing',quality,style:run.landing,airTime:run.airTime,impact});}
   run.speed=run.velocity;run.airTime=0;run.grade=Math.atan(slope)*180/Math.PI;run.started=true;return;
  }
  const actual=Math.hypot(q.x-p.x,q.y-p.y,q.z-p.z);run.position=q;run.speed=actual/dt;run.totalDistance+=actual;run.distance=run.totalDistance;run.vertical+=Math.max(0,p.y-q.y);run.maxSpeed=Math.max(run.maxSpeed,run.speed);run.grade=Math.atan2(-run.vy,run.velocity)*180/Math.PI;run.started=true;return;
 }
 run.edgeAngle=lerp(run.edgeAngle,steer*.48*(.58+.42/(1+run.velocity/26)),1-Math.exp(-(8.2/(1+run.velocity/70))*dt));const carved=Math.abs(run.edgeAngle)>.14&&!brake?1:0,skid=brake||(Math.abs(steer)>.7&&Math.abs(run.edgeAngle)<.22)?1:0;
 run.heading=(run.heading-(run.edgeAngle/.48)*(((carved&&run.velocity>4)?2.45:1.55)/(1+run.velocity*.07))*(brake?1.28:1)*dt+Math.PI*3)%(Math.PI*2)-Math.PI;
 const p=run.position,tx=Math.sin(run.heading),tz=Math.cos(run.heading),slope=(domain.height(p.x-tx,p.z-tz)-domain.height(p.x+tx,p.z+tz))/2,sine=slope/Math.sqrt(1+slope*slope);
 const near=domain.locate(p.x,p.z);run.nearPiste=near;run.softSnow=near?clamp((near.distance/near.width-.65)/.45,0,1):1;if(near&&near.distance<near.width){run.visited.add(near.route.name);run.sectors.add(near.route.sector);}
 const ice=(1-run.softSnow)*(near&&near.distance<near.width*.55?1:0);run.ice=ice;run.surface=run.softSnow>.45?'powder':ice>.7?'ice':'groomed';
 const friction=(.035-ice*.01+run.softSnow*.10+skid*.04-carved*.016)*9.81*Math.sqrt(1-sine*sine),drag=(tuck?.0028:.0055)*run.velocity**2,push=tuck&&!brake&&run.velocity<4?3.2*(1-run.velocity/5):0;
 let acceleration=9.81*sine+push-friction-drag-Math.abs(run.edgeAngle)*1.5-(brake?13:0)-run.softSnow*.0018*run.velocity**2;
 run.walking=tuck&&!brake&&sine<-.15&&run.velocity<1.6;if(run.walking)acceleration=(1.2-run.velocity)*3;
 const velocity=Math.max(0,run.velocity+acceleration*dt),travel=(run.velocity+velocity)*.5*dt;let length=travel/Math.sqrt(1+slope*slope),q;
 for(let i=0;i<3;i++){q={x:p.x+tx*length,z:p.z+tz*length};q.y=domain.height(q.x,q.z);const actual=Math.hypot(q.x-p.x,q.y-p.y,q.z-p.z);if(actual<1e-8)break;length*=travel/actual;}
 const b=domain.bounds,boundary=q.x<b[0]+2||q.x>b[2]-2||q.z<b[1]+2||q.z>b[3]-2,obstacle=domain.obstacle(q.x,q.z);
 if(boundary||obstacle){run.velocity=run.speed=0;run.blocked=boundary?'Terrain boundary':obstacle.type==='tree'?'Tree ahead':'Building ahead';if(run.noticeCooldown===0){events.push('blocked');run.noticeCooldown=2;}return;}
 if(travel>1e-6)run.blocked='';
 const actual=Math.hypot(q.x-p.x,q.y-p.y,q.z-p.z);
 const ahead=domain.height(q.x+tx*1.6,q.z+tz*1.6),tangent=q.y-slope*1.6,lip=tangent-ahead;
 const pop=jumpEdge&&!run.walking&&velocity>3.2;
 if(pop||(velocity>6.8&&lip>0.9)){
  run.position=q;run.velocity=velocity;run.airborne=true;run.airTime=0;run.spin=0;run.landing='';
  run.vy=pop?(2.05+velocity*.055+Math.max(0,lip)*.45):((q.y-p.y)/Math.max(dt,1e-4)+.55+Math.min(2.2,lip*.5));
  run.speed=Math.hypot(velocity,run.vy);run.totalDistance+=actual;run.distance=run.totalDistance;run.vertical+=Math.max(0,p.y-q.y);run.maxSpeed=Math.max(run.maxSpeed,run.speed);run.grade=Math.atan(slope)*180/Math.PI;run.started=true;
  events.push({type:'pop',kicker:lip>0.9,pop});return;
 }
 run.position=q;run.velocity=velocity;run.speed=actual/dt;run.totalDistance+=actual;run.distance=run.totalDistance;run.vertical+=Math.max(0,p.y-q.y);run.maxSpeed=Math.max(run.maxSpeed,run.speed);run.grade=Math.atan(slope)*180/Math.PI;run.started=true;run.airborne=false;run.vy=0;run.airTime=0;
}
