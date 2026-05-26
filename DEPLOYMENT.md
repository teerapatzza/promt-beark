# Prompt-Berk — ติดตั้งบนเซิร์ฟเวอร์ (Docker)

## สรุป Architecture

```
[ผู้ใช้] → nginx:8080 → static HTML (public/)
                      → proxy /budget-categories → Node.js:3000
                      → proxy /expenses          → Node.js:3000
                                                       ↓
                                                  SQLite (volume)
```

- **Frontend**: nginx เสิร์ฟ HTML/JS แบบ static
- **Backend**: Node.js + Express (port 3000, ไม่เปิดออกภายนอก)
- **Database**: SQLite ไฟล์เดียว เก็บใน Docker volume (`db_data`)

---

## รันบนเซิร์ฟเวอร์

จากโฟลเดอร์โปรเจกต์ (ต้องมี Docker + Docker Compose ติดตั้งแล้ว):

```bash
docker compose up -d --build
```

ตรวจสอบว่า container ขึ้นครบ:

```bash
docker compose ps
```

เปิดเบราว์เซอร์ไปที่:

```
http://<IP-หรือ-hostname-เซิร์ฟเวอร์>:8080/
```

ทดสอบ API ตอบ:

```bash
curl http://localhost:8080/budget-categories
```

---

## คนอื่นเข้าใช้ยังไง

1. **ต้องอยู่ในเครือข่ายที่เข้าถึงเซิร์ฟเวอร์ได้** (อินทราเน็ต / VPN / IP สาธารณะ)
2. ใช้ **เบราว์เซอร์** เปิด URL ด้านบน
3. ข้อมูลหมวดหมู่และรายการเบิกทุกคนจะ **เห็นร่วมกัน** เพราะเก็บในฐานข้อมูลเดียวกัน

---

## ข้อมูลส่วนไหนเก็บที่ไหน

| ข้อมูล | เก็บที่ | หมายเหตุ |
|--------|---------|---------|
| หมวดงบประมาณ (Admin) | SQLite บนเซิร์ฟเวอร์ | ทุกคนเห็นร่วมกัน |
| รายการเบิก | SQLite บนเซิร์ฟเวอร์ | ทุกคนเห็นร่วมกัน |
| โปรไฟล์ส่วนตัว | LocalStorage เบราว์เซอร์ | ใช้บนเครื่องตัวเอง |

---

## หยุด / อัปเดต

```bash
# หยุด
docker compose down

# อัปเดตโค้ดและ rebuild
docker compose up -d --build
```

> ข้อมูลในฐานข้อมูล (SQLite) **ไม่หายเมื่อ rebuild** เพราะเก็บใน volume `db_data`

## สำรองข้อมูล

```bash
# copy ไฟล์ฐานข้อมูลออกมา
docker compose cp backend:/app/data/prompt-berk.db ./backup-$(date +%Y%m%d).db
```

---

## ข้อจำกัดที่ยังคงอยู่

| หัวข้อ | รายละเอียด |
|--------|-------------|
| **ไม่มี login** | ใครรู้ URL ก็เข้าได้ — ใช้บนอินทราเน็ตหรือจำกัดไฟร์วอลล์ |
| **Longdo API key** | ฝังใน `expense.html` — หาก URL เปิดกว้าง ควรหารือ IT เรื่อง quota |
| **พาธย่อย (subpath)** | แนะนำ deploy ที่ root ของโดเมนหรือพอร์ต |

## ไฟล์ที่เกี่ยวข้อง

- `Dockerfile` — build image nginx (frontend)
- `backend/Dockerfile` — build image Node.js (backend)
- `docker-compose.yml` — orchestrate ทั้งสอง container + volume
- `docker/nginx.conf` — routing static + proxy API
- `backend/server.js` — Express API + SQLite
