# 中国象棋 · 联机对战 & AI 对局

一个零依赖前端框架、可直接部署到自有服务器的中国象棋网站。两个核心功能：

- **联机对战** —— 房间号约战 / 快速匹配，实时同步，支持悔棋、求和、认输、换先再战
- **人机对战** —— 内置 Alpha-Beta 搜索引擎（Web Worker 中运行，不卡界面），三档难度 + 走法提示

后端 Node.js + Express + Socket.IO，前端原生 Canvas，无任何前端构建步骤（不需要 npm run build）。

---

## 特性一览

**对弈**
- 完整中国象棋规则：蹩马腿、塞象眼、炮隔子吃、兵卒过河横走、九宫限制、白脸将
- 将死 / 困毙判负，60 回合无吃子自动判和
- 中文记谱（炮二平五、马八进七、前车进一…），实时棋谱列表
- 走子高亮、上一步痕迹、将军红圈提示、双方计时
- 移动端适配，触屏点选走子

**联机**
- 5 位房间号，复制即分享
- 快速匹配：自动撮合等待中的玩家
- **服务端权威校验**：所有走法在服务端用同一套规则引擎复核，杜绝客户端作弊与状态不同步
- 悔棋（需对手同意）、求和、认输、再来一局（自动换先）、对手掉线提示

**AI**
- Negamax + Alpha-Beta 剪枝 + Zobrist 置换表 + 静态搜索 + 将军延伸 + 迭代加深
- 三档难度（初级 / 中级 / 高级），可执红先手或执黑后手
- 运行在 Web Worker 中，主线程零阻塞

---

## 目录结构

```
xiangqi/
├── server.js              # Express + Socket.IO 服务（房间、走法校验、对局流程）
├── shared/
│   ├── rules.js           # 象棋规则引擎（Node / 浏览器 / Worker 三端共用同一份代码）
│   └── ai.js              # AI 搜索引擎
├── public/
│   ├── index.html         # 单页界面
│   ├── css/style.css
│   └── js/
│       ├── app.js         # 棋盘渲染 + 对局逻辑
│       └── worker.js      # AI 计算线程
├── deploy/
│   ├── nginx.conf         # Nginx 反向代理示例（含 WebSocket 升级配置）
│   └── xiangqi.service    # systemd 服务单元
├── selftest.js            # 规则 & AI 自检（含 perft 基准校验）
├── e2etest.js             # 联机流程端到端测试
├── Dockerfile / docker-compose.yml / ecosystem.config.js
└── package.json
```

---

## 快速开始（本地）

```bash
# 要求 Node.js >= 18
npm install
npm start
# 打开 http://localhost:3000
```

想和朋友在同一台机器上试：在本机开两个浏览器窗口，一个「创建房间」，把房间号填进另一个窗口的「加入房间」即可。

> 局域网内其他设备访问：把 `localhost` 换成你电脑的局域网 IP（如 `http://192.168.1.20:3000`），并确保防火墙放行 3000 端口。

---

## 玩法说明

1. 大厅填写昵称 → 选择「人机对战」或「联机对战」
2. 人机：选难度与执红/执黑（执黑时棋盘自动翻转）
3. 联机：
   - **创建房间** → 得到 5 位房间号 → 发给好友
   - **加入房间** → 输入好友的房间号
   - **快速匹配** → 系统自动配对正在等待的玩家
4. 点选己方棋子，绿点/绿圈为可落点，再点目标位置落子
5. 对局中可：悔棋、提示（AI 推荐着法）、求和、认输、再来一局

规则细节：红先黑后；将死或困毙对方为胜；连续 60 回合无吃子判和；联机模式下「悔棋」需对手同意。

---

## AI 引擎

| 难度 | 搜索层数上限 | 思考时间预算 | 备注 |
| --- | --- | --- | --- |
| 初级 | 2 层 | 0.4s | 30% 概率走随手棋，更像新手 |
| 中级 | 6 层 | 1.6s | 攻守均衡 |
| 高级 | 10 层 | 4.2s | 算路较深，思考稍慢 |

- 评估 = 子力价值（车 900 / 炮 450 / 马 400 / 士象 200 / 兵 100）+ 位置价值表（兵卒过河、马路中心、炮镇中路、车压过河）
- 置换表用 Zobrist 哈希，支持重复局面判和
- 静态搜索（quiescence）避免"吃了就亏"的水平线效应
- 服务端同一份 `shared/rules.js` 在 Node 中跑，用于联机走法校验，保证前后端规则完全一致

性能参考（普通笔记本）：初始局面深度 4 约 12 万节点 / 0.5 秒。

---

## 联机协议（Socket.IO）

客户端 → 服务端：

| 事件 | 参数 | 说明 |
| --- | --- | --- |
| `create` | `{name}` | 创建房间，创建者执红 |
| `join` | `{code, name}` | 加入房间，执黑 |
| `quick` | `{name}` | 快速匹配 |
| `move` | `{f, t}` | 走子（f/t 为 0–89 的格子索引，`idx = row*9 + col`） |
| `undo-request` / `undo-reply` | `{accept}` | 悔棋请求与应答 |
| `draw-offer` / `draw-reply` | `{accept}` | 求和请求与应答 |
| `resign` | – | 认输 |
| `restart` | – | 再来一局（自动换先） |
| `leave` | – | 离开房间 |

