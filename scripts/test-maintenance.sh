#!/usr/bin/env bash
# ตรวจสวิตช์ปิดปรับปรุงให้ครบทุกกรณีก่อนเอาขึ้นใช้จริง
#
# สิ่งที่ต้องพิสูจน์:
#   1. ตอนเปิดปกติ ทุกอย่างเข้าได้เหมือนเดิม
#   2. ตอนปิด ปิดสนิททุกทางเข้า ทั้งหน้าเว็บและ API
#   3. หน้าปิดปรับปรุงขึ้นจริง อ่านออก มีโลโก้
#   4. ลิงก์ลับเข้าได้ ลิงก์มั่วเข้าไม่ได้
#   5. เปิดกลับมาแล้วทุกอย่างเหมือนเดิมเป๊ะ และข้อมูลไม่ขยับ
#
#   ./scripts/test-maintenance.sh [URL]     ค่าเริ่มต้น http://localhost:8080
set -uo pipefail

APP="${1:-http://localhost:8080}"
TOKEN="$(grep -E '^MAINT_TOKEN=' .env 2>/dev/null | cut -d= -f2-)"
JAR="$(mktemp)"; trap 'rm -f "$JAR"' EXIT
PASS=0; FAIL=0

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@"; }
body() { curl -s --max-time 15 "$@"; }

ok() {  # ok "คำอธิบาย" ค่าที่ได้ ค่าที่ควรได้
    if [ "$2" = "$3" ]; then printf '  ผ่าน   %-52s %s\n' "$1" "$2"; PASS=$((PASS+1))
    else printf '  ตก     %-52s ได้ %s ควรได้ %s\n' "$1" "$2" "$3"; FAIL=$((FAIL+1)); fi
}
has() {  # has "คำอธิบาย" ข้อความ คำที่ต้องมี
    if printf '%s' "$2" | grep -q "$3"; then printf '  ผ่าน   %-52s พบข้อความ\n' "$1"; PASS=$((PASS+1))
    else printf '  ตก     %-52s ไม่พบ "%s"\n' "$1" "$3"; FAIL=$((FAIL+1)); fi
}

[ -n "$TOKEN" ] || { echo "หยุด: ไม่พบ MAINT_TOKEN ใน .env"; exit 2; }

echo "═══ 1. ก่อนปิด — ทุกอย่างต้องใช้งานได้ตามปกติ ═══"
for p in / /login.html /expense.html /history.html /admin.html /profile.html /portal.html \
         /index.html /app-logo.png /version.json /auth-guard.js /prompt/; do
    ok "$p" "$(code "$APP$p")" 200
done
ok "/health (backend)"          "$(code "$APP/health")" 200
ok "/maintenance.html เข้าตรงๆ ไม่ได้" "$(code "$APP/maintenance.html")" 404

# พฤติกรรมเดิมของคอนเทนเนอร์ที่เจอระหว่างทำสวิตช์นี้ ไม่ใช่ของใหม่:
# /prompt/<ไฟล์>.html ยิงตรงเข้าคอนเทนเนอร์แล้วได้ 404 (ยืนยันกับ container production
# ที่ยังใช้โค้ดเดิมแล้ว) ผู้ใช้ไม่เจอเพราะ nginx ของโฮสต์แปลง /prompt/x เป็น /x ให้ก่อนส่งมา
# ตรึงไว้เป็นเทสต์ เพื่อให้รู้ทันทีถ้าวันหนึ่งมันเปลี่ยน
# ยิงตรงเข้าคอนเทนเนอร์ได้ 404 แต่ผ่านโฮสต์ได้ 200 เพราะโฮสต์แปลง path ให้ก่อน
# ตรวจตามที่ยิงเข้ามาจริง จะได้ไม่หลอกตัวเองว่าผ่านทั้งที่คนละเส้นทาง
case "$APP" in
  *localhost*|*127.0.0.1*)
      ok "/prompt/login.html ยิงตรงคอนเทนเนอร์ = 404 (พฤติกรรมเดิม)" \
         "$(code "$APP/prompt/login.html")" 404 ;;
  *)  ok "/prompt/login.html ผ่านโฮสต์ = 200 (โฮสต์แปลง path ให้)" \
         "$(code "$APP/prompt/login.html")" 200 ;;
esac

echo ""
echo "═══ 2. สั่งปิด ═══"
./scripts/maintenance.sh on >/dev/null
echo "  ปิดแล้ว (สร้างไฟล์ maint/ON) ไม่ได้ reload ไม่ได้ restart อะไรเลย"

echo ""
echo "═══ 3. ตอนปิด — ต้องปิดสนิททุกทางเข้า ═══"
for p in / /login.html /expense.html /history.html /admin.html /profile.html /portal.html \
         /index.html /version.json /auth-guard.js /prompt/ /prompt/login.html /prompt/expense.html; do
    ok "$p" "$(code "$APP$p")" 503
