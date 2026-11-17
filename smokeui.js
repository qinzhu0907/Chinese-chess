/* 前端冒烟测试：用 jsdom 真实渲染 index.html，注入桩 canvas / socket / Worker，
 * 跑通「人机对局」「联机建房走子」「聊天」「认输」「观战」五条链路。
 * 运行：node smokeui.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = __dirname;
const XQ = require('./shared/rules.js');
const XQAI = require('./shared/ai.js');
const XQBOOK = require('./shared/opening.js');

const BW = 572, BH = 634, M = 38, CELL = 62;

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- canvas 上下文桩 ---------- */
function makeCtx() {
  const base = {
    canvas: { width: BW, height: BH },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    measureText() { return { width: 10 }; }
  };
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      return function () {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

/* ---------- 模拟服务端 ---------- */
function makeServer() {
  const st = {
    listeners: {},
    log: [],
    board: XQ.initialBoard(),
    turn: XQ.RED,
    history: [],
    code: 'ABCDE',
    perMove: 60
  };

  const sock = {
    on(ev, fn) { (st.listeners[ev] = st.listeners[ev] || []).push(fn); },
    fire(ev, data) { (st.listeners[ev] || []).forEach((fn) => fn(data)); },
    emit(ev, payload, cb) {
      st.log.push(ev);
      const p = payload || {};
      if (ev === 'create' || ev === 'quick') {
        const info = {
          code: st.code, role: 'player', side: 0, status: 'playing',
          turn: XQ.RED, perMove: st.perMove, spectators: 0,
          names: ['棋友', '对手'], connected: [true, true], result: null
        };
        cb && cb({ ok: true, code: st.code, side: 0, token: 'tok-red', perMove: st.perMove });
        sock.fire('room', info);
        sock.fire('sync', { history: [], turn: 0, status: 'playing', perMove: st.perMove, deadline: Date.now() + 60000, now: Date.now(), names: ['棋友', '对手'] });
        return;
      }
      if (ev === 'join') {
        const info = {
          code: p.code || st.code, role: 'spectator', side: -1, status: 'playing',
          turn: XQ.RED, perMove: st.perMove, spectators: 1,
          names: ['棋友', '对手'], connected: [true, true], result: null
        };
        cb && cb({ ok: true, code: info.code, side: -1, spectate: true });
        sock.fire('room', info);
        return;
      }
      if (ev === 'move') {
        const legal = XQ.genLegal(st.board, st.turn);
        const found = legal.some((m) => m[0] === p.f && m[1] === p.t);
        if (!found) { sock.fire('msg', { text: '非法走法', kind: 'warn' }); return; }
        XQ.makeMove(st.board, p.f, p.t);
        st.history.push([p.f, p.t]);
        st.turn = 1 - st.turn;
        sock.fire('move', {
          f: p.f, t: p.t, turn: st.turn, check: XQ.inCheck(st.board, st.turn),
          deadline: Date.now() + 60000, now: Date.now()
        });
        return;
      }
      if (ev === 'chat') {
        sock.fire('chat', { from: '棋友', text: p.text, me: true, ts: Date.now() });
        return;
      }
      if (ev === 'resign') {
        sock.fire('end', { winner: 1, reason: '对手认输' });
        return;
      }
      if (ev === 'leave' || ev === 'rematch' || ev === 'undo-request' || ev === 'draw-offer') return;
    }
  };

  return { sock, st };
}

/* ---------- 启动环境 ---------- */
function boot() {
  let html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  html = html.replace(/<script[\s\S]*?<\/script>/g, '');

  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/',
    pretendToBeVisual: true,
    runScripts: 'outside-only'
  });
  const { window } = dom;

  // canvas
  window.HTMLCanvasElement.prototype.getContext = function () { return makeCtx(); };
  window.HTMLCanvasElement.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: BW, height: BH, right: BW, bottom: BH };
  };

  window.XQ = XQ;
  window.XQAI = XQAI;
  window.XQBOOK = XQBOOK;

  const server = makeServer();
  window.io = function () { return server.sock; };

  // Worker：同步跑真引擎，验证 worker 消息链路
  window.Worker = class {
    constructor() { this.onmessage = null; this.onerror = null; }
    postMessage(d) {
      setTimeout(() => {
        try {
          const res = XQAI.search(Int8Array.from(d.board), d.side, { maxDepth: 3, timeMs: 300 });
          if (this.onmessage) {
            this.onmessage({ data: { id: d.id, move: res.move, score: res.score, depth: res.depth } });
          }
        } catch (e) { if (this.onerror) this.onerror(e); }
      }, 0);
    }
    terminate() {}
  };

  window.fetch = function (url) {
    let data = { online: 3, playing: 1, rooms: 2, waitingRooms: [{ code: 'ZZTOP', host: '小明' }] };
    if (String(url).indexOf('/api/leaderboard') >= 0) {
      data = { ok: true, list: [{ id: 1, nickname: '棋圣', rating: 1800, rank: '大师', rankIcon: '👑', rankColor: '#b0392b' }] };
    } else if (String(url).indexOf('/api/games') >= 0) {
      data = { ok: true, games: [] };
    }
    return Promise.resolve({ json: () => Promise.resolve(data) });
  };

  // 登录态桩：smokeui 只加载 app.js，注入已登录用户以通过门禁
  window.XQAccount = {
    auth: { user: { id: 1, nickname: '测试棋友', rating: 1200 }, token: 'test-token' },
    getToken: () => 'test-token',
    requireLogin: () => true,
    setScreen: () => {}
  };
  // jsdom 未实现 Event 构造时的兜底
  if (!window.Event) window.Event = function (t) { this.type = t; };

  window.eval(fs.readFileSync(path.join(ROOT, 'public/js/sound.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8'));

  return { window, document: window.document, server };
}

