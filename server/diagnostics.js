// Never log error objects, messages, request bodies, URLs, headers or environment values.
const codes=new Set(['ERR_SQLITE_ERROR','SQLITE_READONLY','SQLITE_CANTOPEN','SQLITE_BUSY','SQLITE_LOCKED','SQLITE_CORRUPT','EACCES','EPERM','EROFS','ENOENT','ECONNREFUSED','ERR_INVALID_URL','ERR_STREAM_PREMATURE_CLOSE','28P01','42P01','23502','23505']);
const sqlite=new Map([[5,'SQLITE_BUSY'],[6,'SQLITE_LOCKED'],[8,'SQLITE_READONLY'],[11,'SQLITE_CORRUPT'],[14,'SQLITE_CANTOPEN'],[19,'SQLITE_CONSTRAINT']]);
export function reportApiFailure(error,request){
 let path='/api/';try{path=new URL(request?.url||'/', 'http://internal.invalid').pathname;}catch{}
 const operation=path==='/api/auth/login'?'admin_login':path==='/api/auth/logout'?'admin_logout':path==='/api/session'?'session':path.startsWith('/api/admin/')?'admin_api':'api';
 const requestId=crypto.randomUUID();
 const code=error?.code==='ERR_SQLITE_ERROR'&&Number.isInteger(error.errcode)?sqlite.get(error.errcode&255)||'ERR_SQLITE_ERROR':codes.has(error?.code)?error.code:'UNCLASSIFIED';
 console.error('PersonaVerse API failure',{requestId,operation,code});
 return requestId;
}
