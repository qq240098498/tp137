// 纯签表算法：不读数据文件，只管种子位布局、树结构与抽签约束搜索。
// 各规模标准单败模板互相嵌套：把 16 队模板相邻两场收成一个种子位，
// 正好得到 8 队模板（1/8、4/5、3/6、2/7），继续收得到 4 队、2 队。
// 靠后的种子位（超过实际队数）记 0，表示该位轮空、轮空留给最高档种子。
const TEMPLATES = {
  2: [[1, 2]],
  4: [[1, 4], [2, 3]],
  8: [[1, 8], [4, 5], [3, 6], [2, 7]],
  16: [
    [1, 16], [8, 9], [5, 12], [4, 13],
    [3, 14], [6, 11], [7, 10], [2, 15],
  ],
};

const ROUND_NAMES = ['首轮', '十六强战', '八强战', '半决赛', '决赛'];

function log2(n) {
  // 只对 2 的幂调用：幂次一定是整数，用 round 消掉浮点误差
  return Math.round(Math.log(n) / Math.log(2));
}

function bracketSize(n) {
  return 2 ** Math.ceil(Math.log(n) / Math.log(2));
}

// 首轮槽位对：队数不是 2 的幂时，不存在的种子位记 0（轮空）
function buildSlots(n) {
  const size = bracketSize(n);
  return TEMPLATES[size].map(([a, b]) => ({
    seedA: a >= 1 && a <= n ? a : 0,
    seedB: b >= 1 && b <= n ? b : 0,
  }));
}

// 给每一轮的每一场算出它由哪两场（或哪两个首轮槽位）喂进来、胜者又去哪一场的哪一边
function buildStructure(n) {
  const slotPairs = buildSlots(n);
  const firstRoundMatches = slotPairs.length;
  const totalRounds = log2(firstRoundMatches) + 1;
  const rows = [];

  for (let i = 0; i < firstRoundMatches; i += 1) rows.push({ round: 1, order: i + 1 });
  let count = firstRoundMatches;
  for (let r = 2; r <= totalRounds; r += 1) {
    count /= 2;
    for (let i = 0; i < count; i += 1) rows.push({ round: r, order: i + 1 });
  }

  const matches = rows.map((m) => ({ id: `ko-${m.round}-${m.order}`, round: m.round, order: m.order }));
  const idAt = (r, o) => `ko-${r}-${o}`;

  matches.forEach((m) => {
    if (m.round === 1) {
      const slot = slotPairs[m.order - 1];
      m.sideA = { kind: slot.seedA ? 'seed' : 'bye', seed: slot.seedA || null, matchId: null };
      m.sideB = { kind: slot.seedB ? 'seed' : 'bye', seed: slot.seedB || null, matchId: null };
    } else {
      m.sideA = { kind: 'match', seed: null, matchId: idAt(m.round - 1, m.order * 2 - 1) };
      m.sideB = { kind: 'match', matchId: idAt(m.round - 1, m.order * 2), seed: null };
    }
    if (m.round < totalRounds) {
      m.nextMatchId = idAt(m.round + 1, Math.ceil(m.order / 2));
      m.nextSide = m.order % 2 === 1 ? 'A' : 'B';
    } else {
      m.nextMatchId = null;
      m.nextSide = null;
    }
  });

  return { matches, totalRounds, firstRoundMatches };
}

function roundName(round, totalRounds) {
  if (round === totalRounds) return '决赛';
  if (round === totalRounds - 1) return '半决赛';
  if (round === totalRounds - 2) return '八强战';
  if (round === totalRounds - 3) return '十六强战';
  return ROUND_NAMES[round - 1] || `第 ${round} 轮`;
}

// 抽签搜索：在不破坏种子分区的前提下，尽量让同组球队首轮不相遇。
// 关键性质：满足分区约束时，首轮每一对必然一边是前 S/2 档种子、另一边是后 S/2 档
// （或轮空）。于是搜索拆成两层：
//   高种子 1..S/2 落到哪一对——DFS + 分区块约束剪枝（至多 8! 种，实际更少）；
//   低种子在剩余对阵间如何配对——对每个高种子摆法是一个最小冲突指派问题，
//   用匈牙利算法 O(n^3) 求最优，整段搜索在 16 队最坏情形下也是毫秒级。
// 轮空按惯例跟着最高档种子走。标准摆法最先试探，所以无冲突时签表与标准模板一致。
function hungarian(cost) {
  const n = cost.length;
  if (n === 0) return { assignment: [], total: 0 };
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);
  const way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j += 1) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j += 1) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  const assignment = new Array(n).fill(0);
  for (let j = 1; j <= n; j += 1) assignment[p[j] - 1] = j - 1;
  return { assignment, total: -v[0] };
}

