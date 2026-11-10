import * as THREE from './vendor/three.module.js';
import {clamp,mountainSampler} from './core.js';
import {CLOUD_GLSL} from './environment.js';
import {gridBuffers,normalBorder,terrainErrors,terrainStride} from './grid.js';
import {emptyPisteUniforms,PISTE_GLSL} from './piste-surface.js';

export function snowMaterial(texture,environment){
  const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.86});
  // The field is attached before the first render and shared across every LOD.
  material.userData.pisteUniforms=emptyPisteUniforms();
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,environment||{envTime:{value:0},cloudCover:{value:0},surfaceDetail:{value:1},hazeStart:{value:14000},hazeEnd:{value:90000},sunDir:{value:{x:-.5,y:.7,z:-.4}}},material.userData.pisteUniforms);
    shader.vertexShader='varying vec3 vGround; varying vec3 vGroundNormal;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvGround=(modelMatrix*vec4(position,1.0)).xyz;vGroundNormal=normalize(mat3(modelMatrix)*normal);');
    shader.fragmentShader=CLOUD_GLSL+PISTE_GLSL+`varying vec3 vGround; varying vec3 vGroundNormal;
      uniform float hazeStart;uniform float hazeEnd;uniform vec3 sunDir;
      float groundHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float groundNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(groundHash(i),groundHash(i+vec2(1,0)),f.x),mix(groundHash(i+vec2(0,1)),groundHash(i+vec2(1,1)),f.x),f.y);}
    `+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec4 piste=pisteAt(vGround.xz);
      float boundaryAA=clamp(fwidth(piste.x)*.8,.42,6.);
      float groomed=smoothstep(-boundaryAA,boundaryAA,piste.x);
      float viewDistance=length(vViewPosition);
      float closeSnow=1.-smoothstep(16.,130.,viewDistance);
      float midDetail=1.-smoothstep(220.,1600.,viewDistance);
      float farSoft=smoothstep(1400.,7500.,viewDistance);
      vec3 nGround=normalize(vGroundNormal);
      float slope=1.-abs(nGround.y);
      float slopeAA=max(fwidth(slope)*2.8,mix(.035,.1,farSoft));
      float rock=smoothstep(.40-slopeAA,.62+slopeAA,slope)*(1.-groomed*.98);
      float wind=groundNoise(vec2(vGround.x*.32+vGround.z*.13,vGround.z*.055))*midDetail;
      float drift=mix(.62,groundNoise(vGround.xz*.026)*.55+groundNoise(vGround.xz*.16)*.3+wind*.15,midDetail);
      float outcrop=smoothstep(.52,.84,groundNoise(vGround.xz*.007)+slope*.65)*midDetail*(1.-groomed*.98);
      rock=max(rock,outcrop*.5);
      float strata=mix(.55,.5+.5*sin(vGround.y*.52+groundNoise(vGround.xz*.11)*4.),midDetail);
      float fissure=pow(1.-abs(sin(vGround.y*.21+groundNoise(vGround.xy*.055)*6.)),10.)*midDetail;
      float lanes=snowWave(piste.y,5.4);
      float cord=snowWave(piste.y,.065)*closeSnow;
      float grain=groundNoise(vGround.xz*2.7)*midDetail;
      vec3 powder=mix(vec3(.96,.975,.995),mix(vec3(.62,.74,.86),vec3(.97,.99,1.),drift),midDetail);
      powder*=mix(1.,.96+.04*wind,midDetail);
      vec3 groomedSnow=vec3(.99,.995,1.)*(.92+.08*lanes*midDetail+.10*cord);
      groomedSnow*=1.-smoothstep(.88,.99,abs(snowWave(piste.y,5.4)))*.08*midDetail;
      float shoulder=exp(-pow((piste.x+.20)/max(.75,boundaryAA),2.));
      float bank=exp(-pow((piste.x+1.35)/max(.65,boundaryAA),2.));
      vec3 snow=mix(powder,groomedSnow,groomed);
      snow*=1.-shoulder*.22*mix(.35,1.,midDetail);snow+=vec3(.045,.05,.055)*bank*mix(.3,1.,midDetail);
      vec3 stone=mix(vec3(.32,.32,.33),vec3(.50,.48,.45),strata);
      stone=mix(stone,vec3(.34,.32,.29),groundNoise(vGround.xz*.04)*midDetail);
      stone*=1.-fissure*.45;
      vec3 ground=mix(snow,stone,rock*.96);
      float forest=(1.-groomed)*(1.-rock)*smoothstep(2080.,1960.,vGround.y)*smoothstep(1180.,1380.,vGround.y)*(1.-smoothstep(.20,.38,slope));
      float cover=groundNoise(vGround.xz*.0016);
      cover=mix(smoothstep(.20,.52,cover*.65+.38),smoothstep(.16,.62,cover*.8+groundNoise(vGround.xz*.006)*.22),1.-farSoft);
      forest*=cover;
      vec3 canopy=mix(vec3(.11,.19,.12),vec3(.16,.24,.14),cover);
      ground=mix(ground,canopy,forest*mix(.84,.68,midDetail));
      diffuseColor.rgb*=ground;
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      roughnessFactor=mix(.91,.69+lanes*.045,groomed);roughnessFactor=mix(roughnessFactor,.88,rock);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      if(surfaceDetail>.5){
      float nearDetail=1.-smoothstep(20.,110.,viewDistance);
      vec3 projection=abs(normalize(vGroundNormal));projection/=max(.001,projection.x+projection.y+projection.z);
      float powderHeight=groundNoise(vGround.xz*.42)*.14+wind*.12+grain*.012;
      float packedHeight=cord*.012+lanes*.01;
      float stoneHeight=(groundNoise(vGround.zy*1.5)*projection.x+groundNoise(vGround.xy*1.5)*projection.z)*.10;
      float snowHeight=mix(powderHeight,packedHeight,groomed)+bank*.055;
      float microHeight=mix(snowHeight,stoneHeight,rock)*nearDetail;
      vec3 surfaceX=dFdx(-vViewPosition),surfaceY=dFdy(-vViewPosition);
      vec3 crossX=cross(surfaceY,normal),crossY=cross(normal,surfaceX);float surfaceDet=dot(surfaceX,crossX);
      normal=normalize(abs(surfaceDet)*normal-sign(surfaceDet)*(dFdx(microHeight)*crossX+dFdy(microHeight)*crossY));}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
      float facing=pow(1.-clamp(dot(normal,geometryViewDir),0.,1.),2.2);
      float ao=mix(mix(.9,1.,pow(max(.0,nGround.y),.85)),mix(.7,1.,pow(max(.0,normal.y),.55))*(1.-rock*.18),midDetail);
      reflectedLight.indirectDiffuse*=ao;
      vec3 lightDir=normalize(sunDir);
      float sunLit=mix(pow(max(0.,dot(nGround,lightDir)),1.05),pow(max(0.,dot(normal,lightDir)),.7),midDetail);
      float shade=1.-cloudMask(vGround.xz*.00035)*mix(.1,.38,midDetail);
      vec3 sunSnow=vec3(1.,.99,.97);
      vec3 blueShadow=mix(vec3(.66,.75,.84),vec3(.38,.55,.74),midDetail);
      float dark=mix(.74,.42,midDetail);
      float bright=mix(1.05,1.18,midDetail);
      reflectedLight.directDiffuse*=shade*mix(dark,bright,sunLit);
      reflectedLight.directSpecular*=shade*mix(.35,1.15,sunLit)*mix(.25,1.,midDetail);
      reflectedLight.indirectDiffuse=mix(reflectedLight.indirectDiffuse*blueShadow,reflectedLight.indirectDiffuse*sunSnow,sunLit);
      reflectedLight.indirectDiffuse+=diffuseColor.rgb*vec3(.04,.08,.14)*facing*(1.-rock)*(1.-sunLit)*midDetail;
      float spark=pow(groundHash(floor(vGround.xz*28.)+floor(vGround.xz.yx*9.)),6.2);
      spark*=pow(max(0.,dot(normal,geometryViewDir)),1.15)*closeSnow*(1.-rock)*sunLit;
      float glint=pow(max(0.,dot(reflect(-lightDir,normal),geometryViewDir)),36.)*closeSnow*(1.-rock);
      reflectedLight.directSpecular+=vec3(1.,.98,.93)*(spark*(.7+groomed*1.1)+glint*(.35+.8*groomed));
      float haze=smoothstep(hazeStart,max(hazeEnd,hazeStart+1.),viewDistance);
      vec3 air=vec3(.70,.80,.90);
      reflectedLight.directDiffuse=mix(reflectedLight.directDiffuse,air*.55,haze*.55);
      reflectedLight.indirectDiffuse=mix(reflectedLight.indirectDiffuse,air*.7,haze*.5);
      reflectedLight.directSpecular*=1.-haze*.6;`);
  };
  material.customProgramCacheKey=()=> 'alpine-snow-v16';
  // Legacy callers supply a grain map; the world-space shader supersedes it.
  texture?.dispose();return material;
}

export function geometryFromBuffers(buffers){
  const g=new THREE.BufferGeometry();for(const name of ['position','normal','uv'])g.setAttribute(name,new THREE.BufferAttribute(buffers[name],name==='uv'?2:3));g.setIndex(new THREE.BufferAttribute(buffers.index,1));g.computeBoundingSphere();return g;
}
export function terrainGeometry(...args){return geometryFromBuffers(gridBuffers(...args));}

export class TerrainTiles{
  constructor(scene,mountain,material){
    this.data=mountain;this.material=material;this.quality='balanced';this.timer=0;this.queue=[];this.pending=new Set();this.worker=null;this.tick=0;const m=mountain.manifest;this.height=mountainSampler(mountain);this.frustum=new THREE.Frustum();this.viewProjection=new THREE.Matrix4();
    const omit=(x,z)=>mountain.tiles.has(`${Math.floor((x-m.origin[0])/512)},${Math.floor((z-m.origin[1])/512)}`);
    // Split the regional surface so Three can reject mountains outside the view.
    this.base=new THREE.Group();this.base.name='IGN regional terrain';scene.add(this.base);
    for(let z=0;z<m.height-1;z+=64)for(let x=0;x<m.width-1;x+=64){
      const nx=Math.min(65,m.width-x),nz=Math.min(65,m.height-z),values=new Uint16Array(nx*nz);
      for(let j=0;j<nz;j++)values.set(mountain.regional.subarray((z+j)*m.width+x,(z+j)*m.width+x+nx),j*nx);
      const wx0=m.origin[0]+x*m.step,wz0=m.origin[1]+z*m.step;
      const geo=terrainGeometry(values,nx,nz,m.step,wx0,wz0,m.scale,1,omit,normalBorder(this.height,nx,nz,m.step,wx0,wz0));
      if(!geo.index.count){geo.dispose();continue;}
      // Regional vertices meeting detail tiles use the same 4 m gradient.
      const positions=geo.attributes.position,normals=geo.attributes.normal;
      for(let i=0;i<positions.count;i++){const wx=positions.getX(i),wz=positions.getZ(i);if((wx-m.origin[0])%512!==0&&(wz-m.origin[1])%512!==0)continue;if(!omit(wx-4,wz)&&!omit(wx+4,wz)&&!omit(wx,wz-4)&&!omit(wx,wz+4))continue;const dx=(this.height(wx+4,wz)-this.height(wx-4,wz))/8,dz=(this.height(wx,wz+4)-this.height(wx,wz-4))/8,length=Math.hypot(dx,1,dz);normals.setXYZ(i,-dx/length,1/length,-dz/length);}
      const mesh=new THREE.Mesh(geo,material);mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;mesh.matrixWorldAutoUpdate=false;this.base.add(mesh);
    }
    this.tiles=[];this.byKey=new Map();
    for(const tile of mountain.tiles.values()){
      const x=m.origin[0]+tile.ix*512,z=m.origin[1]+tile.iz*512,key=`${tile.ix},${tile.iz}`;
      const border=normalBorder(this.height,129,129,4,x,z),metrics=tile.lod||terrainErrors(tile.values,129,129),geometry=terrainGeometry(tile.values,129,129,4,x,z,.1,8,null,border),mesh=new THREE.Mesh(geometry,material);
      mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;mesh.matrixWorldAutoUpdate=false;mesh.name=`IGN LiDAR ${key}`;scene.add(mesh);
      const t={key,tile,x,z,mesh,border,...metrics,box:new THREE.Box3(new THREE.Vector3(x,metrics.minHeight,z),new THREE.Vector3(x+512,metrics.maxHeight,z+512)),stride:8,wanted:8,distance:Infinity,lastUsed:0,cache:new Map([[8,geometry]])};this.tiles.push(t);this.byKey.set(key,t);
    }
    if(typeof Worker!=='undefined')try{
      this.worker=new Worker(new URL('./terrain-worker.js',import.meta.url),{type:'module'});
      this.worker.onmessage=({data})=>{
        this.pending.delete(`${data.key}:${data.stride}`);const t=this.byKey.get(data.key);
        if(data.error){this.disableWorker();return;}
        if(t&&!t.cache.has(data.stride)){t.cache.set(data.stride,geometryFromBuffers(data.buffers));if(t.wanted===data.stride)this.install(t,data.stride);}
      };
      this.worker.onerror=event=>{event.preventDefault();this.disableWorker();};
    }catch{this.disableWorker();}
  }
  disableWorker(){this.worker?.terminate();this.worker=null;this.pending.clear();this.timer=0;}
  install(t,stride){t.mesh.geometry=t.cache.get(stride);t.stride=stride;t.lastUsed=this.tick;}
  build(t,stride){if(!t.cache.has(stride))t.cache.set(stride,terrainGeometry(t.tile.values,129,129,4,t.x,t.z,.1,stride,null,t.border));this.install(t,stride);}
  update(camera,ride,dt,pixelHeight=900){
    this.tick++;this.timer-=dt;
    if(this.timer<=0){
      this.timer=.25;this.queue=[];camera.updateMatrixWorld();this.frustum.setFromProjectionMatrix(this.viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));const pixelScale=Math.min(1600,pixelHeight)/(2*Math.tan(camera.fov*Math.PI/360));
      for(const t of this.tiles){
        const dx=camera.position.x-clamp(camera.position.x,t.x,t.x+512),dz=camera.position.z-clamp(camera.position.z,t.z,t.z+512);t.distance=Math.hypot(dx,dz);
        const near=this.quality==='high'?200:this.quality==='low'?100:140,critical=t.distance<near+(t.stride===1?30:0),visible=this.frustum.intersectsBox(t.box),distance=t.box.distanceToPoint(camera.position);
        t.screenError=t.errors[t.stride]*pixelScale/Math.max(1,distance);t.visible=visible;
        let wanted=visible?terrainStride(t.errors,distance,pixelScale,ride?this.quality:'low',t.stride):8;
        // Rare cliff outliers must not refine an entire distant tile to 4 m.
        const fullLimit=this.quality==='high'?360:220,mediumLimit=this.quality==='high'?1300:this.quality==='low'?300:800,farLimit=this.quality==='high'?3200:this.quality==='low'?1100:2200;
        if(t.distance>fullLimit)wanted=Math.max(2,wanted);if(t.distance>mediumLimit)wanted=Math.max(4,wanted);if(t.distance>farLimit)wanted=8;
        if(this.quality==='low'&&t.distance>near+30)wanted=Math.max(4,wanted);
        t.wanted=ride&&critical?1:wanted;
        if(t.wanted!==t.stride){
          if(t.cache.has(t.wanted))this.install(t,t.wanted);
          else if(t.distance<85)this.build(t,1); // Ground under skier/camera is always ready.
          else this.queue.push(t);
        }
        t.mesh.castShadow=ride&&t.distance<180;
      }
      this.queue.sort((a,b)=>a.distance-b.distance);
      // Retain a small warm cache, avoiding repeated rebuilds at tile boundaries.
      const inactive=this.tiles.filter(t=>t.stride===8&&t.cache.size>1).sort((a,b)=>b.lastUsed-a.lastUsed);
      for(const t of inactive.slice(12))for(const [stride,g] of t.cache)if(stride!==8){g.dispose();t.cache.delete(stride);}
    }
    let builds=0;
    for(const t of this.queue){
      if(t.cache.has(t.wanted)||t.wanted===t.stride)continue;
      const key=`${t.key}:${t.wanted}`;if(this.pending.has(key))continue;
      if(this.worker){if(this.pending.size>=2)break;const values=t.tile.values.slice();this.pending.add(key);this.worker.postMessage({key:t.key,x:t.x,z:t.z,stride:t.wanted,values,border:t.border},[values.buffer]);}
      else {this.build(t,t.wanted);if(++builds>=1)break;}
    }
  }
}

export function branchGeometry(snow=false){
  const positions=[],normals=[];
  for(let tier=0;tier<7;tier++){
    const radius=(1-tier*.12)*(snow?.86:1),height=.34-tier*.018;
    const g=new THREE.ConeGeometry(radius,height,snow?6:8,1,true).toNonIndexed();
    g.translate(0,.18+tier*.13+(snow?.055:0),0);
    positions.push(...g.attributes.position.array);normals.push(...g.attributes.normal.array);g.dispose();
  }
  if(snow){const cap=new THREE.SphereGeometry(.22,7,5).toNonIndexed();cap.translate(0,1.08,0);positions.push(...cap.attributes.position.array);normals.push(...cap.attributes.normal.array);cap.dispose();}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));return g;
}
