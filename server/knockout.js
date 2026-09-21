// 淘汰赛签表：按参赛球队与档位生成单败签表，登记比分后胜者自动落到下一场
const crypto = require('crypto');
const { load, save } = require('./store');
const { ApiError } = require('./errors');

const LOG_LIMIT = 50;

/* ---------- 签表生成 ---------- */

// 标准种子排位：让 1、2 号种子分守上下半区，高档位尽量晚相遇
function seedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const nextSize = order.length * 2;
    const next = [];
    order.forEach((seed) => { next.push(seed, nextSize + 1 - seed); });
    order = next;
  }
  return order;
}

function roundNameOf(bracketSize, round) {
  const teams = bracketSize / 2 ** (round - 1);
  if (teams <= 2) return '决赛';
  if (teams === 4) return '半决赛';
  if (teams === 8) return '1/4 决赛';
  if (teams === 16) return '1/8 决赛';
  return `第 ${round} 轮`;
}

// 同组回避：在首轮签位之间调换种子，尽量错开同组相遇；1、2 号种子固定不动
function fixGroupClashes(order, count, groupOf) {
  const adjustments = [];
  const size = order.length;
  const protectedSeeds = new Set([1, 2]);

  const clashPairs = () => {
    const bad = [];
    for (let i = 0; i < size; i += 2) {
      const a = order[i];
      const b = order[i + 1];
      if (a > count || b > count) continue;
      const ga = groupOf(a);
      const gb = groupOf(b);
      if (ga && gb && ga === gb) bad.push(i);
    }
    return bad;
  };

  let guard = 0;
  for (;;) {
    const bad = clashPairs();
    if (bad.length === 0 || guard >= size * size) break;
    guard += 1;
    const pairAt = bad[0];
    let best = null;
    [pairAt, pairAt + 1].forEach((pos) => {
      for (let to = 0; to < size; to += 1) {
        if (to === pairAt || to === pairAt + 1) continue;
        const seedA = order[pos];
        const seedB = order[to];
        if (seedA > count || seedB > count) continue;
        if (protectedSeeds.has(seedA) || protectedSeeds.has(seedB)) continue;
        const mate = to % 2 === 0 ? to + 1 : to - 1;
        if (order[mate] > count) continue; // 轮空位不换，轮空分布保持不变
        const before = bad.length;
        [order[pos], order[to]] = [order[to], order[pos]];
        const after = clashPairs().length;
        [order[pos], order[to]] = [order[to], order[pos]];
        if (after >= before) continue;
        const sameHalf = (pos < size / 2) === (to < size / 2);
        const score = [after, sameHalf ? 0 : 1, Math.abs(seedA - seedB)];
        const better = !best || score[0] < best.score[0]
          || (score[0] === best.score[0] && (score[1] < best.score[1]
            || (score[1] === best.score[1] && score[2] < best.score[2])));
        if (better) best = { pos, to, seedA, seedB, score };
      }
    });
    if (!best) break; // 换不动了，剩下的冲突写进未满足清单
    [order[best.pos], order[best.to]] = [order[best.to], order[best.pos]];
    adjustments.push(`为避开同组首轮相遇，种子${best.seedA} 与 种子${best.seedB} 互换了签位`);
  }
  return adjustments;
}

// 校验两条抽签规则，做不到的写清楚是哪一条、卡在哪一场
function checkRules(entries, matches) {
  const violations = [];
  const bySeed = new Map(entries.map((item) => [item.seed, item]));
  const matchById = new Map(matches.map((item) => [item.id, item]));

  // 规则一：1、2 号种子分守上下半区，决赛之前不碰面
  const final = matches.find((item) => !item.next);
  if (final && entries.length >= 2) {
    const seedsUnder = (source, seen) => {
      if (source.type === 'seed') return new Set([source.seed]);
      if (seen.has(source.matchId)) return new Set();
      seen.add(source.matchId);
      const match = matchById.get(source.matchId);
      if (!match) return new Set();
      const left = seedsUnder(match.homeSource, seen);
      const right = seedsUnder(match.awaySource, seen);
      return new Set([...left, ...right]);
    };
    const homeSeeds = seedsUnder(final.homeSource, new Set());
    const awaySeeds = seedsUnder(final.awaySource, new Set());
    if ((homeSeeds.has(1) && homeSeeds.has(2)) || (awaySeeds.has(1) && awaySeeds.has(2))) {
      violations.push({ rule: '高档位决赛前不碰面', detail: '种子1 与 种子2 落在同一半区，决赛之前就会相遇' });
    }
  }

  // 规则二：同组球队第一轮不相遇
  matches.filter((item) => item.round === 1).forEach((match) => {
    const home = bySeed.get(match.homeSource.seed);
    const away = bySeed.get(match.awaySource.seed);
    if (!home || !away) return;
    if (home.groupName && home.groupName === away.groupName) {
      violations.push({
        rule: '同组首轮不相遇',
        detail: `${match.code}（${match.roundName}第${match.index}场）：${home.name} 与 ${away.name} 同为「${home.groupName}」，可调换的签位已用完`,
      });
    }
  });

  return violations;
}

