const securityHeaders={
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Referrer-Policy':'strict-origin-when-cross-origin',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=(self)',
  'Strict-Transport-Security':'max-age=31536000',
  'Content-Security-Policy':"default-src 'self'; script-src 'self' https://checkout.razorpay.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://*.razorpay.com; frame-src https://*.razorpay.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
};
export default {
  async fetch(request,env) {
    const path=new URL(request.url).pathname;
    if(path==='/api'||path.startsWith('/api/')) {
      if(!env.API)return Response.json({error:{code:'SERVICE_UNAVAILABLE',message:'Farmconnect is temporarily unavailable. Please try again.'}},{status:503,headers:{'Cache-Control':'no-store'}});
      const headers=new Headers(request.headers);
      headers.delete('x-forwarded-host');
      headers.delete('x-forwarded-for');
      const clientIp=request.headers.get('cf-connecting-ip');
      if(clientIp)headers.set('x-forwarded-for',clientIp);
      try {
        const result=await env.API.fetch(new Request(request,{headers}));
        const response=new Response(result.body,result);
        response.headers.set('Cache-Control','no-store');
        return response;
      } catch {
        return Response.json({error:{code:'SERVICE_UNAVAILABLE',message:'Farmconnect could not complete this request. Check your orders before retrying a purchase.'}},{status:503,headers:{'Cache-Control':'no-store'}});
      }
    }
    const asset=await env.ASSETS.fetch(request);
    const response=new Response(asset.body,asset);
    for(const [name,value] of Object.entries(securityHeaders))response.headers.set(name,value);
    response.headers.set('Cache-Control',path.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache');
    return response;
  }
};
