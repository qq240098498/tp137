const fs = require('fs');
const path = require('path');
const { buildStructure } = require('./bracket');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const TEMP_FILE = path.join(DATA_DIR, 'db.json.tmp');

const SEASON = '2026 春季联赛';
const MAX_TEAM_NAME = 24;
const MAX_SHORT_NAME = 4;
const MAX_VENUE_NAME = 30;
const MAX_NOTE = 200;
const MAX_GROUP = 4;
const MAX_TEAMS = 12;
const STATUS_POOL = ['待赛', '已赛', '延期', '取消'];

// 初始数据：八支球队、四个场地（其中两支球队共用中立体育场）、七轮单循环共二十八场，
// 前三轮已经打完并记了比分，第四轮有一场延期，其余待赛。
// 分组用于淘汰赛抽签的"同组首轮回避"：A 组（2、7 号种子）在标准摆法里首轮相遇，
// 靠同档分区内调位就能避开；C 组有五支队（1、3、5、6、8 号）而首轮只有四个对阵，
// 怎么调都至少撞一场——用来演示"做不到时写明是哪一条没满足"。
function seedData() {
  const at = '2026-02-20T02:00:00.000Z';
  const teams = [
    { id: 'team-1001', name: '江城铁马', shortName: 'JCTM', city: '江城', venueId: 'venue-2001', seedRank: 1, group: 'C', status: '参赛', note: '上赛季冠军', createdAt: at, updatedAt: at },
    { id: 'team-1002', name: '海陵海燕', shortName: 'HLHY', city: '海陵', venueId: 'venue-2002', seedRank: 2, group: 'A', status: '参赛', note: '', createdAt: at, updatedAt: at },
    { id: 'team-1003', name: '云岭苍狼', shortName: 'YLCW', city: '云岭', venueId: 'venue-2003', seedRank: 3, group: 'C', status: '参赛', note: '', createdAt: at, updatedAt: at },
    { id: 'team-1004', name: '平原飞驰', shortName: 'PYFC', city: '平原', venueId: 'venue-2004', seedRank: 4, group: 'B', status: '参赛', note: '', createdAt: at, updatedAt: at },
    { id: 'team-1005', name: '沙洲锚队', shortName: 'SZMD', city: '沙洲', venueId: 'venue-2004', seedRank: 5, group: 'C', status: '参赛', note: '与平原飞驰共用中立体育场', createdAt: at, updatedAt: at },
    { id: 'team-1006', name: '白鹿白鹭', shortName: 'BLBL', city: '白鹿', venueId: 'venue-2004', seedRank: 6, group: 'C', status: '参赛', note: '与平原飞驰共用中立体育场', createdAt: at, updatedAt: at },
    { id: 'team-1007', name: '青峰青松', shortName: 'QFQS', city: '青峰', venueId: 'venue-2005', seedRank: 7, group: 'A', status: '参赛', note: '', createdAt: at, updatedAt: at },
    { id: 'team-1008', name: '洛水洛神', shortName: 'LSLS', city: '洛水', venueId: 'venue-2006', seedRank: 8, group: 'C', status: '参赛', note: '', createdAt: at, updatedAt: at },
  ];

  const venues = [
    { id: 'venue-2001', name: '江城体育中心', city: '江城', capacity: 32000, weekdays: [6], note: '主场馆', createdAt: at, updatedAt: at },
    { id: 'venue-2002', name: '海陵湾球场', city: '海陵', capacity: 18000, weekdays: [6], note: '', createdAt: at, updatedAt: at },
    { id: 'venue-2003', name: '云岭高地', city: '云岭', capacity: 12000, weekdays: [6, 0], note: '', createdAt: at, updatedAt: at },
    { id: 'venue-2004', name: '中立体育场', city: '中立', capacity: 24000, weekdays: [6, 0], note: '平原、沙洲、白鹿三家共用', createdAt: at, updatedAt: at },
    { id: 'venue-2005', name: '青峰山球场', city: '青峰', capacity: 9000, weekdays: [0], note: '只有周日可用', createdAt: at, updatedAt: at },
    { id: 'venue-2006', name: '洛水古渡球场', city: '洛水', capacity: 8000, weekdays: [6], note: '', createdAt: at, updatedAt: at },
  ];

  // 单循环轮转表：八支球队七轮，每轮四场，主场按轮次左右交替
  const order = ['team-1001', 'team-1002', 'team-1003', 'team-1004', 'team-1005', 'team-1006', 'team-1007', 'team-1008'];
  const scores = {
    '整轮1场1': [2, 0], '整轮1场2': [1, 1], '整轮1场3': [3, 1], '整轮1场4': [0, 2],
    '整轮2场1': [1, 2], '整轮2场2': [2, 2], '整轮2场3': [0, 0], '整轮2场4': [4, 1],
    '整轮3场1': [2, 1], '整轮3场2': [1, 0], '整轮3场3': [1, 3], '整轮3场4': [2, 0],
  };

  const matches = [];
  const rounds = 7;
  let counter = 0;
  for (let round = 1; round <= rounds; round += 1) {
    const date = `2026-03-${String(7 + (round - 1) * 7).padStart(2, '0')}`;
    for (let i = 0; i < order.length / 2; i += 1) {
      const home = order[i];
      const away = order[order.length - 1 - i];
      counter += 1;
      const key = `整轮${round}场${i + 1}`;
      const played = Object.prototype.hasOwnProperty.call(scores, key);
      const isPostponed = round === 4 && i === 1;
      matches.push({
        id: `match-3001-${String(counter).padStart(2, '0')}`,
        round,
        date,
        kickoff: i % 2 === 0 ? '15:30' : '19:30',
        venueId: i === 3 ? 'venue-2004' : null,
        homeTeamId: i % 2 === 0 ? home : away,
        awayTeamId: i % 2 === 0 ? away : home,
        status: played ? '已赛' : (isPostponed ? '延期' : '待赛'),
        homeGoals: played ? scores[key][0] : null,
        awayGoals: played ? scores[key][1] : null,
        note: isPostponed ? '主队场地检修，日期待定' : '',
        createdAt: at,
        updatedAt: at,
      });
    }
    // 轮转：第一支不动，其余顺时针轮换
    const fixed = order[0];
    const rest = order.slice(1);
    rest.unshift(rest.pop());
    order.splice(0, order.length, fixed, ...rest);
  }

  // 初始淘汰赛：八队签表，前两场首轮已打完——一场点球决胜、一场加时决胜，
  // 胜者已经自动落到八强战对应位置；第四场（2 号对 7 号）还没打，
  // 它喂的那场八强战右边仍显示"首轮第 4 场胜者"
  const koAt = at;
  const koStructure = buildStructure(teams.length);
  const teamBySeed = new Map(teams.map((t) => [t.seedRank, t.id]));
  const koResults = {
    'ko-1-1': { status: '已赛', homeGoals: 2, awayGoals: 1, decider: '常规', awayWinner: false, winnerSeed: 1 },
    'ko-1-2': { status: '已赛', homeGoals: 1, awayGoals: 1, decider: '点球', penaltyHome: 4, penaltyAway: 3, awayWinner: false, winnerSeed: 4 },
    'ko-1-3': { status: '已赛', homeGoals: 2, awayGoals: 2, decider: '加时', extraHomeGoals: 1, extraAwayGoals: 0, awayWinner: false, winnerSeed: 3 },
    'ko-1-4': { status: '待赛' },
  };
  const knockout = {
    id: 'knockout-seed-01',
    createdAt: koAt,
    updatedAt: koAt,
    teamIds: teams.map((t) => t.id),
    matches: koStructure.matches.map((m) => {
      const result = koResults[m.id] || { status: '待赛' };
      return {
        ...m,
        sideA: { ...m.sideA },
        sideB: { ...m.sideB },
        status: result.status,
        homeGoals: result.homeGoals !== undefined ? result.homeGoals : null,
        awayGoals: result.awayGoals !== undefined ? result.awayGoals : null,
        extraHomeGoals: result.extraHomeGoals !== undefined ? result.extraHomeGoals : null,
        extraAwayGoals: result.extraAwayGoals !== undefined ? result.extraAwayGoals : null,
        penaltyHome: result.penaltyHome !== undefined ? result.penaltyHome : null,
        penaltyAway: result.penaltyAway !== undefined ? result.penaltyAway : null,
        decider: result.decider || '',
        awayWinner: result.awayWinner !== undefined ? result.awayWinner : null,
        winnerTeamId: result.winnerSeed ? teamBySeed.get(result.winnerSeed) : null,
        byeWinnerSide: null,
        note: '',
        createdAt: koAt,
        updatedAt: koAt,
      };
    }),
    // 标准摆法下首轮的同组相遇：A 组 2/7，C 组 1/8、3/6
    violations: [
      { rule: 'GROUP_SEPARATION', group: 'A', message: '「同组球队首轮不相遇」没满足：A 组在 首轮第 4 场（种子 2 对种子 7）同组相遇。' },
      { rule: 'GROUP_SEPARATION', group: 'C', message: '「同组球队首轮不相遇」没满足：C 组在 首轮第 1 场（种子 1 对种子 8）、首轮第 3 场（种子 3 对种子 6）同组相遇。该组球队数多于首轮能分摊的对阵数，在不破坏高种子分区的前提下怎么摆都避让不开。' },
    ],
  };

  return {
    meta: { season: SEASON, points: { win: 3, draw: 1, loss: 0 }, updatedAt: at },
    teams,
    venues,
    matches,
    knockout,
  };
}

