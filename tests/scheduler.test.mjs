import test from 'node:test';
import assert from 'node:assert/strict';
import {namedTask, readScheduledTask, taskSchedule} from '../lib/scheduler.js';
import {scheduleView} from '../lib/sources.js';

test('only explicitly named tasks are discovered from the plugin configuration', () => {
  assert.equal(namedTask({night:{disabledReason:'只走计划任务 whale-round'}}), 'whale-round');
  assert.equal(namedTask({night:{disabledReason:'自动作息关闭'}}), null);
  assert.equal(namedTask({night:{disabledReason:'计划任务 $(do-something)'}}), null);
  const view = scheduleView({night:{windows:[]}}, null);
  assert.match(view.label, /插件生物钟/);
  assert.doesNotMatch(view.label, /自动刷站已暂停/);
});

test('task state and next time are reported without inventing a future run', () => {
  const task = {status:'ready', state:'Ready', enabled:true, nextRun:'2026-10-29T21:30:00+08:00'};
  const now = Date.parse('2026-10-28T22:00:00+08:00');
  assert.equal(taskSchedule('fish', task, now).at, Date.parse(task.nextRun));
  assert.equal(taskSchedule('fish', {...task, state:'Running'}, now).label, '计划任务正在运行');
  assert.equal(taskSchedule('fish', {...task, enabled:false}, now).mode, 'paused');
  assert.equal(taskSchedule('fish', {...task, nextRun:'2026-10-27T21:30:00+08:00'}, now).at, null);
  assert.equal(taskSchedule('fish', {status:'unknown'}, now).mode, 'unknown');
});

test('other operating systems report scheduler status as unavailable', async () => {
  assert.deepEqual(await readScheduledTask('fish', 'linux'), {status:'unsupported'});
  assert.equal(taskSchedule('fish', {status:'unsupported'}).mode, 'unknown');
});
