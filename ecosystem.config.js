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
      HOST: '0.0.0.0'
    },
    max_memory_restart: '300M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    merge_logs: true
  }]
};
