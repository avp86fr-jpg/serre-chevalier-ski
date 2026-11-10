import * as THREE from './vendor/three.module.js';
import {clamp,lerp,seededRandom} from './core.js';
export const CLOUD_GLSL=`
 uniform float envTime;uniform float cloudCover;uniform float surfaceDetail;
 float envHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float envNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(envHash(i),envHash(i+vec2(1,0)),f.x),mix(envHash(i+vec2(0,1)),envHash(i+vec2(1,1)),f.x),f.y);}
 float cloudField(vec2 p){p+=vec2(.006,.0025)*envTime;return envNoise(p)*.65+envNoise(p*2.07)*.35;}
 float cloudMask(vec2 p){return smoothstep(mix(.83,.23,cloudCover),mix(.99,.54,cloudCover),cloudField(p));}
`;
const PRESETS={clear:{sun:3.2,hemi:1.65,fog:.000075,cover:.32,wind:.35,top:'#4f87b5',bottom:'#d7e4e7',fogColor:'#adc7d6',sunColor:'#fff5da'},golden:{sun:2.9,hemi:1.65,fog:.000075,cover:.23,wind:.22,top:'#63879d',bottom:'#f3d5b8',fogColor:'#b7c1cc',sunColor:'#ffd3a0'},snow:{sun:.8,hemi:2.2,fog:.002,cover:.95,wind:.8,top:'#a1b9c8',bottom:'#dce5e8',fogColor:'#c5d5dd',sunColor:'#fff5da'},overcast:{sun:1.15,hemi:2.05,fog:.00055,cover:.88,wind:.5,top:'#7f97a8',bottom:'#d3dce1',fogColor:'#b7c4cd',sunColor:'#e8eef2'}};
export class AlpineEnvironment{
 constructor(world){this.world=world;this.time=0;this.blend=0;this.initialized=false;this.uniforms={envTime:{value:0},cloudCover:{value:.32},windPower:{value:.35},surfaceDetail:{value:1}};this.colors={top:new THREE.Color(),bottom:new THREE.Color(),fog:new THREE.Color(),sun:new THREE.Color()};this.makeDrift();}
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
  w.sun.intensity=lerp(w.sun.intensity,p.sun*(1-.045*Math.sin(this.time*.04)),mix);w.hemi.intensity=lerp(w.hemi.intensity,p.hemi,mix);
  w.sun.color.lerp(this.colors.sun.set(p.sunColor),mix);w.scene.fog.color.lerp(this.colors.fog.set(p.fogColor),mix);
  w.scene.fog.density=lerp(w.scene.fog.density,w.mode==='ride'?p.fog:w.weather==='snow'?.00007:.000027,mix);
  w.sky.material.uniforms.topColor.value.lerp(this.colors.top.set(p.top),mix);w.sky.material.uniforms.bottomColor.value.lerp(this.colors.bottom.set(p.bottom),mix);
  this.drift.visible=enabled&&w.mode==='ride'&&w.quality!=='low';
  if(this.drift.visible){const x=w.skier.position.x,z=w.skier.position.z,cx=Math.round(x/16)*16,cz=Math.round(z/16)*16;
   if(!this.groundCenter||cx!==this.groundCenter.x||cz!==this.groundCenter.z){this.groundCenter={x:cx,z:cz};for(let j=0;j<17;j++)for(let i=0;i<17;i++){const v=clamp(Math.round(w.height(cx-64+i*8,cz-64+j*8)*10),0,65535),k=(j*17+i)*4;this.groundData[k]=v>>8;this.groundData[k+1]=v&255;this.groundData[k+3]=255;}this.groundTexture.needsUpdate=true;this.drift.material.uniforms.groundOrigin.value.set(cx-64,cz-64);}
   this.drift.material.uniforms.driftOrigin.value.set(x,.25,z);this.drift.material.uniforms.pixelHeight.value=(w.container?.clientHeight||900)*(w.renderer.getPixelRatio?.()||1);}
  if(w.snow){w.snow.visible=w.weather==='snow'&&w.mode==='ride';if(w.snowTime)w.snowTime.value=this.time;}
 }
}
export function windMaterial(material,uniforms){
 if(!uniforms)return material;const compile=material.onBeforeCompile,key=material.customProgramCacheKey();
 material.onBeforeCompile=shader=>{compile(shader);Object.assign(shader.uniforms,uniforms);shader.vertexShader='uniform float envTime;uniform float windPower;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
  float branchHeight=max(position.y,0.);float phase=instanceMatrix[3].x*.017+instanceMatrix[3].z*.011;
  transformed.x+=sin(envTime*1.4+phase+position.y*2.)*branchHeight*branchHeight*.009*windPower;
  transformed.z+=cos(envTime*.9+phase)*branchHeight*branchHeight*.005*windPower;`);};material.customProgramCacheKey=()=>key+'-wind-v6';return material;
}
