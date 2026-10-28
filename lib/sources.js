import {open} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {namedTask, readScheduledTask, taskSchedule} from './scheduler.js';

const LIMIT = 256 * 1024;
const digest = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
const summary = text => text.replace(/[#*>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 170);

async function readSource(home, file, tail = false, configPath) {
  let handle;
  try {
    handle = await open(file === 'bili-whale.config.json' && configPath ? configPath : path.join(home, file), 'r');
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`${file} 不是文件`);
    if (!tail && info.size > LIMIT) throw new Error(`${file} 超过 256 KiB，无法解析`);
    const length = Math.min(info.size, LIMIT), buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, tail ? Math.max(0, info.size - length) : 0);
    let text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    if (tail && info.size > length) text = text.slice(text.indexOf('\n') + 1);
    return {text, mtime: info.mtimeMs, truncated: info.size > length};
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally { if (handle) await handle.close(); }
}

export function scheduleView(config, plan, now = Date.now()) {
  if (!config) return {mode: 'missing', label: '还没有接入 B站作息', detail: '安装并配置 dsh-bili-whale 后，会在这里显示计划。', at: null};
  if (!config.night || typeof config.night !== 'object') return {mode: 'unknown', label: '作息配置尚不完整', detail: '去 DSH 设置里的「养鱼」查看作息。', at: null};
  const configured = Array.isArray(config.night.windows) ? config.night.windows : [{start: config.night.windowStart ?? '20:00', end: config.night.windowEnd ?? '24:00', wakes: config.night.maxWakesPerDay ?? 1}];
  const windows = configured.filter(w => w && Number(w.wakes ?? 1) > 0);
  if (!windows.length) return {mode: 'paused', label: '插件生物钟未安排', detail: '插件作息没有安排唤醒；其他调度方式的状态需要另行确认。', at: null};
  if (plan && !plan.done && !plan.fired && !plan.woke && ['wake', 'skip'].includes(plan.action) && Number.isFinite(plan.atMs) && Number.isFinite(plan.endsAt) && plan.endsAt > now) {
    if (plan.atMs <= now) return {mode: 'overdue', label: '计划时间已到，待核实执行', detail: '这里只读计划文件，尚未取得新的执行结果。', at: plan.atMs};
    return {mode: 'planned', label: plan.action === 'skip' ? '下一次计划：休息' : '下一次计划活动', detail: '来自养鱼插件已保存的计划；调度器是否在线需在原插件确认。', at: plan.atMs};
  }
  return {mode: 'window', label: '已设置活动时段', detail: windows.map(w => `${String(w.start)}–${String(w.end)} · ${Number(w.wakes ?? 1)} 次`).join(' / ').slice(0, 200), at: null};
}

// Privacy markers take precedence over recipient markers, including throughout
// nested headings. An owner-only file starts visible; mixed diaries do not.
export function visibleDiaryText(text, defaultVisible = false) {
  const stack = [{level:0, visible:defaultVisible, blocked:false}], selected = [];
  for (const line of text.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.+)/.exec(line);
    if (heading) {
      const level = heading[1].length;
      while (stack.at(-1).level >= level) stack.pop();
      const parent = stack.at(-1), title = heading[2];
      const blocked = parent.blocked || /给自己|仅自己|私人|私密|隐私|不发|未发送|想说|暂停说明|private|unsent/i.test(title);
      const addressed = /给主人|给你的|给你的一封信|给主人的|to (?:you|owner)/i.test(title);
      stack.push({level, blocked, visible:!blocked && (parent.visible || addressed)});
    }
    if (stack.at(-1).visible) selected.push(line);
  }
  return selected.join('\n').trim();
}

// A mixed diary is public only within an explicitly addressed section.
export function diaryEvents(text, mtime, source = 'whale-diary.md', limit = 20) {
  const sections = text.split(/^##\s+/m).slice(1);
  return sections.flatMap(section => {
    const [heading, ...lines] = section.split('\n');
    const date = heading.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
    if (!date) return [];
    const body = visibleDiaryText(lines.join('\n'));
    if (!body) return [];
    const time = Date.parse(`${date}T12:00:00`);
    return [{id: `diary:${digest(heading + body)}`, time, dateOnly: true, category: 'diary', tone: 'good', title: heading.trim(), text: summary(body), detail: body.slice(0, 12000), source, sourceId: heading.trim(), updatedAt: mtime}];
  }).slice(-limit);
}

export function outboxEvents(text, mtime, limit = 20) {
  return text.split(/^##\s+/m).slice(1).flatMap(section => {
    const [heading, ...lines] = section.split('\n');
    const date = heading.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1], body = lines.join('\n').trim();
    if (!date || !body) return [];
    return [{id: `letter:${digest(heading + body)}`, time: Date.parse(`${date}T12:00:00`), dateOnly: true, category: 'letter', tone: 'good', title: heading.trim(), text: summary(body), detail: body.slice(0, 12000), source: 'whale-outbox.md', sourceId: heading.trim(), updatedAt: mtime}];
  }).slice(-limit);
}

