# Texas Hold'em Online — 静的配信 (単一 HTML。対戦の中継は Firebase)
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY texas-poker-online.html /usr/share/nginx/html/texas-poker-online.html
COPY texas-poker-online.html /usr/share/nginx/html/index.html
EXPOSE 80