function tapSquare(window, document, r, c) {
  const x = M + c * CELL, y = M + r * CELL;
  const ev = new window.MouseEvent('click', { clientX: x, clientY: y, bubbles: true });
  document.getElementById('board').dispatchEvent(ev);
}

function hidden(document, id) {
  return document.getElementById(id).classList.contains('hidden');
}

(async function main() {
  console.log('\n[1] 初始化与大厅');
  const { window, document, server } = boot();
  await sleep(30);
  ok(!hidden(document, 'screen-home'), '默认显示大厅');
  ok(document.getElementById('board').width > 0, 'canvas 已完成尺寸初始化');
  ok(document.getElementById('homeStats').textContent.indexOf('在线') >= 0, '首页读取到服务器状态：' + document.getElementById('homeStats').textContent);

  console.log('\n[2] 人机对局');
  document.getElementById('goAi').click();
  ok(!hidden(document, 'screen-ai'), '进入人机设置');
  document.getElementById('startAi').click();
  await sleep(20);
  ok(!hidden(document, 'screen-game'), '进入对局界面');
  ok(document.getElementById('turnChip').textContent.indexOf('红方') >= 0, '轮次提示：' + document.getElementById('turnChip').textContent);

  tapSquare(window, document, 6, 0);   // 选中红兵
  tapSquare(window, document, 5, 0);   // 前进一格
  await sleep(500);                    // 等 AI 应着
  const moveRows = document.querySelectorAll('#moveList .row').length;
  ok(moveRows >= 1, '棋谱已生成 ' + moveRows + ' 行（含 AI 应着）');
  ok(document.getElementById('moveCount').textContent.indexOf('回合') >= 0, '回合计数：' + document.getElementById('moveCount').textContent);

  console.log('\n[3] 认输与结果横幅');
  document.getElementById('btnResign').click();
  await sleep(10);
  ok(!hidden(document, 'askBar'), '弹出确认条');
  document.getElementById('askYes').click();
  await sleep(20);
  ok(!hidden(document, 'banner'), '对局结束显示横幅：' + document.getElementById('bannerTitle').textContent + ' / ' + document.getElementById('bannerSub').textContent);
  ok(!hidden(document, 'btnAgain'), '结束后出现「再来一局」');

  console.log('\n[4] 联机：建房 / 走子 / 聊天');
  document.getElementById('btnHome').click();
  await sleep(10);
  document.getElementById('goOnline').click();
  await sleep(20);
  ok(!hidden(document, 'screen-online'), '进入联机面板');
  document.getElementById('btnCreate').click();
  server.sock.fire('connect');
  await sleep(30);
  ok(!hidden(document, 'screen-game'), '创建房间后进入对局');
  ok(document.getElementById('roomCode').textContent === 'ABCDE', '房间号显示正确');
  ok(document.getElementById('roomBadge').textContent.indexOf('ABCDE') >= 0, '顶栏显示房间徽标');

  tapSquare(window, document, 7, 1);   // 红炮
  tapSquare(window, document, 7, 4);   // 炮二平五
  await sleep(30);
  ok(document.querySelectorAll('#moveList .row').length === 1, '自己走子后棋谱 1 行');
  ok(document.getElementById('moveCount').textContent === '1 回合', '回合计数 1');

  // 对手走子
  server.sock.fire('move', { f: 7, t: 24, turn: 0, check: false, deadline: Date.now() + 60000, now: Date.now() });
  await sleep(20);
  ok(document.getElementById('moveCount').textContent === '1 回合', '对手应着后仍是第 1 回合');
  ok(document.querySelectorAll('#moveList .row .b')[0].textContent.length > 0, '黑方着法已填入：' + document.querySelectorAll('#moveList .row .b')[0].textContent);

  // 聊天
  document.querySelectorAll('.tab')[1].click();
  ok(!hidden(document, 'paneChat'), '切到聊天页签');
  document.getElementById('chatInput').value = '你好，来一局';
  document.getElementById('chatForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(20);
  ok(document.querySelectorAll('#chatList .chat-item').length === 1, '聊天消息已渲染');
  ok(document.querySelectorAll('#chatList .chat-item')[0].classList.contains('me'), '自己的消息有高亮标记');

  console.log('\n[5] 观战模式');
  server.sock.fire('room', {
    code: 'ABCDE', role: 'spectator', side: -1, status: 'playing',
    turn: XQ.RED, perMove: 60, spectators: 2,
    names: ['棋友', '对手'], connected: [true, true], result: null
  });
  await sleep(10);
  ok(!hidden(document, 'specNote'), '显示「观战中」标记');
  const before = document.querySelectorAll('#moveList .row').length;
  tapSquare(window, document, 9, 0);
  tapSquare(window, document, 8, 0);
  await sleep(20);
  ok(document.querySelectorAll('#moveList .row').length === before, '观战者无法走子');
  ok(document.getElementById('btnResign').disabled, '观战时操作按钮禁用');

  console.log('\n[6] 对局结束事件');
  server.sock.fire('end', { winner: 0, reason: '将死' });
  await sleep(20);
  ok(!hidden(document, 'banner'), '收到结束事件显示横幅');

  console.log('\n[7] 无控制台错误');
  ok(!bootErrors, '注入过程中无脚本异常');

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});

var bootErrors = false;
process.on('uncaughtException', (e) => { bootErrors = true; console.error('未捕获异常：', e); });
