import * as THREE from './vendor/three.module.js';
import {CLOUD_GLSL} from './environment.js';
export function buildingFrame(p){
 const [x,z,w,d,,,a]=p;if(!a)return{x,z,w,d,angle:0};const c=Math.cos(a.angle),s=Math.sin(a.angle),[u,v]=a.offset;
 return{x:x+c*u+s*v,z:z-s*u+c*v,w:a.width,d:a.depth,angle:a.angle};
}
export function footprintGeometry(items,height){
 const positions=[],uv=[],colors=[],color=new THREE.Color();
 for(const p of items){const [x,z,w,d,h,,a]=p,ring=a?.ring||[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]],angle=a?.angle||0,c=Math.cos(angle),s=Math.sin(angle),y=height(x,z);color.setHSL(.075,.38,.42+((a?.id||0)%11)*.022);
  let along=0;
  for(let i=0;i<ring.length;i++){const u=ring[i],v=ring[(i+1)%ring.length],length=Math.hypot(v[0]-u[0],v[1]-u[1]);if(length<.01)continue;const a0=[x+c*u[0]+s*u[1],y,z-s*u[0]+c*u[1]],b0=[x+c*v[0]+s*v[1],y,z-s*v[0]+c*v[1]];a0[1]=Math.min(y,height(a0[0],a0[2]))-.4;b0[1]=Math.min(y,height(b0[0],b0[2]))-.4;const a1=[a0[0],y+h,a0[2]],b1=[b0[0],y+h,b0[2]];
   for(const [point,tx,ty]of[[a0,along,0],[a1,along,h],[b0,along+length,0],[b0,along+length,0],[a1,along,h],[b1,along+length,h]]){positions.push(...point);uv.push(tx,ty);colors.push(color.r,color.g,color.b);}along+=length;
  }
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();g.computeBoundingSphere();return g;
}
export function footprintMaterial(){
 const m=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,side:THREE.DoubleSide});
 m.onBeforeCompile=shader=>{shader.vertexShader='varying vec2 vBuildingUV;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvBuildingUV=uv;');shader.fragmentShader='varying vec2 vBuildingUV;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 vec2 pane=fract(vBuildingUV/vec2(2.8,2.7));float windowMask=step(.24,pane.x)*step(pane.x,.68)*step(.25,pane.y)*step(pane.y,.74)*step(1.5,vBuildingUV.y);
 float sill=step(.20,pane.y)*step(pane.y,.25)*step(.19,pane.x)*step(pane.x,.73)*step(1.5,vBuildingUV.y);
 float stone=(.5+.5*sin(floor(vBuildingUV.y*5.)*17.+floor(vBuildingUV.x*2.)*13.))*.16;
float plinth=step(vBuildingUV.y,1.15);
vec3 timber=mix(diffuseColor.rgb,vec3(.45,.30,.18),.28+.15*step(fract(vBuildingUV.y*3.2),.18));
diffuseColor.rgb=mix(timber,vec3(.42,.40,.37)*(1.-stone),plinth);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.10,.16,.20),windowMask*.94);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.82,.78,.70),sill*.75);
float beam=step(fract(vBuildingUV.x/2.8),.06);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.28,.18,.10),beam*.55);`);};m.customProgramCacheKey=()=> 'alpine-footprints-v6';return m;
}

export function roofSnowMaterial(environment){
 const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.86});
 m.onBeforeCompile=shader=>{Object.assign(shader.uniforms,environment||{envTime:{value:0},cloudCover:{value:0},surfaceDetail:{value:1}});shader.vertexShader='varying vec3 vRoof;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvRoof=(modelMatrix*instanceMatrix*vec4(position,1.)).xyz;');shader.fragmentShader=CLOUD_GLSL+'varying vec3 vRoof;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 float cap=smoothstep(.10,.36,envNoise(vRoof.xz*.13));float seams=smoothstep(.90,.99,fract(vRoof.y*3.+vRoof.x*.2));
 vec3 slate=mix(vec3(.16,.20,.23),vec3(.30,.32,.32),envNoise(vRoof.xz*1.3))*(1.-seams*.25);
 diffuseColor.rgb*=mix(slate,vec3(.94,.97,.99),cap);`);shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>','#include <lights_fragment_end>\nreflectedLight.directDiffuse*=1.-cloudMask(vRoof.xz*.00035)*.27;');};m.customProgramCacheKey=()=> 'alpine-snow-roofs-v7';return m;
}
