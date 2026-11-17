'use strict';
/* 中国象棋 · 联机服务端
 * - 房间制对战：创建 / 房间号加入 / 快速匹配 / 观战
 * - 服务端权威：走法合法性、将死困毙、长将、三次重复、自然限着、步时超时
 * - 断线重连：玩家凭 token 在宽限期内回到原座位
 * - 房间内聊天
 */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const XQ = require('./shared/rules.js');
const REF = require('./shared/referee.js');
const DB = require('./db.js');
const AUTH = require('./auth.js');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';
const DEFAULT_PER_MOVE = parseInt(process.env.PER_MOVE, 10) || 60;   // 每步限时（秒），0 = 不限
const GRACE_MS = parseInt(process.env.RECONNECT_GRACE, 10) || 120000; // 掉线宽限（毫秒）
const MAX_ROOMS = parseInt(process.env.MAX_ROOMS, 10) || 4000;
// 强制登录门禁：默认开启（1）。离线单测可用 REQUIRE_LOGIN=0 关闭以跑匿名流程。
const REQUIRE_LOGIN = (process.env.REQUIRE_LOGIN || '1') !== '0';
const MAX_CHAT_KEEP = 60;
const CHAT_COOLDOWN = 700;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 25000,
  pingInterval: 20000,
  maxHttpBufferSize: 1e5,
  cors: { origin: process.env.CORS_ORIGIN || false }
});

app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '7d',
  setHeaders: function (res, filePath) {
    if (/\.html?$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));
app.use('/shared', express.static(path.join(__dirname, 'shared'), { maxAge: '7d' }));

/* ---------------- 账号 / 认证 ---------------- */
/* 从请求头取会话 token */
function tokenFromReq(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  if (req.headers['x-auth-token']) return String(req.headers['x-auth-token']).trim();
  return null;
}

app.get('/api/me', function (req, res) {
  const user = AUTH.verifyToken(tokenFromReq(req));
  res.json({ ok: true, user: user });
});

app.post('/api/auth/send-code', async function (req, res) {
  const email = (req.body && req.body.email) || '';
  const r = await AUTH.sendCode(email);
  if (!r.ok) return res.status(400).json({ ok: false, msg: r.msg });
  res.json({ ok: true, msg: r.msg, dev: !!r.dev, debugCode: r.debugCode });
});

app.post('/api/auth/verify', function (req, res) {
  const email = (req.body && req.body.email) || '';
  const code = (req.body && req.body.code) || '';
  const r = AUTH.verifyCode(email, code);
  if (!r.ok) return res.status(400).json({ ok: false, msg: r.msg });
  res.json({ ok: true, token: r.token, user: r.user });
});

/* 仅供自动化测试：非生产环境签发测试会话（生产永远 404） */
if (NODE_ENV !== 'production') {
  app.post('/api/auth/test-login', function (req, res) {
    const email = String((req.body && req.body.email) || 'e2e@test.local').toLowerCase();
    let user = DB.getUserByEmail(email);
    if (!user) user = DB.createUser(email, email.split('@')[0]);
    res.json({ ok: true, token: AUTH.signToken(user.id, user.email), user: DB.publicProfile(user) });
  });
}

/* ---------------- 排行榜 / 档案 / 历史 ---------------- */
app.get('/api/leaderboard', function (req, res) {
  const limit = req.query.limit || 50;
  res.json({ ok: true, list: DB.leaderboard(limit) });
});

app.get('/api/profile', function (req, res) {
  const user = AUTH.verifyToken(tokenFromReq(req));
  if (!user) return res.status(401).json({ ok: false, msg: '未登录' });
  res.json({ ok: true, user: user });
});

app.get('/api/games', function (req, res) {
  const user = AUTH.verifyToken(tokenFromReq(req));
  if (!user) return res.status(401).json({ ok: false, msg: '未登录' });
  const limit = req.query.limit || 20;
  // 需要邮箱才能查历史（publicProfile 不含 email，重新取）
  res.json({ ok: true, games: DB.gamesFor(DB.getUserById(user.id).email, limit) });
});

app.get('/api/games/:id', function (req, res) {
  const g = DB.gameById(parseInt(req.params.id, 10));
  if (!g) return res.status(404).json({ ok: false, msg: '对局不存在' });
  res.json({ ok: true, game: g });
});

