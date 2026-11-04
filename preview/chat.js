(()=>{
 const $=s=>document.querySelector(s);let count=0;
 const id=new URLSearchParams(location.search).get('id');const persona=(window.PERSONAS||[]).find(p=>p.id===id);
 function bubble(label,text,user=false){const div=document.createElement('div');div.className='bubble'+(user?' user':'');const small=document.createElement('small');small.textContent=label;const content=document.createElement('p');content.textContent=text;div.append(small,content);$('#messages').append(div);}
 if(!persona){$('#name').textContent='人格未找到';$('#error').textContent='请返回人格广场选择角色。';$('#composer button').disabled=true;$('#composer').onsubmit=e=>e.preventDefault();return;}
 $('#name').textContent=persona.name+' · 演示';$('#details').href='./persona.html?id='+encodeURIComponent(persona.id);
 const scripts={
 '情感陪伴':['这是预置演示：可以试着写下今天的一件小事，再描述它带给你的感受。','这是预置演示：先慢慢呼吸，给自己留一点整理思绪的时间。'],
 '学习成长':['这是预置演示：先选一个小目标，用自己的话解释它，再找一个具体例子。','这是预置演示：我们可以按“概念、例子、小练习”三步组织一次学习。'],
 '效率工具':['这是预置演示：先列出目标、限制和下一步，把大任务拆成一个今天能完成的动作。','这是预置演示：请准备背景、已尝试的方法和期待结果，方便之后进入真正的协作。'],
 '创意灵感':['这是预置演示：试试为同一个点子写出温柔、奇幻和幽默三个版本。','这是预置演示：故事可以从一个地点、一件意外和一个选择开始。'],
 '趣味角色':['这是预置演示：你来到一座漂浮的空间站，眼前有一扇星光之门。选择探索或休息。','这是预置演示：旅途停在一间安静的小店。你可以挑选一段旋律，或描述窗外的星空。']};
 bubble('角色介绍 · 预设内容',persona.tagline+'\n'+persona.description);
 for(const text of persona.starters){const b=document.createElement('button');b.className='button secondary';b.type='button';b.textContent=text;b.onclick=()=>{$('#message').value=text;$('#message').focus();};$('#starters').append(b);}
 $('#composer').onsubmit=e=>{e.preventDefault();const text=$('#message').value.trim();if(!text||text.length>500)return;if(count>=20){$('#error').textContent='本次演示最多20轮，请清空后继续。';return;}bubble('你的演示输入',text,true);const choices=scripts[persona.category]||scripts['创意灵感'];bubble(persona.name+' · 预设脚本（非 AI）',choices[count%choices.length]);count++;$('#message').value='';};
 $('#clear').onclick=()=>{$('#messages').replaceChildren();$('#error').textContent='';$('#message').value='';count=0;};
})();
