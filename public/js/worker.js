/* AI 计算线程：先查开局库，再进搜索 */
importScripts('/shared/rules.js', '/shared/opening.js', '/shared/ai.js');

var LEVELS = {
  1: { maxDepth: 2, timeMs: 350 },
  2: { maxDepth: 6, timeMs: 1400 },
  3: { maxDepth: 10, timeMs: 4000 },
  4: { maxDepth: 14, timeMs: 8000 }
};
var HINT = { maxDepth: 8, timeMs: 1800 };

self.onmessage = function (e) {
  var d = e.data || {};
  try {
    var board = Int8Array.from(d.board);

    // 提示功能不进开局库，直接算
    if (d.type !== 'hint' && d.useBook !== false) {
      var bm = self.XQBOOK.pick(board, d.side);
      if (bm) {
        self.postMessage({ id: d.id, move: [bm[0], bm[1], 0], book: true, score: 0, depth: 0, nodes: 0, time: 0 });
        return;
      }
    }

    var opts = d.type === 'hint' ? HINT : (LEVELS[d.level] || LEVELS[2]);
    var res = self.XQAI.search(board, d.side, opts);
    var move = res.move;

    // 初级难度偶尔走出随手棋，更像人类新手
    if (d.level === 1 && d.type !== 'hint' && Math.random() < 0.28) {
      var legal = self.XQ.genLegal(board, d.side);
      if (legal.length) move = legal[(Math.random() * legal.length) | 0];
    }

    self.postMessage({
      id: d.id,
      move: move,
      score: res.score,
      depth: res.depth,
      nodes: res.nodes,
      time: res.time
    });
  } catch (err) {
    self.postMessage({ id: d.id, move: null, error: String((err && err.message) || err) });
  }
};