/* 人机对局落库（仅记录历史，不计 ELO） */
app.post('/api/games/ai', function (req, res) {
  const user = AUTH.verifyToken(tokenFromReq(req));
  if (!user) return res.status(401).json({ ok: false, msg: '未登录' });
  const full = DB.getUserById(user.id);
  const b = req.body || {};
  const mySide = b.mySide === 0 ? 0 : 1;
  const aiLevel = parseInt(b.aiLevel, 10) || null;
  const winner = b.winner === -1 ? -1 : (b.winner === 0 ? 0 : 1);
  // 人机：我执红则 red=我, 执黑则 black=我
  const myName = full.nickname || '棋友';
  const aiName = 'AI · ' + (['初级','中级','高级','大师'][(aiLevel||2)-1] || '中级');
  let redEmail = null, blackEmail = null, redName, blackName;
  if (mySide === 0) { redEmail = full.email; blackEmail = null; redName = myName; blackName = aiName; }
  else { redEmail = null; blackEmail = full.email; redName = aiName; blackName = myName; }
  DB.recordGame({
    mode: 'ai',
    redEmail: redEmail, blackEmail: blackEmail,
    redName: redName, blackName: blackName,
    winner: winner, reason: b.reason || '',
    moves: b.moves || [], notation: b.notation || [],
    perMove: 0, aiLevel: aiLevel
  });
  res.json({ ok: true });
});

app.get('/api/stats/global', function (req, res) {
  res.json({ ok: true, stats: DB.globalStats() });
});

/* SMTP 配置状态（供前端判断是否显示「登录暂不可用」提示） */
app.get('/api/auth/smtp-status', function (req, res) {
  res.json({
    ok: true,
    smtpConfigured: AUTH.smtpConfigured(),
    devMode: process.env.DEV_AUTH === '1'
  });
});

app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    playing: countPlaying(),
    online: io.engine.clientsCount,
    uptime: Math.round(process.uptime())
  });
});

app.get('/api/stats', (req, res) => {
  const waiting = [];
  for (const room of rooms.values()) {
    if (room.status === 'waiting' && room.players[0]) {
      waiting.push({ code: room.code, host: room.players[0].name, since: room.createdAt });
    }
  }
  waiting.sort(function (a, b) { return b.since - a.since; });
  res.json({
    online: io.engine.clientsCount,
    rooms: rooms.size,
    playing: countPlaying(),
    waitingRooms: waiting.slice(0, 20)
  });
});

function countPlaying() {
  let n = 0;
  for (const room of rooms.values()) if (room.status === 'playing') n++;
  return n;
}

/* ---------------- 房间 ---------------- */
const rooms = new Map();
const tokenIndex = new Map();  // token -> room code
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
  } while (rooms.has(code));
  return code;
}

function normName(name, fallback) {
  const s = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
  return s || fallback;
}