function findGroupArrangement(n, groupOfSeed) {
  const size = bracketSize(n);
  const pairCount = size / 2;
  const template = TEMPLATES[size];
  // 标准模板里每一对的高位种子（≤pairCount）与低位种子（>pairCount，0 为轮空）
  const highBase = template.map(([a, b]) => (a <= pairCount ? a : b));
  const lowBase = template.map(([a, b]) => (a > pairCount ? a : b));
  const realLow = [];
  for (let s = pairCount + 1; s <= n; s += 1) realLow.push(s);
  const byeCount = pairCount - realLow.length;
  const groupOf = (seed) => (seed ? groupOfSeed.get(seed) || '' : '');

  // 枚举全部满足分区约束的高种子摆法，标准位置优先
  const highArrangements = [];
  const highAssign = new Array(pairCount).fill(0);
  function highOk(seed, pair) {
    for (let q = 2; q <= pairCount; q *= 2) {
      if (seed > q) continue;
      const blockSize = pairCount / q;
      const start = Math.floor(pair / blockSize) * blockSize;
      for (let p = start; p < start + blockSize; p += 1) {
        if (p !== pair && highAssign[p] >= 1 && highAssign[p] <= q) return false;
      }
    }
    return true;
  }
  function dfsHigh(seed) {
    if (seed > pairCount) { highArrangements.push(highAssign.slice()); return; }
    const standardPair = highBase.indexOf(seed);
    const order = [standardPair].concat(
      Array.from({ length: pairCount }, (_, i) => i).filter((i) => i !== standardPair),
    );
    for (const pair of order) {
      if (highAssign[pair] !== 0 || !highOk(seed, pair)) continue;
      highAssign[pair] = seed;
      dfsHigh(seed + 1);
      highAssign[pair] = 0;
    }
  }
  dfsHigh(1);

  let best = null;
  let bestClashes = Infinity;

  for (const high of highArrangements) {
    // 轮空固定跟着前 byeCount 档种子；其余对阵与真实低位种子做最小冲突指派
    const low = new Array(pairCount).fill(0);
    const openPairs = [];
    high.forEach((seed, pair) => {
      if (seed > byeCount) openPairs.push(pair);
    });
    const k = realLow.length;
    const cost = openPairs.map((pair) => realLow.map((seed) => (
      groupOf(high[pair]) && groupOf(high[pair]) === groupOf(seed) ? 1 : 0
    )));
    const { assignment, total } = hungarian(cost);
    assignment.forEach((col, row) => { low[openPairs[row]] = realLow[col]; });

    // 标准低位摆法若同为最少冲突，优先用它，保证无冲突时签表完全不走样
    const standardFeasible = high.every((seed, pair) => seed <= byeCount || (lowBase[pair] > pairCount && lowBase[pair] <= n));
    let standardClashes = Infinity;
    if (standardFeasible) {
      standardClashes = 0;
      high.forEach((seed, pair) => {
        if (seed > byeCount && lowBase[pair] && groupOf(seed) && groupOf(seed) === groupOf(lowBase[pair])) standardClashes += 1;
      });
    }
    if (standardFeasible && standardClashes <= total) {
      high.forEach((seed, pair) => { low[pair] = seed <= byeCount ? 0 : lowBase[pair]; });
    }

    if (total < bestClashes || (standardFeasible && standardClashes < bestClashes)) {
      bestClashes = Math.min(total, standardFeasible ? standardClashes : Infinity);
      best = { high: high.slice(), low: low.slice() };
    }
    if (bestClashes === 0) break;
  }

  if (!best) return { arrangement: null, clashes: [] };
  const arrangement = best.high.map((h, i) => [h, best.low[i]]);
  const clashes = [];
  arrangement.forEach(([a, b], i) => {
    if (b && groupOf(a) && groupOf(a) === groupOf(b)) {
      clashes.push({ pairOrder: i + 1, seedA: a, seedB: b, group: groupOf(a) });
    }
  });
  return { arrangement, clashes };
}

module.exports = {
  TEMPLATES,
  log2,
  bracketSize,
  buildSlots,
  buildStructure,
  roundName,
  findGroupArrangement,
};
