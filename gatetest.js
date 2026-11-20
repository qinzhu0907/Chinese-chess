/* 多页面流程测试：登录页 → 主页 → 游戏页。
 * 分别加载 login.html / index.html / game.html，验证门禁与跳转。
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
    createLinearGradient: function () { return { addColorStop: function () {} }; },
    createRadialGradient: function () { return { addColorStop: function () {} }; },
    measureText: function () { return { width: 10 }; }
  };
  return new Proxy(base, { get: function (t, k) { if (k in t) return t[k]; return function () {}; }, set: function (t, k, v) { t[k] = v; return true; } });
}

const errors = [];
function loadPage(file) {
  // file 可能带 ?query，加载时去掉
  const fileName = file.split('?')[0];
  const query = file.indexOf('?') >= 0 ? file.slice(file.indexOf('?')) : '';
  let html = fs.readFileSync(path.join(ROOT, 'public', fileName), 'utf8');
  html = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost:3000/' + file, pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.addEventListener('error', (e) => errors.push(String(e.message || e.error)));
  window.HTMLCanvasElement.prototype.getContext = function () { return makeCtx(); };
  window.HTMLCanvasElement.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: BW, height: BH, right: BW, bottom: BH }; };
  window.XQ = XQ; window.XQAI = XQAI; window.XQBOOK = XQBOOK;
  window.io = function () { return { on() {}, emit() {}, close() {} }; };
  window.Worker = class { constructor() { this.onmessage = null; } postMessage() {} terminate() {} };
  if (!window.Event) window.Event = function (t) { this.type = t; };
  // 导航 spy：core.js 的 navigate 会优先走 window.XQNav
  window.__nav = [];
  window.XQNav = function (u) { window.__nav.push(u); };
  return { window, document: window.document, query };
}

async function main() {
  console.log('\n[1] 登录页（未登录，直接进主页应跳登录页）');
  let home = loadPage('index.html');
  let HW = home.window, HD = home.document;
  // 主页 fetch /api/me 返回 null → 应跳 login
  HW.fetch = function (url) {
    let data = { ok: true, user: null };
    return Promise.resolve({ json: () => Promise.resolve(data) });
  };
  HW.eval(fs.readFileSync(path.join(ROOT, 'public/js/core.js'), 'utf8'));
  HW.eval(fs.readFileSync(path.join(ROOT, 'public/js/home.js'), 'utf8'));
  await sleep(80);
  ok(HW.__nav.some(u => u.indexOf('/login.html') >= 0), '未登录访问主页跳转登录页：' + (HW.__nav[0] || ''));
  ok(errors.length === 0, '主页无 JS 错误' + (errors.length ? '：' + errors.join(' | ') : ''));

  console.log('\n[2] 登录页发码/登录');
  let login = loadPage('login.html');
  let LW = login.window, LD = login.document;
  LW.fetch = function (url) {
    let u = String(url), data = {};
    if (u.indexOf('/api/me') >= 0) data = { ok: true, user: null };
    else if (u.indexOf('send-code') >= 0) data = { ok: true, msg: '验证码已发送' };
    else if (u.indexOf('verify') >= 0) data = { ok: true, token: 'tok', user: { id: 1, nickname: '测试', rating: 1200, rank: '黄金', rankIcon: '🥇', rankColor: '#d4af37' } };
    return Promise.resolve({ json: () => Promise.resolve(data) });
  };
  LW.eval(fs.readFileSync(path.join(ROOT, 'public/js/core.js'), 'utf8'));
  LW.eval(fs.readFileSync(path.join(ROOT, 'public/js/auth-page.js'), 'utf8'));
  await sleep(50);
  LD.getElementById('loginEmail').value = 'a@b.com';
  LD.getElementById('loginCode').value = '123456';
  LD.getElementById('btnLogin').click();
  await sleep(80);
  ok(LW.__nav.length > 0 && LW.__nav[0] === '/', '登录成功跳转主页：' + (LW.__nav[0] || ''));
  ok(errors.length === 0, '登录页无 JS 错误');

  console.log('\n[3] 已登录进入主页并跳游戏页');
  home = loadPage('index.html');
  HW = home.window; HD = home.document;
  HW.fetch = function (url) {
    let u = String(url), data = { ok: true, online: 5, playing: 2, waitingRooms: [] };
    if (u.indexOf('/api/me') >= 0) data = { ok: true, user: { id: 1, nickname: '测试', rating: 1300, rank: '黄金', rankIcon: '🥇', rankColor: '#d4af37', wins: 3, losses: 1, draws: 0, winRate: 75, peakRating: 1300, streak: 1, bestStreak: 2 } };
    else if (u.indexOf('/api/leaderboard') >= 0) data = { ok: true, list: [] };
    else if (u.indexOf('/api/games') >= 0) data = { ok: true, games: [] };
    return Promise.resolve({ json: () => Promise.resolve(data) });
  };
  // 预先写登录态
  HW.eval(fs.readFileSync(path.join(ROOT, 'public/js/core.js'), 'utf8'));
  HW.XQAuth.saveSession('tok', { id: 1, nickname: '测试', rating: 1300, rank: '黄金', rankIcon: '🥇', rankColor: '#d4af37' });
  HW.eval(fs.readFileSync(path.join(ROOT, 'public/js/home.js'), 'utf8'));
  await sleep(80);
  ok(!HD.getElementById('userBadge').classList.contains('logged-out'), '徽章显示已登录');
  ok(HD.getElementById('dashRank').textContent === '黄金', '看板显示段位');
  HD.getElementById('goAi').click();
  ok(HW.__nav.some(u => u.indexOf('game.html?mode=ai') >= 0), '点击人机跳转 game.html?mode=ai');

  console.log('\n[4] 游戏页加载（人机模式）');
  let game = loadPage('game.html?mode=ai');
  let GW = game.window, GD = game.document;
  GW.fetch = function () { return Promise.resolve({ json: () => Promise.resolve({ ok: true }) }); };
  GW.eval(fs.readFileSync(path.join(ROOT, 'public/js/core.js'), 'utf8'));
  GW.XQAuth.saveSession('tok', { id: 1, nickname: '测试' });
  GW.eval(fs.readFileSync(path.join(ROOT, 'public/js/sound.js'), 'utf8'));
  GW.eval(fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8'));
  await sleep(100);
  ok(!GD.getElementById('screen-ai').classList.contains('hidden'), '人机模式默认显示设置面板');
  ok(GD.getElementById('screen-game').classList.contains('hidden'), '尚未进入对局');
  ok(errors.length === 0, '游戏页无 JS 错误' + (errors.length ? '：' + errors.join(' | ') : ''));
  GD.getElementById('startAi').click();
  await sleep(50);
  ok(!GD.getElementById('screen-game').classList.contains('hidden'), '开始对局进入棋局面板');

  console.log('\n' + (fail === 0 ? '多页面流程全部通过 ✅' : fail + ' 项失败 ❌') + '\n');
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error('测试异常：', e); process.exit(1); });
