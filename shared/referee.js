/* 裁判：局面重放 + 胜负判定
 * 与 server.js 解耦，方便单独测试长将 / 三次重复 / 自然限着等规则。
 * 状态对象字段：history[{f,t,cap,not}] board turn posCount checks[2] noCapture
 */
;(function (root, factory) {
  var XQ = (typeof module === 'object' && module.exports) ? require('./rules.js') : root.XQ;
  var api = factory(XQ);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XQREF = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (XQ) {
  'use strict';

  var RED = XQ.RED;

  function newState() {
    var s = {
      history: [],
      board: XQ.initialBoard(),
      turn: RED,
      posCount: new Map(),
      checks: [0, 0],
      noCapture: 0
    };
    s.posCount.set(XQ.boardKey(s.board, RED), 1);
    return s;
  }

  /* 全量重放：由历史推导棋盘与全部衍生状态 */
  function replay(state) {
    var bd = XQ.initialBoard();
    state.turn = RED;
    state.noCapture = 0;
    state.checks = [0, 0];
    state.posCount = new Map();
    state.posCount.set(XQ.boardKey(bd, RED), 1);

    for (var i = 0; i < state.history.length; i++) {
      var m = state.history[i];
      var mover = state.turn;
      m.not = XQ.notation(bd, m.f, m.t);
      m.cap = XQ.makeMove(bd, m.f, m.t);
      state.noCapture = m.cap ? 0 : state.noCapture + 1;
      state.turn = 1 - state.turn;

      if (XQ.inCheck(bd, state.turn)) {
        state.checks[mover]++;
        state.checks[1 - mover] = 0;
      } else {
        state.checks[mover] = 0;
      }
      var key = XQ.boardKey(bd, state.turn);
      state.posCount.set(key, (state.posCount.get(key) || 0) + 1);
    }
    state.board = bd;
    return bd;
  }

  /* 判定结果，null 表示继续对局 */
  function judge(state) {
    var bd = state.board, stm = state.turn;

    if (XQ.genLegal(bd, stm).length === 0) {
      return { winner: 1 - stm, reason: XQ.inCheck(bd, stm) ? '将死' : '困毙' };
    }

    var lastMover = 1 - stm;
    var repeated = false;
    state.posCount.forEach(function (c) { if (c >= 3) repeated = true; });
    if (repeated) {
      // 连续将军 6 手以上且局面反复出现 → 长将判负
      if (state.checks[lastMover] >= 6) {
        return { winner: 1 - lastMover, reason: '长将判负' };
      }
      return { winner: -1, reason: '三次重复局面，判和' };
    }

    if (state.noCapture >= 120) return { winner: -1, reason: '60 回合无吃子，判和' };
    return null;
  }

  return { newState: newState, replay: replay, judge: judge };
});
