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
  koFlashId: '',
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
  teams: { title: '球队', sub: '登记参赛球队、简称、主场、档位与分组', action: '新增球队' },
  venues: { title: '场地', sub: '登记比赛场地、容量与可用日', action: '新增场地' },
  matches: { title: '赛程', sub: '按轮次查看对阵，登记比分后积分随之变化', action: '新增赛程' },
  knockout: { title: '淘汰赛', sub: '按种子位抽签生成签表，胜者逐场晋级，可从任意一场追回首轮种子位', action: '' },
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
      <td>${item.group ? `<span class="pill done">${escapeHtml(item.group)}</span>` : '<span class="muted">—</span>'}</td>
      <td>${escapeHtml(item.city)}</td>
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

/* 淘汰赛 */
async function loadKnockout() {
  try {
    state.knockout = await request('/api/knockout');
  } catch (err) {
    if (err.code === 'KNOCKOUT_NOT_FOUND') state.knockout = null;
    else throw err;
  }
  renderKnockout();
}

function seedTag(seed, group) {
  return `<span class="seed-tag ${group ? 'has-group' : ''}" title="${group ? `分组 ${escapeHtml(group)}` : ''}">${seed}${group ? `·${escapeHtml(group)}` : ''}</span>`;
}

function sideHtml(match, side) {
  const isA = side === 'A';
  const desc = isA ? match.sideA : match.sideB;
  const name = isA ? match.leftName : match.rightName;
  const seed = isA ? match.leftSeed : match.rightSeed;
  const ready = isA ? match.leftReady : match.rightReady;
  const goals = isA ? match.homeGoals : match.awayGoals;
  const win = match.winnerSide === side;
  const traceLeaves = isA ? match.leavesA : match.leavesB;
  const traceText = traceLeaves.map((x) => `种子${x.seed} ${x.teamName}${x.group ? `（${x.group}组）` : ''}`).join('、');

  if (desc.kind === 'bye') {
    return `<div class="ko-side bye"><span class="seed-tag">—</span><span class="nm">轮空</span></div>`;
  }
  if (desc.kind === 'seed') {
    const group = (traceLeaves[0] && traceLeaves[0].group) || '';
    return `<div class="ko-side ${win ? 'win' : ''}" title="最初种子位：${escapeHtml(traceText)}">
      ${seedTag(seed, group)}<span class="nm">${escapeHtml(name)}</span>
      ${match.status === '已赛' ? `<span class="sc">${goals}</span>` : ''}
    </div>`;
  }
  // 上一场胜者：点标签可以跳到那场
  const filled = ready;
  return `<div class="ko-side ${win ? 'win' : ''}">
    <button type="button" class="seed-tag" data-jump="${desc.fromMatchId}" title="点这里跳到它的上一场 ${desc.fromMatchCode}；这一边可追溯的种子位：${escapeHtml(traceText)}">←${escapeHtml(desc.fromMatchCode)}</button>
    <span class="nm ${filled ? '' : 'wait-nm'}">${escapeHtml(name)}</span>
    ${match.status === '已赛' ? `<span class="sc">${goals}</span>` : ''}
  </div>`;
}

