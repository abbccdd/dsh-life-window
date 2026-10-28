import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {discoverFiles,readCandidate} from '../lib/discovery.js';
import {parseProvider,readProviders} from '../lib/providers.js';
import {summaryState,createSessionController,metadataFingerprint,toolFingerprint,historyFingerprint} from '../src/session-controller.js';

test('session status distinguishes activity and pending questions', () => {
  assert.equal(summaryState({running:true}).id,'working');
  assert.equal(summaryState({running:true,pendingInteraction:'question'}).id,'waiting');
});

test('fingerprints use actual fish tools or dedicated identity, not generic text', () => {
  assert.ok(metadataFingerprint({id:'bili-whale'}));
  assert.ok(metadataFingerprint({id:'random',cwd:'C:/x/whale-work'}));
  assert.ok(metadataFingerprint({id:'random',cwd:'/home/user/.dsh/pod-work'}));
  assert.equal(metadataFingerprint({id:'dev',displayTitle:'开发 dsh-bili-whale'}),'');
  assert.ok(toolFingerprint('mcp__bilibili__bili_search','{}'));
  assert.ok(toolFingerprint('Pwsh',JSON.stringify({command:'node "C:/fish tools/bili.mjs" feed --json'})));
  assert.ok(toolFingerprint('Read',JSON.stringify({path:'C:/Users/A/.dsh/whale-diary.md'})));
  assert.ok(toolFingerprint('Read',JSON.stringify({path:'/home/user/.dsh/bili-duty/out/2026-10-28.md'})));
  assert.ok(toolFingerprint('Read',JSON.stringify({path:'/home/user/.dsh/pod-diary/owner/2026-10-28.md'})));
  assert.equal(toolFingerprint('read',JSON.stringify({path:'bili.mjs feed'})),'');
  assert.equal(toolFingerprint('read',JSON.stringify({path:'C:/projects/whale-diary.md.backup'})),'');
  assert.equal(toolFingerprint('Pwsh',JSON.stringify({command:'echo node bili.mjs feed'})),'');
  assert.equal(historyFingerprint([{event:{type:'user/message',data:{content:[{text:'node bili.mjs feed'}]}}}]),'');
  assert.equal(historyFingerprint([{event:{type:'tool/call',data:{name:'bili_search',arguments:'{}'}}}]),'');
  assert.equal(historyFingerprint([{event:{type:'tool/call',data:{name:'bili_search',arguments:'{}'}}},{event:{type:'tool/call',data:{name:'bili_subtitles',arguments:'{}'}}}]),'');
  assert.ok(historyFingerprint([{event:{type:'tool/call',data:{name:'bili_diary',arguments:'{}'}}}]));
});

test('identifies and combines fish activity automatically, discards unrelated history and allows correcting mistakes', async () => {
  globalThis.document = {hidden:false};
  const state = {current:undefined,phase:'ready',ids:['dedicated','tool','work'],byId:{dedicated:{id:'bili-whale',displayTitle:'专用鱼'},tool:{id:'tool',displayTitle:'一般名字'},work:{id:'work',displayTitle:'普通工作'}}};
  state.ids[0]='bili-whale'; state.byId['bili-whale']=state.byId.dedicated; delete state.byId.dedicated;
  const sessions = {list:{getSnapshot:()=>state,subscribe(){return()=>{};}},open(){}};
  const entries = id => [
    ...(id !== 'work' ? [{event:{type:'tool/call',seq:1,time:10,data:{name:'bili_diary',callId:'f',arguments:'{}'}}},{event:{type:'tool/result',seq:1.5,time:10,data:{message:{content:[{toolCallId:'f'}]}}}}] : []),
    {event:{type:'assistant/message',seq:2,time:11,data:{message:{content:[{type:'text',text:id === 'work' ? '不应显示的工作内容' : `来自 ${id}`}]}}}},
  ];
  const api = {sessions:{history:({sessionId})=>Promise.resolve({result:{ok:true,value:{events:entries(sessionId)}}})}};
  const saved = new Map(), storage = {getItem:key=>saved.get(key) ?? null,setItem:(key,value)=>saved.set(key,value)};
  const ctrl = createSessionController(sessions,api,()=>{},storage);
  assert.deepEqual(ctrl.view().included,['bili-whale']);
  ctrl.setActive(true); await new Promise(resolve=>setTimeout(resolve,10));
  assert.deepEqual(new Set(ctrl.view().included),new Set(['bili-whale','tool']));
  assert.equal(ctrl.view().events,undefined);
  assert.doesNotMatch(JSON.stringify(ctrl.view()),/不应显示的工作内容/);
  assert.match(ctrl.view().identified.find(item=>item.id==='tool').reason,/养鱼/);
  ctrl.exclude('tool',true); assert.ok(!ctrl.view().included.includes('tool'));
  ctrl.exclude('tool',false); await new Promise(resolve=>setTimeout(resolve,10)); assert.ok(ctrl.view().included.includes('tool'));
  ctrl.destroy();
  const again = createSessionController(sessions,api,()=>{},storage); assert.ok(again.view().included.includes('tool')); again.destroy();
});

