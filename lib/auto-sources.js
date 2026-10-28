import {open, readdir, realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {discoverFiles, readCandidate} from './discovery.js';
import {diaryEvents, visibleDiaryText} from './sources.js';

const hash = value => createHash('sha256').update(value).digest('hex').slice(0,16);
const dateIn = value => value.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
const isFishPath = label => /(?:whale|fish|bili|pod|鱼|鲸)/i.test(label);
const privatePart = /给自己|私密|私人|仅自己|不发|未发送|private/i;

// Owner directories are explicitly addressed to the user; mixed files require
// the existing addressed-section parser, never arbitrary diary contents.
export function ownerLetter(text, label, updatedAt) {
  const date = dateIn(label);
  if (!date) return [];
  const body = visibleDiaryText(text, true);
  if (!body) return [];
  return [{id:`auto-letter:${hash(label+body)}`,time:Date.parse(`${date}T12:00:00`),dateOnly:true,category:'letter',tone:'good',title:`${date} · 写给你的信`,text:body.replace(/[#*>`]/g,'').replace(/\s+/g,' ').trim().slice(0,170),detail:body.slice(0,12000),source:'自动发现的信件',sourceId:label,updatedAt}];
}

// Reports have BV headings and labelled fields. Never expose unlabelled body,
// conversation text, logs, credentials or private sections as recommendations.
export function reportVideos(text, label, updatedAt) {
  const date = dateIn(label);
  if (!date) return [];
  const sections = text.split(/(?=^#{2,5}\s+.*\bBV[0-9A-Za-z]{10}\b)/m).slice(1);
  return sections.flatMap(section => {
    const [heading,...lines] = section.split(/\r?\n/);
    const videoId = heading.match(/\bBV[0-9A-Za-z]{10}\b/)?.[0];
    if (!videoId || privatePart.test(heading)) return [];
    let title = '', reason = '';
    for (const line of lines) {
      if (/^#{1,6}\s/.test(line)) break;
      const clean = line.replace(/\*\*/g,'').replace(/^\s*[-*]\s*/, '').trim();
      const field = /^(标题|视频标题|为什么值得|推荐理由|推荐原因|推荐语)\s*[：:]\s*(.+)$/.exec(clean);
      if (!field || privatePart.test(field[2]) || /(?:cookie|token|secret|password|凭据|密码|密钥)|[A-Za-z]:[\\/]|~[\\/]/i.test(field[2])) continue;
      if (/标题/.test(field[1])) title ||= field[2].slice(0,160);
      else reason ||= field[2].slice(0,600);
    }
    if (!title && !reason) return [];
    return [{id:`auto-video:${hash(label+heading+title+reason)}`,time:Date.parse(`${date}T12:00:00`),dateOnly:true,category:'video',tone:'good',videoId,videoTitle:title,title:title || videoId,text:reason,source:'自动发现的日报',sourceId:label,updatedAt}];
  }).slice(0,100);
}

export async function readAutoSources(home, legacyReportDir, history = false) {
  const found = await discoverFiles(home), events = [], sources = [], issues = [];
  const matches = found.files.filter(file => {
    const label = file.label;
    if (!/\.(?:md|markdown|txt)$/i.test(label) || !isFishPath(label) || label === 'whale-diary.md') return false;
    const owner = dateIn(label) && /(?:^|\/)(?:owner|给主人|给你的)(?:\/)/i.test(label) && /(?:diary|journal|日记)/i.test(label);
    const report = dateIn(label) && /(?:^|\/)(?:out|report|reports|digest|日报)(?:\/)/i.test(label);
    const mixed = /(?:diary|journal|日记)/i.test(label) && !/(?:^|\/)(?:daily|archive|records)(?:\/)/i.test(label);
    return owner || report || mixed;
  }).slice(0,history ? 100 : 30);
  for (const item of matches) {
    try {
      const file = await readCandidate(home,item.id,found.files,128*1024);
      const owner = /(?:^|\/)(?:owner|给主人|给你的)(?:\/)/i.test(file.label);
      const report = /(?:^|\/)(?:out|report|reports|digest|日报)(?:\/)/i.test(file.label);
      const extracted = owner ? ownerLetter(file.text,file.label,file.updatedAt) : report ? reportVideos(file.text,file.label,file.updatedAt) : diaryEvents(file.text,file.updatedAt,file.label,history ? 500 : 20);
      if (extracted.length) {events.push(...extracted); sources.push({file:`自动发现 · ${file.label}`,status:file.truncated?'tail':'ready',updatedAt:file.updatedAt});}
    } catch (error) {issues.push(`自动来源 ${item.label}：${error.message}`);}
  }
  if (legacyReportDir) {
    try {
      // Only a fixed output directory, not its credential-bearing parent.
      const root = await realpath(legacyReportDir);
      if (path.resolve(root) !== path.resolve(legacyReportDir)) throw new Error('日报目录包含符号链接');
      const entries = (await readdir(root,{withFileTypes:true})).filter(e=>e.isFile() && !e.isSymbolicLink() && /^\d{4}-\d{2}-\d{2}\.md$/i.test(e.name)).sort((a,b)=>b.name.localeCompare(a.name)).slice(0,history ? 100 : 20);
      for (const entry of entries) {
        const handle = await open(path.join(root,entry.name),'r');
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size > 128*1024) continue;
          const text = await handle.readFile('utf8');
          const label = `.bili-ai/out/${entry.name}`, extracted = reportVideos(text,label,stat.mtimeMs);
          if (extracted.length) {events.push(...extracted); sources.push({file:`自动发现 · ${label}`,status:'ready',updatedAt:stat.mtimeMs});}
        } finally {await handle.close();}
      }
    } catch (error) {if (error.code !== 'ENOENT') issues.push(`自动日报：${error.message}`);}
  }
  return {events,sources,issues,truncated:found.truncated || matches.length === (history ? 100 : 30)};
}
