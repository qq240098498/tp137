// 淘汰赛：按种子位生成单败签表，管抽签约束（种子分区、同组首轮回避）、逐场晋级与加时/点球
const crypto = require('crypto');
const { load, save } = require('./store');
const { ApiError, pickText } = require('./errors');
const { buildStructure, buildSlots, findGroupArrangement, roundName } = require('./bracket');

const MIN_TEAMS = 2;
const MAX_TEAMS = 16;

// 取当前参赛队与档位的对照表
function seedToTeamMap(data) {
  const map = new Map();
  data.teams.forEach((t) => map.set(t.seedRank, t));
  return map;
}

function validateEntrants(input, data) {
  let teamIds;
  if (Array.isArray(input.teamIds)) {
    teamIds = input.teamIds.map((v) => pickText(v)).filter(Boolean);
  } else {
    teamIds = data.teams.filter((t) => t.status === '参赛').map((t) => t.id);
  }
  if (teamIds.length < MIN_TEAMS) {
    throw new ApiError(400, 'KNOCKOUT_TEAM_TOO_FEW', `淘汰赛至少要 ${MIN_TEAMS} 支球队`, 'teamIds');
  }
  if (teamIds.length > MAX_TEAMS) {
    throw new ApiError(400, 'KNOCKOUT_TEAM_TOO_MANY', `淘汰赛最多支持 ${MAX_TEAMS} 支球队`, 'teamIds');
  }
  if (new Set(teamIds).size !== teamIds.length) {
    throw new ApiError(400, 'KNOCKOUT_TEAM_DUPLICATED', '同一支球队在签表名单里出现了两次', 'teamIds');
  }
  const picked = teamIds.map((id) => {
    const team = data.teams.find((t) => t.id === id);
    if (!team) throw new ApiError(404, 'TEAM_NOT_FOUND', `名单里有球队没有登记过`, 'teamIds');
    if (team.status !== '参赛') throw new ApiError(400, 'TEAM_NOT_ACTIVE', `${team.name} 已退赛，不能进淘汰赛`, 'teamIds');
    return team;
  });
  const ranks = picked.map((t) => t.seedRank).sort((a, b) => a - b);
  if (ranks.some((r, i) => r !== i + 1)) {
    throw new ApiError(400, 'SEED_NOT_CONTIGUOUS', '入选球队的档位必须恰好排成 1、2、3……不得跳档或并档，请先在球队页整理档位', 'teamIds');
  }
  return picked;
}

// 用结构模板造一批空白场次
function blankMatches(n, now) {
  return buildStructure(n).matches.map((m) => ({
    id: m.id,
    round: m.round,
    order: m.order,
    sideA: { ...m.sideA },
    sideB: { ...m.sideB },
    nextMatchId: m.nextMatchId,
    nextSide: m.nextSide,
    status: '待赛',
    homeGoals: null,
    awayGoals: null,
    extraHomeGoals: null,
    extraAwayGoals: null,
    penaltyHome: null,
    penaltyAway: null,
    decider: '',
    awayWinner: null,
    winnerTeamId: null,
    byeWinnerSide: null,
    note: '',
    createdAt: now,
    updatedAt: now,
  }));
}