// 球队、场地、赛程三块各自整理成固定结构，引用不存在的场地或球队的记录一律丢弃
function normalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const base = seedData();
  const meta = source.meta && typeof source.meta === 'object'
    ? {
      season: typeof source.meta.season === 'string' && source.meta.season ? source.meta.season : base.meta.season,
      points: {
        win: Number.isInteger(Number(source.meta.points && source.meta.points.win)) ? Number(source.meta.points.win) : base.meta.points.win,
        draw: Number.isInteger(Number(source.meta.points && source.meta.points.draw)) ? Number(source.meta.points.draw) : base.meta.points.draw,
        loss: Number.isInteger(Number(source.meta.points && source.meta.points.loss)) ? Number(source.meta.points.loss) : base.meta.points.loss,
      },
      updatedAt: typeof source.meta.updatedAt === 'string' ? source.meta.updatedAt : base.meta.updatedAt,
    }
    : base.meta;

  const venueSource = Array.isArray(source.venues) ? source.venues : base.venues;
  const venues = [];
  const venueIds = new Set();
  venueSource.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = typeof item.id === 'string' && item.id ? item.id : `venue-restored-${index + 1}`;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!id || !name || venueIds.has(id)) return;
    venueIds.add(id);
    venues.push({
      id,
      name,
      city: typeof item.city === 'string' ? item.city.trim() : '',
      capacity: Number.isInteger(Number(item.capacity)) ? Number(item.capacity) : 0,
      weekdays: Array.isArray(item.weekdays) ? item.weekdays.map(Number).filter((d) => d >= 0 && d <= 6) : [],
      note: typeof item.note === 'string' ? item.note : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
  });

  const teamSource = Array.isArray(source.teams) ? source.teams : base.teams;
  const teams = [];
  const teamIds = new Set();
  teamSource.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = typeof item.id === 'string' && item.id ? item.id : `team-restored-${index + 1}`;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const shortName = typeof item.shortName === 'string' ? item.shortName.trim() : '';
    if (!id || !name || !shortName || teamIds.has(id)) return;
    teamIds.add(id);
    teams.push({
      id,
      name,
      shortName,
      city: typeof item.city === 'string' ? item.city.trim() : '',
      venueId: venueIds.has(item.venueId) ? item.venueId : '',
      seedRank: Number.isInteger(Number(item.seedRank)) ? Number(item.seedRank) : index + 1,
      group: typeof item.group === 'string' ? item.group.trim().slice(0, MAX_GROUP) : '',
      status: ['参赛', '退赛'].includes(item.status) ? item.status : '参赛',
      note: typeof item.note === 'string' ? item.note : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
  });

  const matchSource = Array.isArray(source.matches) ? source.matches : base.matches;
  const matches = [];
  const matchIds = new Set();
  matchSource.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = typeof item.id === 'string' && item.id ? item.id : `match-restored-${index + 1}`;
    const home = teamIds.has(item.homeTeamId) ? item.homeTeamId : '';
    const away = teamIds.has(item.awayTeamId) ? item.awayTeamId : '';
    if (!id || !home || !away || home === away || matchIds.has(id)) return;
    matchIds.add(id);
    const status = ['待赛', '已赛', '延期', '取消'].includes(item.status) ? item.status : '待赛';
    matches.push({
      id,
      round: Number.isInteger(Number(item.round)) ? Number(item.round) : 1,
      date: typeof item.date === 'string' ? item.date : '',
      kickoff: typeof item.kickoff === 'string' ? item.kickoff : '',
      venueId: venueIds.has(item.venueId) ? item.venueId : '',
      homeTeamId: home,
      awayTeamId: away,
      status,
      homeGoals: status === '已赛' && item.homeGoals !== null && item.homeGoals !== undefined ? Number(item.homeGoals) : null,
      awayGoals: status === '已赛' && item.awayGoals !== null && item.awayGoals !== undefined ? Number(item.awayGoals) : null,
      note: typeof item.note === 'string' ? item.note : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
  });

  // 淘汰赛签表：场次结构必须和当前球队对得上，对不上就整张丢弃，避免溯源链断掉
  const knockout = normalizeKnockout(source.knockout === undefined ? base.knockout : source.knockout, teamIds);

  return { meta, teams, venues, matches, knockout };
}

