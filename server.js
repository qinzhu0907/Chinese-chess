const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const XQ = require('./shared/rules.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 30000,
  pingInterval: 25000,
  // 反向代理后（Nginx / Docker）也能正常工作
  cors: { origin: process.env.CORS_ORIGIN || false }
});

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use('/shared', express.static(path.join(__dirname, 'shared'), { maxAge: '1h' }));

// 健康检查：Nginx / Docker / 监控可直接探测
app.get('/healthz', (req, res) => {
  res.json({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) });
});

/* ---------------- 房间管理 ---------------- */
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const code = newCode();
  const room = {
    code,
    players: [null, null],   // 按阵营索引：0 红 1 黑
    history: [],             // {f,t,cap}
    turn: XQ.RED,
    status: 'waiting',       // waiting | playing | ended
    result: null,
    noCapture: 0,
    createdAt: Date.now()
  };
  rooms.set(code, room);
  return room;
}

function currentBoard(room) {
  const bd = XQ.initialBoard();
  for (const m of room.history) XQ.makeMove(bd, m.f, m.t);
  return bd;
}

function roomInfo(room, side) {
  return {
    code: room.code,
    side: side,
    status: room.status,
    turn: room.turn,
    names: [room.players[0] ? room.players[0].name : '等待中', room.players[1] ? room.players[1].name : '等待中'],
    result: room.result
  };
}

function pushRoom(room) {
  for (let s = 0; s < 2; s++) {
    const p = room.players[s];
    if (p) io.to(p.id).emit('room', roomInfo(room, s));
  }
}

function pushSync(room) {
  io.to(room.code).emit('sync', {
    history: room.history.map(m => [m.f, m.t]),
    turn: room.turn,
    status: room.status
  });
}