function generateKnockout(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  if (data.knockout && data.knockout.matches.some((m) => m.status === '已赛')) {
    throw new ApiError(409, 'KNOCKOUT_IN_PROGRESS', '淘汰赛已经有场次打完，先清空当前签表才能重新抽签', '');
  }

  const picked = validateEntrants(input, data);
  const n = picked.length;
  const now = new Date().toISOString();

  const groupOfSeed = new Map();
  picked.forEach((t) => groupOfSeed.set(t.seedRank, (t.group || '').trim()));
  const { arrangement, clashes } = findGroupArrangement(n, groupOfSeed);

  const matches = blankMatches(n, now);
  // 用搜索出的首轮摆法覆盖标准槽位
  matches.filter((m) => m.round === 1).forEach((m, i) => {
    const [a, b] = arrangement[i];
    m.sideA = { kind: a ? 'seed' : 'bye', seed: a || null, matchId: null };
    m.sideB = { kind: b ? 'seed' : 'bye', seed: b || null, matchId: null };
  });

  // 一边是种子、另一边轮空：种子自动落位，场次标成轮空
  matches.filter((m) => m.round === 1).forEach((m) => {
    if (m.sideA.kind === 'seed' && m.sideB.kind === 'bye') {
      m.status = '轮空';
      m.byeWinnerSide = 'A';
      m.winnerTeamId = (seedToTeamMap(data).get(m.sideA.seed) || {}).id || null;
      m.note = `种子 ${m.sideA.seed} 首轮轮空，自动晋级`;
    } else if (m.sideB.kind === 'seed' && m.sideA.kind === 'bye') {
      m.status = '轮空';
      m.byeWinnerSide = 'B';
      m.winnerTeamId = (seedToTeamMap(data).get(m.sideB.seed) || {}).id || null;
      m.note = `种子 ${m.sideB.seed} 首轮轮空，自动晋级`;
    }
  });

  const standard = buildSlots(n).map((p) => [p.seedA, p.seedB]);
  const arrangementChanged = arrangement.some((pair, i) => pair[0] !== standard[i][0] || pair[1] !== standard[i][1]);

  // 两条抽签口径逐条交代：做到没有、没做到时写清是哪一组在哪场撞了
  const rules = [
    {
      rule: 'SEED_SEPARATION',
      label: '高种子决赛前不碰面',
      satisfied: true,
      message: '已按标准分区落位：1、2 号种子只可能在决赛相遇，前四档半决赛后才可能相遇，前八档八强战后才可能相遇',
    },
    {
      rule: 'GROUP_SEPARATION',
      label: '同组球队首轮不相遇',
      satisfied: clashes.length === 0,
      adjusted: arrangementChanged,
      message: clashes.length === 0
        ? (arrangementChanged ? '标准摆法会让同组球队首轮相遇，已在不打乱种子分区的前提下调整同档分区内的落位，首轮无同组对阵' : '标准摆法下首轮就没有同组对阵，无需调整')
        : '',
    },
  ];
  const violations = [];
  if (clashes.length) {
    const groups = new Map();
    clashes.forEach((c) => {
      if (!groups.has(c.group)) groups.set(c.group, []);
      groups.get(c.group).push(c);
    });
    groups.forEach((list, group) => {
      const detail = list.map((c) => `首轮第 ${c.pairOrder} 场（种子 ${c.seedA} 对种子 ${c.seedB}）`).join('、');
      violations.push({
        rule: 'GROUP_SEPARATION',
        group,
        message: `「同组球队首轮不相遇」没满足：${group} 组在 ${detail} 同组相遇。该组球队数多于首轮能分摊的对阵数，在不破坏高种子分区的前提下怎么摆都避让不开，只能接受撞组或调整分档`,
      });
    });
    rules[1].message = violations.map((v) => v.message).join('；');
  }

  data.knockout = {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    teamIds: picked.map((t) => t.id),
    matches,
    violations,
  };
  save(data);
  const state = getKnockoutState();
  state.rules = rules;
  state.drew = true;
  return state;
}

// 一场两边此刻的占用人：种子直接出队，轮空自动让出，喂给它的上一场打完则出胜者
function resolveOccupants(match, knockout, data) {
  const byId = new Map(knockout.matches.map((m) => [m.id, m]));
  const seedToTeam = seedToTeamMap(data);

  function one(side) {
    if (side.kind === 'seed') {
      const team = seedToTeam.get(side.seed);
      return { teamId: team ? team.id : null, name: team ? team.name : `种子 ${side.seed}`, seed: side.seed, ready: Boolean(team) };
    }
    if (side.kind === 'bye') return { teamId: null, name: '轮空', seed: null, ready: false, bye: true };
    const feeder = byId.get(side.matchId);
    if (!feeder) return { teamId: null, name: '上一场胜者', seed: null, ready: false };
    if (feeder.status === '轮空') {
      const winSide = feeder.byeWinnerSide === 'B' ? feeder.sideB : feeder.sideA;
      const team = seedToTeam.get(winSide.seed);
      return { teamId: team ? team.id : null, name: team ? team.name : `种子 ${winSide.seed}`, seed: winSide.seed, ready: Boolean(team) };
    }
    if (feeder.winnerTeamId) {
      const team = data.teams.find((t) => t.id === feeder.winnerTeamId);
      return { teamId: feeder.winnerTeamId, name: team ? team.name : '未知球队', seed: null, ready: true };
    }
    return { teamId: null, name: `第${feeder.round}轮第${feeder.order}场胜者`, seed: null, ready: false };
  }
  return { a: one(match.sideA), b: one(match.sideB) };
}

