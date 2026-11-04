(async () => {
  'use strict';
  const $ = s => document.querySelector(s);
  const button = $('#send'), input = $('#message');
  let ready = false, busy = false, threadId = null;
  const personaId = new URLSearchParams(location.search).get('id');
  const storageKey = 'pv-ai-thread:' + personaId;
  function bubble(label, text, user = false) {
    const node = document.createElement('div'); node.className = 'bubble' + (user ? ' user' : '');
    const title = document.createElement('small'); title.textContent = label;
    const content = document.createElement('p'); content.textContent = text;
    node.append(title, content); $('#messages').append(node);
    node.scrollIntoView({block: 'nearest'});
  }
  async function api(path, body) {
    const response = await fetch('./api/' + path, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
      headers: {'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000)
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error?.message || '请求失败，请稍后检查。');
    return data;
  }
  try {
    if (!personaId) throw Error('请先返回人格探索选择人格。');
    const {persona} = await api('personas/' + encodeURIComponent(personaId));
    $('#name').textContent = persona.name + ' · AI 对话';
    document.title = persona.name + ' · AI 对话 · PersonaVerse';
    const status = await api('ai/status');
    if (status.mode !== 'real') throw Error('站内 AI 尚未开启或服务端配置不完整。当前不会调用模型，也不会生成模拟回复。');
    if (status.adminRequired) {
      const session = await api('session');
      if (session.user?.role !== 'admin') throw Error('当前仅管理员可用，请先进入人格管理登录，再返回此页。');
    } else await api('ai/session', {});
    $('.demo-note').textContent = '你正在与 AI 虚拟角色交互，不是真人。消息和回复会保存于服务器并发送给 AI 服务商，请勿输入敏感信息。每天全站最多 ' + status.dailyLimit + ' 次请求，每个会话身份每 UTC 分钟最多 ' + status.rateLimit + ' 次。';
    try { threadId = sessionStorage.getItem(storageKey); } catch { /* Browser storage is optional. */ }
    if (threadId) {
      try {
        const data = await api('ai/history?threadId=' + encodeURIComponent(threadId));
        if (data.personaId !== personaId) throw Error('会话人格不匹配');
        for (const m of data.messages) bubble(m.role === 'user' ? '你' : 'AI 生成', m.content, m.role === 'user');
      } catch {
        threadId = null;
        $('#error').textContent = '旧会话不可读取，将开始新会话。';
        try { sessionStorage.removeItem(storageKey); } catch { /* optional */ }
      }
    }
    if (!$('#messages').children.length) bubble('人格欢迎语 · 非模型生成', persona.welcomeMessage || '可以从你此刻想聊的事情开始。');
    ready = true; input.disabled = false; button.disabled = false; button.textContent = '发送';
  } catch (error) {
    $('#error').textContent = error.message; button.textContent = '聊天暂不可用';
    input.disabled = true; button.disabled = true;
  }
  $('#composer').onsubmit = async event => {
    event.preventDefault();
    if (!ready || busy) return;
    const message = input.value.trim();
    if (!message || message.length > 1000) return;
    busy = true; button.disabled = true; input.disabled = true; button.textContent = 'AI 正在回复…';
    $('#error').textContent = ''; bubble('你', message, true); input.value = '';
    try {
      const data = await api('ai/chat', {personaId, threadId, message, requestId: crypto.randomUUID()});
      threadId = data.threadId;
      try { sessionStorage.setItem(storageKey, threadId); } catch { /* optional */ }
      bubble('AI 生成', data.message.content);
      $('#error').textContent = '今日全站剩余请求次数：' + data.remaining;
    } catch (error) {
      $('#error').textContent = error.message + ' 未自动重发；若请求已到达服务商，可能已产生费用。';
    } finally {
      busy = false; button.disabled = false; input.disabled = false; button.textContent = '发送';
    }
  };
  $('#clear').onclick = () => {
    if (busy) return;
    $('#messages').replaceChildren(); threadId = null;
    if (ready) $('#error').textContent = '已开始新会话。服务器中的旧记录不会因此删除。';
    try { sessionStorage.removeItem(storageKey); } catch { /* optional */ }
  };
})();
