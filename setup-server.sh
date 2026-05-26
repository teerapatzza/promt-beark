#!/bin/sh
# รันบนเครื่อง server (Linux) หลัง git clone เสร็จ
set -e

echo "=== Prompt-Berk Server Setup ==="

# 1. เริ่ม containers
docker compose up -d --build
echo "✓ Containers started"

# 2. รอ backend พร้อม
echo "Waiting for backend..."
sleep 5

# 3. ถ้ามีไฟล์ prompt-berk.db อยู่ด้วยกัน → copy เข้า volume
if [ -f "./prompt-berk.db" ]; then
    docker cp ./prompt-berk.db promt-beark-backend-1:/app/data/prompt-berk.db
    docker restart promt-beark-backend-1
    echo "✓ Database restored ($(du -h ./prompt-berk.db | cut -f1))"
else
    echo "! No prompt-berk.db found — starting with empty database"
    echo "  Run: node import-profiles.mjs  to re-import profiles"
fi

# 4. แสดง IP
echo ""
echo "=== Access URL ==="
ip a | grep 'inet ' | grep -v '127.0.0.1' | awk '{print "  http://" $2}' | sed 's|/[0-9]*|:8080|'
echo ""
echo "Done!"
