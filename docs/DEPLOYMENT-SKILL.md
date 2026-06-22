# Production Server Deployment Skill

**📌 อ่านไฟล์นี้ก่อนทำงานทุกครั้ง - บังคับ!**

## 🚨 CRITICAL: Server Ownership & Restrictions

### **Server นี้เป็น SHARED SERVER - มีหลายคนใช้ร่วมกัน**

**แอปที่เรามีสิทธิ์ (เท่านั้น):**
1. ✅ **Prompt-Beark** (promt-beark)
2. ✅ **Hospital Billing** (hospitalbilling)

**แอปอื่นๆ - ⚠️ ห้ามแตะต้องเด็ดขาด:**
- ❌ Apps Portal
- ❌ Ticket System  
- ❌ Dashboard
- ❌ Check-in System
- ❌ Signature System
- ❌ Motor Pool
- ❌ **และอื่นๆ ทั้งหมด**

---

## 📍 Server Information

**Production Server:**
```
IP: 209.15.119.96
SSH Port: 8839
User: teerapat
Password: T33r@p@t2026
```

**SSH Command:**
```bash
ssh -p 8839 teerapat@209.15.119.96
```

**SSH Key (Passwordless):**
```bash
ssh -i ~/.ssh/promt-beark-deploy -p 8839 teerapat@209.15.119.96
```

---

## 🏗️ Current Architecture

### Docker Containers

**แอปของเรา:**
```
promt-beark-frontend-1   → port 8080 (HTTP)
promt-beark-backend-1    → port 3000 (internal)
hospitalbilling-app      → port 5000 (HTTP)
```

**แอปของคนอื่น (ห้ามแตะ):**
```
apps-backend, apps-frontend, apps-redis, apps-postgres
ticket-system
signature-frontend, signature-backend
ha-dashboard
checkin_db_container
```

### URL Structure (**ปัจจุบัน - Updated 2026-06-22**)

| URL | แอป | Port | หมายเหตุ |
|-----|-----|------|----------|
| `https://209.15.119.96/` | Hospital Billing | 5000 | Default (root) - CSS/JS ทำงาน ✅ |
| `https://209.15.119.96/prompt` | Prompt-Beark | 8080 | Homepage (หลัง login) ✅ |
| `https://209.15.119.96/prompt/login.html` | Prompt-Beark | 8080 | **Login page (เริ่มต้น)** ✅ |
| `https://209.15.119.96/login.html` | → `/prompt/login.html` | - | Auto-redirect ✅ |
| `https://209.15.119.96/expense.html` | → `/prompt/expense.html` | - | Auto-redirect ✅ |
| `https://209.15.119.96/admin.html` | → `/prompt/admin.html` | - | Auto-redirect ✅ |
| `https://209.15.119.96/auth/*` | Prompt-Beark API | 8080 | API endpoints ✅ |
| `https://209.15.119.96/expenses/*` | Prompt-Beark API | 8080 | API endpoints ✅ |
| `https://hospitalbilling.ha.or.th` | Hospital Billing | 5000 | Domain name ✅ |

**⚠️ สำคัญมาก:**
1. Hospital Billing **ต้องอยู่ที่ root (/)** เพราะใช้ absolute paths (`/static/style.css`)
2. Prompt-Beark ใช้ **prefix `/prompt`** เพราะทำงานได้กับ prefix
3. **Auto-redirects** จะ redirect pages ที่ไม่มี /prompt ให้อัตโนมัติ (HTTP 301)
4. **API routes** (`/auth/*`, `/expenses/*`) ต้องทำงานที่ root เพราะ frontend เรียก absolute paths

**URL เริ่มต้น (Bookmark นี้):**
```
https://209.15.119.96/prompt/login.html
```

---

## 🔧 Deployment Process

### Step 1: Commit Code Locally

```bash
cd d:/Manny/promt-beark
git add .
git commit -m "Your message"
git push origin main
```

### Step 2: Deploy to Production

**Option A: Using SSH Key (Recommended)**
```bash
ssh -i ~/.ssh/promt-beark-deploy -p 8839 teerapat@209.15.119.96 'bash -s' << 'ENDSSH'
cd /home/teerapat/promt-beark
git pull origin main
docker compose up -d --build
ENDSSH
```