export function roundEvents(text) {
  const records = [];
  let round = null;
  for (const line of text.split(/\r?\n/)) {
    const marker = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\s+(.*)$/.exec(line);
    if (marker && /=== 开始一轮/.test(marker[3])) {round = {lines: []}; continue;}
    if (marker && /=== 结束/.test(marker[3])) {
      if (round && /\bexit=0\b/.test(marker[3])) {
        // Only publish an explicitly labelled recommendation containing a BV ID.
        // Other log lines may include paths, private prose, or diagnostics.
        const candidate = round.lines.find(item => /最值得看|最想推荐|最推荐/.test(item) && /\bBV[0-9A-Za-z]{10}\b/.test(item) && !/给自己|私密|私人|想说（不发）|(?:cookie|token|secret|password|凭据|密码|密钥)|[A-Za-z]:[\\/]|~[\\/]/i.test(item));
        if (candidate) {
          const excerpt = candidate.slice(candidate.search(/最值得看|最想推荐|最推荐/)).replace(/[`*]/g, '').trim().slice(0, 400);
          const stamp = `${marker[1]}T${marker[2]}`;
          records.push({id: `round:${digest(stamp + excerpt)}`, time: Date.parse(stamp), category: 'activity', title: '这一轮的推荐', text: excerpt.slice(0, 200), detail: excerpt, tone: 'good', source: 'whale-round.log', sourceId: `${marker[1]} ${marker[2]}`});
        }
      }
      round = null;
    } else if (round && !marker) round.lines.push(line.trim());
  }
  return records.slice(-24);
}

export async function readLifeSources(home, now = Date.now(), configPath, history = false) {
  const names = ['bili-whale.config.json', 'whale-night.json', 'whale-diary.md', 'whale-outbox.md', 'whale-round.log'];
  const settled = await Promise.allSettled(names.map(file => readSource(home, file, /\.(md|log)$/.test(file), configPath)));
  const sources = [], files = {}, issues = [];
  settled.forEach((item, index) => {
    const file = names[index];
    if (item.status === 'rejected') {sources.push({file, status: 'error'}); issues.push(`${file}：${item.reason.message}`);}
    else if (!item.value) sources.push({file, status: 'missing'});
    else {files[file] = item.value; sources.push({file, status: item.value.truncated ? 'tail' : 'ready', updatedAt: item.value.mtime});}
  });
  function json(file) {
    if (!files[file]) return null;
    try {
      const parsed = JSON.parse(files[file].text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('必须为 JSON 对象');
      return parsed;
    } catch (error) {issues.push(`${file}：JSON 解析失败（${error.message}）`); sources.find(s => s.file === file).status = 'error'; return null;}
  }
  const config = json(names[0]), plan = json(names[1]);
  // Select fields explicitly: never return the full config, credentials, or private diary.
  const events = [
    ...(files[names[2]] ? diaryEvents(files[names[2]].text, files[names[2]].mtime, names[2], history ? 500 : 20) : []),
    ...(files[names[3]] ? outboxEvents(files[names[3]].text, files[names[3]].mtime, history ? 500 : 20) : []),
    ...(files[names[4]] ? roundEvents(files[names[4]].text) : []),
  ];
  let schedule = scheduleView(config, plan, now);
  const taskName = schedule.mode === 'paused' ? namedTask(config) : null;
  if (taskName) {
    const task = await readScheduledTask(taskName);
    schedule = taskSchedule(taskName, task, now);
    sources.push({file: `Windows 计划任务 · ${taskName}`, status: task.status === 'ready' ? 'ready' : 'error'});
  }
  if (!config && sources[0].status === 'error') {schedule.mode = 'unknown'; schedule.label = '无法读取 B站作息'; schedule.detail = '检查数据来源里的错误信息。';}
  return {name: typeof config?.persona?.name === 'string' && config.persona.name.trim() ? config.persona.name.trim().slice(0, 30) : '鲸鲸', schedule, events, sources, issues, fetchedAt: now};
}
