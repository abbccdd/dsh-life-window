import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readAutoSources,reportVideos,ownerLetter} from '../lib/auto-sources.js';
import {videoCards} from '../src/model.js';

const report = '# 2026-10-28 日报\n### BV1xx411c7mD\n- **标题**：示例视频\n- **为什么值得**：讲了一个故事。\n- **其他**：不展示\n### BV1yy411c7mD\n- **标题**：另一个视频\n';
test('extracts explicit report fields without leaking unrelated sections', () => {
  const found = reportVideos(report,'bili-duty/out/2026-10-28.md',100);
  assert.equal(found.length,2); assert.equal(found[0].videoTitle,'示例视频'); assert.match(found[0].text,/故事/);
  assert.doesNotMatch(JSON.stringify(found),/不展示/);
  assert.deepEqual(reportVideos('### BV1xx411c7mD\n- 其他：任意内容','report/2026-10-28.md',1),[]);
  assert.deepEqual(reportVideos('### BV1xx411c7mD\n- 标题：token=secret','report/2026-10-28.md',1),[]);
});

test('owner letters do not expose private subsections', () => {
  const result=ownerLetter('# 今天\n给你的信\n## 给自己\n私人内容\n### 给主人\n嵌套私人内容\n## 给你的信\n公开内容','pod-diary/owner/2026-10-28.md',5);
  assert.equal(result.length,1); assert.match(result[0].detail,/给你的信/); assert.match(result[0].detail,/公开内容/); assert.doesNotMatch(JSON.stringify(result),/私人内容/);
});

test('automatically discovers supported public files without reading private diaries or arbitrary work', async () => {
  const root=fileURLToPath(new URL('../待删除文件/auto-source-test/',import.meta.url));
  for (const dir of ['pod-diary/owner','pod-diary/daily','bili-duty/out','normal/out','legacy-out']) await mkdir(path.join(root,dir),{recursive:true});
  await Promise.all([
    writeFile(path.join(root,'pod-diary/owner/2026-10-28.md'),'给主人\n一封信'),
    writeFile(path.join(root,'pod-diary/daily/2026-10-28.md'),'私人日记禁止出现'),
    writeFile(path.join(root,'bili-duty/out/2026-10-28.md'),report),
    writeFile(path.join(root,'normal/out/2026-10-28.md'),'普通工作不出现 '+report),
    writeFile(path.join(root,'legacy-out/2026-10-27.md'),report),
  ]);
  const result=await readAutoSources(root,path.join(root,'legacy-out'));
  assert.equal(result.events.filter(item=>item.category==='letter').length,1);
  assert.equal(result.events.filter(item=>item.category==='video').length,4);
  assert.doesNotMatch(JSON.stringify(result),/私人日记禁止出现|普通工作不出现/);
});

test('video wall groups exact BV identities and preserves each reason and source', () => {
  const cards=videoCards([
    {category:'video',videoId:'BV1xx411c7mD',videoTitle:'示例视频',text:'第一条理由',source:'日报',sourceId:'one',time:10},
    {category:'activity',title:'这一轮的推荐',text:'最值得看 BV1xx411c7mD《示例视频》，第二条理由',source:'日志',sourceId:'two',time:20},
    {category:'diary',title:'个人日记',text:'BV1yy411c7mD',source:'日记',sourceId:'three',time:30},
  ]);
  assert.equal(cards.length,1); assert.equal(cards[0].title,'示例视频'); assert.equal(cards[0].entries.length,2);
  assert.deepEqual(cards[0].entries.map(e=>e.source),['日志','日报']);
  assert.equal(cards[0].url,'https://www.bilibili.com/video/BV1xx411c7mD/');
});