**Option B: Manual Deployment**
```bash
# 1. SSH to server
ssh -p 8839 teerapat@209.15.119.96

# 2. Navigate to project
cd /home/teerapat/promt-beark

# 3. Backup current state
docker ps > /tmp/backup-before.txt

# 4. Pull latest code
git pull origin main

# 5. Rebuild containers (เฉพาะแอปของเรา)
docker compose up -d --build

# 6. Verify
docker ps --filter "name=promt-beark"
docker ps --filter "name=hospital"
```

---

## 🔒 Nginx Configuration

### Important Files

**Main Config (แก้ไขได้):**
```
/etc/nginx/sites-available/hospitalbilling-ssl
```

**Backups (อัตโนมัติ):**
```
/etc/nginx/sites-available/hospitalbilling-ssl.backup.*
```

**Other Configs (ห้ามแตะ):**
```
/etc/nginx/sites-available/apps
/etc/nginx/sites-available/ticket
/etc/nginx/sites-available/ha-dashboard
/etc/nginx/sites-available/checkin
/etc/nginx/sites-available/motor_pool
```

### Current Nginx Config Template (**Updated 2026-06-22**)

```nginx
# /etc/nginx/sites-available/hospitalbilling-ssl
# IMPORTANT: Config includes redirects, API routes, and proper path handling
# ORDER MATTERS - Do not rearrange!

server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;

    ssl_certificate     /etc/nginx/ssl/hospitalbilling.crt;
    ssl_certificate_key /etc/nginx/ssl/hospitalbilling.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # 1. Auto-redirect Prompt-Beark pages without /prompt prefix
    # Fixes: /expense.html → /prompt/expense.html (HTTP 301)
    location ~ ^/(login\.html|expense\.html|admin\.html|history\.html|profile\.html|portal\.html|auth-guard\.js)$ {
        return 301 https://$host/prompt/$1;
    }

    # 2. Prompt-Beark API endpoints (MUST come before /prompt location)
    # Allows /auth/login to work from /prompt/login.html
    location ~ ^/(auth|users|budget-categories|expenses|settings|profiles|map-search|map-route|health)(/.*)?$ {
        proxy_pass         http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        client_max_body_size 50m;
    }

    # 3. Prompt-Beark pages - with /prompt prefix
    location /prompt {
        rewrite ^/prompt/?$ / break;
        rewrite ^/prompt/(.*)$ /$1 break;

        proxy_pass         http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        client_max_body_size 50m;
    }

    # 4. Hospital Billing - default (root and all other paths)
    # MUST be last - catches everything else
    location / {
        proxy_pass         http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        client_max_body_size 50m;
    }
}

# Hospital Billing - Specific domain
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name hospitalbilling.ha.or.th billing.ha.or.th;

    ssl_certificate     /etc/nginx/ssl/hospitalbilling.crt;
    ssl_certificate_key /etc/nginx/ssl/hospitalbilling.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        proxy_pass         http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        client_max_body_size 50m;
    }
}
```