function matchCardHtml(match, roundIndex) {
  const done = match.status === '已赛';
  const bye = match.status === '轮空';
  const bothReady = match.leftReady && match.rightReady;
  const fromA = match.sideA.kind === 'match' ? match.sideA.fromMatchCode : '';
  const fromB = match.sideB.kind === 'match' ? match.sideB.fromMatchCode : '';
  const deciderText = match.decider === '加时' ? '加时决胜' : (match.decider === '点球' ? '点球决胜' : '');
  return `<div class="ko-slot ${roundIndex > 0 ? 'with-lines' : ''}">
    ${roundIndex > 0 ? '<span class="k-line k-line-vup"></span><span class="k-line k-line-vdown"></span><span class="k-line k-line-hl"></span>' : ''}
    ${match.isFinal ? '' : '<span class="k-line k-line-hr"></span>'}
    <div class="ko-match ${done ? 'is-done' : ''} ${bye ? 'is-bye' : ''} ${match.isFinal ? 'is-final' : ''}" data-match-card="${match.id}">
      <div class="ko-meta">
        <span class="code">${match.code}</span>
        <span>${escapeHtml(match.roundName)}</span>
        ${match.isFinal ? '<span class="spacer"></span><span title="最后一场，胜者夺冠">🏆 决赛</span>' : ''}
        ${bye ? '<span class="spacer"></span><span class="ko-note">自动晋级</span>' : ''}
        ${done && deciderText ? `<span class="spacer"></span><span class="ko-note">${deciderText}</span>` : ''}
      </div>
      ${sideHtml(match, 'A')}
      ${sideHtml(match, 'B')}
      ${done || bye ? `
        <div class="ko-foot">
          <span class="ko-score-text">${escapeHtml(match.scoreText || (bye ? '轮空' : ''))}</span>
          ${bye ? '<span class="ko-goto">自动落位</span>' : `<span class="ko-goto">胜者 → <b>${match.nextCode || '夺冠'}</b>${match.nextSideText ? `（${match.nextSideText}）` : ''}</span>`}
          ${done ? `<button type="button" class="mini ko-mini" data-ko-result="${match.id}">改比分</button>` : ''}
        </div>` : `
        <div class="ko-foot">
          <span class="ko-goto">${match.nextCode ? `胜者去 <b>${match.nextCode}</b>${match.nextSideText ? `（${match.nextSideText}）` : ''}` : '胜者夺冠'}</span>
          <button type="button" class="mini ko-mini" ${bothReady ? '' : 'disabled'} title="${bothReady ? '登记这场比分' : '上一场还没打完，两边球队没到齐'}" data-ko-result="${match.id}">登记比分</button>
        </div>
        ${fromA || fromB ? `<div class="ko-from"><span>上一场：</span><span><button type="button" data-jump="${match.sideA.kind === 'match' ? match.sideA.fromMatchId : ''}" ${match.sideA.kind === 'match' ? '' : 'style="display:none"'}>${fromA}</button> <button type="button" data-jump="${match.sideB.kind === 'match' ? match.sideB.fromMatchId : ''}" ${match.sideB.kind === 'match' ? '' : 'style="display:none"'}>${fromB}</button></span></div>` : ''}
        ${match.note ? `<div class="ko-note">${escapeHtml(match.note)}</div>` : ''}
      `}
    </div>
  </div>`;
}

function renderKnockout() {
  const ko = state.knockout;
  const hasKo = Boolean(ko);
  el('ko-empty').classList.toggle('show', !hasKo);
  el('ko-entrants-card').style.display = hasKo ? '' : 'none';
  el('ko-bracket-scroll').style.display = hasKo ? '' : 'none';
  el('ko-rules').style.display = hasKo ? '' : 'none';
  el('ko-champion').classList.toggle('show', Boolean(hasKo && ko.champion));
  if (!hasKo) {
    el('ko-toolbar').innerHTML = '';
    el('ko-rules').innerHTML = '';
    el('ko-bracket').innerHTML = '';
    el('ko-entrants').innerHTML = '';
    return;
  }

  el('ko-toolbar').innerHTML = `
    <span class="hint">${escapeHtml(ko.season)}　${ko.teamCount} 队签表 · 共 ${ko.totalMatches} 场（轮空 ${ko.byeMatches} 场）· 已赛 ${ko.playedMatches} 场</span>
    <span style="margin-left:auto"></span>
    <button type="button" class="ghost" id="ko-redraw">重新抽签</button>
    <button type="button" class="mini danger" id="ko-clear">清空签表</button>`;
  el('ko-redraw').addEventListener('click', openDrawDrawer);
  el('ko-clear').addEventListener('click', async () => {
    if (!window.confirm('清空后这张签表和全部已登记的淘汰赛比分都会删除，确定吗？')) return;
    try {
      await request('/api/knockout', { method: 'DELETE' });
      state.knockout = null;
      renderKnockout();
      toast('签表已清空', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  });

  const rules = ko.violations.length === 0
    ? `<div class="rule-line ok"><span class="mark">✓</span><span><b>两条抽签口径都满足：</b>高种子按分区落位，决赛之前不会碰面；同组球队首轮不相遇。</span></div>`
    : `<div class="rule-line ok"><span class="mark">✓</span><span><b>高种子决赛前不碰面：</b>1、2 号种子只可能在决赛相遇，前四档要到半决赛后、前八档要到八强战后才可能相遇。</span></div>`
      + ko.violations.map((v) => `<div class="rule-line bad"><span class="mark">✗</span><span>${escapeHtml(v.message)}</span></div>`).join('');
  el('ko-rules').innerHTML = rules;

  if (ko.champion) {
    el('ko-champion').innerHTML = `<span class="crown">🏆</span><div><b>${escapeHtml(ko.champion.name)} 夺冠</b><div class="muted">一路赢到决赛最后一场，签表走完</div></div>`;
  }

  el('ko-bracket').innerHTML = ko.rounds.map((round, roundIndex) => `
    <div class="ko-round">
      <div class="ko-round-head">${escapeHtml(round.name)}<em>${round.matches.length} 场</em></div>
      <div class="ko-slots">${round.matches.map((m) => matchCardHtml(m, roundIndex)).join('')}</div>
    </div>`).join('');

  el('ko-entrants').innerHTML = ko.entrants.map((t) => `
    <span class="ko-entrant" title="种子位 ${t.seedRank}${t.group ? `，${t.group} 组` : ''}">
      <span class="rank">${t.seedRank}</span>${escapeHtml(t.name)}${t.group ? `<span class="grp">${escapeHtml(t.group)}</span>` : ''}
    </span>`).join('');

  if (state.koFlashId) {
    const card = document.querySelector(`[data-match-card="${state.koFlashId}"]`);
    if (card) {
      card.classList.add('flash');
      card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'center' });
      window.setTimeout(() => card.classList.remove('flash'), 2200);
    }
    state.koFlashId = '';
  }
}

