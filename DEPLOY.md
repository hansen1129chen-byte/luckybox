# LUCKYBOX Label Printer - 部署指南

## 一、服务器

- UCloud / 阿里云 轻量 2核2G + Linux (Alibaba Cloud Linux 3 / Ubuntu 22.04)
- 安全组开放: 22(SSH) 80(HTTP) 443(HTTPS)

## 二、安装基础环境

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs mysql-server nginx
npm install -g pm2
```

## 三、MySQL

```bash
systemctl enable mysqld && systemctl start mysqld
mysql -u root -e "CREATE DATABASE IF NOT EXISTS label_printer DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

## 四、上传代码

本地打包:
```bash
cd C:\Users\Honor\label-printer\client
npm run build
cd ..
tar -czf deploy.tar.gz -C server src package.json package-lock.json .env -C ../client dist
scp deploy.tar.gz root@IP:/opt/
```

服务器解压（**必须先创建目录，tar -C 指定目标**）:
```bash
mkdir -p /opt/label-printer
cd /opt && tar -xzf deploy.tar.gz -C label-printer/
cd /opt/label-printer && mkdir -p uploads && npm install --omit=dev
```

## 五、配置 .env

```bash
cat > /opt/label-printer/.env << 'EOF'
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=label_printer
JWT_SECRET=label_printer_secret_2026
PORT=3001
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
EOF
```

## 六、初始化数据库表

```bash
mysql -u root label_printer < /opt/label-printer/database/init.sql
```

## 七、启动后端

```bash
cd /opt/label-printer && pm2 start src/server.js --name lp-api && pm2 save
```

## 八、Nginx

```bash
cat > /etc/nginx/conf.d/label.conf << 'EOF'
server {
    listen 80;
    server_name parfco.vip www.parfco.vip;
    root /opt/label-printer/dist;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
    location /api/ { proxy_pass http://127.0.0.1:3001; proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; }
    location /uploads/ { proxy_pass http://127.0.0.1:3001; proxy_set_header Host $host; }
}
EOF
nginx -t && systemctl restart nginx
```

## 九、HTTPS

```bash
dnf install -y certbot python3-certbot-nginx
certbot --nginx -d parfco.vip -d www.parfco.vip
```

## 十、开机自启

```bash
pm2 startup && pm2 save
systemctl enable nginx mysqld
```

## 十一、更新部署流程

```bash
# 本地
cd client && npm run build && cd ..
tar -czf deploy.tar.gz -C server src package.json package-lock.json .env -C ../client dist
scp deploy.tar.gz root@IP:/opt/

# 服务器
cd /opt && tar -xzf deploy.tar.gz -C label-printer/
cd /opt/label-printer && npm install --omit=dev && pm2 restart lp-api
# 记得 .env 的 DB_PASSWORD 被覆盖的话要改回空
```

## 十二、已踩过的坑

1. ❌ `tar -xzf deploy.tar.gz` 不带 `-C` 会散落到当前目录 → 必须用 `-C label-printer/`
2. ❌ 前端 dist 目录解压后没被移进项目 → `-C` 解压到正确目录一步到位
3. ❌ `npm install --production` 会删掉 multer 等依赖 → 用 `--omit=dev`
4. ❌ 域名解析后要等几分钟才生效
5. ❌ 安全组必须开 80 和 443
6. ❌ 每次 tar 更新会覆盖 .env → 本地 .env 的 DB_PASSWORD 要清空再打包，或更新后改回
