import {readdir, realpath, stat, open} from 'node:fs/promises';
import path from 'node:path';

const MAX_DIRS = 350, MAX_FILES = 100, MAX_BYTES = 128 * 1024;
const excluded = /(?:^\.|credentials?|cookie|secret|token|password|passwd|private|私密|隐私|私人|给自己|仅自己|未发送|不发|凭据|凭证|密码|密钥|口令|备份|backup|\.bak|settings|config|sessions|node_modules|cache|lock)/i;
const relevant = /(?:fish|whale|bili|diary|journal|report|digest|outbox|生活|鱼|鲸|日记|日报|分享|回忆|记忆)/i;
const extension = /\.(?:md|markdown|txt|json|jsonl)$/i;

export async function discoverFiles(home) {
  let root;
  try {root = await realpath(home);} catch (error) {if (error.code === 'ENOENT') return {files:[],truncated:false}; throw error;}
  const queue = [{dir:root,rel:'',depth:0}], files = [];
  let visited = 0, truncated = false;
  while (queue.length) {
    if (visited >= MAX_DIRS || files.length >= MAX_FILES) {truncated = true; break;}
    const item = queue.shift(); visited++;
    let entries;
    try {entries = await readdir(item.dir,{withFileTypes:true});} catch (error) {if (['ENOENT','EACCES','EPERM'].includes(error.code)) continue; throw error;}
    entries.sort((a,b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (excluded.test(ent.name) || ent.isSymbolicLink()) continue;
      const relative = path.join(item.rel,ent.name), full = path.join(item.dir,ent.name);
      if (ent.isDirectory() && item.depth < 4) {queue.push({dir:full,rel:relative,depth:item.depth+1}); continue;}
      if (!ent.isFile() || !extension.test(ent.name) || !relevant.test(relative)) continue;
      try {
        const info = await stat(full);
        const id = Buffer.from(relative,'utf8').toString('base64url');
        files.push({id, label:relative.split(path.sep).join('/'), updatedAt:info.mtimeMs, size:info.size});
        if (files.length >= MAX_FILES) {truncated = true; break;}
      } catch (error) {if (!['ENOENT','EACCES','EPERM'].includes(error.code)) throw error;}
    }
  }
  return {files:files.sort((a,b)=>b.updatedAt-a.updatedAt), truncated};
}

export async function readCandidate(home, id, knownFiles, maxChars = 12000) {
  // Re-discover every read: callers cannot use this endpoint as an arbitrary file reader.
  const candidates = knownFiles ? {files:knownFiles} : await discoverFiles(home);
  const candidate = candidates.files.find(item => item.id === id);
  if (!candidate) {const error = new Error('候选文件不存在或不可用'); error.code = 'NOT_FOUND'; throw error;}
  const root = await realpath(home), file = await realpath(path.join(root, ...candidate.label.split('/')));
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith(`..${path.sep}`) || rel === '..' || path.isAbsolute(rel)) {const error = new Error('文件不在数据目录内'); error.code = 'NOT_FOUND'; throw error;}
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('来源不是普通文件');
    const length = Math.min(info.size,MAX_BYTES), buffer = Buffer.alloc(length);
    const {bytesRead} = await handle.read(buffer,0,length,Math.max(0,info.size-length));
    let text = buffer.subarray(0,bytesRead).toString('utf8').replace(/^\uFEFF/,'');
    if (info.size > length) {const newline = text.indexOf('\n'); if (newline >= 0) text = text.slice(newline+1);}
    return {id, label:candidate.label, updatedAt:info.mtimeMs, text:text.slice(-maxChars), truncated:info.size > length || text.length > maxChars};
  } finally {await handle.close();}
}
