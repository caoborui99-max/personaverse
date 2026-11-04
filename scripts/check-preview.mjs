import {readFile,readdir,lstat} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {spawn} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../preview-dist');
const expected=['.nojekyll','index.html','persona.html','chat.html','css/style.css','css/demo.css','css/preview.css','js/personas.js','js/app.js','js/chat.js','assets/favicon.svg'].sort();
const found=[];async function walk(dir){for(const name of await readdir(dir)){const path=resolve(dir,name);const s=await lstat(path);if(s.isSymbolicLink())throw Error('Symlink in preview');if(s.isDirectory())await walk(path);else found.push(relative(root,path));}}await walk(root);
if(JSON.stringify(found.sort())!==JSON.stringify(expected))throw Error('Unexpected/missing output file. No configuration, environment, server or admin files are permitted.');
for(const name of found){const text=await readFile(resolve(root,name),'utf8');if(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|AI_API_KEY|ADMIN_PASSWORD|DATABASE_URL|\/api\/|admin\.html|https?:\/\//.test(text)&&name!=='assets/favicon.svg')throw Error('Network/server reference in '+name);
 if(name.endsWith('.js')){await new Promise((ok,fail)=>{const child=spawn(process.execPath,['--check',resolve(root,name)],{stdio:'inherit',timeout:30000});child.once('error',fail);child.once('exit',(code,signal)=>code===0?ok():fail(Error('Syntax check failed: '+name+' ('+(signal||code)+')')));});}
 if(name.endsWith('.html'))for(const m of text.matchAll(/(?:src|href)="([^"]+)"/g)){const ref=m[1];if(ref.startsWith('#'))continue;if(!ref.startsWith('./'))throw Error('Non-relative link '+ref);const path=ref.split(/[?#]/)[0];if(!expected.includes(path.slice(2)))throw Error('Missing target '+ref);}
}
const context={window:{}};runInNewContext(await readFile(resolve(root,'js/personas.js'),'utf8'),context,{timeout:1000});const personas=context.window.PERSONAS;
if(!Array.isArray(personas)||personas.length<12||personas.length>20||new Set(personas.map(p=>p.id)).size!==personas.length)throw Error('Invalid persona catalog');
if(!personas.every(p=>p.name&&p.description&&p.prompt&&Array.isArray(p.starters)&&p.starters.length))throw Error('Incomplete persona');
console.log('PASS: exact static allowlist, relative page/assets, no network/API/secret/admin references, JS syntax, '+personas.length+' complete personas.');

if(process.argv.includes('--mirror'))for(const name of expected){if(!Buffer.from(await readFile(resolve(root,name))).equals(await readFile(resolve(root,'../docs/preview',name))))throw Error('Mirror mismatch: '+name);} 