function createRoom(perMove) {
  const ref = REF.newState();
  const room = {
    code: newCode(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    players: [null, null],       // { token, name, sid, connected }
    specs: new Map(),            // socketId -> { name }
    history: ref.history,        // { f, t, cap, not }
    board: ref.board,
    turn: ref.turn,
    posCount: ref.posCount,      // 局面指纹 -> 出现次数
    checks: ref.checks,          // 各方「连续将军」手数
    noCapture: ref.noCapture,    // 连续无吃子手数
    status: 'waiting',           // waiting | playing | ended
    result: null,
    perMove: perMove || 0,
    deadline: 0,
    drawVotes: [false, false],
    rematchVotes: [false, false],
    persisted: false,
    chat: [],
    graceTimers: [null, null],
    lastActive: Date.now()
  };
  rooms.set(room.code, room);
  return room;
}

/* 全量重放：由历史推导棋盘与所有衍生状态，避免增量更新产生漂移 */
function replay(room) { return REF.replay(room); }

/* 胜负 / 和棋判定，返回 null 表示继续 */
function judge(room) { return REF.judge(room); }

function refreshDeadline(room) {
  if (room.status === 'playing' && room.perMove > 0 &&
      room.players[0] && room.players[1] &&
      room.players[0].connected && room.players[1].connected) {
    room.deadline = Date.now() + room.perMove * 1000;
  } else {
    room.deadline = 0; // 暂停计时（等待对手 / 掉线宽限中）
  }
}

function roomInfo(room, role, side) {
  return {
    code: room.code,
    role: role,                 // player | spectator
    side: side,                 // 玩家：0 红 1 黑；观战：-1
    status: room.status,
    turn: room.turn,
    perMove: room.perMove,
    spectators: room.specs.size,
    names: [
      room.players[0] ? room.players[0].name : '等待中',
      room.players[1] ? room.players[1].name : '等待中'
    ],
    connected: [
      room.players[0] ? !!room.players[0].connected : false,
      room.players[1] ? !!room.players[1].connected : false
    ],
    result: room.result
  };
}

function syncPayload(room) {
  return {
    history: room.history.map(function (m) { return [m.f, m.t]; }),
    turn: room.turn,
    status: room.status,
    result: room.result,
    perMove: room.perMove,
    deadline: room.deadline,
    now: Date.now(),
    spectatorCount: room.specs.size,
    names: [
      room.players[0] ? room.players[0].name : '等待中',
      room.players[1] ? room.players[1].name : '等待中'
    ]
  };
}

function broadcast(room, ev, data) {
  io.to(room.code).emit(ev, data);
}

function pushRoom(room) {
  for (let s = 0; s < 2; s++) {
    const p = room.players[s];
    if (p && p.sid) io.to(p.sid).emit('room', roomInfo(room, 'player', s));
  }
  for (const [sid] of room.specs) {
    io.to(sid).emit('room', roomInfo(room, 'spectator', -1));
  }
}

function pushSync(room) {
  broadcast(room, 'sync', syncPayload(room));
  pushRoom(room);
}

function endGame(room, result) {
  if (room.status === 'ended') return;
  room.status = 'ended';
  room.result = result;
  room.deadline = 0;
  room.drawVotes = [false, false];
  room.rematchVotes = [false, false];

  // 落库：对局历史 + 战绩/ELO（仅联机、且双方都有邮箱时记分）
  persistGame(room, result);

  broadcast(room, 'end', result);
  pushRoom(room);
}

/* 对局结束落库（联机对战）。人机对局由客户端各自记录，不走这里。 */
function persistGame(room, result) {
  try {
    if (room.persisted) return;
    const p0 = room.players[0], p1 = room.players[1];
    if (!p0 || !p1) return;
    const moves = room.history.map(function (m) { return [m.f, m.t]; });
    const notation = room.history.map(function (m) { return m.not || ''; }).filter(Boolean);
    const winner = result ? result.winner : -1;

    // 只要有一方登录就记对局历史；ELO 只在双方都登录时记分
    if (p0.email || p1.email) {
      DB.recordGame({
        mode: 'online',
        redEmail: p0.email || null,
        blackEmail: p1.email || null,
        redName: p0.name,
        blackName: p1.name,
        winner: winner,
        reason: result ? result.reason : '',
        moves: moves,
        notation: notation,
        perMove: room.perMove
      });
      room.persisted = true;
    }
  } catch (e) {
    console.error('[落库失败]', e && e.message);
  }
}

/* ---------------- 座位管理 ---------------- */
function seatPlayer(room, side, name, socket, email) {
  const token = crypto.randomUUID();
  const player = { token: token, name: name, sid: socket.id, connected: true, email: email || null };
  room.players[side] = player;
  tokenIndex.set(token, room.code);
  socket.join(room.code);
  socket.data.room = room.code;
  socket.data.side = side;
  socket.data.role = 'player';
  socket.data.token = token;
  socket.data.name = name;
  socket.data.email = email || null;
  return player;
}

function clearGrace(room, side) {
  if (room.graceTimers[side]) {
    clearTimeout(room.graceTimers[side]);
    room.graceTimers[side] = null;
  }
}

/* 从 payload 的 authToken 解析登录用户邮箱（游客返回 null） */
function authEmail(payload) {
  if (!payload || !payload.authToken) return null;
  const user = AUTH.verifyToken(payload.authToken);
  if (!user) return null;
  const full = DB.getUserById(user.id);
  return full ? full.email : null;
}

function startMatch(room) {
  room.status = 'playing';
  room.result = null;
  room.history = [];
  room.drawVotes = [false, false];
  room.rematchVotes = [false, false];
  room.persisted = false;
  room.updatedAt = Date.now();
  replay(room);
  refreshDeadline(room);
  pushSync(room);
}

/* ---------------- 事件限流 ---------------- */
function allow(socket, key, limit, windowMs) {
  const now = Date.now();
  const bag = socket.data.rl || (socket.data.rl = {});
  const rec = bag[key] || (bag[key] = { t: now, n: 0 });
  if (now - rec.t > windowMs) { rec.t = now; rec.n = 0; }
  rec.n++;
  return rec.n <= limit;
}

/* ---------------- Socket ---------------- */
io.on('connection', function (socket) {
  socket.data.rl = {};

  // 解析会话用户：优先 handshake.auth.token，兼容 payload.authToken
  function sessionUser(payload) {
    const token = (socket.handshake.auth && socket.handshake.auth.token) || (payload && payload.authToken);
    if (!token) return null;
    const u = AUTH.verifyToken(token);
    if (!u) return null;
    return DB.getUserById(u.id) || null;
  }
  // 门禁：要求登录
  function needLogin(cb, payload) {
    if (!REQUIRE_LOGIN) return true;
    if (sessionUser(payload)) return true;
    fail(cb, '请先登录后再开始对局');
    return false;
  }
  function fail(cb, msg) { if (cb) cb({ ok: false, msg: msg }); }
  function roomOf() { return rooms.get(socket.data.room); }
  function me(room) {
    return room && socket.data.role === 'player' ? room.players[socket.data.side] : null;
  }

  /* 创建房间 */
  socket.on('create', function (payload, cb) {
    if (!needLogin(cb, payload)) return;
    if (!allow(socket, 'ops', 10, 10000)) return fail(cb, '操作太频繁，请稍后再试');
    if (rooms.size >= MAX_ROOMS) return fail(cb, '服务器房间已满，请稍后再试');
    const p = payload || {};
    let perMove = parseInt(p.perMove, 10);
    if (!(perMove >= 0 && perMove <= 600)) perMove = DEFAULT_PER_MOVE;
    const room = createRoom(perMove);
    const name = normName(p.name, '红方');
    const email = authEmail(p);
    seatPlayer(room, 0, name, socket, email);
    cb && cb({ ok: true, code: room.code, side: 0, token: room.players[0].token, perMove: room.perMove });
    pushRoom(room);
  });

  /* 加入房间（满员则转观战） */
  socket.on('join', function (payload, cb) {
    if (!needLogin(cb, payload)) return;
    if (!allow(socket, 'ops', 15, 10000)) return fail(cb, '操作太频繁，请稍后再试');
    const p = payload || {};
    const code = String(p.code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return fail(cb, '房间不存在，请检查房间号');

    // 同一设备重复加入：回到原座位
    if (p.token) {
      const side = room.players[0] && room.players[0].token === p.token ? 0
        : (room.players[1] && room.players[1].token === p.token ? 1 : -1);
      if (side >= 0) return resumeInto(socket, room, side, cb);
    }

    const free = room.players[0] ? (room.players[1] ? -1 : 1) : 0;
    if (free < 0 || room.status === 'playing' || room.status === 'ended') {
      // 观战
      if (room.specs.size >= 50) return fail(cb, '观战人数已满');
      const name = normName(p.name, '观众');
      room.specs.set(socket.id, { name: name });
      socket.join(room.code);
      socket.data.room = room.code;
      socket.data.role = 'spectator';
      socket.data.side = -1;
      socket.data.name = name;
      cb && cb({ ok: true, spectate: true, code: room.code, side: -1 });
      pushRoom(room);
      broadcast(room, 'chat', { sys: true, text: name + ' 进入观战' });
      return;
    }

    const name = normName(p.name, free === 0 ? '红方' : '黑方');
    seatPlayer(room, free, name, socket, authEmail(p));
    cb && cb({ ok: true, code: room.code, side: free, token: room.players[free].token });
    if (room.players[0] && room.players[1]) startMatch(room);
    else pushRoom(room);
    broadcast(room, 'chat', { sys: true, text: name + ' 进入房间' });
  });

  /* 快速匹配 */
  socket.on('quick', function (payload, cb) {
    if (!needLogin(cb, payload)) return;
    if (!allow(socket, 'ops', 15, 10000)) return fail(cb, '操作太频繁，请稍后再试');
    const p = payload || {};
    let perMove = parseInt(p.perMove, 10);
    if (!(perMove >= 0 && perMove <= 600)) perMove = DEFAULT_PER_MOVE;
    const name = normName(p.name, '黑方');

    for (const room of rooms.values()) {
      if (room.status === 'waiting' && room.players[0] && !room.players[1]) {
        seatPlayer(room, 1, name, socket, authEmail(p));
        cb && cb({ ok: true, code: room.code, side: 1, token: room.players[1].token });
        startMatch(room);
        broadcast(room, 'chat', { sys: true, text: name + ' 加入对局' });
        return;
      }
    }
    const room = createRoom(perMove);
    seatPlayer(room, 0, normName(p.name, '红方'), socket, authEmail(p));
    cb && cb({ ok: true, code: room.code, side: 0, token: room.players[0].token, waiting: true });
    pushRoom(room);
  });

  /* 断线重连 */
  function resumeInto(sock, room, side, cb) {
    const player = room.players[side];
    if (!player) { if (cb) cb({ ok: false, msg: '座位已释放' }); return; }
    clearGrace(room, side);
    if (player.sid && player.sid !== sock.id) {
      const old = io.sockets.sockets.get(player.sid);
      if (old) { old.emit('kick', { msg: '账号在另一处重新连接' }); old.leave(room.code); }
    }
    player.sid = sock.id;
    player.connected = true;
    sock.join(room.code);
    sock.data.room = room.code;
    sock.data.side = side;
    sock.data.role = 'player';
    sock.data.token = player.token;
    sock.data.name = player.name;
    if (cb) cb({ ok: true, code: room.code, side: side, token: player.token, resumed: true });
    if (room.players[0] && room.players[1]) refreshDeadline(room);
    io.to(room.code).emit('opponent', {
      side: side, connected: true,
      text: player.name + ' 已重新连接'
    });
    pushSync(room);
  }

  socket.on('resume', function (payload, cb) {
    const p = payload || {};
    let room = p.code ? rooms.get(String(p.code).toUpperCase()) : null;
    if (!room && p.token) room = rooms.get(tokenIndex.get(p.token));
    if (!room) { if (cb) cb({ ok: false, msg: '房间已关闭' }); return; }
    let side = -1;
    for (let s = 0; s < 2; s++) {
      if (room.players[s] && p.token && room.players[s].token === p.token) { side = s; break; }
    }
    if (side < 0) { if (cb) cb({ ok: false, msg: '座位已被释放' }); return; }
    resumeInto(socket, room, side, cb);
  });

  /* 走子 */
  socket.on('move', function (payload) {
    if (!allow(socket, 'move', 30, 5000)) return;
    const room = roomOf();
    if (!room || socket.data.role !== 'player') return;
    if (room.status !== 'playing' || socket.data.side !== room.turn) return;
    const p = payload || {};
    const f = p.f | 0, t = p.t | 0;
    if (f < 0 || f > 89 || t < 0 || t > 89) return;

    const legal = XQ.genLegal(room.board, room.turn);
    let ok = false;
    for (let i = 0; i < legal.length; i++) if (legal[i][0] === f && legal[i][1] === t) { ok = true; break; }
    if (!ok) { socket.emit('msg', { text: '非法走法', kind: 'warn' }); return; }

    room.history.push({ f: f, t: t, cap: 0, not: '' });
    replay(room);
    room.updatedAt = Date.now();

    const last = room.history[room.history.length - 1];
    const chk = XQ.inCheck(room.board, room.turn);
    refreshDeadline(room);

    broadcast(room, 'move', {
      f: f, t: t,
      not: last.not,
      cap: last.cap || 0,
      turn: room.turn,
      check: chk,
      deadline: room.deadline,
      now: Date.now()
    });

    const res = judge(room);
    if (res) { endGame(room, res); return; }
    if (chk) broadcast(room, 'msg', { text: '将军！', kind: 'check' });
    pushRoom(room);
  });

  /* 认输 */
  socket.on('resign', function () {
    const room = roomOf();
    if (!room || socket.data.role !== 'player' || room.status !== 'playing') return;
    endGame(room, { winner: 1 - socket.data.side, reason: '对手认输' });
  });

  /* 求和 */
  socket.on('draw-offer', function () {
    const room = roomOf();
    if (!room || socket.data.role !== 'player' || room.status !== 'playing') return;
    const side = socket.data.side;
    if (room.drawVotes[side]) return;
    if (room.drawVotes[1 - side]) { endGame(room, { winner: -1, reason: '双方议和' }); return; }
    room.drawVotes[side] = true;
    const other = room.players[1 - side];
    if (other && other.sid) io.to(other.sid).emit('draw-ask', { from: socket.data.name });
    socket.emit('msg', { text: '已发出求和请求', kind: '' });
  });

  socket.on('draw-reply', function (payload) {
    const room = roomOf();
    if (!room || socket.data.role !== 'player' || room.status !== 'playing') return;
    const accept = payload && payload.accept;
    if (accept) {
      endGame(room, { winner: -1, reason: '双方议和' });
    } else {
      room.drawVotes = [false, false];
      const other = room.players[1 - socket.data.side];
      if (other && other.sid) io.to(other.sid).emit('msg', { text: '对手拒绝了求和', kind: 'warn' });
    }
  });

  /* 悔棋 */
  socket.on('undo-request', function () {
    const room = roomOf();
    if (!room || socket.data.role !== 'player') return;
    if (room.status !== 'playing' || room.history.length < 1) return;
    const other = room.players[1 - socket.data.side];
    if (other && other.sid) io.to(other.sid).emit('undo-ask', { from: socket.data.name });
    socket.emit('msg', { text: '已发出悔棋请求', kind: '' });
  });

  socket.on('undo-reply', function (payload) {
    const room = roomOf();
    if (!room || socket.data.role !== 'player' || room.status !== 'playing') return;
    if (!(payload && payload.accept)) {
      const other = room.players[1 - socket.data.side];
      if (other && other.sid) io.to(other.sid).emit('msg', { text: '对手拒绝了悔棋', kind: 'warn' });
      return;
    }
    // 退到请求方上一次落子之前：通常退 2 手
    let steps = 0;
    while (steps < 2 && room.history.length > 0) { room.history.pop(); steps++; }
    replay(room);
    room.drawVotes = [false, false];
    refreshDeadline(room);
    broadcast(room, 'msg', { text: '已悔棋', kind: 'ok' });
    pushSync(room);
  });

  /* 再来一局：双方都同意后换先重开 */
  socket.on('rematch', function () {
    const room = roomOf();
    if (!room || socket.data.role !== 'player') return;
    if (room.status !== 'ended') return;
    const side = socket.data.side;
    if (!room.players[0] || !room.players[1]) {
      socket.emit('msg', { text: '对手已离开，无法重开', kind: 'warn' });
      return;
    }
    room.rematchVotes[side] = true;
    if (room.rematchVotes[0] && room.rematchVotes[1]) {
      // 换先：交换座位
      const a = room.players[0], b = room.players[1];
      room.players[0] = b; room.players[1] = a;
      for (let s = 0; s < 2; s++) {
        const pl = room.players[s];
        if (!pl) continue;
        pl.side = s;
        const sk = io.sockets.sockets.get(pl.sid);
        if (sk) { sk.data.side = s; sk.data.room = room.code; }
      }
      room.status = 'waiting';
      startMatch(room);
      broadcast(room, 'msg', { text: '新对局开始，双方交换先后手', kind: 'ok' });
      return;
    }
    const other = room.players[1 - side];
    if (other && other.sid) io.to(other.sid).emit('rematch-ask', { from: socket.data.name });
    socket.emit('msg', { text: '已请求再来一局，等待对手确认', kind: '' });
  });

  /* 聊天 */
  socket.on('chat', function (payload) {
    const room = roomOf();
    if (!room) return;
    if (!allow(socket, 'chat', 1, CHAT_COOLDOWN)) {
      socket.emit('msg', { text: '说慢一点…', kind: 'warn' });
      return;
    }
    const text = String((payload && payload.text) || '')
      .replace(/[\u0000-\u001f]/g, ' ')
      .trim().slice(0, 200);
    if (!text) return;
    const entry = {
      from: socket.data.name || '棋友',
      role: socket.data.role,
      side: socket.data.side,
      text: text,
      ts: Date.now()
    };
    room.chat.push(entry);
    if (room.chat.length > MAX_CHAT_KEEP) room.chat.shift();
    // 自己收到带回显标记，别人收到普通消息
    socket.emit('chat', Object.assign({ me: true }, entry));
    socket.to(room.code).emit('chat', entry);
  });

  /* 主动离开 */
  socket.on('leave', function () { detach(socket, true); });
  socket.on('disconnect', function () { detach(socket, false); });
});

/* 断开 / 离开处理 */
function detach(socket, explicit) {
  const room = rooms.get(socket.data.room);
  if (!room) return;

  if (socket.data.role === 'spectator') {
    if (room.specs.delete(socket.id)) pushRoom(room);
    return;
  }
  const side = socket.data.side;
  const player = room.players[side];
  if (!player || player.sid !== socket.id) return;

  if (explicit) {
    // 主动离开：直接让座，对局中判对手胜
    room.players[side] = null;
    tokenIndex.delete(player.token);
    if (room.status === 'playing') {
      endGame(room, { winner: 1 - side, reason: '对手离开对局' });
    }
    const other = room.players[1 - side];
    if (other && other.sid) io.to(other.sid).emit('opponent-left', { side: side, name: player.name });
    room.status = room.players[0] && room.players[1] ? room.status : 'waiting';
    if (!room.players[0] && !room.players[1]) {
      for (let s = 0; s < 2; s++) clearGrace(room, s);
      rooms.delete(room.code);
    } else {
      pushRoom(room);
    }
    return;
  }

  // 意外断开：保留座位，给宽限期重连
  player.connected = false;
  player.sid = null;
  refreshDeadline(room);
  const other = room.players[1 - side];
  if (other && other.sid) {
    io.to(other.sid).emit('opponent', {
      side: side, connected: false,
      text: player.name + ' 掉线了，等待重连…'
    });
  }
  pushRoom(room);

  clearGrace(room, side);
  room.graceTimers[side] = setTimeout(function () {
    if (!rooms.has(room.code)) return;
    const pl = room.players[side];
    if (!pl || pl.connected) return;
    room.players[side] = null;
    tokenIndex.delete(pl.token);
    if (room.status === 'playing') {
      endGame(room, { winner: 1 - side, reason: '对手掉线超时' });
    }
    const o = room.players[1 - side];
    if (o && o.sid) io.to(o.sid).emit('opponent-left', { side: side, name: pl.name });
    if (!room.players[0] && !room.players[1]) rooms.delete(room.code);
    else pushRoom(room);
  }, GRACE_MS);
}

/* 步时到点判负 */
setInterval(function () {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.status !== 'playing' || !room.deadline) continue;
    if (now <= room.deadline) continue;
    const loser = room.turn;
    endGame(room, { winner: 1 - loser, reason: '超时判负' });
  }
}, 500);

