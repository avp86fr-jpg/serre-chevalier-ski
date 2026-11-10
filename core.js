export const DIFFICULTIES={novice:{label:'Green',color:'#83caa2',className:'green'},easy:{label:'Blue',color:'#7cb9eb',className:'blue'},intermediate:{label:'Red',color:'#ee847b',className:'red'},advanced:{label:'Black',color:'#c6d0d8',className:'black'}};
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const lerp=(a,b,t)=>a+(b-a)*t;
export const project=(lon,lat)=>[(lon-6.56)*78800,(44.95-lat)*111200];
export function heightSampler(data){
  const {bounds:[w,s,e,n],size,elevations:z}=data;
  return (x,y)=>{
    const lon=x/78800+6.56,lat=44.95-y/111200;
    const u=clamp((lon-w)/(e-w)*(size-1),0,size-1.000001),v=clamp((n-lat)/(n-s)*(size-1),0,size-1.000001);
    const i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j;
    return lerp(lerp(z[j*size+i],z[j*size+i+1],a),lerp(z[(j+1)*size+i],z[(j+1)*size+i+1],a),b);
  };
}
// Matches the NW-SW-NE / SW-SE-NE triangles actually rendered by the terrain.
export function rasterHeight(values,width,height,u,v,scale=.1){
  u=clamp(u,0,width-1.0000001);v=clamp(v,0,height-1.0000001);
  const i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j,k=j*width+i;
  return (a+b<=1?values[k]*(1-a-b)+values[k+1]*a+values[k+width]*b:values[k+width+1]*(a+b-1)+values[k+1]*(1-b)+values[k+width]*(1-a))*scale;
}
export function mountainSampler(mountain){
  const m=mountain.manifest,cols=Math.round((m.extent[0]-m.origin[0])/m.tileSize),rows=Math.round((m.extent[1]-m.origin[1])/m.tileSize),table=new Array(cols*rows);
  for(const tile of mountain.tiles.values())table[tile.iz*cols+tile.ix]=tile.values;
  return (x,z)=>{
    const u=x-m.origin[0],v=z-m.origin[1],ix=Math.floor(u/m.tileSize),iz=Math.floor(v/m.tileSize),tile=ix>=0&&ix<cols&&iz>=0&&iz<rows?table[iz*cols+ix]:null;
    if(tile)return rasterHeight(tile,m.tileSamples,m.tileSamples,(u-ix*m.tileSize)/m.detailStep,(v-iz*m.tileSize)/m.detailStep,m.scale);
    return rasterHeight(mountain.regional,m.width,m.height,u/m.step,v/m.step,m.scale);
  };
}
export async function loadMountain(progress=()=>{}){
  const base='./data/mountain/',manifest=await fetch(base+'manifest.json').then(r=>{if(!r.ok)throw Error('Terrain manifest unavailable');return r.json();});
  const [regional,detail,forest]=await Promise.all(['regional.bin','detail.bin','forest.json'].map(async file=>{const r=await fetch(base+file);if(!r.ok)throw Error('Terrain download failed: '+file);return file.endsWith('.json')?r.json():r.arrayBuffer();}));
  const tiles=new Map();for(const t of manifest.tiles)tiles.set(`${t.ix},${t.iz}`,{...t,values:new Uint16Array(detail,t.byteOffset,manifest.tileSamples**2)});
  progress();return {manifest,regional:new Uint16Array(regional),tiles,forest:forest.trees};
}
export function buildPath(route,height){
  // Small, bounded smoothing takes the kink out of OSM vertices without bridging sections.
  let raw=[];
  for(let i=0;i<route.points.length;i++){
    const b=route.points[i];if(!i){raw.push({x:b[0],z:b[1]});continue;}
    const a=route.points[i-1],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.01)continue;
    const steps=Math.ceil(len/2);for(let j=1;j<=steps;j++)raw.push({x:lerp(a[0],b[0],j/steps),z:lerp(a[1],b[1],j/steps)});
  }
  if(raw.length<2)throw Error('This section has no usable piste geometry.');
  for(let pass=0;pass<2;pass++)raw=raw.map((p,i)=>!i||i===raw.length-1?p:{x:(raw[i-1].x+2*p.x+raw[i+1].x)/4,z:(raw[i-1].z+2*p.z+raw[i+1].z)/4});
  const points=raw.map(p=>({...p,y:height(p.x,p.z)})),distances=[0];let length=0;
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];length+=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);distances.push(length);}
  const halfWidth=/chemin|route|liaison|traverse|croix/i.test(route.name)?7:route.difficulty==='novice'?13:18;
  function at(d){
    d=clamp(d,0,length);let low=0,high=distances.length-1;
    while(high-low>1){const m=(low+high)>>1;if(distances[m]>d)high=m;else low=m;}
    const a=points[low],b=points[high],t=(d-distances[low])/(distances[high]-distances[low]||1);
    return {x:lerp(a.x,b.x,t),y:lerp(a.y,b.y,t),z:lerp(a.z,b.z,t)};
  }
  function sample(d,offset=0){
    const p=at(d),a=at(d-5),b=at(d+5),dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)||1;
    const tx=dx/len,tz=dz/len,x=p.x-tz*offset,z=p.z+tx*offset;
    return {x,z,y:height(x,z),tx,tz,slope:(a.y-b.y)/len,heading:Math.atan2(tx,tz)};
  }
  const gateSpacing=clamp(length/12,65,140),gates=[];
  for(let d=Math.min(gateSpacing,length*.5);d<length-15;d+=gateSpacing)gates.push({distance:d,offset:(gates.length%2?1:-1)*halfWidth*.46,halfWidth:Math.max(1.6,halfWidth*.25),passed:false,hit:false});
  function curvature(d){
    const a=at(d-10),b=at(d),c=at(d+10),ab=Math.hypot(b.x-a.x,b.z-a.z),bc=Math.hypot(c.x-b.x,c.z-b.z),ac=Math.hypot(c.x-a.x,c.z-a.z);
    return 2*Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x))/(ab*bc*ac||1);
  }
  return {points,distances,length,at,sample,curvature,gates,halfWidth};
}
export const PHYSICS_STEP=1/120;
export function newRun(path,discipline='challenge'){
  for(const g of path.gates){g.passed=false;g.hit=false;g.quality=0;g.time=0;}
  return {discipline,score:0,penalty:0,combo:0,maxCombo:0,nextGate:0,distance:0,totalDistance:0,speed:0,velocity:0,offset:0,lateral:0,edgeAngle:0,time:0,maxSpeed:0,gates:0,completed:false,started:false,path,accumulator:0,grade:0,airborne:false,vy:0,airY:0,airTime:0,spin:0,grab:'',crashed:0,jumpHeld:false,landing:''};
}
const delta=(a,b)=>({x:b.x-a.x,y:b.y-a.y,z:b.z-a.z});
const magnitude=p=>Math.hypot(p.x,p.y,p.z);
function stepRun(run,input,dt){
  const path=run.path,steer=Number.isFinite(input.steer)?clamp(input.steer,-1,1):Number(!!input.right)-Number(!!input.left),brake=!!input.brake,tuck=!!input.tuck,jump=!!input.jump;
  const limit=path.halfWidth-1,edge=clamp((Math.abs(run.offset)-limit+3)/3,0,1);
  const requested=steer*.48*(steer*run.offset>0?1-edge:1)*(.58+.42/(1+run.velocity/26));
  run.edgeAngle=lerp(run.edgeAngle,requested,1-Math.exp(-(8.2/(1+run.velocity/70))*dt));
  let dd=Math.cos(run.edgeAngle),doo=Math.sin(run.edgeAngle);
  if(doo*run.offset>0)doo*=1-edge;
  const p=path.sample(run.distance,run.offset);
  const probe=path.sample(Math.min(path.length,run.distance+dd*.25),clamp(run.offset+doo*.25,-limit,limit));
  const motion=delta(p,probe),metric=magnitude(motion)/.25||1;
  dd/=metric;doo/=metric;
  const sine=clamp(-motion.y/(magnitude(motion)||1),-1,1),cosine=Math.sqrt(1-sine*sine);
  // m/s, metres and seconds throughout. Tucking changes drag, never distance scaling.
  run.softSnow=clamp((Math.abs(run.offset)/path.halfWidth-.67)/.26,0,1);
  const ice=(1-run.softSnow)*clamp(1-edge,0,1);
  run.ice=ice;run.surface=run.softSnow>.45?'powder':ice>.7?'ice':'groomed';
  const gravity=9.81*sine,friction=(.035-ice*.01+edge*.09+run.softSnow*.08)*9.81*cosine;
  const drag=(tuck&&run.velocity>4?.0028:.0055)*run.velocity**2;
  const carved=Math.abs(run.edgeAngle)>.14&&!brake?1:0,skid=brake||(Math.abs(steer)>.7&&Math.abs(run.edgeAngle)<.22)?1:0;
  const edging=(skid?Math.abs(run.edgeAngle)*2.35:Math.abs(run.edgeAngle)*(.42+ice*.2))+run.softSnow*.0018*run.velocity**2+(skid&&!brake?run.velocity*.04:0);
  const push=tuck&&!brake&&run.velocity<4?3.2*(1-run.velocity/5):0;
  const curvature=Math.max(path.curvature(run.distance),path.curvature(run.distance+run.velocity*.8));
  const bendSpeed=Math.sqrt(5/Math.max(.00001,curvature));
  const cornerBrake=clamp((run.velocity-bendSpeed)*2,0,10);
  let acceleration=gravity+push-friction-drag-edging-cornerBrake-(brake?12:0)+(carved?.35:0);
  // Holding push can herringbone up a short uphill traverse at walking speed.
  // This is deliberate player locomotion; release W and gravity takes over.
  run.walking=tuck&&!brake&&sine<-.15&&run.velocity<1.6;
  if(run.walking)acceleration=(1.2-run.velocity)*3;
  const oldVelocity=run.velocity,nextVelocity=Math.max(0,oldVelocity+acceleration*dt);
  const travel=(oldVelocity+nextVelocity)*.5*dt;
  let factor=travel,nextD=run.distance,nextO=run.offset,q=p;
  // Account for cross-slope elevation and curve radius at the skier's offset.
  for(let i=0;i<3&&travel>0;i++){
    nextD=Math.min(path.length,run.distance+dd*factor);nextO=clamp(run.offset+doo*factor,-limit,limit);
    q=path.sample(nextD,nextO);const actual=magnitude(delta(p,q));
    if(nextD>=path.length||actual<1e-9)break;
    factor*=travel/actual;
  }
  const actual=magnitude(delta(p,q)),previous=run.distance,previousOffset=run.offset,previousTime=run.time;
  let usedDt=dt;
  if(nextD>=path.length&&actual<travel&&travel>0){const endSpeed=Math.sqrt(Math.max(0,oldVelocity**2+2*acceleration*actual));usedDt=Math.min(dt,2*actual/(oldVelocity+endSpeed||1));}
  run.distance=nextD;run.offset=nextO;run.velocity=Math.max(0,oldVelocity+acceleration*usedDt);run.speed=actual/(usedDt||dt);run.lateral=doo*nextVelocity;
  run.totalDistance+=actual;run.time+=usedDt;run.maxSpeed=Math.max(run.maxSpeed,run.speed);run.grade=Math.asin(sine)*180/Math.PI;if(actual>1e-6)run.heading=Math.atan2(q.x-p.x,q.z-p.z);run.started=true;
  const jumpEdge=jump&&!run.jumpHeld;run.jumpHeld=jump;
  if(run.airborne){
    run.vy-=9.81*usedDt;run.airY+=run.vy*usedDt;run.airTime+=usedDt;run.grab=tuck||input.grab?'safety':'';
    if(run.airY<=0&&run.vy<=0.4){const impact=Math.max(0,-run.vy);run.airborne=false;run.airY=0;run.vy=0;run.grab='';run.landing=impact>7.2?'crash':impact>3.8?'heavy':'clean';if(run.landing==='crash'){run.crashed=1.8;run.velocity*=.22;run.combo=0;}else if(run.landing==='heavy'){run.velocity*=.82;run.crashed=.15;}run.airTime=0;}
  }else if(jumpEdge&&!run.walking&&run.velocity>3.2&&run.discipline!=='challenge'){
    run.airborne=true;run.airY=.02;run.vy=2.05+run.velocity*.055;run.airTime=0;run.landing='';
  }else{run.airY=0;run.vy=0;run.airborne=false;}
  if(run.crashed>0)run.crashed=Math.max(0,run.crashed-usedDt);
  const events=[];
  while(run.nextGate<path.gates.length&&run.distance>=path.gates[run.nextGate].distance){
    const index=run.nextGate++,gate=path.gates[index],fraction=clamp((gate.distance-previous)/(run.distance-previous||1),0,1),offset=lerp(previousOffset,run.offset,fraction);
    gate.passed=true;gate.time=previousTime+usedDt*fraction;gate.quality=clamp(1-Math.abs(offset-gate.offset)/gate.halfWidth,0,1);gate.hit=gate.quality>0;
    if(run.discipline==='challenge'){
      if(gate.hit){run.gates++;run.combo++;run.maxCombo=Math.max(run.maxCombo,run.combo);const points=Math.round((55+45*gate.quality)*(1+.25*Math.min(run.combo-1,8)));run.score+=points;events.push({type:'gate',index,points,quality:gate.quality,combo:run.combo});}
      else {run.combo=0;run.penalty+=2;events.push({type:'miss',index,penalty:2});}
    }
  }
  if(run.distance>=path.length-1e-6){run.distance=path.length;run.completed=true;events.push('finish');}
  return events;
}
export function advanceRun(run,input,dt){
  if(run.completed||!Number.isFinite(dt)||dt<=0)return[];
  // The caller pauses for stalls >0.5 s. No elapsed time is discarded at ordinary frame rates.
  run.accumulator+=dt;const events=[];
  while(run.accumulator+1e-10>=PHYSICS_STEP&&!run.completed){events.push(...stepRun(run,input,PHYSICS_STEP));run.accumulator-=PHYSICS_STEP;}
  return events;
}
export function clock(seconds,decimal=true){const m=Math.floor(seconds/60),s=Math.floor(seconds%60);return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}${decimal?'.'+Math.floor(seconds%1*10):''}`;}
export function seededRandom(seed=1794){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
