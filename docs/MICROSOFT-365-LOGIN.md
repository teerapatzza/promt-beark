# เข้าสู่ระบบด้วย Microsoft 365

สร้าง 1 ก.ย. 2026 · โค้ดพร้อมแล้ว รอค่าตั้งค่าจาก IT

---

## 1. ข้อความขอ IT (ส่งได้เลย)

> เรียนทีม IT
>
> ขอความอนุเคราะห์ลงทะเบียนแอปใน **Microsoft Entra ID** สำหรับระบบเบิกค่าใช้จ่าย
> "พร้อมเบิก" (`https://promberk.ha.or.th`) ครับ
>
> **ค่าที่ขอ 3 ตัว**
> - Application (client) ID
> - Directory (tenant) ID
> - Client secret (พร้อมวันหมดอายุ)
>
> **Redirect URI ที่ต้องลงทะเบียน** (แพลตฟอร์ม **Web** — ต้องตรงทุกตัวอักษร)
> - `https://promberk.ha.or.th/auth/microsoft/callback` — ระบบจริง
> - `http://localhost:8081/auth/microsoft/callback` — เครื่องทดสอบ
>
> (ตัวที่สองเป็น `http://` ได้ เพราะ Entra ยกเว้นให้ localhost โดยเฉพาะ — ยืนยันจากเอกสาร
> Microsoft แล้ว ถ้านโยบายองค์กรไม่อนุญาต ขอเป็น app registration แยกสำหรับ dev แทนได้ครับ)
>
> **สิทธิ์ที่ขอ** (Microsoft Graph, delegated): `openid`, `profile`, `email`
> อ่านแค่ชื่อกับอีเมลเพื่อยืนยันตัวตน **ไม่เข้าถึงเมล ปฏิทิน หรือไฟล์**
>
> **ไม่ต้องขอ** admin consent ระดับองค์กร ถ้านโยบายอนุญาตให้ผู้ใช้ยินยอมเองได้
>
> การส่งค่า: ขอเป็นช่องทางที่ปลอดภัย เช่น ไฟล์ใส่รหัส หรือส่งมือ
> **client secret ห้ามส่งผ่านแชตแบบเปิด** — ระบบนี้เก็บโค้ดใน repo สาธารณะ

---

## 2. เมื่อได้ค่ามาแล้ว ทำอะไร

ใส่ค่าลงไฟล์ `.env` (ไฟล์นี้ไม่อยู่ใน git) — **ไม่ต้องแก้โค้ดเลย**

```bash
# UAT: d:\Manny\promt-beark-v2\.env
MS_TENANT_ID=<Directory (tenant) ID>
MS_CLIENT_ID=<Application (client) ID>
MS_CLIENT_SECRET=<Client secret>
MS_REDIRECT_URI=http://localhost:8081/auth/microsoft/callback
```

```bash
# Production: /home/teerapat/promt-beark/.env บนเซิร์ฟเวอร์
MS_REDIRECT_URI=https://promberk.ha.or.th/auth/microsoft/callback
```

แล้วสั่ง `docker compose up -d backend` — ระบบจะเปิดฟีเจอร์เอง

**ทดสอบที่ UAT ก่อนเสมอ** ระบบล็อกอินคือประตูหน้าบ้าน พังแล้วไม่มีใครเข้าได้รวมทั้งตัวเอง

---

## 3. พฤติกรรมของระบบ

| สถานการณ์ | ผลลัพธ์ |
|---|---|
| `MS_*` ยังว่าง (ตอนนี้) | ปุ่ม Microsoft ซ่อน · ล็อกอินด้วยรหัสผ่านได้ทุกคน · สมัครเองได้ — **เหมือนเดิมทุกอย่าง** |
| ตั้ง `MS_*` ครบ 4 ตัว | ปุ่ม Microsoft แสดง · **สมัครเองถูกปิด (403)** · รหัสผ่านเหลือเฉพาะ admin |
| ผู้ใช้ทั่วไปล็อกอินด้วยรหัสผ่านตอนเปิด M365 | **403** พร้อมข้อความให้ใช้ Microsoft |
| ผู้ใช้ใหม่ล็อกอิน M365 ครั้งแรก | สร้างบัญชีให้อัตโนมัติ role = `user` (ปิดได้ด้วย `MS_AUTO_CREATE_USERS=false`) |
| บัญชีที่เกิดจาก M365 พยายามใช้รหัสผ่าน | **403** บัญชีนั้นไม่มีรหัสผ่าน |