done
ok "API GET /expenses"  "$(code "$APP/expenses")" 503
ok "API GET /profiles"  "$(code "$APP/profiles")" 503
ok "API POST /auth/login" \
   "$(code -X POST -H 'Content-Type: application/json' -d '{}' "$APP/auth/login")" 503
ok "/app-logo.png ยังโหลดได้ (โลโก้บนหน้าปิด)" "$(code "$APP/app-logo.png")" 200
ok "/health ยังเช็คได้"  "$(code "$APP/health")" 200

echo ""
echo "═══ 4. หน้าปิดปรับปรุงต้องอ่านรู้เรื่อง ═══"
PAGE="$(body "$APP/login.html")"
has "มีหัวข้อบอกว่าปิดปรับปรุง"   "$PAGE" "ปิดปรับปรุงชั่วคราว"
has "บอกว่าข้อมูลไม่หาย"          "$PAGE" "ข้อมูลของท่านอยู่ครบถ้วน"
has "มีปุ่มให้ลองใหม่"            "$PAGE" "ลองเข้าใหม่อีกครั้ง"
has "เรียกโลโก้"                  "$PAGE" "app-logo.png"
has "ไม่ยอมให้เบราว์เซอร์จำหน้านี้" "$(curl -sI --max-time 15 "$APP/login.html")" "no-store"
ok  "ไม่มีร่องรอยแอปหลุดออกมา" \
    "$(printf '%s' "$PAGE" | grep -c 'categorySelect\|submitBtn')" 0

echo ""
echo "═══ 5. ลิงก์ลับของทีมงาน ═══"
ok "ลิงก์ลับตอบ 302 (ส่งคุกกี้ให้)" \
   "$(code -c "$JAR" "$APP/__maint-bypass/$TOKEN")" 302
has "ตั้งคุกกี้จริง" "$(cat "$JAR")" "pbdev"
ok "ลิงก์มั่วเข้าไม่ได้" "$(code "$APP/__maint-bypass/ลองเดามั่ว")" 404
ok "เดาถูกครึ่งเดียวก็ไม่ได้"  "$(code "$APP/__maint-bypass/${TOKEN:0:8}")" 404

echo ""
echo "═══ 6. มีคุกกี้แล้วต้องใช้งานได้เต็มที่ ขณะที่คนอื่นยังเห็นหน้าปิด ═══"
for p in /login.html /expense.html /history.html /admin.html /prompt/; do
    ok "มีคุกกี้: $p" "$(code -b "$JAR" "$APP$p")" 200
done
ok "มีคุกกี้: API /expenses ตอบไม่ใช่ 503" \
   "$([ "$(code -b "$JAR" "$APP/expenses")" = 503 ] && echo ใช่ || echo ไม่ใช่)" "ไม่ใช่"
ok "คนที่ไม่มีคุกกี้ยังเห็นหน้าปิดอยู่" "$(code "$APP/login.html")" 503
ok "ยกเลิกสิทธิ์ตัวเองได้"  "$(code -c "$JAR" "$APP/__maint-bypass/off")" 302
ok "ยกเลิกแล้วเห็นหน้าปิดเหมือนคนทั่วไป" "$(code -b "$JAR" "$APP/login.html")" 503

echo ""
echo "═══ 7. เปิดกลับ — ต้องกลับมาเหมือนเดิมเป๊ะ ═══"
./scripts/maintenance.sh off >/dev/null
for p in / /login.html /expense.html /history.html /admin.html /profile.html /portal.html \
         /index.html /app-logo.png /version.json /auth-guard.js /prompt/; do
    ok "$p" "$(code "$APP$p")" 200
done
ok "/maintenance.html ซ่อนกลับเหมือนเดิม" "$(code "$APP/maintenance.html")" 404
ok "API /expenses กลับมาไม่ใช่ 503" \
   "$([ "$(code "$APP/expenses")" = 503 ] && echo ใช่ || echo ไม่ใช่)" "ไม่ใช่"

echo ""
echo "═══ 8. สลับรัว ๆ 5 รอบ ต้องนิ่งทุกรอบ ═══"
for i in 1 2 3 4 5; do
    ./scripts/maintenance.sh on  >/dev/null; A=$(code "$APP/login.html")
    ./scripts/maintenance.sh off >/dev/null; B=$(code "$APP/login.html")
    ok "รอบ $i ปิดแล้วเปิด" "$A/$B" "503/200"
done

echo ""
echo "══════════════════════════════════════════════════════════"
printf '  ผ่าน %d  ตก %d\n' "$PASS" "$FAIL"
echo "══════════════════════════════════════════════════════════"
[ "$FAIL" -eq 0 ] || exit 1
