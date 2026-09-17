#!/bin/bash
# ══════════════════════════════════════════════════════════════════
#  ตรวจว่าทำไมล็อกอินด้วย Microsoft 365 แล้วเด้งกลับหน้า login
#  อ่านอย่างเดียว ไม่แก้ไขอะไรทั้งสิ้น ไม่แตะแอปของทีมอื่น
#  ใช้: bash diag-365-login.sh
# ══════════════════════════════════════════════════════════════════
set -u
APP=/home/teerapat/promt-beark
line(){ printf '\n─── %s ───\n' "$1"; }

echo "════════ ตรวจการล็อกอิน Microsoft 365 · $(date '+%F %T') ════════"

line "1. คอนเทนเนอร์ของพร้อมเบิกยังทำงานอยู่ไหม"
docker ps --filter "name=promt-beark" --format '  {{.Names}}  {{.Status}}  {{.Ports}}' 2>/dev/null \
  || echo "  อ่านสถานะ docker ไม่ได้"

line "2. log ของการล็อกอิน 365 (50 บรรทัดล่าสุด)"
BE=$(docker ps --filter "name=promt-beark" --format '{{.Names}}' 2>/dev/null | grep -i -m1 -E 'backend|api|app')
if [ -n "${BE:-}" ]; then
  echo "  อ่านจากคอนเทนเนอร์: $BE"
  docker logs --tail 400 "$BE" 2>&1 | grep -i -E "microsoft-auth|AADSTS|ล้มเหลว|ยังไม่มีบัญชี" | tail -50 \
    | sed 's/^/    /' || echo "    ไม่พบบรรทัดที่เกี่ยวข้อง"
  echo ""
  echo "  ── บรรทัดตอนระบบเริ่มทำงาน (บอกว่าเปิด M365 ไหม redirect ตรงไหม) ──"
  docker logs "$BE" 2>&1 | grep -i "microsoft-auth" | head -5 | sed 's/^/    /'
else
  echo "  หาคอนเทนเนอร์ backend ไม่เจอ — ลองดูชื่อจากข้อ 1 แล้วรัน:"
  echo "    docker logs --tail 400 <ชื่อ> 2>&1 | grep -i microsoft-auth"
fi

line "3. ค่าที่ตั้งไว้ใน .env (ซ่อนรหัสลับ)"
if [ -f "$APP/.env" ]; then
  grep -E "^MS_" "$APP/.env" 2>/dev/null | sed -E 's/(MS_CLIENT_SECRET=).*/\1********ซ่อนไว้********/' | sed 's/^/    /'
  echo "    ── ต้องเป็น: MS_REDIRECT_URI=https://promberk.ha.or.th/auth/microsoft/callback"
else
  echo "    ไม่พบไฟล์ $APP/.env"
fi

line "4. บัญชีในฐานข้อมูล (ชื่อผู้ใช้ + สิทธิ์ ไม่แสดงรหัสผ่าน)"
DB=$(docker ps --filter "name=promt-beark" --format '{{.Names}}' 2>/dev/null | head -1)
if [ -n "${DB:-}" ]; then
  docker exec "$DB" sh -lc '
    for f in /app/data/database.db /app/database.db /data/database.db; do
      [ -f "$f" ] && { echo "    ไฟล์ฐานข้อมูล: $f"; \
        sqlite3 "$f" "SELECT printf(\"    %-38s %-10s id=%d\", email, role, id) FROM users ORDER BY id;" 2>/dev/null; \
        echo ""; \
        echo "    จำนวน session ที่ยังไม่หมดอายุ:"; \
        sqlite3 "$f" "SELECT printf(\"      %d รายการ\", COUNT(*)) FROM sessions WHERE expires_at > datetime(\"now\");" 2>/dev/null; \
        break; }
    done' 2>/dev/null || echo "    อ่านฐานข้อมูลไม่ได้ (อาจไม่มี sqlite3 ในคอนเทนเนอร์)"
fi

line "5. นาฬิกาของเซิร์ฟเวอร์ (ถ้าเพี้ยน session จะหมดอายุทันที)"
echo "    เวลาเครื่อง : $(date '+%F %T %Z')"
echo "    เวลา UTC   : $(date -u '+%F %T')"
command -v timedatectl >/dev/null && timedatectl 2>/dev/null | grep -iE "synchron|NTP" | sed 's/^/    /'

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  ส่งผลทั้งหมดนี้กลับมาให้ผมดู  (รหัสลับถูกซ่อนไว้แล้ว ปลอดภัย)"
echo "════════════════════════════════════════════════════════════════"
