import * as THREE from './vendor/three.module.js';
import {clamp,seededRandom} from './core.js';

export class SkiEffects{
  constructor(scene,height){
    this.height=height;this.random=seededRandom(305);this.capacity=240;this.cursor=0;this.emission=0;
    this.positions=new Float32Array(this.capacity*3);this.velocities=new Float32Array(this.capacity*3);this.ages=new Float32Array(this.capacity).fill(99);this.life=new Float32Array(this.capacity);this.alpha=new Float32Array(this.capacity);
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(this.positions,3).setUsage(THREE.DynamicDrawUsage));geo.setAttribute('opacity',new THREE.BufferAttribute(this.alpha,1).setUsage(THREE.DynamicDrawUsage));
    const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{pointScale:{value:700}},vertexShader:'attribute float opacity;varying float vAlpha;uniform float pointScale;void main(){vAlpha=opacity;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(pointScale*.14/max(1.,-p.z),1.5,26.);}',fragmentShader:'varying float vAlpha;void main(){float r=length(gl_PointCoord-.5)*2.;float a=(1.-smoothstep(.12,1.,r))*vAlpha;if(a<.015)discard;gl_FragColor=vec4(.93,.97,1.,a);}'});
    this.spray=new THREE.Points(geo,mat);this.spray.frustumCulled=false;this.spray.visible=false;scene.add(this.spray);
    this.trackCapacity=1200;this.trackCount=0;this.last=null;
    this.trackPositions=new Float32Array(this.trackCapacity*36);this.trackBorn=new Float32Array(this.trackCapacity*12);this.trackUV=new Float32Array(this.trackCapacity*24);
    for(let i=0;i<this.trackCapacity*2;i++)this.trackUV.set([0,0,1,0,0,1,1,0,1,1,0,1],i*12);
    const tracks=new THREE.BufferGeometry();tracks.setAttribute('position',new THREE.BufferAttribute(this.trackPositions,3).setUsage(THREE.DynamicDrawUsage));tracks.setAttribute('born',new THREE.BufferAttribute(this.trackBorn,1).setUsage(THREE.DynamicDrawUsage));tracks.setAttribute('uv',new THREE.BufferAttribute(this.trackUV,2));tracks.setDrawRange(0,0);
    const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-3,uniforms:{time:{value:0}},vertexShader:'attribute float born;uniform float time;varying vec2 vUv;varying float fade;void main(){vUv=uv;fade=1.-smoothstep(35.,65.,time-born);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 vUv;varying float fade;void main(){float edge=abs(vUv.x-.5)*2.;float a=(1.-smoothstep(.6,1.,edge))*(.15+.13*edge)*fade;gl_FragColor=vec4(.35,.48,.58,a);}'});
    this.tracks=new THREE.Mesh(tracks,material);this.tracks.frustumCulled=false;scene.add(this.tracks);
  }
  reset(){this.trackCount=0;this.last=null;this.emission=0;this.ages.fill(99);this.alpha.fill(0);this.spray.visible=false;this.tracks.geometry.setDrawRange(0,0);this.tracks.geometry.attributes.position.clearUpdateRanges();this.tracks.geometry.attributes.born.clearUpdateRanges();}
  addTrack(p,time,braking){
    if(this.last){
      const index=this.trackCount%this.trackCapacity,positions=[],width=braking?.16:.065;
      for(const side of [-1,1]){
        const corners=[];for(const q of [this.last,p])for(const e of [-1,1]){const foot=q.skiContacts?.[side<0?0:1],x=foot?foot.x+foot.tz*e*width:q.x+q.tz*(side*.23+e*width),z=foot?foot.z-foot.tx*e*width:q.z-q.tx*(side*.23+e*width);corners.push([x,this.height(x,z)+.075,z]);}
        for(const i of [0,1,2,1,3,2])positions.push(...corners[i]);
      }
      this.trackPositions.set(positions,index*36);this.trackBorn.fill(time,index*12,index*12+12);const g=this.tracks.geometry;
      g.attributes.position.addUpdateRange(index*36,36);g.attributes.born.addUpdateRange(index*12,12);g.attributes.position.needsUpdate=g.attributes.born.needsUpdate=true;this.trackCount++;g.setDrawRange(0,Math.min(this.trackCount,this.trackCapacity)*12);
    }
    this.last={...p,skiContacts:p.skiContacts?.map(c=>({...c}))};
  }
  update(p,run,input,dt,time,pixelHeight=900){
    this.tracks.material.uniforms.time.value=time;this.spray.material.uniforms.pointScale.value=pixelHeight;
    if(dt<=0)return;
    if(run.airborne||run.liftRide||run.crashed>0)this.last=null;
    else if(run.speed>1.5&&(!this.last||Math.hypot(p.x-this.last.x,p.z-this.last.z)>.65))this.addTrack(p,time,input.brake);
    const intensity=clamp(Math.abs(run.edgeAngle)*2+(input.brake?1.2:0)+(run.softSnow||0)*.7,0,1.6)*clamp(run.speed/15,0,1.8);
    this.emission+=intensity*90*dt;
    while(this.emission>=1){
      this.emission--;const i=this.cursor++%this.capacity,k=i*3,side=this.random()>.5?1:-1,lateral=side*(.8+this.random()*2.5),back=.6+this.random()*2;
      const foot=p.skiContacts?.[side<0?0:1];this.positions[k]=foot?.x??p.x+p.tz*side*.25;this.positions[k+1]=(foot?.y??p.y)+.14;this.positions[k+2]=foot?.z??p.z-p.tx*side*.25;
      this.velocities[k]=p.tz*lateral-p.tx*back;this.velocities[k+1]=1.1+this.random()*2.2;this.velocities[k+2]=-p.tx*lateral-p.tz*back;
      this.ages[i]=0;this.life[i]=.55+this.random()*.65;
    }
    let alive=0;
    for(let i=0;i<this.capacity;i++){
      this.ages[i]+=dt;const a=this.ages[i]/(this.life[i]||1);if(a>=1){this.alpha[i]=0;continue;}alive++;const k=i*3,drag=Math.exp(-dt*1.8);this.velocities[k]*=drag;this.velocities[k+2]*=drag;this.velocities[k+1]-=6.2*dt;
      this.positions[k]+=this.velocities[k]*dt;this.positions[k+1]+=this.velocities[k+1]*dt;this.positions[k+2]+=this.velocities[k+2]*dt;
      const ground=this.height(this.positions[k],this.positions[k+2]);if(this.positions[k+1]<ground+.04){this.positions[k+1]=ground+.04;this.velocities[k+1]=0;this.ages[i]+=dt*2;}
      this.alpha[i]=(1-a)*.85;
    }
    this.spray.visible=alive>0;this.spray.geometry.attributes.position.needsUpdate=this.spray.geometry.attributes.opacity.needsUpdate=true;
  }
}
