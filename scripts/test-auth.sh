#!/bin/bash
# พิสูจน์ว่าคุกกี้เก่าที่ค้างอยู่ต้องไม่บัง token ใหม่ที่เพิ่งล็อกอินได้
# รัน backend ตัวจริง (โค้ดที่แก้แล้ว) ในคอนเทนเนอร์ แล้วยิงทดสอบผ่าน HTTP จริง
export MSYS_NO_PATHCONV=1
B=http://127.0.0.1:3999
PASS=0; FAIL=0
ck(){ if [ "$2" = "$3" ]; then echo "  PASS  $1"; PASS=$((PASS+1));
      else echo "  FAIL  $1  → ได้ $2 ควรได้ $3"; FAIL=$((FAIL+1)); fi; }

docker rm -f authtest >/dev/null 2>&1
docker run -d --name authtest -p 3999:3000 \
  -v "d:/Manny/promt-beark/backend/server.js:/app/server.js:ro" \
  -v "d:/Manny/promt-beark/backend/microsoft-auth.js:/app/microsoft-auth.js:ro" \
  -v "d:/Manny/promt-beark/backend/validation.js:/app/validation.js:ro" \
  -e DB_PATH=/app/data/authtest.db \
  promt-beark-v2-backend >/dev/null

for i in $(seq 1 60); do
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 $B/auth/me 2>/dev/null)
  [ "$c" = "401" ] && break
  sleep 0.5
done
if [ "$c" != "401" ]; then echo "backend ไม่ขึ้น:"; docker logs authtest 2>&1|tail -12; exit 2; fi
echo "backend พร้อม (โค้ดที่แก้แล้ว)"

# สร้างบัญชีจริงผ่าน API เพื่อให้ได้ token ที่ใช้ได้จริง
REG=$(curl -s -X POST $B/auth/register -H 'Content-Type: application/json' \
      -d '{"email":"teerapat@ha.or.th","password":"testpass123"}')
FRESH=$(echo "$REG" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -z "$FRESH" ]; then echo "สมัครไม่สำเร็จ: $REG"; docker rm -f authtest>/dev/null; exit 2; fi
echo "ได้ token จริงจากการล็อกอิน: ${FRESH:0:12}…"
STALE="คุกกี้เก่าที่ถูกลบไปแล้ว-0000"

me(){ curl -s -o /dev/null -w '%{http_code}' --max-time 8 $B/auth/me "$@"; }

echo ""
echo "═══ อาการที่ผู้ใช้เจอ: คุกกี้เก่าค้างอยู่ + เพิ่งล็อกอินได้ token ใหม่ ═══"
ck "token ใหม่ต้องชนะคุกกี้เก่า" \
   "$(me -H "Authorization: Bearer $FRESH" -H "Cookie: session=$STALE")" 200
BODY=$(curl -s --max-time 8 $B/auth/me -H "Authorization: Bearer $FRESH" -H "Cookie: session=$STALE")
echo "$BODY" | grep -q "teerapat@ha.or.th" \
  && { echo "  PASS  ตอบกลับเป็นบัญชีที่ถูกต้อง"; PASS=$((PASS+1)); } \
  || { echo "  FAIL  ตอบกลับผิดบัญชี: $BODY"; FAIL=$((FAIL+1)); }

echo ""
echo "═══ เคสอื่นต้องไม่พังตามไปด้วย ═══"
ck "Bearer อย่างเดียว (ใช้ได้)"            "$(me -H "Authorization: Bearer $FRESH")" 200
ck "คุกกี้อย่างเดียว (ใช้ได้)"              "$(me -H "Cookie: session=$FRESH")" 200
ck "Bearer เสีย แต่คุกกี้ยังดี → ไม่บังกัน"  "$(me -H "Authorization: Bearer $STALE" -H "Cookie: session=$FRESH")" 200
ck "คุกกี้เสียอย่างเดียว → ปฏิเสธ"          "$(me -H "Cookie: session=$STALE")" 401
ck "Bearer เสียอย่างเดียว → ปฏิเสธ"         "$(me -H "Authorization: Bearer $STALE")" 401
ck "ไม่ส่งอะไรเลย → ปฏิเสธ"                 "$(me)" 401

echo ""
echo "═══ ออกจากระบบต้องลบทั้งใบใน header และใบในคุกกี้ ═══"
R2=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' \
     -d '{"email":"teerapat@ha.or.th","password":"testpass123"}')
T2=$(echo "$R2" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
curl -s -o /dev/null -X POST $B/auth/logout -H "Authorization: Bearer $FRESH" -H "Cookie: session=$T2"
ck "ใบที่อยู่ใน header ถูกลบ"  "$(me -H "Authorization: Bearer $FRESH")" 401
ck "ใบที่อยู่ในคุกกี้ถูกลบด้วย" "$(me -H "Authorization: Bearer $T2")" 401

echo ""
echo "════════════════════════════════════════════════════════"
echo "  ผ่าน $PASS · ตก $FAIL"
echo "════════════════════════════════════════════════════════"
docker rm -f authtest >/dev/null 2>&1
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)
