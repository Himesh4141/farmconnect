// Local development launcher. It never binds the database to a public/LAN address.
import { spawn,execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { healthProblem,parseDevices,findAdb } from './launcher-utils.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),serverDir=join(root,'server'),clientDir=join(root,'client');
const base='http://localhost:4000';let backend=null;
function runNpm(args,cwd){return new Promise((resolve,reject)=>{const child=spawn(process.platform==='win32'?'cmd.exe':'npm',process.platform==='win32'?['/d','/c','npm.cmd',...args]:args,{cwd,stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Dependency installation or build failed. Read the error above; no existing process was stopped.')));});}
async function health(){try{const response=await fetch(base+'/api/health',{signal:AbortSignal.timeout(1800),redirect:'error'});if(!response.ok)return {invalid:'Port 4000 is responding with an error. Check the existing server before restarting.'};try{return {value:await response.json()};}catch{return {invalid:'Port 4000 is not serving the Farmconnect API. Stop the other application or its old server first.'};}}catch{return null;}}
function connectPhone(install=false){
 const adb=findAdb();if(!adb)throw Error('Android Platform Tools was not found. Install it through Android Studio, or set ANDROID_SDK_ROOT to your Android SDK folder. The web app still works without a phone.');
 const command=(args)=>execFileSync(adb,args,{encoding:'utf8',windowsHide:true,timeout:45000});
 let devices;try{devices=parseDevices(command(['devices']));}catch{throw Error('Android connection tools could not start. Close conflicting Android tools, reconnect USB, and run Connect Android again.');}
 if(devices.some(d=>d.state==='unauthorized'))throw Error('Unlock your phone and approve USB debugging for your own computer, then run Connect Android again.');
 const ready=devices.filter(d=>d.state==='device');
 if(ready.length!==1)throw Error(ready.length?'More than one Android device is connected. Leave only the intended test phone connected, then retry.':'No authorized phone found. Connect USB, enable USB debugging, and approve your computer on the phone.');
 command(['-s',ready[0].id,'reverse','tcp:4000','tcp:4000']);
 const mapping=command(['-s',ready[0].id,'reverse','--list']);if(!mapping.includes('tcp:4000 tcp:4000'))throw Error('USB forwarding was not confirmed. Reconnect the cable and retry.');
 if(install){const apk=join(root,'android','Farmconnect-preview.apk');if(!existsSync(apk))throw Error('The APK is missing from android/Farmconnect-preview.apk.');command(['-s',ready[0].id,'install','-r',apk]);}
 console.log('\nPhone connected. Open Farmconnect on your phone. No server address needs to be entered.');
 console.log('Keep this computer, the Farmconnect terminal and USB connected while testing.');
}
async function main(){
 if(Number(process.versions.node.split('.')[0])<24)throw Error('Install Node.js 24 or later, then reopen this launcher.');
 const phoneOnly=process.argv.includes('--phone'),install=process.argv.includes('--install');
 let status=await health();if(status?.invalid)throw Error(status.invalid);if(status?.value){const issue=healthProblem(status.value);if(issue)throw Error(issue);}
 if(phoneOnly){if(!status)throw Error('First open Start Farmconnect.cmd and leave it running. Then run Connect Android.cmd again.');connectPhone(install);return;}
 console.log('\nFarmconnect • Web + Android development\n');
 if(!existsSync(join(serverDir,'node_modules','express')))await runNpm(['ci'],serverDir);
 if(!existsSync(join(clientDir,'node_modules','vite')))await runNpm(['ci'],clientDir);
 console.log('Building the latest website…');await runNpm(['run','build'],clientDir);
 if(status){console.log('\nThe Farmconnect backend is already running. Website build updated. If you replaced backend files, restart that existing terminal first.');}
 else{
  backend=spawn(process.execPath,['--env-file-if-exists=.env','src/index.js'],{cwd:serverDir,stdio:'inherit',windowsHide:true,env:{...process.env,NODE_ENV:'development',HOST:'127.0.0.1',PORT:'4000',APP_ORIGIN:base,COURIER_MODE:'demo'}});
  let failed=false;backend.once('error',()=>{failed=true;});backend.once('exit',()=>{failed=true;});
  for(let n=0;n<30;n++){if(failed)throw Error('Farmconnect did not start. Read the backend error above.');status=await health();if(status)break;await new Promise(resolve=>setTimeout(resolve,300));}
  if(!status||status.invalid)throw Error(status?.invalid??'The backend did not become ready. Read the error above.');const issue=healthProblem(status.value);if(issue)throw Error(issue);
 }
 console.log('\nReady: open '+base+' in your browser.\nFor Android, connect USB and open Connect Android.cmd.\nLocal demo only; no real courier booking or payment collection.');
 if(backend){console.log('Keep this window open. Press Ctrl+C to stop your local server.');await new Promise(resolve=>backend.once('exit',resolve));}
}
process.on('SIGINT',()=>{if(backend)backend.kill('SIGINT');else process.exit();});
main().catch(error=>{console.error('\n'+error.message);if(backend)backend.kill('SIGINT');process.exitCode=1;});
