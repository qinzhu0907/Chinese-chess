/* PM2 部署配置：pm2 start ecosystem.config.js --env production */
module.exports = {
  apps: [{
    name: 'xiangqi',
    script: 'server.js',
    instances: 1,            // 联机状态在内存中，多实例需配 Redis Adapter + 粘滞会话
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'development',
      PORT: 3000,
      HOST: '0.0.0.0'
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
      HOST: '0.0.0.0',
      PER_MOVE: 60,            // 每步默认限时（秒），0 = 不限
      RECONNECT_GRACE: 120000, // 掉线后座位保留 2 分钟
      MAX_ROOMS: 4000
    },
    max_memory_restart: '400M',
    kill_timeout: 6000,        // 配合服务端 SIGTERM 优雅退出
    wait_ready: false,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    merge_logs: true
  }]
};
