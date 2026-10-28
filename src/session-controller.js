import {sessionState} from './model.js';

export function summaryState(summary) {
  if (!summary) return {id:'disconnected',label:'会话暂不可用',description:'会话可能已移除，或当前宿主无法访问。'};
  if (summary.pendingInteraction === 'approval' || summary.pendingInteraction === 'plan-review') return {id:'approval',label:'等你点个头',description:'该会话需要你处理确认。'};
  if (summary.pendingInteraction === 'question') return {id:'waiting',label:'有件事想问你',description:'打开会话，回答问题后就能继续。'};
  if (summary.running) return {id:'working',label:'正在忙一件事',description:'该会话正在运行；打开会话可查看实时细节。'};
  return {id:'idle',label:'当前没有运行任务',description:'来自 DSH 会话列表；独立后台活动可能不在此宿主中。'};
}

export const ALL_SESSIONS = '__all_sessions__';
const IDENTITY = /^(?:dsh[-_])?(?:bili[-_](?:whale|pond|scroll|pod|fish|duty|subagent|merlin)|(?:whale|fish|pod)[-_]work)(?:[-_][\w-]+)?$/i;
const TOOL = /(?:^|__)(?:bili|bilibili)[_-](?:search|feed|popular|recommend|recommendation|video|detail|view|subtitle|subtitles|danmaku|comments?|reply|diary|pick|favorite|fav|watch|dynamic|dm|history|hot|rank)(?:$|[_-])/i;
const SHELL = /(?:^|__)(?:bash|pwsh|powershell|shell|exec|execute|terminal|command|run_command|exec_command)$/i;
const FILE_TOOL = /(?:^|__)(?:read|write|edit|read_file|write_file|edit_file|str_replace_editor)$/i;
const FISH_FILE = /(?:^|[\\/])(?:whale-(?:diary|outbox|log)\.(?:md|jsonl)|bili-duty[\\/](?:(?:out|digest)[\\/][^\\/]+\.md|seen\.md)|bili-fish[\\/]diary[\\/][^\\/]+\.md|pod-diary[\\/]owner[\\/]\d{4}-\d{2}-\d{2}\.md)$/i;
const BILI_SCRIPT = /(?:^|[;&|]\s*)\s*(?:&\s*)?(?:node(?:\.exe)?|"[^"\r\n]*[\\/]node(?:\.exe)?"|'[^'\r\n]*[\\/]node(?:\.exe)?')\s+(?:"[^"\r\n]*bili\.mjs"|'[^'\r\n]*bili\.mjs'|[^\s;"']*bili\.mjs)\s+(?:feed|search|popular|debrief|subtitles|watch-video|diary|comment-digest|comment-await|dm-await|night|fav|reply-draft|quota|video-content)(?:\s|$|["'])/i;

export function metadataFingerprint(row) {
  const directory = String(row.cwd || '').split(/[\\/]/).filter(Boolean).at(-1) || '';
  if (IDENTITY.test(String(row.id || ''))) return '养鱼插件专用会话标识';
  if (IDENTITY.test(directory)) return '养鱼插件专用工作目录';
  return '';
}

export function toolFingerprint(name, raw = '') {
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

export function historyFingerprint(entries) {
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
export function createSessionController(sessions, api, notify, storage = globalThis.localStorage) {
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
