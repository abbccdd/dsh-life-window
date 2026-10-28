window.__ModuleLoader__.load({id:'dsh-life-window',factory:(require)=>{const module={exports:{}};const exports=module.exports;const LIFE_STATES = {
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

function shortText(text, limit = 160) {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function toolLabel(name, argsRaw = '') {
  if (/bili/i.test(name) || /\bbili\.mjs\b/.test(argsRaw)) return '运行 B站工具';
  if (/search|browse|fetch|web/i.test(name)) return '查找资料';
  if (/read|file|list|glob/i.test(name)) return '翻看资料';
  if (/write|edit|patch/i.test(name)) return '整理内容';
  if (/exec|shell|command|python/i.test(name)) return '执行任务';
  return '使用工具';
}

function sessionState(snapshot) {
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

function documentCategory(label) {
  const name = String(label).toLowerCase();
  if (/(?:^|[\\/_. -])(?:diary|journal)(?:[\\/_. -]|$)|日记/.test(name)) return 'diary';
  if (/(?:^|[\\/_. -])(?:outbox|letters?)(?:[\\/_. -]|$)|信件|书信/.test(name)) return 'letter';
  return 'document';
}

function filterEvents(events, category) {
  return category === 'all' ? events : events.filter(event => event.category === category);
}

function mergeEvents(...groups) {
  const items = new Map();
  for (const event of groups.flat()) if (Number.isFinite(event.time)) items.set(event.id, event);
  return [...items.values()].sort((a, b) => b.time - a.time || a.id.localeCompare(b.id));
}

function safeVideoLinks(text) {
  return [...new Set(String(text).match(/\bBV[0-9A-Za-z]{10}\b/g) || [])].slice(0, 8).map(id => ({id, url: `https://www.bilibili.com/video/${id}/`}));
}

function videoCards(events) {
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

function unreadItems(events) {
  return [...events.filter(event => ['diary','letter'].includes(event.category)).map(event => ({key:`${event.category}:${event.id}`,category:event.category})),
    ...videoCards(events).map(card => ({key:`video:${card.id}`,category:'video'}))];
}

function searchMatches(item, query) {
  const words = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const fields = [item.id,item.title,item.text,item.detail,item.source,item.sourceId,...(item.entries || []).flatMap(entry=>[entry.title,entry.reason,entry.source,entry.sourceId])];
  const text = fields.filter(value=>typeof value === 'string').join(' ').toLocaleLowerCase();
  return words.every(word=>text.includes(word));
}

function timeLabel(time, now = Date.now()) {
  const date = new Date(time), today = new Date(now);
  const clock = date.toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', hour12: false});
  return date.toDateString() === today.toDateString() ? clock : `${date.getMonth() + 1}/${date.getDate()} ${clock}`;
}


function summaryState(summary) {
  if (!summary) return {id:'disconnected',label:'会话暂不可用',description:'会话可能已移除，或当前宿主无法访问。'};
  if (summary.pendingInteraction === 'approval' || summary.pendingInteraction === 'plan-review') return {id:'approval',label:'等你点个头',description:'该会话需要你处理确认。'};
  if (summary.pendingInteraction === 'question') return {id:'waiting',label:'有件事想问你',description:'打开会话，回答问题后就能继续。'};
  if (summary.running) return {id:'working',label:'正在忙一件事',description:'该会话正在运行；打开会话可查看实时细节。'};
  return {id:'idle',label:'当前没有运行任务',description:'来自 DSH 会话列表；独立后台活动可能不在此宿主中。'};
}

const ALL_SESSIONS = '__all_sessions__';
const IDENTITY = /^(?:dsh[-_])?(?:bili[-_](?:whale|pond|scroll|pod|fish|duty|subagent|merlin)|(?:whale|fish|pod)[-_]work)(?:[-_][\w-]+)?$/i;
const TOOL = /(?:^|__)(?:bili|bilibili)[_-](?:search|feed|popular|recommend|recommendation|video|detail|view|subtitle|subtitles|danmaku|comments?|reply|diary|pick|favorite|fav|watch|dynamic|dm|history|hot|rank)(?:$|[_-])/i;
const SHELL = /(?:^|__)(?:bash|pwsh|powershell|shell|exec|execute|terminal|command|run_command|exec_command)$/i;
const FILE_TOOL = /(?:^|__)(?:read|write|edit|read_file|write_file|edit_file|str_replace_editor)$/i;
const FISH_FILE = /(?:^|[\\/])(?:whale-(?:diary|outbox|log)\.(?:md|jsonl)|bili-duty[\\/](?:(?:out|digest)[\\/][^\\/]+\.md|seen\.md)|bili-fish[\\/]diary[\\/][^\\/]+\.md|pod-diary[\\/]owner[\\/]\d{4}-\d{2}-\d{2}\.md)$/i;
const BILI_SCRIPT = /(?:^|[;&|]\s*)\s*(?:&\s*)?(?:node(?:\.exe)?|"[^"\r\n]*[\\/]node(?:\.exe)?"|'[^'\r\n]*[\\/]node(?:\.exe)?')\s+(?:"[^"\r\n]*bili\.mjs"|'[^'\r\n]*bili\.mjs'|[^\s;"']*bili\.mjs)\s+(?:feed|search|popular|debrief|subtitles|watch-video|diary|comment-digest|comment-await|dm-await|night|fav|reply-draft|quota|video-content)(?:\s|$|["'])/i;

function metadataFingerprint(row) {
  const directory = String(row.cwd || '').split(/[\\/]/).filter(Boolean).at(-1) || '';
  if (IDENTITY.test(String(row.id || ''))) return '养鱼插件专用会话标识';
  if (IDENTITY.test(directory)) return '养鱼插件专用工作目录';
  return '';
}

function toolFingerprint(name, raw = '') {
  if (typeof name !== 'string') return '';
  if (TOOL.test(name)) return '调用 B站工具';
  if (FILE_TOOL.test(name) && typeof raw === 'string') {
    try {
      const args = JSON.parse(raw), file = args?.path || args?.file_path || args?.file;
      if (typeof file === 'string' && FISH_FILE.test(file)) return '访问养鱼日记或报告文件';
    } catch { /* No structured path: do not classify arbitrary text as a file. */ }
  }
  if (!SHELL.test(name) || typeof raw !== 'string') return '';
  // Only inspect the command field for actual shell calls, never arbitrary file
  // contents, tool output, reasoning or prose that merely mentions a plugin.
  let command = raw;
  try {
    const args = JSON.parse(raw);
    command = typeof args?.command === 'string' ? args.command : typeof args?.cmd === 'string' ? args.cmd : '';
  } catch { /* Older host versions expose the raw shell command. */ }
  return BILI_SCRIPT.test(command) ? '运行 B站养鱼工具链' : '';
}

function callsFingerprint(calls) {
  for (const {name,raw} of calls) {
    const reason = toolFingerprint(name,raw);
    if (reason === '运行 B站养鱼工具链' || reason === '访问养鱼日记或报告文件') return reason;
    if (reason === '调用 B站工具') {
      const normalized = name.toLowerCase().split('__').at(-1);
      if (/(?:^|[_-])(?:diary|pick)(?:$|[_-])/.test(normalized)) return '调用养鱼日记或挑选工具';
    }
  }
  return '';
}

function historyFingerprint(entries) {
  const calls = [];
  for (const {event} of entries) {
    if (!event) continue;
    if (event.type === 'tool/call') calls.push({name:event.data?.name,raw:event.data?.arguments});
    if (event.type === 'assistant/message') for (const block of event.data?.message?.content || []) if (block.type === 'tool-call') calls.push({name:block.name,raw:block.arguments});
  }
  return callsFingerprint(calls);
}

function snapshotFingerprint(snapshot) {
  if (!snapshot) return '';
  const calls = (snapshot.runningCalls || []).map(call=>({name:call.name,raw:call.argsRaw}));
  for (const node of snapshot.nodes || []) if (node.kind === 'assistant') for (const block of node.blocks || []) if (block.kind === 'tool-call') {
    calls.push({name:block.name,raw:block.argsRaw});
  }
  return callsFingerprint(calls);
}

// Discovery inspects bounded recent history locally. Only identified sessions
// have their event text cached; unmatched session bodies are discarded.
function createSessionController(sessions, api, notify, storage = globalThis.localStorage) {
  const evidenceKey = 'dsh-life-window-fingerprints-v5', excludedKey = 'dsh-life-window-excluded-v4';
  const read = (key, fallback) => {try {return JSON.parse(storage.getItem(key) || fallback);} catch {return JSON.parse(fallback);}};
  const saved = read(evidenceKey,'{}');
  const evidence = new Map(Object.entries(saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}).filter(([,value])=>typeof value === 'string'));
  const excludedValues = read(excludedKey,'[]');
  const excluded = new Set(Array.isArray(excludedValues) ? excludedValues.filter(id=>typeof id === 'string') : []);
  const persistEvidence = () => storage.setItem(evidenceKey,JSON.stringify(Object.fromEntries(evidence)));
  let scope = ALL_SESSIONS, current = null, closed = false, active = false, generation = 0;
  const cache = new Map(), pending = new Map();
  const list = () => sessions.list.getSnapshot();
  const rows = data => data.ids.map(id=>data.byId[id]).filter(row=>row && (!row.blank || row.id === data.current));
  function reasonFor(row) {return metadataFingerprint(row) || evidence.get(row.id) || '';}
  function recognized(data) {return rows(data).filter(row=>reasonFor(row) && !excluded.has(row.id));}
  function targets(data) {const recognizedRows = recognized(data); return scope === ALL_SESSIONS ? recognizedRows : recognizedRows.filter(row=>row.id === scope);}
  function view() {
    const data = list(), all = rows(data), found = recognized(data), selected = targets(data);
    const specific = scope !== ALL_SESSIONS, id = specific ? scope : '';
    const live = current?.sessionId === data.current ? current : null;
    const waiting = selected.filter(row=>row.pendingInteraction), running = selected.filter(row=>row.running);
    const scanning = all.filter(row=>!excluded.has(row.id) && (!cache.has(row.id) || pending.has(row.id))).length;
    let state;
    if (specific) state = live && id === data.current ? sessionState(live) : summaryState(selected[0]);
    else if (waiting.length) state = {id:'waiting',label:`${waiting.length} 个会话等你处理`,description:'打开对应会话后可继续。'};
    else if (running.length) state = {id:'working',label:`${running.length} 个会话正在活动`,description:'汇总自动识别出的养鱼会话。'};
    else if (!found.length) state = {id:'disconnected',label:scanning ? '正在寻找养鱼会话' : '暂未识别到养鱼会话',description:scanning ? '正在检查近期工具活动。' : '产生养鱼工具活动后会自动识别。'};
    else state = {id:'idle',label:'当前没有运行任务',description:'这里汇总已识别的养鱼会话活动。'};
    const failed = all.filter(row=>cache.get(row.id)?.error).map(row=>({id:row.id,title:row.displayTitle || row.id,error:cache.get(row.id).error}));
    return {scope,id,title:data.byId[id]?.displayTitle || id,list:all,included:found.map(row=>row.id),identified:all.filter(row=>reasonFor(row)).map(row=>({id:row.id,title:row.displayTitle || row.id,reason:reasonFor(row),excluded:excluded.has(row.id)})),excluded:[...excluded],state,failed,scanFailed:failed.length,loading:scanning,
      currentId:data.current || '',total:selected.length,live:!!live};
  }
  function changed() {if (!closed) notify(view());}
  function note(id, reason) {
    if (reason && evidence.get(id) !== reason) {evidence.set(id,reason); persistEvidence();}
  }
  async function fetchOne(row, epoch) {
    const abort = new AbortController(), timeout = setTimeout(()=>abort.abort(),15000);
    pending.set(row.id,abort); changed();
    try {
      const response = await api.sessions.history({sessionId:row.id,maxMessages:40},abort.signal);
      if (closed || epoch !== generation || !list().byId[row.id]) return;
      if (!response.result.ok) throw new Error(response.result.error.message || response.result.error.code);
      const entries = response.result.value.events;
      let examined = entries, reason = historyFingerprint(examined);
      let page = response.result.value;
      // On the first discovery pass, look back at most three pages so active
      // chat after an old fish run does not immediately hide its fingerprint.
      if (!reason && !reasonFor(row) && !cache.has(row.id)) for (let index=1; index<3 && page.hasMore && page.events.length; index++) {
        const beforeSeq = page.events[0]?.event?.seq;
        if (!Number.isFinite(beforeSeq)) break;
        const older = await api.sessions.history({sessionId:row.id,maxMessages:40,beforeSeq},abort.signal);
        if (closed || epoch !== generation || !list().byId[row.id]) return;
        if (!older.result.ok) throw new Error(older.result.error.message || older.result.error.code);
        page = older.result.value;
        examined = [...page.events,...examined];
        reason = historyFingerprint(examined);
        if (reason) break;
      }
      if (reason) note(row.id,reason);
      // History is used for fingerprints only, not retained as activity.
      cache.set(row.id,{updatedAt:row.updatedAt,at:Date.now(),error:''});
    } catch (error) {
      if (!closed && epoch === generation && list().byId[row.id]) cache.set(row.id,{updatedAt:row.updatedAt,at:Date.now(),error:error.message || '请求失败'});
    } finally {clearTimeout(timeout); if (pending.get(row.id) === abort) pending.delete(row.id); changed();}
  }
  let batch = null;
  async function refresh(force = false) {
    if (!active || closed) return;
    if (batch) return batch;
    const epoch = generation;
    batch = (async()=>{
      const now = Date.now();
      const queue = rows(list()).filter(row=>!excluded.has(row.id) && !pending.has(row.id) && (force || !cache.has(row.id) || (cache.get(row.id).updatedAt !== row.updatedAt && now-cache.get(row.id).at >= 10000) || now-cache.get(row.id).at >= 60000));
      async function worker() {while (queue.length && !closed && active && epoch === generation) await fetchOne(queue.shift(),epoch);}
      await Promise.all(Array.from({length:Math.min(3,queue.length)},()=>worker()));
    })();
    try {await batch;} finally {batch = null; if (active && !closed && epoch !== generation) refresh();}
  }
  function invalidate() {generation++; for (const abort of pending.values()) abort.abort(); pending.clear();}
  const unlist = sessions.list.subscribe(()=>{
    const data = list();
    for (const id of cache.keys()) if (!data.byId[id]) cache.delete(id);
    if (scope !== ALL_SESSIONS && !recognized(data).some(row=>row.id===scope)) scope = ALL_SESSIONS;
    changed(); refresh();
  });
  const timer = setInterval(()=>{if (active && !document.hidden) refresh();},10000);
  return {
    view,
    setCurrent(snapshot) {current = snapshot; if (snapshot) note(snapshot.sessionId,snapshotFingerprint(snapshot)); changed();},
    clearCurrent(id) {if (current?.sessionId === id) {current = null; changed();}},
    bind(value) {scope = value || ALL_SESSIONS; changed();},
    exclude(id, value = true) {if (value) {excluded.add(id); cache.delete(id);} else excluded.delete(id); storage.setItem(excludedKey,JSON.stringify([...excluded])); if (scope === id && value) scope = ALL_SESSIONS; invalidate(); changed(); refresh();},
    restoreExcluded() {excluded.clear(); storage.setItem(excludedKey,'[]'); invalidate(); changed(); refresh();},
    open(id) {const selected = id || scope; if (selected !== ALL_SESSIONS && list().byId[selected]) sessions.open(selected);},
    setActive(value) {active = value; if (active) refresh(); else invalidate();},
    refresh:()=>refresh(true),
    destroy() {closed = true; invalidate(); clearInterval(timer); unlist();},
  };
}


function createLifeWindow({css, container = document.body, embedded = false, preview = false, fetchOverview = () => fetch('/dsh-life/api/overview', {cache: 'no-store'}).then(async r => {if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();})}) {
  const root = document.createElement('div');
  root.dataset.dshLifeWindow = '';
  if (embedded) root.dataset.embedded = '';
  const shadow = root.attachShadow({mode: 'open'});
  shadow.innerHTML = `<style>${css}</style>
    <button class="bubble" aria-label="打开鲸鲸生活窗" aria-expanded="false"><span class="bubble-wave" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M5 19c1-5 5-8 11-8 4 0 7 2 9 5l3-2-1 5 2 3-5-1c-2 4-7 6-11 5-5-1-8-4-8-7Z"/><circle cx="11" cy="18" r="1"/></svg></span><span>鲸鲸生活窗</span><span class="bubble-unread" hidden></span></button>
    <section class="window" aria-label="鲸鲸生活窗" hidden>
      <header class="top"><div class="brand"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M5 19c1-5 5-8 11-8 4 0 7 2 9 5l3-2-1 5 2 3-5-1c-2 4-7 6-11 5-5-1-8-4-8-7Z"/><circle cx="11" cy="18" r="1"/></svg></span><div><strong>鲸鲸生活窗</strong><small>WHALE LIFE · 生活随记</small></div></div><div class="top-actions"><button class="refresh icon" aria-label="刷新生活记录" title="刷新">↻</button><button class="close icon" aria-label="收起生活窗" title="收起">×</button></div></header>
      <main>
        <section class="hero"><div class="hero-copy"><div class="eyebrow"><i></i><span class="hero-context">当前会话</span></div><h2 class="status">正在连接</h2><p class="description"></p></div><div class="whale" aria-hidden="true"><img src="/dsh-life/assets/deepseek-chibi.webp" alt="" width="500" height="501"></div></section>
        <section class="schedule"><div><span class="schedule-kicker">B站作息</span><strong class="schedule-title">正在连接生活记录</strong><p class="schedule-detail"></p></div><span class="schedule-time"></span></section>
        <details class="binding"><summary>自动识别养鱼会话</summary><p>根据插件专用会话、工作目录和近期养鱼工具调用识别。</p><div class="session-choices" aria-label="自动识别的养鱼会话"></div><p id="binding-hint">识别结果可能有遗漏或误判，可在此排除不相关的会话。</p></details>
        <section class="feed"><div class="feed-heading"><div><span class="kicker">LITTLE MOMENTS</span><h3>最近的生活</h3></div><span class="feed-count"></span></div><label class="search-label" for="life-search">搜索历史记录</label><input id="life-search" class="life-search" type="search" placeholder="搜索日记、信件或视频" autocomplete="off"><p class="search-hint" aria-live="polite"></p><div class="filters" role="group" aria-label="筛选生活记录"><button data-filter="all" aria-pressed="true">全部</button><button data-filter="activity" aria-pressed="false">活动</button><button data-filter="video" aria-pressed="false">视频</button><button data-filter="diary" aria-pressed="false">日记</button><button data-filter="letter" aria-pressed="false">信件</button><button data-filter="document" aria-pressed="false">资料</button></div><button class="mark-all" hidden>将当前分类全部标为已读</button><div class="events"></div><button class="more-events" hidden>显示更多</button></section>
        <details class="sources"><summary>数据来源与连接状态 <span>⌄</span></summary><div class="source-list"></div><p>会话用于识别和显示状态；生活记录来自插件文件或生活来源，未声明所属会话的记录不会被自动归属。</p><div class="discovery"><strong>发现更多生活资料</strong><p>仅列出 DSH 数据目录中可能相关的文件；选择后显示原文。请确认其中没有不想展示的内容。</p><div class="source-picker"><select class="candidate" aria-label="选择发现的生活资料"><option value="">正在查找来源</option></select><button class="add-source">添加</button></div><p class="discovery-status" aria-live="polite"></p><div class="selected-sources"></div></div></details>
      </main><footer><span><i></i> 生活记录在本机</span><span class="updated">等待更新</span></footer>
    </section>`;
  container.append(root);
  const $ = selector => shadow.querySelector(selector);
  const pageSize = 50;
  let snapshot = null, overview = null, historyOverview = null, historyError = '', historyLoading = false, loadError = '', query = '', filter = 'all', opened = embedded, destroyed = false, inFlight = false, controller = null, sessionView = null, visibleCount = pageSize;
  let candidates = [], added = [], discoveryError = '', files = [], fileErrors = [], discoveryLoaded = false;
  const expandedContent = new Set();
  const storedSourcesKey = 'dsh-life-window-sources-v1';
  const unreadKey = 'dsh-life-window-unread-v1';
  let unreadState = null;
  try {const saved = JSON.parse(localStorage.getItem(unreadKey) || 'null'); if (saved && Array.isArray(saved.known) && Array.isArray(saved.unread)) unreadState = {known:new Set(saved.known),unread:new Set(saved.unread)};} catch { /* Local storage may be unavailable. */ }
  const saveUnread = () => {try {localStorage.setItem(unreadKey,JSON.stringify({known:[...unreadState.known],unread:[...unreadState.unread]}));} catch { /* The current view still works without persistence. */ }};
  function updateUnread(events) {
    const items = unreadItems(events);
    if (!unreadState) unreadState = {known:new Set(items.map(item=>item.key)),unread:new Set()};
    else for (const item of items) if (!unreadState.known.has(item.key)) {unreadState.known.add(item.key); unreadState.unread.add(item.key);}
    saveUnread();
  }
  function markRead(key) {if (unreadState?.unread.delete(key)) {saveUnread(); render();}}
  function summaryText(text, max = 180) {const clean=String(text || '').replace(/\s+/g,' ').trim(); return clean.length > max ? `${clean.slice(0,max)}…` : clean;}
  if (!preview) {try {const saved = JSON.parse(localStorage.getItem(storedSourcesKey) || '[]'); if (Array.isArray(saved)) added = saved.filter(x => typeof x === 'string').slice(0,5);} catch {discoveryError = '已保存的资料选择无法读取，请重新选择。';}}
  const el = (tag, cls, content) => {const item = document.createElement(tag); if (cls) item.className = cls; if (content !== undefined) item.textContent = content; return item;};
  function appendExpandable(parent, key, previewText, fullText, cls, readKey = '') {
    const full = String(fullText || previewText || '').trim();
    const preview = summaryText(previewText || full);
    const different = full.replace(/\s+/g,' ').trim() !== preview.replace(/\s+/g,' ').trim();
    const expanded = expandedContent.has(key);
    const text = el('p',cls,expanded ? full : preview);
    if (expanded) text.classList.add('expanded-text');
    parent.append(text);
    if (different) {
      const button = el('button','expand-content',expanded ? '收起' : '显示全文');
      button.type='button'; button.dataset.expandKey=key; button.dataset.readKey=readKey;
      button.setAttribute('aria-expanded',String(expanded)); parent.append(button);
    }
  }
  function setOpened(value) {
    opened = value;
    $('.window').hidden = !opened; $('.bubble').hidden = opened || embedded;
    $('.bubble').setAttribute('aria-expanded', String(opened));
    controller?.setActive(opened);
    if (opened) refresh();
  }
  function render() {
    const state = sessionView?.state || sessionState(snapshot);
    $('.status').textContent = state.label;
    $('.description').textContent = state.description;
    $('.hero').dataset.state = state.id;
    $('.hero-context').textContent = preview ? '演示会话' : sessionView ? `自动识别 · ${sessionView.total} 个会话` : '正在连接 DSH 会话';
    if (sessionView) {
      const choices = $('.session-choices');
      const choiceSignature = JSON.stringify(sessionView.identified);
      if (choices.dataset.signature !== choiceSignature) {
        choices.replaceChildren();
        if (!sessionView.identified.length) choices.append(el('p','choice-empty',sessionView.loading ? '正在识别会话…' : '尚未发现明确的养鱼会话。'));
        for (const row of sessionView.identified) {
          const card = el('div','detected-session'), copy = el('div','detected-copy');
          const duplicate = sessionView.identified.filter(other=>other.title===row.title).length > 1;
          copy.append(el('strong','',duplicate ? `${row.title} · ${row.id.slice(-8)}` : row.title),el('span','',row.reason));
          const button = el('button','exclude-session',row.excluded ? '恢复' : '排除');
          button.dataset.sessionId = row.id; button.dataset.excluded = String(row.excluded);
          card.append(copy,button); choices.append(card);
        }
        choices.dataset.signature = choiceSignature;
      }
      $('.binding summary').textContent = `自动识别养鱼会话 · ${sessionView.total} 个`;
      $('#binding-hint').textContent = sessionView.loading ? `正在识别 ${sessionView.loading} 个会话的近期工具痕迹。` : sessionView.scanFailed ? `${sessionView.scanFailed} 个会话识别失败，可能有遗漏。` : '识别结果可能有遗漏或误判，可在此排除不相关的会话。';
    }
    const schedule = overview?.schedule;
    $('.schedule-title').textContent = loadError ? '生活记录暂时不可用' : schedule?.label || '正在连接生活记录';
    $('.schedule-detail').textContent = loadError || schedule?.detail || '正在查找可用的数据来源。';
    $('.schedule-time').textContent = schedule?.at ? timeLabel(schedule.at) : '';
    $('.schedule').dataset.mode = schedule?.mode || 'unknown';
    const currentOverview = query.trim() && historyOverview ? historyOverview : overview;
    const sourceEvents = (currentOverview?.events || []).filter(event => !event.sessionId || (sessionView?.included.includes(event.sessionId) && (sessionView.scope === '__all_sessions__' || event.sessionId === sessionView.id)));
    const events = mergeEvents(sourceEvents, files.map(file => ({id:`document:${file.id}`,time:file.updatedAt,category:documentCategory(file.label),tone:'neutral',title:file.label.split('/').at(-1),text:'用户选定的原始资料 · 按文件修改时间显示',detail:file.text,source:'用户选定的资料',sourceId:file.label + (file.truncated ? ' · 只显示末尾部分' : '')})));
    const filtered = (filter === 'video' ? videoCards(events) : filter === 'all' && query.trim() ? [...events.filter(event=>event.category !== 'video'),...videoCards(events)].sort((a,b)=>b.time-a.time) : filterEvents(events.filter(event=>event.category !== 'video'), filter)).filter(item=>searchMatches(item,query));
    const counts = {video:0,diary:0,letter:0};
    for (const item of unreadItems((overview?.events || []))) if (unreadState?.unread.has(item.key)) counts[item.category]++;
    const unreadTotal = counts.video + counts.diary + counts.letter;
    $('.bubble-unread').hidden = !unreadTotal; $('.bubble-unread').textContent = unreadTotal > 99 ? '99+' : String(unreadTotal);
    $('.bubble').setAttribute('aria-label',unreadTotal ? `打开鲸鲸生活窗，${unreadTotal} 条未读` : '打开鲸鲸生活窗');
    for (const button of shadow.querySelectorAll('[data-filter]')) {const category=button.dataset.filter; const labels={all:'全部',activity:'活动',video:'视频',diary:'日记',letter:'信件',document:'资料'}; button.textContent=labels[category]+(counts[category] ? ` ${counts[category]}` : '');}
    $('.search-hint').textContent = query.trim() ? (historyLoading ? '正在读取可用历史…' : historyError || '搜索可读取的历史记录；部分旧文件或超出扫描范围的内容可能未包含。') : '首次接入的已有记录视为已读，新记录会显示未读。';
    $('.mark-all').hidden = !unreadTotal || !['all','video','diary','letter'].includes(filter);
    $('.feed-count').textContent = filtered.length > visibleCount ? `显示 ${visibleCount} / ${filtered.length} 条` : `${filtered.length} 条记录`;
    const list = $('.events');
    const openedVideoSources = new Set([...list.querySelectorAll('.video-card-sources[open]')].map(detail => detail.dataset.videoId));
    const openedLongContent = new Set([...list.querySelectorAll('.long-content[open][data-long-key]')].map(detail=>detail.dataset.longKey));
    list.replaceChildren();
    if (!filtered.length) list.append(el('p', 'empty', query.trim() ? '没有找到匹配的记录。试试其他关键词或分类。' : filter === 'video' ? '暂时没有可识别的视频推荐。' : filter === 'activity' ? '暂时没有可展示的活动内容。来源出现明确的推荐或公开动态后会显示在这里。' : '这里还没有记录。等有了新内容，就会出现在这里。'));
    for (const event of filtered.slice(0, visibleCount)) {
      if (event.entries) {
        const card = el('article','video-card'); card.dataset.readKey=`video:${event.id}`;
        const header = el('div','video-card-header');
        const mark = el('span','video-card-mark','▶'); mark.setAttribute('aria-hidden','true');
        const heading = el('div','video-card-heading'); heading.append(el('span','video-card-id',event.id),el('h4','',event.title));
        header.append(mark,heading); card.append(header);
        const latest = event.entries.find(entry=>entry.reason);
        if (latest) appendExpandable(card,`video-reason:${event.id}`,latest.reason,latest.reason,'video-card-reason',card.dataset.readKey);
        const source = latest || event.entries[0];
        const stamp = source.dateOnly ? new Date(source.time).toLocaleDateString('zh-CN',{year:'numeric',month:'numeric',day:'numeric'}) : timeLabel(source.time);
        card.append(el('p','video-card-source',`${stamp} · ${source.source} · ${event.entries.length} 条来源记录`));
        const link = el('a','video-card-link','打开 B 站视频 ↗'); link.href=event.url; link.target='_blank'; link.rel='noopener noreferrer'; card.append(link);
        if (event.entries.length > 1) {
          const details=el('details','video-card-sources'); details.dataset.videoId=event.id; details.open=openedVideoSources.has(event.id); details.append(el('summary','','查看所有来源'));
          const extra=el('details','long-content'); extra.dataset.longKey=`video-extra:${event.id}`; extra.open=openedLongContent.has(extra.dataset.longKey); extra.append(el('summary','',`显示其余 ${event.entries.length-5} 条来源`));
          for (const [index,entry] of event.entries.entries()) {const line=el('div','source-entry'); line.append(el('p','source-entry-meta',`${entry.dateOnly ? new Date(entry.time).toLocaleDateString('zh-CN') : timeLabel(entry.time)} · ${entry.source} · ${entry.sourceId}`)); if (entry.reason) appendExpandable(line,`video-source:${event.id}:${index}`,entry.reason,entry.reason,'source-entry-reason',card.dataset.readKey); (index < 5 ? details : extra).append(line);}
          if (event.entries.length > 5) details.append(extra);
          card.append(details);
        }
        if (unreadState?.unread.has(card.dataset.readKey)) {const mark=el('button','read-one','未读 · 标为已读'); mark.dataset.readKey=card.dataset.readKey; card.append(mark);}
        list.append(card); continue;
      }
      const row = el('article', `event ${event.tone || 'neutral'}`);
      if (['diary','letter'].includes(event.category)) row.dataset.readKey=`${event.category}:${event.id}`;
      const rail = el('div', 'rail'); rail.append(el('span', 'dot')); row.append(rail);
      const content = el('div', 'event-content');
      const meta = el('div', 'event-meta');
      const stamp = event.dateOnly ? new Date(event.time).toLocaleDateString('zh-CN', {month: 'long', day: 'numeric'}) : timeLabel(event.time);
      meta.append(el('time', '', stamp), el('span', 'source-tag', event.source));
      content.append(meta, el('h4', '', event.title));
      appendExpandable(content,`event:${event.id}`,event.text,event.detail || event.text,'event-text',row.dataset.readKey);
      const links = safeVideoLinks(event.detail || event.text);
      if (links.length) {const wrap = el('div', 'video-links'); for (const link of links) {const a = el('a', '', `打开 ${link.id} ↗`); a.href = link.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; wrap.append(a);} content.append(wrap);}
      content.append(el('div', 'provenance', `来源：${event.source} · ${event.sourceId}${event.dateOnly ? ' · 原文只记录日期' : ''}`));
      if (row.dataset.readKey && unreadState?.unread.has(row.dataset.readKey)) {const mark=el('button','read-one','未读 · 标为已读'); mark.dataset.readKey=row.dataset.readKey; content.append(mark);}
      if (event.sessionId && sessionView?.list.some(row => row.id === event.sessionId) && event.sessionId !== sessionView.currentId) {const open = el('button','event-open','打开来源会话 ↗'); open.dataset.sessionId = event.sessionId; content.append(open);}
      row.append(content); list.append(row);
    }
    $('.more-events').hidden = filtered.length <= visibleCount;
    const sources = $('.source-list'); sources.replaceChildren();
    const local = el('div', 'source-row'); local.append(el('span', '', 'DSH 会话'), el('strong', '', sessionView ? `${sessionView.total} 个 · ${sessionView.loading ? '读取中' : sessionView.failed.length ? `${sessionView.failed.length} 个失败` : '近期记录'}` : snapshot ? '已连接' : '未选择会话')); sources.append(local);
    for (const failure of sessionView?.failed || []) sources.append(el('p','source-error',`${failure.title}：${failure.error}`));
    if (overview) for (const source of overview.sources) {
      const row = el('div', 'source-row'); row.append(el('span', '', source.file), el('strong', '', ({ready: '已连接', tail: '已连接（最近部分）', missing: '未找到', error: '读取失败'})[source.status] || '未知')); sources.append(row);
    }
    for (const issue of overview?.issues || []) sources.append(el('p', 'source-error', issue));
    $('.discovery').hidden = preview;
    if (!preview) {
      const picker = $('.candidate'), previous = picker.value;
      const signature = JSON.stringify([candidates.map(item=>[item.id,item.label]),added]);
      if (picker.dataset.signature !== signature) {
        picker.replaceChildren(new Option(discoveryLoaded ? '选择一个候选文件' : '正在查找来源',''));
        for (const item of candidates.filter(item=>!added.includes(item.id))) picker.append(new Option(item.label,item.id));
        picker.value = previous; picker.dataset.signature = signature;
      }
      $('.add-source').disabled = !picker.value || added.length >= 5;
      $('.discovery-status').textContent = discoveryError || fileErrors.join('；') || (discoveryLoaded && !candidates.length ? '未发现可识别的候选文件。' : '最多添加 5 个文件，可随时移除。');
      const selected = $('.selected-sources'); selected.replaceChildren();
      for (const id of added) {const row = el('div','selected-source'); row.append(el('span','',candidates.find(c=>c.id===id)?.label || '来源暂不可用')); const remove = el('button','remove-source','移除'); remove.dataset.sourceId = id; row.append(remove); selected.append(row);}
    }
    $('.updated').textContent = overview ? `更新于 ${timeLabel(overview.fetchedAt)}` : loadError ? '连接失败' : '等待更新';
  }
  async function refresh() {
    if (inFlight || destroyed) return;
    inFlight = true; $('.refresh').disabled = true;
    try {overview = await fetchOverview(); updateUnread(overview.events || []); loadError = '';}
    catch (error) {loadError = `读取失败（${error.message}），可以稍后重试。`;}
    finally {inFlight = false; if (!destroyed) {$('.refresh').disabled = false; render();}}
    if (opened && !preview && !destroyed) await refreshDiscovery();
    if (opened && query.trim() && !destroyed) {historyOverview=null; await loadHistory();}
  }
  async function loadHistory() {
    if (historyLoading || historyOverview) return;
    if (preview) {historyOverview=overview; render(); return;}
    historyLoading=true; historyError=''; render();
    try {historyOverview=await getJSON('/dsh-life/api/overview?history=1');}
    catch {historyError='历史读取失败，当前只搜索已加载的记录。';}
    finally {historyLoading=false; if (!destroyed) render();}
  }
  async function getJSON(url) {const r = await fetch(url,{cache:'no-store'}); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();}
  async function refreshDiscovery() {
    try {
      const found = await getJSON('/dsh-life/api/candidates');
      if (destroyed) return;
      candidates = found.files; discoveryLoaded = true;
      discoveryError = found.truncated ? '候选文件较多，只列出前一部分。' : '';
      const wanted = [...added];
      const results = await Promise.allSettled(wanted.map(id => getJSON(`/dsh-life/api/candidate?id=${encodeURIComponent(id)}`)));
      if (destroyed || JSON.stringify(wanted) !== JSON.stringify(added)) return;
      files = results.filter(x=>x.status==='fulfilled').map(x=>x.value);
      fileErrors = results.flatMap((x,i)=>x.status==='rejected' ? [`${candidates.find(c=>c.id===wanted[i])?.label || '已选来源'}读取失败`] : []);
    } catch (error) {discoveryLoaded = true; discoveryError = `来源发现失败（${error.message}）。`;}
    if (!destroyed) render();
  }
  shadow.addEventListener('click', event => {
    const summary = event.target.closest('summary');
    if (summary) {const detail=summary.parentElement, key=detail.closest('[data-read-key]')?.dataset.readKey; if (key && !detail.open && detail.matches('.video-card-sources')) setTimeout(()=>markRead(key),0);}
    const link = event.target.closest('a.video-card-link');
    if (link) {const key=link.closest('[data-read-key]')?.dataset.readKey; if (key) setTimeout(()=>markRead(key),0);}
    const target = event.target.closest('button');
    if (!target) return;
    if (target.matches('.bubble')) setOpened(true);
    else if (target.matches('.expand-content')) {const key=target.dataset.expandKey; if (expandedContent.has(key)) expandedContent.delete(key); else {expandedContent.add(key); if (target.dataset.readKey) unreadState?.unread.delete(target.dataset.readKey); if (unreadState) saveUnread();} render();}
    else if (target.matches('.close')) {setOpened(false); $('.bubble').focus();}
    else if (target.matches('.refresh')) {refresh(); controller?.refresh();}
    else if (target.matches('.exclude-session')) controller?.exclude(target.dataset.sessionId,target.dataset.excluded !== 'true');
    else if (target.matches('.event-open')) controller?.open(target.dataset.sessionId);
    else if (target.matches('.more-events')) {visibleCount += pageSize; render();}
    else if (target.matches('.read-one')) markRead(target.dataset.readKey);
    else if (target.matches('.mark-all')) {for (const item of unreadItems(overview?.events || [])) if (filter === 'all' || filter === item.category) unreadState.unread.delete(item.key); saveUnread(); render();}
    else if (target.matches('.add-source')) {
      const id = $('.candidate').value;
      if (id && !added.includes(id) && added.length < 5) {added.push(id); localStorage.setItem(storedSourcesKey,JSON.stringify(added)); render(); refreshDiscovery();}
    }
    else if (target.matches('.remove-source')) {added = added.filter(id=>id!==target.dataset.sourceId); files = files.filter(file=>file.id!==target.dataset.sourceId); localStorage.setItem(storedSourcesKey,JSON.stringify(added)); render(); refreshDiscovery();}
    else if (target.dataset.filter) {filter = target.dataset.filter; visibleCount = pageSize; for (const button of shadow.querySelectorAll('[data-filter]')) button.setAttribute('aria-pressed', String(button === target)); render();}
  });
  shadow.addEventListener('input', event => {if (event.target.matches('.life-search')) {query=event.target.value; visibleCount=pageSize; render(); if (query.trim()) loadHistory();}});
  shadow.addEventListener('change', event => {if (event.target.matches('.candidate')) $('.add-source').disabled = !event.target.value || added.length >= 5;});
  const timer = setInterval(() => {if (!document.hidden) refresh();}, 30000);
  setOpened(embedded); render();
  if (!embedded) refresh();
  return {
    update(next) {snapshot = next; render();},
    setController(value) {controller = value; sessionView = value.view(); controller.setActive(opened); render();},
    setSessionView(value) {sessionView = value; render();},
    reset() {snapshot = null; render();},
    show: () => setOpened(true),
    destroy() {destroyed = true; clearInterval(timer); root.remove();},
  };
}


const React = require('react');
exports.name = 'dsh-life-window';
exports.inject = ['slots', 'sessions', 'connection'];
exports.apply = function(ctx) {
  const life = createLifeWindow({css: ":host {\n  all: initial; color-scheme: light; font-family: \"Segoe UI\", \"Microsoft YaHei\", system-ui, sans-serif;\n  color: #173f54; font-size: 14px;\n  --ink: #173f54; --muted: #526f7e; --blue: #22688b; --line: #dce9ec;\n  --surface: #ffffff; --mist: #f1f7f7; --mint: #429b82;\n}\n* { box-sizing: border-box; }\nbutton { font: inherit; cursor: pointer; }\nbutton:focus-visible, summary:focus-visible, a:focus-visible, select:focus-visible { outline: 3px solid #2679a1; outline-offset: 2px; }\n[hidden] { display: none !important; }\n.bubble {\n  position: fixed; right: 20px; bottom: 22px; z-index: 2147482000;\n  display: flex; align-items: center; gap: 9px; padding: 7px 15px 7px 8px;\n  border: 1px solid #d4e4e7; border-radius: 999px; background: #fff; color: var(--ink);\n  box-shadow: 0 8px 28px #173c5d25; font-weight: 700; font-size: 13px;\n}\n.bubble:hover { background: #f4fafb; }\n.bubble-wave, .brand-mark { display: grid; place-items: center; flex: none; width: 34px; height: 34px; border-radius: 12px; background: #dceff2; }\n.bubble-wave svg, .brand-mark svg { width: 28px; height: 28px; fill: #6ca7be; }\n.bubble-wave svg circle, .brand-mark svg circle { fill: #16465c; }\n.bubble i, .eyebrow i, footer i { width: 7px; height: 7px; border-radius: 50%; background: var(--mint); display: inline-block; flex: none; }\n.window {\n  position: fixed; right: 20px; bottom: 22px; z-index: 2147482000;\n  width: min(400px, calc(100vw - 24px)); max-height: min(780px, calc(100dvh - 30px));\n  display: flex; flex-direction: column; overflow: hidden; border: 1px solid #d7e5e8;\n  border-radius: 24px; background: #fbfdfc; box-shadow: 0 20px 65px #163a502b, 0 3px 12px #163a5012;\n}\n.top { padding: 17px 18px 15px; display: flex; align-items: center; justify-content: space-between; flex: none; background: #fff; }\n.brand { display: flex; align-items: center; gap: 10px; }\n.brand strong { display: block; font-size: 15px; letter-spacing: .03em; }\n.brand small { display: block; color: #67818d; font-size: 10px; letter-spacing: .09em; margin-top: 3px; }\n.brand-mark { width: 38px; height: 38px; border-radius: 13px; }\n.top-actions { display: flex; gap: 4px; }\n.icon { display: grid; place-items: center; border: 0; background: #f4f8f8; color: #4b7181; width: 34px; height: 34px; border-radius: 11px; font-size: 21px; line-height: 1; }\n.icon:hover { background: #e4f1f2; }\n.icon:disabled { opacity: .45; }\nmain { overflow-y: auto; overscroll-behavior: contain; padding: 5px 17px 20px; scrollbar-width: thin; scrollbar-color: #c6dce0 transparent; }\n.hero {\n  position: relative; isolation: isolate; overflow: hidden; min-height: 146px;\n  display: flex; align-items: center; justify-content: space-between; gap: 4px;\n  padding: 18px 15px 19px 18px; border: 1px solid #d5e9eb; border-radius: 19px;\n  background: linear-gradient(125deg, #e7f5f4 0%, #e8f3f8 72%, #d9edf3 100%);\n}\n.hero::before { content: \"\"; position: absolute; z-index: -1; width: 190px; height: 190px; right: -55px; bottom: -125px; border: 1px solid #ffffffa8; border-radius: 50%; box-shadow: 0 0 0 14px #ffffff2c, 0 0 0 28px #ffffff24, 0 0 0 42px #ffffff1c; }\n.hero[data-state=\"error\"] { background: #fcf0ec; border-color: #f2ded6; }\n.hero[data-state=\"waiting\"], .hero[data-state=\"approval\"] { background: #fbf5e8; border-color: #f1e6ce; }\n.hero-copy { min-width: 0; flex: 1; }\n.eyebrow { display: flex; align-items: center; gap: 6px; color: #3e7280; font-size: 11px; letter-spacing: .03em; }\n.status { color: #173e50; font-size: 21px; line-height: 1.28; margin: 13px 0 7px; overflow-wrap: anywhere; }\n.description { color: #4b6d79; font-size: 12px; line-height: 1.6; margin: 0; max-width: 205px; }\n.whale { flex: 0 0 110px; position: relative; overflow: hidden; border: 3px solid #ffffffd9; border-radius: 22px; background: #fff; box-shadow: 0 6px 16px #49809a24; }\n.whale img { display: block; width: 100%; height: auto; }\n.schedule { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 11px; padding: 13px 14px; border: 1px solid var(--line); border-radius: 15px; background: #fff; }\n.schedule-kicker, .kicker { display: block; color: #63818a; font-size: 10px; letter-spacing: .10em; font-weight: 700; }\n.schedule-title { display: block; margin-top: 5px; color: var(--ink); font-size: 13px; }\n.schedule-detail { margin: 4px 0 0; color: var(--muted); font-size: 11px; line-height: 1.5; }\n.schedule-time { flex: none; white-space: nowrap; padding: 6px 8px; border-radius: 9px; background: #eff7f6; color: #236a7c; font-size: 12px; font-weight: 700; }\n.schedule-time:empty { display: none; }\n.binding { margin-top: 10px; color: var(--muted); font-size: 11px; }\n.binding summary { cursor: pointer; list-style: none; display: flex; align-items: center; justify-content: space-between; padding: 9px 11px; border-radius: 11px; background: #f1f6f6; color: #486d79; font-size: 11px; font-weight: 600; }\n.binding summary::after { content: '+'; font-size: 15px; font-weight: 400; }\n.binding[open] summary::after { content: '−'; }\n.binding p { font-size: 11px; line-height: 1.55; color: var(--muted); margin: 8px 2px; }\n.session-choices { display: grid; gap: 2px; max-height: 170px; overflow: auto; margin: 8px 0; }\n.detected-session { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 3px; border-bottom: 1px solid #e6eff0; }\n.detected-copy { display: grid; gap: 4px; min-width: 0; }\n.detected-copy strong { color: var(--ink); overflow-wrap: anywhere; }\n.detected-copy span { color: var(--muted); font-size: 11px; }\n.exclude-session { flex: none; border: 1px solid #cbdfe3; border-radius: 8px; background: #fff; color: #315f78; padding: 7px 9px; font-size: 11px; }\n.choice-empty { color: #678391; }\n.feed { margin-top: 24px; }\n.feed-heading { display: flex; align-items: end; justify-content: space-between; gap: 10px; }\n.feed-heading h3 { color: var(--ink); font-size: 18px; line-height: 1.3; margin: 5px 0 0; }\n.feed-count { color: #69818a; font-size: 11px; white-space: nowrap; }\n.filters { display: flex; flex-wrap: wrap; gap: 6px; margin: 14px 0 16px; }\n.filters button { min-height: 34px; border: 1px solid #e1ebec; border-radius: 10px; background: #fff; color: #536f7b; padding: 6px 10px; font-size: 12px; }\n.filters button[aria-pressed=\"true\"] { border-color: #b6dedc; background: #dff2ef; color: #176678; font-weight: 700; }\n.filters button:hover { background: #edf7f6; }\n.events { display: grid; }\n.event { display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: 10px; }\n.rail { position: relative; display: flex; justify-content: center; }\n.rail:after { content: \"\"; position: absolute; top: 14px; bottom: -1px; width: 1px; background: #d6e8e8; }\n.event:last-child .rail:after { display: none; }\n.dot { width: 8px; height: 8px; margin-top: 4px; background: #70b0b3; border: 3px solid #e4f1ef; border-radius: 50%; z-index: 1; box-sizing: content-box; }\n.event.error .dot { background: #cb8377; }.event.good .dot { background: #65aa91; }\n.event-content { min-width: 0; padding-bottom: 19px; }\n.event-meta { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; color: #68828a; font-size: 11px; }\n.source-tag { background: #edf5f4; color: #4c7780; border-radius: 6px; padding: 3px 6px; }\n.event h4 { color: var(--ink); font-size: 13px; margin: 7px 0 5px; line-height: 1.45; overflow-wrap: anywhere; }\n.event-text { color: #4b6877; font-size: 12px; line-height: 1.7; margin: 0; overflow-wrap: anywhere; }\n.event-detail { margin-top: 7px; }.event-detail summary { color: #287495; font-size: 12px; cursor: pointer; list-style: none; }\n.event-detail summary::before { content: '+ '; }.event-detail[open] summary::before { content: '− '; }\n.detail-text { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 9px; padding: 12px; background: #edf6f5; border-radius: 11px; color: #315867; font-size: 12px; line-height: 1.75; max-height: 240px; overflow: auto; }\n.video-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }.video-links a { color: #236b8d; font-size: 12px; }\n.provenance { color: #728c95; font-size: 10px; line-height: 1.6; margin-top: 8px; overflow-wrap: anywhere; }\n.empty { color: #617f89; font-size: 12px; line-height: 1.7; padding: 13px; border: 1px dashed #d6e7e7; border-radius: 12px; background: #f7fbfa; }\n.video-card { border: 1px solid #dce9e9; border-radius: 16px; padding: 14px; margin-bottom: 10px; background: #fff; box-shadow: 0 3px 10px #294f5510; }\n.video-card-header { display: flex; align-items: center; gap: 11px; }\n.video-card-mark { display: grid; place-items: center; flex: none; width: 44px; height: 44px; border-radius: 14px; background: linear-gradient(145deg, #dff3ed, #d9edf6); color: #38879a; font-size: 14px; }\n.video-card-heading { min-width: 0; }.video-card-id { font-size: 10px; letter-spacing: .04em; color: #62858e; }\n.video-card h4 { color: var(--ink); font-size: 14px; line-height: 1.45; margin: 4px 0 0; overflow-wrap: anywhere; }\n.video-card-reason, .video-card-sources p { font-size: 12px; line-height: 1.7; color: #4b6877; overflow-wrap: anywhere; }\n.video-card-reason { margin: 12px 0 8px; }.video-card-source { font-size: 11px; color: #6c858d; overflow-wrap: anywhere; }\n.video-card-link { display: inline-block; color: #1d6c8b; font-size: 12px; font-weight: 700; padding: 8px 0; }\n.video-card-sources summary { cursor: pointer; font-size: 12px; color: #317895; }.video-card-sources p { margin: 8px 0; }\n.sources { border-top: 1px solid #e4eeee; padding-top: 14px; margin-top: 4px; }\n.sources summary { cursor: pointer; list-style: none; color: #526f7c; font-size: 12px; display: flex; justify-content: space-between; padding: 5px 0; }\n.sources p { color: #67818b; font-size: 11px; line-height: 1.6; }.source-list { padding-top: 9px; }\n.source-row { display: flex; justify-content: space-between; gap: 8px; padding: 5px 0; font-size: 11px; color: #567688; }\n.source-row span { overflow-wrap: anywhere; }.source-row strong { white-space: nowrap; font-weight: 500; }.source-error { color: #a33c33 !important; overflow-wrap: anywhere; }\n.discovery { border-top: 1px solid #e7eff2; margin-top: 12px; padding-top: 12px; }.discovery strong { font-size: 12px; }\n.source-picker { display: flex; gap: 7px; }.source-picker select { min-width: 0; flex: 1; border: 1px solid #cbdfe3; border-radius: 8px; background: #fff; color: #244d63; padding: 7px; font: inherit; font-size: 11px; }\n.source-picker button, .remove-source { border: 1px solid #cbdfe3; border-radius: 8px; background: #fff; color: #315f78; padding: 7px 9px; font-size: 11px; }\n.source-picker button:disabled { opacity: .45; cursor: not-allowed; }.selected-source { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; color: #547388; padding: 4px 0; }.selected-source span { min-width: 0; overflow-wrap: anywhere; }\n.event-open, .more-events { border: 0; background: transparent; color: #276c90; font-size: 11px; padding: 8px 0; }.more-events { font-weight: 700; }\nfooter { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: none; border-top: 1px solid #e5eeee; padding: 11px 18px; background: #fff; color: #6e8990; font-size: 10px; }\nfooter span:first-child { display: flex; align-items: center; gap: 6px; }\n:host([data-embedded]) .window { position: relative; right: auto; bottom: auto; width: 100%; max-height: none; box-shadow: 0 15px 45px #193c5d1a; }\n:host([data-embedded]) main { overflow: visible; }:host([data-embedded]) .close { display: none; }\n@media (max-width: 500px) { .window { right: 12px; bottom: 12px; max-height: calc(100dvh - 24px); }.bubble { right: 12px; bottom: 12px; } }\n@media (prefers-reduced-motion: no-preference) { button { transition: background .15s ease, border-color .15s ease, opacity .15s ease; } }\r\n/* Readable compact layout: let category controls wrap rather than shrinking text. */\n:host { font-size: 16px; }\n.window { width: min(430px, calc(100vw - 24px)); }\n.brand strong, .video-card h4 { font-size: 16px; }\n.description, .schedule-detail, .event-text, .detail-text, .video-card-reason, .video-card-sources p, .empty { font-size: 14px; line-height: 1.7; }\n.schedule-title, .event h4, .filters button { font-size: 14px; }\n.eyebrow, .schedule-kicker, .kicker, .feed-count, .event-meta, .source-tag, .provenance, .video-card-id, .video-card-source, .binding, .binding summary, .binding p, .sources p, .source-row, footer { font-size: 12px; }\n.video-card-link, .video-card-sources summary, .event-detail summary, .sources summary, .event-open, .more-events { font-size: 13px; }\n.filters button { min-height: 38px; }\n.search-label { display:block; margin-top:14px; font-size:13px; font-weight:700; color:var(--ink); }\n.life-search { display:block; width:100%; min-height:42px; margin-top:6px; padding:9px 11px; border:1px solid #bfd6da; border-radius:10px; background:#fff; color:var(--ink); font:inherit; font-size:14px; }\n.search-hint { color:#536f7b; font-size:12px; line-height:1.5; margin:6px 0 0; }\n.bubble-unread { display:grid; place-items:center; min-width:23px; height:23px; padding:0 5px; border-radius:12px; background:#287f87; color:#fff; font-size:12px; }\n.read-one, .mark-all { border:0; border-radius:8px; background:#e4f4ef; color:#166a60; padding:7px 9px; font-size:12px; font-weight:700; }\n.read-one { margin-top:8px; }.mark-all { margin:0 0 12px; }\n.long-content summary { color:#246f8e; cursor:pointer; font-size:13px; }\n.long-content p { white-space:pre-wrap; overflow-wrap:anywhere; font-size:14px; line-height:1.7; color:#4b6877; }\n.expanded-text { white-space:pre-wrap; overflow-wrap:anywhere; }\n.expand-content { border:0; background:transparent; color:#246f8e; cursor:pointer; font-size:13px; padding:7px 0; }\n.source-entry-meta { color:#67818b; font-size:12px !important; margin:10px 0 4px !important; }\n.source-entry-reason { margin:4px 0 !important; }\n"});
  const controller = createSessionController(ctx.sessions, ctx.connection.api, view => life.setSessionView(view));
  life.setController(controller);
  controller.refresh();
  function Bridge(props) {
    React.useEffect(() => () => controller.clearCurrent(props.sessionId), [props.sessionId]);
    React.useEffect(() => {controller.setCurrent(props.session);}, [props.session]);
    return null;
  }
  ctx.effect(() => ctx.slots.register({name:'conversation.input.left', id:'dsh-life-window', order:210}, Bridge));
  ctx.effect(() => () => controller.destroy());
  ctx.effect(() => () => life.destroy());
};
return module.exports;}});
