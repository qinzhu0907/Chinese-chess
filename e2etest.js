/* 联机流程端到端测试：node e2etest.js（需先启动 server.js）
 * 覆盖：建房/加入、走子同步、非法与轮次、聊天、观战、悔棋、
 *       断线重连、认输、快速匹配、再来一局、步时超时、统计接口
 */
const { io } = require('socket.io-client');
const PORT = process.env.PORT || 3000;
const URL = 'http://localhost:' + PORT;

let fail = 0;
function ok(c, m) { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; }
const wait = (ms) => new Promise(r => setTimeout(r, ms));

let AUTH_TOKEN = '';
function connect(withAuth = true) {
  const s = io(URL, {
    transports: ['websocket'], forceNew: true,
    auth: withAuth ? { token: AUTH_TOKEN } : {}
  });
  return new Promise((res) => s.on('connect', () => res(s)));
}
function call(sock, ev, payload) {
  return new Promise((res) => sock.emit(ev, payload, res));
}

(async () => {
  console.log('\n[0] 健康检查与统计');
  const health = await fetch(URL + '/healthz').then(r => r.json());
  ok(health.ok === true, '/healthz 正常：' + JSON.stringify(health));
  const stats = await fetch(URL + '/api/stats').then(r => r.json());
  ok(typeof stats.online === 'number' && Array.isArray(stats.waitingRooms), '/api/stats 返回结构正确');

  console.log('\n[0.5] 登录门禁');
  const login = await fetch(URL + '/api/auth/test-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  }).then(r => r.json()).catch(() => ({}));
  ok(login.ok && login.token, '测试账号登录成功，拿到会话 token');
  AUTH_TOKEN = login.token || '';
  const anon = await connect(false);
  const anonRes = await call(anon, 'create', { name: '游客', perMove: 60 });
  ok(anonRes && anonRes.ok === false && /登录/.test(anonRes.msg || ''), '未登录无法建房：' + (anonRes && anonRes.msg));
  anon.close();

  console.log('\n[1] 创建 / 加入房间');
  const a = await connect();
  const b = await connect();
  const aMoves = [], bMoves = [];
  let aEnd = null, bEnd = null;
  a.on('move', d => aMoves.push(d));
  b.on('move', d => bMoves.push(d));
  a.on('end', d => { aEnd = d; });
  b.on('end', d => { bEnd = d; });

  const created = await call(a, 'create', { name: '张三', perMove: 60 });
  ok(created.ok && created.code && created.token, 'A 创建房间 ' + created.code + '（拿到 token）');
  const code = created.code;

  const joined = await call(b, 'join', { code, name: '李四' });
  ok(joined.ok && joined.side === 1, 'B 加入房间，执黑');

  console.log('\n[2] 走子同步');
  const CHAT = [];
  a.on('chat', m => CHAT.push(m));
  await new Promise(res => { a.emit('move', { f: 7 * 9 + 7, t: 7 * 9 + 4 }); setTimeout(res, 200); });
  ok(aMoves.length === 1 && bMoves.length === 1, '炮二平五 双方均收到');
  ok(bMoves[0].not === '炮二平五', '服务端回传记谱：' + bMoves[0].not);
  ok(bMoves[0].turn === 1, '走子后轮到黑方');
  ok(typeof bMoves[0].deadline === 'number' && bMoves[0].deadline > Date.now(), '收到步时截止时间');

  console.log('\n[3] 非法与轮次校验');
  const before = bMoves.length;
  await new Promise(res => { a.emit('move', { f: 9 * 9 + 0, t: 8 * 9 + 0 }); setTimeout(res, 150); }); // 非红方回合
  await new Promise(res => { b.emit('move', { f: 0, t: 1 }); setTimeout(res, 150); });              // 黑车乱走，非法
  ok(aMoves.length === before && bMoves.length === before, '非法走法与非本回合走子均被拒绝');

  console.log('\n[4] 聊天');
  await new Promise(res => { a.emit('chat', { text: '你好，来一局' }); setTimeout(res, 200); });
  const mine = CHAT.filter(m => m.me);
  ok(mine.length === 1 && mine[0].text === '你好，来一局', '发送方收到带 me 标记的回显');
  let seenByB = null;
  b.on('chat', m => { seenByB = m; });
  await wait(800);   // 服务端有 700ms 发言冷却
  await new Promise(res => { a.emit('chat', { text: '准备好了吗' }); setTimeout(res, 250); });
  ok(seenByB && seenByB.text === '准备好了吗' && !seenByB.me, '对手收到普通消息');

  console.log('\n[5] 观战');
  const c = await connect();
  let cRoom = null, cMoves = 0;
  c.on('room', r => { cRoom = r; });
  c.on('move', () => cMoves++);
  const spec = await call(c, 'join', { code, name: '观众甲' });
  ok(spec.ok && spec.spectate === true && spec.side === -1, '房间满员时第三人进入观战');
  await wait(120);
  ok(cRoom && cRoom.role === 'spectator' && cRoom.spectators >= 1, '观战者收到房间信息（人数 ' + (cRoom && cRoom.spectators) + '）');
  const specMovesBefore = cMoves;
  await new Promise(res => { b.emit('move', { f: 0 * 9 + 7, t: 2 * 9 + 6 }); setTimeout(res, 200); }); // 马8进7
  ok(cMoves === specMovesBefore + 1, '观战者能收到走子广播');
  const specMoveCount = cMoves;
  await new Promise(res => { c.emit('move', { f: 9 * 9 + 0, t: 8 * 9 + 0 }); setTimeout(res, 150); });
  ok(cMoves === specMoveCount, '观战者无法走子');

  console.log('\n[6] 悔棋');
  let syncCount = 0;
  b.on('sync', () => syncCount++);
  await new Promise(res => { b.emit('undo-request'); setTimeout(res, 120); });
  await new Promise(res => { a.emit('undo-reply', { accept: true }); setTimeout(res, 250); });
  ok(syncCount >= 1, '同意悔棋后广播 sync 重同步局面');

  console.log('\n[7] 断线重连');
  let reconnected = null;
  a.on('opponent', d => { if (d.connected) reconnected = d; });
  b.close();
  await wait(300);
  const b2 = await connect();
  const b2Room = [];
  b2.on('room', r => b2Room.push(r));
  const resumed = await call(b2, 'resume', { code, token: joined.token });
  ok(resumed.ok && resumed.side === 1, 'B 掉线后用 token 重连成功，回到黑方座位');
  await wait(200);
  ok(reconnected !== null, 'A 收到对手重新连接通知');
  ok(b2Room.length > 0, 'B 重连后收到房间状态');

  console.log('\n[8] 认输结束');
  await new Promise(res => { b2.emit('resign'); setTimeout(res, 250); });
  ok(aEnd && aEnd.winner === 0, 'A 收到结束事件：红方胜（' + (aEnd && aEnd.reason) + '）');
  ok(bEnd === null || bEnd.winner === 0, 'B 侧结束事件一致');
  let b2End = null;
  b2.on('end', d => { b2End = d; });
  await wait(50);

  console.log('\n[9] 再来一局（双方同意后换先）');
  const rematchEvents = [];
  a.on('room', r => { if (r.status === 'playing') rematchEvents.push(r); });
  a.emit('rematch');
  await wait(120);
  b2.emit('rematch');
  await wait(300);
  ok(rematchEvents.length > 0, '双方同意后新对局开始');
  if (rematchEvents.length) {
    const last = rematchEvents[rematchEvents.length - 1];
    ok(last.turn === 0 && last.status === 'playing', '新对局重新从红方开始');
  }

  console.log('\n[10] 快速匹配');
  const d1 = await connect();
  const d2 = await connect();
  const q1 = await call(d1, 'quick', { name: '王五', perMove: 60 });
  const q2 = await call(d2, 'quick', { name: '赵六', perMove: 60 });
  ok(q1.ok && q2.ok && q1.code === q2.code && q1.side !== q2.side,
    '两人被匹配进同一房间 ' + q1.code + '，阵营不同');

  console.log('\n[11] 步时超时判负');
  const e1 = await connect();
  const e2 = await connect();
  let e1End = null, e2End = null;
  e1.on('end', d => { e1End = d; });
  e2.on('end', d => { e2End = d; });
  const tc = await call(e1, 'create', { name: '快棋甲', perMove: 1 });
  await call(e2, 'join', { code: tc.code, name: '快棋乙' });
  await wait(1600);
  ok(e1End && e1End.reason === '超时判负', '超时判负触发：' + (e1End && e1End.reason));
  ok(e2End && e2End.winner === 1, '黑方（未超时方）获胜');

  // 清理
  [a, b2, c, d1, d2, e1, e2].forEach(s => { try { s.close(); } catch (e) {} });
  await wait(200);

  console.log('\n' + (fail === 0 ? '联机流程全部通过 ✅' : fail + ' 项失败 ❌') + '\n');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});
