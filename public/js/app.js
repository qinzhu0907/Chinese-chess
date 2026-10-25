/* 中国象棋前端：棋盘渲染 + 人机/联机对局 */
(function () {
  'use strict';

  var XQ = window.XQ;
  var RED = XQ.RED, BLACK = XQ.BLACK;

  var CELL = 62, M = 38, PR = 27;
  var BW = M * 2 + CELL * 8;
  var BH = M * 2 + CELL * 9;

  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');

  function $(id) { return document.getElementById(id); }
  function fmt(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ---------------- 状态 ---------------- */
  var S = {
    screen: 'home',
    mode: 'ai',            // ai | online
    board: XQ.initialBoard(),
    turn: RED,
    mySide: RED,
    aiSide: BLACK,
    level: 2,
    flip: false,
    selected: null,
    targets: [],
    lastMove: null,
    hint: null,
    history: [],
    status: 'idle',        // idle | waiting | playing | ended
    clock: [0, 0],
    noCapture: 0,
    thinking: false,
    name: '棋友',
    roomCode: '',
    names: ['红方', '黑方']
  };

  var screens = {
    home: $('screen-home'), ai: $('screen-ai'), online: $('screen-online'), game: $('screen-game')
  };
  function setScreen(name) {
    S.screen = name;
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle('hidden', k !== name);
    });
    $('btnHome').classList.toggle('hidden', name === 'home');
  }

  /* ---------------- 棋盘绘制 ---------------- */
  function setupCanvas() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(BW * dpr);
    canvas.height = Math.round(BH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  var STARS = [
    [2, 1], [2, 7], [7, 1], [7, 7],
    [3, 0], [3, 2], [3, 4], [3, 6], [3, 8],
    [6, 0], [6, 2], [6, 4], [6, 6], [6, 8]
  ];

  function disp(r, c) {
    return S.flip ? [9 - r, 8 - c] : [r, c];
  }
  function px(c) { return M + c * CELL; }
  function py(r) { return M + r * CELL; }

  function drawStars() {
    ctx.strokeStyle = '#8b5a2b';
    ctx.lineWidth = 1.4;
    for (var i = 0; i < STARS.length; i++) {
      var d = disp(STARS[i][0], STARS[i][1]);
      var x = px(d[1]), y = py(d[0]);
      var g = 4, l = 11;
      var sides = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      // 边线上的点只画两个方向的拐角
      if (d[1] === 0) sides = sides.filter(function (s) { return s[0] > 0; });
      if (d[1] === 8) sides = sides.filter(function (s) { return s[0] < 0; });
      for (var j = 0; j < sides.length; j++) {
        var sx = x + sides[j][0] * g, sy = y + sides[j][1] * g;
        ctx.beginPath();
        ctx.moveTo(sx, sy + sides[j][1] * l);
        ctx.lineTo(sx, sy);
        ctx.lineTo(sx + sides[j][0] * l, sy);
        ctx.stroke();
      }
    }
  }

  function drawPiece(x, y, p, opts) {
    opts = opts || {};
    var side = XQ.sideOf(p);
    var g = ctx.createRadialGradient(x - 6, y - 8, 4, x, y, PR);
    g.addColorStop(0, '#fffaf0');
    g.addColorStop(1, '#f2dfb4');
    ctx.beginPath();
    ctx.arc(x, y, PR, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = side === RED ? '#b0392b' : '#2b2926';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, PR - 4, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = side === RED ? 'rgba(176,57,43,.45)' : 'rgba(43,41,38,.45)';
    ctx.stroke();

    ctx.fillStyle = side === RED ? '#b0392b' : '#26241f';
    ctx.font = '700 ' + (PR + 3) + 'px "KaiTi","STKaiti","楷体","Songti SC",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(XQ.NAMES[side][p & 7], x, y + 1);

    if (opts.selected) {
      ctx.beginPath(); ctx.arc(x, y, PR + 5, 0, Math.PI * 2);
      ctx.lineWidth = 3; ctx.strokeStyle = '#1f9d55'; ctx.stroke();
    }
    if (opts.check) {
      ctx.beginPath(); ctx.arc(x, y, PR + 7, 0, Math.PI * 2);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(192,57,43,.85)'; ctx.stroke();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, BW, BH);
    var g = ctx.createLinearGradient(0, 0, BW, BH);
    g.addColorStop(0, '#fbeecc');
    g.addColorStop(1, '#f2d69a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, BW, BH);

    // 网格
    ctx.strokeStyle = '#7a4b21';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (var r = 0; r < 10; r++) {
      ctx.moveTo(M, py(r)); ctx.lineTo(M + 8 * CELL, py(r));
    }
    for (var c = 0; c < 9; c++) {
      var x = px(c);
      if (c === 0 || c === 8) { ctx.moveTo(x, py(0)); ctx.lineTo(x, py(9)); }
      else {
        ctx.moveTo(x, py(0)); ctx.lineTo(x, py(4));
        ctx.moveTo(x, py(5)); ctx.lineTo(x, py(9));
      }
    }
    ctx.stroke();

    ctx.lineWidth = 2.6;
    ctx.strokeRect(M, M, 8 * CELL, 9 * CELL);

    // 九宫
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    var pr, pc;
    for (var k = 0; k < 2; k++) {
      var rr = k === 0 ? 0 : 7;
      pr = rr; pc = 3;
      var a1 = disp(rr, 3), a2 = disp(rr + 2, 5), b1 = disp(rr, 5), b2 = disp(rr + 2, 3);
      ctx.moveTo(px(a1[1]), py(a1[0])); ctx.lineTo(px(a2[1]), py(a2[0]));
      ctx.moveTo(px(b1[1]), py(b1[0])); ctx.lineTo(px(b2[1]), py(b2[0]));
    }
    ctx.stroke();

    // 楚河汉界
    ctx.save();
    ctx.fillStyle = 'rgba(122,75,33,.72)';
    ctx.font = '600 28px "KaiTi","STKaiti","楷体",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var ry = M + 4.5 * CELL;
    var t1 = '楚 河', t2 = '汉 界';
    if (S.flip) { var tmp = t1; t1 = t2; t2 = tmp; }
    ctx.fillText(t1, px(2), ry);
    ctx.fillText(t2, px(6), ry);
    ctx.restore();

    drawStars();

    // 上一步痕迹
    if (S.lastMove) {
      var d1 = disp((S.lastMove[0] / 9) | 0, S.lastMove[0] % 9);
      var d2 = disp((S.lastMove[1] / 9) | 0, S.lastMove[1] % 9);
      ctx.fillStyle = 'rgba(31,157,85,.22)';
      ctx.beginPath(); ctx.arc(px(d1[1]), py(d1[0]), PR + 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(31,157,85,.34)';
      ctx.beginPath(); ctx.arc(px(d2[1]), py(d2[0]), PR + 3, 0, Math.PI * 2); ctx.fill();
    }

    // 提示着法
    if (S.hint) {
      var h1 = disp((S.hint[0] / 9) | 0, S.hint[0] % 9);
      var h2 = disp((S.hint[1] / 9) | 0, S.hint[1] % 9);
      ctx.strokeStyle = 'rgba(58,120,220,.9)';
      ctx.lineWidth = 3;
      [h1, h2].forEach(function (d) {
        ctx.beginPath(); ctx.arc(px(d[1]), py(d[0]), PR + 4, 0, Math.PI * 2); ctx.stroke();
      });
    }

    // 可走点位
    for (var i = 0; i < S.targets.length; i++) {
      var t = S.targets[i];
      var dt = disp((t / 9) | 0, t % 9);
      var x2 = px(dt[1]), y2 = py(dt[0]);
      if (S.board[t] === 0) {
        ctx.fillStyle = 'rgba(31,157,85,.55)';
        ctx.beginPath(); ctx.arc(x2, y2, 9, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(31,157,85,.85)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x2, y2, PR + 3, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // 棋子
    var checkedKing = -1;
    if (S.status === 'playing' && XQ.inCheck(S.board, S.turn)) checkedKing = XQ.findKing(S.board, S.turn);
    for (var s = 0; s < 90; s++) {
      var p = S.board[s];
      if (!p) continue;
      var dd = disp((s / 9) | 0, s % 9);
      drawPiece(px(dd[1]), py(dd[0]), p, {
        selected: S.selected === s,
        check: s === checkedKing
      });
    }
  }

  /* ---------------- 交互 ---------------- */
  function eventToSquare(e) {
    var rect = canvas.getBoundingClientRect();
    var cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    var cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    var x = cx * (BW / rect.width);
    var y = cy * (BH / rect.height);
    var c = Math.round((x - M) / CELL);
    var r = Math.round((y - M) / CELL);
    if (c < 0 || c > 8 || r < 0 || r > 9) return -1;
    if (Math.abs(x - px(c)) > CELL * 0.46 || Math.abs(y - py(r)) > CELL * 0.46) return -1;
    var d = disp(r, c);
    return d[0] * 9 + d[1];
  }

  function myTurn() {
    return S.status === 'playing' && S.turn === S.mySide && !S.thinking;
  }

  function onTap(e) {
    if (!myTurn()) return;
    var sq = eventToSquare(e);
    if (sq < 0) { S.selected = null; S.targets = []; draw(); return; }
    var p = S.board[sq];

    if (S.selected !== null && S.targets.indexOf(sq) >= 0) {
      var from = S.selected;
      S.selected = null; S.targets = []; S.hint = null;
      if (S.mode === 'ai') { applyMove(from, sq); }
      else { socket.emit('move', { f: from, t: sq }); }
      return;
    }
    if (p && XQ.sideOf(p) === S.mySide) {
      S.selected = sq;
      S.targets = XQ.genLegal(S.board, S.turn).filter(function (m) { return m[0] === sq; })
        .map(function (m) { return m[1]; });
      S.hint = null;
      draw();
    } else {
      S.selected = null; S.targets = []; draw();
    }
  }
  var lastTouch = 0;
  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    lastTouch = Date.now();
    onTap(e);
  }, { passive: false });
  canvas.addEventListener('click', function (e) {
    if (Date.now() - lastTouch < 800) return; // 避免触屏设备上重复触发
    onTap(e);
  });

  /* ---------------- 走子 ---------------- */
  function rebuildFromHistory() {
    var bd = XQ.initialBoard();
    for (var i = 0; i < S.history.length; i++) XQ.makeMove(bd, S.history[i].f, S.history[i].t);
    S.board = bd;
    S.turn = S.history.length % 2 === 0 ? RED : BLACK;
    S.noCapture = 0;
    for (var j = S.history.length - 1; j >= 0; j--) {
      if (S.history[j].cap) break;
      S.noCapture++;
    }
    S.lastMove = S.history.length ? [S.history[S.history.length - 1].f, S.history[S.history.length - 1].t] : null;
  }

  function applyMove(f, t) {
    var p = S.board[f];
    if (!p) return;
    var cap = S.board[t];
    var mover = S.turn;
    var not = XQ.notation(S.board, f, t);
    XQ.makeMove(S.board, f, t);
    S.history.push({ f: f, t: t, cap: cap, side: mover, not: not });
    S.noCapture = cap ? 0 : S.noCapture + 1;
    S.lastMove = [f, t];
    S.turn = 1 - S.turn;
    S.selected = null; S.targets = []; S.hint = null;
    renderMoves();
    draw();
    afterMove();
  }

  function afterMove() {
    updateTurnUI();
    if (S.mode === 'online') return; // 联机由服务端裁定
    var chk = XQ.inCheck(S.board, S.turn);
    if (XQ.genLegal(S.board, S.turn).length === 0) {
      finishGame({ winner: 1 - S.turn, reason: chk ? '将死' : '困毙' });
      return;
    }
    if (S.noCapture >= 120) { finishGame({ winner: -1, reason: '60 回合无吃子，判和' }); return; }
    if (chk) setMsg('将军！', 'check'); else setMsg('', '');
    maybeAiMove();
  }

  function updateTurnUI() {
    var chip = $('turnChip');
    var redName = S.mode === 'online' ? S.names[0] : (S.mySide === RED ? '你（红）' : 'AI（红）');
    var blkName = S.mode === 'online' ? S.names[1] : (S.mySide === BLACK ? '你（黑）' : 'AI（黑）');
    if (S.status !== 'playing') { chip.textContent = '准备开始'; chip.className = 'turn-chip'; }
    else {
      chip.textContent = (S.turn === RED ? '红方走棋 · ' + redName : '黑方走棋 · ' + blkName) + (S.thinking ? '（思考中…）' : '');
      chip.className = 'turn-chip ' + (S.turn === RED ? 'red' : 'black');
    }
    $('pRed').classList.toggle('active', S.status === 'playing' && S.turn === RED);
    $('pBlack').classList.toggle('active', S.status === 'playing' && S.turn === BLACK);
    $('clockRed').parentNode.classList.toggle('active', S.status === 'playing' && S.turn === RED);
    $('clockBlack').parentNode.classList.toggle('active', S.status === 'playing' && S.turn === BLACK);
    $('btnUndo').disabled = !(S.status === 'playing' && S.history.length > 0 && !S.thinking);
    $('btnHint').disabled = !myTurn();
    $('btnDraw').disabled = !(S.status === 'playing');
    $('btnResign').disabled = !(S.status === 'playing');
  }

  function finishGame(result) {
    S.status = 'ended';
    S.thinking = false;
    S.selected = null; S.targets = []; S.hint = null;
    draw();
    var title, sub;
    if (result.winner === -1) { title = '和棋'; sub = result.reason || '双方议和'; }
    else {
      var iWon = S.mode === 'online' ? result.winner === S.mySide : result.winner === S.mySide;
      title = iWon ? '你赢了！' : '你输了';
      sub = (result.winner === RED ? '红方' : '黑方') + '胜 · ' + (result.reason || '');
      if (S.mode === 'online') {
        sub = (result.winner === RED ? S.names[0] : S.names[1]) + ' 胜 · ' + (result.reason || '');
      }
    }
    $('bannerTitle').textContent = title;
    $('bannerSub').textContent = sub;
    $('banner').classList.remove('hidden');
    updateTurnUI();
    $('turnChip').textContent = '对局结束';
    $('turnChip').className = 'turn-chip';
    setMsg(sub, 'ok');
  }

  function setMsg(text, kind) {
    var el = $('gameMsg');
    el.textContent = text || '';
    el.className = 'msg' + (kind ? ' ' + kind : '');
  }

  function renderMoves() {
    var box = $('moveList');
    box.innerHTML = '';
    for (var i = 0; i < S.history.length; i += 2) {
      var row = document.createElement('div');
      row.className = 'row';
      var no = document.createElement('span'); no.className = 'no'; no.textContent = (i / 2 + 1) + '.';
      var r = document.createElement('span'); r.className = 'r'; r.textContent = S.history[i].not;
      var b = document.createElement('span'); b.className = 'b';
      b.textContent = S.history[i + 1] ? S.history[i + 1].not : '';
      if (!S.history[i + 1]) b.classList.add('empty');
      row.appendChild(no); row.appendChild(r); row.appendChild(b);
      box.appendChild(row);
    }
    $('moveCount').textContent = Math.ceil(S.history.length / 2) + ' 回合';
    box.scrollTop = box.scrollHeight;
  }

  /* ---------------- AI ---------------- */
  var worker = null, reqId = 0, pending = {};
  var LEVELS = {
    1: { maxDepth: 2, timeMs: 400 },
    2: { maxDepth: 6, timeMs: 1600 },
    3: { maxDepth: 10, timeMs: 4200 }
  };
  var LEVEL_HINT = {
    1: '初级：搜索 2 层，适合入门。',
    2: '中级：搜索约 6 层，攻守均衡。',
    3: '高级：搜索 10 层，算路较深（思考稍慢）。'
  };

  function initWorker() {
    if (worker) return worker;
    try {
      worker = new Worker('/js/worker.js');
      worker.onmessage = function (e) {
        var d = e.data;
        var req = pending[d.id];
        if (!req) return;
        delete pending[d.id];
        if (req.type === 'hint') {
          if (d.move && S.status === 'playing') {
            S.hint = [d.move[0], d.move[1]];
            setMsg('建议：' + XQ.notation(S.board, d.move[0], d.move[1]), 'ok');
            draw();
          }
          return;
        }
        S.thinking = false;
        updateTurnUI();
        if (d.move) applyMove(d.move[0], d.move[1]);
      };
      worker.onerror = function () { worker = null; };
    } catch (err) { worker = null; }
    return worker;
  }

  function runSearch(side, type) {
    var id = ++reqId;
    pending[id] = { type: type };
    var opts = LEVELS[S.level] || LEVELS[2];
    var payload = { id: id, board: Array.from(S.board), side: side, level: S.level };
    if (initWorker()) {
      worker.postMessage(payload);
    } else {
      setTimeout(function () {
        var res = window.XQAI.search(payload.board, side, opts);
        workerOnResultFallback(id, res);
      }, 20);
    }
  }
  function workerOnResultFallback(id, res) {
    var d = { id: id, move: res.move };
    var req = pending[id];
    if (!req) return;
    delete pending[id];
    if (req.type === 'hint') {
      if (d.move) { S.hint = [d.move[0], d.move[1]]; setMsg('建议：' + XQ.notation(S.board, d.move[0], d.move[1]), 'ok'); draw(); }
      return;
    }
    S.thinking = false; updateTurnUI();
    if (d.move) applyMove(d.move[0], d.move[1]);
  }

  function maybeAiMove() {
    if (S.mode !== 'ai' || S.status !== 'playing' || S.turn !== S.aiSide) return;
    S.thinking = true;
    updateTurnUI();
    runSearch(S.aiSide, 'move');
  }

  /* ---------------- 计时 ---------------- */
  setInterval(function () {
    if (S.status !== 'playing') return;
    S.clock[S.turn]++;
    $('clockRed').textContent = fmt(S.clock[0]);
    $('clockBlack').textContent = fmt(S.clock[1]);
  }, 1000);

  /* ---------------- 联机 ---------------- */
  var socket = null;
  function ensureSocket() {
    if (socket) return socket;
    socket = io();
    socket.on('connect', function () {
      $('onlineMsg').textContent = '已连接服务器';
      $('onlineMsg').className = 'msg ok';
    });
    socket.on('room', onRoom);
    socket.on('sync', onSync);
    socket.on('move', function (d) { applyMove(d.f, d.t); });
    socket.on('end', function (r) { finishGame(r); });
    socket.on('msg', function (m) { setMsg(m.text, m.kind || ''); });
    socket.on('opponent-left', function () {
      setMsg('对手已离开对局', 'warn');
    });
    socket.on('draw-ask', function (d) {
      if (window.confirm((d.from || '对手') + ' 请求求和，是否同意？')) socket.emit('draw-reply', { accept: true });
      else socket.emit('draw-reply', { accept: false });
    });
    socket.on('undo-ask', function (d) {
      if (window.confirm((d.from || '对手') + ' 请求悔棋，是否同意？')) socket.emit('undo-reply', { accept: true });
      else socket.emit('undo-reply', { accept: false });
    });
    return socket;
  }

  function onRoom(info) {
    S.roomCode = info.code;
    S.mySide = info.side;
    S.names = info.names;
    $('roomBadge').classList.remove('hidden');
    $('roomBadge').innerHTML = '房间 <b>' + info.code + '</b>';
    $('roomCode').textContent = info.code;
    $('roomBox').classList.remove('hidden');
    $('nameRed').textContent = info.names[0] + (info.side === 0 ? '（你）' : '');
    $('nameBlack').textContent = info.names[1] + (info.side === 1 ? '（你）' : '');
    $('tagRed').textContent = info.side === 0 ? '执红先手' : '';
    $('tagBlack').textContent = info.side === 1 ? '执黑后手' : '';

    if (info.status === 'playing') {
      if (S.status !== 'playing') startOnlineBoard();
      setScreen('game');
      setMsg(S.turn === S.mySide ? '轮到你走棋' : '等待对手走棋', '');
      updateTurnUI();
    } else {
      setScreen('game');
      S.status = 'waiting';
      setMsg('等待对手加入房间…', '');
      updateTurnUI();
    }
  }

  function startOnlineBoard() {
    S.history = [];
    S.board = XQ.initialBoard();
    S.turn = RED;
    S.noCapture = 0;
    S.lastMove = null;
    S.selected = null; S.targets = []; S.hint = null;
    S.status = 'playing';
    S.clock = [0, 0];
    $('clockRed').textContent = '00:00';
    $('clockBlack').textContent = '00:00';
    $('banner').classList.add('hidden');
    renderMoves();
    draw();
  }

  function onSync(d) {
    S.history = (d.history || []).map(function (m, i) {
      return { f: m[0], t: m[1], cap: 0, side: i % 2, not: '' };
    });
    // 重新生成棋谱文本
    var bd = XQ.initialBoard();
    for (var i = 0; i < S.history.length; i++) {
      var h = S.history[i];
      h.not = XQ.notation(bd, h.f, h.t);
      h.cap = bd[h.t];
      XQ.makeMove(bd, h.f, h.t);
    }
    rebuildFromHistory();
    S.status = d.status === 'playing' ? 'playing' : S.status;
    S.turn = d.turn;
    $('banner').classList.add('hidden');
    renderMoves();
    draw();
    updateTurnUI();
  }

  /* ---------------- 界面事件 ---------------- */
  $('goAi').addEventListener('click', function () {
    S.name = ($('nick').value || '棋友').slice(0, 12);
    setScreen('ai');
  });
  $('goOnline').addEventListener('click', function () {
    S.name = ($('nick').value || '棋友').slice(0, 12);
    ensureSocket();
    setScreen('online');
    $('onlineMsg').textContent = '';
  });
  $('backHome1').addEventListener('click', function () { setScreen('home'); });
  $('backHome2').addEventListener('click', function () {
    if (socket && S.roomCode) socket.emit('leave');
    setScreen('home');
  });
  $('btnHome').addEventListener('click', function () {
    if (socket && S.roomCode) socket.emit('leave');
    S.status = 'idle';
    S.history = [];
    S.board = XQ.initialBoard();
    S.turn = RED;
    $('banner').classList.add('hidden');
    $('roomBadge').classList.add('hidden');
    draw();
    setScreen('home');
  });

  // 难度 / 先手
  $('levelSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    S.level = parseInt(b.dataset.level, 10);
    Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
    $('levelHint').textContent = LEVEL_HINT[S.level];
  });
  $('aiSideSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    S.mySide = parseInt(b.dataset.side, 10);
    Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
  });

  $('startAi').addEventListener('click', function () {
    S.mode = 'ai';
    S.aiSide = 1 - S.mySide;
    S.flip = S.mySide === BLACK;
    S.history = [];
    S.board = XQ.initialBoard();
    S.turn = RED;
    S.noCapture = 0;
    S.lastMove = null;
    S.selected = null; S.targets = []; S.hint = null;
    S.status = 'playing';
    S.clock = [0, 0];
    $('clockRed').textContent = '00:00';
    $('clockBlack').textContent = '00:00';
    $('banner').classList.add('hidden');
    $('roomBadge').classList.add('hidden');
    $('nameRed').textContent = S.mySide === RED ? S.name + '（你）' : 'AI 引擎';
    $('nameBlack').textContent = S.mySide === BLACK ? S.name + '（你）' : 'AI 引擎';
    $('tagRed').textContent = S.mySide === RED ? '执红先手' : '';
    $('tagBlack').textContent = S.mySide === BLACK ? '执黑后手' : '';
    setMsg('', '');
    renderMoves();
    draw();
    setScreen('game');
    updateTurnUI();
    maybeAiMove();
  });

  $('btnCreate').addEventListener('click', function () {
    ensureSocket();
    socket.emit('create', { name: S.name }, function (res) {
      if (!res.ok) { $('onlineMsg').textContent = res.msg || '创建失败'; $('onlineMsg').className = 'msg warn'; return; }
      $('onlineMsg').textContent = '房间已创建，等待对手加入…';
      $('onlineMsg').className = 'msg ok';
    });
  });

  $('btnQuick').addEventListener('click', function () {
    ensureSocket();
    $('onlineMsg').textContent = '正在匹配对手…';
    $('onlineMsg').className = 'msg';
    socket.emit('quick', { name: S.name }, function (res) {
      if (!res.ok) { $('onlineMsg').textContent = res.msg || '匹配失败'; $('onlineMsg').className = 'msg warn'; return; }
      if (res.waiting) {
        $('onlineMsg').textContent = '暂无其他等待的玩家，已为你开房，等待对手加入…';
        $('onlineMsg').className = 'msg ok';
      }
    });
  });

  $('btnJoin').addEventListener('click', function () {
    var code = ($('joinCode').value || '').trim().toUpperCase();
    if (!code) { $('onlineMsg').textContent = '请输入房间号'; $('onlineMsg').className = 'msg warn'; return; }
    ensureSocket();
    socket.emit('join', { code: code, name: S.name }, function (res) {
      if (!res.ok) { $('onlineMsg').textContent = res.msg || '加入失败'; $('onlineMsg').className = 'msg warn'; return; }
      $('onlineMsg').textContent = '已加入房间 ' + code;
      $('onlineMsg').className = 'msg ok';
    });
  });

  $('btnCopy').addEventListener('click', function () {
    var code = S.roomCode || $('roomCode').textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () {
        $('onlineMsg').textContent = '房间号已复制：' + code;
        $('onlineMsg').className = 'msg ok';
      });
    } else {
      $('onlineMsg').textContent = '房间号：' + code;
      $('onlineMsg').className = 'msg';
    }
  });

  $('btnUndo').addEventListener('click', function () {
    if (S.mode === 'ai') {
      if (S.thinking) return;
      var steps = S.history.length >= 2 ? 2 : 1;
      for (var i = 0; i < steps; i++) S.history.pop();
      rebuildFromHistory();
      S.status = 'playing';
      S.hint = null;
      $('banner').classList.add('hidden');
      renderMoves(); draw(); updateTurnUI();
      setMsg('已悔棋', 'ok');
    } else {
      socket.emit('undo-request');
    }
  });

  $('btnHint').addEventListener('click', function () {
    if (!myTurn()) return;
    S.hint = null;
    setMsg('正在计算…', '');
    runSearch(S.turn, 'hint');
  });

  $('btnDraw').addEventListener('click', function () {
    if (S.mode === 'ai') { setMsg('人机对局暂不支持求和', 'warn'); return; }
    socket.emit('draw-offer');
    setMsg('已发出求和请求', '');
  });

  $('btnResign').addEventListener('click', function () {
    if (!window.confirm('确定要认输吗？')) return;
    if (S.mode === 'ai') finishGame({ winner: S.aiSide, reason: '你认输' });
    else socket.emit('resign');
  });

  $('btnAgain').addEventListener('click', function () {
    if (S.mode === 'ai') { $('startAi').click(); return; }
    socket.emit('restart');
  });
  $('bannerBtn').addEventListener('click', function () { $('btnAgain').click(); });

  /* ---------------- 启动 ---------------- */
  setupCanvas();
  window.addEventListener('resize', function () { setupCanvas(); draw(); });
  setScreen('home');
  renderMoves();
  draw();
})();
