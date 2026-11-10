import * as THREE from './vendor/three.module.js';
import {seededRandom} from './core.js';
export function groomedTextureData(size=512){
 const random=seededRandom(610),height=new Float32Array(size*size),color=new Uint8Array(size*size*4),normal=new Uint8Array(size*size*4),roughness=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=y*size+x,groove=.5+.5*Math.cos(x/size*Math.PI*64),grain=random();height[i]=groove*.72+grain*.11+Math.sin(y/size*Math.PI*16+x/size*4)*.025;const v=Math.round(224+groove*18+grain*8);color.set([v,Math.min(255,v+2),Math.min(255,v+4),255],i*4);const r=Math.round(188+grain*36+groove*12);roughness.set([r,r,r,255],i*4);}
 const at=(x,y)=>height[((y+size)%size)*size+(x+size)%size];
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const dx=(at(x+1,y)-at(x-1,y))*1.8,dy=(at(x,y+1)-at(x,y-1))*.5,length=Math.hypot(dx,dy,1),i=(y*size+x)*4;normal.set([Math.round(127.5-dx/length*127.5),Math.round(127.5-dy/length*127.5),Math.round(127.5+127.5/length),255],i);}
 return{size,color,normal,roughness};
}
// CPU data is shared; each selected route owns/disposes its GPU textures.
let source;
export function groomedMaterial(anisotropy=4){
 source??=groomedTextureData();const maps={};for(const name of ['color','normal','roughness']){const t=new THREE.DataTexture(source[name],source.size,source.size);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;t.anisotropy=Math.min(8,anisotropy);if(name==='color')t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;maps[name]=t;}
 return new THREE.MeshStandardMaterial({color:0xf6f8fa,map:maps.color,normalMap:maps.normal,normalScale:new THREE.Vector2(.48,.32),roughnessMap:maps.roughness,roughness:1,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
}