/* ---------------- Socket ---------------- */
io.on('connection', (socket) => {
  socket.on('create', ({ name } = {}, cb) => {
    const room = createRoom();
    room.players[0] = { id: socket.id, name: (name || '红方').slice(0, 12) };
    socket.join(room.code);
    socket.data.room = room.code;
    socket.data.side = 0;
    socket.data.name = room.players[0].name;
    cb && cb({ ok: true, code: room.code, side: 0 });
    pushRoom(room);
  });

  socket.on('join', ({ code, name } = {}, cb) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) { cb && cb({ ok: false, msg: '房间不存在，请检查房间号' }); return; }
    if (room.players[1] && room.players[1].id !== socket.id) { cb && cb({ ok: false, msg: '房间已满' }); return; }
    room.players[1] = { id: socket.id, name: (name || '黑方').slice(0, 12) };
    socket.join(room.code);
    socket.data.room = room.code;
    socket.data.side = 1;
    socket.data.name = room.players[1].name;
    room.status = 'playing';
    room.turn = XQ.RED;
    room.history = [];
    room.noCapture = 0;
    room.result = null;
    cb && cb({ ok: true, code: room.code, side: 1 });
    pushRoom(room);
    pushSync(room);
  });

  socket.on('quick', ({ name } = {}, cb) => {
    // 找一个只差一人的房间
    for (const room of rooms.values()) {
      if (room.status === 'waiting' && room.players[0] && !room.players[1] && room.players[0].id !== socket.id) {
        room.players[1] = { id: socket.id, name: (name || '黑方').slice(0, 12) };
        socket.join(room.code);
        socket.data.room = room.code;
        socket.data.side = 1;
        socket.data.name = room.players[1].name;
        room.status = 'playing';
        room.turn = XQ.RED;
        room.history = [];
        room.noCapture = 0;
        room.result = null;
        cb && cb({ ok: true, code: room.code, side: 1 });
        pushRoom(room);
        pushSync(room);
        return;
      }
    }
    const room = createRoom();
    room.players[0] = { id: socket.id, name: (name || '红方').slice(0, 12) };
    socket.join(room.code);
    socket.data.room = room.code;
    socket.data.side = 0;
    socket.data.name = room.players[0].name;
    cb && cb({ ok: true, code: room.code, side: 0, waiting: true });
    pushRoom(room);
  });

  socket.on('move', ({ f, t } = {}) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.status !== 'playing') return;
    if (socket.data.side !== room.turn) return;
    const bd = currentBoard(room);
    const legal = XQ.genLegal(bd, room.turn);
    const m = legal.find(x => x[0] === f && x[1] === t);
    if (!m) { socket.emit('msg', { text: '非法走法', kind: 'warn' }); return; }

    const cap = bd[t];
    room.history.push({ f, t, cap });
    room.noCapture = cap ? 0 : room.noCapture + 1;
    room.turn = 1 - room.turn;

    io.to(room.code).emit('move', { f, t, turn: room.turn });

    const nb = currentBoard(room);
    if (XQ.genLegal(nb, room.turn).length === 0) {
      room.status = 'ended';
      room.result = { winner: 1 - room.turn, reason: XQ.inCheck(nb, room.turn) ? '将死' : '困毙' };
      io.to(room.code).emit('end', room.result);
      pushRoom(room);
      return;
    }
    if (XQ.inCheck(nb, room.turn)) io.to(room.code).emit('msg', { text: '将军！', kind: 'check' });
    if (room.noCapture >= 120) {
      room.status = 'ended';
      room.result = { winner: -1, reason: '60 回合无吃子，判和' };
      io.to(room.code).emit('end', room.result);
      pushRoom(room);
    }
  });

  socket.on('resign', () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.status !== 'playing') return;
    room.status = 'ended';
    room.result = { winner: 1 - socket.data.side, reason: '对手认输' };
    io.to(room.code).emit('end', room.result);
    pushRoom(room);
  });

  socket.on('draw-offer', () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.status !== 'playing') return;
    const other = room.players[1 - socket.data.side];
    if (other) io.to(other.id).emit('draw-ask', { from: socket.data.name });
  });

  socket.on('draw-reply', ({ accept } = {}) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.status !== 'playing') return;
    if (accept) {
      room.status = 'ended';
      room.result = { winner: -1, reason: '双方议和' };
      io.to(room.code).emit('end', room.result);
      pushRoom(room);
    } else {
      const other = room.players[1 - socket.data.side];
      if (other) io.to(other.id).emit('msg', { text: '对手拒绝了求和', kind: 'warn' });
    }
  });

  socket.on('undo-request', () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.status !== 'playing' || !room.history.length) return;
    const other = room.players[1 - socket.data.side];
    if (other) io.to(other.id).emit('undo-ask', { from: socket.data.name });
  });

  socket.on('undo-reply', ({ accept } = {}) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.status !== 'playing') return;
    if (!accept) {
      const other = room.players[1 - socket.data.side];
      if (other) io.to(other.id).emit('msg', { text: '对手拒绝了悔棋', kind: 'warn' });
      return;
    }
    // 回退到请求方上一次走棋前：最多退两步
    const steps = room.history.length >= 2 ? 2 : 1;
    for (let i = 0; i < steps; i++) room.history.pop();
    room.turn = (room.turn + steps) % 2;
    room.noCapture = 0;
    pushSync(room);
    io.to(room.code).emit('msg', { text: '已悔棋', kind: 'ok' });
  });

  socket.on('restart', () => {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    const a = room.players[0], b = room.players[1];
    if (a && b) { room.players[0] = b; room.players[1] = a; } // 换先
    if (room.players[0]) room.players[0].__s = 0;
    room.history = [];
    room.turn = XQ.RED;
    room.noCapture = 0;
    room.result = null;
    room.status = room.players[0] && room.players[1] ? 'playing' : 'waiting';
    // 更新每个连接的阵营
    for (let s = 0; s < 2; s++) {
      const p = room.players[s];
      if (!p) continue;
      const sk = io.sockets.sockets.get(p.id);
      if (sk) { sk.data.side = s; sk.data.room = room.code; }
    }
    pushRoom(room);
    pushSync(room);
  });

  socket.on('leave', () => handleLeave(socket));
  socket.on('disconnect', () => handleLeave(socket));
});

function handleLeave(socket) {
  const room = rooms.get(socket.data.room);
  if (!room) return;
  const side = socket.data.side;
  if (room.players[side] && room.players[side].id === socket.id) {
    room.players[side] = null;
    const other = room.players[1 - side];
    if (other) {
      io.to(other.id).emit('opponent-left', { side });
      if (room.status === 'playing') {
        room.status = 'ended';
        room.result = { winner: 1 - side, reason: '对手离开对局' };
        io.to(other.id).emit('end', room.result);
      }
    }
    if (!room.players[0] && !room.players[1]) rooms.delete(room.code);
  }
}

/* 定期清理空房 / 长时间无人房间 */
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const empty = !room.players[0] && !room.players[1];
    const idle = (now - room.createdAt > 6 * 3600 * 1000);
    if (empty || idle) rooms.delete(code);
  }
}, 10 * 60 * 1000);

server.listen(PORT, HOST, () => {
  console.log(`[象棋] 服务已启动: http://${HOST}:${PORT}  (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
});

/* 优雅退出：关闭连接后再退出，避免部署时中断对局 */
function shutdown(signal) {
  console.log(`[象棋] 收到 ${signal}，正在关闭…`);
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
}
['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => shutdown(s)));
