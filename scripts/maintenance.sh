#!/usr/bin/env bash
# เปิด/ปิดหน้า "ปิดปรับปรุงชั่วคราว" ของพร้อมเบิก
#
#   ./scripts/maintenance.sh on       ปิดแอป คนทั่วไปเห็นหน้าแจ้งปรับปรุง
#   ./scripts/maintenance.sh off      เปิดแอปกลับมาใช้งานตามปกติ
#   ./scripts/maintenance.sh status   ดูว่าตอนนี้เปิดหรือปิดอยู่
#
# สวิตช์คือไฟล์เปล่าไฟล์เดียว nginx ในคอนเทนเนอร์เช็คใหม่ทุกคำขอ
# จึงไม่ต้อง reload ไม่ต้อง restart ไม่ต้อง build และไม่แตะฐานข้อมูลเลย
set -euo pipefail

cd "$(dirname "$0")/.."
FLAG="maint/ON"

check() {
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:8080/login.html || echo "ติดต่อไม่ได้")
    case "$code" in
        503) echo "  ผู้ใช้ทั่วไปเห็น: หน้าปิดปรับปรุง (HTTP 503)" ;;
        200) echo "  ผู้ใช้ทั่วไปเห็น: แอปตามปกติ (HTTP 200)" ;;
        *)   echo "  ตอบกลับผิดคาด: $code — ตรวจดูว่าคอนเทนเนอร์ยังทำงานอยู่ไหม" ;;
    esac
}

case "${1:-}" in
    on)
        mkdir -p maint && : > "$FLAG"
        echo "ปิดแอปแล้ว"
        check
        echo "  ข้อมูลไม่ถูกแตะ คอนเทนเนอร์ยังทำงานปกติ เปิดกลับได้ทุกเมื่อด้วย: $0 off"
        ;;
    off)
        rm -f "$FLAG"
        echo "เปิดแอปกลับมาแล้ว"
        check
        ;;
    status)
        if [ -f "$FLAG" ]; then echo "สถานะ: ปิดปรับปรุงอยู่"; else echo "สถานะ: เปิดใช้งานปกติ"; fi
        check
        ;;
    *)
        sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
        exit 1
        ;;
esac
