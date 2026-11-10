import {newExplore,advanceExplore,freeSample,relocate,boardLift,leaveLift} from './open-world.js';
import {startWeatherRefresh,fetchLiveWeather,WEATHER_REFRESH_MS} from './live-weather.js';
import {paintNetwork,paintPlayer,mapProjection} from './explore-ui.js';
import {MountainWorld} from './world.js';
import {DisplayMode,ViewportUI} from './display.js';
import {rideFeedback} from './feedback.js';
import {TouchInput} from './touch-input.js';
import {buildPath,newRun,advanceRun,clock,DIFFICULTIES,clamp,loadMountain} from './core.js';
import {makeRecorder,recordRun,makeResult,resultTime,readBest,saveBest,ghostSplit,gamepadControls} from './race.js';
const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,document.getElementById(id));return elements.get(id);};
let data,world,selected,path,run=null,mode='overview',paused=false,activeDifficulty='all',lastTime=0,elapsed=0,toastTimer,gateTimer,audioContext,audioGain,audioFilter,audioSkiGain,audioSkiFilter,audioOn=false,restoreAfterDialog=false,countdown=0,lastCountdown=-1,discipline='explore',best=null,recorder=null,hudDue=0,mapCache=null,padLast={},performanceDue=0;
let display,viewport,touch,nearbyLift=null,exploreMapCache=null;
const touchLayout=()=>viewport?.last?.compact||viewport?.last?.touch;
const held=key=>keys.has(key)||touch?.has(key);
const keys=new Set(),input={left:false,right:false,brake:false,tuck:false};
const km=n=>(n/1000).toFixed(1)+' km';
const safeStorage={get(k){try{return localStorage.getItem(k);}catch{return null;}},set(k,v){try{localStorage.setItem(k,v);return true;}catch{return false;}},remove(k){try{localStorage.removeItem(k);}catch{}}};