// 搭签表：首轮种子对位，轮空直接落位，逐轮向上直到决赛
function buildMatches(entries, now) {
  const count = entries.length;
  const bracketSize = 2 ** Math.ceil(Math.log2(count));
  const totalRounds = Math.log2(bracketSize);
  const bySeed = new Map(entries.map((item) => [item.seed, item]));
  const groupOf = (seed) => {
    const entry = bySeed.get(seed);
    return entry ? entry.groupName : '';
  };

  const order = seedOrder(bracketSize);
  const adjustments = fixGroupClashes(order, count, groupOf);

  const matches = [];
  const matchById = new Map();
  let codeCounter = 0;
  // 每个签位上的内容：真实种子或轮空（null）
  let outputs = order.map((seed) => (seed <= count ? { type: 'seed', seed } : null));

  for (let round = 1; round <= totalRounds; round += 1) {
    const roundName = roundNameOf(bracketSize, round);
    const nextOutputs = [];
    let index = 0;
    for (let i = 0; i < outputs.length; i += 2) {
      const home = outputs[i];
      const away = outputs[i + 1];
      if (home && away) {
        index += 1;
        codeCounter += 1;
        const match = {
          id: `ko-r${round}-m${index}`,
          code: `M${codeCounter}`,
          round,
          roundName,
          index,
          homeSource: home,
          awaySource: away,
          homeTeamId: home.type === 'seed' ? bySeed.get(home.seed).teamId : '',
          awayTeamId: away.type === 'seed' ? bySeed.get(away.seed).teamId : '',
          next: null,
          status: '待赛',
          homeGoals: null,
          awayGoals: null,
          extra: null,
          penalties: null,
          decidedBy: '',
          winnerTeamId: '',
          createdAt: now,
          updatedAt: now,
        };
        matches.push(match);
        matchById.set(match.id, match);
        if (home.type === 'match') matchById.get(home.matchId).next = { matchId: match.id, side: 'home' };
        if (away.type === 'match') matchById.get(away.matchId).next = { matchId: match.id, side: 'away' };
        nextOutputs.push({ type: 'match', matchId: match.id });
      } else {
        // 一边轮空：另一边直接落到下一轮对应位置
        nextOutputs.push(home || away);
      }
    }
    outputs = nextOutputs;
  }

  // 轮空说明：第二轮及以后仍直接占着种子位的，就是首轮轮空进来的
  const byeNotes = [];
  matches.forEach((match) => {
    ['home', 'away'].forEach((side) => {
      const source = match[`${side}Source`];
      if (source.type === 'seed' && match.round > 1) {
        const entry = bySeed.get(source.seed);
        byeNotes.push(`${entry.name}（种子${source.seed}）首轮轮空，直接进入 ${match.code}·${match.roundName}第${match.index}场 ${side === 'home' ? '主队' : '客队'}位`);
      }
    });
  });

  return { bracketSize, matches, adjustments, byeNotes };
}

function generateBracket() {
  const data = load();
  const pool = data.teams
    .filter((item) => item.status === '参赛')
    .sort((a, b) => (a.seedRank - b.seedRank) || (a.name < b.name ? -1 : 1));
  if (pool.length < 2) {
    throw new ApiError(409, 'NOT_ENOUGH_TEAMS', '参赛球队不足两支，先把球队状态调成参赛再生成签表', '');
  }
  const entries = pool.map((team, index) => ({
    seed: index + 1,
    teamId: team.id,
    name: team.name,
    shortName: team.shortName,
    seedRank: team.seedRank,
    groupName: team.groupName || '',
  }));
  const now = new Date().toISOString();
  const { bracketSize, matches, adjustments, byeNotes } = buildMatches(entries, now);
  const violations = checkRules(entries, matches);
  data.knockout = {
    id: `knockout-${crypto.randomUUID()}`,
    name: '淘汰赛签表',
    teamCount: entries.length,
    bracketSize,
    entries,
    matches,
    violations,
    adjustments,
    advancements: byeNotes.map((text, index) => ({
      id: `log-bye-${index + 1}`,
      type: 'bye',
      matchId: '',
      text,
      at: now,
    })),
    createdAt: now,
    updatedAt: now,
  };
  save(data);
  return decorate(data.knockout, data);
}

