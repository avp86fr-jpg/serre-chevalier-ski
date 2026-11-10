// Live conditions for Serre Chevalier Vallée. Open-Meteo is used because it
// needs no API key and may be redistributed with attribution.
export const WEATHER_STATION={latitude:44.946,longitude:6.555,place:'Villeneuve, Serre Chevalier'};
export const WEATHER_REFRESH_MS=15*60*1000;
export const WEATHER_CACHE_KEY='alpine-live-weather';
export const WEATHER_URL='https://api.open-meteo.com/v1/forecast?latitude=44.946&longitude=6.555&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m,snowfall,precipitation,is_day,visibility&timezone=Europe%2FParis';

const SNOW_CODES=new Set([71,73,75,77,85,86]);
const PRECIP_CODES=new Set([51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99]);
const FOG_CODES=new Set([45,48]);

export function interpretWeather(current,fetchedAt=Date.now()){
  const code=Number(current?.weather_code),cloud=Number(current?.cloud_cover),wind=Number(current?.wind_speed_10m);
  const snowfall=Number(current?.snowfall),precip=Number(current?.precipitation),isDay=Number(current?.is_day)===1;
  const visibility=Number(current?.visibility),temp=Number(current?.temperature_2m);
  const hour=(()=>{try{const part=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(fetchedAt)).find(p=>p.type==='hour');const n=Number(part?.value);return Number.isFinite(n)?n:new Date(fetchedAt).getHours();}catch{return new Date(fetchedAt).getHours();}})();
  const snowing=SNOW_CODES.has(code)||snowfall>0||(PRECIP_CODES.has(code)&&Number.isFinite(temp)&&temp<=1);
  const fog=FOG_CODES.has(code)||(Number.isFinite(visibility)&&visibility>0&&visibility<800);
  const golden=!snowing&&isDay&&(hour<=9||hour>=16)&&cloud<70;
  const preset=snowing?'snow':golden?'golden':(fog||cloud>=72)?'overcast':'clear';
  const label=snowing?(Number.isFinite(temp)?`Snowfall · ${Math.round(temp)}°`:'Snowfall')
    :fog?'Valley fog'
    :golden?(Number.isFinite(temp)?`Golden hour · ${Math.round(temp)}°`:'Golden hour')
    :cloud>=72?(Number.isFinite(temp)?`Overcast · ${Math.round(temp)}°`:'Overcast')
    :Number.isFinite(temp)?`Bluebird · ${Math.round(temp)}°`:'Bluebird day';
  const icon=snowing?'❄':fog?'🌫':golden?'☀':cloud>=72?'☁':'☀';
  return {
    preset,label,icon,code:Number.isFinite(code)?code:null,
    temperature:Number.isFinite(temp)?temp:null,
    cloud:Number.isFinite(cloud)?cloud:null,
    wind:Number.isFinite(wind)?wind:null,
    snowfall:Number.isFinite(snowfall)?snowfall:null,
    visibility:Number.isFinite(visibility)?visibility:null,
    isDay,hour,fetchedAt
  };
}

export function readWeatherCache(storage){
  try{
    const raw=storage?.getItem?.(WEATHER_CACHE_KEY);if(!raw)return null;
    const value=JSON.parse(raw);
    if(!value||typeof value!=='object'||!value.current)return null;
    return value;
  }catch{return null;}
}

export function writeWeatherCache(storage,payload){
  try{storage?.setItem?.(WEATHER_CACHE_KEY,JSON.stringify(payload));}catch{}
}

export async function fetchLiveWeather({fetchImpl=globalThis.fetch,storage=null,now=Date.now(),timeoutMs=8000}={}){
  if(typeof fetchImpl!=='function'){
    const cached=readWeatherCache(storage);
    return fallback(cached,now,'cache');
  }
  const ac=typeof AbortController==='function'?new AbortController():null;
  const timer=ac?setTimeout(()=>ac.abort(),timeoutMs):null;
  try{
    const response=await fetchImpl(WEATHER_URL,{signal:ac?.signal,headers:{Accept:'application/json'}});
    if(!response?.ok)throw Error('Weather request failed');
    const body=await response.json();
    if(!body?.current)throw Error('Weather payload missing current conditions');
    const fetchedAt=now;
    const interpreted=interpretWeather(body.current,fetchedAt);
    const payload={current:body.current,fetchedAt,source:'live',interpreted};
    writeWeatherCache(storage,payload);
    return {...interpreted,source:'live',stale:false};
  }catch(error){
    const cached=readWeatherCache(storage);
    return fallback(cached,now,'cache',error);
  }finally{if(timer)clearTimeout(timer);}
}

function fallback(cached,now,source,error){
  if(cached?.current){
    const interpreted=interpretWeather(cached.current,cached.fetchedAt||now);
    return {...interpreted,source,stale:true,fetchedAt:cached.fetchedAt||now,error:error?.message||''};
  }
  return {...interpretWeather({weather_code:0,cloud_cover:30,is_day:1,temperature_2m:null},now),source:'default',stale:true,fetchedAt:null,error:error?.message||'No cached weather'};
}

export function startWeatherRefresh(apply,{fetchImpl,storage,interval=WEATHER_REFRESH_MS,now=()=>Date.now()}={}){
  let stopped=false,timer=null;
  const tick=async()=>{
    if(stopped)return;
    const reading=await fetchLiveWeather({fetchImpl,storage,now:now()});
    if(!stopped)apply(reading);
  };
  // Always request a live observation now; the cache is only used if this fetch fails.
  const first=tick();
  if(interval>0)timer=setInterval(tick,interval);
  return {promise:first,stop(){stopped=true;if(timer)clearInterval(timer);}};
}
