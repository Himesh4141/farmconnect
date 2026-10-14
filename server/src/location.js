import { createHash } from 'node:crypto';
import { requireSameOrigin } from './auth.js';
import { ApiError } from './pricing.js';
export function geoapifyProvider(key,request=fetch) {
  return async({latitude,longitude})=>{
    const url=new URL('https://api.geoapify.com/v1/geocode/reverse');
    url.search=new URLSearchParams({lat:String(latitude),lon:String(longitude),format:'json',lang:'en',limit:'1',apiKey:key}).toString();
    const response=await request(url,{signal:AbortSignal.timeout(7000),redirect:'error'});
    if(!response.ok)throw Error('Location provider unavailable');
    const data=await response.json(),place=data.results?.[0];
    if(!place)return null;
    return {country:place.country_code,line:place.address_line1??'',city:place.city??place.town??place.village??place.county??'',pincode:place.postcode??''};
  };
}
export function mountLocation(app,db,config,provider) {
  const reverse=provider??(config.geocodingKey?geoapifyProvider(config.geocodingKey):null),windows=new Map();
  app.get('/api/location/config',(_req,res)=>res.json({addressLookup:Boolean(reverse),provider:reverse?'Geoapify':null}));
  app.post('/api/location/reverse',requireSameOrigin,async(req,res)=>{
    const {latitude,longitude}=req.body??{};
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)
      throw new ApiError(400,'INVALID_LOCATION','The device returned an invalid location. Enter your address manually.');
    if(!reverse)throw new ApiError(503,'LOCATION_NOT_CONFIGURED','Automatic address lookup is not connected yet. Enter your address manually.');
    const now=Date.now(),key=createHash('sha256').update(req.ip??'').digest('hex');
    for(const [id,value] of windows)if(value.until<now)windows.delete(id);
    if(windows.size>=10000&&!windows.has(key))throw new ApiError(503,'LOCATION_BUSY','Location lookup is busy. Enter your address manually.');
    const window=windows.get(key)??{until:now+60000,count:0};windows.set(key,window);
    if(++window.count>6){res.set('Retry-After','60');throw new ApiError(429,'LOCATION_RATE_LIMIT','Please wait a minute before detecting your location again.');}
    let place;
    try{place=await reverse({latitude,longitude});}catch{throw new ApiError(503,'LOCATION_UNAVAILABLE','Address lookup is temporarily unavailable. You can still enter your address manually.');}
    if(!place)throw new ApiError(404,'LOCATION_NOT_FOUND','We could not find an address here. Enter your address manually.');
    if(String(place.country).toLowerCase()!=='in')throw new ApiError(422,'LOCATION_OUTSIDE_INDIA','Farmconnect currently supports Indian addresses. Enter an Indian delivery address manually.');
    const text=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
    const address={line:text(place.line,200),city:text(place.city,80),pincode:/^[1-9][0-9]{5}$/.test(String(place.pincode))?String(place.pincode):''};
    // No coordinates are stored or logged. Users review the suggestion before saving it.
    res.json({address,serviceable:Boolean(db.prepare('SELECT 1 FROM delivery_areas WHERE pincode=? AND active=1').get(address.pincode))});
  });
}
