(()=>{
  const $=id=>document.getElementById(id);let revision=null,busy=false,next=null;
  const message=text=>$('core-notice').textContent=text;
  async function api(path='',body){const r=await fetch('/api/admin/soul-core'+path,{method:body?'POST':'GET',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error?.message||'操作失败');return data;}
  function render(versions){for(const v of versions){const article=document.createElement('article'),title=document.createElement('p'),content=document.createElement('p'),button=document.createElement('button');title.textContent='发布版本 '+v.revision+' · '+v.created_at;content.textContent=v.content;content.style.whiteSpace='pre-wrap';content.style.overflowWrap='anywhere';button.type='button';button.textContent='回滚到此版本';button.onclick=()=>run(async()=>{if(!confirm('切换所有人格共享的生效核心？不会修改独立角色和当前草稿。'))return;await api('/rollback',{revision,versionId:v.id});await load();message('已回滚生效版本。');});article.append(title,content,button);$('core-versions').append(article);}}
  function reset(){revision=null;next=null;$('core-content').value='';$('core-versions').replaceChildren();$('core-state').textContent='';$('core-more').hidden=true;for(const id of ['core-content','core-save','core-publish'])$(id).disabled=true;}
  async function load(){const data=await api();revision=Number(data.core.revision);$('core-content').value=data.core.draft_content;$('core-state').textContent='修订 '+revision+' · '+(data.core.active_version_id?'已发布':'尚未发布');$('core-versions').replaceChildren();render(data.versions);next=data.nextBefore;$('core-more').hidden=!next;}
  async function run(action){if(busy)return;busy=true;for(const b of $('core-panel').querySelectorAll('button'))b.disabled=true;try{await action();}catch(e){message(e.message);}finally{busy=false;for(const b of $('core-panel').querySelectorAll('button'))b.disabled=revision===null&&b.id!=='core-reload';$('core-content').disabled=revision===null;}}
  $('core-reload').onclick=()=>run(load);
  $('core-form').onsubmit=e=>{e.preventDefault();run(async()=>{await api('/draft',{revision,content:$('core-content').value});await load();message('草稿已保存，尚未发布。');});};
  $('core-publish').onclick=()=>run(async()=>{if(!confirm('发布已保存的核心草稿？所有人格将共享此生效版本。未保存的编辑不会发布。'))return;await api('/publish',{revision});await load();message('核心已发布，当前未接入真实AI。');});
  $('core-more').onclick=()=>run(async()=>{const data=await api('?before='+next);render(data.versions);next=data.nextBefore;$('core-more').hidden=!next;});
  new MutationObserver(()=>{if($('panel').hidden){reset();message('');}}).observe($('panel'),{attributes:true,attributeFilter:['hidden']});
  reset();
})();
