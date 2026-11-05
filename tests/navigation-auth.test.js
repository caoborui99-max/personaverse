import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source=await readFile(new URL('../js/http.js',import.meta.url),'utf8');
function client(base,fetcher) {
 const context={URL,AbortSignal,document:{baseURI:base},location:{origin:new URL(base).origin},window:{fetch:fetcher}};
 runInNewContext(source,context,{timeout:1000});return context.window.PersonaVerseHTTP;
}
test('frontend API base is consistent at root and subpath; cookies stay same-origin and redirects are not followed',async()=>{
 for(const base of ['https://site.example/admin.html','https://site.example/personaverse/admin.html']){
   let n=0,captured;
   const api=client(base,async(url,options)=>{n++;captured={url,options};return Response.json({ok:true});});
   await api.fetch('./api/session',{credentials:'include',redirect:'follow'});
   assert.equal(captured.url,new URL('./api/session',base).href);
   assert.equal(captured.options.credentials,'same-origin');assert.equal(captured.options.mode,'same-origin');assert.equal(captured.options.redirect,'error');assert.equal(n,1);
   await assert.rejects(()=>api.fetch('https://other.example/api/session'),/同源/);assert.equal(n,1);
 }
});
test('HTML authentication pages, redirects, CORS/network failures stop once without navigation/retry or echoing HTML',async()=>{
 const fixtures=[
   async()=>new Response('<html>private upstream detail</html>',{headers:{'Content-Type':'text/html'}}),
   async()=>({redirected:true,headers:new Headers({'Content-Type':'application/json'})}),
   async()=>{throw Error('private redirect details');}
 ];
 for(const fetcher of fixtures){let calls=0;const api=client('https://site.example/chat.html',async(...args)=>{calls++;return fetcher(...args);});
   await assert.rejects(()=>api.fetch('./api/session'),e=>!e.message.includes('private'));assert.equal(calls,1);
 }
});
test('application authentication JSON is left to the existing caller; helper never substitutes or clears cookies',async()=>{
 const response=Response.json({error:{code:'ADMIN_REQUIRED',message:'login required'}},{status:401});
 const api=client('https://site.example/admin.html',async()=>response);
 assert.equal((await api.fetch('./api/admin/personas')).status,401);
 assert.equal(/document\.cookie|location\.(assign|replace)\s*\(|setInterval|CF_Authorization/.test(source),false);
});
test('active pages load the request helper before their scripts; admin fetch paths match frontend relative paths',async()=>{
 for(const page of ['index.html','persona.html','chat.html','admin.html']){
   const html=await readFile(new URL('../'+page,import.meta.url),'utf8');
   const scripts=[...html.matchAll(/<script defer src="([^"]+)"/g)].map(x=>x[1]);
   assert.equal(scripts[0],'./js/http.js');
   for(const script of scripts)await access(new URL('../'+script,import.meta.url));
 }
 for(const name of ['admin.js','soul-admin.js','demo.js','app.js']){
   const js=await readFile(new URL('../js/'+name,import.meta.url),'utf8');
   assert.equal(/fetch\(['"]\/api\//.test(js),false);
   assert.equal(/location\.(assign|replace)\s*\(|http-equiv=['"]refresh/.test(js),false);
 }
});