/* ---------- 展示 ---------- */

// 把签表整理成页面直接能画的样子：来源、去向、往回追到种子位的树都带上
function decorate(knockout, data) {
  const teamById = new Map(data.teams.map((item) => [item.id, item]));
  const entryBySeed = new Map(knockout.entries.map((item) => [item.seed, item]));
  const entryByTeam = new Map(knockout.entries.map((item) => [item.teamId, item]));
  const matchById = new Map(knockout.matches.map((item) => [item.id, item]));

  const liveName = (teamId) => {
    const team = teamById.get(teamId);
    if (team) return team.name;
    const entry = entryByTeam.get(teamId);
    return entry ? `${entry.name}（已离队）` : '未知球队';
  };

  // 从任意一边往回追到最开始的种子位
  const traceOf = (source, seen) => {
    if (source.type === 'seed') {
      const entry = entryBySeed.get(source.seed);
      return { label: `种子${source.seed} ${entry ? entry.name : ''}`.trim(), children: [] };
    }
    if (seen.has(source.matchId)) return { label: '（循环引用）', children: [] };
    seen.add(source.matchId);
    const match = matchById.get(source.matchId);
    if (!match) return { label: '未知场次', children: [] };
    return {
      label: `${match.code}·${match.roundName}第${match.index}场 胜者`,
      children: [traceOf(match.homeSource, seen), traceOf(match.awaySource, seen)],
    };
  };

  const sideView = (match, side) => {
    const source = match[`${side}Source`];
    const teamId = match[`${side}TeamId`];
    const entry = teamId ? entryByTeam.get(teamId) : null;
    let sourceText;
    if (source.type === 'seed') {
      sourceText = match.round > 1 ? `种子${source.seed}（轮空直入）` : `种子${source.seed}`;
    } else {
      const from = matchById.get(source.matchId);
      sourceText = from ? `${from.code} 胜者` : '未知场次胜者';
    }
    return {
      teamId,
      name: teamId ? liveName(teamId) : '',
      seedText: entry ? `种子${entry.seed}` : '',
      groupName: entry ? entry.groupName : '',
      pending: !teamId,
      sourceText,
      trace: traceOf(source, new Set()),
    };
  };

  const matches = knockout.matches.map((match) => {
    const next = match.next ? matchById.get(match.next.matchId) : null;
    let detailText = '';
    if (match.decidedBy === '加时' && match.extra) detailText = `加时 ${match.extra.home} : ${match.extra.away}`;
    if (match.decidedBy === '点球' && match.penalties) {
      detailText = `${match.extra ? `加时 ${match.extra.home} : ${match.extra.away} · ` : ''}点球 ${match.penalties.home} : ${match.penalties.away}`;
    }
    return {
      id: match.id,
      code: match.code,
      round: match.round,
      roundName: match.roundName,
      index: match.index,
      status: match.status,
      decidedBy: match.decidedBy,
      home: sideView(match, 'home'),
      away: sideView(match, 'away'),
      homeGoals: match.homeGoals,
      awayGoals: match.awayGoals,
      extra: match.extra,
      penalties: match.penalties,
      scoreText: match.status === '已赛' ? `${match.homeGoals} : ${match.awayGoals}` : '',
      detailText,
      winnerTeamId: match.winnerTeamId,
      winnerName: match.winnerTeamId ? liveName(match.winnerTeamId) : '',
      nextText: next
        ? `胜者进入 ${next.code}·${next.roundName}第${next.index}场（${match.next.side === 'home' ? '主队' : '客队'}位）`
        : '本场是决赛，胜者即冠军',
      canRecord: Boolean(match.homeTeamId && match.awayTeamId),
    };
  });

  const rounds = [];
  matches.forEach((match) => {
    let bucket = rounds.find((item) => item.round === match.round);
    if (!bucket) {
      bucket = { round: match.round, roundName: match.roundName, matches: [] };
      rounds.push(bucket);
    }
    bucket.matches.push(match);
  });
  rounds.sort((a, b) => a.round - b.round);

  const final = knockout.matches.find((item) => !item.next);
  const champion = final && final.winnerTeamId
    ? { teamId: final.winnerTeamId, name: liveName(final.winnerTeamId) }
    : null;

  return {
    name: knockout.name,
    teamCount: knockout.teamCount,
    bracketSize: knockout.bracketSize,
    entries: knockout.entries.map((item) => ({ ...item, currentName: liveName(item.teamId) })),
    rounds,
    violations: knockout.violations,
    adjustments: knockout.adjustments,
    log: knockout.advancements.slice().reverse(),
    champion,
    stats: {
      total: knockout.matches.length,
      played: knockout.matches.filter((item) => item.status === '已赛').length,
      pending: knockout.matches.filter((item) => item.status === '待赛').length,
    },
    updatedAt: knockout.updatedAt,
  };
}

