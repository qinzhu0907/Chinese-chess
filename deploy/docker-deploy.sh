#!/usr/bin/env bash
# 中国象棋 · Docker 一键部署脚本
#
# 用法（在服务器上，项目根目录执行）：
#   bash deploy/docker-deploy.sh up                     # 起服务，先用 http://服务器IP 访问
#   bash deploy/docker-deploy.sh ssl 你的域名 你的邮箱    # 签 HTTPS 证书并切成 443
#   bash deploy/docker-deploy.sh renew                  # 续期证书（建议加进 crontab）
#   bash deploy/docker-deploy.sh status                 # 查看容器与健康状态
#   bash deploy/docker-deploy.sh logs                   # 跟踪应用日志
#   bash deploy/docker-deploy.sh down                   # 停止并移除容器（数据在卷里，不丢）
#
# 前置条件：已安装 Docker 20+ 与 docker compose v2；80/443 端口未被本机其他程序占用；
#          申请证书时域名必须已解析到本机且 80 端口对外可达。

set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE="deploy/docker-compose.stack.yml"
DC="docker compose -f ${COMPOSE_FILE}"
CONF="deploy/nginx.active.conf"
TPL_PLAIN="deploy/nginx.docker.conf"
TPL_SSL="deploy/nginx.ssl.conf.tpl"

c_ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
c_info() { printf '\033[36m→ %s\033[0m\n' "$*"; }
c_err()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; }

usage() {
  sed -n '3,14p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

require_docker() {
  command -v docker >/dev/null 2>&1 || { c_err "未安装 Docker，请先安装：https://docs.docker.com/engine/install/"; exit 1; }
  docker compose version >/dev/null 2>&1 || { c_err "缺少 docker compose v2（命令应为 docker compose 而非 docker-compose）"; exit 1; }
  docker info >/dev/null 2>&1 || { c_err "Docker 守护进程未运行，或当前用户无权限（试试 sudo 或把用户加入 docker 组）"; exit 1; }
}

ensure_conf() {
  if [ ! -f "$CONF" ]; then
    cp "$TPL_PLAIN" "$CONF"
    c_info "已生成 $CONF（HTTP 版）"
  fi
}

wait_health() {
  local i
  for i in $(seq 1 40); do
    if curl -fs "http://127.0.0.1:${HTTP_PORT:-80}/healthz" >/dev/null 2>&1; then
      c_ok "健康检查通过（第 ${i} 秒）"
      return 0
    fi
    sleep 1
  done
  c_err "健康检查超时，容器日志："
  $DC logs --tail 40 xiangqi || true
  return 1
}

cmd_up() {
  require_docker
  ensure_conf
  c_info "构建并启动容器（首次构建约 1-3 分钟）…"
  $DC up -d --build
  c_info "等待应用就绪…"
  wait_health || exit 1
  $DC ps
  echo
  c_ok "服务已启动：http://$(curl -s -m 3 https://api.ipify.org 2>/dev/null || echo '服务器IP')"
  echo "  下一步（有域名的话）：bash deploy/docker-deploy.sh ssl 你的域名 你的邮箱"
}

cmd_ssl() {
  local domain="${1:-}" email="${2:-}"
  [ -n "$domain" ] || { c_err "用法：bash deploy/docker-deploy.sh ssl 你的域名 你的邮箱"; exit 1; }
  [ -n "$email" ]  || { c_err "请提供用于证书通知的邮箱"; exit 1; }
  require_docker
  ensure_conf

  c_info "1/4 确认服务在跑…"
  $DC up -d
  wait_health || exit 1

  c_info "2/4 申请证书（Let's Encrypt，域名 $domain）…"
  $DC --profile cert run --rm certbot certonly \
    --webroot -w /var/www/certbot \
    -d "$domain" --email "$email" \
    --agree-tos --no-eff-email --non-interactive

  c_info "3/4 切换到 HTTPS 配置…"
  sed "s/__DOMAIN__/${domain}/g" "$TPL_SSL" > "$CONF"
  $DC exec nginx nginx -t
  $DC exec nginx nginx -s reload

  c_info "4/4 验证…"
  sleep 1
  if curl -fs "https://${domain}/healthz" >/dev/null 2>&1; then
    c_ok "HTTPS 已生效：https://${domain}"
  else
    c_err "HTTPS 验证失败，请检查域名解析与 443 端口；配置已写入 $CONF"
    exit 1
  fi
  echo
  echo "建议把自动续期加进 crontab（每天 03:30 检查，证书到期前 30 天自动续）："
  echo "  echo '30 3 * * * cd $(pwd) && bash deploy/docker-deploy.sh renew >> /var/log/xiangqi-renew.log 2>&1' | sudo crontab -"
}

cmd_renew() {
  require_docker
  $DC --profile cert run --rm certbot renew --webroot -w /var/www/certbot --quiet
  $DC exec nginx nginx -s reload
  c_ok "证书续期检查完成并已重载 Nginx"
}

cmd_status() {
  require_docker
  $DC ps
  echo
  printf '健康检查：'
  curl -fs "http://127.0.0.1:${HTTP_PORT:-80}/healthz" || printf '失败'
  echo
}

cmd_logs() { require_docker; $DC logs -f --tail 100 xiangqi; }
cmd_down() { require_docker; $DC down; c_ok "已停止（证书与数据卷保留）"; }

case "${1:-}" in
  up)     shift; cmd_up "$@" ;;
  ssl)    shift; cmd_ssl "$@" ;;
  renew)  shift; cmd_renew "$@" ;;
  status) shift; cmd_status "$@" ;;
  logs)   shift; cmd_logs "$@" ;;
  down)   shift; cmd_down "$@" ;;
  -h|--help|help) usage 0 ;;
  *) usage 1 ;;
esac