**⚠️ Config Structure (ORDER MATTERS):**
1. **Auto-redirects** (line 15-17) - Redirect pages without /prompt prefix
2. **API routes** (line 20-28) - Allow /auth/*, /expenses/*, etc. to work
3. **/prompt location** (line 31-42) - Serve Prompt-Beark pages
4. **Default /** (line 45-54) - Serve Hospital Billing (must be last)

**ถ้าเรียงผิด = แอปทำงานผิด!**

### How to Update Nginx Config

```bash
# 1. Backup current config (always!)
sudo cp /etc/nginx/sites-available/hospitalbilling-ssl \
       /etc/nginx/sites-available/hospitalbilling-ssl.backup.$(date +%Y%m%d-%H%M%S)

# 2. Edit config
sudo nano /etc/nginx/sites-available/hospitalbilling-ssl

# 3. Test config (must pass!)
sudo nginx -t

# 4. Reload (only if test passes)
sudo systemctl reload nginx

# 5. Verify both apps work
curl -skI https://localhost/                    # Hospital Billing
curl -skI https://localhost/prompt              # Prompt-Beark
curl -skI https://localhost/auth/me             # API
curl -skI https://localhost/expense.html        # Redirect (301)
```

---

## ⚠️ Critical Rules & Best Practices

### DO ✅

1. **Always backup before making changes**
   ```bash
   sudo cp config config.backup.$(date +%Y%m%d-%H%M%S)
   ```

2. **Test nginx config before reload**
   ```bash
   sudo nginx -t
   ```

3. **Verify other apps after deployment**
   ```bash
   docker ps
   curl -skI https://apps.ha.or.th
   curl -skI https://ticket.ha.or.th
   ```

4. **Check logs if something breaks**
   ```bash
   docker logs promt-beark-frontend-1 --tail 50
   docker logs hospitalbilling-app --tail 50
   sudo tail -f /var/log/nginx/error.log
   ```

5. **Only modify our apps**
   - Prompt-Beark (port 8080)
   - Hospital Billing (port 5000)

6. **Read this file before every deployment**
   - อ่านทุกครั้ง ไม่งั้นจะลืม!

### DON'T ❌

1. **Never touch other apps' containers**
   ```bash
   # ❌ DON'T DO THIS
   docker restart apps-backend
   docker stop ticket-system
   ```

2. **Never modify other nginx configs**
   ```bash
   # ❌ DON'T EDIT THESE
   /etc/nginx/sites-available/apps
   /etc/nginx/sites-available/ticket
   ```

3. **Never use `docker compose down`** (kills ALL containers)
   ```bash
   # ❌ NEVER DO THIS
   docker compose down
   
   # ✅ DO THIS INSTEAD
   docker compose up -d --build
   ```

4. **Never change default_server without understanding**
   - มันจะส่งผลกับแอปอื่นที่ใช้ HTTPS

5. **Never delete volumes or networks**
   ```bash
   # ❌ NEVER DO THIS
   docker volume prune
   docker network prune
   ```

6. **Never put Hospital Billing under prefix path**
   - เช่น `/HospitalBilling` จะทำให้ CSS/JS โหลดไม่ได้
   - Hospital Billing **ต้องอยู่ที่ root (/)** เท่านั้น

7. **Never remove API routes or auto-redirects**
   - จะทำให้ login และ navigation ใช้ไม่ได้

---

## 🐛 Troubleshooting

### Problem 1: Login button ไม่ทำงาน (กดแล้วไม่มีอะไรเกิดขึ้น)

**Cause:** API endpoints (/auth/login) ไม่ทำงาน

**Check:**
```bash
curl -sk https://localhost/auth/me
# ถ้า 404 = ไม่มี API route
```

**Solution:** เพิ่ม API routes ใน nginx config (ดู line 20-28)

---

### Problem 2: Login สำเร็จแล้วไปหน้า Hospital Billing แทน

**Cause:** Frontend redirect ไปที่ `/` แทน `/prompt`

**Check:**
```bash
grep "window.location" public/login.html
grep "window.location" public/auth-guard.js
```

**Solution:** แก้ไข redirects ให้เป็น `/prompt`
```javascript
window.location.replace('/prompt');        // ✅ ถูก
window.location.replace('/');              // ❌ ผิด
```

---

### Problem 3: เข้า /expense.html แล้วขึ้น "Not Found"

**Cause:** Missing /prompt prefix

**Check:**
```bash
curl -skI https://localhost/expense.html
# ถ้า 404 = ไม่มี redirect
```

**Solution:** เพิ่ม auto-redirect ใน nginx config (ดู line 15-17)

---

### Problem 4: Hospital Billing CSS/JS ไม่โหลด (หน้าตาเละ)

**Cause:** Hospital Billing อยู่ใต้ prefix path (เช่น `/HospitalBilling`)

**Why:** Hospital Billing ใช้ absolute paths (`/static/style.css`) ซึ่งไม่มี prefix

**Solution:** ย้าย Hospital Billing ไปที่ root `/` และให้ Prompt-Beark ใช้ prefix แทน

---

### Problem 5: Other apps not working

**Check:**
1. Did we modify their configs?
   ```bash
   ls -lt /etc/nginx/sites-available/ | head -10
   ```

2. Did we restart their containers?
   ```bash
   docker ps --format '{{.Names}}\t{{.Status}}'
   ```

3. Revert to backup if needed
   ```bash
   sudo cp /etc/nginx/sites-available/hospitalbilling-ssl.backup.* \
          /etc/nginx/sites-available/hospitalbilling-ssl
   sudo nginx -t && sudo systemctl reload nginx
   ```

---

## 📝 Deployment Checklist

**Before Deployment:**
- [ ] อ่าน DEPLOYMENT-SKILL.md นี้แล้ว
- [ ] Code committed and pushed to GitHub
- [ ] No uncommitted changes locally
- [ ] Tested locally with `docker compose up`

**During Deployment:**
- [ ] SSH to production server
- [ ] Navigate to project directory
- [ ] Backup current container state
- [ ] Pull latest code
- [ ] Rebuild only our containers (ห้ามใช้ `down`)
- [ ] Wait for containers to start

**After Deployment:**
- [ ] Verify our apps work
  - [ ] https://209.15.119.96/ (Hospital Billing - หน้าตาสวย CSS/JS ทำงาน)
  - [ ] https://209.15.119.96/prompt/login.html (Prompt-Beark Login)
  - [ ] Login และทดสอบ navigation
- [ ] Check other apps still work
  - [ ] https://apps.ha.or.th
  - [ ] https://ticket.ha.or.th
  - [ ] https://dashboard.ha.or.th
- [ ] Check Docker containers status
  - [ ] No other containers restarted (Up X weeks)
  - [ ] Our containers running normally

---

## 🔐 Security Notes

**Credentials in this doc are for deployment only**
- Do NOT share this file publicly
- Keep in project docs/ folder only
- Add to .gitignore if sensitive

**SSH Key Setup (if not done):**
```bash
# Generate key (on local machine)
ssh-keygen -t rsa -b 2048 -f ~/.ssh/promt-beark-deploy -N ""

# Copy to server (need password once)
ssh-copy-id -i ~/.ssh/promt-beark-deploy.pub -p 8839 teerapat@209.15.119.96

# Test
ssh -i ~/.ssh/promt-beark-deploy -p 8839 teerapat@209.15.119.96 "whoami"
```

---

## 📞 Emergency Contacts

**If something breaks:**
1. Check backups: `/etc/nginx/sites-available/*.backup.*`
2. Revert config and reload nginx
3. Check logs: `docker logs <container>`, `/var/log/nginx/error.log`
4. Contact server admin if other apps affected

---

## 📚 Quick Reference

**Our Apps Only:**
```bash
# View our containers
docker ps --filter "name=promt-beark"
docker ps --filter "name=hospital"

# View our logs
docker logs promt-beark-frontend-1 --tail 50
docker logs promt-beark-backend-1 --tail 50
docker logs hospitalbilling-app --tail 50

# Restart our containers only
cd /home/teerapat/promt-beark
docker compose restart
```

**Test URLs:**
```bash
# Hospital Billing
curl -skI https://209.15.119.96/
curl -skI https://209.15.119.96/static/style.css

# Prompt-Beark
curl -skI https://209.15.119.96/prompt
curl -skI https://209.15.119.96/prompt/login.html
curl -sk https://209.15.119.96/auth/me

# Redirects
curl -skI https://209.15.119.96/expense.html  # Should 301 → /prompt/expense.html
curl -skI https://209.15.119.96/login.html    # Should 301 → /prompt/login.html
```

---

## 🎯 Summary (TL;DR)

1. **Read this file before every deployment** ⚠️
2. **Only modify Prompt-Beark & Hospital Billing** ✅
3. **Never touch other apps** ❌
4. **Hospital Billing = root (/)** - ย้ายไม่ได้
5. **Prompt-Beark = /prompt** - ใช้ prefix
6. **Always backup before changing nginx config**
7. **Test with `nginx -t` before reload**
8. **Verify other apps after deployment**

**Start URL:**
```
https://209.15.119.96/prompt/login.html
```

---

**Last Updated:** 2026-06-22  
**Server:** 209.15.119.96  
**Apps:** Prompt-Beark, Hospital Billing  
**Status:** Production ✅
