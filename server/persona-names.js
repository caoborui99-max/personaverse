import {createHash,randomUUID} from 'node:crypto';
import manifest from './persona-name-manifest.json' with {type:'json'};
import {ApiError} from './security.js';
export {manifest as personaNames};
function canonical(x){if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));return x;}
export const profileHash=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
function target(data,entry){return {...data,name:entry.newName,systemPrompt:entry.rules.reduce((text,[from,to])=>text.replaceAll(from,to),data.systemPrompt)};}
function eligible(row,entry){return row&&row.status==='published'&&Number(row.sort_order)===entry.index;}
function planItem(entry){return {id:entry.id,fromName:entry.oldName,toName:entry.newName,beforeHash:entry.oldHash,afterHash:entry.newHash,changes:['name','systemPrompt']};}
export async function planPersonaNames(db){
 const items=[],skipped=[];
 for(const entry of manifest){
  const row=await db.prepare('SELECT data,status,sort_order FROM personas WHERE id=?').bind(entry.id).first();
  if(!row){skipped.push({id:entry.id,reason:'missing'});continue;}
  const hash=profileHash(JSON.parse(row.data));
  if(hash===entry.newHash){skipped.push({id:entry.id,reason:'already-current'});continue;}
  if(!eligible(row,entry)||hash!==entry.oldHash){skipped.push({id:entry.id,reason:'customized-or-nonpublished-review-manually'});continue;}
  items.push(planItem(entry));
 }
 return {kind:'persona-names-v1',items,skipped};
}
export async function applyPersonaNames(db,plan){
 if(plan?.kind!=='persona-names-v1'||!Array.isArray(plan.items)||plan.items.length>12)throw new ApiError(400,'INVALID_NAME_PLAN','名称计划格式无效。');
 const seen=new Set(),changes=[];
 for(const item of plan.items){
  const entry=manifest.find(x=>x.id===item.id);
  if(!entry||seen.has(item.id)||profileHash(item)!==profileHash(planItem(entry)))throw new ApiError(400,'INVALID_NAME_PLAN','名称计划与审核规则不一致。');seen.add(item.id);
  const row=await db.prepare('SELECT data,status,sort_order FROM personas WHERE id=?').bind(entry.id).first();
  if(!eligible(row,entry))throw new ApiError(409,'NAME_PLAN_STALE','资料已变化，请重新预览名称计划。');
  const data=JSON.parse(row.data),hash=profileHash(data);
  if(hash===entry.newHash)continue;
  if(hash!==entry.oldHash)throw new ApiError(409,'NAME_PLAN_STALE','资料已变化，请重新预览名称计划。');
  const after=target(data,entry);
  if(profileHash(after)!==entry.newHash)throw new ApiError(409,'NAME_PLAN_STALE','目标资料校验失败。');
  changes.push({entry,row,after,json:JSON.stringify(after)});
 }
 if(!changes.length)return {applied:[],alreadyApplied:true};
 const statements=[],checks=[],params=[];
 for(const {entry,row,after,json} of changes){
  statements.push(db.prepare('UPDATE personas SET data=? WHERE id=? AND data=? AND status=? AND sort_order=?').bind(json,entry.id,row.data,row.status,row.sort_order));
  statements.push(db.prepare('UPDATE persona_catalog SET name=?,search_text=? WHERE id=? AND EXISTS(SELECT 1 FROM personas WHERE id=? AND data=?)').bind(after.name,[after.name,after.englishName,after.description,after.tagline,...after.tags].join(' ').toLowerCase(),entry.id,entry.id,json));
  checks.push('EXISTS(SELECT 1 FROM personas p JOIN persona_catalog c ON c.id=p.id WHERE p.id=? AND p.data=? AND p.status=? AND p.sort_order=? AND c.name=?)');params.push(entry.id,json,row.status,row.sort_order,after.name);
 }
 const audit={kind:plan.kind,applied:changes.map(c=>c.entry.id),time:new Date().toISOString()};
 // A stale concurrent edit makes value NULL, violating settings.NOT NULL and rolling back the entire batch.
 statements.push(db.prepare('INSERT INTO settings(key,value) SELECT ?,CASE WHEN '+checks.join(' AND ')+' THEN ? ELSE NULL END').bind('persona_names_v1:'+randomUUID(),...params,JSON.stringify(audit)));
 // Bind order follows SQL placeholders: key, checks, audit.
 await db.batch(statements);
 return {applied:audit.applied,alreadyApplied:false};
}
