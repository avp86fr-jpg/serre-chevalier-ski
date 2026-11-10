import {gridBuffers} from './grid.js';
self.onmessage=({data})=>{
  try{
    const buffers=gridBuffers(data.values,129,129,4,data.x,data.z,.1,data.stride,null,data.border);
    self.postMessage({key:data.key,stride:data.stride,buffers},Object.values(buffers).map(a=>a.buffer));
  }catch(error){self.postMessage({key:data.key,stride:data.stride,error:String(error)});}
};