function openDrawDrawer() {
  const active = state.teams.filter((t) => t.status === '参赛');
  const sorted = active.slice().sort((a, b) => a.seedRank - b.seedRank);
  state.drawer = { mode: 'draw', entity: 'knockout', id: '', title: '淘汰赛抽签' };
  el('drawer-form').innerHTML = `
    <p class="hint">勾选进入淘汰赛的球队（默认全部参赛队）。档位必须正好排成 1、2、3……；队数不足 16、8、4、2 时，轮空按惯例留给最高档种子。</p>
    <div class="ko-picklist" id="ko-picklist">
      ${sorted.map((t) => `<label>
        <input type="checkbox" data-team-pick="${escapeHtml(t.id)}" checked>
        <span class="rank">${t.seedRank}</span>
        <span>${escapeHtml(t.name)}（${escapeHtml(t.shortName)}）</span>
        ${t.group ? `<span class="grp">${escapeHtml(t.group)} 组</span>` : '<span class="hint">未分组</span>'}
      </label>`).join('')}
    </div>
    <p class="hint" id="ko-draw-count">已选 ${sorted.length} 支球队</p>
    <p class="hint">抽签口径：高种子分区落位（决赛前不碰面）；同组球队首轮尽量避开，实在避让不开时会在签表上方写明是哪一组、在哪一场相遇。</p>`;
  showDrawer();
  el('ko-picklist').addEventListener('change', () => {
    const n = el('ko-picklist').querySelectorAll('input:checked').length;
    el('ko-draw-count').textContent = `已选 ${n} 支球队`;
  });
}

function openKoResultDrawer(match) {
  state.drawer = { mode: 'ko-result', entity: 'knockout', id: match.id, title: `登记比分：${match.code} ${match.roundName}` };
  el('drawer-form').innerHTML = `
    <div class="field-row">
      <label class="field"><span>${escapeHtml(match.leftName)}（左）常规进球</span><input data-name="homeGoals" maxlength="2" value="${match.homeGoals !== null ? match.homeGoals : ''}" placeholder="0"></label>
      <label class="field"><span>${escapeHtml(match.rightName)}（右）常规进球</span><input data-name="awayGoals" maxlength="2" value="${match.awayGoals !== null ? match.awayGoals : ''}" placeholder="0"></label>
    </div>
    <label class="field"><span>打平怎么办（淘汰赛不允许平局收场）</span>
      <select data-name="decider" id="ko-decider">
        <option value="常规" ${match.decider === '常规' || !match.decider ? 'selected' : ''}>常规时间分出胜负</option>
        <option value="加时" ${match.decider === '加时' ? 'selected' : ''}>打平，进加时赛</option>
        <option value="点球" ${match.decider === '点球' ? 'selected' : ''}>打平（或加时仍平），点球决胜</option>
      </select>
    </label>
    <div class="field-row" id="ko-extra-row" style="display:none">
      <label class="field"><span>${escapeHtml(match.leftName)} 加时进球</span><input data-name="extraHome" maxlength="2" value="${match.extraHomeGoals !== null && match.extraHomeGoals !== undefined ? match.extraHomeGoals : ''}" placeholder="0"></label>
      <label class="field"><span>${escapeHtml(match.rightName)} 加时进球</span><input data-name="extraAway" maxlength="2" value="${match.extraAwayGoals !== null && match.extraAwayGoals !== undefined ? match.extraAwayGoals : ''}" placeholder="0"></label>
    </div>
    <div class="field-row" id="ko-penalty-row" style="display:none">
      <label class="field"><span>${escapeHtml(match.leftName)} 点球罚进</span><input data-name="penaltyHome" maxlength="2" value="${match.penaltyHome !== null && match.penaltyHome !== undefined ? match.penaltyHome : ''}" placeholder="4"></label>
      <label class="field"><span>${escapeHtml(match.rightName)} 点球罚进</span><input data-name="penaltyAway" maxlength="2" value="${match.penaltyAway !== null && match.penaltyAway !== undefined ? match.penaltyAway : ''}" placeholder="3"></label>
    </div>
    <p class="hint">登记后胜者会自动落到 <b>${match.nextCode ? `${match.nextCode} 的${match.nextSideText}` : '冠军位置'}</b>；改判一场时，它下游已经打完的场次会一起作废。</p>`;
  showDrawer();
  const syncDecider = () => {
    const v = el('ko-decider').value;
    el('ko-extra-row').style.display = v === '加时' ? '' : 'none';
    el('ko-penalty-row').style.display = v === '点球' ? '' : 'none';
  };
  el('ko-decider').addEventListener('change', syncDecider);
  syncDecider();
}