function getBracket() {
  const data = load();
  return {
    season: data.meta.season,
    bracket: data.knockout ? decorate(data.knockout, data) : null,
  };
}

/* ---------- 登记比分与晋级 ---------- */

function recordKnockoutResult(id, payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const knockout = data.knockout;
  if (!knockout) throw new ApiError(404, 'KNOCKOUT_NOT_FOUND', '还没有生成淘汰赛签表', '');
  const match = knockout.matches.find((item) => item.id === id);
  if (!match) throw new ApiError(404, 'MATCH_NOT_FOUND', '这场淘汰赛不存在，或签表已经重新生成', '');
  if (!match.homeTeamId || !match.awayTeamId) {
    throw new ApiError(409, 'TEAMS_NOT_READY', '对阵双方还没定，等上一场打完再登记', '');
  }

  const given = (value) => value !== undefined && value !== null && value !== '';
  const readGoals = (value, field, label) => {
    if (!given(value)) throw new ApiError(400, 'GOALS_REQUIRED', `请填写${label}`, field);
    const goals = Number(value);
    if (!Number.isInteger(goals) || goals < 0 || goals > 99) {
      throw new ApiError(400, 'GOALS_INVALID', `${label}要填 0 到 99 之间的整数`, field);
    }
    return goals;
  };

  const homeGoals = readGoals(source.homeGoals, 'homeGoals', '主队常规时间进球');
  const awayGoals = readGoals(source.awayGoals, 'awayGoals', '客队常规时间进球');

  // 淘汰赛必须分出胜负：常规时间打平进加时，加时仍平进点球，点球不能打平
  let extra = null;
  let penalties = null;
  let decidedBy = '常规时间';
  if (homeGoals !== awayGoals) {
    if (given(source.extraHome) || given(source.extraAway) || given(source.penaltyHome) || given(source.penaltyAway)) {
      throw new ApiError(400, 'EXTRA_NOT_NEEDED', '常规时间已经分出胜负，加时与点球留空即可', 'extraHome');
    }
  } else {
    const extraHome = readGoals(source.extraHome, 'extraHome', '加时赛主队进球');
    const extraAway = readGoals(source.extraAway, 'extraAway', '加时赛客队进球');
    extra = { home: extraHome, away: extraAway };
    if (extraHome !== extraAway) {
      decidedBy = '加时';
      if (given(source.penaltyHome) || given(source.penaltyAway)) {
        throw new ApiError(400, 'PENALTIES_NOT_NEEDED', '加时已经分出胜负，点球留空即可', 'penaltyHome');
      }
    } else {
      const penaltyHome = readGoals(source.penaltyHome, 'penaltyHome', '主队点球');
      const penaltyAway = readGoals(source.penaltyAway, 'penaltyAway', '客队点球');
      if (penaltyHome === penaltyAway) {
        throw new ApiError(400, 'PENALTIES_TIED', '点球不能打平，必须分出胜负', 'penaltyAway');
      }
      penalties = { home: penaltyHome, away: penaltyAway };
      decidedBy = '点球';
    }
  }

  let winnerTeamId;
  if (decidedBy === '常规时间') winnerTeamId = homeGoals > awayGoals ? match.homeTeamId : match.awayTeamId;
  else if (decidedBy === '加时') winnerTeamId = extra.home > extra.away ? match.homeTeamId : match.awayTeamId;
  else winnerTeamId = penalties.home > penalties.away ? match.homeTeamId : match.awayTeamId;

  const now = new Date().toISOString();
  const matchById = new Map(knockout.matches.map((item) => [item.id, item]));
  const previousWinner = match.winnerTeamId;
  const resets = [];

  // 重登记换了胜者时，把下游已推进的结果一并收回，避免旧胜者留在签表里
  const resetDownstream = (item) => {
    if (item.status !== '已赛') return;
    resets.push(`${item.code}·${item.roundName}第${item.index}场`);
    item.status = '待赛';
    item.homeGoals = null;
    item.awayGoals = null;
    item.extra = null;
    item.penalties = null;
    item.decidedBy = '';
    item.winnerTeamId = '';
    item.updatedAt = now;
    knockout.advancements = knockout.advancements.filter((log) => log.matchId !== item.id);
    if (item.next) {
      const downstream = matchById.get(item.next.matchId);
      if (downstream) {
        downstream[`${item.next.side}TeamId`] = '';
        resetDownstream(downstream);
      }
    }
  };

  Object.assign(match, {
    status: '已赛', homeGoals, awayGoals, extra, penalties, decidedBy, winnerTeamId, updatedAt: now,
  });
  knockout.advancements = knockout.advancements.filter((log) => log.matchId !== match.id);

  let advancement;
  if (match.next) {
    const nextMatch = matchById.get(match.next.matchId);
    if (!nextMatch) throw new ApiError(500, 'BRACKET_BROKEN', '签表数据缺了下一场，请重新生成签表', '');
    const sideKey = `${match.next.side}TeamId`;
    const replacedTeamId = nextMatch[sideKey];
    if (previousWinner && previousWinner !== winnerTeamId) resetDownstream(nextMatch);
    nextMatch[sideKey] = winnerTeamId;
    nextMatch.updatedAt = now;
    advancement = {
      type: 'advance',
      nextCode: nextMatch.code,
      nextSide: match.next.side,
      replacedTeamId: replacedTeamId && replacedTeamId !== winnerTeamId ? replacedTeamId : '',
    };
  } else {
    advancement = { type: 'champion' };
  }

  const entryByTeam = new Map(knockout.entries.map((item) => [item.teamId, item]));
  const teamById = new Map(data.teams.map((item) => [item.id, item]));
  const nameOf = (teamId) => {
    const team = teamById.get(teamId);
    if (team) return team.name;
    const entry = entryByTeam.get(teamId);
    return entry ? entry.name : '未知球队';
  };
  const winnerName = nameOf(winnerTeamId);
  const loserTeamId = winnerTeamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId;
  const loserName = nameOf(loserTeamId);
  // 比分按胜者视角写，日志读起来不歧义
  const winnerIsHome = winnerTeamId === match.homeTeamId;
  const pick = (home, away) => (winnerIsHome ? [home, away] : [away, home]);
  const [wMain, lMain] = pick(homeGoals, awayGoals);
  let scoreText = `${wMain} : ${lMain}`;
  if (extra) {
    const [wExtra, lExtra] = pick(extra.home, extra.away);
    scoreText += `（加时 ${wExtra} : ${lExtra}）`;
  }
  if (penalties) {
    const [wPen, lPen] = pick(penalties.home, penalties.away);
    scoreText += `（点球 ${wPen} : ${lPen}）`;
  }
  const wayText = decidedBy === '常规时间' ? '' : `，${decidedBy}分出胜负`;

  let text;
  if (advancement.type === 'champion') {
    text = `${match.code} 决赛结束：${winnerName} ${scoreText} 胜 ${loserName}${wayText}，夺得冠军`;
  } else {
    const nextMatch = matchById.get(match.next.matchId);
    const sideText = match.next.side === 'home' ? '主队' : '客队';
    text = `${match.code} 结束：${winnerName} ${scoreText} 胜 ${loserName}${wayText}，进入 ${nextMatch.code}·${nextMatch.roundName}第${nextMatch.index}场 ${sideText}位`;
    if (advancement.replacedTeamId) text += `，换下 ${nameOf(advancement.replacedTeamId)}`;
  }
  if (resets.length) text += `；连带重置了 ${resets.join('、')}`;

  knockout.advancements.push({
    id: crypto.randomUUID(),
    type: advancement.type,
    matchId: match.id,
    text,
    at: now,
  });
  if (knockout.advancements.length > LOG_LIMIT) {
    knockout.advancements = knockout.advancements.slice(-LOG_LIMIT);
  }
  knockout.updatedAt = now;
  save(data);

  return {
    advancement: {
      type: advancement.type,
      text,
      winnerTeamId,
      winnerName,
      nextCode: advancement.nextCode || '',
      nextSide: advancement.nextSide || '',
      replacedName: advancement.replacedTeamId ? nameOf(advancement.replacedTeamId) : '',
    },
    resets,
  };
}

module.exports = { getBracket, generateBracket, recordKnockoutResult };
