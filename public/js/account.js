/* 账号模块：邮箱验证码登录、用户态、排行榜、个人档案、对局历史复盘
 * 依赖：全局 fetch，localStorage 存 token；配合 index.html 中的结构。
 */
(function () {
  'use strict';

  var LS_KEY = 'xq_auth_token';
  var LS_NAME = 'xq_name';

  var auth = {
    token: localStorage.getItem(LS_KEY) || '',
    user: null
  };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (auth.token) headers['Authorization'] = 'Bearer ' + auth.token;
    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) { return r.json().catch(function () { return {}; }); });
  }

  /* 取当前登录态 */
  function refreshMe() {
    if (!auth.token) return Promise.resolve(null);
    return api('/api/me').then(function (r) {
      if (r.ok && r.user) { auth.user = r.user; }
      else { auth.user = null; auth.token = ''; lsDel(LS_KEY); }
      return auth.user;
    }).catch(function () { return null; });
  }

  /* ===== 登录门禁：未登录显示全屏登录页，登录后进入应用 ===== */
  function showGate() {
    document.body.classList.add('gate-on');
    var gate = $('loginGate');
    if (gate) gate.classList.remove('hidden');
  }
  function enterApp() {
    document.body.classList.remove('gate-on');
    var gate = $('loginGate');
    if (gate) gate.classList.add('hidden');
    refreshAuthUI();
    fillHome();
    window.dispatchEvent(new Event('xq:login'));
  }
  function requireLogin() {
    if (!auth.user) { showGate(); return false; }
    return true;
  }

  /* 登录流程 */
  var cooldown = 0;
  function sendCode(email, cb) {
    api('/api/auth/send-code', { method: 'POST', body: { email: email } }).then(function (r) {
      if (r.ok) {
        if (r.dev && r.debugCode) {
          // 开发模式：直接回填验证码，方便本地测试
          if (cb) cb(null, r.debugCode);
        } else if (cb) cb(null, null);
      } else {
        if (cb) cb(new Error(r.msg || '发送失败'));
      }
    }).catch(function (e) { if (cb) cb(e); });
  }

  function verify(email, code, cb) {
    api('/api/auth/verify', { method: 'POST', body: { email: email, code: code } }).then(function (r) {
      if (r.ok && r.token) {
        auth.token = r.token;
        auth.user = r.user;
        lsSet(LS_KEY, r.token);
        if (r.user && r.user.nickname) lsSet(LS_NAME, r.user.nickname);
        if (cb) cb(null, r.user);
      } else {
        if (cb) cb(new Error(r.msg || '验证失败'));
      }
    }).catch(function (e) { if (cb) cb(e); });
  }

  function logout() {
    auth.token = '';
    auth.user = null;
    lsDel(LS_KEY);
    refreshAuthUI();
    setScreen('home');
    showGate();
  }

  /* 供 app.js 调用：拿到登录 token（游客为空字符串） */
  function getToken() { return auth.token; }
  function getUser() { return auth.user; }

  /* 导出到全局 */
  window.XQAccount = {
    auth: auth,
    api: api,
    refreshMe: refreshMe,
    sendCode: sendCode,
    verify: verify,
    logout: logout,
    getToken: getToken,
    getUser: getUser
  };

  /* ---------------- 界面 ---------------- */
  function $(id) { return document.getElementById(id); }

  function refreshAuthUI() {
    var el = $('userBadge');
    if (!el) return;
    if (auth.user) {
      var rank = auth.user;
      el.classList.remove('logged-out');
      el.innerHTML = '<span class="avatar" style="background:' + (rank.rankColor || '#b0392b') + '">' +
        (rank.rankIcon || '♟') + '</span>' +
        '<span class="user-meta"><b>' + esc(rank.nickname) + '</b>' +
        '<i>' + rank.rank + ' · ' + rank.rating + ' 分</i></span>';
      el.title = '点击查看个人档案';
    } else {
      el.classList.add('logged-out');
      el.innerHTML = '<span class="avatar">游客</span><span class="user-meta"><b>未登录</b><i>点击登录</i></span>';
      el.title = '点击登录';
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c];
    });
  }

  /* 显示登录门禁 */
  function openLogin() {
    $('loginError').textContent = '';
    $('loginError').className = 'msg';
    showGate();
  }

  var sendTimer = 0;
  function startCountdown() {
    var btn = $('btnSendCode');
    var left = 60;
    btn.disabled = true;
    btn.textContent = left + 's 后重发';
    clearInterval(sendTimer);
    sendTimer = setInterval(function () {
      left--;
      if (left <= 0) {
        clearInterval(sendTimer);
        btn.disabled = false;
        btn.textContent = '发送验证码';
      } else {
        btn.textContent = left + 's 后重发';
      }
    }, 1000);
  }

  function showLoginError(msg) {
    var el = $('loginError');
    el.textContent = msg;
    el.className = 'msg warn';
  }

  function bindLoginUI() {
    var badge = $('userBadge');
    if (badge) {
      badge.addEventListener('click', function () {
        if (auth.user) openProfile();
        else openLogin();
      });
    }

    var sendBtn = $('btnSendCode');
    if (sendBtn) {
      sendBtn.addEventListener('click', function () {
        var email = $('loginEmail').value.trim();
        if (!email) { showLoginError('请输入邮箱'); return; }
        sendBtn.disabled = true;
        sendBtn.textContent = '发送中…';
        sendCode(email, function (err, debugCode) {
          if (err) {
            sendBtn.disabled = false;
            sendBtn.textContent = '发送验证码';
            showLoginError(err.message);
            return;
          }
          startCountdown();
          if (debugCode) {
            $('loginCode').value = debugCode;
            showLoginError('开发模式：验证码已自动填入 ' + debugCode);
            $('loginError').className = 'msg ok';
          } else {
            showLoginError('验证码已发送，请查收邮件');
            $('loginError').className = 'msg ok';
          }
        });
      });
    }

    var loginBtn = $('btnLogin');
    if (loginBtn) {
      loginBtn.addEventListener('click', function () {
        var email = $('loginEmail').value.trim();
        var code = $('loginCode').value.trim();
        if (!email || !code) { showLoginError('请输入邮箱和验证码'); return; }
        loginBtn.disabled = true;
        verify(email, code, function (err, user) {
          loginBtn.disabled = false;
          if (err) { showLoginError(err.message); return; }
          enterApp();
        });
      });
    }

  }

  /* ===== 大厅数据填充 ===== */
  function fillHome() {
    if (!auth.user) return;
    var u = auth.user;
    setText('dashRank', u.rank || '—');
    setText('dashRating', (u.rating || 1200) + ' 分');

    // 服务器统计 -> 顶部数据条
    api('/api/stats').then(function (r) {
      setText('dashOnline', r.online != null ? r.online : '—');
      setText('dashPlaying', r.playing != null ? r.playing : '—');
      setText('dashWaiting', Array.isArray(r.waitingRooms) ? r.waitingRooms.length : '—');
      setText('homeStats', '在线 ' + (r.online || 0) + ' 人 · 对局中 ' + (r.playing || 0) + ' 桌');
    });

    // 排行榜 Top3
    api('/api/leaderboard?limit=3').then(function (r) {
      var box = $('homeLeaders');
      if (!box) return;
      var list = r.list || [];
      if (!list.length) { box.innerHTML = '<div class="bp-empty">暂无棋手，等你登顶</div>'; return; }
      box.innerHTML = list.map(function (p, i) {
        var medal = ['🥇','🥈','🥉'][i] || (i + 1);
        return '<div class="hl-row' + (i === 0 ? ' top1' : '') + '">' +
          '<span class="hl-rank">' + medal + '</span>' +
          '<span class="hl-av" style="background:' + (p.rankColor || '#b0392b') + '">' + (p.rankIcon || '♟') + '</span>' +
          '<span class="hl-name">' + esc(p.nickname) + '</span>' +
          '<span class="hl-pt">' + p.rating + '</span></div>';
      }).join('');
    });

    // 最近对局
    api('/api/games?limit=3').then(function (r) {
      var box = $('homeRecent');
      if (!box) return;
      var list = r.games || [];
      if (!list.length) { box.innerHTML = '<div class="bp-empty">尚无对局，去下一盘吧</div>'; return; }
      box.innerHTML = list.map(function (g) {
        var mySide = g.mySide === 0 ? '红' : '黑';
        var res = g.winner === -1 ? '和' : (g.winner === g.mySide ? '胜' : '负');
        var date = new Date(g.createdAt);
        var time = (date.getMonth() + 1) + '/' + date.getDate() + ' ' +
          String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
        return '<div class="hr-row"><span class="hr-res ' + res + '">' + res + '</span>' +
          '<span class="hr-info">' + esc(g.redName) + ' vs ' + esc(g.blackName) + '</span>' +
          '<span class="hr-time">' + time + '</span></div>';
      }).join('');
    });
  }

  function setText(id, v) { var el = $(id); if (el) el.textContent = v; }

  /* 个人档案 + 排行榜 + 历史 */
  function openProfile() {
    if (!auth.user) { openLogin(); return; }
    setScreen('profile');
    loadProfile();
  }

  function setScreen(name) {
    var screens = ['home', 'ai', 'online', 'game', 'profile', 'leaderboard'];
    screens.forEach(function (s) {
      var el = $('screen-' + s);
      if (el) el.classList.toggle('hidden', s !== name);
    });
    var bh = $('btnHome');
    if (bh) bh.classList.toggle('hidden', name === 'home');
  }

  function loadProfile() {
    refreshMe().then(function (u) {
      if (!u) { openLogin(); return; }
      $('profName').textContent = u.nickname;
      $('profRank').textContent = u.rank;
      $('profRankIcon').textContent = u.rankIcon;
      $('profRating').textContent = u.rating;
      $('profPeak').textContent = '历史最高 ' + u.peakRating;
      $('profWins').textContent = u.wins;
      $('profLosses').textContent = u.losses;
      $('profDraws').textContent = u.draws;
      $('profRate').textContent = u.winRate + '%';
      $('profStreak').textContent = u.streak > 0 ? (u.streak + ' 连胜') : (u.streak < 0 ? (Math.abs(u.streak) + ' 连败') : '—');
      $('profBest').textContent = u.bestStreak;
      var next = u.nextRank ? '距离 ' + u.nextRank + ' 还需 ' + (u.nextRankRating - u.rating) + ' 分' : '已达最高段位';
      $('profNext').textContent = next;

      // 对局历史
      api('/api/games?limit=30').then(function (r) {
        renderGames(r.games || []);
      });
    });
  }

  function renderGames(games) {
    var box = $('gameHistory');
    box.innerHTML = '';
    if (!games.length) {
      box.innerHTML = '<div class="history-empty">还没有对局记录，去下一盘吧</div>';
      return;
    }
    games.forEach(function (g) {
      var el = document.createElement('div');
      el.className = 'history-item';
      var mySide = g.mySide === 0 ? '红' : '黑';
      var result;
      if (g.winner === -1) result = '和';
      else if (g.winner === g.mySide) result = '胜';
      else result = '负';
      var date = new Date(g.createdAt).toLocaleString();
      el.innerHTML = '<span class="h-res ' + result + '">' + result + '</span>' +
        '<span class="h-info"><b>' + esc(g.redName) + ' vs ' + esc(g.blackName) + '</b>' +
        '<i>' + (g.mode === 'ai' ? '人机' : '联机') + ' · ' + date + '</i></span>' +
        '<button class="btn ghost small h-replay" data-id="' + g.id + '">复盘</button>';
      box.appendChild(el);
    });
    // 复盘按钮
    box.querySelectorAll('.h-replay').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        api('/api/games/' + id).then(function (r) {
          if (r.ok && r.game) openReplay(r.game);
        });
      });
    });
  }

  function openReplay(game) {
    var m = $('replayModal');
    if (!m) return;
    m.classList.remove('hidden');
    // 通知 app.js 渲染复盘棋盘
    if (window.XQApp && window.XQApp.showReplay) {
      window.XQApp.showReplay(game);
    } else {
      $('replayMoves').textContent = game.notation ? game.notation.join(' ') : '';
    }
  }

  function closeReplay() {
    var m = $('replayModal');
    if (m) m.classList.add('hidden');
    if (window.XQApp && window.XQApp.stopReplay) window.XQApp.stopReplay();
  }

  /* 排行榜 */
  function openLeaderboard() {
    setScreen('leaderboard');
    loadLeaderboard();
  }
  function loadLeaderboard() {
    api('/api/leaderboard?limit=100').then(function (r) {
      var box = $('lbList');
      box.innerHTML = '';
      var list = r.list || [];
      // 领奖台（前三）
      var podium = $('lbPodium');
      if (podium) {
        var order = [1, 0, 2]; // 视觉上 2-1-3
        podium.innerHTML = list.slice(0, 3).length ? order.map(function (idx) {
          if (!list[idx]) return '';
          var u = list[idx], place = idx + 1;
          return '<div class="pod p' + place + '"><span class="pod-av">' + (u.rankIcon || '♟') + '</span>' +
            '<span class="pod-name">' + esc(u.nickname) + '</span>' +
            '<span class="pod-pt">' + u.rating + '</span></div>';
        }).join('') : '';
      }
      if (!list.length) {
        box.innerHTML = '<div class="history-empty">暂无玩家</div>';
        return;
      }
      list.slice(3).forEach(function (u, i) {
        var el = document.createElement('div');
        el.className = 'lb-item' + (auth.user && u.id === auth.user.id ? ' me' : '');
        var medal = i + 4;
        el.innerHTML = '<span class="lb-rank">' + medal + '</span>' +
          '<span class="lb-avatar" style="background:' + (u.rankColor || '#b0392b') + '">' + (u.rankIcon || '♟') + '</span>' +
          '<span class="lb-name"><b>' + esc(u.nickname) + '</b><i>' + u.rank + '</i></span>' +
          '<span class="lb-stat"><b>' + u.rating + '</b><i>' + u.wins + '胜 ' + u.losses + '负</i></span>';
        box.appendChild(el);
      });
    });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    bindLoginUI();

    // 回车提交
    ['loginEmail', 'loginCode'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); $('btnLogin').click(); }
      });
    });

    // 顶部导航
    document.querySelectorAll('[data-nav]').forEach(function (b) {
      b.addEventListener('click', function () {
        var dest = b.getAttribute('data-nav');
        document.querySelectorAll('.nav-btn').forEach(function (n) { n.classList.toggle('on', n === b); });
        if (dest === 'leaderboard') openLeaderboard();
        else if (window.XQApp) window.XQApp.setScreen('home');
      });
    });
    var navProfile = $('navProfile');
    if (navProfile) navProfile.addEventListener('click', function () {
      document.querySelectorAll('.nav-btn').forEach(function (n) { n.classList.toggle('on', n === navProfile); });
      openProfile();
    });
    document.querySelectorAll('[data-back]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.nav-btn').forEach(function (n, i) { n.classList.toggle('on', i === 0); });
        setScreen('home');
      });
    });
    var btnProfHome = $('btnProfHome');
    if (btnProfHome) btnProfHome.addEventListener('click', function () { openProfile(); });

    // 排行榜/档案入口
    var lbBtn = $('btnLeaderboard');
    if (lbBtn) lbBtn.addEventListener('click', openLeaderboard);
    var logoutBtn = $('btnLogout');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    var replayClose = $('btnCloseReplay');
    if (replayClose) replayClose.addEventListener('click', closeReplay);

    // 门禁：校验会话，未登录停留登录页
    refreshMe().then(function (u) {
      if (u) enterApp();
      else showGate();
    });

    // 暴露 setScreen 供 app.js 复用（避免双份屏幕切换逻辑冲突）
    window.XQAccount.setScreen = setScreen;
    window.XQAccount.openLeaderboard = openLeaderboard;
    window.XQAccount.openProfile = openProfile;
    window.XQAccount.requireLogin = requireLogin;
    window.XQAccount.enterApp = enterApp;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
