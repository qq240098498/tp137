// 页面交互：左侧导航切换视图，右侧抽屉负责新增与编辑，所有提示走右上角浮层

const state = {
  view: 'overview',
  teams: [],
  venues: [],
  matches: [],
  rounds: [],
  standings: null,
  summary: null,
  knockout: null,
  drawer: { mode: '', entity: '', id: '', title: '' },
  teamFilter: { status: '', keyword: '' },
  venueFilter: { keyword: '' },
  matchFilter: { round: '', status: '', keyword: '' },
  tableFilter: { keyword: '' },
};

const OPERATOR_KEY = 'league-board-operator';
const WEEKDAYS = [['0', '周日'], ['1', '周一'], ['2', '周二'], ['3', '周三'], ['4', '周四'], ['5', '周五'], ['6', '周六']];
const VIEW_META = {
  overview: { title: '概览', sub: '整季的场次进度与最近赛果', action: '' },
  teams: { title: '球队', sub: '登记参赛球队、简称、主场与档位', action: '新增球队' },
  venues: { title: '场地', sub: '登记比赛场地、容量与可用日', action: '新增场地' },
  matches: { title: '赛程', sub: '按轮次查看对阵，登记比分后积分随之变化', action: '新增赛程' },
  knockout: { title: '淘汰赛', sub: '按种子位生成签表，逐场登记比分推进晋级', action: '' },
  table: { title: '积分榜', sub: '按积分、净胜球、进球依次排序', action: '' },
};

const el = (id) => document.getElementById(id);

async function request(path, options) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  let payload = null;
  try {
    payload = await res.json();
  } catch (err) {
    payload = null;
  }
  if (!res.ok) {
    const error = (payload && payload.error) || {};
    const failure = new Error(error.message || `请求失败（状态码 ${res.status}）`);
    failure.code = error.code || '';
    failure.field = error.field || '';
    throw failure;
  }
  return payload;
}

function toast(message, kind) {
  const node = document.createElement('div');
  node.className = `toast ${kind === 'ok' ? 'ok' : 'bad'}`;
  node.textContent = message;
  el('toasts').appendChild(node);
  window.setTimeout(() => node.remove(), 3600);
}

