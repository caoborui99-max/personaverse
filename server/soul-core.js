import { ApiError, json, readJson } from './security.js';
const prefix='/api/admin/soul-core';
export async function handleSoulCore(request,db,user) {
  const url=new URL(request.url),path=url.pathname.replace(/\/$/,'');
  if(path!==prefix&&!path.startsWith(prefix+'/'))return null;
  if(user?.role!=='admin')throw new ApiError(401,'ADMIN_REQUIRED','仅管理员可管理共享核心。');
  if(path===prefix&&request.method==='GET') {
    const before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);
    if(!Number.isSafeInteger(before)||before<1)throw new ApiError(400,'INVALID_QUERY','版本分页参数无效。');
    const core=await db.prepare("SELECT id,draft_content,revision,active_version_id,updated_at FROM soul_core WHERE id='shared'").first();
    if(!core)throw new ApiError(503,'MIGRATION_REQUIRED','请先执行数据库迁移。');
    const versions=(await db.prepare('SELECT id,revision,content,created_by,created_at FROM soul_core_versions WHERE revision<? ORDER BY revision DESC LIMIT 20').bind(before).all()).results;
    return json({core,versions,nextBefore:versions.length===20?Number(versions.at(-1).revision):null});
  }
  if(request.method!=='POST'||![prefix+'/draft',prefix+'/publish',prefix+'/rollback'].includes(path))throw new ApiError(404,'API_NOT_FOUND','接口不存在。');
  const body=await readJson(request),action=path.split('/').at(-1);
  const allowed=action==='draft'?['revision','content']:action==='rollback'?['revision','versionId']:['revision'];
  if(Object.keys(body).some(k=>!allowed.includes(k))||!Number.isSafeInteger(body.revision)||body.revision<0)throw new ApiError(400,'INVALID_CORE','请提供有效版本号，不允许修改核心身份。');
  if(action==='draft'&&(typeof body.content!=='string'||body.content.length>20000))throw new ApiError(400,'INVALID_CORE','核心草稿最多20000字符，允许留空。');
  if(action==='rollback'&&(typeof body.versionId!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(body.versionId)))throw new ApiError(400,'INVALID_CORE','请选择有效历史版本。');
  const current=await db.prepare("SELECT draft_content,revision FROM soul_core WHERE id='shared'").first();
  if(!current)throw new ApiError(503,'MIGRATION_REQUIRED','请先执行数据库迁移。');
  if(Number(current.revision)!==body.revision)throw new ApiError(409,'CORE_CONFLICT','核心已更新，请重新载入后操作。');
  if(action==='publish'&&!current.draft_content.trim())throw new ApiError(400,'CORE_EMPTY','空白核心不能发布；请由管理员自行填写。');
  if(action==='rollback'&&!await db.prepare('SELECT id FROM soul_core_versions WHERE id=?').bind(body.versionId).first())throw new ApiError(404,'VERSION_NOT_FOUND','历史版本不存在。');
  const operation=crypto.randomUUID(),now=new Date().toISOString(),next=body.revision+1;
  let update;
  if(action==='draft')update=db.prepare("UPDATE soul_core SET draft_content=?,revision=revision+1,last_operation=?,updated_at=? WHERE id='shared' AND revision=? RETURNING revision").bind(body.content,operation,now,body.revision);
  else update=db.prepare("UPDATE soul_core SET active_version_id=?,revision=revision+1,last_operation=?,updated_at=? WHERE id='shared' AND revision=? RETURNING revision").bind(action==='publish'?operation:body.versionId,operation,now,body.revision);
  const statements=[update];
  if(action==='publish') statements.push(db.prepare("INSERT INTO soul_core_versions(id,core_id,revision,content,created_by,created_at) SELECT ?,'shared',revision,draft_content,?,? FROM soul_core WHERE id='shared' AND last_operation=?").bind(operation,user.email,now,operation));
  // The root is claimed first with optimistic concurrency; inserts only occur for the winner.
  // Its deferred FK is checked at transaction commit after the immutable version is inserted.
  statements.push(db.prepare("INSERT INTO soul_core_events(id,action,actor,revision,version_id,created_at) SELECT ?,?,?,revision,active_version_id,? FROM soul_core WHERE id='shared' AND last_operation=?").bind(operation,action,user.email,now,operation));
  const results=await db.batch(statements);
  if(!results[0].results.length)throw new ApiError(409,'CORE_CONFLICT','核心已更新，请重新载入后操作。');
  return json({ok:true,revision:next,activeVersionId:action==='draft'?undefined:action==='publish'?operation:body.versionId});
}
