import {ApiError} from './security.js';
export function configuredOrigin(env) {
 if(!env.APP_ORIGIN)return null;
 let url;try{url=new URL(env.APP_ORIGIN);}catch{throw new ApiError(503,'ORIGIN_CONFIG_INVALID','APP_ORIGIN 必须是站点完整来源地址。');}
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!['http:','https:'].includes(url.protocol)||(env.NODE_ENV==='production'&&url.protocol!=='https:'))throw new ApiError(503,'ORIGIN_CONFIG_INVALID','生产 APP_ORIGIN 必须是无路径、无凭据的 HTTPS 来源。');
 return url.origin;
}
export function requestOrigin(req,env) {
 const origin=configuredOrigin(env);
 if(origin){
  if(req.headers.host!==new URL(origin).host)throw new ApiError(400,'HOST_REJECTED','站点地址不匹配。');
  if(env.TRUST_PROXY==='loopback'){
   if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress))throw new ApiError(403,'PROXY_REJECTED','只允许本机反向代理。');
   if(req.headers['x-forwarded-proto']!==new URL(origin).protocol.slice(0,-1))throw new ApiError(400,'PROXY_SCHEME_REJECTED','代理协议不匹配。');
  }else if(env.NODE_ENV==='production')throw new ApiError(503,'PROXY_NOT_CONFIGURED','生产环境必须显式配置可信本机代理。');
  return origin;
 }
 if(env.NODE_ENV==='production'&&!env.VERCEL)throw new ApiError(503,'ORIGIN_NOT_CONFIGURED','生产环境需要 APP_ORIGIN。');
 return (env.VERCEL?'https':'http')+'://'+(req.headers.host||'localhost');
}
export function validateServerEnvironment(env){
 configuredOrigin(env);
 if(env.NODE_ENV==='production'){
  if(!env.ADMIN_EMAIL||String(env.ADMIN_PASSWORD||'').length<12)throw new Error('Configure ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters)');
  if(!env.VERCEL&&(!env.APP_ORIGIN||env.TRUST_PROXY!=='loopback'))throw new Error('Configure HTTPS APP_ORIGIN and TRUST_PROXY=loopback');
 }
}