/* 定期清理空房与僵尸房间 */
setInterval(function () {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const empty = !room.players[0] && !room.players[1] && room.specs.size === 0;
    const idle = now - room.updatedAt > 6 * 3600 * 1000;
    const abandoned = room.status === 'waiting' && now - room.createdAt > 3600 * 1000 && !room.players[1];
    if (empty || idle || abandoned) {
      for (let s = 0; s < 2; s++) clearGrace(room, s);
      for (let s = 0; s < 2; s++) {
        const p = room.players[s];
        if (p) tokenIndex.delete(p.token);
      }
      rooms.delete(code);
    }
  }
}, 5 * 60 * 1000);

server.listen(PORT, HOST, function () {
  console.log('[象棋] 服务已启动: http://' + HOST + ':' + PORT +
    '  (NODE_ENV=' + NODE_ENV + ', 每步限时=' + DEFAULT_PER_MOVE + 's, 掉线宽限=' + (GRACE_MS / 1000) + 's)');
});

/* 优雅退出：部署重启不打断对局（下一次请求/重连会回到原座位） */
function shutdown(signal) {
  console.log('[象棋] 收到 ' + signal + '，正在关闭…');
  io.close();
  server.close(function () { process.exit(0); });
  setTimeout(function () { process.exit(0); }, 5000);
}
['SIGINT', 'SIGTERM'].forEach(function (s) { process.on(s, function () { shutdown(s); }); });

module.exports = { app: app, server: server, io: io, rooms: rooms };
