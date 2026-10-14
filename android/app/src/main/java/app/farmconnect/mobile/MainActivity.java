package app.farmconnect.mobile;

import android.app.*;
import android.Manifest;
import android.content.pm.PackageManager;
import android.os.*;
import android.content.*;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.util.Arrays;
import java.util.HashMap;
import java.io.InputStream;
import java.io.IOException;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONObject;
import android.graphics.drawable.GradientDrawable;

/** Hybrid client: all business data and permissions remain authoritative on the server. */
public class MainActivity extends Activity {
  private WebView web;
  private LinearLayout root;
  private volatile int connectionGeneration=0;
  private ProgressBar progress;
  private String origin="",portal="store";
  private ValueCallback<Uri[]> fileCallback;
  private GeolocationPermissions.Callback locationCallback;
  private String locationOrigin;
  private String summaryDownload;
  private static final int GREEN=Color.rgb(33,61,44), PAPER=Color.rgb(246,248,240);
  private boolean failed=false;
  private int dp(int n){return (int)(n*getResources().getDisplayMetrics().density+.5f);}
  @Override public void onCreate(Bundle saved){super.onCreate(saved);getWindow().setStatusBarColor(GREEN);getWindow().setNavigationBarColor(GREEN);origin=BuildConfig.ORIGIN.isEmpty()?getPreferences(0).getString("origin","http://localhost:4000"):BuildConfig.ORIGIN;if(!validOrigin(origin))origin="http://localhost:4000";connect();}
  private boolean validOrigin(String value){
    try {Uri u=Uri.parse(value);if(u.getHost()==null||u.getUserInfo()!=null||u.getQuery()!=null||u.getFragment()!=null||!(u.getPath()==null||u.getPath().isEmpty()))return false;
      if("https".equals(u.getScheme()))return true;
      return BuildConfig.DEBUG&&"http".equals(u.getScheme())&&Arrays.asList("localhost","127.0.0.1","10.0.2.2").contains(u.getHost());
    }catch(Exception e){return false;}
  }
  private TextView label(String text,int size){TextView view=new TextView(this);view.setText(text);view.setTextSize(size);view.setTextColor(GREEN);view.setPadding(0,dp(10),0,dp(10));return view;}
  private Button button(String text,Runnable action){Button b=new Button(this);b.setText(text);b.setAllCaps(false);b.setTextColor(GREEN);b.setMinHeight(dp(48));b.setOnClickListener(v->action.run());return b;}
  private LinearLayout screen(){LinearLayout layout=new LinearLayout(this);layout.setOrientation(1);layout.setPadding(dp(24),dp(30),dp(24),dp(24));layout.setBackgroundColor(PAPER);setContentView(layout);return layout;}
  private GradientDrawable rounded(int color){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(18));return d;}
  private LinearLayout connectionScreen(String title,String message){
    ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.setBackgroundColor(PAPER);setContentView(scroll);
    LinearLayout layout=new LinearLayout(this);layout.setOrientation(1);layout.setPadding(dp(28),dp(40),dp(28),dp(28));scroll.addView(layout);
    ImageView logo=new ImageView(this);logo.setImageResource(getResources().getIdentifier("ic_farmconnect","drawable",getPackageName()));layout.addView(logo,new LinearLayout.LayoutParams(dp(54),dp(54)));
    TextView brand=label("Farmconnect",32);brand.setTypeface(null,1);layout.addView(brand);
    TextView tag=label(BuildConfig.DEBUG?"DEVELOPMENT PREVIEW":"FRESH FROM YOUR GROWERS",11);tag.setLetterSpacing(.16f);layout.addView(tag);
    TextView headline=label(title,26);headline.setTypeface(null,1);headline.setPadding(0,dp(38),0,dp(14));layout.addView(headline);
    layout.addView(label(message,16));return layout;
  }
  private void connect(){
    final int attempt=++connectionGeneration;final String target=origin;
    if(web!=null){finishLocation(false);web.destroy();web=null;}
    LinearLayout layout=connectionScreen("Getting your market ready.","Opening your products, account and orders.");
    TextView wakeNotice=label("",14);layout.addView(wakeNotice);
    ProgressBar spinner=new ProgressBar(this);LinearLayout.LayoutParams spinnerSize=new LinearLayout.LayoutParams(dp(40),dp(40));spinnerSize.topMargin=dp(28);layout.addView(spinner,spinnerSize);
    new Thread(()->{
      final long started=SystemClock.elapsedRealtime(),deadline=started+(target.startsWith("https://")?90000:7000);
      String failure=null;
      do {
      HttpURLConnection connection=null;
      try{
        connection=(HttpURLConnection)new URL(target+"/api/health").openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(7000);connection.setReadTimeout(15000);connection.setRequestProperty("Accept","application/json");
        if(connection.getResponseCode()!=200)throw new IOException("unavailable");
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream input=connection.getInputStream()){byte[] buffer=new byte[1024];int n;while((n=input.read(buffer))!=-1){if(bytes.size()+n>16384)throw new IOException("response");bytes.write(buffer,0,n);}}
        JSONObject health=new JSONObject(bytes.toString("UTF-8"));
        if(!"Farmconnect".equals(health.optString("application"))||health.optInt("apiVersion",0)!=1){failure=BuildConfig.DEBUG?"Apply the complete web + Android update, then restart Farmconnect.":"This version needs an update. Please install the latest Farmconnect app.";break;}
        if(!"connected".equals(health.optString("database")))throw new IOException("not ready");
        failure=null;break;
      }catch(javax.net.ssl.SSLException e){failure="A secure connection could not be established. Please try again later.";break;}
      catch(Exception e){failure=target.startsWith("http://")?"Your phone cannot reach Farmconnect on your computer yet. This preview uses your computer's database; installing the APK alone does not connect it.":"Farmconnect could not reach its hosted service. Check your internet connection or try again shortly.";}
      finally{if(connection!=null)connection.disconnect();}
      if(!target.startsWith("https://")||SystemClock.elapsedRealtime()>=deadline||attempt!=connectionGeneration)break;
      if(SystemClock.elapsedRealtime()-started>10000)runOnUiThread(()->{if(attempt==connectionGeneration)wakeNotice.setText("The market is waking up. The first opening can take about a minute.");});
      try{Thread.sleep(2000);}catch(InterruptedException e){Thread.currentThread().interrupt();return;}
      }while(attempt==connectionGeneration&&!isFinishing()&&!isDestroyed());
      final String result=failure;runOnUiThread(()->{if(attempt!=connectionGeneration||isFinishing()||isDestroyed())return;if(result==null){getPreferences(0).edit().putString("origin",target).apply();openApp();handleReturn(getIntent());}else showConnectionFailure(result);});
    }).start();
  }
  private void showConnectionFailure(String message){
    LinearLayout layout=connectionScreen(BuildConfig.DEBUG?"One connection. Then you're in.":"Your market is temporarily unavailable.",message);
    if(BuildConfig.DEBUG&&origin.startsWith("http://")){
      LinearLayout steps=new LinearLayout(this);steps.setOrientation(1);steps.setPadding(dp(18),dp(10),dp(18),dp(10));steps.setBackground(rounded(Color.rgb(233,240,220)));layout.addView(steps);
      steps.addView(label("1   Open Start Farmconnect.cmd on your computer.",14));steps.addView(label("2   Connect your phone by USB and authorize your own computer.",14));steps.addView(label("3   Open Connect Android.cmd, then tap Try again.",14));
      layout.addView(label("Keep the launcher and USB connection running for this local preview. For independent mobile use, the project needs a hosted HTTPS backend.",13));
    }
    Button retry=button("Try again",()->connect());retry.setTextColor(Color.WHITE);retry.setBackground(rounded(GREEN));layout.addView(retry,new LinearLayout.LayoutParams(-1,dp(54)));
    if(BuildConfig.DEBUG)layout.addView(button("Advanced connection settings",()->showSetup()));
  }
  private void showSetup(){
    LinearLayout layout=connectionScreen("Connection settings","For a published app the service address is built in. This setting is only for development and your own hosted backend.");
    EditText address=new EditText(this);address.setSingleLine(true);address.setInputType(17);address.setHint("https://your-hosted-service");address.setText(origin);layout.addView(address);
    layout.addView(button("Check and connect",()->{String value=address.getText().toString().trim().replaceAll("/+$","");if(!validOrigin(value)){address.setError("Use HTTPS, or localhost for USB testing.");return;}origin=value;connect();}));
    if(BuildConfig.DEBUG)layout.addView(button("Use my computer through USB",()->{origin="http://localhost:4000";connect();}));
  }
  private void openApp(){
    root=new LinearLayout(this);root.setOrientation(1);root.setBackgroundColor(PAPER);setContentView(root);
    progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);progress.setMax(100);root.addView(progress,new LinearLayout.LayoutParams(-1,dp(3)));
    web=new WebView(this);root.addView(web,new LinearLayout.LayoutParams(-1,0,1));web.setBackgroundColor(PAPER);
    WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setGeolocationEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setSupportMultipleWindows(false);settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setMediaPlaybackRequiresUserGesture(true);settings.setUserAgentString(settings.getUserAgentString()+" FarmconnectAndroid/2");settings.setSafeBrowsingEnabled(true);
    CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);WebView.setWebContentsDebuggingEnabled(false);
    web.setWebViewClient(new WebViewClient(){
      @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
        if(!"GET".equals(request.getMethod())||!sameOrigin(request.getUrl()))return null;
        String path=request.getUrl().getPath();
        if(path==null||path.contains("..")||path.contains("\\")||path.startsWith("/api/"))return null;
        boolean document=path.equals("/")||path.equals("/farmer")||path.equals("/delivery");
        if(!document&&!path.startsWith("/assets/")&&!path.startsWith("/produce/")&&!path.equals("/farmconnect.svg"))return null;
        String file=document?"index.html":path.substring(1);
        try {
          InputStream stream=getAssets().open(file);
          String mime=document?"text/html":file.endsWith(".js")?"application/javascript":file.endsWith(".css")?"text/css":file.endsWith(".svg")?"image/svg+xml":file.endsWith(".png")?"image/png":file.endsWith(".webp")?"image/webp":file.endsWith(".jpg")||file.endsWith(".jpeg")?"image/jpeg":"application/octet-stream";
          HashMap<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("X-Content-Type-Options","nosniff");headers.put("Referrer-Policy","no-referrer");headers.put("Permissions-Policy","camera=(), microphone=(), geolocation=(self)");
          headers.put("Content-Security-Policy","default-src 'self'; script-src 'self' https://checkout.razorpay.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://*.razorpay.com; frame-src https://*.razorpay.com; object-src 'none'; base-uri 'self'; form-action 'self'");
          return new WebResourceResponse(mime,"UTF-8",200,"OK",headers,stream);
        }catch(IOException missing){return null;}
      }
      @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){if(!request.isForMainFrame())return false;Uri u=request.getUrl();if("farmconnect".equals(u.getScheme())&&"settings".equals(u.getHost())&&view.getUrl()!=null&&sameOrigin(Uri.parse(view.getUrl()))){showMenu();return true;}if(sameOrigin(u))return false;if("https".equals(u.getScheme())){external(u);return true;}return true;}
      @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error){handler.cancel();showError("The server certificate could not be verified. Check the server's HTTPS setup.");}
      @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())showError("Cannot reach Farmconnect. Check your connection and make sure the server is running.");}
      @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){finishLocation(false);failed=false;Uri page=Uri.parse(url);if(sameOrigin(page)){String p=page.getPath();portal=p!=null&&p.startsWith("/farmer")?"farmer":p!=null&&p.startsWith("/delivery")?"delivery":"store";}progress.setVisibility(View.VISIBLE);}
      @Override public void onPageFinished(WebView view,String url){progress.setVisibility(View.GONE);CookieManager.getInstance().flush();}
    });
    web.setWebChromeClient(new WebChromeClient(){
      @Override public void onProgressChanged(WebView view,int value){progress.setProgress(value);}
      @Override public void onPermissionRequest(PermissionRequest request){request.deny();}
      @Override public void onGeolocationPermissionsShowPrompt(String requested,GeolocationPermissions.Callback callback){
        finishLocation(false);
        if(web.getUrl()==null||!sameOrigin(Uri.parse(requested))||!sameOrigin(Uri.parse(web.getUrl()))){callback.invoke(requested,false,false);return;}
        locationCallback=callback;locationOrigin=requested;
        if(hasLocationPermission())finishLocation(true);
        else requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION,Manifest.permission.ACCESS_FINE_LOCATION},41);
      }
      @Override public void onGeolocationPermissionsHidePrompt(){finishLocation(false);}
      @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){if(fileCallback!=null)fileCallback.onReceiveValue(null);fileCallback=callback;Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT);pick.addCategory(Intent.CATEGORY_OPENABLE);pick.setType("image/*");try{startActivityForResult(pick,40);}catch(ActivityNotFoundException e){fileCallback.onReceiveValue(null);fileCallback=null;}return true;}
    });
    web.setDownloadListener((url,userAgent,disposition,mime,length)->{
      Uri target=Uri.parse(url);
      if(!sameOrigin(target)||target.getPath()==null||!target.getPath().matches("/api/orders/[a-zA-Z0-9-]{1,80}/summary")){Toast.makeText(this,"Only your Farmconnect order summaries can be saved here.",Toast.LENGTH_LONG).show();return;}
      if(summaryDownload!=null)return;summaryDownload=url;
      Intent save=new Intent(Intent.ACTION_CREATE_DOCUMENT);save.addCategory(Intent.CATEGORY_OPENABLE);save.setType("text/plain");save.putExtra(Intent.EXTRA_TITLE,"Farmconnect-order-"+target.getPath().split("/")[3]+".txt");
      try{startActivityForResult(save,42);}catch(ActivityNotFoundException e){summaryDownload=null;Toast.makeText(this,"A file manager is needed to save this summary.",Toast.LENGTH_LONG).show();}
    });
    web.loadUrl(origin+(portal.equals("store")?"/":"/"+portal));
  }
  private boolean hasLocationPermission(){return checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED||checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED;}
  private void finishLocation(boolean allowed){
    if(locationCallback==null)return;
    GeolocationPermissions.Callback callback=locationCallback;String requested=locationOrigin;locationCallback=null;locationOrigin=null;
    boolean own=web!=null&&web.getUrl()!=null&&sameOrigin(Uri.parse(requested))&&sameOrigin(Uri.parse(web.getUrl()));
    callback.invoke(requested,allowed&&own&&hasLocationPermission(),false);
  }
  @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==41)finishLocation(hasLocationPermission());}
  private boolean sameOrigin(Uri u){Uri allowed=Uri.parse(origin);return allowed.getScheme().equals(u.getScheme())&&allowed.getHost().equalsIgnoreCase(u.getHost()==null?"":u.getHost())&&allowed.getPort()==u.getPort()&&u.getUserInfo()==null;}
  private void external(Uri u){try{startActivity(new Intent(Intent.ACTION_VIEW,u));}catch(ActivityNotFoundException e){Toast.makeText(this,"Install a browser to open this link.",Toast.LENGTH_LONG).show();}}
  private void showMenu(){String[] items=BuildConfig.DEBUG?new String[]{"Refresh","Check connection","Open in browser","Change test server","Clear app sign-ins"}:new String[]{"Refresh","Check connection","Open in browser","Clear app sign-ins"};new AlertDialog.Builder(this).setTitle("Farmconnect").setItems(items,(d,index)->{String selected=items[index];if(selected.equals("Refresh"))web.reload();else if(selected.equals("Check connection"))connect();else if(selected.equals("Open in browser"))external(Uri.parse(origin+(portal.equals("store")?"/":"/"+portal)));else if(selected.equals("Change test server")){finishLocation(false);web.destroy();web=null;showSetup();}else new AlertDialog.Builder(this).setMessage("Sign out all accounts stored on this app? Your orders and listings stay on the server.").setNegativeButton("Keep signed in",null).setPositiveButton("Clear sign-ins",(dialog,which)->{CookieManager.getInstance().removeAllCookies(value->{CookieManager.getInstance().flush();web.clearCache(true);WebStorage.getInstance().deleteAllData();web.loadUrl(origin+"/");});}).show();}).show();}
  private void showError(String message){if(failed)return;failed=true;progress.setVisibility(View.GONE);new AlertDialog.Builder(this).setTitle("Let’s reconnect").setMessage(message).setCancelable(false).setPositiveButton("Try again",(d,w)->connect()).setNegativeButton(BuildConfig.DEBUG?"Connection settings":"Close",(d,w)->{if(BuildConfig.DEBUG){finishLocation(false);web.destroy();web=null;showSetup();}else finish();}).show();}
  @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);handleReturn(intent);}
  private void handleReturn(Intent intent){Uri u=intent.getData();if(u==null||!"farmconnect".equals(u.getScheme())||!"oauth".equals(u.getHost())||web==null)return;String ticket=u.getQueryParameter("ticket"),role=u.getQueryParameter("portal");if(ticket==null||!ticket.matches("[A-Za-z0-9_-]{43}")||!Arrays.asList("store","farmer","delivery").contains(role))return;portal=role;intent.setData(null);web.loadUrl(origin+(portal.equals("store")?"/":"/"+portal)+"?oauth_ticket="+Uri.encode(ticket));}
  private void saveSummary(String source,Uri destination){
    if(source==null||destination==null||!"content".equals(destination.getScheme())||!sameOrigin(Uri.parse(source)))return;
    String cookie=CookieManager.getInstance().getCookie(source);
    new Thread(()->{
      HttpURLConnection connection=null;
      try{
        connection=(HttpURLConnection)new URL(source).openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(10000);connection.setReadTimeout(10000);connection.setRequestProperty("Accept","text/plain");if(cookie!=null)connection.setRequestProperty("Cookie",cookie);
        if(connection.getResponseCode()!=200||connection.getContentType()==null||!connection.getContentType().startsWith("text/plain"))throw new IOException("Summary unavailable");
        ByteArrayOutputStream data=new ByteArrayOutputStream();try(InputStream input=connection.getInputStream()){byte[] buffer=new byte[4096];int count;while((count=input.read(buffer))!=-1){if(data.size()+count>262144)throw new IOException("Summary too large");data.write(buffer,0,count);}}
        try(OutputStream output=getContentResolver().openOutputStream(destination,"w")){if(output==null)throw new IOException("File unavailable");output.write(data.toByteArray());}
        runOnUiThread(()->Toast.makeText(this,"Order summary saved.",Toast.LENGTH_LONG).show());
      }catch(Exception failure){runOnUiThread(()->Toast.makeText(this,"Could not save the summary. Check your connection and sign in again if needed.",Toast.LENGTH_LONG).show());}
      finally{if(connection!=null)connection.disconnect();}
    }).start();
  }
  @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==42){String source=summaryDownload;summaryDownload=null;if(result==RESULT_OK&&data!=null)saveSummary(source,data.getData());return;}if(request==40&&fileCallback!=null){Uri picked=data==null?null:data.getData();String mime=picked==null?null:getContentResolver().getType(picked);fileCallback.onReceiveValue(result==RESULT_OK&&picked!=null&&"content".equals(picked.getScheme())&&mime!=null&&mime.startsWith("image/")?new Uri[]{picked}:null);fileCallback=null;}}
  @Override public void onBackPressed(){if(web!=null&&web.canGoBack())web.goBack();else super.onBackPressed();}
  @Override protected void onDestroy(){finishLocation(false);if(fileCallback!=null)fileCallback.onReceiveValue(null);if(web!=null)web.destroy();connectionGeneration++;super.onDestroy();}
}
