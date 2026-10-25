/* 中国象棋规则引擎 —— 同时供 Node 服务端 / 浏览器 / Web Worker 使用
 * 棋盘：10 行 × 9 列，索引 idx = row * 9 + col
 * row 0 为黑方底线（上方），row 9 为红方底线（下方）
 * 棋子编码：红 1..7，黑 9..15（+8 偏移），0 表示空
 * 类型：K 将/帅  A 士/仕  B 象/相  N 马  R 车  C 炮  P 兵/卒
 */
;(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XQ = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var RED = 0, BLACK = 1;
  var K = 1, A = 2, B = 3, N = 4, R = 5, C = 6, P = 7, BO = 8;

  var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  var HORSE = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  var ELEPH = [[-2, -2], [-2, 2], [2, -2], [2, 2]];
  var ADVIS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  // 索引与棋子类型一致：1 将/帅 2 士/仕 3 象/相 4 马 5 车 6 炮 7 兵/卒
  var NAMES = [
    [null, '帅', '仕', '相', '马', '车', '炮', '兵'],  // 红
    [null, '将', '士', '象', '馬', '車', '砲', '卒']   // 黑
  ];

  function initialBoard() {
    var b = new Int8Array(90);
    var back = [R, N, B, A, K, A, B, N, R];
    var c;
    for (c = 0; c < 9; c++) { b[c] = back[c] + BO; b[81 + c] = back[c]; }
    b[2 * 9 + 1] = C + BO; b[2 * 9 + 7] = C + BO;
    b[7 * 9 + 1] = C; b[7 * 9 + 7] = C;
    for (c = 0; c < 9; c += 2) { b[3 * 9 + c] = P + BO; b[6 * 9 + c] = P; }
    return b;
  }

  function sideOf(p) { return p >= 9 ? BLACK : RED; }
  function typeOf(p) { return p & 7; }
  function inPalace(side, r, c) {
    if (c < 3 || c > 5) return false;
    return side === RED ? (r >= 7 && r <= 9) : (r >= 0 && r <= 2);
  }
  function ownHalf(side, r) { return side === RED ? r >= 5 : r <= 4; }

  /* 生成伪合法走法；capturesOnly 为真时只生成吃子着法（用于静态搜索） */
  function genPseudo(bd, side, capturesOnly) {
    var out = [];
    var i, nr, nc, nt, q, mr, mc, hr, hc, screen;
    for (var f = 0; f < 90; f++) {
      var p = bd[f];
      if (p === 0 || sideOf(p) !== side) continue;
      var r = (f / 9) | 0, c = f % 9;
      var t = p & 7;

      if (t === K || t === A) {
        var arr = t === K ? DIRS : ADVIS;
        for (i = 0; i < 4; i++) {
          nr = r + arr[i][0]; nc = c + arr[i][1];
          if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
          if (!inPalace(side, nr, nc)) continue;
          nt = nr * 9 + nc; q = bd[nt];
          if (q === 0) { if (!capturesOnly) out.push([f, nt, 0]); }
          else if (sideOf(q) !== side) out.push([f, nt, q]);
        }
      } else if (t === B) {
        for (i = 0; i < 4; i++) {
          nr = r + ELEPH[i][0]; nc = c + ELEPH[i][1];
          if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
          if (!ownHalf(side, nr)) continue;
          mr = r + ELEPH[i][0] / 2; mc = c + ELEPH[i][1] / 2;
          if (bd[mr * 9 + mc] !== 0) continue; // 塞象眼
          nt = nr * 9 + nc; q = bd[nt];
          if (q === 0) { if (!capturesOnly) out.push([f, nt, 0]); }
          else if (sideOf(q) !== side) out.push([f, nt, q]);
        }
      } else if (t === N) {
        for (i = 0; i < 8; i++) {
          nr = r + HORSE[i][0]; nc = c + HORSE[i][1];
          if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
          hr = Math.abs(HORSE[i][0]) === 2 ? r + HORSE[i][0] / 2 : r;
          hc = Math.abs(HORSE[i][1]) === 2 ? c + HORSE[i][1] / 2 : c;
          if (bd[hr * 9 + hc] !== 0) continue; // 蹩马腿
          nt = nr * 9 + nc; q = bd[nt];
          if (q === 0) { if (!capturesOnly) out.push([f, nt, 0]); }
          else if (sideOf(q) !== side) out.push([f, nt, q]);
        }
      } else if (t === R) {
        for (i = 0; i < 4; i++) {
          nr = r; nc = c;
          while (true) {
            nr += DIRS[i][0]; nc += DIRS[i][1];
            if (nr < 0 || nr > 9 || nc < 0 || nc > 8) break;
            nt = nr * 9 + nc; q = bd[nt];
            if (q === 0) { if (!capturesOnly) out.push([f, nt, 0]); continue; }
            if (sideOf(q) !== side) out.push([f, nt, q]);
            break;
          }
        }
      } else if (t === C) {
        for (i = 0; i < 4; i++) {
          nr = r; nc = c; screen = false;
          while (true) {
            nr += DIRS[i][0]; nc += DIRS[i][1];
            if (nr < 0 || nr > 9 || nc < 0 || nc > 8) break;
            nt = nr * 9 + nc; q = bd[nt];
            if (!screen) {
              if (q === 0) { if (!capturesOnly) out.push([f, nt, 0]); }
              else screen = true;
            } else {
              if (q !== 0) {
                if (sideOf(q) !== side) out.push([f, nt, q]);
                break;
              }
            }
          }
        }
      } else if (t === P) {
        var fwd = side === RED ? -1 : 1;
        nr = r + fwd;
        if (nr >= 0 && nr <= 9) {
          nt = nr * 9 + c; q = bd[nt];
          if (q === 0) { if (!capturesOnly) out.push([f, nt, 0]); }
          else if (sideOf(q) !== side) out.push([f, nt, q]);
        }
        var crossed = side === RED ? r <= 4 : r >= 5; // 已过河
        if (crossed) {
          for (i = -1; i <= 1; i += 2) {
            nc = c + i;
            if (nc < 0 || nc > 8) continue;
            nt = r * 9 + nc; q = bd[nt];
            if (q === 0) { if (!capturesOnly) out.push([f, nt, 0]); }
            else if (sideOf(q) !== side) out.push([f, nt, q]);
          }
        }
      }
    }
    return out;
  }

  function findKing(bd, side) {
    var kp = side === RED ? K : K + BO;
    for (var i = 0; i < 90; i++) if (bd[i] === kp) return i;
    return -1;
  }

  /* 是否被将军（含「白脸将」：双将同列且中间无子） */
  function inCheck(bd, side) {
    var ks = findKing(bd, side);
    if (ks < 0) return true;
    var kr = (ks / 9) | 0, kc = ks % 9;
    var opp = side === RED ? BLACK : RED;

    // 白脸将
    var oks = findKing(bd, opp);
    if (oks >= 0 && (oks % 9) === kc) {
      var lo = Math.min(kr, (oks / 9) | 0) + 1, hi = Math.max(kr, (oks / 9) | 0);
      var clear = true;
      for (var rr = lo; rr < hi; rr++) if (bd[rr * 9 + kc] !== 0) { clear = false; break; }
      if (clear) return true;
    }

    var i, dr, dc, r, c, q, first, second;
    // 车 / 炮 / 将的直线攻击
    for (i = 0; i < 4; i++) {
      dr = DIRS[i][0]; dc = DIRS[i][1];
      r = kr + dr; c = kc + dc; first = 0; second = 0;
      while (r >= 0 && r <= 9 && c >= 0 && c <= 8) {
        q = bd[r * 9 + c];
        if (q !== 0) { if (!first) first = q; else { second = q; break; } }
        r += dr; c += dc;
      }
      if (first && sideOf(first) === opp && (first & 7) === R) return true;
      if (second && sideOf(second) === opp && (second & 7) === C) return true;
    }

    // 马
    for (i = 0; i < 8; i++) {
      dr = HORSE[i][0]; dc = HORSE[i][1];
      r = kr + dr; c = kc + dc;
      if (r < 0 || r > 9 || c < 0 || c > 8) continue;
      q = bd[r * 9 + c];
      if (q === 0 || sideOf(q) !== opp || (q & 7) !== N) continue;
      var lr, lc;
      if (Math.abs(dr) === 2) { lr = kr + dr - (dr > 0 ? 1 : -1); lc = kc + dc; }
      else { lr = kr + dr; lc = kc + dc - (dc > 0 ? 1 : -1); }
      if (bd[lr * 9 + lc] === 0) return true;
    }

    // 兵 / 卒
    var pr, pc, pp;
    if (opp === RED) {
      pr = kr + 1; pc = kc;
      if (pr <= 9) { pp = bd[pr * 9 + pc]; if (pp === (P)) return true; }
      for (i = -1; i <= 1; i += 2) {
        pc = kc + i; if (pc < 0 || pc > 8) continue;
        pp = bd[kr * 9 + pc];
        if (pp === P && kr <= 4) return true; // 红兵过河后可横走
      }
    } else {
      pr = kr - 1; pc = kc;
      if (pr >= 0) { pp = bd[pr * 9 + pc]; if (pp === (P + BO)) return true; }
      for (i = -1; i <= 1; i += 2) {
        pc = kc + i; if (pc < 0 || pc > 8) continue;
        pp = bd[kr * 9 + pc];
        if (pp === (P + BO) && kr >= 5) return true; // 黑卒过河后可横走
      }
    }
    return false;
  }

  function genLegal(bd, side, capturesOnly) {
    var res = [], ps = genPseudo(bd, side, capturesOnly);
    for (var i = 0; i < ps.length; i++) {
      var m = ps[i], f = m[0], t = m[1], cap = m[2], pf = bd[f];
      bd[f] = 0; bd[t] = pf;
      if (!inCheck(bd, side)) res.push(m);
      bd[t] = cap; bd[f] = pf;
    }
    return res;
  }

  function makeMove(bd, f, t) { var cap = bd[t]; bd[t] = bd[f]; bd[f] = 0; return cap; }
  function unmakeMove(bd, f, t, cap) { bd[f] = bd[t]; bd[t] = cap; }

  function cloneBoard(bd) { return Int8Array.from(bd); }

  /* 中文记谱法，如「炮二平五」「马8进7」 */
  var CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  function pieceName(p) { return NAMES[sideOf(p)][p & 7]; }

  function notation(bd, f, t) {
    var p = bd[f];
    if (!p) return '';
    var side = sideOf(p), ty = p & 7;
    var name = NAMES[side][ty];
    var fr = (f / 9) | 0, fc = f % 9, tr = (t / 9) | 0, tc = t % 9;
    var fileOf = function (c) { return side === RED ? 9 - c : c + 1; };
    var num = function (n) { return side === RED ? CN[n] : String(n); };

    var act, val;
    if (tr === fr) { act = '平'; val = fileOf(tc); }
    else {
      var forward = side === RED ? tr < fr : tr > fr;
      act = forward ? '进' : '退';
      if (ty === R || ty === C || ty === P || ty === K) val = Math.abs(tr - fr);
      else val = fileOf(tc);
    }

    // 同一纵线有同类棋子时用「前 / 中 / 后」区分
    var same = [], i;
    for (i = 0; i < 90; i++) if (bd[i] === p) same.push(i);
    var sameFile = same.filter(function (s) { return s % 9 === fc; });
    if (sameFile.length >= 2) {
      sameFile.sort(function (a, b) {
        var ra = (a / 9) | 0, rb = (b / 9) | 0;
        return side === RED ? ra - rb : rb - ra; // 靠对方底线者为「前」
      });
      var pos = sameFile.indexOf(f);
      var tag = ['前', '中', '后'][pos] || String(pos + 1);
      return tag + name + act + num(val);
    }
    return name + num(fileOf(fc)) + act + num(val);
  }

  return {
    RED: RED, BLACK: BLACK,
    K: K, A: A, B: B, N: N, R: R, C: C, P: P, BO: BO,
    NAMES: NAMES,
    initialBoard: initialBoard,
    sideOf: sideOf,
    typeOf: typeOf,
    genPseudo: genPseudo,
    genLegal: genLegal,
    inCheck: inCheck,
    findKing: findKing,
    makeMove: makeMove,
    unmakeMove: unmakeMove,
    cloneBoard: cloneBoard,
    notation: notation,
    pieceName: pieceName
  };
});