function normalizeSide(side) {
  if (!side || typeof side !== 'object') return null;
  if (side.kind === 'seed') {
    const seed = Number(side.seed);
    if (!Number.isInteger(seed) || seed < 1) return null;
    return { kind: 'seed', seed, matchId: null };
  }
  if (side.kind === 'bye') return { kind: 'bye', seed: null, matchId: null };
  if (side.kind === 'match') {
    const matchId = typeof side.matchId === 'string' ? side.matchId : '';
    if (!matchId) return null;
    return { kind: 'match', seed: null, matchId };
  }
  return null;
}

function normalizeKnockout(raw, teamIds) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.matches) || raw.matches.length === 0) return null;
  const ids = new Set();
  const matches = [];
  let ok = true;
  raw.matches.forEach((item) => {
    if (!ok || !item || typeof item !== 'object') return;
    const id = typeof item.id === 'string' && item.id ? item.id : '';
    const round = Number(item.round);
    const order = Number(item.order);
    const sideA = normalizeSide(item.sideA);
    const sideB = normalizeSide(item.sideB);
    if (!id || ids.has(id) || !Number.isInteger(round) || round < 1
      || !Number.isInteger(order) || order < 1 || !sideA || !sideB) {
      ok = false;
      return;
    }
    ids.add(id);
    const status = ['待赛', '已赛', '轮空'].includes(item.status) ? item.status : '待赛';
    matches.push({
      id,
      round,
      order,
      sideA,
      sideB,
      nextMatchId: typeof item.nextMatchId === 'string' ? item.nextMatchId : null,
      nextSide: item.nextSide === 'A' || item.nextSide === 'B' ? item.nextSide : null,
      status,
      homeGoals: status === '已赛' && Number.isInteger(Number(item.homeGoals)) ? Number(item.homeGoals) : null,
      awayGoals: status === '已赛' && Number.isInteger(Number(item.awayGoals)) ? Number(item.awayGoals) : null,
      extraHomeGoals: status === '已赛' && Number.isInteger(Number(item.extraHomeGoals)) ? Number(item.extraHomeGoals) : null,
      extraAwayGoals: status === '已赛' && Number.isInteger(Number(item.extraAwayGoals)) ? Number(item.extraAwayGoals) : null,
      penaltyHome: status === '已赛' && Number.isInteger(Number(item.penaltyHome)) ? Number(item.penaltyHome) : null,
      penaltyAway: status === '已赛' && Number.isInteger(Number(item.penaltyAway)) ? Number(item.penaltyAway) : null,
      decider: ['常规', '加时', '点球'].includes(item.decider) ? item.decider : '',
      awayWinner: typeof item.awayWinner === 'boolean' ? item.awayWinner : null,
      winnerTeamId: teamIds.has(item.winnerTeamId) ? item.winnerTeamId : null,
      byeWinnerSide: item.byeWinnerSide === 'A' || item.byeWinnerSide === 'B' ? item.byeWinnerSide : null,
      note: typeof item.note === 'string' ? item.note : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
  });
  if (!ok) return null;

  // 溯源连线必须自洽：上一场指向的场次得存在，轮空场得恰好一边种子一边空
  const byId = new Map(matches.map((m) => [m.id, m]));
  const valid = matches.every((m) => {
    if (m.sideA.kind === 'match' && !byId.has(m.sideA.matchId)) return false;
    if (m.sideB.kind === 'match' && !byId.has(m.sideB.matchId)) return false;
    if (m.status === '轮空' && !(
      (m.sideA.kind === 'seed' && m.sideB.kind === 'bye' && m.byeWinnerSide === 'A')
      || (m.sideB.kind === 'seed' && m.sideA.kind === 'bye' && m.byeWinnerSide === 'B')
    )) return false;
    return true;
  });
  if (!valid) return null;

  const teamIdsInKo = Array.isArray(raw.teamIds) ? raw.teamIds.filter((id) => typeof id === 'string' && teamIds.has(id)) : [];
  const violations = Array.isArray(raw.violations)
    ? raw.violations.filter((v) => v && typeof v === 'object' && typeof v.message === 'string')
      .map((v) => ({ rule: typeof v.rule === 'string' ? v.rule : '', group: typeof v.group === 'string' ? v.group : '', message: v.message }))
    : [];

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : 'knockout-restored',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    teamIds: teamIdsInKo,
    matches,
    violations,
  };
}

// 读取数据文件：文件缺失或内容损坏时回落到初始数据并立刻补写
function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return normalize(JSON.parse(raw));
  } catch (err) {
    const data = seedData();
    save(data);
    return data;
  }
}

// 先写临时文件再改名，写入中途被打断也不会把正式数据文件写坏
function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const text = `${JSON.stringify(normalize(data), null, 2)}\n`;
  fs.writeFileSync(TEMP_FILE, text, 'utf8');
  fs.renameSync(TEMP_FILE, DATA_FILE);
}

module.exports = {
  load,
  save,
  seedData,
  normalize,
  SEASON,
  MAX_TEAM_NAME,
  MAX_SHORT_NAME,
  MAX_VENUE_NAME,
  MAX_NOTE,
  MAX_GROUP,
  MAX_TEAMS,
  MATCH_STATUS: ['待赛', '已赛', '延期', '取消'],
  TEAM_STATUS: ['参赛', '退赛'],
  DATA_FILE,
};
