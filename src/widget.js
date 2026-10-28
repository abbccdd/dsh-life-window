import {sessionState, mergeEvents, safeVideoLinks, timeLabel, documentCategory, filterEvents, videoCards, unreadItems, searchMatches} from './model.js';

export function createLifeWindow({css, container = document.body, embedded = false, preview = false, fetchOverview = () => fetch('/dsh-life/api/overview', {cache: 'no-store'}).then(async r => {if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();})}) {
  const root = document.createElement('div');
  root.dataset.dshLifeWindow = '';
  if (embedded) root.dataset.embedded = '';
  const shadow = root.attachShadow({mode: 'open'});
  shadow.innerHTML = `<style>${css}</style>
    <button class="bubble" aria-label="打开鲸鲸生活窗" aria-expanded="false"><span class="bubble-wave" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M5 19c1-5 5-8 11-8 4 0 7 2 9 5l3-2-1 5 2 3-5-1c-2 4-7 6-11 5-5-1-8-4-8-7Z"/><circle cx="11" cy="18" r="1"/></svg></span><span>鲸鲸生活窗</span><span class="bubble-unread" hidden></span></button>
    <section class="window" aria-label="鲸鲸生活窗" hidden>
      <header class="top"><div class="brand"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M5 19c1-5 5-8 11-8 4 0 7 2 9 5l3-2-1 5 2 3-5-1c-2 4-7 6-11 5-5-1-8-4-8-7Z"/><circle cx="11" cy="18" r="1"/></svg></span><div><strong>鲸鲸生活窗</strong><small>WHALE LIFE · 生活随记</small></div></div><div class="top-actions"><button class="refresh icon" aria-label="刷新生活记录" title="刷新">↻</button><button class="close icon" aria-label="收起生活窗" title="收起">×</button></div></header>
      <main>
        <section class="hero"><div class="hero-copy"><div class="eyebrow"><i></i><span class="hero-context">当前会话</span></div><h2 class="status">正在连接</h2><p class="description"></p></div><div class="whale" aria-hidden="true"><img src="/dsh-life/assets/deepseek-chibi.webp" alt="" width="500" height="501"></div></section>
        <section class="schedule"><div><span class="schedule-kicker">B站作息</span><strong class="schedule-title">正在连接生活记录</strong><p class="schedule-detail"></p></div><span class="schedule-time"></span></section>
        <details class="binding"><summary>自动识别养鱼会话</summary><p>根据插件专用会话、工作目录和近期养鱼工具调用识别。</p><div class="session-choices" aria-label="自动识别的养鱼会话"></div><p id="binding-hint">识别结果可能有遗漏或误判，可在此排除不相关的会话。</p></details>
        <section class="feed"><div class="feed-heading"><div><span class="kicker">LITTLE MOMENTS</span><h3>最近的生活</h3></div><span class="feed-count"></span></div><label class="search-label" for="life-search">搜索历史记录</label><input id="life-search" class="life-search" type="search" placeholder="搜索日记、信件或视频" autocomplete="off"><p class="search-hint" aria-live="polite"></p><div class="filters" role="group" aria-label="筛选生活记录"><button data-filter="all" aria-pressed="true">全部</button><button data-filter="activity" aria-pressed="false">活动</button><button data-filter="video" aria-pressed="false">视频</button><button data-filter="diary" aria-pressed="false">日记</button><button data-filter="letter" aria-pressed="false">信件</button><button data-filter="document" aria-pressed="false">资料</button></div><button class="mark-all" hidden>将当前分类全部标为已读</button><div class="events"></div><button class="more-events" hidden>显示更多</button></section>
        <details class="sources"><summary>数据来源与连接状态 <span>⌄</span></summary><div class="source-list"></div><p>会话用于识别和显示状态；生活记录来自插件文件或生活来源，未声明所属会话的记录不会被自动归属。</p><div class="discovery"><strong>发现更多生活资料</strong><p>仅列出 DSH 数据目录中可能相关的文件；选择后显示原文。请确认其中没有不想展示的内容。</p><div class="source-picker"><select class="candidate" aria-label="选择发现的生活资料"><option value="">正在查找来源</option></select><button class="add-source">添加</button></div><p class="discovery-status" aria-live="polite"></p><div class="selected-sources"></div></div></details>
      </main><footer><span><i></i> 生活记录在本机</span><span class="updated">等待更新</span></footer>
    </section>`;
  container.append(root);
  const $ = selector => shadow.querySelector(selector);
  const pageSize = 50;
  let snapshot = null, overview = null, historyOverview = null, historyError = '', historyLoading = false, loadError = '', query = '', filter = 'all', opened = embedded, destroyed = false, inFlight = false, controller = null, sessionView = null, visibleCount = pageSize;
  let candidates = [], added = [], discoveryError = '', files = [], fileErrors = [], discoveryLoaded = false;
  const expandedContent = new Set();
  const storedSourcesKey = 'dsh-life-window-sources-v1';
  const unreadKey = 'dsh-life-window-unread-v1';
  let unreadState = null;
  try {const saved = JSON.parse(localStorage.getItem(unreadKey) || 'null'); if (saved && Array.isArray(saved.known) && Array.isArray(saved.unread)) unreadState = {known:new Set(saved.known),unread:new Set(saved.unread)};} catch { /* Local storage may be unavailable. */ }
  const saveUnread = () => {try {localStorage.setItem(unreadKey,JSON.stringify({known:[...unreadState.known],unread:[...unreadState.unread]}));} catch { /* The current view still works without persistence. */ }};
  function updateUnread(events) {
    const items = unreadItems(events);
    if (!unreadState) unreadState = {known:new Set(items.map(item=>item.key)),unread:new Set()};
    else for (const item of items) if (!unreadState.known.has(item.key)) {unreadState.known.add(item.key); unreadState.unread.add(item.key);}
    saveUnread();
  }
  function markRead(key) {if (unreadState?.unread.delete(key)) {saveUnread(); render();}}
  function summaryText(text, max = 180) {const clean=String(text || '').replace(/\s+/g,' ').trim(); return clean.length > max ? `${clean.slice(0,max)}…` : clean;}
  if (!preview) {try {const saved = JSON.parse(localStorage.getItem(storedSourcesKey) || '[]'); if (Array.isArray(saved)) added = saved.filter(x => typeof x === 'string').slice(0,5);} catch {discoveryError = '已保存的资料选择无法读取，请重新选择。';}}
  const el = (tag, cls, content) => {const item = document.createElement(tag); if (cls) item.className = cls; if (content !== undefined) item.textContent = content; return item;};
  function appendExpandable(parent, key, previewText, fullText, cls, readKey = '') {
    const full = String(fullText || previewText || '').trim();
    const preview = summaryText(previewText || full);
    const different = full.replace(/\s+/g,' ').trim() !== preview.replace(/\s+/g,' ').trim();
    const expanded = expandedContent.has(key);
    const text = el('p',cls,expanded ? full : preview);
    if (expanded) text.classList.add('expanded-text');
    parent.append(text);
    if (different) {
      const button = el('button','expand-content',expanded ? '收起' : '显示全文');
      button.type='button'; button.dataset.expandKey=key; button.dataset.readKey=readKey;
      button.setAttribute('aria-expanded',String(expanded)); parent.append(button);
    }
  }
  function setOpened(value) {
    opened = value;
    $('.window').hidden = !opened; $('.bubble').hidden = opened || embedded;
    $('.bubble').setAttribute('aria-expanded', String(opened));
    controller?.setActive(opened);
    if (opened) refresh();
  }
  function render() {
    const state = sessionView?.state || sessionState(snapshot);
    $('.status').textContent = state.label;
    $('.description').textContent = state.description;
    $('.hero').dataset.state = state.id;
    $('.hero-context').textContent = preview ? '演示会话' : sessionView ? `自动识别 · ${sessionView.total} 个会话` : '正在连接 DSH 会话';
    if (sessionView) {
      const choices = $('.session-choices');
      const choiceSignature = JSON.stringify(sessionView.identified);
      if (choices.dataset.signature !== choiceSignature) {
        choices.replaceChildren();
        if (!sessionView.identified.length) choices.append(el('p','choice-empty',sessionView.loading ? '正在识别会话…' : '尚未发现明确的养鱼会话。'));
        for (const row of sessionView.identified) {
          const card = el('div','detected-session'), copy = el('div','detected-copy');
          const duplicate = sessionView.identified.filter(other=>other.title===row.title).length > 1;
          copy.append(el('strong','',duplicate ? `${row.title} · ${row.id.slice(-8)}` : row.title),el('span','',row.reason));
          const button = el('button','exclude-session',row.excluded ? '恢复' : '排除');
          button.dataset.sessionId = row.id; button.dataset.excluded = String(row.excluded);
          card.append(copy,button); choices.append(card);
        }
        choices.dataset.signature = choiceSignature;
      }
      $('.binding summary').textContent = `自动识别养鱼会话 · ${sessionView.total} 个`;
      $('#binding-hint').textContent = sessionView.loading ? `正在识别 ${sessionView.loading} 个会话的近期工具痕迹。` : sessionView.scanFailed ? `${sessionView.scanFailed} 个会话识别失败，可能有遗漏。` : '识别结果可能有遗漏或误判，可在此排除不相关的会话。';
    }
    const schedule = overview?.schedule;
    $('.schedule-title').textContent = loadError ? '生活记录暂时不可用' : schedule?.label || '正在连接生活记录';
    $('.schedule-detail').textContent = loadError || schedule?.detail || '正在查找可用的数据来源。';
    $('.schedule-time').textContent = schedule?.at ? timeLabel(schedule.at) : '';
    $('.schedule').dataset.mode = schedule?.mode || 'unknown';
    const currentOverview = query.trim() && historyOverview ? historyOverview : overview;
    const sourceEvents = (currentOverview?.events || []).filter(event => !event.sessionId || (sessionView?.included.includes(event.sessionId) && (sessionView.scope === '__all_sessions__' || event.sessionId === sessionView.id)));
    const events = mergeEvents(sourceEvents, files.map(file => ({id:`document:${file.id}`,time:file.updatedAt,category:documentCategory(file.label),tone:'neutral',title:file.label.split('/').at(-1),text:'用户选定的原始资料 · 按文件修改时间显示',detail:file.text,source:'用户选定的资料',sourceId:file.label + (file.truncated ? ' · 只显示末尾部分' : '')})));
    const filtered = (filter === 'video' ? videoCards(events) : filter === 'all' && query.trim() ? [...events.filter(event=>event.category !== 'video'),...videoCards(events)].sort((a,b)=>b.time-a.time) : filterEvents(events.filter(event=>event.category !== 'video'), filter)).filter(item=>searchMatches(item,query));
    const counts = {video:0,diary:0,letter:0};
    for (const item of unreadItems((overview?.events || []))) if (unreadState?.unread.has(item.key)) counts[item.category]++;
    const unreadTotal = counts.video + counts.diary + counts.letter;
    $('.bubble-unread').hidden = !unreadTotal; $('.bubble-unread').textContent = unreadTotal > 99 ? '99+' : String(unreadTotal);
    $('.bubble').setAttribute('aria-label',unreadTotal ? `打开鲸鲸生活窗，${unreadTotal} 条未读` : '打开鲸鲸生活窗');
    for (const button of shadow.querySelectorAll('[data-filter]')) {const category=button.dataset.filter; const labels={all:'全部',activity:'活动',video:'视频',diary:'日记',letter:'信件',document:'资料'}; button.textContent=labels[category]+(counts[category] ? ` ${counts[category]}` : '');}
    $('.search-hint').textContent = query.trim() ? (historyLoading ? '正在读取可用历史…' : historyError || '搜索可读取的历史记录；部分旧文件或超出扫描范围的内容可能未包含。') : '首次接入的已有记录视为已读，新记录会显示未读。';
    $('.mark-all').hidden = !unreadTotal || !['all','video','diary','letter'].includes(filter);
    $('.feed-count').textContent = filtered.length > visibleCount ? `显示 ${visibleCount} / ${filtered.length} 条` : `${filtered.length} 条记录`;
    const list = $('.events');
    const openedVideoSources = new Set([...list.querySelectorAll('.video-card-sources[open]')].map(detail => detail.dataset.videoId));
    const openedLongContent = new Set([...list.querySelectorAll('.long-content[open][data-long-key]')].map(detail=>detail.dataset.longKey));
    list.replaceChildren();
    if (!filtered.length) list.append(el('p', 'empty', query.trim() ? '没有找到匹配的记录。试试其他关键词或分类。' : filter === 'video' ? '暂时没有可识别的视频推荐。' : filter === 'activity' ? '暂时没有可展示的活动内容。来源出现明确的推荐或公开动态后会显示在这里。' : '这里还没有记录。等有了新内容，就会出现在这里。'));
    for (const event of filtered.slice(0, visibleCount)) {
      if (event.entries) {
        const card = el('article','video-card'); card.dataset.readKey=`video:${event.id}`;
        const header = el('div','video-card-header');
        const mark = el('span','video-card-mark','▶'); mark.setAttribute('aria-hidden','true');
        const heading = el('div','video-card-heading'); heading.append(el('span','video-card-id',event.id),el('h4','',event.title));
        header.append(mark,heading); card.append(header);
        const latest = event.entries.find(entry=>entry.reason);
        if (latest) appendExpandable(card,`video-reason:${event.id}`,latest.reason,latest.reason,'video-card-reason',card.dataset.readKey);
        const source = latest || event.entries[0];
        const stamp = source.dateOnly ? new Date(source.time).toLocaleDateString('zh-CN',{year:'numeric',month:'numeric',day:'numeric'}) : timeLabel(source.time);
        card.append(el('p','video-card-source',`${stamp} · ${source.source} · ${event.entries.length} 条来源记录`));
        const link = el('a','video-card-link','打开 B 站视频 ↗'); link.href=event.url; link.target='_blank'; link.rel='noopener noreferrer'; card.append(link);
        if (event.entries.length > 1) {
          const details=el('details','video-card-sources'); details.dataset.videoId=event.id; details.open=openedVideoSources.has(event.id); details.append(el('summary','','查看所有来源'));
          const extra=el('details','long-content'); extra.dataset.longKey=`video-extra:${event.id}`; extra.open=openedLongContent.has(extra.dataset.longKey); extra.append(el('summary','',`显示其余 ${event.entries.length-5} 条来源`));
          for (const [index,entry] of event.entries.entries()) {const line=el('div','source-entry'); line.append(el('p','source-entry-meta',`${entry.dateOnly ? new Date(entry.time).toLocaleDateString('zh-CN') : timeLabel(entry.time)} · ${entry.source} · ${entry.sourceId}`)); if (entry.reason) appendExpandable(line,`video-source:${event.id}:${index}`,entry.reason,entry.reason,'source-entry-reason',card.dataset.readKey); (index < 5 ? details : extra).append(line);}
          if (event.entries.length > 5) details.append(extra);
          card.append(details);
        }
        if (unreadState?.unread.has(card.dataset.readKey)) {const mark=el('button','read-one','未读 · 标为已读'); mark.dataset.readKey=card.dataset.readKey; card.append(mark);}
        list.append(card); continue;
      }
      const row = el('article', `event ${event.tone || 'neutral'}`);
      if (['diary','letter'].includes(event.category)) row.dataset.readKey=`${event.category}:${event.id}`;
      const rail = el('div', 'rail'); rail.append(el('span', 'dot')); row.append(rail);
      const content = el('div', 'event-content');
      const meta = el('div', 'event-meta');
      const stamp = event.dateOnly ? new Date(event.time).toLocaleDateString('zh-CN', {month: 'long', day: 'numeric'}) : timeLabel(event.time);
      meta.append(el('time', '', stamp), el('span', 'source-tag', event.source));
      content.append(meta, el('h4', '', event.title));
      appendExpandable(content,`event:${event.id}`,event.text,event.detail || event.text,'event-text',row.dataset.readKey);
      const links = safeVideoLinks(event.detail || event.text);
      if (links.length) {const wrap = el('div', 'video-links'); for (const link of links) {const a = el('a', '', `打开 ${link.id} ↗`); a.href = link.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; wrap.append(a);} content.append(wrap);}
      content.append(el('div', 'provenance', `来源：${event.source} · ${event.sourceId}${event.dateOnly ? ' · 原文只记录日期' : ''}`));
      if (row.dataset.readKey && unreadState?.unread.has(row.dataset.readKey)) {const mark=el('button','read-one','未读 · 标为已读'); mark.dataset.readKey=row.dataset.readKey; content.append(mark);}
      if (event.sessionId && sessionView?.list.some(row => row.id === event.sessionId) && event.sessionId !== sessionView.currentId) {const open = el('button','event-open','打开来源会话 ↗'); open.dataset.sessionId = event.sessionId; content.append(open);}
      row.append(content); list.append(row);
    }
    $('.more-events').hidden = filtered.length <= visibleCount;
    const sources = $('.source-list'); sources.replaceChildren();
    const local = el('div', 'source-row'); local.append(el('span', '', 'DSH 会话'), el('strong', '', sessionView ? `${sessionView.total} 个 · ${sessionView.loading ? '读取中' : sessionView.failed.length ? `${sessionView.failed.length} 个失败` : '近期记录'}` : snapshot ? '已连接' : '未选择会话')); sources.append(local);
    for (const failure of sessionView?.failed || []) sources.append(el('p','source-error',`${failure.title}：${failure.error}`));
    if (overview) for (const source of overview.sources) {
      const row = el('div', 'source-row'); row.append(el('span', '', source.file), el('strong', '', ({ready: '已连接', tail: '已连接（最近部分）', missing: '未找到', error: '读取失败'})[source.status] || '未知')); sources.append(row);
    }
    for (const issue of overview?.issues || []) sources.append(el('p', 'source-error', issue));
    $('.discovery').hidden = preview;
    if (!preview) {
      const picker = $('.candidate'), previous = picker.value;
      const signature = JSON.stringify([candidates.map(item=>[item.id,item.label]),added]);
      if (picker.dataset.signature !== signature) {
        picker.replaceChildren(new Option(discoveryLoaded ? '选择一个候选文件' : '正在查找来源',''));
        for (const item of candidates.filter(item=>!added.includes(item.id))) picker.append(new Option(item.label,item.id));
        picker.value = previous; picker.dataset.signature = signature;
      }
      $('.add-source').disabled = !picker.value || added.length >= 5;
      $('.discovery-status').textContent = discoveryError || fileErrors.join('；') || (discoveryLoaded && !candidates.length ? '未发现可识别的候选文件。' : '最多添加 5 个文件，可随时移除。');
      const selected = $('.selected-sources'); selected.replaceChildren();
      for (const id of added) {const row = el('div','selected-source'); row.append(el('span','',candidates.find(c=>c.id===id)?.label || '来源暂不可用')); const remove = el('button','remove-source','移除'); remove.dataset.sourceId = id; row.append(remove); selected.append(row);}
    }
    $('.updated').textContent = overview ? `更新于 ${timeLabel(overview.fetchedAt)}` : loadError ? '连接失败' : '等待更新';
  }
  async function refresh() {
    if (inFlight || destroyed) return;
    inFlight = true; $('.refresh').disabled = true;
    try {overview = await fetchOverview(); updateUnread(overview.events || []); loadError = '';}
    catch (error) {loadError = `读取失败（${error.message}），可以稍后重试。`;}
    finally {inFlight = false; if (!destroyed) {$('.refresh').disabled = false; render();}}
    if (opened && !preview && !destroyed) await refreshDiscovery();
    if (opened && query.trim() && !destroyed) {historyOverview=null; await loadHistory();}
  }
  async function loadHistory() {
    if (historyLoading || historyOverview) return;
    if (preview) {historyOverview=overview; render(); return;}
    historyLoading=true; historyError=''; render();
    try {historyOverview=await getJSON('/dsh-life/api/overview?history=1');}
    catch {historyError='历史读取失败，当前只搜索已加载的记录。';}
    finally {historyLoading=false; if (!destroyed) render();}
  }
  async function getJSON(url) {const r = await fetch(url,{cache:'no-store'}); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();}
  async function refreshDiscovery() {
    try {
      const found = await getJSON('/dsh-life/api/candidates');
      if (destroyed) return;
      candidates = found.files; discoveryLoaded = true;
      discoveryError = found.truncated ? '候选文件较多，只列出前一部分。' : '';
      const wanted = [...added];
      const results = await Promise.allSettled(wanted.map(id => getJSON(`/dsh-life/api/candidate?id=${encodeURIComponent(id)}`)));
      if (destroyed || JSON.stringify(wanted) !== JSON.stringify(added)) return;
      files = results.filter(x=>x.status==='fulfilled').map(x=>x.value);
      fileErrors = results.flatMap((x,i)=>x.status==='rejected' ? [`${candidates.find(c=>c.id===wanted[i])?.label || '已选来源'}读取失败`] : []);
    } catch (error) {discoveryLoaded = true; discoveryError = `来源发现失败（${error.message}）。`;}
    if (!destroyed) render();
  }
  shadow.addEventListener('click', event => {
    const summary = event.target.closest('summary');
    if (summary) {const detail=summary.parentElement, key=detail.closest('[data-read-key]')?.dataset.readKey; if (key && !detail.open && detail.matches('.video-card-sources')) setTimeout(()=>markRead(key),0);}
    const link = event.target.closest('a.video-card-link');
    if (link) {const key=link.closest('[data-read-key]')?.dataset.readKey; if (key) setTimeout(()=>markRead(key),0);}
    const target = event.target.closest('button');
    if (!target) return;
    if (target.matches('.bubble')) setOpened(true);
    else if (target.matches('.expand-content')) {const key=target.dataset.expandKey; if (expandedContent.has(key)) expandedContent.delete(key); else {expandedContent.add(key); if (target.dataset.readKey) unreadState?.unread.delete(target.dataset.readKey); if (unreadState) saveUnread();} render();}
    else if (target.matches('.close')) {setOpened(false); $('.bubble').focus();}
    else if (target.matches('.refresh')) {refresh(); controller?.refresh();}
    else if (target.matches('.exclude-session')) controller?.exclude(target.dataset.sessionId,target.dataset.excluded !== 'true');
    else if (target.matches('.event-open')) controller?.open(target.dataset.sessionId);
    else if (target.matches('.more-events')) {visibleCount += pageSize; render();}
    else if (target.matches('.read-one')) markRead(target.dataset.readKey);
    else if (target.matches('.mark-all')) {for (const item of unreadItems(overview?.events || [])) if (filter === 'all' || filter === item.category) unreadState.unread.delete(item.key); saveUnread(); render();}
    else if (target.matches('.add-source')) {
      const id = $('.candidate').value;
      if (id && !added.includes(id) && added.length < 5) {added.push(id); localStorage.setItem(storedSourcesKey,JSON.stringify(added)); render(); refreshDiscovery();}
    }
    else if (target.matches('.remove-source')) {added = added.filter(id=>id!==target.dataset.sourceId); files = files.filter(file=>file.id!==target.dataset.sourceId); localStorage.setItem(storedSourcesKey,JSON.stringify(added)); render(); refreshDiscovery();}
    else if (target.dataset.filter) {filter = target.dataset.filter; visibleCount = pageSize; for (const button of shadow.querySelectorAll('[data-filter]')) button.setAttribute('aria-pressed', String(button === target)); render();}
  });
  shadow.addEventListener('input', event => {if (event.target.matches('.life-search')) {query=event.target.value; visibleCount=pageSize; render(); if (query.trim()) loadHistory();}});
  shadow.addEventListener('change', event => {if (event.target.matches('.candidate')) $('.add-source').disabled = !event.target.value || added.length >= 5;});
  const timer = setInterval(() => {if (!document.hidden) refresh();}, 30000);
  setOpened(embedded); render();
  if (!embedded) refresh();
  return {
    update(next) {snapshot = next; render();},
    setController(value) {controller = value; sessionView = value.view(); controller.setActive(opened); render();},
    setSessionView(value) {sessionView = value; render();},
    reset() {snapshot = null; render();},
    show: () => setOpened(true),
    destroy() {destroyed = true; clearInterval(timer); root.remove();},
  };
}
