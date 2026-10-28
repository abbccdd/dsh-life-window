import test from 'node:test';
import assert from 'node:assert/strict';
import {diaryEvents, outboxEvents, roundEvents, scheduleView} from '../lib/sources.js';
import {sessionState, safeVideoLinks, documentCategory, filterEvents, unreadItems, searchMatches} from '../src/model.js';
import {requestAllowed} from '../lib/index.js';

const snapshot = overrides => ({sessionId:'one', openState:'open', removed:false, pending:[], runningCalls:[], running:false, queue:[], promptError:null, lastAgentError:null, nodes:[], ...overrides});
test('only explicitly addressed diary sections are exposed', () => {
  const diary = '## 2026-10-01 · 一轮\n### 给主人\n给你看的\n#### 后记\n公开后记\n### 给自己\n私密内容\n### 别的标题\n不要泄漏\n### 想说（不发）\n不发的内容\n## 2026-10-02 · 二轮\n### 给自己\n不出现';
  const events = diaryEvents(diary, 10);
  assert.equal(events.length, 1); assert.match(events[0].detail, /公开后记/);
  assert.doesNotMatch(events[0].detail, /私密|泄漏|不发/);
});
test('private markers override addressed titles and cannot be bypassed by nested headings', () => {
  const diary = '## 2026-10-01\n### 给自己，想说给主人（不发）\nPRIVATE_A\n#### 给主人\nPRIVATE_B\n### 给主人\nPUBLIC_A\n#### 给自己\nPRIVATE_C\n##### 给主人\nPRIVATE_D\n### 给主人\nPUBLIC_B';
  const events=diaryEvents(diary,1);
  assert.equal(events.length,1);
  assert.match(events[0].detail,/PUBLIC_A/); assert.match(events[0].detail,/PUBLIC_B/);
  assert.doesNotMatch(events[0].detail,/PRIVATE_/);
});
test('round logs expose only explicit recommendations from completed successful rounds', () => {
  assert.deepEqual(outboxEvents('# 标题\n无条目', 1), []);
  const items = roundEvents('2026-10-25 21:00:00  === 开始一轮（headless one-shot）===\n  最值得看：BV1xx411c7mD《测试片》很有趣。\n  不应展示的详细内容\n2026-10-25 21:01:00  === 结束，exit=0 ===\n2026-10-25 21:02:00  === 开始一轮（headless one-shot）===\n  最值得看：BV1xx411c7mD失败轮次\n2026-10-25 21:03:00  === 结束，exit=1 ===\n2026-10-25 21:04:00  === 开始一轮（headless one-shot）===\n  最值得看：BV1xx411c7mD token=secret\n2026-10-25 21:05:00  === 结束，exit=0 ===');
  assert.equal(items.length, 1); assert.match(items[0].text, /测试片/); assert.doesNotMatch(JSON.stringify(items), /不应展示|失败轮次|secret|开始一轮/);
});
test('paused schedule and expired or fired plans are not presented as next activity', () => {
  const active = {night:{windows:[{start:'20:00',end:'24:00',wakes:1}]}};
  assert.equal(scheduleView({night:{windows:[]}}, {action:'wake',atMs:2000}, 1000).mode, 'paused');
  assert.equal(scheduleView(active, {action:'wake', atMs:2000, endsAt:3000, fired:true}, 1000).mode, 'window');
  assert.equal(scheduleView(active, {action:'wake', atMs:500, endsAt:800}, 1000).mode, 'window');
  assert.equal(scheduleView(active, {action:'wake', atMs:2000, endsAt:3000}, 1000).mode, 'planned');
  assert.equal(scheduleView(active, {action:'wake', atMs:500, endsAt:3000}, 1000).mode, 'overdue');
  assert.equal(scheduleView({night:{}}, null, 1000).mode, 'window');
});
test('state priority and timeline distinguish waits, active tasks and failures', () => {
  assert.equal(sessionState(snapshot({pending:[{kind:'approval'}],running:true})).id, 'approval');
  assert.equal(sessionState(snapshot({running:true,runningCalls:[{name:'bili',argsRaw:''}]})).id, 'working');
  assert.equal(sessionState(snapshot({nodes:[{kind:'turn-error'}]})).id, 'error');
  assert.equal(sessionState(snapshot({nodes:[{kind:'turn-error'},{kind:'user'}]})).id, 'idle');
});
test('life records filter diary, letters, activity and selected documents independently', () => {
  const events = ['diary','letter','activity','document'].map(category=>({category}));
  assert.equal(filterEvents(events,'diary').length,1);
  assert.equal(filterEvents(events,'letter')[0].category,'letter');
  assert.equal(filterEvents(events,'all').length,4);
  assert.equal(documentCategory('fish/diary/today.md'),'diary');
  assert.equal(documentCategory('fish/whale-outbox.md'),'letter');
  assert.equal(documentCategory('fish/notes.md'),'document');
});
test('video links are constrained', () => {
  assert.deepEqual(safeVideoLinks('BV1xx411c7mD https://evil.test/'), [{id:'BV1xx411c7mD',url:'https://www.bilibili.com/video/BV1xx411c7mD/'}]);
});
test('unread keys deduplicate video recommendations and search includes all source reasons', () => {
  const events=[{id:'diary:1',category:'diary',title:'日记',text:'早餐'},{id:'v1',category:'video',videoId:'BV1xx411c7mD',title:'短片',text:'故事',source:'日报',time:10},{id:'v2',category:'activity',title:'这一轮的推荐',text:'最值得看 BV1xx411c7mD《短片》，特别的故事',source:'日志',time:20}];
  const unread=unreadItems(events);
  assert.deepEqual(unread.map(item=>item.key),['diary:diary:1','video:BV1xx411c7mD']);
  assert.equal(searchMatches(events[0],'早餐 日记'),true);
  assert.equal(searchMatches(events[0],'晚餐'),false);
  assert.equal(searchMatches({entries:[{reason:'特别的故事',source:'日志'}]},'特别 日志'),true);
});
test('private overview is restricted to loopback and rejects cross-origin browser requests', () => {
  const request = (headers, peer = '127.0.0.1') => ({headers,socket:{remoteAddress:peer}});
  assert.equal(requestAllowed(request({host:'127.0.0.1:3080',origin:'http://127.0.0.1:3080','sec-fetch-site':'same-origin'})),true);
  assert.equal(requestAllowed(request({host:'127.0.0.1:3080'},'::ffff:127.0.0.1')),true);
  assert.equal(requestAllowed(request({host:'[::1]:3080'},'::1')),true);
  assert.equal(requestAllowed(request({host:'127.0.0.1:3080'},'203.0.113.10')),false);
  assert.equal(requestAllowed(request({host:'127.0.0.1:3080','x-forwarded-for':'203.0.113.10'})),false);
  assert.equal(requestAllowed({headers:{host:'127.0.0.1:3080'}}),false);
  assert.equal(requestAllowed(request({host:'127.0.0.1:3080',origin:'https://evil.test','sec-fetch-site':'cross-site'})),false);
  assert.equal(requestAllowed(request({host:'evil.test'})),false);
});
