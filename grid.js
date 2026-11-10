// Pure mesh generation also used by the terrain worker. Heights never change with LOD.
export function gridBuffers(values,width,height,step,x0,z0,scale=.1,stride=1,omit=null,border=null){
  const nx=(width-1)/stride+1,nz=(height-1)/stride+1;
  const position=new Float32Array(nx*nz*3),normal=new Float32Array(nx*nz*3),uv=new Float32Array(nx*nz*2);
  const Index=nx*nz<65536?Uint16Array:Uint32Array,index=new Index((nx-1)*(nz-1)*6);let count=0;
  for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
    const i=z*nx+x,wx=x0+x*step*stride,wz=z0+z*step*stride,ix=x*stride,iz=z*stride;
    position[i*3]=wx;position[i*3+1]=values[iz*width+ix]*scale;position[i*3+2]=wz;uv[i*2]=wx/18;uv[i*2+1]=wz/18;
    // Use the original sampling interval for every LOD. Border normals sample
    // neighboring tiles so shared vertices also have identical lighting.
    const l=Math.max(0,ix-1),r=Math.min(width-1,ix+1),n=Math.max(0,iz-1),s=Math.min(height-1,iz+1);
    const dx=(values[iz*width+r]-values[iz*width+l])*scale/((r-l)*step),dz=(values[s*width+ix]-values[n*width+ix])*scale/((s-n)*step),len=Math.hypot(dx,1,dz);
    if(border&&(ix===0||ix===width-1||iz===0||iz===height-1)){
      const edge=iz===0?ix:iz===height-1?width+ix:ix===0?width*2+iz:width*2+height+iz;
      normal.set(border.subarray(edge*3,edge*3+3),i*3);
    }else{normal[i*3]=-dx/len;normal[i*3+1]=1/len;normal[i*3+2]=-dz/len;}
    if(x<nx-1&&z<nz-1&&!omit?.(wx,wz)){index[count++]=i;index[count++]=i+nx;index[count++]=i+1;index[count++]=i+nx;index[count++]=i+nx+1;index[count++]=i+1;}
  }
  return {position,normal,uv,index:count===index.length?index:index.slice(0,count)};
}

export function normalBorder(sample,width,height,step,x0,z0){
 const border=new Float32Array((width+height)*2*3);
 const put=(index,x,z)=>{const dx=(sample(x+step,z)-sample(x-step,z))/(step*2),dz=(sample(x,z+step)-sample(x,z-step))/(step*2),length=Math.hypot(dx,1,dz);border.set([-dx/length,1/length,-dz/length],index*3);};
 for(let x=0;x<width;x++){put(x,x0+x*step,z0);put(width+x,x0+x*step,z0+(height-1)*step);}
 for(let z=0;z<height;z++){put(width*2+z,x0,z0+z*step);put(width*2+height+z,x0+(width-1)*step,z0+z*step);}
 return border;
}

// Exact maximum vertical deviation from the same triangle split used to render.
export function terrainErrors(values,width,height,scale=.1){
 let minHeight=Infinity,maxHeight=-Infinity;for(const h of values){minHeight=Math.min(minHeight,h*scale);maxHeight=Math.max(maxHeight,h*scale);}
 const errors={1:0};
 for(const stride of [2,4,8]){let error=0;
  for(let z=0;z<height;z++)for(let x=0;x<width;x++){
   if(x%stride===0&&z%stride===0)continue;
   const i=Math.min(Math.floor(x/stride)*stride,width-1-stride),j=Math.min(Math.floor(z/stride)*stride,height-1-stride),u=(x-i)/stride,v=(z-j)/stride,k=j*width+i;
   const coarse=u+v<=1?values[k]*(1-u-v)+values[k+stride]*u+values[k+width*stride]*v:values[k+width*stride+stride]*(u+v-1)+values[k+stride]*(1-v)+values[k+width*stride]*(1-u);
   error=Math.max(error,Math.abs(values[z*width+x]-coarse)*scale);
  }
  errors[stride]=error;
 }
 return{errors,minHeight,maxHeight};
}

export function terrainStride(errors,distance,pixelScale,quality='balanced',current=8){
 const target=quality==='high'?1.5:quality==='low'?4.5:quality==='auto'?2.8:2.2;
 for(const stride of [8,4,2,1])if(errors[stride]*pixelScale/Math.max(1,distance)<=target*(stride>current?.75:1.2))return stride;
 return 1;
}