// 作废一场下游全部已登记场次（不含它自己），返回被作废的清单
function clearDownstream(knockout, fromId) {
  const byId = new Map(knockout.matches.map((m) => [m.id, m]));
  const cleared = [];
  const queue = [];
  const first = byId.get(fromId);
  if (first && first.nextMatchId) queue.push(first.nextMatchId);
  while (queue.length) {
    const id = queue.shift();
    const m = byId.get(id);
    if (!m) continue;
    if (m.status === '已赛') {
      cleared.push({ matchId: m.id, code: `R${m.round}M${m.order}`, round: m.round, order: m.order });
    }
    m.status = m.status === '轮空' ? '轮空' : '待赛';
    m.homeGoals = null;
    m.awayGoals = null;
    m.extraHomeGoals = null;
    m.extraAwayGoals = null;
    m.penaltyHome = null;
    m.penaltyAway = null;
    m.decider = '';
    m.awayWinner = null;
    m.winnerTeamId = null;
    if (m.nextMatchId) queue.push(m.nextMatchId);
  }
  return cleared;
}

function integerOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

// 登记淘汰赛比分：打平必须给加时或点球的决胜口径，总有一边晋级
function recordKnockoutResult(matchId, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  if (!data.knockout) throw new ApiError(404, 'KNOCKOUT_NOT_FOUND', '还没有生成淘汰赛签表，请先抽签', '');
  const knockout = data.knockout;
  const match = knockout.matches.find((m) => m.id === matchId);
  if (!match) throw new ApiError(404, 'KO_MATCH_NOT_FOUND', '签表里没有这场比赛', '');
  if (match.status === '轮空') throw new ApiError(400, 'KO_MATCH_IS_BYE', '这是轮空场次，种子已自动晋级，不能登记比分', '');

  const occ = resolveOccupants(match, knockout, data);
  if (!occ.a.ready || !occ.b.ready) {
    throw new ApiError(409, 'KO_MATCH_NOT_READY', '这场的上一场还没打完，两边球队还没到齐，暂时不能登记比分', '');
  }

  const homeGoals = Number(input.homeGoals);
  const awayGoals = Number(input.awayGoals);
  if (!Number.isInteger(homeGoals) || homeGoals < 0 || homeGoals > 99) {
    throw new ApiError(400, 'GOALS_INVALID', '左边球队的进球数要填 0 到 99 之间的整数', 'homeGoals');
  }
  if (!Number.isInteger(awayGoals) || awayGoals < 0 || awayGoals > 99) {
    throw new ApiError(400, 'GOALS_INVALID', '右边球队的进球数要填 0 到 99 之间的整数', 'awayGoals');
  }

  let decider = '常规';
  let awayWinner = awayGoals > homeGoals;
  let extraHomeGoals = null;
  let extraAwayGoals = null;
  let penaltyHome = null;
  let penaltyAway = null;

  if (homeGoals === awayGoals) {
    decider = pickText(input.decider);
    if (decider === '加时') {
      extraHomeGoals = integerOrNull(input.extraHome);
      extraAwayGoals = integerOrNull(input.extraAway);
      if (!Number.isInteger(extraHomeGoals) || extraHomeGoals < 0 || extraHomeGoals > 20
        || !Number.isInteger(extraAwayGoals) || extraAwayGoals < 0 || extraAwayGoals > 20) {
        throw new ApiError(400, 'EXTRA_GOALS_INVALID', '打平进加时，要填两边加时赛各进了几球（0 到 20 的整数），没有进球就填 0', 'extraHome');
      }
      if (extraHomeGoals === extraAwayGoals) {
        throw new ApiError(400, 'EXTRA_STILL_DRAW', '加时赛后比分还是平的，按规则要接着罚点球决胜，请把决胜方式改选成点球', 'extraHome');
      }
      awayWinner = extraAwayGoals > extraHomeGoals;
    } else if (decider === '点球') {
      penaltyHome = integerOrNull(input.penaltyHome);
      penaltyAway = integerOrNull(input.penaltyAway);
      if (!Number.isInteger(penaltyHome) || penaltyHome < 0 || penaltyHome > 30
        || !Number.isInteger(penaltyAway) || penaltyAway < 0 || penaltyAway > 30) {
        throw new ApiError(400, 'PENALTY_INVALID', '要点球决胜，得填两边点球大战各自罚进了几轮（0 到 30 的整数）', 'penaltyHome');
      }
      if (penaltyHome === penaltyAway) {
        throw new ApiError(400, 'PENALTY_STILL_DRAW', '点球大战两边罚进数不能相同，总有一边先失手', 'penaltyHome');
      }
      awayWinner = penaltyAway > penaltyHome;
    } else {
      throw new ApiError(400, 'DECIDER_REQUIRED', '常规时间打平了：按规则要么进加时（填加时进球），要么点球决胜（填罚进轮数），不能按平局收场——淘汰赛不允许没人晋级', 'decider');
    }
  }

  // 改判一场前，下游靠它喂出来的已赛场次全部作废，避免下一场留着一支没赢出来的队
  const cleared = clearDownstream(knockout, match.id);

  match.status = '已赛';
  match.homeGoals = homeGoals;
  match.awayGoals = awayGoals;
  match.extraHomeGoals = extraHomeGoals;
  match.extraAwayGoals = extraAwayGoals;
  match.penaltyHome = penaltyHome;
  match.penaltyAway = penaltyAway;
  match.decider = decider;
  match.awayWinner = awayWinner;
  match.winnerTeamId = awayWinner ? occ.b.teamId : occ.a.teamId;
  match.updatedAt = new Date().toISOString();
  knockout.updatedAt = match.updatedAt;
  save(data);

  const state = getKnockoutState();
  const winnerName = awayWinner ? occ.b.name : occ.a.name;
  const byId = new Map(knockout.matches.map((m) => [m.id, m]));
  let promotion = null;
  if (match.nextMatchId) {
    const next = byId.get(match.nextMatchId);
    promotion = {
      nextMatchId: next.id,
      nextCode: `R${next.round}M${next.order}`,
      nextRoundName: roundName(next.round, knockout.matches.reduce((mx, m) => Math.max(mx, m.round), 0)),
      side: match.nextSide,
      sideText: match.nextSide === 'A' ? '左边' : '右边',
      teamName: winnerName,
    };
  }
  state.justRecorded = {
    matchId: match.id,
    code: `R${match.round}M${match.order}`,
    winnerTeamId: match.winnerTeamId,
    winnerName,
    decider,
    deciderText: decider === '常规' ? '常规时间' : (decider === '加时' ? '加时赛' : '点球大战'),
    promotion,
    champion: !match.nextMatchId ? { teamId: match.winnerTeamId, name: winnerName } : null,
    cleared,
  };
  return state;
}

