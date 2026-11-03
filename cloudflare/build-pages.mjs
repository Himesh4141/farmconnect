import {cp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';
const source=new URL('../client/dist/',import.meta.url),target=new URL('./site/',import.meta.url);
await readFile(new URL('index.html',source));
// Clean only the generated output folder, so an old bundle is never redeployed accidentally.
const output=fileURLToPath(target),expected=path.join(path.dirname(fileURLToPath(import.meta.url)),'site');
if(path.resolve(output)!==path.resolve(expected))throw Error('Unexpected build output directory.');
await mkdir(target,{recursive:true});
for(const entry of await readdir(target))await rm(path.join(output,entry),{recursive:true,force:true});
await cp(source,target,{recursive:true});
await cp(new URL('./pages/_worker.js',import.meta.url),new URL('_worker.js',target));
await writeFile(new URL('_routes.json',target),JSON.stringify({version:1,include:['/api','/api/*'],exclude:[]},null,2));
await cp(new URL('./pages/_headers',import.meta.url),new URL('_headers',target));
console.log('Full Farmconnect web build prepared. Pages serves static files directly; API uses a private Cloudflare binding.');
