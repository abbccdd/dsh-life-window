import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute = promisify(execFile);
const script = `
$ErrorActionPreference = 'Stop'
$tasks = @(Get-ScheduledTask -TaskName $env:DSH_LIFE_TASK_NAME -ErrorAction Stop)
if ($tasks.Count -ne 1) { throw 'Task name is missing or ambiguous' }
$task = $tasks[0]
$info = Get-ScheduledTaskInfo -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction Stop
$last = if ($info.LastRunTime.Year -gt 2000) { $info.LastRunTime.ToString('o') } else { $null }
$next = if ($info.NextRunTime.Year -gt 2000) { $info.NextRunTime.ToString('o') } else { $null }
[pscustomobject]@{ state = $task.State.ToString(); enabled = [bool]$task.Settings.Enabled; lastRun = $last; nextRun = $next; lastResult = [long]$info.LastTaskResult } | ConvertTo-Json -Compress
`;

// Only consult a scheduler when the plugin configuration explicitly names it.
export function namedTask(config) {
  const reason = config?.night?.disabledReason;
  if (typeof reason !== 'string') return null;
  return /计划任务[：:\s]+([\p{L}\p{N}_.-]{1,100})(?![\p{L}\p{N}_.-])/u.exec(reason)?.[1] ?? null;
}

export async function readScheduledTask(name, platform = process.platform) {
  if (platform !== 'win32') return {status: 'unsupported'};
  try {
    const {stdout} = await execute('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      env: {...process.env, DSH_LIFE_TASK_NAME: name}, timeout: 6000, maxBuffer: 16384, windowsHide: true,
    });
    const data = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    if (typeof data.enabled !== 'boolean' || !['Disabled', 'Ready', 'Running', 'Queued'].includes(data.state)) return {status: 'unknown'};
    return {status: 'ready', ...data};
  } catch {
    // Missing, ambiguous, inaccessible, or unavailable scheduler: do not guess.
    return {status: 'unknown'};
  }
}

export function taskSchedule(name, task, now = Date.now()) {
  if (task.status !== 'ready') return {mode: 'unknown', label: '计划任务状态待确认', detail: `配置提到计划任务 ${name}，但目前无法读取其状态。`, at: null};
  if (!task.enabled || task.state === 'Disabled') return {mode: 'paused', label: '计划任务已停用', detail: `Windows 计划任务 ${name} 当前未启用。`, at: null};
  const next = Date.parse(task.nextRun);
  const at = Number.isFinite(next) && next > now ? next : null;
  const label = task.state === 'Running' ? '计划任务正在运行' : task.state === 'Queued' ? '计划任务等待运行' : '计划任务已启用';
  return {mode: 'external', label, detail: `Windows 计划任务 ${name} · ${at ? '下次运行' : '暂无可确认的下次运行时间'}`, at};
}