// 从一边往回追到最初的种子位：收集这棵上游子树里的全部种子
function collectLeaves(side, byId, seedToTeam) {
  if (side.kind === 'seed') {
    const team = seedToTeam.get(side.seed);
    return [{ seed: side.seed, teamId: team ? team.id : null, teamName: team ? team.name : '', group: team ? (team.group || '') : '' }];
  }
  if (side.kind === 'bye') return [];
  const feeder = byId.get(side.matchId);
  if (!feeder) return [];
  return collectLeaves(feeder.sideA, byId, seedToTeam).concat(collectLeaves(feeder.sideB, byId, seedToTeam));
}

function sideDescriptor(side, byId) {
  if (side.kind === 'seed') return { kind: 'seed', seed: side.seed, label: `种子 ${side.seed}`, fromMatchCode: '' };
  if (side.kind === 'bye') return { kind: 'bye', seed: null, label: '轮空', fromMatchCode: '' };
  const feeder = byId.get(side.matchId);
  return {
    kind: 'match',
    seed: null,
    label: feeder ? `${feeder.round}轮${feeder.order}场胜者` : '上一场胜者',
    fromMatchId: side.matchId,
    fromMatchCode: feeder ? `R${feeder.round}M${feeder.order}` : '',
  };
}

function decorateMatch(match, knockout, data, totalRounds) {
  const teamsById = new Map(data.teams.map((t) => [t.id, t]));
  const seedToTeam = seedToTeamMap(data);
  const byId = new Map(knockout.matches.map((m) => [m.id, m]));
  const occ = resolveOccupants(match, knockout, data);

  let scoreText = '';
  if (match.status === '已赛') {
    scoreText = `${match.homeGoals} : ${match.awayGoals}`;
    if (match.decider === '加时') scoreText += `，加时 ${match.extraHomeGoals}:${match.extraAwayGoals}`;
    if (match.decider === '点球') scoreText += `，点球 ${match.penaltyHome}:${match.penaltyAway}`;
  }

  const next = match.nextMatchId ? byId.get(match.nextMatchId) : null;
  const winnerSide = match.status === '已赛' ? (match.awayWinner ? 'B' : 'A')
    : (match.status === '轮空' ? match.byeWinnerSide : '');

  return {
    id: match.id,
    code: `R${match.round}M${match.order}`,
    round: match.round,
    order: match.order,
    roundName: roundName(match.round, totalRounds),
    status: match.status,
    sideA: sideDescriptor(match.sideA, byId),
    sideB: sideDescriptor(match.sideB, byId),
    leavesA: collectLeaves(match.sideA, byId, seedToTeam),
    leavesB: collectLeaves(match.sideB, byId, seedToTeam),
    leftName: occ.a.name,
    rightName: occ.b.name,
    leftTeamId: occ.a.teamId,
    rightTeamId: occ.b.teamId,
    leftSeed: occ.a.seed,
    rightSeed: occ.b.seed,
    leftReady: occ.a.ready,
    rightReady: occ.b.ready,
    homeGoals: match.homeGoals,
    awayGoals: match.awayGoals,
    extraHomeGoals: match.extraHomeGoals,
    extraAwayGoals: match.extraAwayGoals,
    penaltyHome: match.penaltyHome,
    penaltyAway: match.penaltyAway,
    decider: match.decider || '',
    scoreText,
    winnerSide,
    winnerTeamId: match.winnerTeamId,
    winnerName: match.winnerTeamId ? ((teamsById.get(match.winnerTeamId) || {}).name || '') : '',
    note: match.note || '',
    nextMatchId: match.nextMatchId,
    nextCode: next ? `R${next.round}M${next.order}` : '',
    nextSide: match.nextSide || '',
    nextSideText: match.nextSide === 'A' ? '左边' : (match.nextSide === 'B' ? '右边' : ''),
    isFinal: !match.nextMatchId,
  };
}

