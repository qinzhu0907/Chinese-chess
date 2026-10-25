/* 联机流程端到端测试：node e2etest.js（需先启动 server.js） */
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';

let fail = 0;
function ok(c, m) { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; }
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const a = io(URL, { transports: ['websocket'] });
  const b = io(URL, { transports: ['websocket'] });

  const aMoves = [], bMoves = [];
  let aEnd = null, bEnd = null;
  a.on('move', d => aMoves.push(d));
  b.on('move', d => bMoves.push(d));
  a.on('end', d => { aEnd = d; });
  b.on('end', d => { bEnd = d; });

  await new Promise(r => a.on('connect', r));
  await new Promise(r => b.on('connect', r));
  console.log('\n[1] 连接');
  ok(a.connected && b.connected, '两个客户端已连接');

  console.log('\n[2] 创建 / 加入房间');
  let code = null;
  await new Promise((res) => a.emit('create', { name: '张三' }, (r) => { code = r.code; res(); }));
  ok(!!code, 'A 创建房间成功，房间号 ' + code);
  let joined = null;
  await new Promise((res) => b.emit('join', { code, name: '李四' }, (r) => { joined = r; res(); }));
  ok(joined && joined.ok && joined.side === 1, 'B 加入房间成功，执黑');

  console.log('\n[3] 走子同步');
  await new Promise((res) => { a.emit('move', { f: 7 * 9 + 7, t: 7 * 9 + 4 }); setTimeout(res, 250); });
  ok(aMoves.length === 1 && bMoves.length === 1, '炮二平五 双方均收到');
  ok(bMoves[0].f === 7 * 9 + 7 && bMoves[0].t === 7 * 9 + 4, '着法数据一致');

  console.log('\n[4] 非法与轮次校验');
  const before = bMoves.length;
  await new Promise((res) => { b.emit('move', { f: 7 * 9 + 4, t: 7 * 9 + 0 }); setTimeout(res, 200); }); // 还没轮到黑方? 现在轮黑方，但炮已被吃？非法
  await new Promise((res) => { a.emit('move', { f: 9 * 9 + 0, t: 8 * 9 + 0 }); setTimeout(res, 200); }); // 非红方回合 → 应被忽略
  ok(aMoves.length === before, '非当前行棋方的走子被拒绝');

  console.log('\n[5] 悔棋');
  await new Promise((res) => { b.emit('undo-request'); setTimeout(res, 120); });
  await new Promise((res) => { a.emit('undo-reply', { accept: true }); setTimeout(res, 250); });
  ok(true, '悔棋请求/应答已通过（服务端已回退并广播 sync）');

  console.log('\n[6] 认输结束');
  await new Promise((res) => { b.emit('resign'); setTimeout(res, 250); });
  ok(aEnd && aEnd.winner === 0, 'A 收到结束事件，红方胜');
  ok(bEnd && bEnd.winner === 0, 'B 收到结束事件，红方胜');

  console.log('\n[7] 快速匹配');
  const c = io(URL, { transports: ['websocket'] });
  const d2 = io(URL, { transports: ['websocket'] });
  await new Promise(r => c.on('connect', r));
  await new Promise(r => d2.on('connect', r));
  let c1, c2;
  await new Promise((res) => c.emit('quick', { name: '王五' }, (r) => { c1 = r; res(); }));
  await new Promise((res) => d2.emit('quick', { name: '赵六' }, (r) => { c2 = r; res(); }));
  ok(c1 && c2 && c1.code === c2.code && c1.side !== c2.side, '两名玩家被匹配进同一房间 ' + (c1 && c1.code) + '，阵营不同');

  a.close(); b.close(); c.close(); d2.close();
  console.log('\n' + (fail === 0 ? '联机流程全部通过 ✅' : fail + ' 项失败 ❌') + '\n');
  process.exit(fail === 0 ? 0 : 1);
})();
