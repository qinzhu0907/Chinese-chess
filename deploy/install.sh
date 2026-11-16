#!/usr/bin/env bash
# 中国象棋一键部署脚本（Ubuntu / Debian / CentOS / Rocky 通用）
#
# 用法：
#   sudo bash deploy/install.sh --domain chess.example.com
#   sudo bash deploy/install.sh --domain chess.example.com --repo https://github.com/qinzhu0907/Chinese-chess.git
#
# 可选参数：
#   --dir  /opt/xiangqi     安装目录（默认 /opt/xiangqi）
#   --port 3000             应用端口（默认 3000）
#   --repo <git 地址>       从仓库拉取代码（不填则使用当前脚本所在项目）
#   --systemd               用 systemd 托管（默认用 PM2）
#   --no-nginx              跳过 Nginx 配置
#   --cert                  自动申请 Let's Encrypt 证书（需要域名已解析到本机）
#   --uninstall             停止服务并移除 Nginx 配置（不删代码与数据）
set -euo pipefail

DOMAIN=""
DIR="/opt/xiangqi"
PORT="3000"
REPO=""
USE_SYSTEMD=0
SKIP_NGINX=0
DO_CERT=0
UNINSTALL=0
APPNAME="xiangqi"

C_OK="\033[32m"; C_WARN="\033[33m"; C_ERR="\033[31m"; C_DIM="\033[2m"; C_OFF="\033[0m"
info() { printf "${C_OK}==>${C_OFF} %s\n" "$*"; }
warn() { printf "${C_WARN}[!]${C_OFF} %s\n" "$*"; }
err()  { printf "${C_ERR}[x]${C_OFF} %s\n" "$*" >&2; }
dim()  { printf "${C_DIM}    %s${C_OFF}\n" "$*"; }

usage() { sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --dir) DIR="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --systemd) USE_SYSTEMD=1; shift ;;
    --no-nginx) SKIP_NGINX=1; shift ;;
    --cert) DO_CERT=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) usage ;;
    *) err "未知参数：$1"; exit 1 ;;
  esac
done

SUDO=""
if [[ "$(id -u)" -ne 0 ]]; then SUDO="sudo"; fi

# ---------- 卸载 ----------
if [[ "$UNINSTALL" -eq 1 ]]; then
  info "停止服务"
  if command -v pm2 >/dev/null 2>&1; then $SUDO pm2 delete "$APPNAME" >/dev/null 2>&1 || true; $SUDO pm2 save >/dev/null 2>&1 || true; fi
  if systemctl list-unit-files 2>/dev/null | grep -q "^$APPNAME.service"; then
    $SUDO systemctl disable --now "$APPNAME" >/dev/null 2>&1 || true
    $SUDO rm -f "/etc/systemd/system/$APPNAME.service"
    $SUDO systemctl daemon-reload || true
  fi
  if command -v nginx >/dev/null 2>&1; then
    for f in "/etc/nginx/conf.d/$APPNAME.conf" "/etc/nginx/sites-enabled/$APPNAME"; do
      [[ -f "$f" ]] && $SUDO rm -f "$f" && dim "已删除 $f"
    done
    $SUDO nginx -t >/dev/null 2>&1 && $SUDO systemctl reload nginx || true
  fi
  info "已卸载服务（代码目录 $DIR 保留）"
  exit 0
fi

# ---------- 依赖检查 ----------
info "检查运行环境"
if ! command -v node >/dev/null 2>&1; then
  err "未找到 node。请先安装 Node.js 18+："
  dim "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
  dim "或使用 nvm：https://github.com/nvm-sh/nvm"
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  err "Node.js 版本过低（当前 $(node -v)），需要 >= 18"
  exit 1
fi
dim "node $(node -v) · npm $(npm -v)"

if ! command -v git >/dev/null 2>&1 && [[ -n "$REPO" ]]; then
  err "拉取代码需要 git，请先安装：apt install -y git"
  exit 1
fi

# ---------- 放置代码 ----------
if [[ -n "$REPO" ]]; then
  if [[ -d "$DIR/.git" ]]; then
    info "更新代码：$DIR"
    $SUDO git -C "$DIR" fetch --all --prune
    $SUDO git -C "$DIR" reset --hard "origin/main" 2>/dev/null || $SUDO git -C "$DIR" reset --hard "origin/master"
  else
    info "克隆代码到 $DIR"
    $SUDO mkdir -p "$(dirname "$DIR")"
    $SUDO git clone --depth 1 "$REPO" "$DIR"
  fi
else
  SRC="$(cd "$(dirname "$0")/.." && pwd)"
  if [[ "$SRC" != "$DIR" ]]; then
    info "复制项目到 $DIR"
    $SUDO mkdir -p "$DIR"
    $SUDO rsync -a --delete \
      --exclude node_modules --exclude .git --exclude '*.log' --exclude .env \
      "$SRC/" "$DIR/"
  fi
