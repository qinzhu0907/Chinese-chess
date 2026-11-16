/* 中国象棋前端：棋盘渲染 + 人机 / 联机 / 观战 */
(function () {
  'use strict';

  var XQ = window.XQ;
  var RED = XQ.RED, BLACK = XQ.BLACK;

  var CELL = 62, M = 38, PR = 27;
  var BW = M * 2 + CELL * 8;
  var BH = M * 2 + CELL * 9;
  var ANIM_MS = 150;

  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');

  function $(id) { return document.getElementById(id); }
  function nowMs() {
    return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  }
  function fmtClock(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec >= 60) {
      var m = Math.floor(sec / 60), s = sec % 60;
      return m + ':' + (s < 10 ? '0' : '') + s;
    }
    return sec + 's';
  }
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function sound(name) {
    if (!S.sound || !window.XQSound) return;
    var fn = window.XQSound[name];
    if (typeof fn === 'function') fn();
  }

  var LEVEL_NAME = { 1: '初级', 2: '中级', 3: '高级', 4: '大师' };
  var LEVEL_HINT = {
    1: '初级：搜索 2 层，会犯点小错，适合入门。',
    2: '中级：搜索约 6 层，攻守均衡。',
    3: '高级：搜索 10 层，算路较深（思考稍慢）。',
    4: '大师：搜索 14 层、单步长考 8 秒，巅峰强度。'
  };

  /* ---------------- 状态 ---------------- */
  var S = {
    screen: 'home',
    mode: 'ai',              // ai | online
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
    status: 'idle',          // idle | waiting | playing | ended
    elapsed: [0, 0],
    perMove: 60,
    deadline: 0,
    skew: 0,                 // 服务器时间 - 本地时间
    thinking: false,
    name: '棋友',
    roomCode: '',
    role: 'player',          // player | spectator
    token: '',
    names: ['红方', '黑方'],
    connected: [true, true],
    spectators: 0,
    anim: null,
    chat: [],
    tab: 'moves',
    unread: 0,
    sound: true,
    evalText: '',
    pendingJoin: ''
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
    if (name === 'online') refreshRooms(true);
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

  function disp(r, c) { return S.flip ? [9 - r, 8 - c] : [r, c]; }
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

    // 九宫斜线
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (var k = 0; k < 2; k++) {
      var rr = k === 0 ? 0 : 7;
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
      ctx.fillStyle = 'rgba(31,157,85,.20)';
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

    // 棋子（动画中的棋子单独画）
    var checkedKing = -1;
    if (S.status === 'playing' && XQ.inCheck(S.board, S.turn)) checkedKing = XQ.findKing(S.board, S.turn);
    var skip = S.anim ? S.anim.t : -1;
    for (var s = 0; s < 90; s++) {
      var p = S.board[s];
      if (!p) continue;
      if (s === skip) continue;
      var dd = disp((s / 9) | 0, s % 9);
      drawPiece(px(dd[1]), py(dd[0]), p, {
        selected: S.selected === s,
        check: s === checkedKing
      });
    }

    if (S.anim) {
      var k = Math.min(1, (nowMs() - S.anim.t0) / ANIM_MS);
      var ease = 1 - Math.pow(1 - k, 3);
      var a = disp((S.anim.f / 9) | 0, S.anim.f % 9);
      var b = disp((S.anim.t / 9) | 0, S.anim.t % 9);
      var ax = px(a[1]) + (px(b[1]) - px(a[1])) * ease;
      var ay = py(a[0]) + (py(b[0]) - py(a[0])) * ease;
      drawPiece(ax, ay, S.anim.p, {});
    }
  }

  var animRAF = 0;
  function startAnim(f, t, p) {
    S.anim = { f: f, t: t, p: p, t0: nowMs() };
    if (!animRAF) animRAF = window.requestAnimationFrame(animLoop);
  }
  function animLoop() {
    animRAF = 0;
    if (!S.anim) { draw(); return; }
    if (nowMs() - S.anim.t0 >= ANIM_MS) { S.anim = null; draw(); return; }
    draw();
    animRAF = window.requestAnimationFrame(animLoop);
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
    if (S.status !== 'playing' || S.role !== 'player' || S.turn !== S.mySide || S.thinking) return false;
    if (S.mode === 'online' && !S.socketUp) return false;
    return true;
  }

  function onTap(e) {
    if (S.role === 'spectator' || S.status !== 'playing') return;
    if (!myTurn()) {
      if (S.status === 'playing' && S.role === 'player' && S.turn !== S.mySide) setMsg('还没轮到你走棋', 'warn');
      return;
    }
    var sq = eventToSquare(e);
    if (sq < 0) { S.selected = null; S.targets = []; draw(); return; }
    var p = S.board[sq];

    if (S.selected !== null && S.targets.indexOf(sq) >= 0) {
      var from = S.selected;
      S.selected = null; S.targets = []; S.hint = null;
      if (S.mode === 'ai') applyMove(from, sq);
      else socket.emit('move', { f: from, t: sq });
      return;
    }
    if (p && XQ.sideOf(p) === S.mySide) {
      S.selected = sq;
      S.targets = XQ.genLegal(S.board, S.turn).filter(function (m) { return m[0] === sq; })
        .map(function (m) { return m[1]; });
      S.hint = null;
      sound('select');
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
    if (Date.now() - lastTouch < 800) return;
    onTap(e);
  });

  /* ---------------- 走子 ---------------- */
  function rebuildFromHistory() {
    var bd = XQ.initialBoard();
    for (var i = 0; i < S.history.length; i++) {
      var h = S.history[i];
      if (!h.not) h.not = XQ.notation(bd, h.f, h.t);
      h.cap = bd[h.t];
      XQ.makeMove(bd, h.f, h.t);
    }
    S.board = bd;
    S.turn = S.history.length % 2 === 0 ? RED : BLACK;
    S.noCapture = 0;
    for (var j = S.history.length - 1; j >= 0; j--) {
      if (S.history[j].cap) break;
      S.noCapture++;
    }
    S.lastMove = S.history.length
      ? [S.history[S.history.length - 1].f, S.history[S.history.length - 1].t]
      : null;
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
    startAnim(f, t, p);
    sound(cap ? 'capture' : 'move');
    renderMoves();
    afterMove();
  }

  function afterMove() {
    updateTurnUI();
    if (S.mode === 'online') return;   // 联机由服务端裁定胜负
    var chk = XQ.inCheck(S.board, S.turn);
    if (XQ.genLegal(S.board, S.turn).length === 0) {
      finishGame({ winner: 1 - S.turn, reason: chk ? '将死' : '困毙' });
      return;
    }
    if (S.noCapture >= 120) { finishGame({ winner: -1, reason: '60 回合无吃子，判和' }); return; }
    if (chk) { setMsg('将军！', 'check'); sound('check'); }
    else setMsg('', '');
    maybeAiMove();
  }

  /* ---------------- 界面渲染 ---------------- */
  function sideLabel(side) {
    if (S.mode === 'ai') {
      return side === S.mySide ? (S.name + '（你）') : ('AI · ' + (LEVEL_NAME[S.level] || '中级'));
    }
    return S.names[side] || (side === RED ? '红方' : '黑方');
  }

  function renderPlayers() {
    $('nameRed').textContent = sideLabel(RED);
    $('nameBlack').textContent = sideLabel(BLACK);

    var tagR = [], tagB = [];
    if (S.mode === 'ai') {
      if (S.mySide === RED) tagR.push('执红先手'); else tagB.push('执黑后手');
    } else {
      if (S.role === 'spectator') {
        tagR.push('红方'); tagB.push('黑方');
      } else {
        if (S.mySide === RED) tagR.push('你 · 执红先手'); else tagB.push('你 · 执黑后手');
      }
      if (!S.connected[0]) tagR.push('掉线');
      if (!S.connected[1]) tagB.push('掉线');
    }
    $('tagRed').textContent = tagR.join(' · ');
    $('tagBlack').textContent = tagB.join(' · ');
  }

  function renderClocks() {
    var red, black, onlineClock = S.mode === 'online' && S.perMove > 0;

    if (onlineClock) {
      if (S.status === 'playing' && S.deadline) {
        var left = Math.max(0, Math.ceil((S.deadline - (Date.now() + S.skew)) / 1000));
        red = S.turn === RED ? left : S.perMove;
        black = S.turn === BLACK ? left : S.perMove;
      } else {
        red = S.perMove; black = S.perMove;
      }
      $('clockRed').textContent = fmtClock(red);
      $('clockBlack').textContent = fmtClock(black);
      $('clockBoxRed').classList.toggle('urgent', S.turn === RED && red <= 10 && S.status === 'playing');
      $('clockBoxBlack').classList.toggle('urgent', S.turn === BLACK && black <= 10 && S.status === 'playing');
    } else {
      $('clockRed').textContent = fmtClock(S.elapsed[0]);
      $('clockBlack').textContent = fmtClock(S.elapsed[1]);
      $('clockBoxRed').classList.remove('urgent');
      $('clockBoxBlack').classList.remove('urgent');
    }

    $('clockBoxRed').classList.toggle('active', S.status === 'playing' && S.turn === RED);
    $('clockBoxBlack').classList.toggle('active', S.status === 'playing' && S.turn === BLACK);
  }

  function updateTurnUI() {
    var chip = $('turnChip');
    if (S.status !== 'playing') {
      chip.textContent = S.status === 'ended' ? '对局结束' : '准备开始';
      chip.className = 'turn-chip';
    } else {
      var who = S.turn === RED ? '红方' : '黑方';
      var extra = '';
      if (S.role === 'spectator') extra = '（观战）';
      else if (S.turn === S.mySide) extra = ' · 轮到你';
      else extra = ' · 等待对手';
      if (S.thinking) extra = ' · AI 思考中…';
      chip.textContent = who + '走棋' + extra;
      chip.className = 'turn-chip ' + (S.turn === RED ? 'red' : 'black');
    }
    $('pRed').classList.toggle('active', S.status === 'playing' && S.turn === RED);
    $('pBlack').classList.toggle('active', S.status === 'playing' && S.turn === BLACK);

    var playing = S.status === 'playing';
    var isPlayer = S.role === 'player';
    $('btnUndo').disabled = !(playing && isPlayer && S.history.length > 0 && !S.thinking);
    $('btnHint').disabled = !(playing && isPlayer && S.turn === S.mySide && !S.thinking);
    $('btnDraw').disabled = !(playing && isPlayer);
    $('btnResign').disabled = !(playing && isPlayer);
    $('btnAgain').classList.toggle('hidden', S.status !== 'ended');
    $('specNote').classList.toggle('hidden', S.role !== 'spectator' || S.mode !== 'online');
    $('evalChip').textContent = S.evalText || '';
    renderPlayers();
    renderClocks();
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
      var r = document.createElement('span'); r.className = 'r'; r.textContent = S.history[i].not || '';
      var b = document.createElement('span'); b.className = 'b';
      b.textContent = S.history[i + 1] ? (S.history[i + 1].not || '') : '';
      if (!S.history[i + 1]) b.classList.add('empty');
      row.appendChild(no); row.appendChild(r); row.appendChild(b);
      box.appendChild(row);
    }
    $('moveCount').textContent = Math.ceil(S.history.length / 2) + ' 回合';
    box.scrollTop = box.scrollHeight;
  }

  /* 棋谱导出：复制 / 下载 */
  function buildScoreText() {
    var lines = [];
    lines.push('中国象棋对局谱');
    lines.push('时间：' + new Date().toLocaleString());
    lines.push('红方：' + (S.names[0] || '红方') + '　黑方：' + (S.names[1] || '黑方'));
    var modeTxt = S.mode === 'ai'
      ? '人机 · ' + (LEVEL_NAME[S.level] || '中级')
      : '联机 · 房间 ' + (S.roomCode || '-');
    var resTxt = '进行中';
    if (S.result) {
      resTxt = S.result.winner === -1 ? '和棋'
        : (S.result.winner === RED ? '红方胜' : '黑方胜') + '（' + (S.result.reason || '') + '）';
    }
    lines.push('模式：' + modeTxt + '　结果：' + resTxt);
    lines.push('');
    for (var i = 0; i < S.history.length; i += 2) {
      var no = (i / 2 + 1) + '.';
      var r = S.history[i].not || '';
      var b = S.history[i + 1] ? (S.history[i + 1].not || '') : '…';
      lines.push(no + ' ' + r + '　' + b);
    }
    return lines.join('\n');
  }

  function copyMoves() {
    if (!S.history.length) { setMsg('还没有棋谱可复制', 'warn'); return; }
    var txt = buildScoreText();
    var done = function () { setMsg('棋谱已复制到剪贴板', 'ok'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt, done); });
    } else {
      fallbackCopy(txt, done);
    }
  }
  function fallbackCopy(txt, done) {
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { setMsg('复制失败，请用「导出」下载', 'warn'); }
    document.body.removeChild(ta);
  }
  function saveMoves() {
    if (!S.history.length) { setMsg('还没有棋谱可导出', 'warn'); return; }
    var blob = new Blob([buildScoreText()], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '棋谱-' + new Date().toISOString().slice(0, 10) + '-' + (S.roomCode || '人机') + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    setMsg('棋谱已下载', 'ok');
  }

  function appendChat(m) {
    S.chat.push(m);
    if (S.chat.length > 80) S.chat.shift();
    var box = $('chatList');
    var el = document.createElement('div');
    if (m.sys) {
      el.className = 'chat-sys';
      el.textContent = m.text;
    } else {
      el.className = 'chat-item' + (m.me ? ' me' : '');
      var who = document.createElement('span');
      who.className = 'chat-who';
      who.textContent = m.from + (m.role === 'spectator' ? '（观众）' : '');
      var txt = document.createElement('span');
      txt.className = 'chat-text';
      txt.textContent = m.text;
      el.appendChild(who);
      el.appendChild(txt);
    }
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;

    if (!m.sys && S.tab !== 'chat') {
      S.unread++;
      $('chatDot').classList.remove('hidden');
      $('chatDot').textContent = S.unread > 9 ? '9+' : String(S.unread);
    }
  }

  function finishGame(result) {
    S.status = 'ended';
    S.thinking = false;
    S.selected = null; S.targets = []; S.hint = null;
    draw();
    var title, sub;
    if (result.winner === -1) {
      title = '和棋';
      sub = result.reason || '双方议和';
      sound('draw');
    } else {
      var iWon = S.role === 'spectator' ? null : result.winner === S.mySide;
      if (iWon === null) {
        title = (result.winner === RED ? '红方' : '黑方') + '胜';
      } else {
        title = iWon ? '你赢了！' : '你输了';
      }
      sub = sideLabel(result.winner) + ' 胜 · ' + (result.reason || '');
      if (iWon === null) sound('check');
      else sound(iWon ? 'win' : 'lose');
      if (S.mode === 'ai') bumpRecord(iWon);
    }
    $('bannerTitle').textContent = title;
    $('bannerSub').textContent = sub;
    $('banner').classList.remove('hidden');
    setMsg(sub, 'ok');
    updateTurnUI();
  }

  /* 人机战绩（仅人机模式、玩家本人对局时累计，存 localStorage） */
  function loadRecord() {
    try {
      var r = JSON.parse(LS.get('xq_record', '') || '');
      if (r && typeof r.w === 'number') return { w: r.w | 0, l: r.l | 0, d: r.d | 0 };
    } catch (e) {}
    return { w: 0, l: 0, d: 0 };
  }
  function bumpRecord(iWon) {
    var r = loadRecord();
    if (iWon === true) r.w++; else if (iWon === false) r.l++; else r.d++;
    LS.set('xq_record', JSON.stringify(r));
    renderRecord();
  }
  function renderRecord() {
    var r = loadRecord(), el = $('aiRecord');
    if (!el) return;
    var total = r.w + r.l + r.d;
    var rate = total ? Math.round(r.w * 100 / Math.max(1, r.w + r.l)) : 0;
    el.textContent = '战绩：' + r.w + ' 胜 ' + r.l + ' 负 ' + r.d + ' 和' +
      (total ? '（对局 ' + total + '，胜率 ' + rate + '%）' : '');
  }

  /* ---------------- AI ---------------- */
  var worker = null, reqId = 0, pending = {};
  var LEVELS = {
    1: { maxDepth: 2, timeMs: 350 },
    2: { maxDepth: 6, timeMs: 1400 },
    3: { maxDepth: 10, timeMs: 4000 },
    4: { maxDepth: 14, timeMs: 8000 }
  };

  function initWorker() {
    if (worker) return worker;
    try {
      worker = new Worker('/js/worker.js');
      worker.onmessage = function (e) {
        var d = e.data || {};
        var req = pending[d.id];
        if (!req) return;
        delete pending[d.id];
        handleEngineResult(req, d);
      };
      worker.onerror = function () { worker = null; };
    } catch (err) { worker = null; }
    return worker;
  }

  function handleEngineResult(req, d) {
    if (req.type === 'hint') {
      if (d.move && S.status === 'playing') {
        S.hint = [d.move[0], d.move[1]];
        setMsg('建议：' + XQ.notation(S.board, d.move[0], d.move[1]), 'ok');
        draw();
      } else {
        setMsg('暂时算不出建议着法', 'warn');
      }
      return;
    }
    S.thinking = false;
    if (d.move) {
      if (typeof d.score === 'number') {
        var pts = (d.score / 100).toFixed(1);
        S.evalText = (d.book ? '开局库' : ('深度 ' + (d.depth || 0) + ' · ' + (d.score > 0 ? '+' : '') + pts));
      }
      applyMove(d.move[0], d.move[1]);
    } else {
      setMsg('AI 没有找到可行着法', 'warn');
      updateTurnUI();
    }
  }

  function runSearch(type) {
    var id = ++reqId;
    pending[id] = { type: type };
    var payload = {
      id: id, board: Array.from(S.board), side: S.turn,
      level: S.level, type: type, useBook: type !== 'hint'
    };
    if (initWorker()) {
      worker.postMessage(payload);
    } else {
      setTimeout(function () {
        var opts = type === 'hint' ? { maxDepth: 8, timeMs: 1800 } : (LEVELS[S.level] || LEVELS[2]);
        var res = window.XQAI.search(payload.board, payload.side, opts);
        handleEngineResult(pending[id] || {}, { id: id, move: res.move, score: res.score, depth: res.depth });
        delete pending[id];
      }, 20);
    }
  }

  function maybeAiMove() {
    if (S.mode !== 'ai' || S.status !== 'playing' || S.turn !== S.aiSide) return;
    S.thinking = true;
    updateTurnUI();
    // 让落子动画先走完再思考，观感更自然
    setTimeout(function () {
      if (S.status === 'playing' && S.turn === S.aiSide) runSearch('move');
    }, 160);
  }

  /* ---------------- 计时 ---------------- */
  setInterval(function () {
    if (S.status !== 'playing') return;
    S.elapsed[S.turn]++;
    renderClocks();
  }, 1000);

  setInterval(renderClocks, 250);

  /* ---------------- 联机 ---------------- */
  var socket = null;
  S.socketUp = false;

  function ensureSocket() {
    if (socket) return socket;
    if (typeof io !== 'function') {
      $('onlineMsg').textContent = '无法连接服务器（socket.io 未加载）';
      $('onlineMsg').className = 'msg warn';
      return null;
    }
    socket = io({ reconnection: true, reconnectionDelay: 800, reconnectionDelayMax: 4000 });

    socket.on('connect', function () {
      S.socketUp = true;
      $('connDot').classList.add('on');
      $('reconnectBar').classList.add('hidden');

      // 有邀请/待加入的房间优先；否则尝试恢复上次的座位
      if (S.pendingJoin) { flushPending(); return; }

      var saved = readSession();
      if (saved && saved.token) {
        socket.emit('resume', { code: saved.code, token: saved.token }, function (res) {
          if (!res || !res.ok) {
            clearSession();
            return;
          }
          S.token = res.token;
          enterOnline(res.code, res.side, 'player');
          setMsg('已恢复到房间 ' + res.code, 'ok');
        });
      }
      refreshRooms(S.screen === 'online');
    });

    socket.on('disconnect', function () {
      S.socketUp = false;
      $('connDot').classList.remove('on');
      if (S.mode === 'online' && S.roomCode) $('reconnectBar').classList.remove('hidden');
    });

    socket.on('connect_error', function () {
      S.socketUp = false;
      $('connDot').classList.remove('on');
    });

    socket.on('room', onRoom);
    socket.on('sync', onSync);
    socket.on('move', onRemoteMove);
    socket.on('end', function (r) { finishGame(r); });
    socket.on('msg', function (m) { setMsg(m.text, m.kind || ''); if (m.kind === 'warn') sound('error'); });
    socket.on('chat', function (m) { appendChat(m); });
    socket.on('kick', function (d) {
      clearSession();
      setMsg((d && d.msg) || '已断开', 'warn');
      goHome();
    });
    socket.on('opponent', function (d) {
      if (typeof d.side === 'number' && d.side >= 0) S.connected[d.side] = !!d.connected;
      if (d.text) setMsg(d.text, d.connected ? 'ok' : 'warn');
      renderPlayers();
    });
    socket.on('opponent-left', function (d) {
      if (d && typeof d.side === 'number') S.connected[d.side] = false;
      setMsg((d && d.name ? d.name + ' 已离开对局' : '对手已离开对局'), 'warn');
      renderPlayers();
    });
    socket.on('draw-ask', function (d) {
      ask((d.from || '对手') + ' 请求和棋，是否同意？', function (yes) {
        socket.emit('draw-reply', { accept: yes });
      });
    });
    socket.on('undo-ask', function (d) {
      ask((d.from || '对手') + ' 请求悔棋，是否同意？', function (yes) {
        socket.emit('undo-reply', { accept: yes });
      });
    });
    socket.on('rematch-ask', function (d) {
      ask((d.from || '对手') + ' 邀请再来一局（交换先后手），是否接受？', function (yes) {
        if (yes) socket.emit('rematch');
      });
    });

    return socket;
  }

  /* 本地会话（刷新页面也能坐回原位） */
  function readSession() {
    try {
      var raw = LS.get('xq_session', '');
      if (!raw) return null;
      var o = JSON.parse(raw);
      return (o && o.token && o.code) ? o : null;
    } catch (e) { return null; }
  }
  function saveSession() {
    if (S.role !== 'player' || !S.token || !S.roomCode) return;
    LS.set('xq_session', JSON.stringify({ code: S.roomCode, token: S.token, side: S.mySide }));
  }
  function clearSession() {
    S.token = '';
    LS.del('xq_session');
  }

  function enterOnline(code, side, role) {
    S.mode = 'online';
    S.roomCode = code;
    S.mySide = side;
    S.role = role;
    S.flip = role === 'player' && side === BLACK;
    S.evalText = '';
    $('roomBadge').classList.remove('hidden');
    $('roomCode').textContent = code;
    $('roomBox').classList.remove('hidden');
    setScreen('game');
    saveSession();
  }

  function onRoom(info) {
    var newRoom = S.roomCode !== info.code || S.role !== info.role;
    S.roomCode = info.code;
    S.role = info.role;
    S.mySide = info.side;
    S.names = info.names || S.names;
    S.perMove = info.perMove || 0;
    S.spectators = info.spectators || 0;
    S.connected = info.connected || [true, true];

    if (S.role === 'player') S.flip = S.mySide === BLACK;
    if (newRoom) {
      S.history = [];
      S.board = XQ.initialBoard();
      S.turn = RED;
      S.lastMove = null;
      S.selected = null; S.targets = []; S.hint = null;
      S.chat = [];
      $('chatList').innerHTML = '';
      S.unread = 0;
      $('chatDot').classList.add('hidden');
    }

    $('roomBadge').classList.remove('hidden');
    $('roomBadge').innerHTML = '房间 <b>' + info.code + '</b>' +
      (S.role === 'spectator' ? ' · 观战' : '') +
      (S.spectators ? ' · ' + S.spectators + ' 人观战' : '');
    $('roomCode').textContent = info.code;
    $('roomBox').classList.remove('hidden');

    if (info.status === 'playing') {
      S.status = 'playing';
      $('banner').classList.add('hidden');
    } else if (info.status === 'waiting') {
      S.status = 'waiting';
      setMsg('等待对手加入房间…把房间号 ' + info.code + ' 发给好友', '');
    } else if (info.status === 'ended') {
      if (info.result) finishGame(info.result);
    }

    saveSession();
    setScreen('game');
    updateTurnUI();
    draw();
  }

  function onSync(d) {
    S.history = (d.history || []).map(function (m, i) {
      return { f: m[0], t: m[1], cap: 0, side: i % 2, not: '' };
    });
    rebuildFromHistory();
    S.perMove = d.perMove || 0;
    S.deadline = d.deadline || 0;
    if (d.now) S.skew = d.now - Date.now();
    if (d.names) S.names = d.names;
    if (d.status) S.status = d.status;
    if (d.status !== 'ended') {
      $('banner').classList.add('hidden');
      if (!S.result) S.elapsed = [0, 0];
    }
    if (d.result) S.result = d.result;
    S.selected = null; S.targets = []; S.hint = null; S.anim = null;
    renderMoves();
    draw();
    updateTurnUI();
  }

  function onRemoteMove(d) {
    S.deadline = d.deadline || 0;
    if (d.now) S.skew = d.now - Date.now();
    if (d.check) { setMsg('将军！', 'check'); sound('check'); }
    applyMove(d.f, d.t);
    if (S.status === 'playing') updateTurnUI();
  }

  /* ---------------- 房间大厅 ---------------- */
  var roomTimer = 0;
  function refreshRooms(withList) {
    fetch('/api/stats', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        $('homeStats').textContent = '服务器在线 ' + d.online + ' 人 · 对局中 ' + d.playing +
          ' 桌 · 等待中 ' + (d.waitingRooms ? d.waitingRooms.length : 0) + ' 桌';
        if (withList) renderRoomList(d.waitingRooms || []);
      })
      .catch(function () { $('homeStats').textContent = '服务器状态读取失败'; });

    clearTimeout(roomTimer);
    if (withList) roomTimer = setTimeout(function () { refreshRooms(true); }, 5000);
  }

  function renderRoomList(list) {
    var box = $('roomList');
    box.innerHTML = '';
    if (!list.length) {
      var empty = document.createElement('div');
      empty.className = 'room-empty';
      empty.textContent = '暂无等待中的房间，点「创建房间」开一桌吧';
      box.appendChild(empty);
      return;
    }
    list.forEach(function (r) {
      var el = document.createElement('button');
      el.className = 'room-item';
      el.innerHTML = '<b>' + r.code + '</b><span>' + r.host + '</span>';
      el.addEventListener('click', function () { joinRoom(r.code); });
      box.appendChild(el);
    });
  }

  /* ---------------- 询问条 ---------------- */
  var askCb = null, askTimer = 0;
  function ask(text, cb) {
    $('askText').textContent = text;
    $('askBar').classList.remove('hidden');
    askCb = cb;
    clearTimeout(askTimer);
    askTimer = setTimeout(function () { closeAsk(false); }, 20000);
  }
  function closeAsk(yes) {
    $('askBar').classList.add('hidden');
    clearTimeout(askTimer);
    var cb = askCb;
    askCb = null;
    if (cb) cb(!!yes);
  }
  $('askYes').addEventListener('click', function () { closeAsk(true); });
  $('askNo').addEventListener('click', function () { closeAsk(false); });

  /* ---------------- 进入联机流程 ---------------- */
  function currentPerMove() {
    var on = $('perMoveSeg').querySelector('button.on');
    return on ? parseInt(on.dataset.pm, 10) : 60;
  }

  function goOnline() {
    ensureSocket();
    setScreen('online');
    $('onlineMsg').textContent = S.socketUp ? '' : '正在连接服务器…';
    $('onlineMsg').className = 'msg';
    refreshRooms(true);
    flushPending();
  }

  function flushPending() {
    if (!S.socketUp || !S.pendingJoin) return;
    var code = S.pendingJoin;
    S.pendingJoin = '';
    joinRoom(code);
  }

  function joinRoom(code) {
    ensureSocket();
    if (!socket) return;
    code = String(code || '').toUpperCase().trim();
    if (!code) { $('onlineMsg').textContent = '请输入房间号'; $('onlineMsg').className = 'msg warn'; return; }
    S.pendingJoin = '';
    var cb = function (res) {
      if (!res) return;
      if (!res.ok) {
        $('onlineMsg').textContent = res.msg || '加入失败';
        $('onlineMsg').className = 'msg warn';
        return;
      }
      S.token = res.token || '';
      enterOnline(res.code, res.side, res.spectate ? 'spectator' : 'player');
      if (res.spectate) setMsg('房间已满，已进入观战模式', 'ok');
      else setMsg('已加入房间 ' + res.code, 'ok');
      $('onlineMsg').textContent = res.spectate ? '已进入观战' : '已加入房间 ' + res.code;
      $('onlineMsg').className = 'msg ok';
    };
    if (S.socketUp) {
      // 只有同房间才带 token（用于坐回原位），避免串房
      socket.emit('join', { code: code, name: S.name, token: S.roomCode === code ? S.token : '' }, cb);
    } else {
      S.pendingJoin = code;
      $('onlineMsg').textContent = '正在连接服务器…';
      $('onlineMsg').className = 'msg';
    }
  }

  function goHome() {
    if (socket && S.roomCode && S.role === 'player') socket.emit('leave');
    clearSession();
    S.mode = 'ai';
    S.roomCode = '';
    S.role = 'player';
    S.status = 'idle';
    S.history = [];
    S.board = XQ.initialBoard();
    S.turn = RED;
    S.lastMove = null; S.selected = null; S.targets = []; S.hint = null;
    S.anim = null; S.evalText = ''; S.deadline = 0;
    S.names = ['红方', '黑方'];
    S.connected = [true, true];
    S.chat = [];
    $('chatList').innerHTML = '';
    $('banner').classList.add('hidden');
    $('roomBadge').classList.add('hidden');
    $('roomBox').classList.add('hidden');
    $('askBar').classList.add('hidden');
    clearTimeout(roomTimer);
    renderMoves();
    draw();
    setScreen('home');
    refreshRooms(false);
  }

  /* ---------------- 界面事件 ---------------- */
  $('nick').value = LS.get('xq_name', '棋友');
  $('nick').addEventListener('change', function () {
    S.name = ($('nick').value || '棋友').trim().slice(0, 12);
    LS.set('xq_name', S.name);
  });

  $('goAi').addEventListener('click', function () {
    S.name = ($('nick').value || '棋友').trim().slice(0, 12) || '棋友';
    LS.set('xq_name', S.name);
    setScreen('ai');
  });

  $('goOnline').addEventListener('click', function () {
    S.name = ($('nick').value || '棋友').trim().slice(0, 12) || '棋友';
    LS.set('xq_name', S.name);
    goOnline();
  });

  $('backHome1').addEventListener('click', function () { setScreen('home'); });
  $('backHome2').addEventListener('click', function () { goHome(); });
  $('btnHome').addEventListener('click', function () { goHome(); });

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

  $('perMoveSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
  });

  $('startAi').addEventListener('click', function () {
    S.mode = 'ai';
    S.role = 'player';
    S.aiSide = 1 - S.mySide;
    S.flip = S.mySide === BLACK;
    S.history = [];
    S.board = XQ.initialBoard();
    S.turn = RED;
    S.noCapture = 0;
    S.lastMove = null;
    S.selected = null; S.targets = []; S.hint = null;
    S.status = 'playing';
    S.elapsed = [0, 0];
    S.anim = null;
    S.evalText = '';
    S.thinking = false;
    $('banner').classList.add('hidden');
    $('roomBadge').classList.add('hidden');
    $('roomBox').classList.add('hidden');
    setMsg('', '');
    renderMoves();
    draw();
    setScreen('game');
    updateTurnUI();
    maybeAiMove();
  });

  $('btnCreate').addEventListener('click', function () {
    ensureSocket();
    if (!socket) return;
    $('onlineMsg').textContent = '正在创建房间…';
    $('onlineMsg').className = 'msg';
    socket.emit('create', { name: S.name, perMove: currentPerMove() }, function (res) {
      if (!res || !res.ok) {
        $('onlineMsg').textContent = (res && res.msg) || '创建失败';
        $('onlineMsg').className = 'msg warn';
        return;
      }
      S.token = res.token;
      enterOnline(res.code, res.side, 'player');
      $('onlineMsg').textContent = '房间已创建，等待对手加入…';
      $('onlineMsg').className = 'msg ok';
    });
  });

  $('btnQuick').addEventListener('click', function () {
    ensureSocket();
    if (!socket) return;
    $('onlineMsg').textContent = '正在匹配对手…';
    $('onlineMsg').className = 'msg';
    socket.emit('quick', { name: S.name, perMove: currentPerMove() }, function (res) {
      if (!res || !res.ok) {
        $('onlineMsg').textContent = (res && res.msg) || '匹配失败';
        $('onlineMsg').className = 'msg warn';
        return;
      }
      S.token = res.token;
      enterOnline(res.code, res.side, 'player');
      if (res.waiting) {
        $('onlineMsg').textContent = '暂无其他等待的玩家，已为你开房，等待对手加入…';
        $('onlineMsg').className = 'msg ok';
      }
    });
  });

  $('btnJoin').addEventListener('click', function () {
    joinRoom($('joinCode').value);
  });
  $('joinCode').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') joinRoom($('joinCode').value);
  });

  $('btnCopy').addEventListener('click', function () {
    var code = S.roomCode || $('roomCode').textContent;
    copyText(code, '房间号已复制：' + code);
  });

  $('btnCopyLink').addEventListener('click', function () {
    var url = location.origin + '/?room=' + encodeURIComponent(S.roomCode || $('roomCode').textContent);
    copyText(url, '邀请链接已复制，发给好友即可对战');
  });

  function copyText(text, okMsg) {
    var done = function () {
      $('onlineMsg').textContent = okMsg;
      $('onlineMsg').className = 'msg ok';
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        $('onlineMsg').textContent = text;
        $('onlineMsg').className = 'msg';
      });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {
        $('onlineMsg').textContent = text;
        $('onlineMsg').className = 'msg';
      }
      document.body.removeChild(ta);
    }
  }

  // 棋谱 / 聊天 切换
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () {
      S.tab = t.dataset.pane;
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) {
        x.classList.toggle('on', x === t);
      });
      $('paneMoves').classList.toggle('hidden', S.tab !== 'moves');
      $('paneChat').classList.toggle('hidden', S.tab !== 'chat');
      if (S.tab === 'chat') {
        S.unread = 0;
        $('chatDot').classList.add('hidden');
        $('chatList').scrollTop = $('chatList').scrollHeight;
      }
    });
  });

  $('chatForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = ($('chatInput').value || '').trim();
    if (!text) return;
    if (!socket || !S.roomCode) { setMsg('当前不在房间内', 'warn'); return; }
    socket.emit('chat', { text: text });
    $('chatInput').value = '';
  });

  $('btnCopyMoves').addEventListener('click', copyMoves);
  $('btnSaveMoves').addEventListener('click', saveMoves);

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
    runSearch('hint');
  });

  $('btnDraw').addEventListener('click', function () {
    if (S.mode === 'ai') { setMsg('人机对局不需要求和，直接重开吧', 'warn'); return; }
    socket.emit('draw-offer');
  });

  $('btnResign').addEventListener('click', function () {
    ask('确定要认输吗？', function (yes) {
      if (!yes) return;
      if (S.mode === 'ai') finishGame({ winner: S.aiSide, reason: '你认输' });
      else socket.emit('resign');
    });
  });

  $('btnAgain').addEventListener('click', function () {
    if (S.mode === 'ai') { $('startAi').click(); return; }
    socket.emit('rematch');
  });
  $('bannerBtn').addEventListener('click', function () { $('btnAgain').click(); });

  $('btnFlip').addEventListener('click', function () {
    S.flip = !S.flip;
    draw();
  });

  $('btnSound').addEventListener('click', function () {
    S.sound = !S.sound;
    LS.set('xq_sound', S.sound ? '1' : '0');
    if (window.XQSound) window.XQSound.setEnabled(S.sound);
    $('btnSound').textContent = S.sound ? '🔊' : '🔇';
    if (S.sound) sound('select');
  });

  /* ---------------- 启动 ---------------- */
  S.sound = LS.get('xq_sound', '1') !== '0';
  S.name = LS.get('xq_name', '棋友') || '棋友';
  if (window.XQSound) window.XQSound.setEnabled(S.sound);
  $('btnSound').textContent = S.sound ? '🔊' : '🔇';

  setupCanvas();
  window.addEventListener('resize', function () { setupCanvas(); draw(); });
  document.addEventListener('pointerdown', function once() {
    if (window.XQSound) window.XQSound.unlock();
    document.removeEventListener('pointerdown', once);
  });

  setScreen('home');
  renderMoves();
  renderRecord();
  draw();
  refreshRooms(false);

  // 邀请链接：?room=ABCDE
  (function () {
    var m = /[?&]room=([A-Za-z0-9]+)/.exec(location.search);
    if (!m) return;
    var code = m[1].toUpperCase();
    $('joinCode').value = code;
    goOnline();
    var saved = readSession();
    if (saved && saved.code === code) {
      // 自己上次就在这个房间：走 resume 恢复座位
      $('onlineMsg').textContent = '正在恢复房间 ' + code + '…';
    } else {
      S.pendingJoin = code;
      $('onlineMsg').textContent = '正在加入房间 ' + code + '…';
      flushPending();
    }
    $('onlineMsg').className = 'msg';
  })();
})();
