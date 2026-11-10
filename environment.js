import * as THREE from './vendor/three.module.js';
import {clamp,lerp,seededRandom} from './core.js';
export const CLOUD_GLSL=`
 uniform float envTime;uniform float cloudCover;uniform float surfaceDetail;
 float envHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float envNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(envHash(i),envHash(i+vec2(1,0)),f.x),mix(envHash(i+vec2(0,1)),envHash(i+vec2(1,1)),f.x),f.y);}
 float cloudField(vec2 p){p+=vec2(.006,.0025)*envTime;return envNoise(p)*.65+envNoise(p*2.07)*.35;}
 float cloudMask(vec2 p){return smoothstep(mix(.83,.23,cloudCover),mix(.99,.54,cloudCover),cloudField(p));}
`;
const PRESETS={clear:{sun:4.35,hemi:1.15,fog:.00004,cover:.12,wind:.32,top:'#0a3a8c',bottom:'#c5daf4',fogColor:'#6e96b8',sunColor:'#ffe2a3',exposure:1.18},golden:{sun:3.35,hemi:1.2,fog:.00007,cover:.2,wind:.22,top:'#4e7398',bottom:'#f3d0aa',fogColor:'#b4a898',sunColor:'#ffc98a',exposure:1.06},snow:{sun:.95,hemi:1.7,fog:.0016,cover:.95,wind:.8,top:'#7e9eb4',bottom:'#d8e2e8',fogColor:'#b7c6d0',sunColor:'#fff5da',exposure:.95},overcast:{sun:1.35,hemi:1.45,fog:.00035,cover:.88,wind:.5,top:'#5e7b92',bottom:'#c5d0d8',fogColor:'#9aadb8',sunColor:'#e8eef2',exposure:.98}};
export class AlpineEnvironment{
 constructor(world){this.world=world;this.time=0;this.blend=0;this.initialized=false;this.sunOffset={x:20,y:240,z:220};this.uniforms={envTime:{value:0},cloudCover:{value:.32},windPower:{value:.35},surfaceDetail:{value:1},hazeStart:{value:14000},hazeEnd:{value:90000},sunDir:{value:new THREE.Vector3(20,240,220).normalize()},forestMap:{value:(()=>{const tex=new THREE.DataTexture(new Uint8Array([0,0,0,0]),1,1);tex.needsUpdate=true;return tex;})()},forestOrigin:{value:new THREE.Vector2(-9728,-7680)},forestSize:{value:new THREE.Vector2(19456,15872)}};this.colors={top:new THREE.Color(),bottom:new THREE.Color(),fog:new THREE.Color(),sun:new THREE.Color()};this.makeDrift();}
 makeDrift(){
  const rand=seededRandom(604),positions=new Float32Array(192*3);for(let i=0;i<positions.length;i+=3){positions[i]=(rand()-.5)*100;positions[i+1]=rand()*2.5;positions[i+2]=(rand()-.5)*100;}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3));
  this.groundData=new Uint8Array(17*17*4);this.groundTexture=new THREE.DataTexture(this.groundData,17,17);this.groundTexture.minFilter=this.groundTexture.magFilter=THREE.LinearFilter;this.groundTexture.generateMipmaps=false;this.groundCenter=null;
  const m=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{...this.uniforms,groundTexture:{value:this.groundTexture},groundOrigin:{value:new THREE.Vector2()},driftOrigin:{value:new THREE.Vector3()},pixelHeight:{value:900}},vertexShader:`uniform float envTime;uniform float windPower;uniform vec3 driftOrigin;uniform float pixelHeight;uniform sampler2D groundTexture;uniform vec2 groundOrigin;varying float fade;void main(){vec3 p=position;p.x=mod(p.x+envTime*(1.+windPower*3.)+50.,100.)-50.;p.z+=sin(envTime*.3+position.x)*.4;p.y+=sin(envTime+position.z)*.15;fade=(1.-smoothstep(28.,48.,length(p.xz)))*(.12+windPower*.2);vec2 worldXZ=p.xz+driftOrigin.xz;vec2 texel=((worldXZ-groundOrigin)/8.+.5)/17.;vec2 encodedGround=texture2D(groundTexture,texel).rg;p.y+=dot(encodedGround,vec2(6528.,25.5));vec4 v=modelViewMatrix*vec4(p+driftOrigin,1.);gl_Position=projectionMatrix*v;gl_PointSize=clamp(pixelHeight*.025/max(1.,-v.z),1.,6.);}`,fragmentShader:`varying float fade;void main(){float r=length(gl_PointCoord-.5)*2.;float a=(1.-smoothstep(.1,1.,r))*fade;if(a<.01)discard;gl_FragColor=vec4(.86,.94,1.,a);}`});
  this.drift=new THREE.Points(g,m);this.drift.frustumCulled=false;this.drift.visible=false;this.world.scene.add(this.drift);
 }
 update(dt){
  const w=this.world,enabled=w.options.dynamic!==false,p=PRESETS[w.weather]||PRESETS.clear;
  if(enabled)this.time+=Math.max(0,dt);this.uniforms.envTime.value=this.time;this.uniforms.surfaceDetail.value=w.quality==='low'?0:1;
  const live=w.weatherLive,mix=this.initialized?1-Math.exp(-Math.max(0,dt)*.8):1;this.initialized=true;
  const cover=live&&Number.isFinite(live.cloud)?clamp(live.cloud/100,.08,.98):p.cover;
  const wind=live&&Number.isFinite(live.wind)?clamp(live.wind/22,.15,1.15):p.wind;
  this.uniforms.cloudCover.value=lerp(this.uniforms.cloudCover.value,cover,mix);
  const gust=.68+.22*Math.sin(this.time*.31)+.10*Math.sin(this.time*.83);this.uniforms.windPower.value=enabled?wind*gust:0;
  const liveHour=live&&Number.isFinite(live.hour)?live.hour:12,day=live?.isDay!==0&&liveHour>=6&&liveHour<=20;
  const elev=day?Math.max(.12,Math.sin(Math.PI*clamp((liveHour-6)/13,0,1))):.06;
  const az=(liveHour-13)/7;
  this.sunOffset.x=az*140;this.sunOffset.y=90+elev*170;this.sunOffset.z=150+elev*90;
  this.uniforms.sunDir.value.set(this.sunOffset.x,this.sunOffset.y,this.sunOffset.z).normalize();
  const alt=w.camera?.position.y||2000,ride=w.mode==='ride';
  // Haze begins well beyond the local relief relative to camera height, so a high overview stay crisp.
  const start=ride?Math.max(1400,alt*.85):Math.max(22000,alt*2.1);
  const end=ride?start*6+5000:Math.max(90000,alt*8);
  this.uniforms.hazeStart.value=lerp(this.uniforms.hazeStart.value,start,mix);
  this.uniforms.hazeEnd.value=lerp(this.uniforms.hazeEnd.value,end,mix);
  const night=day?1:.42;
  w.sun.intensity=lerp(w.sun.intensity,p.sun*night*(1-.045*Math.sin(this.time*.04)),mix);w.hemi.intensity=lerp(w.hemi.intensity,p.hemi*(day?1:1.15),mix);
  w.sun.color.lerp(this.colors.sun.set(p.sunColor),mix);w.scene.fog.color.lerp(this.colors.fog.set(p.fogColor),mix);
  w.scene.fog.density=lerp(w.scene.fog.density,ride?p.fog*(day?1:1.15):w.weather==='snow'?.000018:.00001,mix);
  if(w.renderer?.toneMappingExposure!=null)w.renderer.toneMappingExposure=lerp(w.renderer.toneMappingExposure,(p.exposure||1.1)*night,mix);
  if(w.mode!=='ride')w.sun.position.set(this.sunOffset.x*70,this.sunOffset.y*70,this.sunOffset.z*70);
  w.sky.material.uniforms.topColor.value.lerp(this.colors.top.set(p.top),mix);w.sky.material.uniforms.bottomColor.value.lerp(this.colors.bottom.set(p.bottom),mix);
  this.drift.visible=enabled&&w.mode==='ride'&&w.quality!=='low';
  if(this.drift.visible){const x=w.skier.position.x,z=w.skier.position.z,cx=Math.round(x/16)*16,cz=Math.round(z/16)*16;
   if(!this.groundCenter||cx!==this.groundCenter.x||cz!==this.groundCenter.z){this.groundCenter={x:cx,z:cz};for(let j=0;j<17;j++)for(let i=0;i<17;i++){const v=clamp(Math.round(w.height(cx-64+i*8,cz-64+j*8)*10),0,65535),k=(j*17+i)*4;this.groundData[k]=v>>8;this.groundData[k+1]=v&255;this.groundData[k+3]=255;}this.groundTexture.needsUpdate=true;this.drift.material.uniforms.groundOrigin.value.set(cx-64,cz-64);}
   this.drift.material.uniforms.driftOrigin.value.set(x,.25,z);this.drift.material.uniforms.pixelHeight.value=(w.container?.clientHeight||900)*(w.renderer.getPixelRatio?.()||1);}
  if(w.snow){const flakes=w.weather==='snow'||w.weather==='overcast';w.snow.visible=flakes&&w.mode==='ride';if(w.snow.material)w.snow.material.opacity=w.weather==='snow'?.88:.38;if(w.snowTime)w.snowTime.value=this.time;}
 }
}
export function windMaterial(material,uniforms){
 if(!uniforms)return material;const compile=material.onBeforeCompile,key=material.customProgramCacheKey();
 material.onBeforeCompile=shader=>{compile(shader);Object.assign(shader.uniforms,uniforms);shader.vertexShader='uniform float envTime;uniform float windPower;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
  float branchHeight=max(position.y,0.);float phase=instanceMatrix[3].x*.017+instanceMatrix[3].z*.011;
  transformed.x+=sin(envTime*1.4+phase+position.y*2.)*branchHeight*branchHeight*.009*windPower;
  transformed.z+=cos(envTime*.9+phase)*branchHeight*branchHeight*.005*windPower;`);};material.customProgramCacheKey=()=>key+'-wind-v6';return material;
}