**ทางเข้าสำรอง:** admin ยังล็อกอินด้วยรหัสผ่านได้เสมอ เผื่อ Entra ล่มหรือตั้งค่าผิด
ถ้าเอาข้อนี้ออก แล้ววันหนึ่ง Entra มีปัญหา จะเข้าระบบไม่ได้เลยและต้องแก้ผ่าน SSH เข้าฐานข้อมูลตรงๆ

---

## 4. ไฟล์ที่เกี่ยวข้อง

| ไฟล์ | หน้าที่ |
|---|---|
| `backend/microsoft-auth.js` | ทั้งหมดของ OAuth flow — แยกไฟล์ ไม่ปนกับ server.js |
| `backend/server.js` | เรียก `mountMicrosoftAuth()` + กฎปิดสมัครเอง/จำกัดรหัสผ่าน |
| `public/login.html` | ปุ่ม Microsoft + รับ token กลับจาก `#ms=` |
| `.env` | ความลับจริง **ไม่อยู่ใน git** |
| `.env.example` | แม่แบบ ไม่มีความลับ commit ได้ |

**ไม่ได้เพิ่ม dependency ใหม่เลย** Node 20 มี `fetch` และ `crypto` ในตัวแล้ว

### ทำไมไม่ตรวจลายเซ็น id_token ด้วย JWKS

`id_token` ไม่ได้มาจากเบราว์เซอร์ แต่เซิร์ฟเวอร์เราไปแลกมาเองจาก
`login.microsoftonline.com` ผ่าน TLS ด้วย client secret ช่องทางนี้เชื่อถือได้อยู่แล้ว
สิ่งที่ยังต้องตรวจคือ *เนื้อหา* ว่าเป็นของ tenant และ app เรา ซึ่งตรวจครบ:
`tid` ตรง tenant · `aud` ตรง client id · `exp` ยังไม่หมดอายุ

**ถ้าวันหน้าเปลี่ยนไปใช้ implicit flow หรือรับ token จากฝั่งเบราว์เซอร์ ต้องกลับมาตรวจลายเซ็นด้วย**

---

## 5. ผลการทดสอบ (1 ก.ย. 2026 บน UAT ด้วยค่าปลอม)

ทดสอบตรรกะได้ครบโดยไม่ต้องมีค่าจริง เพราะการสร้าง URL และกฎต่างๆ ไม่ต้องคุยกับ Microsoft

| ทดสอบ | ผล |
|---|---|
| ยังไม่ตั้งค่า → `/auth/config` | `microsoftEnabled:false` ปุ่มซ่อน ✓ |
| ตั้งค่าแล้ว → `/auth/config` | `microsoftEnabled:true, passwordLoginFor:"admin"` ✓ |
| `/auth/microsoft` | 302 ไป `login.microsoftonline.com/<tenant>/oauth2/v2.0/authorize` พร้อม state ✓ |
| callback ปลอม (ไม่มี state) | ปฏิเสธ + พากลับ `/login.html?error=…` ✓ (กัน CSRF) |
| admin + รหัสถูก | 200 ✓ |
| user + รหัสถูก | **403** ให้ไปใช้ Microsoft ✓ |
| admin + รหัสผิด | 401 (ไม่บอกว่าบัญชีมีจริงไหม) ✓ |
| ปิดค่ากลับ | ทุกอย่างกลับเป็นเหมือนเดิม user ล็อกอินได้ 200 ✓ |

**ยังทดสอบไม่ได้จนกว่าจะได้ค่าจริง:** การแลก code กับ Microsoft · การอ่าน claims จริง · การสร้างบัญชีอัตโนมัติ

### วิธีสร้างบัญชีทดสอบใน UAT (ถ้าต้องทดสอบกฎอีก)

