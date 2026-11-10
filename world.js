import {Skier} from './skier.js';
import {MountainDomain,freeSample} from './open-world.js';
import {buildParks,wrapHeight,kickerHeight} from './park.js';
import {MountainLife,liftDestinations} from './mountain-life.js';
import * as THREE from './vendor/three.module.js';
import {heightSampler,mountainSampler,project,clamp,lerp,seededRandom,DIFFICULTIES} from './core.js';
import {TerrainTiles,snowMaterial} from './terrain.js';
import {makeForests,makeVillages,makeCableways,updateScenery,freeze} from './scenery.js';
import {AlpineEnvironment,CLOUD_GLSL} from './environment.js';
import {PisteSurface} from './piste-surface.js';
import {rideFeedback} from './feedback.js';
import {SkiEffects} from './ski-effects.js';
import {ghostAt,AdaptiveQuality} from './race.js';
export class MountainWorld{
  constructor(container,data,mountain,outer){
    this.container=container;this.data=data;this.mountain=mountain;this.height=mountainSampler(mountain);this.outerHeight=heightSampler(outer);this.mode='overview';this.weather='clear';this.options={mobile:!!window.matchMedia?.('(pointer: coarse)').matches,crowds:true,pistes:true,trees:true,lifts:true,ghost:true,dynamic:!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,motion:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?0:.35};this.quality='auto';this.adaptive=new AdaptiveQuality(Math.min(devicePixelRatio,window.matchMedia?.('(pointer: coarse)').matches?1.25:1.5));this.frameMS=16.7;this.sceneryTimer=0;
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(this.adaptive.ratio);this.renderer.setSize(container.clientWidth,container.clientHeight);this.renderer.setClearColor(0x9eb8c8);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.98;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.scene=new THREE.Scene();this.scene.fog=new THREE.FogExp2(0xadc7d6,.000027);
    this.camera=new THREE.PerspectiveCamera(43,container.clientWidth/container.clientHeight,1,150000);
    this.target=new THREE.Vector3(-1300,1750,1700);this.orbit={yaw:.65,pitch:.62,distance:19000};this.cameraTarget=new THREE.Vector3();this.cameraPosition=new THREE.Vector3();
    this.hemi=new THREE.HemisphereLight(0xd1e8ff,0x738394,1.65);this.scene.add(this.hemi);
    this.sun=new THREE.DirectionalLight(0xfff3df,3.2);this.sun.position.set(-12000,17000,-7000);this.scene.add(this.sun);this.scene.add(this.sun.target);
    this.sun.shadow.mapSize.set(2048,2048);this.sun.shadow.camera.left=-95;this.sun.shadow.camera.right=95;this.sun.shadow.camera.top=95;this.sun.shadow.camera.bottom=-95;this.sun.shadow.camera.near=1;this.sun.shadow.camera.far=1000;this.sun.shadow.normalBias=.09;this.sun.shadow.bias=-.00008;
    this.makeSky();this.makeTerrain(outer,true);this.terrain=new TerrainTiles(this.scene,mountain,snowMaterial(this.makeSnowTexture(),this.environment.uniforms));this.makePistes();this.makeTrees();this.makeBuildings();this.makeLifts();this.makeSkier();this.makeSnow();this.makeLabels();this.bindOrbit();this.makeOpenMountain();
    this.selectedGroup=new THREE.Group();this.scene.add(this.selectedGroup);this.gateGroup=new THREE.Group();this.scene.add(this.gateGroup);
    this.rideCamera=0;this.smoothHeading=0;this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.updateOverview(true);
  }
  makeOpenMountain(){const m=this.mountain.manifest;this.groundHeight=this.height;this.parks=buildParks(this.data.routes,this.groundHeight);this.height=wrapHeight(this.groundHeight,this.parks);this.domain=new MountainDomain(this.data,this.height,[...m.origin,...m.extent],this.treeObstacles);this.makeParkFeatures();if(this.fx)this.fx.height=this.height;this.snowSurface=new PisteSurface(this.domain);Object.assign(this.terrain.material.userData.pisteUniforms,this.snowSurface.uniforms);this.terrain.material.needsUpdate=true;this.life=new MountainLife(this);this.liftDestinations=liftDestinations(this);
    this.travelCabin=new THREE.Group();this.travelGondola=new THREE.Group();this.travelChair=new THREE.Group();
    const steel=new THREE.MeshStandardMaterial({color:0x647986,metalness:.6,roughness:.4}),seat=new THREE.MeshStandardMaterial({color:0x243d49,roughness:.55}),red=new THREE.MeshStandardMaterial({color:0xb5382c,roughness:.4});
    const add=(parent,geometry,material,x,y,z)=>{const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);parent.add(mesh);return mesh;};
    add(this.travelGondola,new THREE.BoxGeometry(1.8,.65,1.45),red,0,-.4,0);
    add(this.travelGondola,new THREE.BoxGeometry(1.82,.9,1.43),new THREE.MeshStandardMaterial({color:0x496c7b,metalness:.4,roughness:.18}),0,.35,0);
    add(this.travelGondola,new THREE.BoxGeometry(1.92,.12,1.55),seat,0,.87,0);
    add(this.travelChair,new THREE.BoxGeometry(2,.14,.8),seat,0,-.3,0);
    add(this.travelChair,new THREE.BoxGeometry(2,.65,.1),seat,0,0,-.35);
    for(const side of [-1,1]){add(this.travelChair,new THREE.BoxGeometry(.07,.9,.07),steel,side*.85,.15,-.3);add(this.travelChair,new THREE.BoxGeometry(.09,.35,.1),seat,side*.18,-.48,.24);add(this.travelChair,new THREE.BoxGeometry(.12,.05,1.6),red,side*.18,-.68,.5);}
    add(this.travelChair,new THREE.BoxGeometry(1.9,.06,.06),steel,0,.07,.46);
    add(this.travelChair,new THREE.CapsuleGeometry(.22,.27,3,7),red,0,.13,0);
    add(this.travelChair,new THREE.SphereGeometry(.18,8,6),seat,0,.63,.02);
    for(const parent of [this.travelGondola,this.travelChair])add(parent,new THREE.CylinderGeometry(.04,.04,1.6,5),steel,0,1.6,0);
    this.travelCabin.add(this.travelGondola,this.travelChair);this.travelCabin.visible=false;this.scene.add(this.travelCabin);
  }
  makeSky(){
    this.environment=new AlpineEnvironment(this);
    const material=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{...this.environment.uniforms,topColor:{value:new THREE.Color('#4f87b5')},bottomColor:{value:new THREE.Color('#dce7ed')}},vertexShader:'varying vec3 vPos;void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:`
      ${CLOUD_GLSL}
      uniform vec3 topColor;uniform vec3 bottomColor;varying vec3 vPos;
      void main(){vec3 ray=normalize(vPos);float h=max(ray.y,0.0);vec3 sky=mix(bottomColor,topColor,pow(h,.45));
      float sun=dot(ray,normalize(vec3(-160.,220.,-130.)));
      sky+=vec3(1.,.82,.56)*pow(max(sun,0.),110.)*.28;
      sky+=vec3(2.6,2.3,1.8)*smoothstep(.99995,.99998,sun);
      float cirrus=pow(max(0.,sin(ray.x*39.+sin(ray.z*28.)*1.4)*sin(ray.z*19.+ray.x*7.)),12.);
      sky=mix(sky,vec3(.9,.94,.97),cirrus*.12*smoothstep(.08,.4,h));
      float clouds=cloudMask(ray.xz/max(ray.y,.08)*1.4)*smoothstep(.025,.14,ray.y);
      vec3 cloudLight=mix(vec3(.62,.70,.77),vec3(.98,.97,.94),cloudField(ray.xz/max(ray.y,.08)*1.4+vec2(.16)));
      sky=mix(sky,cloudLight,clouds*.85);gl_FragColor=vec4(sky,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`});
    this.sky=new THREE.Mesh(new THREE.SphereGeometry(90000,40,24),material);this.scene.add(this.sky);
  }
  makeTerrain(data,isOuter){
    const {bounds:[w,s,e,n],size,elevations}=data,origin=project(w,n),end=project(e,s),width=end[0]-origin[0],depth=end[1]-origin[1];
    const geometry=new THREE.PlaneGeometry(width,depth,size-1,size-1);geometry.rotateX(-Math.PI/2);geometry.translate(origin[0]+width/2,0,origin[1]+depth/2);
    const pos=geometry.attributes.position,colors=new Float32Array(size*size*3),c=new THREE.Color();
    for(let j=0;j<size;j++)for(let i=0;i<size;i++){
      const k=j*size+i,h=elevations[k];pos.setY(k,h-(isOuter?7:0));
      const dx=(elevations[j*size+Math.min(size-1,i+1)]-elevations[j*size+Math.max(0,i-1)])/(2*width/(size-1));
      const dz=(elevations[Math.min(size-1,j+1)*size+i]-elevations[Math.max(0,j-1)*size+i])/(2*depth/(size-1));
      const slope=Math.hypot(dx,dz),rock=clamp((slope-.8)*1.6,0,.78);c.setRGB(lerp(.88,.34,rock),lerp(.94,.38,rock),lerp(.99,.43,rock));
      if(h<1550)c.multiplyScalar(.94);colors[k*3]=c.r;colors[k*3+1]=c.g;colors[k*3+2]=c.b;
    }
    if(isOuter){const old=geometry.index.array,keep=[];for(let i=0;i<old.length;i+=3){const a=old[i],b=old[i+1],c=old[i+2],x=(pos.getX(a)+pos.getX(b)+pos.getX(c))/3,z=(pos.getZ(a)+pos.getZ(b)+pos.getZ(c))/3;if(!(x>-9728&&x<9728&&z>-7680&&z<8192))keep.push(a,b,c);}geometry.setIndex(keep);}
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));geometry.computeVertexNormals();
    const texture=this.makeSnowTexture();texture.repeat.set(width/70,depth/70);
    const material=snowMaterial(texture,this.environment?.uniforms);
    const mesh=new THREE.Mesh(geometry,material);mesh.receiveShadow=true;mesh.name=isOuter?'surrounding-terrain':'resort-terrain';this.scene.add(mesh);
  }
  makeSnowTexture(){
    const rand=seededRandom(91),array=new Uint8Array(128*128*4);
    for(let i=0;i<128*128;i++){const n=Math.floor(175+rand()*80);array[i*4]=array[i*4+1]=array[i*4+2]=n;array[i*4+3]=255;}
    const texture=new THREE.DataTexture(array,128,128);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;
  }
  surfaceLine(points,heightOffset=3,step=25){
    const result=[];for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/step));for(let j=0;j<n;j++){const x=lerp(a[0],b[0],j/n),z=lerp(a[1],b[1],j/n);result.push(new THREE.Vector3(x,this.height(x,z)+heightOffset,z));}}const p=points.at(-1);result.push(new THREE.Vector3(p[0],this.height(...p)+heightOffset,p[1]));return result;
  }
  makePistes(){
    this.pistes=new THREE.Group();this.pistes.name='Official piste network';this.scene.add(this.pistes);this.pisteGrid=new Map();this.pisteRouteCount=this.data.routes.length;const positions=[],colors=[];
    for(const r of this.data.routes){const color=new THREE.Color(DIFFICULTIES[r.difficulty]?.color||'#c2ddec'),points=this.surfaceLine(r.points,0,22);
      for(let i=0;i<points.length;i++){const p=points[i],key=(Math.floor(p.x/50)+256)*1024+Math.floor(p.z/50)+256;if(!this.pisteGrid.has(key))this.pisteGrid.set(key,[]);this.pisteGrid.get(key).push(p);if(i){for(const q of [points[i-1],p]){positions.push(q.x,q.y+6,q.z);colors.push(color.r,color.g,color.b);}}}
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));this.pistes.add(freeze(new THREE.LineSegments(g,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.7,depthWrite:false}))));
  }
  nearPiste(x,z,radius=34){const ix=Math.floor(x/50),iz=Math.floor(z/50);for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const list=this.pisteGrid.get((ix+a+256)*1024+iz+b+256);if(list)for(const p of list)if((p.x-x)**2+(p.z-z)**2<radius*radius)return true;}return false;}
  makeTrees(){makeForests(this);}
  makeBuildings(){makeVillages(this);}
  makeLifts(){makeCableways(this);}
  updateScenery(dt,time=0){updateScenery(this,dt,time);}
  makeSkier(){
    this.character=new Skier();this.skier=this.character.root;this.scene.add(this.skier);
    const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=64;const ctx=shadowCanvas.getContext('2d'),g=ctx.createRadialGradient(32,32,2,32,32,32);g.addColorStop(0,'rgba(20,40,65,.4)');g.addColorStop(1,'rgba(20,40,65,0)');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);
    this.blob=new THREE.Mesh(new THREE.PlaneGeometry(3,4),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false}));this.blob.rotation.x=-Math.PI/2;this.blob.visible=false;this.scene.add(this.blob);
    this.fx=new SkiEffects(this.scene,this.height);this.spray=this.fx.spray;
    this.ghostCharacter=new Skier({ghost:true});this.ghost=this.ghostCharacter.root;this.scene.add(this.ghost);
  }
  makeSnow(){
    const rand=seededRandom(12),p=new Float32Array(1400*3);for(let i=0;i<p.length;i+=3){p[i]=(rand()-.5)*130;p[i+1]=rand()*90;p[i+2]=(rand()-.5)*130;}
    const mapData=new Uint8Array(32*32*4);for(let y=0;y<32;y++)for(let x=0;x<32;x++){const i=(y*32+x)*4,r=Math.hypot(x-15.5,y-15.5)/15.5;mapData[i]=mapData[i+1]=mapData[i+2]=255;mapData[i+3]=Math.max(0,1-r*r)*255;}
    const map=new THREE.DataTexture(mapData,32,32);map.needsUpdate=true;const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(p,3));this.snowTime={value:0};
    const material=new THREE.PointsMaterial({color:0xffffff,size:.14,map,transparent:true,opacity:.8,depthWrite:false});material.onBeforeCompile=shader=>{shader.uniforms.snowTime=this.snowTime;shader.vertexShader='uniform float snowTime;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.y=mod(position.y-snowTime*3.,90.);transformed.x=mod(position.x+snowTime*1.6+sin(snowTime*.7+position.y)*2.+65.,130.)-65.;');};material.customProgramCacheKey=()=> 'alpine-snowfall-v3';
    this.snow=new THREE.Points(geo,material);this.snow.visible=false;this.snow.frustumCulled=false;this.scene.add(this.snow);
  }
  makeLabels(){
    const root=document.getElementById('labels');this.labels=this.data.villages.map(v=>{const el=document.createElement('div');el.className='map-label';const dot=document.createElement('i'),name=document.createElement('span'),alt=document.createElement('small');name.textContent=v.name.toUpperCase();alt.textContent=v.alt.toLocaleString('en')+' m';el.append(dot,name,alt);root.appendChild(el);return{el,p:new THREE.Vector3(v.position[0],this.height(...v.position)+170,v.position[1])};});
  }
  bindOrbit(){
    const canvas=this.renderer.domElement;let active=false,lastX=0,lastY=0,pointers=new Map(),lastPinch=0;
    canvas.addEventListener('pointerdown',e=>{if(this.mode!=='overview')return;active=true;lastX=e.clientX;lastY=e.clientY;pointers.set(e.pointerId,[e.clientX,e.clientY]);canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{if(!active||this.mode!=='overview')return;pointers.set(e.pointerId,[e.clientX,e.clientY]);if(pointers.size===2){const [a,b]=[...pointers.values()],dist=Math.hypot(a[0]-b[0],a[1]-b[1]);if(lastPinch)this.orbit.distance=clamp(this.orbit.distance*lastPinch/dist,1800,38000);lastPinch=dist;}else{this.orbit.yaw-=(e.clientX-lastX)*.004;this.orbit.pitch=clamp(this.orbit.pitch+(e.clientY-lastY)*.003,.15,1.35);}lastX=e.clientX;lastY=e.clientY;});
    const stop=e=>{pointers.delete(e.pointerId);active=pointers.size>0;lastPinch=0;};canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);canvas.style.touchAction='none';
    canvas.addEventListener('wheel',e=>{if(this.mode!=='overview')return;e.preventDefault();this.orbit.distance=clamp(this.orbit.distance*Math.exp(e.deltaY*.001),1800,38000);},{passive:false});
  }
  focusSector(name){const v=this.data.villages.find(v=>v.name===name);if(!v){this.resetView();return;}this.target.set(v.position[0],this.height(...v.position)+450,v.position[1]);this.orbit.distance=6200;this.orbit.pitch=.7;}
  resetView(){this.target.set(-1300,1750,1700);this.orbit={yaw:.65,pitch:.62,distance:19000};}
  selectRoute(route,path){
    this.route=route;this.path=path;this.clearGroup(this.selectedGroup);this.clearGroup(this.gateGroup);
    const points=path.points.map(p=>new THREE.Vector3(p.x,p.y+8,p.z));
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0xe4f79f,depthTest:false,transparent:true,opacity:1}));line.renderOrder=3;this.selectedGroup.add(line);
    this.ribbonGroup=new THREE.Group();this.ribbonGroup.name='Terrain-integrated piste';this.selectedGroup.add(this.ribbonGroup);
    this.routeLine=line;
    for(const end of [0,path.length]){const p=path.at(end);const marker=new THREE.Mesh(new THREE.SphereGeometry(28,12,8),new THREE.MeshBasicMaterial({color:end===0?0xe3f59e:0xffffff,depthTest:false}));marker.position.set(p.x,p.y+40,p.z);this.selectedGroup.add(marker);}
    const poleMat=new THREE.MeshStandardMaterial({color:0x368bba});
    path.gates.forEach((gate,i)=>{const p=path.sample(gate.distance,gate.offset),group=new THREE.Group(),material=new THREE.MeshStandardMaterial({color:i%2?0xe96f59:0x3175ac});
      for(const side of [-1,1]){const x=p.x+p.tz*side*gate.halfWidth,z=p.z-p.tx*side*gate.halfWidth,y=this.height(x,z),pole=new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,3,6),material);pole.position.set(x,y+1.5,z);pole.castShadow=true;group.add(pole);const flag=new THREE.Mesh(new THREE.PlaneGeometry(1.7,.7,8,2),new THREE.MeshStandardMaterial({color:i%2?0xec856d:0x5498ca,side:THREE.DoubleSide}));flag.position.set(x+p.tz*.75*side,y+2.45,z-p.tx*.75*side);flag.rotation.y=Math.atan2(p.tx,p.tz);if(this.environment){const uniforms=this.environment.uniforms;flag.material.onBeforeCompile=shader=>{Object.assign(shader.uniforms,uniforms);shader.uniforms.flagSide={value:side};shader.vertexShader='uniform float flagSide;uniform float envTime;uniform float windPower;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.z+=sin(position.x*4.+envTime*3.)*pow(clamp(flagSide>0.?uv.x:1.-uv.x,0.,1.),2.)*windPower*.24;');};flag.material.customProgramCacheKey=()=> 'alpine-flag-v6';}group.add(flag);}
      gate.mesh=group;this.gateGroup.add(group);
    });
    const f=path.sample(path.length),finishWidth=Math.min(22,path.halfWidth*1.5),banner=new THREE.Mesh(new THREE.PlaneGeometry(finishWidth,2),new THREE.MeshBasicMaterial({map:this.finishTexture(),side:THREE.DoubleSide}));banner.position.set(f.x,f.y+5,f.z);banner.rotation.y=Math.atan2(f.tx,f.tz);this.gateGroup.add(banner);
    for(const side of [-1,1]){const p=path.sample(path.length,side*finishWidth/2),pole=new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,7,6),poleMat);pole.position.set(p.x,p.y+3.5,p.z);this.gateGroup.add(pole);}
    this.gateGroup.visible=false;this.gateGroup.userData.markers=[...this.gateGroup.children].filter(o=>!path.gates.some(g=>g.mesh===o));
  }
  finishTexture(){const c=document.createElement('canvas');c.width=512;c.height=80;const ctx=c.getContext('2d');ctx.fillStyle='#19343d';ctx.fillRect(0,0,512,80);ctx.fillStyle='#dff5a2';ctx.font='bold 32px sans-serif';ctx.textAlign='center';ctx.fillText('F I N I S H',256,53);for(let i=0;i<4;i++)for(let j=0;j<4;j++){ctx.fillStyle=(i+j)%2?'#ffffff':'#19343d';ctx.fillRect(i*20,j*20,20,20);ctx.fillRect(432+i*20,j*20,20,20);}return new THREE.CanvasTexture(c);}
  clearGroup(group){const geometries=new Set(),materials=new Set();group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});for(const g of geometries)g.dispose();const textures=new Set();for(const m of materials){for(const key of ['map','bumpMap','normalMap','roughnessMap'])if(m[key])textures.add(m[key]);m.dispose();}for(const texture of textures)texture.dispose();group.clear();}
  makeParkFeatures(){
    this.parkGroup=new THREE.Group();this.parkGroup.name='Serre Chevalier park kickers';this.scene.add(this.parkGroup);
    if(!this.parks?.length)return;
    const snow=new THREE.MeshStandardMaterial({color:0xf3fbff,roughness:.58,metalness:.04}),lip=new THREE.MeshStandardMaterial({color:0xd9e7ee,roughness:.42}),steel=new THREE.MeshStandardMaterial({color:0x6a7c86,metalness:.55,roughness:.35}),flag=new THREE.MeshStandardMaterial({color:0xe35a32,roughness:.5});
    const rows=10,cols=8;
    for(const k of this.parks){
      const positions=[],indices=[];
      for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){
        const u=(i/cols)*(k.length+1.1)-.3,v=(j/rows-.5)*k.width;
        const x=k.x+k.tx*u-k.tz*v,z=k.z+k.tz*u+k.tx*v,y=this.groundHeight(x,z)+kickerHeight(k,x,z)+.03;
        positions.push(x,y,z);
        if(i&&j){const a=j*(cols+1)+i,b=a-1,c=a-(cols+1),d=c-1;indices.push(d,b,c,b,a,c);}
      }
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();
      const mesh=new THREE.Mesh(g,snow);mesh.castShadow=mesh.receiveShadow=true;mesh.name=k.site;this.parkGroup.add(mesh);
      const cap=new THREE.Mesh(new THREE.BoxGeometry(k.width*.9,.18,1.1),lip);
      cap.position.set(k.x+k.tx*(k.length-.4),this.groundHeight(k.x+k.tx*(k.length-.4),k.z+k.tz*(k.length-.4))+k.height+.16,k.z+k.tz*(k.length-.4));
      cap.lookAt(cap.position.x+k.tx,cap.position.y,cap.position.z+k.tz);cap.castShadow=true;this.parkGroup.add(cap);
      for(const side of [-1,1]){
        const px=k.x-k.tz*(k.width*.55)*side,pz=k.z+k.tx*(k.width*.55)*side,py=this.groundHeight(px,pz);
        const pole=new THREE.Mesh(new THREE.CylinderGeometry(.06,.05,2.6,6),steel);pole.position.set(px,py+1.3,pz);this.parkGroup.add(pole);
        const board=new THREE.Mesh(new THREE.BoxGeometry(.08,.36,.7),flag);board.position.set(px,py+2.35,pz);board.lookAt(px+k.tx,py+2.35,pz+k.tz);this.parkGroup.add(board);
      }
    }
  }
  startRide(discipline='challenge',ghost=null){this.character.initialized=this.ghostCharacter.initialized=false;this.character.state.clock=this.ghostCharacter.state.clock=0;this.discipline=discipline;this.ghostRecord=ghost;this.selectedGroup.visible=discipline!=='explore';this.sceneryTimer=0;this.mode='ride';this.skier.visible=true;this.blob.visible=true;this.gateGroup.visible=discipline!=='explore';this.pistes.visible=false;this.routeLine.visible=false;this.selectedGroup.children.slice(2).forEach(m=>m.visible=false);this.sun.castShadow=true;this.fx.reset();this.ghost.visible=false;this.snapCamera=true;this.path.gates.forEach(g=>{g.passed=g.hit=false;g.mesh.visible=discipline==='challenge';});this.terrain.timer=0;this.setWeather(this.weather);}
  stopRide(){this.mode='overview';this.selectedGroup.visible=true;if(this.travelCabin)this.travelCabin.visible=false;this.sceneryTimer=0;this.ghost.visible=false;this.skier.visible=this.blob.visible=this.gateGroup.visible=false;this.pistes.visible=this.options.pistes;this.routeLine.visible=true;this.selectedGroup.children.slice(2).forEach(m=>m.visible=true);this.sun.castShadow=false;this.spray.visible=false;this.sun.position.set(-12000,17000,-7000);this.sun.target.position.set(0,0,0);this.fx.reset();this.setWeather(this.weather);this.updateOverview(true);}
  setWeather(value){this.weather=['clear','golden','snow','overcast'].includes(value)?value:'clear';}
  setQuality(q){this.quality=q;this.character?.setQuality(q==='low');this.adaptive?.reset();this.sceneryTimer=0;this.terrain.quality=q;this.terrain.timer=0;const ratio=Math.min(devicePixelRatio,q==='auto'?this.adaptive.maxRatio:q==='high'?2:q==='low'?1:1.5);this.renderer.setPixelRatio(ratio);if(this.adaptive)this.adaptive.ratio=ratio;this.sun.shadow.mapSize.set(q==='high'?4096:2048,q==='high'?4096:2048);if(this.sun.shadow.map){this.sun.shadow.map.dispose();this.sun.shadow.map=null;}this.renderer.shadowMap.enabled=q!=='low';}
  updateOverview(snap=false,dt=1/60){const {yaw,pitch,distance}=this.orbit;this.cameraPosition.set(this.target.x+Math.sin(yaw)*Math.cos(pitch)*distance,this.target.y+Math.sin(pitch)*distance,this.target.z-Math.cos(yaw)*Math.cos(pitch)*distance);this.camera.position.lerp(this.cameraPosition,snap?1:1-Math.exp(-dt*4.3));this.camera.lookAt(this.target);this.camera.fov=43;this.camera.near=3;this.camera.updateProjectionMatrix();}
  updateRide(run,input,dt,time){
    const feedback=rideFeedback(run,input,time,this.options.motion??.35);
    const p=run.openWorld?freeSample(run,this.height):this.path.sample(run.distance,run.offset),travel=run.heading??p.heading,heading=travel+((run.airborne&&run.spin)?run.spin:0);
    this.rideVectors??=Array.from({length:4},()=>new THREE.Vector3());
    const forward=this.rideVectors[0].set(Math.sin(heading),-Math.tan(run.started?run.grade*Math.PI/180:Math.atan(p.slope)),Math.cos(heading)).normalize(),position=this.rideVectors[1].set(p.x,p.y+.10,p.z);
    this.skier.position.copy(position);this.skier.lookAt(this.rideVectors[3].copy(position).add(forward));if(!run.liftRide)this.character.update(run,input,dt,time,run.airborne||run.crashed>0?null:this.height,this.options.motion??.35);p.skiContacts=this.character.worldContacts;
    this.blob.position.set(p.x,p.y+.07,p.z);this.blob.rotation.set(-Math.PI/2,0,-heading);this.blob.visible=!run.liftRide&&!run.airborne;
    const air=run.airborne?Math.min(1,(run.airTime||0)/.55):0;
    const behind=this.rideCamera?0:8.8+air*3.4,above=this.rideCamera?(run.liftRide?1.7:clamp(this.character.bones.head.matrixWorld.elements[13]-position.y+.03,.9,1.8)):2.9+air*1.7;
    const routeForward=this.rideVectors[2].set(Math.sin(travel),-p.slope,Math.cos(travel)).normalize();
    this.cameraPosition.copy(position).addScaledVector(routeForward,-behind);this.cameraPosition.y=Math.max(this.cameraPosition.y+above,this.height(this.cameraPosition.x,this.cameraPosition.z)+(this.rideCamera?.9:1.9));this.cameraPosition.y+=feedback.bob;
    const ahead=run.openWorld?{x:p.x+Math.sin(travel)*(this.rideCamera?20:12),z:p.z+Math.cos(travel)*(this.rideCamera?20:12),y:run.liftRide||run.airborne?p.y:this.height(p.x+Math.sin(travel)*(this.rideCamera?20:12),p.z+Math.cos(travel)*(this.rideCamera?20:12))}:this.path.sample(Math.min(this.path.length,run.distance+(this.rideCamera?30:18)),run.offset*.7);
    this.cameraTarget.set(ahead.x,ahead.y+(this.rideCamera?1.3:1.7),ahead.z);
    this.camera.position.lerp(this.cameraPosition,this.snapCamera?1:1-Math.exp(-dt*8));
    // Protect the camera during a convex roll or a tight bend.
    this.camera.position.y=Math.max(this.camera.position.y,this.height(this.camera.position.x,this.camera.position.z)+.8);
    if(this.snapCamera)this.smoothedLook=this.cameraTarget.clone();this.smoothedLook.lerp(this.cameraTarget,1-Math.exp(-dt*10));this.camera.lookAt(this.smoothedLook);this.camera.rotateZ(feedback.roll);
    const fov=(this.rideCamera?74:57)+Math.min(3,run.speed*.1);this.camera.fov=this.snapCamera?fov:lerp(this.camera.fov,fov,1-Math.exp(-dt*3));this.camera.near=.08;this.camera.updateProjectionMatrix();this.snapCamera=false;this.skier.visible=this.rideCamera===0&&!run.liftRide;if(this.travelCabin){this.travelCabin.visible=!!run.liftRide&&this.rideCamera===0;this.travelCabin.position.copy(position);this.travelCabin.rotation.y=run.heading;this.travelGondola.visible=!!run.liftRide?.lift.gondola;this.travelChair.visible=!run.liftRide?.lift.gondola;}this.blob.visible=!run.liftRide&&!run.airborne;
    this.sun.position.set(p.x-160,p.y+220,p.z-130);this.sun.target.position.copy(position);this.sun.target.updateMatrixWorld();
    this.fx.update(p,run,input,run.liftRide?0:dt,time,(this.container?.clientHeight||900)*(this.renderer.getPixelRatio?.()||1));
    if(this.snow.visible){this.snow.position.set(p.x,p.y-10,p.z);this.snowTime.value=time;}
    const ghost=this.options.ghost?ghostAt(this.ghostRecord,run.time):null;this.ghost.visible=false;
    if(ghost){const q=this.path.sample(ghost.distance,ghost.offset),gap=Math.hypot(q.x-p.x,q.y-p.y,q.z-p.z);if(gap>2.5&&gap<220){this.ghost.visible=true;this.ghost.position.set(q.x,q.y+.10,q.z);this.ghost.lookAt(q.x+q.tx,q.y+.1-q.slope,q.z+q.tz);const next=ghostAt(this.ghostRecord,run.time+.1)||ghost,speed=Math.max(0,(next.distance-ghost.distance)/.1);this.ghostCharacter.update({...ghost,speed,walking:false},{tuck:speed>10},dt,time,this.height,0);}}
  }

  render(run,input,dt,time,frameDt=dt){if(this.mode==='overview'){this.updateOverview(false,dt);const w=this.container.clientWidth,h=this.container.clientHeight;for(const l of this.labels){const p=l.p.clone().project(this.camera);l.el.style.transform=`translate(${(p.x*.5+.5)*w}px,${(-p.y*.5+.5)*h}px) translate(-50%,-50%)`;l.el.style.display=p.z<1&&p.x>-1&&p.x<1&&p.y>-1&&p.y<1?'flex':'none';}}else if(run)this.updateRide(run,input,dt,time);this.terrain.update(this.camera,this.mode==='ride',dt,this.container.clientHeight*this.renderer.getPixelRatio());this.updateScenery(dt,time);this.life?.update(dt);this.environment?.update(dt);if(frameDt>0&&frameDt<=1.5)this.frameMS=lerp(this.frameMS??16.7,frameDt*1000,1-Math.exp(-frameDt*2));if(this.quality==='auto'&&this.adaptive){const ratio=this.adaptive.update(frameDt);if(ratio!==null)this.renderer.setPixelRatio(ratio);}this.renderer.render(this.scene,this.camera);}
  resize(){const w=this.container.clientWidth,h=this.container.clientHeight;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);}
}
