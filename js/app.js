/* PersonaVerse — buildless, dependency-free and GitHub Pages friendly. */
(async () => {
  'use strict';
  let catalogNotice = "";
  let initialCatalog=null;
  let personas = window.PERSONAS || [];
  try { const response=await fetch('./api/personas', {signal:AbortSignal.timeout(6000)}); if(response.ok){const payload=await response.json();if(Array.isArray(payload.personas)){personas=payload.personas;initialCatalog=payload;}} else {catalogNotice='当前仅显示静态人格资料，数据服务不可用，不能反映后台最新状态或进行站内 AI 聊天。';} } catch {catalogNotice='当前仅显示静态人格资料，数据服务暂不可用，站内 AI 聊天不可用。';}
  const categories = ['全部人格', ...(initialCatalog?initialCatalog.categories.map(c=>c.name):[...new Set(personas.map(p=>p.category))])];
  const paths = {
    planet: '<circle cx="12" cy="12" r="6"/><ellipse cx="12" cy="12" rx="11" ry="4" transform="rotate(-30 12 12)"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    spark: '<path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8Z"/>',
    moon: '<path d="M20.9 13.2A9 9 0 0 1 10.8 3.1 9 9 0 1 0 20.9 13.2Z"/><path d="m18 2 .8 2.2L21 5l-2.2.8L18 8l-.8-2.2L15 5l2.2-.8Z"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z"/>',
    pen: '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z"/>',
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-16-2 20"/>',
    book: '<path d="M12 5v16M3 3c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2Z"/>',
    coffee: '<path d="M3 8h13v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Zm13 1h2a3 3 0 0 1 0 6h-2M6 2v2m5-2v2M2 23h16"/>',
    music: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/>',
    leaf: '<path d="M20 3C5 1 1 10 6 17c7 5 16 1 14-14ZM4 21 16 9m-5 5v-4m0 4h4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3v.1"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    filter: '<path d="M4 7h16M7 12h10m-7 5h4"/>',
    bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-7Z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    terminal: '<path d="m5 7 5 5-5 5m8 0h6"/>'
  };
  const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const link = p => `./persona.html?id=${encodeURIComponent(p.id)}`;
  let saved;
  try { const raw = JSON.parse(localStorage.getItem('personaverse-favorites') || '[]'); saved = new Set(Array.isArray(raw) ? raw.filter(id => typeof id === 'string') : []); } catch { saved = new Set(); }
  const state = {category: '全部人格', query: '', favorites: new URLSearchParams(location.search).get('view') === 'favorites'};
  const detail = document.body.dataset.page === 'detail';
  let toastTimer;

  function shell(content) {
    document.getElementById('app').innerHTML = `
      <aside class="sidebar" aria-label="主导航">
        <a class="brand" href="./index.html" aria-label="人格宇宙首页"><span class="brand-mark">${icon('planet')}</span><span>人格宇宙<small>PERSONAVERSE</small></span></a>
        <div class="nav-caption">你的探索空间</div>
        <nav><a class="nav-item ${!state.favorites ? 'active' : ''}" href="./index.html" data-nav="explore">${icon('compass')}<span>发现人格</span><span class="nav-dot"></span></a>
        <a class="nav-item ${state.favorites ? 'active' : ''}" href="./index.html?view=favorites" data-nav="favorites">${icon('heart')}<span>我的收藏</span><span class="saved-count">${saved.size}</span></a></nav>
        <div class="sidebar-divider"></div><div class="nav-caption">按灵感漫游</div>
        <nav class="category-nav">${categories.slice(1).map((c,i) => `<a class="nav-item" href="./index.html?category=${encodeURIComponent(c)}" data-category="${c}">${icon(['moon','bolt','book','spark','planet'][i])}<span>${c}</span></a>`).join('')}</nav>
        <div class="sidebar-bottom"><div class="sidebar-note"><span class="tiny-orbit">✧</span><strong>一个提示词，无限可能</strong><p>找到与你同频的 AI 人格，<br>开启一段不一样的对话。</p><button class="text-button" data-guide>新手使用指南 ${icon('arrow')}</button></div><span class="system-status"><i></i> 为好奇心，持续探索 <span>v1.0</span></span></div>
      </aside>
      <div class="workspace"><header class="topbar"><a class="mobile-brand" href="./index.html">${icon('planet')}<strong>人格宇宙</strong></a><div class="breadcrumb">探索空间 <span>/</span> <strong>${detail ? '人格详情' : state.favorites ? '我的收藏' : '发现人格'}</strong></div><div class="topbar-right"><span class="deepseek-badge"><i></i> 适配 DeepSeek</span><button class="help-button" data-guide aria-label="打开使用指南">${icon('help')}</button></div></header>
      <main id="main" tabindex="-1">${catalogNotice ? `<p role="status" style="padding:12px;color:#c4a9dc">${esc(catalogNotice)}</p>` : ""}${content}</main><footer class="footer"><a href="./index.html">${icon('planet')} PersonaVerse</a><span>让 AI 有性格，让对话有温度。</span><a href="./admin.html">人格管理</a><span>独立提示词项目 · 非 DeepSeek 官方产品</span></footer></div>
      <nav class="mobile-nav" aria-label="手机导航"><a href="./index.html" data-nav="explore" class="${!state.favorites ? 'active' : ''}">${icon('compass')}探索</a><a href="./index.html?view=favorites" data-nav="favorites" class="${state.favorites ? 'active' : ''}">${icon('heart')}收藏 <span class="saved-count">${saved.size}</span></a><button data-guide>${icon('help')}指南</button></nav>
      <div id="toast" class="toast" role="status" aria-live="polite"></div>
      <dialog id="guide" aria-labelledby="guide-title"><div class="dialog-heading"><span class="eyebrow">YOUR FIRST JOURNEY</span><button class="icon-button" data-close-guide aria-label="关闭指南">${icon('close')}</button></div><h2 id="guide-title">三步，遇见你的 AI 同频者。</h2><p class="muted">无需注册，所有人格提示词都可以免费使用。</p><ol class="guide-steps"><li><span>01</span><div><h3>发现喜欢的人格</h3><p>按分类探索，或搜索你想要的角色与能力。</p></div></li><li><span>02</span><div><h3>一键复制提示词</h3><p>进入人格详情，点击「复制完整提示词」。</p></div></li><li><span>03</span><div><h3>去 DeepSeek 开启新对话</h3><p>将提示词粘贴到一个新对话，发送后即可开始交流。</p></div></li></ol><a class="button primary" href="https://chat.deepseek.com/" target="_blank" rel="noopener noreferrer">打开 DeepSeek ${icon('external')}</a><p class="guide-footnote">提示词在本地复制，不会向 DeepSeek 自动发送内容。</p></dialog>`;
    bindCommon();
  }

  function orbitArt() {
    return `<div class="universe-art" aria-hidden="true"><div class="star-field"></div><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit orbit-three"></div><div class="planet-glow"></div><div class="hero-planet"><span class="planet-grid"></span><span class="planet-shine"></span><span class="planet-symbol">P<span>V</span></span></div><span class="orbit-star star-a">✦</span><span class="orbit-star star-b">✧</span><span class="orbit-star star-c">+</span><span class="floating-persona float-moon">${icon('moon')}</span><span class="floating-persona float-spark">${icon('spark')}</span><span class="floating-persona float-code">${icon('code')}</span><span class="orbit-label">${icon('spark')} 与无限可能，建立连接</span><span class="orbit-coordinate">PERSONA SYSTEM / 001</span></div>`;
  }

  function home() {
    const initialCategory = new URLSearchParams(location.search).get('category');
    if (categories.includes(initialCategory)) state.category = initialCategory;
    shell(`<section class="hero" ${state.favorites ? 'hidden' : ''}><div class="hero-copy"><div class="hero-label"><span></span> MEET YOUR AI ALTER EGO</div><h1>每一次对话，<br>都有新的<span>可能。</span></h1><p>不止是 AI，更是与你同频的伙伴。<br>探索不同人格，开启无限对话。</p><a class="button primary hero-button" href="#explore">开启人格探索 ${icon('arrow')}</a><div class="hero-meta"><span>${icon('check')} 免费使用</span><span>${icon('check')} 一键复制</span><span>${icon('check')} 即刻对话</span></div></div>${orbitArt()}</section>
      <section class="intro-strip" ${state.favorites ? 'hidden' : ''}><span class="strip-icon">${icon('bolt')}</span><p>好的人格，是一段好对话的开始。<span>选一个角色，把灵感带进你的下一次对话。</span></p><button class="text-button" data-guide>如何使用 ${icon('arrow')}</button></section>
      <section id="explore" class="explore-section" aria-labelledby="explore-title"><div class="section-heading"><div><div class="eyebrow">EXPLORE THE PERSONAVERSE</div><h2 id="explore-title">${state.favorites ? '我的人格收藏' : '发现你的同频人格'}<span class="title-dot">✦</span></h2></div><span class="section-subtitle">${personas.length} 个独特灵魂，等待相遇</span></div><div class="search-row"><div class="search-box">${icon('search')}<input id="search" type="search" placeholder="搜索人格、关键词，或你此刻的灵感…" autocomplete="off" aria-label="搜索人格"><kbd>/</kbd></div><button id="reset-search" class="button subtle" aria-label="重置搜索和分类">${icon('filter')}<span>重置筛选</span></button></div><div class="category-chips" aria-label="人格分类">${categories.map((c,i)=>`<button class="category-chip ${state.category === c ? 'selected' : ''}" data-category="${c}" aria-pressed="${state.category === c}">${icon(['grid','moon','bolt','book','spark','planet'][i])}${c}</button>`).join('')}</div>
      <section id="featured-section" aria-labelledby="featured-title"><div class="list-heading"><h3 id="featured-title">${icon('spark')} 编辑精选 <span>CURATED FOR YOU</span></h3><span class="muted">从这里，开始你的第一次探索</span></div><div class="persona-grid featured-grid">${personas.filter(p=>p.featured).slice(0,3).map(p=>card(p,true)).join('')}</div></section>
      <section aria-labelledby="all-title" class="all-personas"><div class="list-heading"><h3 id="all-title">${state.favorites ? '已收藏人格' : '全部人格'} <span id="result-count"></span></h3><label class="sort-control">排序<select id="sort" aria-label="人格排序"><option value="recommended">推荐优先</option><option value="name">名称排序</option></select></label></div><div id="results" class="persona-grid" aria-live="polite"></div><div id="empty-state" class="empty-state" hidden>${icon('search')}<h3>暂时没有遇见这个人格</h3><p>试试其他关键词，或换个分类继续探索。</p><button class="button secondary" id="empty-reset">查看全部人格</button></div></section></section>
      <section class="closing-note"><span>✦</span><p>宇宙很大，总有一个人格与你同频。</p><small>保持好奇，下一次对话或许就有新的发现。</small></section>`);
    let searchTimer;document.getElementById('search').addEventListener('input', e => { state.query=e.target.value;catalogPage=1;clearTimeout(searchTimer);searchTimer=setTimeout(renderResults,200); });
    document.getElementById('sort').addEventListener('change',()=>{catalogPage=1;renderResults();});
    document.getElementById('reset-search').addEventListener('click', resetFilters);
    document.getElementById('empty-reset').addEventListener('click', () => { state.favorites = false; resetFilters(); updateView(); });
    renderResults();
  }

  function card(p, featured = false) {
    return `<article class="persona-card accent-${esc(p.accent)} ${featured ? 'featured-card' : ''}"><div class="card-top"><a class="persona-avatar" href="${link(p)}" tabindex="-1" aria-hidden="true">${p.avatarUrl ? `<img src="${esc(p.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : icon(p.icon)}</a>${featured ? '<span class="featured-badge">精选人格</span>' : `<span class="category-label">${esc(p.category)}</span>`}<button class="save-button ${saved.has(p.id) ? 'is-saved' : ''}" data-save="${esc(p.id)}" aria-label="${saved.has(p.id) ? '取消收藏' : '收藏'}${esc(p.name)}" aria-pressed="${saved.has(p.id)}">${icon('heart')}</button></div><a class="card-main" href="${link(p)}"><div class="card-name"><h3>${esc(p.name)}</h3><span>${esc(p.englishName)}</span></div><p class="card-tagline">${esc(p.tagline)}</p><p class="card-description">${esc(p.description)}</p></a><div class="card-tags">${p.tags.map(t=>`<span>${esc(t)}</span>`).join('')}</div><div class="card-bottom"><span class="card-category"><i></i>${esc(p.category)}</span><a href="${link(p)}">探索人格 ${icon('arrow')}</a></div></article>`;
  }

  let catalogPage=1, requestSequence=0;
  async function renderResults() {
    if(initialCatalog){
      const seq=++requestSequence;
      const params=new URLSearchParams({page:String(catalogPage),limit:'12',q:state.query.trim(),sort:document.getElementById('sort').value});
      const category=initialCatalog.categories.find(c=>c.name===state.category);if(category)params.set('category',category.id);
      if(state.favorites)params.set('ids',[...saved].slice(0,100).join(','));
      try{
        const response=await fetch('./api/personas?'+params);if(!response.ok)throw Error('查询失败');const data=await response.json();if(seq!==requestSequence)return;
        for(const p of data.personas){const i=personas.findIndex(x=>x.id===p.id);if(i>=0)personas[i]=p;else personas.push(p);}
        document.getElementById('results').innerHTML=data.personas.map(p=>card(p)).join('');
        document.getElementById('result-count').textContent=data.total+' 位';document.getElementById('empty-state').hidden=data.total>0;
        document.getElementById('featured-section').hidden=state.favorites||!!state.query||state.category!=='全部人格'||catalogPage>1;
        document.querySelectorAll('.category-chip').forEach(el=>{const active=el.dataset.category===state.category;el.classList.toggle('selected',active);el.setAttribute('aria-pressed',active);});
        let nav=document.getElementById('catalog-pagination');if(!nav){nav=document.createElement('div');nav.id='catalog-pagination';nav.className='pagination';document.getElementById('results').after(nav);}nav.replaceChildren();
        for(const [label,next] of [['上一页',catalogPage-1],['下一页',catalogPage+1]]){const b=document.createElement('button');b.className='button secondary';b.textContent=label;b.disabled=next<1||next>data.pages;b.onclick=()=>{catalogPage=next;renderResults();};nav.append(b);}
        const text=document.createElement('span');text.textContent='第 '+data.page+' / '+Math.max(1,data.pages)+' 页';nav.insertBefore(text,nav.lastChild);
      }catch(e){if(seq===requestSequence)toast('人格加载失败，请稍后重试');}return;
    }
    const query = state.query.trim().toLocaleLowerCase();
    let results = personas.filter(p => (state.category === '全部人格' || p.category === state.category) && (!state.favorites || saved.has(p.id)) && (!query || [p.name,p.englishName,p.tagline,p.description,p.category,...p.tags].join(' ').toLocaleLowerCase().includes(query)));
    if (document.getElementById('sort').value === 'name') results.sort((a,b) => a.name.localeCompare(b.name,'zh-CN'));
    else results.sort((a,b) => Number(b.featured) - Number(a.featured));
    document.getElementById('results').innerHTML = results.map(p=>card(p)).join('');
    document.getElementById('result-count').textContent = `${results.length} 位`;
    document.getElementById('empty-state').hidden = results.length > 0;
    document.getElementById('empty-state').querySelector('h3').textContent = state.favorites && !saved.size ? '把喜欢的人格，留在你的宇宙' : '暂时没有遇见这个人格';
    document.getElementById('empty-state').querySelector('p').textContent = state.favorites && !saved.size ? '点击人格卡片上的爱心，就能在这里再次找到它。' : '试试其他关键词，或换个分类继续探索。';
    document.getElementById('featured-section').hidden = state.favorites || !!query || state.category !== '全部人格';
    document.querySelectorAll('.category-chip').forEach(el => { const selected = el.dataset.category === state.category; el.classList.toggle('selected',selected); el.setAttribute('aria-pressed',selected); });
    document.querySelectorAll('.category-nav [data-category]').forEach(el=>el.classList.toggle('active',el.dataset.category === state.category));
  }

  function resetFilters() {
    catalogPage=1;state.query = ''; state.category = '全部人格';
    const url = new URL(location.href);
    url.searchParams.delete('category');
    history.replaceState(null, '', url);
    document.getElementById('search').value = '';
    document.getElementById('sort').value = 'recommended';
    renderResults();
  }

  function updateView() {
    catalogPage=1;
    document.querySelector('.hero').hidden = state.favorites;
    document.querySelector('.intro-strip').hidden = state.favorites;
    document.getElementById('explore-title').innerHTML = `${state.favorites ? '我的人格收藏' : '发现你的同频人格'}<span class="title-dot">✦</span>`;
    document.getElementById('all-title').firstChild.textContent = state.favorites ? '已收藏人格 ' : '全部人格 ';
    document.querySelector('.breadcrumb strong').textContent = state.favorites ? '我的收藏' : '发现人格';
    document.querySelectorAll('[data-nav]').forEach(el=>el.classList.toggle('active', (el.dataset.nav === 'favorites') === state.favorites));
    const url = new URL(location.href);
    if (state.favorites) url.searchParams.set('view','favorites'); else url.searchParams.delete('view');
    if (state.category !== '全部人格') url.searchParams.set('category', state.category);
    else url.searchParams.delete('category');
    history.replaceState(null,'',url);
    renderResults();
  }

  async function detailPage() {
    const id = new URLSearchParams(location.search).get('id');
    let p = personas.find(p => p.id === id);
    if(initialCatalog){try{const response=await fetch('./api/personas/'+encodeURIComponent(id));p=response.ok?(await response.json()).persona:null;if(p&&!personas.some(x=>x.id===p.id))personas.push(p);}catch{p=null;}}
    if (!p) { shell(`<section class="not-found">${icon('planet')}<span class="eyebrow">LOST IN THE UNIVERSE</span><h1>这个人格还未被发现</h1><p>链接可能有误，回到探索空间寻找新的同频者吧。</p><a href="./index.html" class="button primary">${icon('back')}返回人格宇宙</a></section>`); return; }
    document.title = `${p.name} ${p.englishName} · 人格宇宙 PersonaVerse`;
    shell(`<div class="detail-page accent-${esc(p.accent)}"><a class="back-link" href="./index.html#explore">${icon('back')} 返回人格探索</a><section class="detail-hero"><div class="detail-avatar persona-avatar">${p.avatarUrl ? `<img src="${esc(p.avatarUrl)}" alt="" referrerpolicy="no-referrer">` : icon(p.icon)}</div><div class="detail-title"><a class="button primary" href="./chat.html?id=${encodeURIComponent(p.id)}">进入人格对话</a><span class="eyebrow">${esc(p.category)} / PERSONA PROFILE</span><h1>${esc(p.name)}<span>${esc(p.englishName)}</span></h1><p>${esc(p.tagline)}</p><div class="card-tags">${p.tags.map(t=>`<span>${esc(t)}</span>`).join('')}</div></div><button class="button secondary detail-save ${saved.has(p.id) ? 'is-saved' : ''}" data-save="${esc(p.id)}" aria-pressed="${saved.has(p.id)}">${icon('heart')}<span>${saved.has(p.id) ? '已收藏' : '收藏人格'}</span></button></section><div class="detail-layout"><div><section class="detail-section"><h2>${icon('spark')} 认识这个人格</h2><p>${esc(p.description)}</p><div class="persona-facts"><div><span>人格类型</span><strong>${esc(p.category)}</strong></div><div><span>推荐模型</span><strong>DeepSeek</strong></div><div><span>使用方式</span><strong>复制即用</strong></div></div></section><section class="prompt-section" aria-labelledby="prompt-title"><div class="prompt-heading"><div><span class="eyebrow">THE SOUL OF THIS PERSONA</span><h2 id="prompt-title">人格提示词</h2></div><span class="prompt-language">简体中文 · 可编辑</span></div><label class="sr-only" for="prompt-text">完整人格提示词，可根据需要编辑</label><textarea id="prompt-text" spellcheck="false">${esc(p.prompt || "此人格的系统提示词由管理员维护，不开放复制。")}</textarea><div class="prompt-actions"><span>${icon('terminal')} 编辑成你的专属人格</span><button class="button primary" id="copy-prompt">${icon('copy')} 复制完整提示词</button></div><div id="copy-fallback" class="copy-fallback" role="status" hidden>浏览器暂不允许自动复制。提示词已选中，请长按选择「复制」，或按 Ctrl / ⌘ + C。</div></section><section class="detail-section starters"><h2>${icon('coffee')} 可以这样开始对话</h2><p class="muted">发送人格提示词后，试试这些开场白。</p>${p.starters.map(s=>`<button class="starter" data-starter="${esc(s)}"><span>“${esc(s)}”</span>${icon('copy')}</button>`).join('')}</section></div><aside class="detail-aside"><section class="how-to-card"><span class="eyebrow">READY TO CONNECT?</span><h2>让人格，走进对话。</h2><ol><li><span>1</span><div><strong>复制人格提示词</strong><p>也可以先按你的偏好修改。</p></div></li><li><span>2</span><div><strong>在 DeepSeek 新建对话</strong><p>每个人格，推荐使用独立对话。</p></div></li><li><span>3</span><div><strong>粘贴发送，开始交流</strong><p>说说你的想法，让对话自然发生。</p></div></li></ol><a class="button secondary" href="https://chat.deepseek.com/" target="_blank" rel="noopener noreferrer">前往 DeepSeek ${icon('external')}</a><small>将打开 DeepSeek 官方网站</small></section><div class="local-note">${icon('leaf')}<p>你的收藏与提示词编辑留在当前浏览器。站内 AI 对话由服务端处理并保存记录，勿输入敏感信息；无需在网页填写 API 密钥。<span>提示词编辑不会自动保存；离开前请复制。</span></p></div></aside></div><section class="related-section"><div class="list-heading"><h2>也许，你还会喜欢</h2><a class="text-button" href="./index.html#explore">探索更多 ${icon('arrow')}</a></div><div class="persona-grid">${personas.filter(other=>other.id!==p.id).sort((a,b)=>Number(b.category===p.category)-Number(a.category===p.category)).slice(0,3).map(other=>card(other)).join('')}</div></section></div>`);
    document.getElementById('copy-prompt').addEventListener('click', async e=> {
      const button = e.currentTarget;
      const field = document.getElementById('prompt-text');
      if (!field.value.trim()) { toast('提示词还是空的，先写一点内容吧。'); field.focus(); return; }
      if (!p.copyEnabled && !p.prompt) { toast("此人格未开放提示词复制"); return; }
      const success = await copyText(field.value,field);
      document.getElementById('copy-fallback').hidden = success;
      if (success) { button.innerHTML = `${icon('check')} 已复制，去开启对话`; setTimeout(()=>{button.innerHTML=`${icon('copy')} 复制完整提示词`;},2400); }
    });
  }

  async function copyText(value, source) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      toast('已复制，粘贴到 DeepSeek 即可开始对话');
      return true;
    } catch {
      const field = source || document.createElement('textarea');
      if (!source) { field.value=value; field.style.cssText='position:fixed;left:0;top:0;opacity:0;'; document.body.appendChild(field); }
      field.focus(); field.select(); field.setSelectionRange(0,field.value.length);
      let success=false;
      try { success=document.execCommand('copy'); } catch { /* Show manual-copy instructions. */ }
      if (!source) field.remove();
      if (success) toast('已复制，粘贴到 DeepSeek 即可开始对话');
      else if (!source) { showManualCopy(value); }
      return success;
    }
  }

  function showManualCopy(value) {
    let dialog = document.getElementById('manual-copy');
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.id='manual-copy'; dialog.setAttribute('aria-labelledby','manual-copy-title');
      dialog.innerHTML=`<div class="dialog-heading"><h2 id="manual-copy-title">手动复制开场白</h2><button class="icon-button" aria-label="关闭">${icon('close')}</button></div><p class="muted">长按文字选择「复制」，或按 Ctrl / ⌘ + C。</p><textarea aria-label="开场白" readonly></textarea>`;
      dialog.querySelector('button').addEventListener('click',()=>dialog.close()); document.body.appendChild(dialog);
    }
    dialog.querySelector('textarea').value=value; dialog.showModal(); dialog.querySelector('textarea').select();
  }

  function toast(message) {
    const el=document.getElementById('toast'); el.innerHTML=`${icon('check')}<span>${esc(message)}</span>`; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('visible'),3000);
  }

  function toggleSave(id) {
    const p = personas.find(p=>p.id===id); if (!p) return;
    saved.has(id) ? saved.delete(id) : saved.add(id);
    let persisted=true;
    try { localStorage.setItem('personaverse-favorites',JSON.stringify([...saved])); } catch { persisted=false; }
    document.querySelectorAll('[data-save]').forEach(button=>{ const active=saved.has(button.dataset.save); const item=personas.find(p=>p.id===button.dataset.save); button.classList.toggle('is-saved',active); button.setAttribute('aria-pressed',active); button.setAttribute('aria-label',`${active ? '取消收藏' : '收藏'}${item?.name || ''}`); const span=button.querySelector('span'); if(span) span.textContent=active?'已收藏':'收藏人格'; });
    document.querySelectorAll('.saved-count').forEach(el=>el.textContent=saved.size);
    if (!detail && state.favorites) renderResults();
    toast(persisted ? (saved.has(id) ? `已将「${p.name}」加入收藏` : `已取消收藏「${p.name}」`) : '当前浏览器无法保存收藏，本次浏览仍可使用');
  }

  function bindCommon() {
    document.getElementById('app').addEventListener('click',e=> {
      const save=e.target.closest('[data-save]'); if(save) {toggleSave(save.dataset.save);return;}
      if(e.target.closest('[data-guide]')) { document.getElementById('guide').showModal();return; }
      if(e.target.closest('[data-close-guide]')) {document.getElementById('guide').close();return;}
      const starter=e.target.closest('[data-starter]'); if(starter) {copyText(starter.dataset.starter);return;}
      if(detail) return;
      const category=e.target.closest('[data-category]');
      if(category) {e.preventDefault();state.category=category.dataset.category;state.favorites=false;updateView();document.getElementById('explore').scrollIntoView({behavior:'smooth',block:'start'});return;}
      const nav=e.target.closest('[data-nav]'); if(nav) {e.preventDefault();state.favorites=nav.dataset.nav==='favorites';resetFilters();updateView();window.scrollTo({top:0,behavior:'smooth'});}
    });
    document.getElementById('guide').addEventListener('click',e=>{if(e.target===e.currentTarget && (e.offsetX<0 || e.offsetY<0 || e.offsetX>e.currentTarget.clientWidth || e.offsetY>e.currentTarget.clientHeight)) e.currentTarget.close();});
  }
  document.addEventListener('keydown',e=>{if(e.key==='/' && !detail && !document.querySelector('dialog[open]') && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();document.getElementById('search').focus();}});
  if(detail) detailPage(); else home();
})();