function escapeHtml(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const statusPill = (status) => {
  const map = { 已赛: 'done', 待赛: 'wait', 延期: 'late', 取消: 'off' };
  return `<span class="pill ${map[status] || 'wait'}">${escapeHtml(status)}</span>`;
};

async function loadHealth() {
  const node = el('link-state');
  try {
    await request('/api/health');
    node.className = 'link-state ok';
    node.innerHTML = '<span class="dot"></span>服务正常';
  } catch (err) {
    node.className = 'link-state bad';
    node.innerHTML = '<span class="dot"></span>服务连不上';
  }
}

async function loadSummary() {
  state.summary = await request('/api/summary');
  el('season-name').textContent = state.summary.season;
  renderOverview();
}

async function loadStandings() {
  const params = new URLSearchParams();
  if (state.tableFilter.keyword) params.set('keyword', state.tableFilter.keyword);
  state.standings = await request(`/api/standings${params.toString() ? `?${params}` : ''}`);
  renderStandings();
}

async function loadTeams() {
  const params = new URLSearchParams();
  if (state.teamFilter.status) params.set('status', state.teamFilter.status);
  if (state.teamFilter.keyword) params.set('keyword', state.teamFilter.keyword);
  const payload = await request(`/api/teams${params.toString() ? `?${params}` : ''}`);
  state.teams = payload.teams;
  el('nav-teams').textContent = String(payload.total);
  renderTeams();
}

async function loadVenues() {
  const params = new URLSearchParams();
  if (state.venueFilter.keyword) params.set('keyword', state.venueFilter.keyword);
  const payload = await request(`/api/venues${params.toString() ? `?${params}` : ''}`);
  state.venues = payload.venues;
  el('nav-venues').textContent = String(payload.total);
  renderVenues();
}

async function loadMatches() {
  const params = new URLSearchParams();
  if (state.matchFilter.round) params.set('round', state.matchFilter.round);
  if (state.matchFilter.status) params.set('status', state.matchFilter.status);
  if (state.matchFilter.keyword) params.set('keyword', state.matchFilter.keyword);
  const payload = await request(`/api/matches${params.toString() ? `?${params}` : ''}`);
  state.matches = payload.matches;
  state.rounds = payload.rounds;
  el('nav-matches').textContent = String(payload.total);
  renderMatches();
}

async function loadKnockout() {
  const payload = await request('/api/knockout');
  state.knockout = payload;
  const bracket = payload && payload.bracket;
  el('nav-knockout').textContent = bracket ? `${bracket.stats.played}/${bracket.stats.total}` : '签表';
  renderKnockout();
}

function renderOverview() {
  const data = state.summary;
  if (!data) return;
  el('stat-row').innerHTML = [
    ['球队', `${data.activeTeamCount} / ${data.teamCount}`, '参赛中的队数'],
    ['场地', String(data.venueCount), '已登记的比赛场地'],
    ['赛程进度', `${data.playedRounds} / ${data.totalRounds}`, '打完的轮次'],
    ['已赛 / 待赛', `${data.playedMatches} / ${data.pendingMatches}`, `延期 ${data.postponedMatches} 场`],
  ].map(([label, value, note], index) => `<div class="stat ${index === 0 ? 'accent' : ''}"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}　${escapeHtml(note)}</span></div>`).join('');

  el('points-hint').textContent = `胜 ${data.points.win} 分 / 平 ${data.points.draw} 分`;
  el('recent-feed').innerHTML = data.recent.length
    ? data.recent.map((item) => `<li>
        <span class="round-tag">第 ${item.round} 轮</span>
        <span>${escapeHtml(item.homeName)}</span>
        <span class="score">${escapeHtml(item.scoreText)}</span>
        <span>${escapeHtml(item.awayName)}</span>
        <span class="muted" style="margin-left:auto">${escapeHtml(item.date)}</span>
      </li>`).join('')
    : '<li class="muted">还没有打完的场次</li>';

  el('podium').innerHTML = data.topThree.length
    ? data.topThree.map((row) => `<li>
        <span class="rank-badge">${row.rank}</span>
        <span>${escapeHtml(row.name)}</span>
        <span class="muted">净胜 ${row.goalDiff}</span>
        <span class="pts">${row.points} 分</span>
      </li>`).join('')
    : '<li class="muted">暂无排名</li>';
}

function renderTeams() {
  el('team-rows').innerHTML = state.teams.map((item) => `<tr>
      <td class="num">${item.seedRank}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.shortName)}</td>
      <td>${escapeHtml(item.city)}</td>
      <td>${escapeHtml(item.groupName || '—')}</td>
      <td>${escapeHtml(item.venueName)}</td>
      <td class="num">${item.matchCount}</td>
      <td>${item.status === '参赛' ? '<span class="pill done">参赛</span>' : '<span class="pill off">退赛</span>'}</td>
      <td class="muted">${escapeHtml(item.note)}</td>
      <td>
        <button type="button" class="mini" data-edit-team="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="mini danger" data-del-team="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('team-empty').classList.toggle('show', state.teams.length === 0);
}

function renderVenues() {
  el('venue-grid').innerHTML = state.venues.map((item) => `<article class="venue-card">
      <h3>${escapeHtml(item.name)}</h3>
      <div class="city">${escapeHtml(item.city)}</div>
      <dl>
        <dt>容量</dt><dd>${item.capacity} 人</dd>
        <dt>可用日</dt><dd>${escapeHtml(item.weekdaysText)}</dd>
        <dt>主场球队</dt><dd>${item.homeTeams.length ? escapeHtml(item.homeTeams.join('、')) : '无'}</dd>
        <dt>已排场次</dt><dd>${item.matchCount} 场</dd>
      </dl>
      <div class="card-actions">
        <button type="button" class="mini" data-edit-venue="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="mini danger" data-del-venue="${escapeHtml(item.id)}">删除</button>
      </div>
    </article>`).join('');
  el('venue-empty').classList.toggle('show', state.venues.length === 0);
}

function renderRounds() {
  const chips = [{ round: '', label: '全部轮次' }].concat(state.rounds.map((item) => ({
    round: String(item.round),
    label: `第 ${item.round} 轮 ${item.played}/${item.total}`,
  })));
  el('round-chips').innerHTML = chips.map((chip) => `<button type="button" class="${String(state.matchFilter.round) === chip.round ? 'is-active' : ''}" data-round="${chip.round}">${escapeHtml(chip.label)}</button>`).join('');
}

function renderMatches() {
  renderRounds();
  el('match-rows').innerHTML = state.matches.map((item) => `<tr>
      <td class="num">${item.round}</td>
      <td class="num">${escapeHtml(item.date)}</td>
      <td class="num">${escapeHtml(item.kickoff)}</td>
      <td>${escapeHtml(item.homeName)}</td>
      <td class="num">${item.scoreText ? escapeHtml(item.scoreText) : '—'}</td>
      <td>${escapeHtml(item.awayName)}</td>
      <td>${escapeHtml(item.venueName)}</td>
      <td>${statusPill(item.status)}</td>
      <td class="muted">${escapeHtml(item.note)}</td>
      <td>
        ${item.status === '已赛' ? '' : `<button type="button" class="mini" data-result-match="${escapeHtml(item.id)}">登记比分</button>`}
        <button type="button" class="mini" data-edit-match="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="mini danger" data-del-match="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('match-empty').classList.toggle('show', state.matches.length === 0);
}

function renderStandings() {
  const data = state.standings;
  if (!data) return;
  el('table-hint').textContent = `${data.season}　已打 ${data.playedMatches} 场，待赛 ${data.pendingMatches} 场，延期 ${data.postponedMatches} 场`;
  el('table-rows').innerHTML = data.table.map((row) => `<tr>
      <td class="num">${row.rank}</td>
      <td>${escapeHtml(row.name)}</td>
      <td>${row.played}</td>
      <td>${row.win}</td>
      <td>${row.draw}</td>
      <td>${row.loss}</td>
      <td>${row.goalsFor}</td>
      <td>${row.goalsAgainst}</td>
      <td>${row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}</td>
      <td><strong>${row.points}</strong></td>
    </tr>`).join('');
}

/* 淘汰赛签表 */
function koTraceTree(node) {
  return `<ul class="ko-tree"><li>${escapeHtml(node.label)}${node.children.map(koTraceTree).join('')}</li></ul>`;
}

function koSideRow(match, sideKey, label) {
  const side = match[sideKey];
  const goals = sideKey === 'home' ? match.homeGoals : match.awayGoals;
  const isWinner = match.winnerTeamId && side.teamId === match.winnerTeamId;
  return `<div class="ko-side ${isWinner ? 'winner' : ''}">
      <span class="seed-tag">${escapeHtml(side.seedText || '—')}</span>
      <span class="name ${side.pending ? 'muted' : ''}">${side.pending ? `待定（${escapeHtml(side.sourceText)}）` : escapeHtml(side.name)}</span>
      ${side.groupName ? `<span class="grp">${escapeHtml(side.groupName)}</span>` : ''}
      ${match.status === '已赛' ? `<b class="score">${goals}</b>` : ''}
    </div>
    <div class="ko-src">${label}来自：${escapeHtml(side.sourceText)}</div>`;
}

function koMatchCard(match) {
  return `<article class="ko-card ${match.status === '已赛' ? 'is-done' : ''}">
    <header><b>${escapeHtml(match.code)} · ${escapeHtml(match.roundName)}第${match.index}场</b>${statusPill(match.status)}</header>
    ${koSideRow(match, 'home', '主队')}
    ${koSideRow(match, 'away', '客队')}
    ${match.status === '已赛' ? `<div class="ko-result">${escapeHtml(match.scoreText)}${match.detailText ? ` · ${escapeHtml(match.detailText)}` : ''} · ${escapeHtml(match.winnerName)} 晋级</div>` : ''}
    <div class="ko-flow">去向：${escapeHtml(match.nextText)}</div>
    <details class="ko-trace"><summary>往回追到种子位</summary>
      <p>主队线：${koTraceTree(match.home.trace)}</p>
      <p>客队线：${koTraceTree(match.away.trace)}</p>
    </details>
    <div class="ko-actions">
      ${match.canRecord ? `<button type="button" class="mini" data-ko-result="${escapeHtml(match.id)}">${match.status === '已赛' ? '改比分' : '登记比分'}</button>` : '<span class="muted">等对阵确定</span>'}
    </div>
  </article>`;
}

function renderKnockout() {
  const payload = state.knockout;
  const bracket = payload && payload.bracket;
  el('ko-intro').hidden = Boolean(bracket);
  el('ko-layout').hidden = !bracket;
  el('knockout-generate').textContent = bracket ? '重新生成签表' : '生成签表';
  if (!bracket) {
    el('knockout-hint').textContent = '';
    el('ko-alerts').innerHTML = '';
    return;
  }
  const bits = [`${bracket.teamCount} 队`, `${bracket.bracketSize} 签位`, `已赛 ${bracket.stats.played}/${bracket.stats.total}`];
  if (bracket.champion) bits.push(`冠军：${bracket.champion.name}`);
  el('knockout-hint').textContent = bits.join(' · ');

  const alerts = [];
  bracket.violations.forEach((item) => alerts.push(`<div class="alert bad">未满足「${escapeHtml(item.rule)}」：${escapeHtml(item.detail)}</div>`));
  bracket.adjustments.forEach((text) => alerts.push(`<div class="alert note">${escapeHtml(text)}</div>`));
  el('ko-alerts').innerHTML = alerts.join('');

  el('bracket').innerHTML = bracket.rounds.map((round) => `
    <div class="bracket-round">
      <h3>${escapeHtml(round.roundName)}</h3>
      <div class="bracket-col">${round.matches.map(koMatchCard).join('')}</div>
    </div>`).join('');

  el('ko-log').innerHTML = bracket.log.length
    ? bracket.log.map((item) => `<li><span class="muted">${escapeHtml((item.at || '').slice(0, 10))}</span><span>${escapeHtml(item.text)}</span></li>`).join('')
    : '<li class="muted">还没有晋级记录</li>';

  el('ko-seed-hint').textContent = `${bracket.teamCount} 队`;
  el('ko-seeds').innerHTML = bracket.entries.map((entry) => `<li>
      <span class="seed-tag">种子${entry.seed}</span>
      <span>${escapeHtml(entry.currentName)}</span>
      ${entry.groupName ? `<span class="grp">${escapeHtml(entry.groupName)}</span>` : ''}
      <span class="muted">档位 ${entry.seedRank}</span>
    </li>`).join('');
}

/* 抽屉与表单 */
function fieldHtml(kind, name, label, extra) {
  const attrs = extra || '';
  if (kind === 'select') return `<label class="field"><span>${label}</span><select data-name="${name}" ${attrs}></select></label>`;
  if (kind === 'text') return `<label class="field"><span>${label}</span><input data-name="${name}" ${attrs}></label>`;
  return `<label class="field"><span>${label}</span>${extra || ''}</label>`;
}

function optionsHtml(list, selected) {
  return list.map((item) => `<option value="${escapeHtml(item.value)}" ${item.value === selected ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('');
}

function openTeamDrawer(team) {
  state.drawer = { mode: team ? 'edit' : 'create', entity: 'team', id: team ? team.id : '', title: team ? `编辑球队：${team.name}` : '新增球队' };
  const venueOptions = optionsHtml(state.venues.map((item) => ({ value: item.id, label: `${item.name}（${item.city}）` })), team ? team.venueId : (state.venues[0] ? state.venues[0].id : ''));
  el('drawer-form').innerHTML = `
    <label class="field"><span>球队名称</span><input data-name="name" maxlength="24" value="${escapeHtml(team ? team.name : '')}" placeholder="例如 江城铁马"></label>
    <div class="field-row">
      <label class="field"><span>简称（两到四个大写字母）</span><input data-name="shortName" maxlength="4" value="${escapeHtml(team ? team.shortName : '')}" placeholder="JCTM"></label>
      <label class="field"><span>所属城市</span><input data-name="city" maxlength="20" value="${escapeHtml(team ? team.city : '')}" placeholder="江城"></label>
    </div>
    <label class="field"><span>主场场地</span><select data-name="venueId">${venueOptions}</select></label>
    <div class="field-row">
      <label class="field"><span>档位</span><input data-name="seedRank" maxlength="2" value="${escapeHtml(team ? team.seedRank : '')}" placeholder="1"></label>
      <label class="field"><span>小组（选填，淘汰赛同组回避用）</span><input data-name="groupName" maxlength="8" value="${escapeHtml(team ? team.groupName || '' : '')}" placeholder="例如 A组"></label>
      <label class="field"><span>状态</span><select data-name="status">${optionsHtml([{ value: '参赛', label: '参赛' }, { value: '退赛', label: '退赛' }], team ? team.status : '参赛')}</select></label>
    </div>
    <label class="field"><span>备注</span><input data-name="note" maxlength="200" value="${escapeHtml(team ? team.note : '')}" placeholder="需要留意的地方"></label>`;
  showDrawer();
}

function openVenueDrawer(venue) {
  state.drawer = { mode: venue ? 'edit' : 'create', entity: 'venue', id: venue ? venue.id : '', title: venue ? `编辑场地：${venue.name}` : '新增场地' };
  const picked = venue ? venue.weekdays.map(String) : ['6'];
  el('drawer-form').innerHTML = `
    <label class="field"><span>场地名称</span><input data-name="name" maxlength="30" value="${escapeHtml(venue ? venue.name : '')}" placeholder="例如 江城体育中心"></label>
    <div class="field-row">
      <label class="field"><span>所属城市</span><input data-name="city" maxlength="20" value="${escapeHtml(venue ? venue.city : '')}" placeholder="江城"></label>
      <label class="field"><span>容量（人）</span><input data-name="capacity" maxlength="6" value="${escapeHtml(venue ? venue.capacity : '')}" placeholder="32000"></label>
    </div>
    <div class="field"><span>可用日</span><div class="weekday-pick">
      ${WEEKDAYS.map(([value, label]) => `<label><input type="checkbox" data-weekday="${value}" ${picked.includes(value) ? 'checked' : ''}> ${label}</label>`).join('')}
    </div></div>
    <label class="field"><span>备注</span><input data-name="note" maxlength="200" value="${escapeHtml(venue ? venue.note : '')}" placeholder="例如 三家共用"></label>`;
  showDrawer();
}

function openMatchDrawer(match) {
  state.drawer = { mode: match ? 'edit' : 'create', entity: 'match', id: match ? match.id : '', title: match ? `编辑赛程：第 ${match.round} 轮` : '新增赛程' };
  const teamOptions = state.teams.map((item) => ({ value: item.id, label: `${item.name}（${item.shortName}）` }));
  const venueOptions = [{ value: '', label: '留空表示用主队主场' }].concat(state.venues.map((item) => ({ value: item.id, label: item.name })));
  const statusOptions = ['待赛', '已赛', '延期', '取消'].map((value) => ({ value, label: value }));
  el('drawer-form').innerHTML = `
    <div class="field-row">
      <label class="field"><span>轮次</span><input data-name="round" maxlength="2" value="${escapeHtml(match ? match.round : '1')}" placeholder="1"></label>
      <label class="field"><span>日期</span><input data-name="date" maxlength="10" value="${escapeHtml(match ? match.date : '')}" placeholder="2026-03-14"></label>
      <label class="field"><span>开赛时刻</span><input data-name="kickoff" maxlength="5" value="${escapeHtml(match ? match.kickoff : '15:30')}" placeholder="15:30"></label>
    </div>
    <div class="field-row">
      <label class="field"><span>主队</span><select data-name="homeTeamId">${optionsHtml(teamOptions, match ? match.homeTeamId : '')}</select></label>
      <label class="field"><span>客队</span><select data-name="awayTeamId">${optionsHtml(teamOptions, match ? match.awayTeamId : '')}</select></label>
    </div>
    <label class="field"><span>场地</span><select data-name="venueId">${optionsHtml(venueOptions, match ? match.venueId : '')}</select></label>
    <div class="field-row">
      <label class="field"><span>状态</span><select data-name="status">${optionsHtml(statusOptions, match ? match.status : '待赛')}</select></label>
      <label class="field"><span>主队进球</span><input data-name="homeGoals" maxlength="2" value="${match && match.homeGoals !== null ? match.homeGoals : ''}" placeholder="留空表示未赛"></label>
      <label class="field"><span>客队进球</span><input data-name="awayGoals" maxlength="2" value="${match && match.awayGoals !== null ? match.awayGoals : ''}" placeholder="留空表示未赛"></label>
    </div>
    <label class="field"><span>备注</span><input data-name="note" maxlength="200" value="${escapeHtml(match ? match.note : '')}" placeholder="需要留意的地方"></label>`;
  showDrawer();
}

function openResultDrawer(match) {
  state.drawer = { mode: 'result', entity: 'match', id: match.id, title: `登记比分：${match.homeName} vs ${match.awayName}` };
  el('drawer-form').innerHTML = `
    <div class="field-row">
      <label class="field"><span>${escapeHtml(match.homeName)} 进球</span><input data-name="homeGoals" maxlength="2" value="" placeholder="0"></label>
      <label class="field"><span>${escapeHtml(match.awayName)} 进球</span><input data-name="awayGoals" maxlength="2" value="" placeholder="0"></label>
    </div>
    <p class="hint">登记完成后这场标成已赛，积分榜与名次立即重算。</p>`;
  showDrawer();
}

/* 淘汰赛登记比分：常规时间打平填加时，加时仍平填点球，点球不能打平 */
function openKoResultDrawer(match) {
  const title = `${match.status === '已赛' ? '改比分' : '登记比分'}：${match.code} ${match.home.name} vs ${match.away.name}`;
  state.drawer = { mode: 'ko-result', entity: 'knockout', id: match.id, title };
  const played = match.status === '已赛';
  el('drawer-form').innerHTML = `
    <p class="hint">淘汰赛必须分出胜负：常规时间打平要填加时赛进球，加时仍平再填点球，点球不能打平。</p>
    <div class="field-row">
      <label class="field"><span>${escapeHtml(match.home.name)}（常规时间）</span><input data-name="homeGoals" maxlength="2" value="${played ? match.homeGoals : ''}" placeholder="0"></label>
      <label class="field"><span>${escapeHtml(match.away.name)}（常规时间）</span><input data-name="awayGoals" maxlength="2" value="${played ? match.awayGoals : ''}" placeholder="0"></label>
    </div>
    <div class="field-row" data-block="extra" hidden>
      <label class="field"><span>加时赛 ${escapeHtml(match.home.name)}</span><input data-name="extraHome" maxlength="2" value="${played && match.extra ? match.extra.home : ''}" placeholder="0"></label>
      <label class="field"><span>加时赛 ${escapeHtml(match.away.name)}</span><input data-name="extraAway" maxlength="2" value="${played && match.extra ? match.extra.away : ''}" placeholder="0"></label>
    </div>
    <div class="field-row" data-block="penalties" hidden>
      <label class="field"><span>点球 ${escapeHtml(match.home.name)}</span><input data-name="penaltyHome" maxlength="2" value="${played && match.penalties ? match.penalties.home : ''}" placeholder="0"></label>
      <label class="field"><span>点球 ${escapeHtml(match.away.name)}</span><input data-name="penaltyAway" maxlength="2" value="${played && match.penalties ? match.penalties.away : ''}" placeholder="0"></label>
    </div>
    <p class="hint" data-block="verdict"></p>`;
  const form = el('drawer-form');
  const read = (name) => {
    const node = form.querySelector(`[data-name="${name}"]`);
    return node ? node.value.trim() : '';
  };
  const sync = () => {
    const home = read('homeGoals');
    const away = read('awayGoals');
    const tied = home !== '' && away !== '' && Number(home) === Number(away);
    form.querySelector('[data-block="extra"]').hidden = !tied;
    const extraHome = read('extraHome');
    const extraAway = read('extraAway');
    const extraTied = tied && extraHome !== '' && extraAway !== '' && Number(extraHome) === Number(extraAway);
    form.querySelector('[data-block="penalties"]').hidden = !extraTied;
    const verdict = form.querySelector('[data-block="verdict"]');
    if (home === '' || away === '') verdict.textContent = '';
    else if (!tied) verdict.textContent = '常规时间分出胜负，胜者直接晋级。';
    else if (extraHome === '' || extraAway === '') verdict.textContent = '常规时间打平，请填加时赛进球。';
    else if (!extraTied) verdict.textContent = '加时赛分出胜负，胜者晋级。';
    else verdict.textContent = '加时仍平，请填点球比分，点球不能打平。';
  };
  form.querySelectorAll('input').forEach((node) => node.addEventListener('input', sync));
  sync();
  showDrawer();
}

function showDrawer() {
  el('drawer-title').textContent = state.drawer.title;
  el('drawer').classList.add('show');
  el('backdrop').classList.add('show');
  const first = el('drawer-form').querySelector('input, select');
  if (first) first.focus();
}

function closeDrawer() {
  el('drawer').classList.remove('show');
  el('backdrop').classList.remove('show');
  el('drawer-form').innerHTML = '';
  state.drawer = { mode: '', entity: '', id: '', title: '' };
}

function collectForm() {
  const payload = {};
  el('drawer-form').querySelectorAll('[data-name]').forEach((node) => { payload[node.dataset.name] = node.value; });
  const days = Array.from(el('drawer-form').querySelectorAll('[data-weekday]'))
    .filter((node) => node.checked)
    .map((node) => Number(node.dataset.weekday));
  return { payload, days };
}

function markField(field) {
  const node = el('drawer-form').querySelector(`[data-name="${field}"]`);
  if (!node) return;
  const wrap = node.closest('.field');
  if (wrap) wrap.classList.add('invalid');
  node.focus();
}

async function submitDrawer() {
  el('drawer-form').querySelectorAll('.invalid').forEach((node) => node.classList.remove('invalid'));
  const { payload, days } = collectForm();
  const { mode, entity, id } = state.drawer;
  try {
    if (entity === 'team') {
      const body = { ...payload, seedRank: Number(payload.seedRank) };
      if (mode === 'edit') await request(`/api/teams/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await request('/api/teams', { method: 'POST', body: JSON.stringify(body) });
      toast(mode === 'edit' ? '球队已保存' : '球队已新增', 'ok');
      await Promise.all([loadTeams(), loadSummary()]);
    } else if (entity === 'venue') {
      const body = { ...payload, capacity: Number(payload.capacity), weekdays: days };
      if (mode === 'edit') await request(`/api/venues/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await request('/api/venues', { method: 'POST', body: JSON.stringify(body) });
      toast(mode === 'edit' ? '场地已保存' : '场地已新增', 'ok');
      await Promise.all([loadVenues(), loadTeams()]);
    } else if (entity === 'match') {
      if (mode === 'result') {
        await request(`/api/matches/${encodeURIComponent(id)}/result`, {
          method: 'POST',
          body: JSON.stringify({ homeGoals: Number(payload.homeGoals), awayGoals: Number(payload.awayGoals) }),
        });
        toast('比分已登记，积分榜已重算', 'ok');
      } else {
        const body = { ...payload, round: Number(payload.round) };
        if (mode === 'edit') await request(`/api/matches/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
        else await request('/api/matches', { method: 'POST', body: JSON.stringify(body) });
        toast(mode === 'edit' ? '赛程已保存' : '赛程已新增', 'ok');
      }
      await Promise.all([loadMatches(), loadSummary()]);
      if (state.view === 'table') await loadStandings();
    } else if (entity === 'knockout') {
      const form = el('drawer-form');
      const body = { homeGoals: payload.homeGoals, awayGoals: payload.awayGoals };
      if (!form.querySelector('[data-block="extra"]').hidden) {
        body.extraHome = payload.extraHome;
        body.extraAway = payload.extraAway;
      }
      if (!form.querySelector('[data-block="penalties"]').hidden) {
        body.penaltyHome = payload.penaltyHome;
        body.penaltyAway = payload.penaltyAway;
      }
      const res = await request(`/api/knockout/matches/${encodeURIComponent(id)}/result`, { method: 'POST', body: JSON.stringify(body) });
      toast(res.advancement.text, 'ok');
      await loadKnockout();
    }
    closeDrawer();
  } catch (err) {
    toast(err.message, 'bad');
    markField(err.field);
  }
}

/* 视图切换 */
async function switchView(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((node) => node.classList.toggle('is-active', node.dataset.view === view));
  document.querySelectorAll('.view').forEach((node) => node.classList.toggle('is-active', node.id === `view-${view}`));
  const meta = VIEW_META[view];
  el('view-title').textContent = meta.title;
  el('view-sub').textContent = meta.sub;
  el('head-actions').innerHTML = meta.action ? `<button type="button" class="primary" id="head-add">${meta.action}</button>` : '';
  if (meta.action) el('head-add').addEventListener('click', () => openDrawerFor(view, null));

  try {
    if (view === 'overview') await loadSummary();
    if (view === 'teams') { await Promise.all([loadVenues(), loadTeams()]); }
    if (view === 'venues') await loadVenues();
    if (view === 'matches') { await Promise.all([loadTeams(), loadMatches()]); }
    if (view === 'knockout') await loadKnockout();
    if (view === 'table') await loadStandings();
  } catch (err) {
    toast(err.message, 'bad');
  }
}

function openDrawerFor(view, id) {
  if (view === 'teams') openTeamDrawer(id ? state.teams.find((item) => item.id === id) : null);
  if (view === 'venues') openVenueDrawer(id ? state.venues.find((item) => item.id === id) : null);
  if (view === 'matches') openMatchDrawer(id ? state.matches.find((item) => item.id === id) : null);
}

/* 事件绑定 */
el('nav').addEventListener('click', (event) => {
  const node = event.target.closest('.nav-item');
  if (node) switchView(node.dataset.view);
});

el('team-status-filter').addEventListener('click', (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  state.teamFilter.status = node.dataset.value;
  el('team-status-filter').querySelectorAll('button').forEach((btn) => btn.classList.toggle('is-active', btn === node));
  loadTeams().catch((err) => toast(err.message, 'bad'));
});
el('team-search').addEventListener('click', () => {
  state.teamFilter.keyword = el('team-keyword').value.trim();
  loadTeams().catch((err) => toast(err.message, 'bad'));
});
el('venue-search').addEventListener('click', () => {
  state.venueFilter.keyword = el('venue-keyword').value.trim();
  loadVenues().catch((err) => toast(err.message, 'bad'));
});
el('match-search').addEventListener('click', () => {
  state.matchFilter.keyword = el('match-keyword').value.trim();
  loadMatches().catch((err) => toast(err.message, 'bad'));
});
el('match-status').addEventListener('change', () => {
  state.matchFilter.status = el('match-status').value;
  loadMatches().catch((err) => toast(err.message, 'bad'));
});
el('table-search').addEventListener('click', () => {
  state.tableFilter.keyword = el('table-keyword').value.trim();
  loadStandings().catch((err) => toast(err.message, 'bad'));
});
el('round-chips').addEventListener('click', (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  state.matchFilter.round = node.dataset.round;
  loadMatches().catch((err) => toast(err.message, 'bad'));
});

el('knockout-generate').addEventListener('click', async () => {
  const bracket = state.knockout && state.knockout.bracket;
  const message = bracket
    ? `重新生成会清空现有签表、已登记的 ${bracket.stats.played} 场比分与全部晋级记录，确定继续吗？`
    : '按当前参赛球队生成淘汰赛签表？';
  if (!window.confirm(message)) return;
  try {
    await request('/api/knockout/generate', { method: 'POST', body: '{}' });
    toast('签表已生成', 'ok');
    await loadKnockout();
  } catch (err) {
    toast(err.message, 'bad');
  }
});

document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  if (node.dataset.editTeam) return openDrawerFor('teams', node.dataset.editTeam);
  if (node.dataset.editVenue) return openDrawerFor('venues', node.dataset.editVenue);
  if (node.dataset.editMatch) return openDrawerFor('matches', node.dataset.editMatch);
  if (node.dataset.resultMatch) {
    return openResultDrawer(state.matches.find((item) => item.id === node.dataset.resultMatch));
  }
  if (node.dataset.koResult) {
    const bracket = state.knockout && state.knockout.bracket;
    if (!bracket) return undefined;
    const match = bracket.rounds.flatMap((round) => round.matches).find((item) => item.id === node.dataset.koResult);
    if (match) openKoResultDrawer(match);
    return undefined;
  }
  if (node.dataset.delTeam || node.dataset.delVenue || node.dataset.delMatch) {
    const isTeam = Boolean(node.dataset.delTeam);
    const isVenue = Boolean(node.dataset.delVenue);
    const id = node.dataset.delTeam || node.dataset.delVenue || node.dataset.delMatch;
    const what = isTeam ? '球队' : (isVenue ? '场地' : '这场赛程');
    if (!window.confirm(`确定删除这个${what}吗？`)) return;
    try {
      if (isTeam) { await request(`/api/teams/${encodeURIComponent(id)}`, { method: 'DELETE' }); await Promise.all([loadTeams(), loadSummary()]); }
      else if (isVenue) { await request(`/api/venues/${encodeURIComponent(id)}`, { method: 'DELETE' }); await loadVenues(); }
      else { await request(`/api/matches/${encodeURIComponent(id)}`, { method: 'DELETE' }); await Promise.all([loadMatches(), loadSummary()]); }
      toast('已删除', 'ok');
    } catch (err) {
      toast(err.message, 'bad');
    }
  }
});

el('drawer-submit').addEventListener('click', submitDrawer);
el('drawer-cancel').addEventListener('click', closeDrawer);
el('drawer-close').addEventListener('click', closeDrawer);
el('backdrop').addEventListener('click', closeDrawer);
el('drawer-form').addEventListener('submit', (event) => { event.preventDefault(); submitDrawer(); });
el('operator').addEventListener('change', () => {
  window.localStorage.setItem(OPERATOR_KEY, el('operator').value.trim());
});

async function boot() {
  el('operator').value = window.localStorage.getItem(OPERATOR_KEY) || '';
  await loadHealth();
  await switchView('overview');
}

boot();
