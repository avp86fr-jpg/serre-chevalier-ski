import * as THREE from './vendor/three.module.js';
import {clamp} from './core.js';

const TILE=512,STEP=4,SIZE=TILE/STEP+3,HALO=STEP;
const half=THREE.DataUtils.toHalfFloat,unhalf=THREE.DataUtils.fromHalfFloat;
// Signed coverage and transverse coordinates, shared by all terrain detail levels.
// A halo on each layer makes bilinear samples continuous across 512 m boundaries.
export class PisteSurface{
 constructor(domain){
  const records=new Map();
  for(const s of domain.segments){
   const pad=s.width+16+HALO,minX=Math.min(s.a[0],s.b[0])-pad,maxX=Math.max(s.a[0],s.b[0])+pad,minZ=Math.min(s.a[1],s.b[1])-pad,maxZ=Math.max(s.a[1],s.b[1])+pad,dx=(s.b[0]-s.a[0])/s.length,dz=(s.b[1]-s.a[1])/s.length;
   for(let tz=Math.floor(minZ/TILE);tz<=Math.floor(maxZ/TILE);tz++)for(let tx=Math.floor(minX/TILE);tx<=Math.floor(maxX/TILE);tx++){
    const key=tx+','+tz;let tile=records.get(key);
    if(!tile){tile={tx,tz,data:new Uint16Array(SIZE*SIZE*2),best:new Float32Array(SIZE*SIZE).fill(-16)};for(let i=0;i<SIZE*SIZE;i++)tile.data.set([half(-16),0],i*2);records.set(key,tile);}
    const x0=Math.max(0,Math.floor((minX-tx*TILE)/STEP)+1),x1=Math.min(SIZE-1,Math.ceil((maxX-tx*TILE)/STEP)+1),z0=Math.max(0,Math.floor((minZ-tz*TILE)/STEP)+1),z1=Math.min(SIZE-1,Math.ceil((maxZ-tz*TILE)/STEP)+1);
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
     const wx=tx*TILE+(x-1)*STEP-s.a[0],wz=tz*TILE+(z-1)*STEP-s.a[1],along=clamp(wx*dx+wz*dz,0,s.length),rx=wx-dx*along,rz=wz-dz*along,margin=s.width-Math.hypot(rx,rz),i=z*SIZE+x;
     if(margin<=tile.best[i])continue;tile.best[i]=margin;const k=i*2;tile.data[k]=half(margin);tile.data[k+1]=half(-rx*dz+rz*dx);
    }
   }
  }
  this.tiles=[...records.values()];this.byKey=records;this.size=SIZE;this.step=STEP;this.tileSize=TILE;
  if(this.tiles.length>256)throw Error('Piste texture coverage exceeds the WebGL 2 layer budget');
  this.data=new Uint16Array(Math.max(1,this.tiles.length)*SIZE*SIZE*2);
  const minX=Math.min(0,...this.tiles.map(t=>t.tx)),minZ=Math.min(0,...this.tiles.map(t=>t.tz)),width=Math.max(0,...this.tiles.map(t=>t.tx))-minX+1,height=Math.max(0,...this.tiles.map(t=>t.tz))-minZ+1,index=new Uint8Array(width*height*4);
  this.tiles.forEach((t,i)=>{this.data.set(t.data,i*SIZE*SIZE*2);t.data=this.data.subarray(i*SIZE*SIZE*2,(i+1)*SIZE*SIZE*2);delete t.best;t.layer=i;const p=((t.tz-minZ)*width+t.tx-minX)*4;index[p]=(i+1)&255;index[p+1]=(i+1)>>8;index[p+3]=255;});
  this.texture=new THREE.DataArrayTexture(this.data,SIZE,SIZE,Math.max(1,this.tiles.length));this.texture.format=THREE.RGFormat;this.texture.type=THREE.HalfFloatType;this.texture.minFilter=this.texture.magFilter=THREE.LinearFilter;this.texture.generateMipmaps=false;this.texture.needsUpdate=true;
  this.index=new THREE.DataTexture(index,width,height);this.index.minFilter=this.index.magFilter=THREE.NearestFilter;this.index.needsUpdate=true;
  this.uniforms={pisteEnabled:{value:1},pisteField:{value:this.texture},pisteIndex:{value:this.index},pisteOrigin:{value:new THREE.Vector2(minX,minZ)},pisteIndexSize:{value:new THREE.Vector2(width,height)}};
 }
 sample(x,z){
  const tx=Math.floor(x/TILE),tz=Math.floor(z/TILE),t=this.byKey.get(tx+','+tz);if(!t)return{margin:-16,lateral:0,tx:0,tz:1};
  const px=(x-tx*TILE)/STEP+1,pz=(z-tz*TILE)/STEP+1,ix=Math.floor(px),iz=Math.floor(pz),fx=px-ix,fz=pz-iz,out=[];
  for(let c=0;c<2;c++){const at=(i,j)=>unhalf(t.data[(j*SIZE+i)*2+c]);out[c]=((at(ix,iz)*(1-fx)+at(ix+1,iz)*fx)*(1-fz)+(at(ix,iz+1)*(1-fx)+at(ix+1,iz+1)*fx)*fz);}
  return{margin:out[0],lateral:out[1]};
 }
}

let empty;
export function emptyPisteUniforms(){
 if(!empty){const field=new THREE.DataArrayTexture(new Uint16Array([half(-16),0]),1,1,1),index=new THREE.DataTexture(new Uint8Array(4),1,1);field.format=THREE.RGFormat;field.type=THREE.HalfFloatType;field.needsUpdate=index.needsUpdate=true;empty={field,index};}
 return{pisteEnabled:{value:0},pisteField:{value:empty.field},pisteIndex:{value:empty.index},pisteOrigin:{value:new THREE.Vector2()},pisteIndexSize:{value:new THREE.Vector2(1,1)}};
}

export const PISTE_GLSL=`
uniform float pisteEnabled;
uniform highp sampler2DArray pisteField;
uniform sampler2D pisteIndex;
uniform vec2 pisteOrigin;
uniform vec2 pisteIndexSize;
vec4 pisteAt(vec2 p){
 if(pisteEnabled<.5)return vec4(-16.,0.,0.,1.);
 vec2 cell=floor(p/512.)-pisteOrigin;
 if(any(lessThan(cell,vec2(0.)))||any(greaterThanEqual(cell,pisteIndexSize)))return vec4(-16.,0.,0.,1.);
 vec2 entry=texture2D(pisteIndex,(cell+.5)/pisteIndexSize).rg;
 float layer=floor(entry.r*255.+.5)+floor(entry.g*255.+.5)*256.-1.;
 if(layer<0.)return vec4(-16.,0.,0.,1.);
 vec2 uv=(fract(p/512.)*128.+1.5)/131.;
 vec4 field=texture(pisteField,vec3(uv,layer));
 return vec4(field.rg,0.,1.);
}
// Integral filtering prevents corduroy and grooming lanes flickering at distance.
float snowWave(float coordinate,float period){
 float footprint=max(fwidth(coordinate)/period,.0001);
 float attenuation=1.-smoothstep(.18,.8,footprint);
 return sin(coordinate*6.2831853/period)*attenuation;
}
`;