```bash
docker exec promt-beark-v2-backend-1 node -e "
const db=require('better-sqlite3')('/app/data/prompt-berk.db');
const h=require('bcryptjs').hashSync('TestOnly123!',12);
for(const [em,ro] of [['uat-admin@ha.or.th','admin'],['uat-user@ha.or.th','user']])
  db.prepare('INSERT OR REPLACE INTO users (id,email,password_hash,role) VALUES ((SELECT id FROM users WHERE email=?),?,?,?)').run(em,em,h,ro);
"
```
ลบทิ้งเมื่อเสร็จ: `DELETE FROM users WHERE email LIKE 'uat-%@ha.or.th'`

---

## 6. กฎ Redirect URI ของ Entra (ยืนยันจากเอกสารทางการ 1 ก.ย. 2026)

ที่มา: [Redirect URI (reply URL) best practices and limitations](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)

- **`http://` ใช้ได้เฉพาะ localhost เท่านั้น** — `http://localhost` และ `http://localhost/abc` = Valid
  ส่วน `http://contoso.com/...` = Invalid (อ้างอิง RFC 8252 การ redirect ไม่เคยออกจากเครื่อง)
- **หมายเลขพอร์ตถูกมองข้ามสำหรับ localhost** — `http://localhost:8081/x` กับ `http://localhost/x` ถือว่าตรงกัน
  ⚠️ **ห้ามลงทะเบียน localhost หลายอันที่ต่างกันแค่พอร์ต** เซิร์ฟเวอร์จะเลือกมาอันเดียวแบบสุ่ม
  ถ้าต้องมีหลายอัน ให้ต่างกันที่ **path** แทน
- **Microsoft แนะนำ `127.0.0.1` มากกว่า `localhost`** (กัน firewall/ชื่อ interface เพี้ยน)
  **แต่หน้าจอ Azure Portal ไม่ยอมให้พิมพ์ `http://127.0.0.1`** ต้องแก้ application manifest เป็น JSON
  → ของเราจึงใช้ `http://localhost:8081/...` ซึ่ง IT เพิ่มผ่านหน้าจอปกติได้เลย
- **path เป็น case-sensitive** — ของเราตัวพิมพ์เล็กหมด ปลอดภัย
- **ห้ามใช้อักขระ** `! $ ' ( ) , ;` ในredirect URI
- IPv6 loopback `[::1]` **ยังไม่รองรับ**
- ลงทะเบียนได้สูงสุด 256 URI ต่อแอป · ยาวได้ 256 ตัวอักษรต่ออัน

**แพลตฟอร์มที่ต้องเลือกคือ `Web`** เพราะเป็นเว็บที่ประมวลผลฝั่งเซิร์ฟเวอร์ (Node.js + client secret)
ไม่ใช่ `SPA` ซึ่งใช้กับ React/Angular ที่ไม่มี secret

---

## 7. เรื่องที่ต้องระวังตอนขึ้น production

1. **ต้องสร้าง `.env` บนเซิร์ฟเวอร์ก่อน deploy** — `LONGDO_API_KEY` ย้ายจากโค้ดมาอยู่ใน `.env` แล้ว
   ถ้าลืม การค้นหาสถานที่จะใช้ไม่ได้ (มีคำเตือนใน log ตอน start)
2. **กุญแจ Longdo ตัวเดิมถือว่าหลุดแล้ว** เพราะเคย commit ขึ้น repo สาธารณะ — ควรขอกุญแจใหม่จาก Longdo
3. **`/auth/config` และ `/auth/microsoft*` ต้องผ่าน nginx allowlist** — ขึ้นต้นด้วย `auth` จึงผ่านทั้งชั้นนอกและชั้นใน ✓ ตรวจแล้ว
4. **เข้าด้วยเลข IP จะล็อกอิน M365 ไม่ได้** เพราะคุกกี้ `state` ผูกกับโดเมน
   หน้าเว็บจะพาไป `promberk.ha.or.th` ให้เองก่อนเริ่ม (ดู `canonicalOrigin` ใน `/auth/config`)
5. **client secret มีวันหมดอายุ** (ปกติ 6–24 เดือน) — จดวันไว้ พอหมดคนจะล็อกอินไม่ได้ทั้งระบบ
