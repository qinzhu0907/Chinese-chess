/* 主页（大厅）：门禁校验 → 展示数据/榜单/最近对局 → 跳转游戏页。
 * 依赖 core.js（window.XQAuth）。
 */
(function () {
  'use strict';
  var A = window.XQAuth;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  function setText(id, v) { var el = $(id); if (el) el.textContent = v; }

  /* 用户徽章 */
  function refreshBadge() {
    var el = $('userBadge');
    var u = A.getUser();
    if (u) {
      el.classList.remove('logged-out');
      el.innerHTML = '<span class="avatar" style="background:' + (u.rankColor || '#b0392b') + '">' +
        (u.rankIcon || '♟') + '</span><span class="user-meta"><b>' + esc(u.nickname) + '</b>' +
        '<i>' + u.rank + ' · ' + u.rating + ' 分</i></span>';
    } else {
      el.classList.add('logged-out');
      el.innerHTML = '<span class="avatar">游客</span><span class="user-meta"><b>未登录</b><i>点击登录</i></span>';
    }
  }

  function fillHome() {
    var u = A.getUser();
    if (u) {
      setText('dashRank', u.rank || '—');
      setText('dashRating', (u.rating || 1200) + ' 分');
    }
    A.api('/api/stats').then(function (r) {
      setText('dashOnline', r.online != null ? r.online : '—');
      setText('dashPlaying', r.playing != null ? r.playing : '—');
      setText('dashWaiting', Array.isArray(r.waitingRooms) ? r.waitingRooms.length : '—');
      setText('homeStats', '在线 ' + (r.online || 0) + ' 人 · 对局中 ' + (r.playing || 0) + ' 桌');
    });

    A.api('/api/leaderboard?limit=3').then(function (r) {
      var box = $('homeLeaders');
      var list = r.list || [];
      if (!list.length) { box.innerHTML = '<div class="bp-empty">暂无棋手，等你登顶</div>'; return; }
      box.innerHTML = list.map(function (p, i) {
        var medal = ['🥇', '🥈', '🥉'][i] || (i + 1);
        return '<div class="hl-row' + (i === 0 ? ' top1' : '') + '">' +
          '<span class="hl-rank">' + medal + '</span>' +
          '<span class="hl-av" style="background:' + (p.rankColor || '#b0392b') + '">' + (p.rankIcon || '♟') + '</span>' +
          '<span class="hl-name">' + esc(p.nickname) + '</span>' +
          '<span class="hl-pt">' + p.rating + '</span></div>';
      }).join('');
    });

    A.api('/api/games?limit=3').then(function (r) {
      var box = $('homeRecent');
      var list = r.games || [];
      if (!list.length) { box.innerHTML = '<div class="bp-empty">尚无对局，去下一盘吧</div>'; return; }
      box.innerHTML = list.map(function (g) {
        var res = g.winner === -1 ? '和' : (g.winner === g.mySide ? '胜' : '负');
        var d = new Date(g.createdAt);
        var time = (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
          String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        return '<div class="hr-row"><span class="hr-res ' + res + '">' + res + '</span>' +
          '<span class="hr-info">' + esc(g.redName) + ' vs ' + esc(g.blackName) + '</span>' +
          '<span class="hr-time">' + time + '</span></div>';
      }).join('');
    });
  }

  /* 跳转游戏页 */
  $('goAi').addEventListener('click', function () { A.navigate('/game.html?mode=ai'); });
  $('goOnline').addEventListener('click', function () { A.navigate('/game.html?mode=online'); });
  $('navLeaderboard').addEventListener('click', function () { A.navigate('/leaderboard.html'); });
  $('btnLeaderboard').addEventListener('click', function () { A.navigate('/leaderboard.html'); });
  $('navProfile').addEventListener('click', function () { A.navigate('/profile.html'); });
  $('btnProfHome').addEventListener('click', function () { A.navigate('/profile.html'); });
  $('userBadge').addEventListener('click', function () { A.navigate('/profile.html'); });

  /* 连接状态灯（可选，用 stats 接口代替长连） */
  function ping() {
    A.api('/healthz').then(function (r) {
      $('connDot').classList.toggle('on', r.ok === true);
    }).catch(function () { $('connDot').classList.remove('on'); });
  }

  /* 旧版邀请链接 /?room=XXX 兼容：转跳到游戏页 */
  (function () {
    var m = /[?&]room=([A-Za-z0-9]+)/.exec(location.search);
    if (m) A.navigate('/game.html?mode=online&room=' + m[1].toUpperCase());
  })();

  /* 启动：未登录跳登录页 */
  A.refreshMe().then(function (u) {
    if (!u) { A.navigate('/login.html?next=' + encodeURIComponent('/')); return; }
    refreshBadge();
    fillHome();
    ping();
  });
})();
