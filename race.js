import {clamp,lerp} from './core.js';
export const RACE_VERSION=4;
export const resultTime=run=>run.time+(run.discipline==='challenge'?run.penalty:0);
export const resultKey=(routeId,discipline)=>`alpine-best-v4:${routeId}:${discipline}`;
export function readBest(storage,path,routeId,discipline){
  try{const value=JSON.parse(storage.get(resultKey(routeId,discipline)));return validResult(value,path,routeId,discipline)?value:null;}catch{return null;}
}
export function saveBest(storage,result){
  const key=resultKey(result.routeId,result.discipline);
  if(!storage.set(key,JSON.stringify(result)))return false;
  let keys=[];try{keys=JSON.parse(storage.get('alpine-ghost-index'))||[];}catch{}
  if(!Array.isArray(keys))keys=[];keys=[key,...keys.filter(k=>typeof k==='string'&&k.startsWith('alpine-best-v4:')&&k!==key)];
  for(const old of keys.slice(8))storage.remove(old);storage.set('alpine-ghost-index',JSON.stringify(keys.slice(0,8)));return true;
}
export function gamepadControls(pad){
  if(!pad||pad.mapping!=='standard')return {steer:0,tuck:false,brake:false,pause:false,camera:false,restart:false,jump:false};
  const x=Number.isFinite(pad.axes?.[0])?pad.axes[0]:0,axis=Math.abs(x)<.14?0:Math.sign(x)*clamp((Math.abs(x)-.14)/.86,0,1),button=i=>!!pad.buttons?.[i]?.pressed;
  return {steer:axis,tuck:button(0)||button(7),brake:button(6)||button(1),pause:button(9),camera:button(2),restart:button(3),jump:button(4)||button(5)};
}
export function makeRecorder(){return {samples:[[0,0,0,0,0]],next:.1,previous:[0,0,0,0,0],full:false};}
export function recordRun(recorder,run,final=false){
  const now=[run.time,run.distance,run.offset,run.edgeAngle,run.penalty];
  if(now[0]<recorder.previous[0])return;
  while(recorder.next<=now[0]+1e-8&&!recorder.full){
    const a=recorder.previous,t=clamp((recorder.next-a[0])/(now[0]-a[0]),0,1);
    recorder.samples.push([+recorder.next.toFixed(3),+lerp(a[1],now[1],t).toFixed(2),+lerp(a[2],now[2],t).toFixed(3),+lerp(a[3],now[3],t).toFixed(3),t<1?a[4]:now[4]]);
    recorder.next+=.1;if(recorder.samples.length>=18000)recorder.full=true;
  }
  if(final&&!recorder.full&&now[0]>recorder.samples.at(-1)[0]+.001)recorder.samples.push(now);
  recorder.previous=now;
}
export function makeResult(run,recorder,routeId){
  recordRun(recorder,run,true);
  return {version:RACE_VERSION,routeId,discipline:run.discipline,length:run.path.length,time:run.time,penalty:run.penalty,result:resultTime(run),score:run.score,gates:run.gates,maxCombo:run.maxCombo,missedGates:run.discipline==='challenge'?run.path.gates.filter(g=>g.passed&&!g.hit).map(g=>g.distance):[],samples:recorder.full?[]:recorder.samples};
}
export function validResult(value,path,routeId,discipline){
  if(!value||value.version!==RACE_VERSION||value.routeId!==routeId||value.discipline!==discipline||Math.abs(value.length-path.length)>.5||!Number.isFinite(value.result)||value.result<=0||!Number.isFinite(value.time)||value.time<=0)return false;
  if(!Number.isFinite(value.penalty)||value.penalty<0||Math.abs(value.result-value.time-(discipline==='challenge'?value.penalty:0))>.001||!Array.isArray(value.missedGates)||value.missedGates.length>path.gates.length||!value.missedGates.every(d=>Number.isFinite(d)&&d>=0&&d<=path.length)||value.missedGates.length*2!==value.penalty)return false;
  if(!Array.isArray(value.samples)||value.samples.length>18001)return false;
  let time=-1,distance=-1;
  for(const p of value.samples){if(!Array.isArray(p)||p.length!==5||!p.every(Number.isFinite)||p[0]<=time||p[0]<0||p[0]>value.time+.001||p[1]<0||p[1]<distance||p[1]>path.length+.01||Math.abs(p[2])>path.halfWidth||p[4]<0)return false;time=p[0];distance=p[1];}
  return !value.samples.length||(Math.abs(distance-path.length)<.05&&Math.abs(time-value.time)<.002);
}
function segment(samples,value,index){
  let a=0,b=samples.length-1;
  while(b-a>1){const m=(a+b)>>1;if(samples[m][index]>value)b=m;else a=m;}
  return [samples[a],samples[b]];
}
export function ghostAt(record,time){
  if(!record?.samples?.length||time<0||time>record.time)return null;
  const [a,b]=segment(record.samples,time,0),t=clamp((time-a[0])/(b[0]-a[0]||1),0,1);
  return {distance:lerp(a[1],b[1],t),offset:lerp(a[2],b[2],t),edgeAngle:lerp(a[3],b[3],t)};
}
export function ghostSplit(record,distance){
  if(!record?.samples?.length)return null;
  if(distance>=record.length)return record.result;
  const [a,b]=segment(record.samples,distance,1),t=clamp((distance-a[1])/(b[1]-a[1]||1),0,1);
  return lerp(a[0],b[0],t)+(record.missedGates?.filter(d=>d<=distance).length||0)*2;
}
// Slow resolution changes avoid oscillation. Physics never depends on this controller.
export class AdaptiveQuality{
  constructor(maxRatio=1.5){this.maxRatio=maxRatio;this.ratio=maxRatio;this.reset();}
  reset(){this.time=0;this.frames=0;this.slowWindows=0;this.fastWindows=0;this.warmup=3;}
  update(dt){
    if(dt<=0||dt>1.5)return null;
    if(this.warmup>0){this.warmup-=dt;return null;}
    this.time+=dt;this.frames++;if(this.time<2)return null;
    const ms=this.time/this.frames*1000;this.time=0;this.frames=0;
    this.slowWindows=ms>22?this.slowWindows+1:0;this.fastWindows=ms<16.2?this.fastWindows+1:0;
    const old=this.ratio;
    if(this.slowWindows>=2){this.ratio=Math.max(.75,this.ratio-.15);this.slowWindows=0;}
    if(this.fastWindows>=4){this.ratio=Math.min(this.maxRatio,this.ratio+.1);this.fastWindows=0;}
    this.ratio=+this.ratio.toFixed(2);return old!==this.ratio?this.ratio:null;
  }
}
