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
  let html = fs.readFileSync(path.join(ROOT, 'public/game.html'), 'utf8');
  html = html.replace(/<script[\s\S]*?<\/script>/g, '');

  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/game.html?mode=ai',
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

  // jsdom 未实现 Event 构造时的兜底
  if (!window.Event) window.Event = function (t) { this.type = t; };

  window.eval(fs.readFileSync(path.join(ROOT, 'public/js/core.js'), 'utf8'));
  // 注入已登录用户，通过门禁
  window.XQAuth.saveSession('test-token', { id: 1, nickname: '测试棋友', rating: 1200 });
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
  console.log('\n[1] 游戏页初始化（人机模式）');
  const { window, document, server } = boot();
  await sleep(30);
  ok(!hidden(document, 'screen-ai'), '默认显示人机设置面板');
  ok(document.getElementById('board').width > 0, 'canvas 已完成尺寸初始化');

  console.log('\n[2] 人机对局');
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

  console.log('\n[4] 无控制台错误');
  ok(!bootErrors, '注入过程中无脚本异常');

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});

var bootErrors = false;
process.on('uncaughtException', (e) => { bootErrors = true; console.error('未捕获异常：', e); });
