/* AI 计算线程 */
importScripts('/shared/rules.js', '/shared/ai.js');

var LEVELS = {
  1: { maxDepth: 2, timeMs: 400 },
  2: { maxDepth: 6, timeMs: 1600 },
  3: { maxDepth: 10, timeMs: 4200 }
};

self.onmessage = function (e) {
  var d = e.data || {};
  var opts = LEVELS[d.level] || LEVELS[2];
  try {
    var res = self.XQAI.search(d.board, d.side, opts);
    var move = res.move;
    // 初级难度偶尔走出随手棋，更像人类新手
    if (d.level === 1 && Math.random() < 0.3) {
      var legal = self.XQ.genLegal(Int8Array.from(d.board), d.side);
      if (legal.length) move = legal[(Math.random() * legal.length) | 0];
    }
    self.postMessage({ id: d.id, move: move, score: res.score, depth: res.depth, nodes: res.nodes });
  } catch (err) {
    self.postMessage({ id: d.id, move: null, error: String(err && err.message || err) });
  }
};