fi

cd "$DIR"
[[ -f .env ]] || $SUDO cp .env.example .env 2>/dev/null || true
if grep -q '^PORT=' .env 2>/dev/null; then
  $SUDO sed -i "s/^PORT=.*/PORT=$PORT/" .env
else
  echo "PORT=$PORT" | $SUDO tee -a .env >/dev/null
fi

info "安装依赖（仅生产依赖）"
$SUDO npm ci --omit=dev --no-audit --no-fund

# ---------- 启动 ----------
if [[ "$USE_SYSTEMD" -eq 1 ]]; then
  info "使用 systemd 托管"
  $SUDO sed -e "s|/opt/xiangqi|$DIR|g" -e "s|^User=.*|User=$(id -un)|" \
    -e "s|^Group=.*|Group=$(id -gn)|" deploy/xiangqi.service \
    | $SUDO tee /etc/systemd/system/$APPNAME.service >/dev/null
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now "$APPNAME"
  dim "查看日志：journalctl -u $APPNAME -f"
else
  info "使用 PM2 托管"
  if ! command -v pm2 >/dev/null 2>&1; then
    $SUDO npm i -g pm2
  fi
  $SUDO pm2 delete "$APPNAME" >/dev/null 2>&1 || true
  $SUDO pm2 start ecosystem.config.js --env production --update-env
  $SUDO pm2 save
  $SUDO env PATH="$PATH" pm2 startup systemd -u "$(id -un)" --hp "$HOME" >/dev/null 2>&1 || \
    warn "pm2 开机自启未配置成功，可手动执行：pm2 startup"
  dim "查看日志：pm2 logs $APPNAME"
fi

info "等待服务就绪"
READY=0
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then READY=1; break; fi
  sleep 0.5
done
if [[ "$READY" -eq 1 ]]; then
  info "服务健康检查通过：$(curl -fsS "http://127.0.0.1:$PORT/healthz")"
else
  err "服务未在预期时间内就绪，请查看日志排查"
  exit 1
fi

# ---------- Nginx ----------
if [[ "$SKIP_NGINX" -eq 0 ]]; then
  if ! command -v nginx >/dev/null 2>&1; then
    warn "未安装 Nginx，跳过反向代理配置。安装后可用以下命令生成配置："
    dim "sed 's/chess.example.com/$DOMAIN/g' deploy/nginx.conf | sudo tee /etc/nginx/conf.d/$APPNAME.conf"
  else
    if [[ -z "$DOMAIN" ]]; then
      warn "未提供 --domain，Nginx 仍使用占位域名 chess.example.com"
      DOMAIN="chess.example.com"
    fi
    info "写入 Nginx 配置（域名 $DOMAIN）"
    NGX_DIR="/etc/nginx/conf.d"
    [[ -d /etc/nginx/sites-enabled ]] && NGX_DIR="/etc/nginx/sites-available"
    sed -e "s/chess\.example\.com/$DOMAIN/g" \
        -e "s|server 127\.0\.0\.1:3000;|server 127.0.0.1:$PORT;|g" \
        deploy/nginx.conf | $SUDO tee "$NGX_DIR/$APPNAME.conf" >/dev/null
    if [[ "$NGX_DIR" == "/etc/nginx/sites-available" ]]; then
      $SUDO ln -sf "$NGX_DIR/$APPNAME.conf" "/etc/nginx/sites-enabled/$APPNAME"
    fi
    if $SUDO nginx -t 2>/dev/null; then
      $SUDO systemctl reload nginx
      info "Nginx 已重载"
    else
      err "Nginx 配置校验失败，请检查 $NGX_DIR/$APPNAME.conf"
      exit 1
    fi

    if [[ "$DO_CERT" -eq 1 ]]; then
      if command -v certbot >/dev/null 2>&1; then
        info "申请 HTTPS 证书"
        $SUDO certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@$DOMAIN" || \
          warn "证书申请失败（域名是否已解析到本机？）"
      else
        warn "未安装 certbot，可执行：apt install -y certbot python3-certbot-nginx"
      fi
    fi
  fi
fi

echo
info "部署完成 🎉"
if [[ -n "$DOMAIN" && "$DOMAIN" != "chess.example.com" ]]; then
  dim "访问地址： http://$DOMAIN/"
  dim "健康检查： curl http://$DOMAIN/healthz"
else
  dim "本机访问： http://127.0.0.1:$PORT/"
fi
dim "更新代码：sudo bash $DIR/deploy/install.sh --domain $DOMAIN --repo $REPO"
dim "查看状态：pm2 status $APPNAME"
