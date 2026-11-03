(async()=>{
 const $=s=>document.querySelector(s);let ready=false,busy=false,count=0,real=false,threadId=null;
 const personaId=new URLSearchParams(location.search).get('id');const storageKey='pv-ai-thread:'+personaId;
 function bubble(label,text,user=false){const node=document.createElement('div');node.className='bubble'+(user?' user':'');const title=document.createElement('small');title.textContent=label;const content=document.createElement('p');content.textContent=text;node.append(title,content);$('#messages').append(node);}
 async function api(path,body){const r=await fetch('./api/'+path,{method:body?'POST':'GET',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error(d.error?.message||'请求失败');return d;}
 try{
  if(!personaId)throw Error('请先选择人格。');const {persona}=await api('personas/'+encodeURIComponent(personaId));
  const status=await api('ai/status');real=status.mode==='real';$('#name').textContent=persona.name+(real?' · AI 对话':' · 演示');
  if(real){const session=await api('session');$('.demo-note').textContent='真实 AI 测试 · 你正在与 AI 虚拟角色交互，不是真人。每次发送可能产生供应商费用；回复保存于服务器。仅管理员可用。';if(session.user?.role!=='admin')throw Error('请先打开 /admin.html 登录管理员，再返回此页。');try{threadId=sessionStorage.getItem(storageKey);}catch{}if(threadId){try{const data=await api('ai/history?threadId='+encodeURIComponent(threadId));for(const m of data.messages)bubble(m.role==='user'?'你':'AI 生成',m.content,m.role==='user');}catch{threadId=null;}}}
  else $('.demo-note').textContent='预置演示 · 非真实 AI：全局 AI 开关关闭或配置不完整。回复为固定示例，不调用模型、不消耗费用。请勿输入敏感信息。';
  if(!$('#messages').children.length)bubble('配置欢迎语 · 非模型生成',persona.welcomeMessage||'你好，欢迎体验 PersonaVerse。');ready=true;$('#composer button').textContent=real?'发送（真实 AI 测试，可能计费）':'发送演示消息';$('#clear').textContent=real?'新建会话（旧记录保留）':'清空';
 }catch(e){$('#error').textContent=e.message;$('#composer button').disabled=true;}
 $('#composer').onsubmit=async e=>{e.preventDefault();if(!ready||busy)return;const input=$('#message').value.trim();if(!input||input.length>1000)return;if(!real&&count>=20){$('#error').textContent='本次演示最多20轮，请清空后继续。';return;}
  bubble(real?'你':'你的演示输入',input,true);$('#message').value='';$('#error').textContent='';busy=true;const button=$('#composer button');button.disabled=true;button.textContent=real?'AI 正在回复…':'发送演示消息';
  try{if(real){const data=await api('ai/chat',{personaId,threadId,message:input,requestId:crypto.randomUUID()});threadId=data.threadId;try{sessionStorage.setItem(storageKey,threadId);}catch{}bubble('AI 生成',data.message.content);$('#error').textContent='今日剩余全站测试次数：'+data.remaining;}else{bubble('固定示例 · 非真实 AI','这是一条用于体验聊天界面的预置回复，不是模型对你问题的解答。');count++;}}
  catch(e){$('#error').textContent=e.message+' 不会自动重发，若请求已经到达供应商，可能已产生费用。';}finally{busy=false;button.disabled=false;button.textContent=real?'发送（真实 AI 测试）':'发送演示消息';}
 };
 $('#clear').onclick=()=>{if(busy)return;$('#messages').replaceChildren();$('#error').textContent='';threadId=null;count=0;try{sessionStorage.removeItem(storageKey);}catch{}};
})();
