import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(root,'preview-dist');
async function emit(name,content){await mkdir(dirname(resolve(output,name)),{recursive:true});await writeFile(resolve(output,name),content);}
let app=await readFile(resolve(root,'js/app.js'),'utf8');
function replaceRequired(from,to){if(!app.includes(from))throw Error('Preview source drift: '+from.slice(0,60));app=app.replace(from,to);}
// Reuse the original static renderer, removing every server-dependent branch.
replaceRequired('  let catalogNotice = "";', '  const catalogNotice = "PersonaVerse Preview 0.1 · 纯静态预设演示，无真实 AI、无登录、无收费。";');
const fetchLine=app.split('\n').find(line=>line.includes("fetch('./api/personas',"));if(!fetchLine)throw Error('Missing catalog initializer');replaceRequired(fetchLine,'');
replaceRequired('    if(initialCatalog){\n      const seq=', '    /*REMOVED_API_START*/if(initialCatalog){\n      const seq=');
const start=app.indexOf('    /*REMOVED_API_START*/');const end=app.indexOf("    const query = state.query",start);if(start<0||end<0)throw Error('Cannot locate catalog API');app=app.slice(0,start)+app.slice(end);
const detailLine=app.split('\n').find(line=>line.includes('if(initialCatalog){try{const response=await ')&&line.includes("fetch('./api/personas/'"));if(!detailLine)throw Error('Missing detail API');replaceRequired(detailLine,'');
app=app.replaceAll('personaverse-favorites','personaverse-preview-v01-favorites').replaceAll('v1.0','Preview 0.1');
app=app.replace('<a href="./admin.html">人格管理</a>','<a href="./index.html?view=favorites">我的收藏</a>');
app=app.replaceAll('https://chat.deepseek.com/','./chat.html?id=moonlight').replaceAll('打开 DeepSeek','打开演示对话').replaceAll('前往 DeepSeek','体验演示对话').replaceAll('将打开 DeepSeek 官方网站','将打开静态演示，不连接真实 AI');
app=app.replaceAll('去 DeepSeek 开启新对话','体验预设脚本对话').replaceAll('将提示词粘贴到一个新对话，发送后即可开始交流。','进入演示聊天页体验界面，回复是固定脚本，不是真实 AI。').replaceAll('在 DeepSeek 新建对话','进入演示聊天').replaceAll('粘贴发送，开始交流','体验预设回复').replaceAll('说说你的想法，让对话自然发生。','仅用于交互展示，不产生 AI 调用。').replaceAll('将打开演示对话 官方网站','打开纯静态脚本演示，无真实 AI').replaceAll('即刻对话','脚本演示');
await emit('js/app.js',app);
for(const name of ['index.html','persona.html']){
 let html=await readFile(resolve(root,name),'utf8');html=html.replace('width=device-width, initial-scale=1','width=device-width, initial-scale=1, viewport-fit=cover').replace(/<title>[^<]*<\/title>/,'<title>PersonaVerse Preview 0.1 · 人格宇宙静态演示</title>');
 html=html.replace('  <link rel="stylesheet" href="./css/style.css">','  <link rel="stylesheet" href="./css/style.css">\n  <link rel="stylesheet" href="./css/preview.css">');
 html=html.replace('<script defer src="./js/http.js"></script>','');
 html=html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'">`);
 await emit(name,html);
}
for(const name of ['css/style.css','css/demo.css','js/personas.js','assets/favicon.svg']){await mkdir(dirname(resolve(output,name)),{recursive:true});await copyFile(resolve(root,name),resolve(output,name));}
for(const name of ['chat.html','chat.js','preview.css'])await emit(name==='chat.js'?'js/chat.js':name==='preview.css'?'css/preview.css':name,await readFile(resolve(root,'preview',name),'utf8'));
await emit('.nojekyll','');
console.log('Built preview-dist/: 3 pages, original 12-persona catalog, local-only assets. No backend/config/environment copied.');
await import('./check-preview.mjs');
// GitHub Pages UI accepts /docs, not arbitrary output folders. Prepare a phone-publishable mirror.
const names=['.nojekyll','index.html','persona.html','chat.html','css/style.css','css/demo.css','css/preview.css','js/personas.js','js/app.js','js/chat.js','assets/favicon.svg'];
for(const name of names){const target=resolve(root,'docs/preview',name);await mkdir(dirname(target),{recursive:true});await copyFile(resolve(output,name),target);}
await writeFile(resolve(root,'docs/.nojekyll'),'');
console.log('Mirrored verified static files to docs/preview/ for optional manual Pages publishing.');
