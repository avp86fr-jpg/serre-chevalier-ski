import {clamp,lerp} from './core.js';

// Official snowpark / boardercross elevations from the 9 Nov 2026 Digisnow catalogue.
// Kickers sit beside candidate OSM pistes near those elevations; they are not a surveyed park survey.
export const PARK_SITES=[
  {id:'villeneuve-snowpark-facile',name:'Villeneuve Snowpark — Easy',sector:'Villeneuve',start:2325,end:2190,offset:12,kickers:[{length:16,height:1.55,width:8.5,gap:55},{length:14,height:1.35,width:8,gap:48},{length:18,height:2.1,width:9,gap:60}]},
  {id:'villeneuve-snowpark-moyen',name:'Villeneuve Snowpark — Medium',sector:'Villeneuve',start:2020,end:1980,offset:-11,kickers:[{length:15,height:1.9,width:8,gap:40},{length:17,height:2.4,width:8.5,gap:46}]},
  {id:'chantemerle-boardercross',name:'Chantemerle Boardercross',sector:'Chantemerle',start:2345,end:2210,offset:13,kickers:[{length:12,height:1.25,width:9,gap:42},{length:14,height:1.6,width:9,gap:50},{length:13,height:1.45,width:8.5,gap:44}]},
  {id:'briancon-funnycross',name:'Briançon Funnycross',sector:'Briançon',start:2405,end:2285,offset:-12,kickers:[{length:13,height:1.3,width:8.5,gap:45},{length:15,height:1.8,width:9,gap:52}]}
];

function routePoints(route,height){
  const pts=[];
  for(let i=1;i<route.points.length;i++){
    const a=route.points[i-1],b=route.points[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(len<.5)continue;
    const steps=Math.max(1,Math.ceil(len/8));
    for(let j=i===1?0:1;j<=steps;j++){
      const t=j/steps,x=lerp(a[0],b[0],t),z=lerp(a[1],b[1],t);
      pts.push({x,z,y:height(x,z)});
    }
  }
  return pts;
}

function pickCorridor(routes,height,site){
  let best=null;
  for(const route of routes){
    if(route.sector!==site.sector)continue;
    const pts=routePoints(route,height);if(pts.length<4)continue;
    let hi=-Infinity,lo=Infinity,hiI=0,loI=0;
    pts.forEach((p,i)=>{if(p.y>hi){hi=p.y;hiI=i;}if(p.y<lo){lo=p.y;loI=i;}});
    if(loI<=hiI)continue;
    const cover=Math.min(hi,site.start)-Math.max(lo,site.end);
    if(cover<20)continue;
    const score=Math.abs(hi-site.start)+Math.abs(lo-site.end);
    if(!best||score<best.score)best={route,pts,hiI,loI,score};
  }
  return best;
}

export function kickerHeight(k,x,z){
  const dx=x-k.x,dz=z-k.z,u=dx*k.tx+dz*k.tz,v=dx*-k.tz+dz*k.tx;
  if(u<-1||u>k.length+2||Math.abs(v)>k.width*.5+1.2)return 0;
  const across=1-clamp((Math.abs(v)-k.width*.35)/(k.width*.25+1.2),0,1);
  const climb=clamp(u/(k.length*.78),0,1);
  const ramp=climb*climb*(3-2*climb);
  const lip=u>k.length*.72?clamp((u-k.length*.72)/(k.length*.22),0,1):0;
  const drop=u>k.length?1-clamp((u-k.length)/1.6,0,1):1;
  return Math.max(0,(k.height*ramp+lip*k.height*.22)*across*drop);
}

export function parkBump(parks,x,z){
  let h=0;
  for(const k of parks){const y=kickerHeight(k,x,z);if(y>h)h=y;}
  return h;
}

export function wrapHeight(height,parks){
  if(!parks?.length)return height;
  return(x,z)=>height(x,z)+parkBump(parks,x,z);
}

export function buildParks(routes,height){
  const kickers=[];
  for(const site of PARK_SITES){
    const corridor=pickCorridor(routes,height,site);if(!corridor)continue;
    const slice=corridor.pts.slice(corridor.hiI,corridor.loI+1);if(slice.length<3)continue;
    let distance=0,cursor=18,index=0,next=site.kickers[0];
    for(let i=1;i<slice.length&&index<site.kickers.length;i++){
      const a=slice[i-1],b=slice[i],seg=Math.hypot(b.x-a.x,b.z-a.z)||1e-6;
      const before=distance;distance+=seg;
      if(before<=cursor&&distance>=cursor){
        const t=(cursor-before)/seg,x=lerp(a.x,b.x,t),z=lerp(a.z,b.z,t);
        const tx=(b.x-a.x)/seg,tz=(b.z-a.z)/seg,spec=site.kickers[index];
        const ox=-tz*site.offset,oz=tx*site.offset;
        kickers.push({
          id:site.id+'-'+index,site:site.name,sector:site.sector,
          x:x+ox,z:z+oz,tx,tz,length:spec.length,height:spec.height,width:spec.width
        });
        index++;next=site.kickers[index];cursor+=spec.length+(next?.gap??50);
      }
    }
  }
  return kickers;
}

export function nearestKicker(parks,x,z,radius=40){
  let best=null;
  for(const k of parks){const d=Math.hypot(x-k.x,z-k.z);if(d<radius&&(!best||d<best.distance))best={...k,distance:d};}
  return best;
}
