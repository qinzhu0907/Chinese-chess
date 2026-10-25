/* 象棋 AI：Negamax + Alpha-Beta + 置换表 + 静态搜索 + 迭代加深 */
;(function (root) {
  var XQ = (typeof module === 'object' && module.exports) ? require('./rules.js') : root.XQ;
  var RED = XQ.RED, BLACK = XQ.BLACK;
  var K = XQ.K, A = XQ.A, B = XQ.B, N = XQ.N, R = XQ.R, C = XQ.C, P = XQ.P;

  var VAL = [0, 10000, 200, 200, 400, 900, 450, 100];
  var MATE = 30000;
  var INF = 1e9;
  var now = (typeof performance !== 'undefined' && performance.now)
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  /* ---- 位置价值表（红方视角，黑方旋转 180° 复用） ---- */
  function buildPST() {
    var t = [], i;
    for (i = 0; i < 8; i++) t[i] = new Int16Array(90);
    for (var r = 0; r < 10; r++) {
      for (var c = 0; c < 9; c++) {
        var s = r * 9 + c;
        // 兵：越靠前越值钱，过河大幅加分
        t[P][s] = (6 - r) * 8 + (r <= 4 ? 80 : 0) + (r <= 3 ? 50 : 0) + (r <= 2 ? 40 : 0)
          + (c === 4 ? 12 : (c === 3 || c === 5 ? 8 : (c === 2 || c === 6 ? 4 : 0)));
        // 马：忌边线，喜中心
        var hv = 0;
        if (r === 0 || r === 9 || c === 0 || c === 8) hv -= 40;
        if (r >= 2 && r <= 7 && c >= 2 && c <= 6) hv += 12;
        if (r >= 3 && r <= 6 && c >= 3 && c <= 5) hv += 16;
        t[N][s] = hv;
        // 炮：中路与过河
        t[C][s] = (c === 4 ? 22 : 0) + (c === 3 || c === 5 ? 8 : 0) + (r === 7 ? 6 : 0) + (r <= 4 ? 10 : 0);
        // 车：控线、压过河
        t[R][s] = (r <= 4 ? 14 : 0) + (c === 4 ? 6 : 0) + (r === 6 || r === 7 ? 6 : 0);
      }
    }
    return t;
  }
  var PST_RED = buildPST();
  var PST_BLACK = [];
  (function () {
    for (var i = 0; i < 8; i++) {
      PST_BLACK[i] = new Int16Array(90);
      for (var s = 0; s < 90; s++) {
        var r = (s / 9) | 0, c = s % 9;
        PST_BLACK[i][s] = PST_RED[i][(9 - r) * 9 + (8 - c)];
      }
    }
  })();

  function evaluate(bd) {
    var score = 0;
    for (var i = 0; i < 90; i++) {
      var p = bd[i];
      if (!p) continue;
      var side = XQ.sideOf(p), ty = p & 7;
      var v = VAL[ty] + (side === RED ? PST_RED[ty][i] : PST_BLACK[ty][i]);
      score += side === RED ? v : -v;
    }
    return score;
  }

  /* ---- Zobrist ---- */
  var zp = new Int32Array(16 * 90);
  var zSide = 0;
  (function () {
    var seed = 20240917 >>> 0;
    function rnd() {
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5; seed >>>= 0;
      return seed | 0;
    }
    for (var i = 0; i < zp.length; i++) zp[i] = rnd();
    zSide = rnd();
  })();

  function computeHash(bd, stm) {
    var h = 0;
    for (var i = 0; i < 90; i++) { var p = bd[i]; if (p) h ^= zp[p * 90 + i]; }
    if (stm === BLACK) h ^= zSide;
    return h | 0;
  }

  var nodes = 0, aborted = false, deadline = 0;
  var hash = 0, tt = null, path = null;

  function timeUp() {
    if ((++nodes & 1023) === 0 && now() > deadline) { aborted = true; return true; }
    return false;
  }

  function orderMoves(moves, ttMove) {
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i], s = 0;
      if (ttMove && m[0] === ttMove[0] && m[1] === ttMove[1]) s = 1e6;
      else if (m[2]) s = 10000 + VAL[m[2] & 7] * 8 - VAL[bdOf(m[0]) & 7];
      m[3] = s;
    }
    moves.sort(function (a, b) { return b[3] - a[3]; });
    return moves;
  }
  var curBoard = null;
  function bdOf(sq) { return curBoard[sq]; }

  function qsearch(stm, alpha, beta, ply) {
    if (timeUp()) return 0;
    var inChk = XQ.inCheck(curBoard, stm);
    var stand = stm === RED ? evaluate(curBoard) : -evaluate(curBoard);
    if (ply > 32) return stand;
    var moves = XQ.genLegal(curBoard, stm, !inChk);
    if (inChk && moves.length === 0) return -MATE + ply;
    if (!inChk) {
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
    }
    orderMoves(moves, null);
    var best = inChk ? -INF : stand;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i], f = m[0], t = m[1];
      var cap = curBoard[t], pf = curBoard[f];
      if (!inChk && cap && stand + VAL[cap & 7] + 250 < alpha) continue; // delta 剪枝
      var h = hash;
      hash = (hash ^ zp[pf * 90 + f] ^ zp[pf * 90 + t] ^ (cap ? zp[cap * 90 + t] : 0) ^ zSide) | 0;
      curBoard[f] = 0; curBoard[t] = pf;
      var score = -qsearch(1 - stm, -beta, -alpha, ply + 1);
      curBoard[f] = pf; curBoard[t] = cap;
      hash = h;
      if (aborted) return 0;
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return best;
  }

  function negamax(stm, depth, alpha, beta, ply) {
    if (timeUp()) return 0;
    if (ply > 0 && path.indexOf(hash) >= 0) return 0; // 重复局面判和

    var alpha0 = alpha, beta0 = beta;
    var ent = tt.get(hash), ttMove = null;
    if (ent) {
      if (ent.depth >= depth) {
        if (ent.flag === 0) return ent.score;
        if (ent.flag === 1 && ent.score > alpha) alpha = ent.score;
        else if (ent.flag === 2 && ent.score < beta) beta = ent.score;
        if (alpha >= beta) return ent.score;
      }
      ttMove = ent.move;
    }

    var inChk = XQ.inCheck(curBoard, stm);
    if (inChk) depth++; // 将军延伸
    if (depth <= 0) return qsearch(stm, alpha, beta, ply);

    var moves = XQ.genLegal(curBoard, stm);
    if (moves.length === 0) return -MATE + ply;
    orderMoves(moves, ttMove);

    var best = -INF, bestMove = moves[0];
    path.push(hash);
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i], f = m[0], t = m[1];
      var cap = curBoard[t], pf = curBoard[f];
      var h = hash;
      hash = (hash ^ zp[pf * 90 + f] ^ zp[pf * 90 + t] ^ (cap ? zp[cap * 90 + t] : 0) ^ zSide) | 0;
      curBoard[f] = 0; curBoard[t] = pf;
      var score = -negamax(1 - stm, depth - 1, -beta, -alpha, ply + 1);
      curBoard[f] = pf; curBoard[t] = cap;
      hash = h;
      if (aborted) { path.pop(); return 0; }
      if (score > best) { best = score; bestMove = m; }
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    path.pop();

    var flag = 0;
    if (best <= alpha0) flag = 2;
    else if (best >= beta0) flag = 1;
    tt.set(hash, { depth: depth, score: best, flag: flag, move: bestMove });
    return best;
  }

  /**
   * 搜索最佳着法
   * @param {Int8Array|Array} rootBoard 棋盘
   * @param {number} side 当前走棋方
   * @param {object} opts {maxDepth, timeMs}
   */
  function search(rootBoard, side, opts) {
    opts = opts || {};
    var maxDepth = opts.maxDepth || 6;
    var timeMs = opts.timeMs || 3000;

    curBoard = Int8Array.from(rootBoard);
    nodes = 0; aborted = false;
    deadline = now() + timeMs;
    tt = new Map();
    path = [];
    hash = computeHash(curBoard, side);

    var rootMoves = XQ.genLegal(curBoard, side);
    if (!rootMoves.length) return { move: null, score: -MATE, depth: 0, nodes: 0, time: 0 };
    if (rootMoves.length === 1) return { move: rootMoves[0], score: 0, depth: 1, nodes: 1, time: 0 };

    var start = now();
    var bestMove = rootMoves[0], bestScore = 0, reached = 0;
    var lastScores = {};

    for (var d = 1; d <= maxDepth; d++) {
      // 上一轮最佳着法优先
      rootMoves.sort(function (a, b) {
        return (lastScores[b[0] + '-' + b[1]] || -INF) - (lastScores[a[0] + '-' + a[1]] || -INF);
      });
      var alpha = -INF, localBest = null, localScore = -INF;
      for (var i = 0; i < rootMoves.length; i++) {
        var m = rootMoves[i], f = m[0], t = m[1];
        var cap = curBoard[t], pf = curBoard[f];
        var h = hash;
        hash = (hash ^ zp[pf * 90 + f] ^ zp[pf * 90 + t] ^ (cap ? zp[cap * 90 + t] : 0) ^ zSide) | 0;
        curBoard[f] = 0; curBoard[t] = pf;
        var sc = -negamax(1 - side, d - 1, -INF, -alpha, 1);
        curBoard[f] = pf; curBoard[t] = cap;
        hash = h;
        if (aborted) break;
        lastScores[f + '-' + t] = sc;
        if (sc > localScore) { localScore = sc; localBest = m; if (sc > alpha) alpha = sc; }
      }
      if (aborted) break;
      if (localBest) { bestMove = localBest; bestScore = localScore; reached = d; }
      if (Math.abs(bestScore) > MATE - 200) break;
      if (now() > deadline) break;
    }

    return {
      move: [bestMove[0], bestMove[1], bestMove[2]],
      score: bestScore,
      depth: reached,
      nodes: nodes,
      time: Math.round(now() - start)
    };
  }

  var api = { search: search, evaluate: evaluate, VAL: VAL, MATE: MATE };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XQAI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