服务端 → 客户端：

| 事件 | 说明 |
| --- | --- |
| `room` | 房间状态（房间号、我的阵营、双方昵称、状态） |
| `start` / `sync` | 开局 / 棋局同步（history、当前行棋方） |
| `move` | 对手或自己的合法走子（双方都会收到，客户端以服务端为准） |
| `end` | 对局结束 `{winner, reason}`，`winner = -1` 为和棋 |
| `msg` | 提示信息（将军 / 非法走法 / 对手离开等） |
| `draw-ask` / `undo-ask` | 对手发来的求和 / 悔棋请求 |

健康检查：`GET /healthz` → `{"ok":true,"rooms":N,"uptime":秒}`

---

## 部署到服务器（你已有域名的情况）

> 前提：一台有公网 IP 的服务器，域名已解析到该服务器（A 记录指向服务器 IP）。

### 方式一：直接跑 Node + PM2（推荐，最简单）

```bash
# 1. 安装 Node 18+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 2. 上传代码到 /opt/xiangqi（或用 git clone）
sudo mkdir -p /opt/xiangqi && cd /opt/xiangqi
sudo git clone https://github.com/<你的用户名>/xiangqi-online.git .
sudo npm ci --omit=dev

# 3. 用 PM2 守护进程
sudo npm i -g pm2
pm2 start ecosystem.config.js --env production
pm2 save && pm2 startup   # 开机自启

# 常用命令
pm2 logs xiangqi
pm2 restart xiangqi
pm2 monit
```

### 方式二：systemd（不用 PM2）

```bash
sudo mkdir -p /var/log/xiangqi
sudo cp deploy/xiangqi.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now xiangqi
sudo systemctl status xiangqi
```

### 方式三：Docker

```bash
docker compose up -d --build
docker compose logs -f
curl http://127.0.0.1:3000/healthz   # 健康检查
```

### Nginx 反向代理 + 域名 + HTTPS

```bash
sudo cp deploy/nginx.conf /etc/nginx/conf.d/xiangqi.conf
sudo sed -i 's/chess.example.com/你的域名/g' /etc/nginx/conf.d/xiangqi.conf
sudo nginx -t && sudo systemctl reload nginx

# 免费证书（Let's Encrypt）
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 你的域名
```

配置要点（示例文件里已写好）：

- `location /socket.io/` 必须带 `Upgrade` / `Connection: upgrade` 头，否则联机对战连不上或退化成轮询
- `proxy_read_timeout` 建议 ≥ 75s，避免长连接被切断
- 证书申请完成后，把注释里的 HTTPS server 块启用、并把 80 端口改为 301 跳转

部署完成后访问 `https://你的域名` 即可；联机走的是 WSS，浏览器不会报混合内容错误。

### 生产环境注意事项

- 房间状态保存在进程内存中，**单实例部署即可**；如果要多实例负载均衡，需要引入 `@socket.io/redis-adapter` + Nginx `ip_hash` 粘滞会话
- 空闲房间与超过 6 小时的房间会被自动清理
- 建议用 `npm ci --omit=dev` 安装，生产环境不需要 socket.io-client

---

## 测试

```bash
npm test          # 规则引擎 + AI 自检
npm run test:e2e  # 联机流程端到端测试（需先启动 npm start）
npm run test:all
```

`npm test` 会做这些校验：

- **perft 基准**：`perft(1)=44`、`perft(2)=1920`、`perft(3)=79666`（与公开的象棋走法生成基准一致）
- 特殊规则：蹩马腿、塞象眼、炮隔子吃、兵过河横走、白脸将、将死 / 困毙
- 中文记谱：炮二平五 / 马二进三 / 兵九进一
- AI：返回着法合法性、时间预算、连续自对弈不崩

---

## 常见问题

**Q：联机提示连不上 / 一直转圈？**
A：多半是 Nginx 少了 WebSocket 升级头，检查 `/socket.io/` 的 `Upgrade` 配置；或服务器防火墙未放行端口。

**Q：AI 思考时页面卡吗？**
A：不卡。搜索引擎跑在 Web Worker 线程里，主线程只负责绘制。

**Q：能同时多少人在线？**
A：单实例下房间数没有硬限制，主要瓶颈是内存与 CPU（每局棋盘很小，普通 1C1G 机器支撑几十个同时在线房间没问题）。

**Q：想把房间号改成自定义 / 加聊天 / 加观战？**
A：服务端逻辑集中在 `server.js` 的房间管理部分，前端在 `public/js/app.js`，改动都不大。

---

## 技术栈

Node.js 18+ · Express 4 · Socket.IO 4 · 原生 Canvas / ES5 前端 · Web Worker · Docker / PM2 / Nginx

## 许可

MIT —— 见 [LICENSE](./LICENSE)
