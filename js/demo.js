(async()=>{
 const $=s=>document.querySelector(s);let ready=false,count=0;
 function bubble(label,text,user=false){const node=document.createElement('div');node.className='bubble'+(user?' user':'');const title=document.createElement('small');title.textContent=label;const content=document.createElement('p');content.textContent=text;node.append(title,content);$('#messages').append(node);}
 try{const id=new URLSearchParams(location.search).get('id');if(!id)throw Error('请先选择一个人格。');const r=await fetch('./api/personas/'+encodeURIComponent(id));if(!r.ok)throw Error('人格不存在、已下架，或数据服务尚未配置。');const {persona}=await r.json();$('#name').textContent=persona.name+' · 演示';bubble('配置欢迎语 · 非模型生成',persona.welcomeMessage||'你好，欢迎体验 PersonaVerse 的演示对话界面。');ready=true;}catch(e){$('#error').textContent=e.message;$('#composer button').disabled=true;}
 $('#composer').onsubmit=e=>{e.preventDefault();if(!ready)return;const input=$('#message').value.trim();if(!input)return;if(count>=20){$('#error').textContent='本次演示最多20轮，请清空后继续。';return;}bubble('你的演示输入',input,true);bubble('固定示例 · 非真实 AI','这是一条用于体验聊天界面的预置回复，不是模型对你问题的解答。真实 AI 接口将在下一阶段接入。');$('#message').value='';count++;};
 $('#clear').onclick=()=>{$('#messages').replaceChildren();$('#error').textContent='';count=0;};
})();
