/* 规则引擎与 AI 自检：node selftest.js */
const XQ = require('./shared/rules.js');
const AI = require('./shared/ai.js');

let fail = 0;
function ok(cond, msg) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  if (!cond) fail++;
}

function perft(bd, side, depth) {
  if (depth === 0) return 1;
  const moves = XQ.genLegal(bd, side);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) {
    const cap = XQ.makeMove(bd, m[0], m[1]);
    n += perft(bd, 1 - side, depth - 1);
    XQ.unmakeMove(bd, m[0], m[1], cap);
  }
  return n;
}

console.log('\n[1] 走法生成（perft，初始局面）');
const bd = XQ.initialBoard();
const t0 = Date.now();
const p1 = perft(Int8Array.from(bd), XQ.RED, 1);
const p2 = perft(Int8Array.from(bd), XQ.RED, 2);
const p3 = perft(Int8Array.from(bd), XQ.RED, 3);
console.log(`  perft(1)=${p1}  perft(2)=${p2}  perft(3)=${p3}  用时 ${Date.now() - t0}ms`);
ok(p1 === 44, '初始局面红方合法着法 = 44');
ok(p2 === 1920, 'perft(2) = 1920');
ok(p3 === 79666, 'perft(3) = 79666');

console.log('\n[2] 特殊规则');
{
  // 兵过河前不可横走
  const b = new Int8Array(90);
  b[6 * 9 + 4] = XQ.P;             // 红兵 未过河
  b[0] = XQ.K + XQ.BO; b[9 * 9 + 4] = XQ.K;
  let m = XQ.genLegal(b, XQ.RED).filter(x => x[0] === 6 * 9 + 4);
  ok(m.length === 1 && m[0][1] === 5 * 9 + 4, '未过河兵只能直进一步');
  // 过河后可横走
  const b2 = new Int8Array(90);
  b2[4 * 9 + 4] = XQ.P;
  b2[0] = XQ.K + XQ.BO; b2[9 * 9 + 4] = XQ.K;
  m = XQ.genLegal(b2, XQ.RED).filter(x => x[0] === 4 * 9 + 4);
  ok(m.length === 3, '过河兵可直进与横走（3 种）');
}
{
  // 蹩马腿
  const b = new Int8Array(90);
  b[5 * 9 + 4] = XQ.N;
  b[4 * 9 + 4] = XQ.P + XQ.BO;     // 正前方有子
  b[0] = XQ.K + XQ.BO; b[9 * 9 + 4] = XQ.K;
  const m = XQ.genLegal(b, XQ.RED).filter(x => x[0] === 5 * 9 + 4);
  ok(m.every(x => x[1] !== 3 * 9 + 3 && x[1] !== 3 * 9 + 5), '马腿被蹩，无法跳向该两点');
}
{
  // 塞象眼
  const b = new Int8Array(90);
  b[9 * 9 + 2] = XQ.B;
  b[8 * 9 + 3] = XQ.P;             // 象眼
  b[0] = XQ.K + XQ.BO; b[9 * 9 + 4] = XQ.K;
  const m = XQ.genLegal(b, XQ.RED).filter(x => x[0] === 9 * 9 + 2);
  ok(m.every(x => x[1] !== 7 * 9 + 4), '象眼被塞，无法飞象');
}
{
  // 炮需隔子才能吃
  const b = new Int8Array(90);
  b[9 * 9 + 0] = XQ.C;
  b[7 * 9 + 0] = XQ.P;             // 炮架
  b[6 * 9 + 0] = XQ.N + XQ.BO;
  b[0] = XQ.K + XQ.BO; b[9 * 9 + 4] = XQ.K;
  const m = XQ.genLegal(b, XQ.RED).filter(x => x[0] === 9 * 9 + 0);
  ok(m.some(x => x[1] === 6 * 9 + 0), '炮可隔子吃马');
}
{
  // 白脸将：同列无阻挡视为非法
  const b = new Int8Array(90);
  b[0 * 9 + 4] = XQ.K + XQ.BO;
  b[9 * 9 + 4] = XQ.K;
  ok(XQ.inCheck(b, XQ.RED) && XQ.inCheck(b, XQ.BLACK), '双将同列对脸 → 双方均被判为受攻击');
  const b2 = Int8Array.from(b);
  b2[5 * 9 + 4] = XQ.P;
  ok(!XQ.inCheck(b2, XQ.RED), '中间有子则不构成白脸将');
}
{
  // 将死检测：黑将被红车封杀
  const b = new Int8Array(90);
  b[0 * 9 + 4] = XQ.K + XQ.BO;
  b[1 * 9 + 3] = XQ.R; b[1 * 9 + 5] = XQ.R;
  b[2 * 9 + 4] = XQ.R;
  b[9 * 9 + 4] = XQ.K;
  ok(XQ.inCheck(b, XQ.BLACK), '黑方被将军');
  ok(XQ.genLegal(b, XQ.BLACK).length === 0, '黑方无合法着法 → 将死');
}

console.log('\n[3] 中文记谱');
{
  const b = XQ.initialBoard();
  ok(XQ.notation(b, 7 * 9 + 7, 7 * 9 + 4) === '炮二平五', '炮二平五：' + XQ.notation(b, 7 * 9 + 7, 7 * 9 + 4));
  ok(XQ.notation(b, 9 * 9 + 7, 7 * 9 + 6) === '马二进三', '马二进三：' + XQ.notation(b, 9 * 9 + 7, 7 * 9 + 6));
  ok(XQ.notation(b, 6 * 9 + 0, 5 * 9 + 0) === '兵九进一', '兵九进一：' + XQ.notation(b, 6 * 9 + 0, 5 * 9 + 0));
}

console.log('\n[4] AI 引擎');
{
  const board = XQ.initialBoard();
  const t = Date.now();
  const res = AI.search(board, XQ.RED, { maxDepth: 4, timeMs: 3000 });
  const legal = XQ.genLegal(board, XQ.RED);
  console.log(`  着法 ${XQ.notation(board, res.move[0], res.move[1])}  深度 ${res.depth}  评分 ${res.score}  节点 ${res.nodes}  用时 ${res.time}ms`);
  ok(!!res.move, 'AI 返回了着法');
  ok(legal.some(m => m[0] === res.move[0] && m[1] === res.move[1]), 'AI 着法合法');
  ok(Date.now() - t < 6000, '未超出时间预算');
}
{
  // AI 自对弈 60 步，检查全程合法且能正常终局
  const board = XQ.initialBoard();
  let side = XQ.RED, bad = 0, plies = 0;
  while (plies < 60) {
    const r = AI.search(board, side, { maxDepth: 3, timeMs: 250 });
    if (!r.move) break;
    const legal = XQ.genLegal(board, side);
    if (!legal.some(m => m[0] === r.move[0] && m[1] === r.move[1])) { bad++; break; }
    XQ.makeMove(board, r.move[0], r.move[1]);
    side = 1 - side; plies++;
    if (XQ.genLegal(board, side).length === 0) break;
  }
  console.log(`  自对弈 ${plies} 手，无异常终止=${XQ.genLegal(board, side).length > 0}`);
  ok(bad === 0, 'AI 自对弈全程着法合法');
  ok(plies > 10, 'AI 能连续走子');
}

console.log('\n' + (fail === 0 ? '全部通过 ✅' : fail + ' 项失败 ❌') + '\n');
process.exit(fail === 0 ? 0 : 1);
