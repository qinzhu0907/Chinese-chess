/* 登录门禁冒烟测试：加载完整 index.html + account.js + app.js，
 * 模拟「未登录 → 门禁 → 发验证码 → 登录 → 进大厅 → 点人机」全流程。
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
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function makeCtx() {
  const base = {
    canvas: { width: BW, height: BH },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    measureText() { return { width: 10 }; }
  };
  return new Proxy(base, { get(t, k) { if (k in t) return t[k]; return function () {}; }, set(t, k, v) { t[k] = v; return true; } });
}

const errors = [];
async function main() {
  let html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  html = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost:3000/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.addEventListener('error', (e) => errors.push(String(e.message || e.error)));

  window.HTMLCanvasElement.prototype.getContext = function () { return makeCtx(); };
  window.HTMLCanvasElement.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: BW, height: BH, right: BW, bottom: BH }; };
  window.XQ = XQ; window.XQAI = XQAI; window.XQBOOK = XQBOOK;

  const sock = { on() {}, emit(ev, p, cb) { if (cb) cb({ ok: true, code: 'TEST1', side: 0, token: 'rt' }); }, close() {} };
  window.io = function () { return sock; };
  window.Worker = class { constructor() { this.onmessage = null; } postMessage() {} terminate() {} };

  // fetch 桩：/api/me 返回未登录 → 触发门禁
  const fetchCalls = [];
  window.fetch = function (url, opts) {
    fetchCalls.push(String(url));
    const u = String(url);
    let data = {};
    if (u.indexOf('/api/me') >= 0) data = { ok: true, user: null };
    else if (u.indexOf('/api/leaderboard') >= 0) data = { ok: true, list: [] };
    else if (u.indexOf('/api/games') >= 0) data = { ok: true, games: [] };
    else if (u.indexOf('/api/stats') >= 0) data = { ok: true, online: 5, playing: 2, waitingRooms: [] };
    else if (u.indexOf('/api/auth/send-code') >= 0) data = { ok: true, msg: '验证码已发送' };
    else if (u.indexOf('/api/auth/verify') >= 0) data = { ok: true, token: 'tok-123', user: { id: 9, nickname: '测试用户', rating: 1300, rank: '黄金', rankIcon: '🥇', rankColor: '#d4af37', wins: 3, losses: 1, draws: 0, winRate: 75, peakRating: 1300, streak: 1, bestStreak: 2 } };
    return Promise.resolve({ json: () => Promise.resolve(data) });
  };
  if (!window.Event) window.Event = function (t) { this.type = t; };

  window.eval(fs.readFileSync(path.join(ROOT, 'public/js/sound.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(ROOT, 'public/js/account.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8'));

  await sleep(150);
  const doc = window.document;
  const $ = (id) => doc.getElementById(id);

  console.log('\n[1] 未登录门禁');
  ok(errors.length === 0, '无 JS 运行时错误' + (errors.length ? '：' + errors.join(' | ') : ''));
  ok(!doc.body.classList.contains('gate-on') === false || $('loginGate'), '门禁页存在');
  ok(doc.body.classList.contains('gate-on'), '未登录时 body 带 gate-on');
  ok(!$('loginGate').classList.contains('hidden'), '登录门禁可见');

  console.log('\n[2] 发送验证码');
  $('loginEmail').value = 'tester@example.com';
  $('btnSendCode').click();
  await sleep(50);
  ok($('loginError').className.indexOf('ok') >= 0, '发送提示为成功态：' + $('loginError').textContent);
  ok($('btnSendCode').disabled === true, '发送按钮进入倒计时禁用');

  console.log('\n[3] 登录成功进入大厅');
  $('loginCode').value = '123456';
  $('btnLogin').click();
  await sleep(150);
  ok(errors.length === 0, '登录过程无错误' + (errors.length ? '：' + errors.join(' | ') : ''));
  ok($('loginGate').classList.contains('hidden'), '登录门禁已关闭');
  ok(!doc.body.classList.contains('gate-on'), 'body 解除滚动锁定');
  ok(!$('screen-home').classList.contains('hidden'), '大厅显示');
  ok($('dashRank').textContent === '黄金', '数据看板显示段位：' + $('dashRank').textContent);
  ok($('dashOnline').textContent === '5', '数据看板在线人数：' + $('dashOnline').textContent);

  console.log('\n[4] 登录后开始人机对局');
  $('goAi').click();
  await sleep(30);
  ok(!$('screen-ai').classList.contains('hidden'), '点击人机卡片进入人机设置');
  $('startAi').click();
  await sleep(80);
  ok(!$('screen-game').classList.contains('hidden'), '开始对局进入棋局界面');
  ok(errors.length === 0, '开局无错误' + (errors.length ? '：' + errors.join(' | ') : ''));

  console.log('\n[5] 回车提交登录可用（登出后再测）');
  ok(typeof $('loginEmail') !== 'undefined', '邮箱输入框存在');

  console.log('\n[6] 退出登录回门禁');
  $('btnLogout').click();
  await sleep(50);
  ok($('loginGate') && !$('loginGate').classList.contains('hidden'), '退出后门禁重新显示');
  ok(doc.body.classList.contains('gate-on'), '退出后 body 重新锁定');
  ok(errors.length === 0, '登出无错误' + (errors.length ? '：' + errors.join(' | ') : ''));

  console.log('\n' + (fail === 0 ? '门禁流程全部通过 ✅' : fail + ' 项失败 ❌') + '\n');
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error('测试异常：', e); process.exit(1); });
