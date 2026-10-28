export const LIFE_STATES = {
  disconnected: ['还没连上会话', '选一间 DSH 会话，就能看见我正在做什么。'],
  loading: ['正在接上记忆', '正在读取当前会话，稍等一下。'],
  idle: ['在这里，等你来', '这一会儿没有在执行任务。想聊什么都可以。'],
  thinking: ['正在认真想', '当前会话正在运行，等我理一理思路。'],
  working: ['正在忙一件事', '正在执行工具，进度以会话里的结果为准。'],
  waiting: ['有件事想问你', '回到当前会话，回答问题后就能继续。'],
  approval: ['等你点个头', '当前会话有一项操作需要你确认。'],
  queued: ['已经收到，排队中', '消息已排队，等待当前会话继续处理。'],
  error: ['这一步没走通', '当前会话遇到了问题，点开记录看看。'],
  removed: ['这间会话已移除', '换一间会话，我会重新接上。'],
};

export function shortText(text, limit = 160) {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function toolLabel(name, argsRaw = '') {
  if (/bili/i.test(name) || /\bbili\.mjs\b/.test(argsRaw)) return '运行 B站工具';
  if (/search|browse|fetch|web/i.test(name)) return '查找资料';
  if (/read|file|list|glob/i.test(name)) return '翻看资料';
  if (/write|edit|patch/i.test(name)) return '整理内容';
  if (/exec|shell|command|python/i.test(name)) return '执行任务';
  return '使用工具';
}

export function sessionState(snapshot) {
  let id = 'disconnected';
  if (snapshot) {
    if (snapshot.removed) id = 'removed';
    else if (snapshot.openState === 'error') id = 'error';
    else if (snapshot.openState !== 'open') id = 'loading';
    else if (snapshot.pending.some(p => p.kind === 'approval')) id = 'approval';
    else if (snapshot.pending.length) id = 'waiting';
    else if (snapshot.runningCalls.length) id = 'working';
    else if (snapshot.running) id = 'thinking';
    else if (snapshot.queue.length) id = 'queued';
    else if (snapshot.promptError || snapshot.lastAgentError) id = 'error';
    else {
      const tail = snapshot.nodes.filter(n => ['assistant', 'user', 'steering', 'turn-error', 'turn-max-tokens'].includes(n.kind)).at(-1);
      id = tail?.kind === 'turn-error' || tail?.kind === 'turn-max-tokens' ? 'error' : 'idle';
    }
  }
  const [label, description] = LIFE_STATES[id];
  return {id, label, description: id === 'working' ? `${toolLabel(snapshot.runningCalls.at(-1).name, snapshot.runningCalls.at(-1).argsRaw)}，完成后会留下结果。` : description};
}

export function documentCategory(label) {
  const name = String(label).toLowerCase();
  if (/(?:^|[\\/_. -])(?:diary|journal)(?:[\\/_. -]|$)|日记/.test(name)) return 'diary';
  if (/(?:^|[\\/_. -])(?:outbox|letters?)(?:[\\/_. -]|$)|信件|书信/.test(name)) return 'letter';
  return 'document';
}

export function filterEvents(events, category) {
  return category === 'all' ? events : events.filter(event => event.category === category);
}

export function mergeEvents(...groups) {
  const items = new Map();
  for (const event of groups.flat()) if (Number.isFinite(event.time)) items.set(event.id, event);
  return [...items.values()].sort((a, b) => b.time - a.time || a.id.localeCompare(b.id));
}

export function safeVideoLinks(text) {
  return [...new Set(String(text).match(/\bBV[0-9A-Za-z]{10}\b/g) || [])].slice(0, 8).map(id => ({id, url: `https://www.bilibili.com/video/${id}/`}));
}

export function videoCards(events) {
  const cards = new Map();
  for (const event of events) {
    if (event.category !== 'video' && !(event.category === 'activity' && /推荐|最值得看|最想看/.test(`${event.title} ${event.text}`))) continue;
    const id = event.videoId || safeVideoLinks(`${event.title} ${event.text} ${event.detail || ''}`)[0]?.id;
    if (!/^BV[0-9A-Za-z]{10}$/.test(id || '')) continue;
    const context = event.detail || event.text || '';
    const inferred = context.slice(Math.max(0,context.indexOf(id))).match(/《([^》]{1,120})》/)?.[1];
    const title = event.videoTitle || inferred || '';
    const entry = {time:event.time,dateOnly:event.dateOnly,source:event.source,sourceId:event.sourceId,reason:event.text || '',title};
    if (!cards.has(id)) cards.set(id,{id,url:`https://www.bilibili.com/video/${id}/`,entries:[]});
    cards.get(id).entries.push(entry);
  }
  return [...cards.values()].map(card=>{
    card.entries.sort((a,b)=>b.time-a.time);
    const title = card.entries.find(entry=>entry.title)?.title || card.id;
    return {...card,title,time:card.entries[0].time};
  }).sort((a,b)=>b.time-a.time || a.id.localeCompare(b.id));
}

export function unreadItems(events) {
  return [...events.filter(event => ['diary','letter'].includes(event.category)).map(event => ({key:`${event.category}:${event.id}`,category:event.category})),
    ...videoCards(events).map(card => ({key:`video:${card.id}`,category:'video'}))];
}

export function searchMatches(item, query) {
  const words = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const fields = [item.id,item.title,item.text,item.detail,item.source,item.sourceId,...(item.entries || []).flatMap(entry=>[entry.title,entry.reason,entry.source,entry.sourceId])];
  const text = fields.filter(value=>typeof value === 'string').join(' ').toLocaleLowerCase();
  return words.every(word=>text.includes(word));
}

export function timeLabel(time, now = Date.now()) {
  const date = new Date(time), today = new Date(now);
  const clock = date.toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', hour12: false});
  return date.toDateString() === today.toDateString() ? clock : `${date.getMonth() + 1}/${date.getDate()} ${clock}`;
}