function promotionBannerHtml(info) {
  if (!info) return '';
  const parts = [];
  parts.push(`<b>${escapeHtml(info.code)}</b>：${escapeHtml(info.winnerName)} 经${escapeHtml(info.deciderText)}取胜晋级`);
  if (info.champion) parts.push(`这是决赛——<b>${escapeHtml(info.champion.name)} 夺冠</b>`);
  else if (info.promotion) parts.push(`下一场 <b>${escapeHtml(info.promotion.nextCode)}（${escapeHtml(info.promotion.nextRoundName)}）的${escapeHtml(info.promotion.sideText)}换成 <b>${escapeHtml(info.promotion.teamName)}</b>`);
  let html = `<div class="ko-promote show" id="ko-promote-banner">${parts.join('，')}。</div>`;
  if (info.cleared && info.cleared.length) {
    html += `<div class="ko-promote show bad-clear">改判牵连作废的下游场次：${info.cleared.map((c) => c.code).join('、')}，这些场次要按新的胜者重新登记。</div>`;
  }
  return html;
}

function showPromotionBanner(info) {
  document.querySelectorAll('.ko-promote').forEach((n) => n.remove());
  const host = el('ko-rules');
  host.insertAdjacentHTML('afterend', promotionBannerHtml(info));
  window.setTimeout(() => {
    document.querySelectorAll('.ko-promote').forEach((n) => n.remove());
  }, 8000);
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
      <label class="field"><span>分组（选填）</span><input data-name="group" maxlength="4" value="${escapeHtml(team ? (team.group || '') : '')}" placeholder="A"></label>
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
      if (mode === 'draw') {
        const teamIds = Array.from(el('drawer-form').querySelectorAll('[data-team-pick]:checked')).map((n) => n.dataset.teamPick);
        const drawn = await request('/api/knockout/generate', {
          method: 'POST',
          body: JSON.stringify({ teamIds }),
        });
        state.knockout = drawn;
        renderKnockout();
        closeDrawer();
        if (drawn.violations.length) {
          toast(`抽签完成，但有 ${drawn.violations.length} 条口径没满足，签表上方有说明`, 'bad');
        } else {
          toast('抽签完成，两条口径都满足', 'ok');
        }
        return;
      }
      if (mode === 'ko-result') {
        const body = {
          homeGoals: Number(payload.homeGoals),
          awayGoals: Number(payload.awayGoals),
          decider: payload.decider,
        };
        if (payload.decider === '加时') {
          body.extraHome = Number(payload.extraHome);
          body.extraAway = Number(payload.extraAway);
        }
        if (payload.decider === '点球') {
          body.penaltyHome = Number(payload.penaltyHome);
          body.penaltyAway = Number(payload.penaltyAway);
        }
        const next = await request(`/api/knockout/matches/${encodeURIComponent(id)}/result`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        state.knockout = next;
        state.koFlashId = next.justRecorded && next.justRecorded.promotion ? next.justRecorded.promotion.nextMatchId : (next.justRecorded ? next.justRecorded.matchId : '');
        renderKnockout();
        closeDrawer();
        toast('比分已登记，胜者已自动落到下一场', 'ok');
        if (next.justRecorded) showPromotionBanner(next.justRecorded);
        return;
      }
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
    if (view === 'knockout') { await Promise.all([loadTeams(), loadKnockout()]); }
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
    const all = state.knockout.rounds.flatMap((r) => r.matches);
    return openKoResultDrawer(all.find((m) => m.id === node.dataset.koResult));
  }
  if (node.dataset.jump) {
    const target = document.querySelector(`[data-match-card="${node.dataset.jump}"]`);
    if (target) {
      target.classList.add('flash');
      target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'center' });
      window.setTimeout(() => target.classList.remove('flash'), 2000);
    }
    return;
  }
  if (node.id === 'ko-draw-empty') return openDrawDrawer();
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
