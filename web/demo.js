import {createLifeWindow} from '/dsh-life/src/widget.js';
const css = await (await fetch('/dsh-life/src/widget.css')).text();
const now = Date.now();
const overview = {fetchedAt: now, name:'鲸鲸', schedule:{mode:'planned', label:'下一次计划活动', detail:'从养鱼插件的计划中读取。', at: now + 3600000}, sources:[{file:'bili-whale.config.json',status:'ready'},{file:'whale-diary.md',status:'ready'}], issues:[], events:[
  {id:'example1', time:now-3600000, category:'activity', tone:'good', title:'这一轮的推荐', text:'最值得看：BV1xx411c7mD，分享一个有意思的故事。', source:'示例记录', sourceId:'示例'},
  {id:'example-video', time:now-7200000, category:'video', videoId:'BV1xx411c7mD', videoTitle:'一段有意思的故事', tone:'good', title:'一段有意思的故事', text:'故事里有一处很有趣的细节。', source:'示例日报', sourceId:'示例日报'},
  {id:'example2', time:now-7200000, category:'diary', tone:'good', title:'今天的小发现', text:'想给你分享一段有趣的视频。', detail:'给主人\n\n今天碰到一条有趣的视频，想和你一起看。BV1xx411c7mD', source:'示例日记', sourceId:'示例'},
]};
const life = createLifeWindow({css,container:document.querySelector('#demo'),embedded:true,preview:true,fetchOverview:async()=>overview});
const snapshot = {sessionId:'demo',openState:'open',removed:false,pending:[],runningCalls:[],running:false,queue:[],promptError:null,lastAgentError:null,nodes:[]};
life.update(snapshot);
