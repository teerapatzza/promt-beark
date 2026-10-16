FROM node:20-alpine

# better-sqlite3 ต้องการ tools เพื่อ compile native module
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY backend/package*.json ./
RUN npm install --omit=dev

# คัดลอกไฟล์ .js ทั้งหมด ไม่ไล่ทีละชื่อ
# เดิมไล่ชื่อทีละไฟล์ พอเพิ่มโมดูลใหม่แล้วลืมเติมตรงนี้ backend จะพังตอนเริ่มทำงาน
# ด้วย MODULE_NOT_FOUND ทั้งที่โค้ดถูกต้องทุกอย่าง (เจอจริง 22 ก.ย. 2569 กับ longdo-fetch.js)
COPY backend/*.js ./

# ขอบเขตจังหวัด กทม.ปริมณฑล อยู่ใน public/ เพราะหน้าเว็บโหลดไฟล์นี้ตรงๆ
# backend ใช้ไฟล์เดียวกัน จงใจให้กฎมีที่เดียว จะได้ไม่ตัดสินคนละแบบกับหน้าเว็บ
# จึงต้อง build จากรากโปรเจกต์ (docker-compose ตั้ง context: . ไว้ให้แล้ว)
# วางไว้ที่ /public เพื่อให้ require('../public/metro-area.js') จาก /app หาเจอ
COPY public/metro-area.js /public/metro-area.js

RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "server.js"]
