import { existsSync } from 'node:fs';
import { join } from 'node:path';
export function healthProblem(value){
 if(value?.application!=='Farmconnect'||value?.apiVersion!==1)return 'An older or different backend is using port 4000. Stop it, apply the full update, then run Start Farmconnect again.';
 if(value.status!=='ok'||value.database!=='connected')return 'Farmconnect responded, but its database is not ready. Check the server terminal.';
 return null;
}
export function parseDevices(output){return output.split(/\r?\n/).map(line=>line.trim().split(/\s+/)).filter(parts=>parts.length>=2&&['device','unauthorized','offline'].includes(parts[1])).map(parts=>({id:parts[0],state:parts[1]}));}
export function findAdb(env=process.env,exists=existsSync){
 const roots=[env.ANDROID_SDK_ROOT,env.ANDROID_HOME,env.LOCALAPPDATA?join(env.LOCALAPPDATA,'Android','Sdk'):null].filter(Boolean);
 return roots.map(root=>join(root,'platform-tools',process.platform==='win32'?'adb.exe':'adb')).find(exists)??null;
}
