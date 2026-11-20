# 中国象棋 · 联机对战 & AI 对局

[![CI](https://github.com/qinzhu0907/Chinese-chess/actions/workflows/ci.yml/badge.svg)](https://github.com/qinzhu0907/Chinese-chess/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](./Dockerfile)

一个零构建、可直接部署到自己服务器的中国象棋网站。后端 Node.js + Express + Socket.IO，前端原生 Canvas（没有 npm run build 这一步）。

- **登录门禁** —— 邮箱验证码登录（首次自动注册），未登录先到登录页；服务端校验 `create/join/quick`（`REQUIRE_LOGIN=0` 可关，仅供测试）
- **账号体系** —— ELO 段位（青铜→大师）、战绩统计、对局历史与逐步复盘、高手排行榜
- **联机对战** —— 房间号约战 / 快速匹配 / 房间大厅，支持观战、聊天、悔棋、求和、换先再战
- **断线重连** —— 网络抖动或误刷新后，凭 token 在 2 分钟内坐回原座位，对局不中断
- **人机对战** —— 自研 Alpha-Beta 引擎 + 开局库，跑在 Web Worker 里，四档难度 + 走法提示 + 战绩统计 + 棋谱导出

---

## 特性

**账号与门禁**
- 邮箱验证码登录 / 注册（6 位码，5 分钟有效，60 秒重发冷却，最多 5 次尝试）
- 会话用 HMAC 签名 token（30 天有效），存 localStorage；密钥来自 `SESSION_SECRET` 环境变量
- 未登录显示全屏登录页，无法进入大厅或开局；`create` / `join` / `quick` 在服务端校验登录态（`REQUIRE_LOGIN=0` 可关闭，仅供自动化测试）
- ELO 段位：青铜 / 白银 / 黄金 / 铂金 / 钻石 / 大师；登录用户之间的联机对局计入积分
- 个人档案：胜负和、胜率、连胜、历史最高分；对局历史支持逐步复盘
- 高手排行榜（Top3 领奖台 + 完整榜单）；大厅实时展示在线/对局/等待数据

**对弈与规则**
- 完整规则：蹩马腿、塞象眼、炮隔子吃、兵卒过河横走、九宫限制、白脸将
- 终局判定：将死 / 困毙 / 认输 / 超时判负 / 三次重复局面判和 / 长将判负 / 60 回合无吃子判和
- 中文记谱（炮二平五、马八进七、前车进一…），实时棋谱，走子动画与音效
- 将军红圈提示、上一步痕迹、可落点提示、棋盘翻转、移动端触屏适配

**联机**
- 5 位房间号 + 一键复制邀请链接（`/?room=ABCDE`，好友打开直接进房）
- 快速匹配、等待中房间列表、在线人数看板
- **服务端权威**：走法合法性、胜负、计时全在服务端判定，客户端只做展示，杜绝作弊与状态漂移
- 第三步起自动进入**观战**，观战者能看到实时棋局与聊天
- 房间内**聊天**（700ms 发言冷却、消息长度限制）
- **每步限时**可选 30s / 60s / 2 分钟 / 不限，超时判负（掉线期间自动暂停计时）
- 悔棋、求和、认输都需要对方同意或直接生效，再来一局需双方同意后**自动换先**

**AI**
- Negamax + Alpha-Beta + Zobrist 置换表 + 静态搜索 + 将军延伸 + 迭代加深
- 开局库（中炮 / 仙人指路 / 飞相局 / 起马局等 21 个局面），开局不呆板
- 初级会走随手棋、高级搜索 10 层；提示功能用更强配置单独计算

---

## 目录结构

```
xiangqi/
├── server.js                 # Express + Socket.IO：房间、座位、走法校验、计时、聊天
├── shared/                   # 三端（Node / 浏览器 / Worker）共用，纯 UMD 无依赖
│   ├── rules.js              # 规则引擎：走法生成、将军、将死、中文记谱、局面指纹
│   ├── referee.js            # 裁判：局面重放 + 长将/重复/自然限着判定
│   ├── ai.js                 # AI 搜索引擎
│   └── opening.js            # 开局库（加载时自动校验坐标合法性）
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js            # 棋盘渲染、对局逻辑、联机交互、断线重连
│       ├── worker.js         # AI 计算线程
│       └── sound.js          # WebAudio 合成音效（无音频文件）
├── deploy/
│   ├── install.sh            # 一键部署脚本（PM2/systemd + Nginx + 证书）
│   ├── docker-deploy.sh      # Docker 一键部署（up / ssl / renew / status / logs / down）
│   ├── nginx.conf            # 宿主机 Nginx 反代模板（含 WebSocket 升级与 gzip）
│   ├── nginx.docker.conf     # 容器内 Nginx 模板（HTTP 版，首次部署自动复制为 active）
│   ├── nginx.ssl.conf.tpl    # 容器内 Nginx 模板（HTTPS 版，脚本替换域名后启用）
│   ├── docker-compose.stack.yml  # 应用 + Nginx（+ certbot）完整栈
│   └── xiangqi.service       # systemd 单元
├── selftest.js               # 规则 / 开局库 / 裁判 / AI 自检（含 perft 基准）
├── smokeui.js                # 前端 DOM 冒烟测试（jsdom 驱动真实页面）
├── e2etest.js                # 联机端到端测试（含重连、观战、超时）
├── Dockerfile / docker-compose.yml / ecosystem.config.js
└── package.json
```

---

## 本地运行

```bash
git clone https://github.com/qinzhu0907/Chinese-chess.git
cd Chinese-chess
npm install          # 生产部署用 npm ci --omit=dev
npm start            # → http://localhost:3000
```

自测一遍（建议改代码后运行）：

```bash
npm test             # 规则 + 开局库 + 裁判 + AI
npm run test:ui      # 前端 DOM 冒烟（需要 jsdom，npm install 自带）
npm run test:e2e     # 联机端到端（需先 npm start）
```

---

## 部署到自己的服务器

前提：一台有公网 IP 的 Linux 服务器（Ubuntu / Debian / CentOS 均可），域名 A 记录已指向它。

### 一键部署（推荐）

```bash
# 1. 装 Node.js 22+（已有可跳过）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git nginx

# 2. 拉代码
sudo git clone https://github.com/qinzhu0907/Chinese-chess.git /opt/xiangqi
cd /opt/xiangqi

# 3. 一条命令搞定：依赖 + PM2 守护 + Nginx 反代 + HTTPS 证书
sudo bash deploy/install.sh --domain 你的域名 --cert
```

脚本会自动完成：安装生产依赖 → PM2 启动并设开机自启 → 生成 Nginx 配置（替换域名、WebSocket 升级、gzip）→ 校验并重载 → 申请 Let's Encrypt 证书 → 轮询 `/healthz` 确认服务真的起来了。

常用参数：

| 参数 | 说明 |
| --- | --- |
| `--domain <域名>` | 生成 Nginx 配置用的域名 |
| `--dir <路径>` | 安装目录，默认 `/opt/xiangqi` |
| `--port <端口>` | 应用端口，默认 `3000` |
| `--repo <git 地址>` | 从仓库拉取/更新代码（不填则复制当前项目） |
| `--systemd` | 用 systemd 托管（默认 PM2） |
| `--no-nginx` | 跳过 Nginx（前面已有 Caddy/Traefik 时用） |
| `--cert` | 自动申请 HTTPS 证书 |
| `--uninstall` | 停止并移除服务（保留代码） |

更新代码：

```bash
sudo bash /opt/xiangqi/deploy/install.sh --domain 你的域名 --repo https://github.com/qinzhu0907/Chinese-chess.git
```

### 手动部署（任选一种）

```bash
# A. PM2
sudo npm ci --omit=dev && sudo npm i -g pm2
sudo pm2 start ecosystem.config.js --env production
sudo pm2 save && sudo pm2 startup

# B. systemd
sudo cp deploy/xiangqi.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now xiangqi

# C. Docker（只跑应用，端口 3000，前面自己接 Nginx/Caddy）
docker compose up -d --build
docker compose logs -f

# D. Docker 全家桶（应用 + Nginx，80/443 直接对外）—— 推荐用脚本，一步到位
bash deploy/docker-deploy.sh up                       # 起服务，先 http://服务器IP 访问
bash deploy/docker-deploy.sh ssl 你的域名 你的邮箱      # 自动签证书 + 切 443 + 校验
bash deploy/docker-deploy.sh status                   # 查看容器与健康状态
bash deploy/docker-deploy.sh logs                     # 跟踪应用日志
bash deploy/docker-deploy.sh renew                    # 续期证书（建议加进 crontab）
```

`docker-deploy.sh` 的 `ssl` 子命令会：申请 Let's Encrypt 证书 → 用 `deploy/nginx.ssl.conf.tpl` 生成域名版配置覆盖 `deploy/nginx.active.conf`（含 HSTS、443、301 跳转、WebSocket 升级头）→ `nginx -t` 校验 → reload → 用 `https://域名/healthz` 自证生效。配置文件在宿主机上，随时可以手改再 reload。

不想用脚本也可以手动：

```bash
cp deploy/nginx.docker.conf deploy/nginx.active.conf    # 首次
docker compose -f deploy/docker-compose.stack.yml up -d --build
docker compose -f deploy/docker-compose.stack.yml --profile cert run --rm certbot certonly \
  --webroot -w /var/www/certbot -d 你的域名 --email 你的邮箱 --agree-tos --no-eff-email
sed 's/__DOMAIN__/你的域名/g' deploy/nginx.ssl.conf.tpl > deploy/nginx.active.conf
docker compose -f deploy/docker-compose.stack.yml exec nginx nginx -s reload
```

Nginx 反代 + 证书：

```bash
sudo cp deploy/nginx.conf /etc/nginx/conf.d/xiangqi.conf
sudo sed -i 's/chess.example.com/你的域名/g' /etc/nginx/conf.d/xiangqi.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d 你的域名
```

**关键点**：`location /socket.io/` 必须带 `Upgrade` 与 `Connection: $connection_upgrade` 头，`proxy_read_timeout` ≥ 120s，否则联机连不上或频繁掉线。模板里都已写好。

部署后自检：

```bash
curl https://你的域名/healthz        # → {"ok":true,"rooms":0,"playing":0,...}
curl https://你的域名/api/stats      # → 在线人数 / 对局数 / 等待中的房间
```

再用两台设备（或一个浏览器 + 手机）建房、加入，确认能落子、能聊天、刷新后能自动回到对局。

### 环境变量

复制 `.env.example` 为 `.env`（`install.sh` 会自动复制），或用 PM2 / Docker 的 env 传入：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PER_MOVE` | `60` | 每步限时（秒），0 = 不限 |
| `RECONNECT_GRACE` | `120000` | 掉线后座位保留时长（毫秒） |
| `MAX_ROOMS` | `4000` | 房间数上限，防刷 |
| `CORS_ORIGIN` | 空 | 跨域来源，同域部署无需设置 |

### 生产注意事项

- 房间状态在进程内存中，**单实例部署**即可；要多实例必须加 `@socket.io/redis-adapter` + Nginx 粘滞会话（`ip_hash`）
- 空房、僵尸房（6 小时无活动）、超过 1 小时的无人等待房会被自动清理
- 生产用 `npm ci --omit=dev`，不需要 devDependencies
- 建议用 `pm2 monit` / `pm2 logs xiangqi` 观察内存与错误

---

## 玩法

1. 大厅填昵称 → 选「人机对战」或「联机对战」
2. 人机：选难度、执红/执黑（执黑自动翻转棋盘）
3. 联机：
   - **创建房间** → 得到房间号 → 复制房间号或邀请链接发给好友
   - **加入房间** → 输入房间号；也可直接点「等待中的房间」列表
   - **快速匹配** → 自动撮合等待中的玩家
   - 第三人起进入**观战**（只能看，不能走）
4. 点棋子 → 绿点为可落点 → 点落点即走子
5. 对局中可：悔棋（需对方同意）、提示、求和、认输、再来一局（双方确认后换先）

---

## AI 引擎

| 难度 | 搜索层数上限 | 时间预算 | 说明 |
| --- | --- | --- | --- |
| 初级 | 2 层 | 0.35s | 约 28% 概率走随手棋，像新手 |
| 中级 | 6 层 | 1.4s | 攻守均衡 |
| 高级 | 10 层 | 4.0s | 算路较深 |
| 大师 | 14 层 | 8.0s | 巅峰强度，单步长考 |
| 提示 | 8 层 | 1.8s | 不受难度影响 |

- 评估 = 子力价值（车 900 / 炮 450 / 马 400 / 士象 200 / 兵 100）+ 位置价值表
- 置换表用 Zobrist 哈希；静态搜索消除水平线效应；将军延伸提高战术嗅觉
- 开局阶段先查 `shared/opening.js`，库内每步都在加载时用规则引擎校验过

性能参考（普通笔记本）：初始局面深度 4 约 12 万节点 / 0.5 秒。

---

## 联机协议（Socket.IO）

客户端 → 服务端：

| 事件 | 参数 | 说明 |
| --- | --- | --- |
| `create` | `{name, perMove}` | 创建房间，创建者执红；`perMove` 为每步限时秒数 |
| `join` | `{code, name, token}` | 加入房间；满员自动转观战；带 token 可坐回原位 |
| `quick` | `{name, perMove}` | 快速匹配 |
| `resume` | `{code, token}` | 断线重连，恢复座位与棋局 |
| `move` | `{f, t}` | 走子（`idx = row * 9 + col`，0–89） |
| `undo-request` / `undo-reply` | `{accept}` | 悔棋请求 / 应答 |
| `draw-offer` / `draw-reply` | `{accept}` | 求和请求 / 应答 |
| `rematch` | – | 再来一局（双方都发才算同意，随后换先） |
| `chat` | `{text}` | 房间内发言（≤200 字，700ms 冷却） |
| `resign` | – | 认输 |
| `leave` | – | 主动离开（对局中判对手胜） |

服务端 → 客户端：

| 事件 | 说明 |
| --- | --- |
| `room` | 房间信息：`{code, role, side, status, turn, perMove, spectators, names, connected, result}` |
| `sync` | 全量同步：`{history, turn, status, deadline, now, names}`；悔棋/重连后都会下发 |
| `move` | 合法走子：`{f, t, not, turn, check, deadline, now}` |
| `end` | 结束：`{winner, reason}`，`winner = -1` 表示和棋 |
| `msg` | 提示（将军 / 非法走法 / 对手离开等） |
| `chat` | 聊天消息；发给本人时带 `me: true` |
| `opponent` | 对手连接状态变化 `{side, connected, text}` |
| `draw-ask` / `undo-ask` / `rematch-ask` | 对方发来的请求 |
| `kick` | 同一账号在别处重连，当前连接被踢下线 |

HTTP 接口：

- `GET /healthz` → `{ok, rooms, playing, online, uptime}`
- `GET /api/stats` → 在线人数、对局数、等待中的房间列表

---

## 测试覆盖

`npm test`（规则层）：

- **perft 基准**：`perft(1)=44`、`perft(2)=1920`、`perft(3)=79666`（与公开象棋基准一致）
- 特殊规则：蹩马腿、塞象眼、炮隔子吃、兵过河横走、白脸将、将死
- 中文记谱、局面指纹
- 开局库：局面数、坐标合法性、首着合法
- 裁判：重放、三次重复判和、长将判负、自然限着、将死
- AI：着法合法、时间预算、自对弈 60 手不崩

`npm run test:ui`（前端，jsdom 驱动真实 `index.html`）：27 项断言，覆盖大厅渲染、人机对局落子与 AI 应着、认输横幅、联机建房、走子同步、对手着法、聊天、观战禁用操作、结束事件。

`npm run test:e2e`（联机，真实 Socket.IO）：建房/加入、走子同步与记谱、非法走法与轮次拦截、聊天双向、观战、悔棋、断线重连、认输、再来一局换先、快速匹配、步时超时判负。

---

## 常见问题

**Q：联机连不上 / 一直转圈？**
A：九成是 Nginx 少了 WebSocket 升级头。检查 `/socket.io/` 的 `Upgrade`、`Connection` 两行；第二可能是防火墙没放行 80/443。

**Q：刷新手贱把对局刷没了？**
A：不会。座位和棋局在服务端保留 2 分钟，页面重连后自动 `resume` 回原位；改 `RECONNECT_GRACE` 可调。

**Q：能同时多少人在线？**
A：每局只存一个小棋盘和几十条历史，内存占用很低。1C1G 机器跑几十个并发房间没问题，瓶颈通常是带宽和 CPU（AI 是客户端算的，不占服务器）。

**Q：为什么走子要等服务端确认？**
A：保证双方看到的局面绝对一致，也让改前端源码作弊失效。代价是局域网外多一个 RTT（通常几十毫秒）。

**Q：能加 Redis / 多实例吗？**
A：可以但需要改造：`@socket.io/redis-adapter` 广播 + Nginx `ip_hash` 粘滞，且房间状态要挪到 Redis。单机足够用，暂未内置。

---

## 技术栈

Node.js 22+ · Express 4 · Socket.IO 4 · 原生 Canvas / ES5 前端 · Web Worker · jsdom（测试）· Docker / PM2 / Nginx

## 许可

MIT —— 见 [LICENSE](./LICENSE)