const TUTORIAL_STEPS=['Steer with A / D or your left thumb. You are looking down the chosen piste.','Hold W or the push/tuck control to gain speed. S or Space brakes.','Stay on the corduroy for grip, or drop a shoulder into the powder for spray.','Collect the gold stars. In Gate challenge, thread the poles. C cycles cameras, including a goggles view.','Your best time leaves a ghost on the next run. Finish a piste for gold, silver or bronze.'];
let tutorialStep=0,lastCollectHud=0;
function hideTutorial(){const card=$('tutorialCard');if(card)card.hidden=true;}
function showTutorial(){const card=$('tutorialCard');if(!card)return;card.hidden=false;$('tutorialText').textContent=TUTORIAL_STEPS[tutorialStep];$('tutorialNext').textContent=tutorialStep===TUTORIAL_STEPS.length-1?'Got it ↗':'Next ↗';}
function maybeStartTutorial(){if(safeStorage.get('alpine-tutorial-done')||new URLSearchParams(location.search).get('play')==='1'){hideTutorial();return;}tutorialStep=0;showTutorial();}
function advanceTutorial(){tutorialStep++;if(tutorialStep>=TUTORIAL_STEPS.length)skipTutorial();else showTutorial();}
function skipTutorial(){safeStorage.set('alpine-tutorial-done','1');hideTutorial();}
function pistePar(path){const drop=Math.max(40,path.at(0).y-path.at(path.length).y);return drop/12.5;}
function pisteMedal(run,path){const t=resultTime(run),par=pistePar(path);return t<=par*.85?'Gold':t<=par*1.05?'Silver':t<=par*1.35?'Bronze':'';}
function awardMedal(run,path){const el=$('finishMedal');if(!el||!path){if(el)el.hidden=true;return;}const medal=pisteMedal(run,path);if(!medal){el.hidden=true;el.textContent='';return;}const key='alpine-medals';let store={};try{store=JSON.parse(safeStorage.get(key)||'{}')||{};}catch(e){store={};}const id=(selected?.id||path.id||'piste')+'|'+discipline,rank={Gold:3,Silver:2,Bronze:1};if((rank[medal]||0)>=(rank[store[id]]||0)){store[id]=medal;safeStorage.set(key,JSON.stringify(store));}el.hidden=false;el.textContent=(store[id]||medal)+' medal · '+clock(resultTime(run));}
function updateTokenHud(){const el=$('tokenCount');if(!el||!run)return;const n=run.collects||0;el.textContent=String(n);if(n>lastCollectHud){$('gateToast').style.fontSize='18px';$('gateToast').textContent='STAR  '+n; $('gateToast').style.color='#ffe082';$('gateToast').style.opacity=1;clearTimeout(gateTimer);gateTimer=setTimeout(()=>$('gateToast').style.opacity=0,window.__alpineCapture?2000:700);}lastCollectHud=n;}
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3200);}
function selectedText(r){return r.name+(r.sections>1?' · section '+r.section:'');}
function listRoutes(){
  if(!data)return;const sector=$('sector').value,q=$('search').value.toLocaleLowerCase('fr');
  const routes=data.routes.filter(r=>(sector==='all'||r.sector===sector)&&(activeDifficulty==='all'||r.difficulty===activeDifficulty)&&r.name.toLocaleLowerCase('fr').includes(q));
  routes.sort((a,b)=>Number(b.id===selected?.id)-Number(a.id===selected?.id)||Number(b.name==='Luc Alphand')-Number(a.name==='Luc Alphand')||a.name.localeCompare(b.name,'fr'));
  $('routeCount').textContent=routes.length+' sections';$('routeList').replaceChildren();
  for(const r of routes){const button=document.createElement('button');button.className='route-option'+(r.id===selected?.id?' active':'');button.dataset.id=r.id;button.setAttribute('aria-pressed',String(r.id===selected?.id));const dot=document.createElement('span');dot.className='dot '+(DIFFICULTIES[r.difficulty]?.className||'blue');const name=document.createElement('span');name.textContent=selectedText(r);const length=document.createElement('small');length.textContent=km(r.length);button.append(dot,name,length);button.addEventListener('click',()=>selectRoute(r,true));$('routeList').appendChild(button);}
  if(!routes.length){const p=document.createElement('p');p.textContent='No pistes match. Try another filter.';p.style.cssText='font-size:11px;color:#b9cbd2;padding:10px 4px';$('routeList').appendChild(p);}
}
function selectRoute(route,focus=false){
  selected=route;path=buildPath(route,world.height);world.selectRoute(route,path);
  if(focus){const p=path.at(path.length*.5);world.target.set(p.x,p.y,p.z);world.orbit.distance=clamp(path.length*2.2,2200,14000);}
  const grade=DIFFICULTIES[route.difficulty]||DIFFICULTIES.easy;
  $('selectedName').textContent=selectedText(route);$('selectedName').title=selectedText(route);$('selectedGrade').textContent=grade.label.toUpperCase()+' PISTE · '+route.sector.toUpperCase();$('selectedGrade').style.color=grade.color;
  $('selectedLength').textContent=km(path.length);$('selectedDrop').textContent=Math.max(0,Math.round(path.at(0).y-path.at(path.length).y)).toLocaleString('en')+' m';$('selectedTime').textContent=Math.max(1,Math.round(path.length/850))+' min';$('startBtn').disabled=false;
  prepareMap();drawProfile();refreshBest();listRoutes();safeStorage.set('alpine-route',route.id);if(focus)viewport?.selected();
}
function setActiveMode(ride){$('app').dataset.explore=String(ride&&!!run?.openWorld);$('exploreStatus').hidden=$('exploreActions').hidden=!(ride&&run?.openWorld);$('app').className=ride?'riding':'overview';$('mountainMode').classList.toggle('active',!ride);$('rideMode').classList.toggle('active',ride);}
function clearKeys(){keys.clear();touch?.clear();for(const k in input)input[k]=false;}
function startRide(){
  if(!world||!path)return;for(const id of ['finishDialog','pauseDialog'])if($(id).open)$(id).close();
  run=discipline==='explore'?newExplore(world.domain,path.at(0),path.sample(0).heading):newRun(path,discipline);recorder=run.openWorld?null:makeRecorder();exploreMapCache=null;refreshBest();prepareMap();countdown=run.openWorld?0:2.4;lastCountdown=-1;mode='ride';paused=false;clearKeys();world.startRide(discipline,best);setActiveMode(true);hudDue=0;
  $('raceStrip').dataset.discipline=discipline;$('rideName').textContent=selectedText(selected);$('rideSector').textContent=selected.sector.toUpperCase();$('rideGrade').className='dot '+(DIFFICULTIES[selected.difficulty]?.className||'blue');$('gateToast').textContent='';$('gateToast').style.opacity=0;updateHud();
  lastCollectHud=run.collects||0;maybeStartTutorial();
  toast(run.openWorld?'Turn freely. Follow pistes or explore. Map & travel opens the whole mountain.':touchLayout()?'Left thumb to carve · Right thumb to brake or push/tuck.':discipline==='challenge'?'Carve through the gates. Missed gate: +2 seconds. Collect the gold stars.':'Free descent. Hold W to push or tuck; S to brake. Collect the gold stars.');
}
function exitRide(){
  if(!world)return;for(const id of ['pauseDialog','finishDialog'])if($(id).open)$(id).close();mode='overview';paused=false;clearKeys();world.stopRide();setActiveMode(false);hideTutorial();run=null;
}
function pauseRide(reason='Your descent is paused.'){if(mode!=='ride'||!run||run.completed||paused)return;paused=true;clearKeys();$('pauseReason').textContent=typeof reason==='string'?reason:'Your descent is paused.';$('pauseDialog').showModal();}
function resumeRide(){if($('pauseDialog').open)$('pauseDialog').close();paused=false;clearKeys();lastTime=performance.now();}
function toggleCamera(){if(!world)return;world.rideCamera=(world.rideCamera+1)%3;world.snapCamera=true;toast(['Follow camera','First-person camera','Goggles camera'][world.rideCamera]);}
function refreshBest(){
  $('startBtn').querySelector('span').textContent=discipline==='explore'?'Explore mountain':'Start descent';if(discipline==='explore'){best=null;$('bestPreview').textContent='Turn freely · Explore junctions · Ride the lifts';return;}if(!path)return;best=readBest(safeStorage,path,selected.id,discipline);$('bestPreview').textContent=best?'Personal best '+clock(best.result)+(best.samples.length?' · ghost ready':''):discipline==='challenge'?'Clean gates. Build your combo. Beat your time.':'Find your rhythm. Your best run becomes a ghost.';
}
function finish(){
  paused=true;clearKeys();$('finishRun').textContent=selectedText(selected)+' · '+(discipline==='challenge'?'Gate challenge':'Free descent');
  const stats=discipline==='challenge'?[['RESULT',clock(resultTime(run))],['GATE SCORE',run.score.toLocaleString('en')],['GATES',run.gates+' / '+path.gates.length],['BEST COMBO',run.maxCombo+'×'],['RAW TIME',clock(run.time)],['PENALTIES','+'+run.penalty+' s']]:[['TIME',clock(run.time)],['TOP SPEED',Math.round(run.maxSpeed*3.6)+' km/h'],['DISTANCE SKIED',km(run.totalDistance)],['VERTICAL',Math.max(0,Math.round(path.at(0).y-path.at(path.length).y))+' m']];
  if(run.collects)stats.push(['STARS',String(run.collects)]);
  $('finishStats').replaceChildren();for(const [label,value] of stats){const div=document.createElement('div'),strong=document.createElement('strong'),span=document.createElement('span');strong.textContent=value;span.textContent=label;div.append(strong,span);$('finishStats').appendChild(div);}awardMedal(run,path);
  const result=makeResult(run,recorder,selected.id),isBest=!best||result.result<best.result;
  if(isBest){const saved=saveBest(safeStorage,result);$('personalBest').textContent=saved?(result.samples.length?'New personal best. Race your ghost on the next run.':'New personal best saved.'):'Descent finished. Browser storage could not save this run.';if(saved)best=result;}
  else $('personalBest').textContent='Personal best '+clock(best.result)+' · '+(result.result-best.result).toFixed(2)+' s to find.';
  $('finishDialog').showModal();updateHud();
}
function gateEvent(event){
  const hit=event.type==='gate';$('gateToast').style.fontSize='20px';$('gateToast').textContent=hit?(event.quality>.72?'PERFECT LINE':'CLEAN GATE')+'  +'+event.points:'MISSED GATE  +2 s';$('gateToast').style.color=hit?'#e0f6a1':'#f5b6a3';$('gateToast').style.opacity=1;clearTimeout(gateTimer);gateTimer=setTimeout(()=>$('gateToast').style.opacity=0,1300);
  if(path.gates[event.index]?.mesh)path.gates[event.index].mesh.visible=false;
  if(audioOn&&audioContext){const oscillator=audioContext.createOscillator(),gain=audioContext.createGain(),t=audioContext.currentTime;oscillator.type='sine';oscillator.frequency.setValueAtTime(hit?660:190,t);oscillator.frequency.exponentialRampToValueAtTime(hit?990:140,t+.12);gain.gain.setValueAtTime(.025,t);gain.gain.exponentialRampToValueAtTime(.001,t+.18);oscillator.connect(gain).connect(audioContext.destination);oscillator.start(t);oscillator.stop(t+.2);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};}
}
function updateHud(){
  if(!run)return;updateSurfaceBadge();if(run.openWorld){updateExploreHud();return;}const p=path.sample(run.distance,run.offset);$('speed').textContent=Math.round(run.speed*3.6);$('timer').textContent=clock(run.time);$('altitude').textContent=Math.round(p.y).toLocaleString('en');$('vertical').textContent=Math.max(0,Math.round(path.at(0).y-p.y));$('progressFill').style.width=(run.distance/path.length*100)+'%';$('remaining').textContent=km(path.length-run.distance)+' remaining';$('gateCount').textContent=run.gates+' / '+path.gates.length+' gates';$('rideStatus').textContent=paused?'TAKE A BREATHER':input.brake?'BRAKING':countdown>0?'READY TO DROP IN':run.walking?'STEPPING UP THE TRAVERSE':run.speed<2.5?(touchLayout()?'HOLD PUSH / TUCK':'HOLD W / ↑ TO PUSH'):run.softSnow>.15?'SOFT SNOW · CENTER TO GLIDE':input.tuck?'IN THE TUCK':'FIND YOUR FLOW';$('slopeAngle').textContent=Math.round(run.grade);$('skiedDistance').textContent=km(run.totalDistance);
  $('gateCount').textContent=discipline==='challenge'?run.gates+' / '+path.gates.length+' gates':'FREE DESCENT';$('raceScore').textContent=run.score.toLocaleString('en');$('combo').textContent=run.combo+'×';$('penalty').textContent='+'+run.penalty+' s';
  const next=path.gates[run.nextGate];$('nextGate').hidden=discipline!=='challenge'||!next||run.completed;
  if(next)$('nextGate').textContent=(next.offset<0?'← LEFT GATE':'RIGHT GATE →')+' · '+Math.max(0,Math.round(next.distance-run.distance))+' m';
  const split=ghostSplit(best,run.distance),delta=split===null?null:resultTime(run)-split;$('ghostDelta').textContent=delta===null?'SET A BEST':(delta>0?'+':'')+delta.toFixed(2)+' s';$('ghostDelta').dataset.ahead=String(delta!==null&&delta<=0);
  updateTokenHud();
  drawMap();
}
function prepareMap(){
  if(!path)return;const canvas=$('miniMap'),w=canvas.width,h=canvas.height,bg=document.createElement('canvas'),progress=document.createElement('canvas');bg.width=progress.width=w;bg.height=progress.height=h;
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;for(const p of path.points){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);}
  const scale=Math.min((w-60)/(maxX-minX||1),(h-60)/(maxZ-minZ||1)),point=p=>[w/2+(p.x-(minX+maxX)/2)*scale,h/2+(p.z-(minZ+maxZ)/2)*scale],coords=[];
  for(let i=0;i<path.points.length;i+=4)coords.push([...point(path.points[i]),path.distances[i]]);coords.push([...point(path.points.at(-1)),path.length]);
  const ctx=bg.getContext('2d');ctx.strokeStyle='#9db0b81a';ctx.lineWidth=1;for(let i=30;i<w;i+=35){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,h);ctx.stroke();}for(let i=20;i<h;i+=35){ctx.beginPath();ctx.moveTo(0,i);ctx.lineTo(w,i);ctx.stroke();}
  ctx.beginPath();coords.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.strokeStyle='#7397a9';ctx.lineWidth=3;ctx.lineCap='round';ctx.stroke();ctx.fillStyle='#b3c4cd';ctx.font='14px sans-serif';ctx.fillText('N ↑',22,25);
  const paint=progress.getContext('2d');paint.strokeStyle='#deefa4';paint.lineWidth=4;paint.lineCap='round';mapCache={bg,progress,paint,coords,point,index:0};
}
function drawMap(){
  if(run?.openWorld){drawExploreMap();return;}if(!mapCache)return;const {bg,progress,paint,coords,point}=mapCache,canvas=$('miniMap'),ctx=canvas.getContext('2d');
  while(mapCache.index<coords.length-1&&coords[mapCache.index+1][2]<=run.distance){const a=coords[mapCache.index++],b=coords[mapCache.index];paint.beginPath();paint.moveTo(a[0],a[1]);paint.lineTo(b[0],b[1]);paint.stroke();}
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(bg,0,0);ctx.drawImage(progress,0,0);
  if(discipline==='challenge')for(const g of path.gates){const p=point(path.sample(g.distance,g.offset));ctx.beginPath();ctx.arc(...p,g.passed?3:2.5,0,Math.PI*2);ctx.fillStyle=g.passed?(g.hit?'#dcee9e':'#e69282'):'#91afbb';ctx.fill();}
  const p=point(path.sample(run.distance,run.offset));ctx.beginPath();ctx.arc(...p,8,0,Math.PI*2);ctx.fillStyle='#e4f7a22a';ctx.fill();ctx.beginPath();ctx.arc(...p,4,0,Math.PI*2);ctx.fillStyle='#e4f7a2';ctx.fill();
}
function updateSurfaceBadge(){
 const p=run.openWorld?run.position:path.sample(run.distance,run.offset),margin=world.snowSurface.sample(p.x,p.z).margin,type=run.liftRide?'lift':(run.ice>.7&&margin>2)?'ice':margin>2?'piste':margin>-.5?'edge':'powder',badge=$('surfaceBadge');
 if(badge.dataset.surface!==type){badge.dataset.surface=type;badge.textContent={piste:'Groomed piste',ice:'Hardpack / ice',edge:'Soft piste edge',powder:'Off-piste powder',lift:'Riding the lift'}[type];}
}
function updateExploreHud(){
  const p=freeSample(run,world.height),near=run.nearPiste,onPiste=near&&near.distance<near.width;
  $('speed').textContent=Math.round(run.speed*3.6);$('timer').textContent=clock(run.time);$('altitude').textContent=Math.round(p.y).toLocaleString('en');$('vertical').textContent=Math.round(run.vertical);$('slopeAngle').textContent=Math.round(run.grade);$('skiedDistance').textContent=km(run.totalDistance);
  $('rideName').textContent=run.liftRide?run.liftRide.lift.name:onPiste?near.route.name:'Open mountain';$('rideSector').textContent=onPiste?near.route.sector.toUpperCase():'SERRE CHEVALIER';$('rideGrade').className='dot '+(onPiste?DIFFICULTIES[near.route.difficulty]?.className||'blue':'green');
  $('rideStatus').textContent=paused?'TAKE A BREATHER':run.liftRide?'RIDING THE LIFT':run.crashed>0?'CRASH · RECOVERING':run.airborne?((run.grab||'IN THE AIR')+' · '+run.airTime.toFixed(1)+'s'):run.blocked?run.blocked.toUpperCase():run.walking?'STEPPING UPHILL':input.brake?'BRAKING':run.speed<2.5?'PUSH TO GO · JUMP WITH J':run.softSnow>.4?'OFF PISTE · SOFT SNOW':'FIND YOUR OWN LINE';
  $('remaining').textContent=km(run.totalDistance)+' explored';$('gateCount').textContent=run.visited.size+' pistes visited';$('nextGate').hidden=true;
  $('explorePlace').textContent=run.liftRide?'Enjoy the ascent':onPiste?'On piste · '+near.route.name:'Off piste · choose your direction';$('exploreSession').textContent=run.visited.size+' pistes · '+run.sectors.size+' / 4 sectors';
  nearbyLift=null;if(!run.liftRide){let distance=55;for(const lift of world.liftDestinations){const d=Math.hypot(run.position.x-lift.bottom.x,run.position.z-lift.bottom.z);if(d<distance){distance=d;nearbyLift=lift;}}}
  $('liftBtn').hidden=!nearbyLift&&!run.liftRide;$('liftBtn').disabled=!run.liftRide&&run.speed>3;$('liftBtn').textContent=run.liftRide?'Skip to top ↗':run.speed>3?'Slow to board':nearbyLift?'Board '+nearbyLift.name:'Board lift';updateTokenHud();drawExploreMap();
}
function drawExploreMap(){
  const canvas=$('miniMap'),ctx=canvas.getContext('2d'),x=Math.round(run.position.x/160)*160,z=Math.round(run.position.z/160)*160;
  if(!exploreMapCache||exploreMapCache.x!==x||exploreMapCache.z!==z){const bg=document.createElement('canvas');bg.width=canvas.width;bg.height=canvas.height;const bounds=[x-650,z-650,x+650,z+650],point=paintNetwork(bg,data,bounds,null,world.domain.nearby(x,z,6),world.height);exploreMapCache={x,z,bg,point};}
  ctx.drawImage(exploreMapCache.bg,0,0);paintPlayer(ctx,exploreMapCache.point,run);
}
function useLift(){if(!run?.openWorld||paused)return;if(run.liftRide){leaveLift(run);world.fx.reset();world.snapCamera=true;toast('At the top. Choose your next line.');}else if(nearbyLift&&boardLift(run,nearbyLift)){clearKeys();world.fx.reset();world.snapCamera=true;toast('Lift ride started. Skip to top is available.');}updateHud();}
function restartRun(){if(run?.openWorld){relocate(run,path.at(0),path.sample(0).heading);clearKeys();world.fx.reset();world.snapCamera=true;updateHud();toast('Back at your starting piste.');}else startRide();}
function openMountainMap(){if(!run?.openWorld)return;openDialog('worldMapDialog');paintNetwork($('worldMap'),data,world.domain.bounds,run,null,world.height);renderTravelList();}
function renderTravelList(){
 const q=$('travelSearch').value.toLocaleLowerCase('fr'),list=$('travelList');list.replaceChildren();
 const add=(title,subtitle,point,heading)=>{if(!(title+' '+subtitle).toLocaleLowerCase('fr').includes(q))return;const button=document.createElement('button'),name=document.createElement('strong'),detail=document.createElement('small');name.textContent=title;detail.textContent=subtitle;button.append(name,detail);button.onclick=()=>{relocate(run,point,heading);world.fx.reset();world.snapCamera=true;exploreMapCache=null;$('worldMapDialog').close();updateHud();toast('Arrived at '+title);};list.appendChild(button);};
 for(const line of world.life.lines){const p=line.points[0],b=line.points[1];add(selectedText(line.route),'Piste start · '+line.route.sector,p,Math.atan2(b.x-p.x,b.z-p.z));}
 for(const lift of world.liftDestinations)add(lift.name,'Lift base · ride uphill',lift.bottom,0);
 if(!list.children.length){const p=document.createElement('p');p.textContent='No matching piste or lift.';list.appendChild(p);}
}
function drawProfile(){
  const canvas=$('pisteProfile'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,lo=Math.min(...path.points.map(p=>p.y)),hi=Math.max(...path.points.map(p=>p.y));ctx.clearRect(0,0,w,h);
  const y=v=>14+(hi-v)/(hi-lo||1)*(h-30);ctx.beginPath();path.points.forEach((p,i)=>{const x=path.distances[i]/path.length*w;i?ctx.lineTo(x,y(p.y)):ctx.moveTo(x,y(p.y));});ctx.strokeStyle='#dff49f';ctx.lineWidth=1.8;ctx.stroke();ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.closePath();const g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,'#dff49f38');g.addColorStop(1,'#dff49f02');ctx.fillStyle=g;ctx.fill();ctx.fillStyle='#c8d9dc';ctx.font='11px sans-serif';ctx.fillText(Math.round(path.at(0).y)+' m',0,10);ctx.textAlign='right';ctx.fillText(Math.round(path.at(path.length).y)+' m',w,h-5);ctx.textAlign='left';
}
function pollGamepad(){
  let pad;try{pad=[...(navigator.getGamepads?.()||[])].find(p=>p?.connected&&p.mapping==='standard');}catch{}
  const controls=gamepadControls(pad);input.steer=(Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft')))||touch?.steer||controls.steer;input.brake=input.brake||controls.brake;input.tuck=input.tuck||controls.tuck;input.jump=keys.has('j')||keys.has('shift')||!!touch?.has?.('j')||!!controls.jump;
  if(mode==='ride'){
    if(controls.pause&&!padLast.pause){if($('pauseDialog').open)resumeRide();else if(!document.querySelector('dialog[open]'))pauseRide();}
    if(!paused&&!document.querySelector('dialog[open]')){if(controls.camera&&!padLast.camera)toggleCamera();if(controls.restart&&!padLast.restart)restartRun();}
  }
  padLast=controls;
}
function openDialog(id){if(!$(id).open){restoreAfterDialog=mode==='ride'&&!paused;paused=mode==='ride'?true:paused;clearKeys();$(id).showModal();}}
function setupDisplay(){
  viewport=new ViewportUI({window,document,onRotate:()=>{clearKeys();if(mode==='ride'&&!paused)pauseRide('Screen rotated. Settle your grip, then keep skiing.');}});viewport.bindSheet();
  touch=new TouchInput({buttons:document.querySelectorAll('[data-key]'),document,window,enabled:()=>mode==='ride'&&!paused&&!document.querySelector('dialog[open]')});
  display=new DisplayMode({document,screen:window.screen,preference:safeStorage.get('alpine-orientation'),standalone:window.matchMedia('(display-mode: standalone)').matches||!!navigator.standalone,onMessage:toast,onPreference:value=>safeStorage.set('alpine-orientation',value),beforeChange:()=>{clearKeys();if(mode==='ride'&&!paused)pauseRide('Screen controls changed. Keep skiing when you’re ready.');},onChange:state=>{
    document.documentElement.dataset.focus=String(state.focus);document.documentElement.dataset.fullscreen=String(state.fullscreen);
    const active=state.fullscreen||state.focus,label=state.fullscreen?'Exit fullscreen':state.focus?'Exit focus view':state.canFullscreen?'Enter fullscreen':'Enter focus view';
    for(const id of ['fullscreenBtn','fullscreenSettingBtn']){$(id).disabled=state.busy;$(id).setAttribute('aria-pressed',String(active));$(id).setAttribute('aria-label',label);$(id).title=label;}
    $('fullscreenSettingBtn').textContent=state.fullscreen?'Exit fullscreen':state.focus?'Exit focus view':state.canFullscreen?'Fullscreen':'Focus view';
    $('displayStatus').textContent=state.fullscreen?'Native fullscreen':state.standalone?'Home Screen app view':state.focus?'Focus view · browser bar stays visible':'Browser view';
    for(const button of document.querySelectorAll('[data-orientation-choice]')){button.disabled=state.busy;button.setAttribute('aria-pressed',String(button.dataset.orientationChoice===state.preference));}
    $('orientationStatus').textContent=state.preference==='auto'?'Follows your device rotation.':state.locked?`${state.preference==='portrait'?'Portrait':'Landscape'} orientation locked.`:`${state.preference==='portrait'?'Portrait':'Landscape'} preferred. Rotate your device if needed.`;
    $('installHint').hidden=state.canFullscreen||state.standalone;viewport.update();
  }});display.notify();
  $('fullscreenBtn').onclick=() => display.toggle();$('fullscreenSettingBtn').onclick=() => display.toggle();
  for(const button of document.querySelectorAll('[data-orientation-choice]'))button.onclick=()=>display.orient(button.dataset.orientationChoice);
}
function setupEvents(){
  setupDisplay();
  if($('tutorialNext'))$('tutorialNext').onclick=advanceTutorial;if($('tutorialSkip'))$('tutorialSkip').onclick=skipTutorial;$('startBtn').onclick=startRide;$('rideMode').onclick=()=>{if(mode==='overview')startRide();};$('mountainMode').onclick=()=>{if(mode==='ride')exitRide();};$('exitBtn').onclick=exitRide;$('pauseExit').onclick=exitRide;$('finishExit').onclick=exitRide;$('againBtn').onclick=startRide;$('restartBtn').onclick=restartRun;$('cameraBtn').onclick=toggleCamera;$('pauseBtn').onclick=pauseRide;$('resumeBtn').onclick=resumeRide;
  $('pauseDialog').addEventListener('cancel',e=>{e.preventDefault();resumeRide();});$('finishDialog').addEventListener('cancel',e=>{e.preventDefault();exitRide();});
  $('settingsBtn').onclick=()=>openDialog('settingsDialog');$('helpBtn').onclick=()=>openDialog('helpDialog');
  for(const id of ['settingsDialog','helpDialog','worldMapDialog'])$(id).addEventListener('close',()=>{if(restoreAfterDialog){paused=false;lastTime=performance.now();}restoreAfterDialog=false;clearKeys();});
  for(const button of document.querySelectorAll('[data-discipline]'))button.onclick=()=>{discipline=button.dataset.discipline;safeStorage.set('alpine-discipline',discipline);for(const b of document.querySelectorAll('[data-discipline]')){b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));}refreshBest();};
  $('dynamicEnvironment').onchange=()=>{if(world)world.options.dynamic=$('dynamicEnvironment').checked;safeStorage.set('alpine-dynamic',String($('dynamicEnvironment').checked));};$('cameraMotion').onchange=()=>{if(world)world.options.motion=Number($('cameraMotion').value);safeStorage.set('alpine-motion',$('cameraMotion').value);};
  $('showGhost').onchange=()=>{if(world)world.options.ghost=$('showGhost').checked;safeStorage.set('alpine-ghost',String($('showGhost').checked));};$('showPerformance').onchange=()=>{$('performanceMeter').hidden=!$('showPerformance').checked;};
  $('sector').onchange=()=>{listRoutes();world?.focusSector($('sector').value);for(const b of document.querySelectorAll('[data-sector]'))b.setAttribute('aria-pressed',String(b.dataset.sector===$('sector').value));};for(const button of document.querySelectorAll('[data-sector]'))button.onclick=()=>{$('sector').value=button.dataset.sector;$('sector').onchange();};$('search').oninput=listRoutes;
  for(const button of document.querySelectorAll('[data-diff]'))button.onclick=()=>{activeDifficulty=button.dataset.diff;for(const b of document.querySelectorAll('[data-diff]')){b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));}listRoutes();};
  $('resetView').onclick=()=>world?.resetView();
  $('weather').onchange=()=>{const value=$('weather').value;safeStorage.set('alpine-weather',value);if(value==='live'){weatherManual=false;if(lastLiveWeather)applyLiveWeather(lastLiveWeather,false);else refreshLiveWeather();}else{weatherManual=true;world?.setWeather(value);world&&(world.weatherLive=null);$('weatherLabel').textContent=$('weather').selectedOptions[0].textContent;const hint=$('weatherHint');if(hint)hint.textContent='Simulated conditions';}};
  $('quality').onchange=()=>{world?.setQuality($('quality').value);safeStorage.set('alpine-quality',$('quality').value);};
  $('showPistes').onchange=()=>{world.options.pistes=$('showPistes').checked;world.pistes.visible=mode==='overview'&&world.options.pistes;};$('showTrees').onchange=()=>{world.options.trees=$('showTrees').checked;world.trees.visible=world.options.trees;};$('showLifts').onchange=()=>{world.options.lifts=$('showLifts').checked;world.lifts.visible=world.options.lifts;world.sceneryTimer=0;};
  $('worldMapBtn').onclick=openMountainMap;$('liftBtn').onclick=useLift;$('travelSearch').oninput=renderTravelList;$('showCrowds').onchange=()=>{if(world)world.options.crowds=$('showCrowds').checked;safeStorage.set('alpine-crowds',String($('showCrowds').checked));};
  $('soundBtn').onclick=toggleSound;$('soundEnabled').onchange=toggleSound;
  const relevant=['a','d','w','s','arrowleft','arrowright','arrowup','arrowdown',' ','c','r','p','escape','m','e','j','shift'];
  window.addEventListener('keydown',e=>{
    const key=e.key.toLowerCase();if(e.ctrlKey||e.metaKey||e.altKey||(key===' '&&e.target.closest?.('button')))return;if(key==='f'&&!e.repeat&&!['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();display.toggle();return;}if(!relevant.includes(key)||mode!=='ride'||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;
    if(document.querySelector('dialog[open]'))return;e.preventDefault();if(e.repeat&&!['a','d','w','s','arrowleft','arrowright','arrowup','arrowdown',' '].includes(key))return;
    if(key==='m')openMountainMap();else if(key==='e')useLift();else if(key==='c')toggleCamera();else if(key==='r')restartRun();else if(key==='p'||key==='escape')pauseRide();else keys.add(key);
  });window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur',()=>{clearKeys();if(mode==='ride'&&!paused)pauseRide();});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearKeys();if(mode==='ride'&&!paused)pauseRide();}});
}
async function toggleSound(){
  try{if(!audioContext){audioContext=new (window.AudioContext||window.webkitAudioContext)();const count=audioContext.sampleRate*2,buffer=audioContext.createBuffer(1,count,audioContext.sampleRate),samples=buffer.getChannelData(0);for(let i=0;i<count;i++)samples[i]=(Math.random()*2-1)*.5;const noise=audioContext.createBufferSource();noise.buffer=buffer;noise.loop=true;audioFilter=audioContext.createBiquadFilter();audioFilter.type='lowpass';audioFilter.frequency.value=800;audioGain=audioContext.createGain();audioGain.gain.value=0;noise.connect(audioFilter).connect(audioGain).connect(audioContext.destination);audioSkiFilter=audioContext.createBiquadFilter();audioSkiFilter.type='bandpass';audioSkiFilter.Q.value=.75;audioSkiGain=audioContext.createGain();audioSkiGain.gain.value=0;noise.connect(audioSkiFilter).connect(audioSkiGain).connect(audioContext.destination);noise.start();}await audioContext.resume();audioOn=!audioOn;$('soundBtn').setAttribute('aria-label',audioOn?'Mute sound':'Enable sound');$('soundBtn').title=audioOn?'Mute sound':'Enable sound';$('soundBtn').style.color=audioOn?'#dff49f':'';toast(audioOn?'Mountain sound enabled':'Mountain sound muted');}catch{toast('Sound is unavailable in this browser.');}finally{$('soundEnabled').checked=audioOn;}
}
function driveCapture(dt,heldKeys){
  if(!world||!run)return;
  paused=false;if($('pauseDialog')?.open)$('pauseDialog').close();
  if(heldKeys){keys.clear();for(const k of heldKeys)keys.add(k);for(const k of ['left','right','brake','tuck','jump','grab','spin'])input[k]=false;}
  input.left=held('a')||held('arrowleft');input.right=held('d')||held('arrowright');input.tuck=held('w')||held('arrowup');input.brake=held('s')||held('arrowdown')||held(' ');input.jump=keys.has('j')||keys.has('shift');input.steer=(Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft')));input.spin=heldKeys?.includes('spin')?8:0;
  elapsed+=dt;
  if(mode==='ride'&&run&&!paused){
    const events=run.openWorld?advanceExplore(run,input,dt):advanceRun(run,input,dt);
    for(const event of events){if(event==='finish')finish();else if(event==='blocked');else if(event==='lift-exit');else if(event&&event.type==='landing')airEvent(event);else if(event&&event.type==='crash')airEvent(event);else if(event&&event.type==='pop');else if(event)gateEvent(event);}
    hudDue-=dt;if(hudDue<=0){updateHud();hudDue=.1;}
  }
  world.render(run,input,dt,elapsed,dt);
}
function animate(now){
  if(window.__alpineCapture?.lock)return;
  const frameDt=Math.max(0,(now-lastTime)/1000);let dt=frameDt;lastTime=now;
  // Long stalls pause the run; normal low frame rates retain every physics step.
  if(dt>.5){if(mode==='ride'&&!paused)pauseRide();dt=0;}
  if(!paused)elapsed+=dt;
  input.left=held('a')||held('arrowleft');input.right=held('d')||held('arrowright');input.tuck=held('w')||held('arrowup');input.brake=held('s')||held('arrowdown')||held(' ');pollGamepad();
  if(mode==='ride'&&run&&!paused){
    let physicsDt=dt;
    if(countdown>0){physicsDt=Math.max(0,dt-countdown);countdown=Math.max(0,countdown-dt);const digit=Math.ceil(countdown/0.8);if(digit!==lastCountdown){lastCountdown=digit;$('gateToast').style.fontSize=digit?'44px':'20px';$('gateToast').textContent=digit?String(digit):'DROP IN';$('gateToast').style.color='#e0f6a1';$('gateToast').style.opacity=1;if(!digit){clearTimeout(gateTimer);gateTimer=setTimeout(()=>$('gateToast').style.opacity=0,1000);}}}
    const events=run.openWorld?advanceExplore(run,input,physicsDt):advanceRun(run,input,physicsDt);if(!run.openWorld)recordRun(recorder,run);for(const event of events){if(event==='finish')finish();else if(event==='blocked')toast(run.blocked+' · turn away or use Map & travel.');else if(event==='lift-exit'){world.fx.reset();world.snapCamera=true;toast('At the top. Your next line starts here.');}else if(event&&event.type==='landing')airEvent(event);else if(event&&event.type==='crash')airEvent(event);else if(event&&event.type==='pop');else gateEvent(event);}
    hudDue-=dt;if(hudDue<=0){updateHud();hudDue=.1;}
  }
  if(audioContext&&audioGain){const riding=mode==='ride'&&!paused&&countdown===0,f=rideFeedback(run||{speed:0,edgeAngle:0},input,elapsed,0),t=audioContext.currentTime;audioGain.gain.setTargetAtTime(audioOn?(riding?f.windGain:.004):0,t,.15);audioFilter.frequency.setTargetAtTime(260+(run?.speed||0)*50,t,.2);audioSkiGain.gain.setTargetAtTime(audioOn&&riding?f.skiGain:0,t,.06);audioSkiFilter.frequency.setTargetAtTime(f.skiFrequency,t,.09);}
  world.render(run,input,paused?0:dt,elapsed,frameDt);performanceDue-=Math.min(frameDt,1);if(performanceDue<=0){performanceDue=.5;if(!$('performanceMeter').hidden)$('performanceMeter').textContent=paused?'PAUSED':Math.round(1000/(world.frameMS||16.7))+' FPS · '+world.renderer.getPixelRatio().toFixed(2)+'×';}requestAnimationFrame(animate);
}

function airEvent(event){
  const toastEl=$('gateToast');if(!toastEl)return;
  if(event.type==='crash'){toastEl.style.fontSize='22px';toastEl.textContent='CRASH';toastEl.style.color='#f5b6a3';}
  else {const label=event.style==='clean'?'CLEAN LANDING':event.style==='heavy'?'HEAVY LANDING':'SKETCHY LANDING';const grab={mute:'MUTE',stalefish:'STALEFISH',safety:'SAFETY',indy:'INDY'}[event.grab]||'';const spin=Math.abs(event.spin||0),rot=spin>Math.PI*1.65?'360':spin>Math.PI*.7?'180':'';const combo=(run?.combo||0)>1?run.combo+'× COMBO':'';toastEl.style.fontSize='20px';toastEl.textContent=[label,grab,rot,event.airTime.toFixed(1)+'s',combo].filter(Boolean).join(' · ');toastEl.style.color=event.style==='clean'?'#e0f6a1':'#f6e2a1';}
  toastEl.style.opacity=1;clearTimeout(gateTimer);gateTimer=setTimeout(()=>toastEl.style.opacity=0,window.__alpineCapture?2800:1300);
}
let weatherManual=false,lastLiveWeather=null,weatherPoll=null;
function applyLiveWeather(reading,fromCache){
  lastLiveWeather=reading;if(!reading)return;
  if(weatherManual||$('weather')?.value!=='live'||(world&&world.weatherLive===null))return;
  if(world){world.setWeather(reading.preset);world.weatherLive=reading;}
  const label=$('weatherLabel');if(label)label.textContent=reading.label;
  const icon=document.querySelector('.weather-icon');if(icon)icon.textContent=reading.icon;
  const hint=$('weatherHint');
  if(hint){
    const when=reading.fetchedAt?new Date(reading.fetchedAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}):'';
    hint.textContent=reading.source==='live'?('Live · Villeneuve · '+when+' Paris'):reading.source==='cache'?('Offline fallback · last live'+(when?' '+when:'')):'Live weather unavailable';
  }
}
async function refreshLiveWeather(){
  const reading=await fetchLiveWeather({storage:{getItem:k=>safeStorage.get(k),setItem:(k,v)=>safeStorage.set(k,v)}});applyLiveWeather(reading,reading.source!=='live');
}
async function init(){
  setupEvents();const savedDiscipline=safeStorage.get('alpine-discipline');if(['explore','flow','challenge'].includes(savedDiscipline))document.querySelector('[data-discipline="'+savedDiscipline+'"]').click();
  try{
    const values=await Promise.all([fetch('./data/resort.json').then(r=>{if(!r.ok)throw Error('Piste catalogue unavailable');return r.json();}),loadMountain(),fetch('./data/surroundings.json').then(r=>{if(!r.ok)throw Error('Surrounding terrain unavailable');return r.json();})]);data=values[0];
    $('loadText').textContent='Shaping the snow. Finding your line…';await new Promise(resolve=>requestAnimationFrame(resolve));
    world=new MountainWorld($('scene'),data,values[1],values[2]);
    const dynamic=safeStorage.get('alpine-dynamic');$('dynamicEnvironment').checked=dynamic===null?world.options.dynamic:dynamic!=='false';$('dynamicEnvironment').onchange();const motion=safeStorage.get('alpine-motion');$('cameraMotion').value=['0','0.35','1'].includes(motion)?motion:String(world.options.motion);$('cameraMotion').onchange();
    $('showCrowds').checked=safeStorage.get('alpine-crowds')!=='false';$('showCrowds').onchange();
    $('showGhost').checked=safeStorage.get('alpine-ghost')!=='false';$('showGhost').onchange();
    selectRoute(data.routes.find(r=>r.id===safeStorage.get('alpine-route'))||data.routes.find(r=>r.name==='Luc Alphand')||data.routes[0]);
    $('pisteTotal').textContent=data.meta.namedPistes;$('coverageText').textContent=`The official catalogue lists ${data.meta.namedPistes} pistes and ${data.meta.officialLifts} lifts. This build matches all 82 piste names to ${data.routes.length} candidate OSM sections, with ${data.lifts.length} OSM lift features and ${data.buildings.length.toLocaleString('en')} mapped building footprints. Snapshot: 9 November 2026.`;
    const quality=safeStorage.get('alpine-quality');if(quality&&[...$('quality').options].some(o=>o.value===quality)){$('quality').value=quality;$('quality').onchange();}
    $('weather').value='live';weatherManual=false;
    const weatherStorage={getItem:k=>safeStorage.get(k),setItem:(k,v)=>safeStorage.set(k,v)};
    weatherPoll=startWeatherRefresh(reading=>applyLiveWeather(reading,reading.source!=='live'),{storage:weatherStorage,interval:WEATHER_REFRESH_MS});
    const params=new URLSearchParams(location.search),wanted=params.get('piste')||params.get('explore');
    if(wanted){const route=data.routes.find(r=>r.name.toLowerCase()===wanted.toLowerCase()||r.id===wanted);if(route)selectRoute(route);}
    $('loading').classList.add('done');lastTime=performance.now();requestAnimationFrame(animate);
    window.__serre={get world(){return world;},get run(){return run;},get data(){return data;},relocate,startRide,selectRoute,resumeRide,pauseRide,driveCapture};
    if(params.get('play')==='1'||params.get('explore')==='1')startRide();
    world.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();pauseRide();toast('3D graphics paused. Reload the page to restore the mountain.');});
  }catch(error){console.error(error);$('loading').querySelector('h2').textContent='The mountain couldn’t load.';$('loadText').textContent=error.message.includes('WebGL')?'Enable WebGL / hardware acceleration, then reload this page.':error.message;$('loading').querySelector('.loading-line').remove();const retry=document.createElement('button');retry.className='secondary';retry.textContent='Try again';retry.style.width='150px';retry.onclick=()=>location.reload();$('loading').appendChild(retry);}
}
init();
