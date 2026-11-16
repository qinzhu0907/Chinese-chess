/* 极简开局库：让 AI 开局不呆板、秒出第一手。
 * 结构：局面指纹 -> 候选着法数组。所有着法在加载时用规则引擎校验，
 * 手写坐标一旦不合法，整条线路自动丢弃（宁可少走开局，也不能走错棋）。
 */
;(function (root, factory) {
  var XQ = (typeof module === 'object' && module.exports) ? require('./rules.js') : root.XQ;
  var api = factory(XQ);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XQBOOK = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (XQ) {
  'use strict';

  /* 每条线路是若干 [from, to] 坐标（idx = row * 9 + col，row0 为黑方底线） */
  var LINES = [
    // 中炮过河车 vs 屏风马
    [[70, 67], [7, 24], [88, 69], [8, 7], [89, 88], [33, 42]],
    // 中炮 vs 反宫马（黑炮平中）
    [[70, 67], [1, 20], [88, 69], [25, 22]],
    // 炮八平五（左中炮）
    [[64, 67], [7, 24], [82, 65], [1, 20]],
    // 仙人指路（兵七进一）
    [[56, 47], [33, 42], [82, 65], [1, 20]],
    // 中炮 + 左马，黑卒3进1
    [[70, 67], [7, 24], [82, 65], [29, 38]],
    // 飞相局
    [[87, 67], [7, 24], [88, 69], [8, 7]],
    // 起马局
    [[88, 69], [33, 42], [89, 88], [7, 24]]
  ];

  var BOOK = Object.create(null);
  var rejected = 0;

  function sameMove(m, mv) { return m[0] === mv[0] && m[1] === mv[1]; }

  function addCandidate(key, mv) {
    var list = BOOK[key] || (BOOK[key] = []);
    for (var i = 0; i < list.length; i++) if (sameMove(list[i], mv)) return;
    list.push([mv[0], mv[1]]);
  }

  function addLine(line) {
    var bd = XQ.initialBoard(), side = XQ.RED;
    // 先整体校验，避免线路中段非法时留下半条（注意要用副本，否则会把 bd 走掉）
    var probe = XQ.cloneBoard(bd), pSide = side;
    for (var i = 0; i < line.length; i++) {
      var legal = XQ.genLegal(probe, pSide);
      var ok = false;
      for (var j = 0; j < legal.length; j++) if (sameMove(legal[j], line[i])) { ok = true; break; }
      if (!ok) { rejected++; return; }
      XQ.makeMove(probe, line[i][0], line[i][1]);
      pSide = 1 - pSide;
    }
    for (var k = 0; k < line.length; k++) {
      addCandidate(XQ.boardKey(bd, side), line[k]);
      XQ.makeMove(bd, line[k][0], line[k][1]);
      side = 1 - side;
    }
  }

  LINES.forEach(addLine);

  var positions = Object.keys(BOOK).length;

  /**
   * 在开局库中挑一手
   * @returns {[number, number]|null}
   */
  function pick(bd, side) {
    var list = BOOK[XQ.boardKey(bd, side)];
    if (!list || !list.length) return null;
    var legal = XQ.genLegal(bd, side);
    var pool = [];
    for (var i = 0; i < list.length; i++) {
      for (var j = 0; j < legal.length; j++) {
        if (sameMove(legal[j], list[i])) { pool.push(list[i]); break; }
      }
    }
    if (!pool.length) return null;
    var m = pool[(Math.random() * pool.length) | 0];
    return [m[0], m[1]];
  }

  return {
    pick: pick,
    book: BOOK,
    positions: positions,
    rejected: rejected,
    size: positions
  };
});
