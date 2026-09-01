FROM nginx:1.27-alpine

RUN apk add --no-cache gettext

# ── ป้ายบอกเวอร์ชัน ──────────────────────────────────────────
# APP_ENV  : UAT หรือ PROD (docker-compose ของแต่ละฝั่งส่งมาให้)
# VERSION  : อ่านจากไฟล์ VERSION ที่รากโปรเจกต์ แหล่งความจริงเดียว
# เขียนเป็น version.json ตอน build เพื่อให้หน้าเว็บอ่านได้
# ไม่ต้องแก้โค้ดเวลาออกเวอร์ชันใหม่ แค่แก้ไฟล์ VERSION แล้ว build
ARG APP_ENV=PROD
COPY VERSION /tmp/VERSION

COPY docker/nginx.conf /etc/nginx/templates/default.conf.template
COPY public/ /usr/share/nginx/html/

RUN printf '{"version":"%s","env":"%s","builtAt":"%s"}\n' \
      "$(tr -d ' \n\r' < /tmp/VERSION)" \
      "$APP_ENV" \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    > /usr/share/nginx/html/version.json \
 && rm /tmp/VERSION \
 && cat /usr/share/nginx/html/version.json

EXPOSE 80

CMD ["/bin/sh", "-c", "envsubst '${BACKEND_HOST} ${BACKEND_PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
