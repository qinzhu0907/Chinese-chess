/* 个人档案页：段位/战绩/对局历史/复盘。依赖 core.js。 */
(function () {
  'use strict';
  var A = window.XQAuth;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }

  function loadProfile() {
    var u = A.getUser();
    if (!u) return;
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

    var badge = $('userBadge');
    badge.classList.remove('logged-out');
    badge.innerHTML = '<span class="avatar" style="background:' + (u.rankColor || '#b0392b') + '">' +
      (u.rankIcon || '♟') + '</span><span class="user-meta"><b>' + esc(u.nickname) + '</b>' +
      '<i>' + u.rank + ' · ' + u.rating + ' 分</i></span>';

    A.api('/api/games?limit=30').then(function (r) { renderGames(r.games || []); });
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
      var result;
      if (g.winner === -1) result = '和';
      else if (g.winner === g.mySide) result = '胜';
      else result = '负';
      var date = new Date(g.createdAt).toLocaleString();
      el.innerHTML = '<span class="h-res ' + result + '">' + result + '</span>' +
        '<span class="h-info"><b>' + esc(g.redName) + ' vs ' + esc(g.blackName) + '</b>' +
        '<i>' + (g.mode === 'ai' ? '人机' : '联机') + ' · ' + date + '</i></span>';
      box.appendChild(el);
    });
  }

  $('btnBack').addEventListener('click', function () { A.navigate('/'); });
  $('btnLogout').addEventListener('click', function () {
    A.logout();
    A.navigate('/login.html?next=' + encodeURIComponent('/'));
  });

  A.refreshMe().then(function (u) {
    if (!u) { A.navigate('/login.html?next=' + encodeURIComponent('/profile.html')); return; }
    loadProfile();
  });
})();