test('first discovery can find a fish fingerprint on an older page without publishing unrelated text', async () => {
  globalThis.document = {hidden:false};
  const state = {current:undefined,phase:'ready',ids:['old'],byId:{old:{id:'old',displayTitle:'普通名字'}}};
  const sessions = {list:{getSnapshot:()=>state,subscribe(){return()=>{};}},open(){}};
  let calls = 0;
  const api = {sessions:{history:({beforeSeq})=>{
    calls++;
    if (beforeSeq === undefined) return Promise.resolve({result:{ok:true,value:{hasMore:true,events:[{event:{type:'assistant/message',seq:50,time:10,data:{message:{content:[{type:'text',text:'最近的回答'}]}}}}]}}});
    return Promise.resolve({result:{ok:true,value:{hasMore:false,events:[{event:{type:'tool/call',seq:1,time:1,data:{name:'Pwsh',arguments:JSON.stringify({command:'node tools/bili.mjs feed'})}}}]}}});
  }}};
  const storage = {getItem:()=>null,setItem(){}};
  const ctrl = createSessionController(sessions,api,()=>{},storage);
  ctrl.setActive(true); await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(calls,2); assert.deepEqual(ctrl.view().included,['old']); assert.equal(ctrl.view().events,undefined); ctrl.destroy();
});

test('discovery lists metadata and never exposes private names or arbitrary files', async () => {
  const root = fileURLToPath(new URL('../待删除文件/discovery-test/',import.meta.url));
  const dir = path.join(root,'another-fish','diary'); await mkdir(dir,{recursive:true});
  await Promise.all([writeFile(path.join(dir,'today.md'),'可见日记'),writeFile(path.join(dir,'private.md'),'私人内容'),writeFile(path.join(dir,'给自己.md'),'不应发现'),writeFile(path.join(dir,'token.json'),'credential'),writeFile(path.join(dir,'config.json'),'config')]);
  const found = await discoverFiles(root);
  assert.equal(found.files.length,1); assert.ok(found.files[0].label.endsWith('today.md'));
  assert.doesNotMatch(JSON.stringify(found),/可见日记|私人内容|credential/);
  assert.equal((await readCandidate(root,found.files[0].id)).text,'可见日记');
  await assert.rejects(readCandidate(root,Buffer.from('../outside.md').toString('base64url')),/不存在/);
});

test('standard providers validate events without executing actions', async () => {
  const record = {version:1,providerId:'my-fish',name:'小鱼',updatedAt:'2026-10-28T10:00:00Z',events:[{id:'1',time:'2026-10-28T09:00:00Z',kind:'letter',title:'给你',text:'你好',sessionId:'fish',action:'arbitrary'}]};
  const parsed = parseProvider(record,'fish.json'); assert.equal(parsed.events[0].sessionId,'fish'); assert.equal(parsed.events[0].category,'letter');
  assert.ok(!JSON.stringify(parsed).includes('arbitrary'));
  assert.throws(()=>parseProvider({...record,version:2},'bad.json'),/不符合/);
  const root = fileURLToPath(new URL('../待删除文件/provider-test/',import.meta.url));
  const dir = path.join(root,'life-window','providers'); await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,'fish.json'),JSON.stringify(record));
  const result = await readProviders(root); assert.equal(result.events.length,1);
});
