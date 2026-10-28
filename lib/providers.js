import {readdir, open, realpath} from 'node:fs/promises';
import path from 'node:path';

const string = (value, limit) => typeof value === 'string' ? value.trim().slice(0,limit) : '';
const stamp = value => typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;

// Optional exchange format: producers publish only entries meant for this window.
// It is not an existing DSH standard and never executes producer-supplied actions.
export function parseProvider(value, file) {
  if (!value || value.version !== 1 || !/^[a-zA-Z0-9._-]{1,80}$/.test(value.providerId || '') || !Array.isArray(value.events)) throw new Error('不符合生活窗 v1 来源格式');
  const name = string(value.name,80) || value.providerId, publishedAt = stamp(value.updatedAt);
  if (!Number.isFinite(publishedAt)) throw new Error('来源缺少有效更新时间');
  const events = value.events.slice(0,100).flatMap(event => {
    const id = string(event?.id,120), title = string(event?.title,200), time = stamp(event?.time);
    if (!id || !title || !Number.isFinite(time)) return [];
    const text = string(event.text,6000), category = ['activity','diary','letter'].includes(event.kind) ? event.kind : 'activity';
    return [{id:`provider:${value.providerId}:${id}`,time,category,tone:'neutral',title,text:text.slice(0,200),detail:text,source:name,sourceId:`${file} · ${id}`,sessionId:string(event.sessionId,200) || undefined}];
  });
  return {source:{file:`生活来源 · ${name}`,status:'ready',updatedAt:publishedAt},events};
}

export async function readProviders(home) {
  let entries, dir;
  try {
    const root = await realpath(home);
    dir = await realpath(path.join(root,'life-window','providers'));
    const relative = path.relative(root,dir);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('生活来源目录不在 DSH 数据目录中');
    entries = await readdir(dir,{withFileTypes:true});
  } catch(error) {if(error.code === 'ENOENT') return {sources:[],events:[],issues:[]}; throw error;}
  const sources = [], events = [], issues = [];
  for (const entry of entries.filter(e=>e.isFile() && !e.isSymbolicLink() && /^[a-zA-Z0-9._-]+\.json$/.test(e.name)).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,20)) {
    try {
      const handle = await open(path.join(dir,entry.name),'r');
      let text;
      try {const info = await handle.stat(); if (!info.isFile() || info.size > 256*1024) throw new Error('来源不是普通文件或超过 256 KiB'); text = await handle.readFile('utf8');} finally {await handle.close();}
      const provider = parseProvider(JSON.parse(text.replace(/^\uFEFF/,'')),entry.name);
      sources.push(provider.source); events.push(...provider.events);
    } catch (error) {sources.push({file:`生活来源 · ${entry.name}`,status:'error'}); issues.push(`${entry.name}：${error.message}`);}
  }
  return {sources,events,issues};
}