function getKnockoutState() {
  const data = load();
  if (!data.knockout) return null;
  const knockout = data.knockout;
  const totalRounds = Math.max(...knockout.matches.map((m) => m.round));
  const rounds = [];
  for (let r = 1; r <= totalRounds; r += 1) {
    const list = knockout.matches
      .filter((m) => m.round === r)
      .sort((a, b) => a.order - b.order)
      .map((m) => decorateMatch(m, knockout, data, totalRounds));
    rounds.push({ round: r, name: roundName(r, totalRounds), matches: list });
  }

  const finalMatch = rounds[totalRounds - 1].matches[0];
  const champion = finalMatch.winnerTeamId
    ? { teamId: finalMatch.winnerTeamId, name: finalMatch.winnerName }
    : null;

  const teamsById = new Map(data.teams.map((t) => [t.id, t]));
  const entrants = knockout.teamIds.map((id) => {
    const team = teamsById.get(id);
    return team
      ? { teamId: id, name: team.name, shortName: team.shortName, seedRank: team.seedRank, group: team.group || '', city: team.city }
      : { teamId: id, name: '未知球队', shortName: '', seedRank: 0, group: '', city: '' };
  }).sort((a, b) => a.seedRank - b.seedRank);

  return {
    id: knockout.id,
    createdAt: knockout.createdAt,
    updatedAt: knockout.updatedAt,
    teamCount: entrants.length,
    entrants,
    totalRounds,
    rounds,
    violations: knockout.violations || [],
    champion,
    playedMatches: knockout.matches.filter((m) => m.status === '已赛').length,
    byeMatches: knockout.matches.filter((m) => m.status === '轮空').length,
    totalMatches: knockout.matches.length,
    season: data.meta.season,
  };
}

function deleteKnockout() {
  const data = load();
  if (!data.knockout) throw new ApiError(404, 'KNOCKOUT_NOT_FOUND', '当前没有淘汰赛签表', '');
  const played = data.knockout.matches.filter((m) => m.status === '已赛').length;
  data.knockout = null;
  save(data);
  return { cleared: true, playedMatchesRemoved: played };
}

module.exports = {
  generateKnockout,
  getKnockoutState,
  recordKnockoutResult,
  deleteKnockout,
};
