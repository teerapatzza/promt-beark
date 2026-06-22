window.__currentUser = null;

async function initAuthGuard({ adminOnly = false } = {}) {
  try {
    const r = await fetch('/auth/me');
    if (!r.ok) { window.location.replace('/prompt/login.html'); return; }
    const user = await r.json();
    window.__currentUser = user;
    if (adminOnly && user.role !== 'admin') { window.location.replace('/prompt'); return; }
    _renderUserBar(user);
    _renderChangePasswordModal();
    return user;
  } catch (_) {
    window.location.replace('/prompt/login.html');
  }
}

function _renderUserBar(user) {
  const roleLabels = { admin: 'Admin', approver: 'Approver', user: 'User' };
  const roleColors = { admin: '#d32f2f', approver: '#1565c0', user: '#2e7d32' };

  const bar = document.createElement('div');
  bar.id = 'auth-user-bar';
  bar.style.cssText = `
    position: fixed; top: 0; right: 0; left: 0;
    height: 40px; background: #1a237e; color: #fff;
    display: flex; align-items: center; padding: 0 16px;
    font-family: 'Segoe UI', sans-serif; font-size: 13px;
    z-index: 9999; gap: 10px;
  `;

  const roleTag = `<span style="
    background:${roleColors[user.role]};color:#fff;
    padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;
  ">${roleLabels[user.role] || user.role}</span>`;

  bar.innerHTML = `
    <span style="flex:1;font-weight:600;">Prompt-Berk</span>
    <button onclick="openChangePasswordModal()" style="
      background:none;border:none;color:rgba(255,255,255,.85);
      cursor:pointer;font-size:13px;padding:4px 6px;border-radius:6px;
      transition:background .15s;
    " onmouseover="this.style.background='rgba(255,255,255,.1)'"
       onmouseout="this.style.background='none'"
       title="เปลี่ยนรหัสผ่าน">${user.email} 🔑</button>
    ${roleTag}
    <button onclick="doLogout()" style="
      background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);
      color:#fff;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px;
    ">ออกจากระบบ</button>
  `;

  document.body.insertBefore(bar, document.body.firstChild);

  const style = document.createElement('style');
  style.textContent = 'body { padding-top: 40px !important; }';
  document.head.appendChild(style);
}

function _renderChangePasswordModal() {
  const modal = document.createElement('div');
  modal.id = 'change-pw-modal';
  modal.style.cssText = `
    display:none; position:fixed; inset:0; background:rgba(0,0,0,.5);
    z-index:10000; align-items:center; justify-content:center;
  `;
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:28px 32px;width:380px;max-width:90vw;box-shadow:0 8px 40px rgba(0,0,0,.25);">
      <h3 style="font-weight:700;font-size:1rem;margin-bottom:6px;">เปลี่ยนรหัสผ่าน</h3>
      <p style="color:#64748b;font-size:.82rem;margin-bottom:18px;" id="cpw-email"></p>

      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:.82rem;font-weight:600;color:#555;margin-bottom:4px;">รหัสผ่านปัจจุบัน</label>
        <input type="password" id="cpw-current" placeholder="••••••••"
          style="width:100%;padding:9px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:.9rem;outline:none;box-sizing:border-box;">
      </div>
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:.82rem;font-weight:600;color:#555;margin-bottom:4px;">รหัสผ่านใหม่</label>
        <input type="password" id="cpw-new" placeholder="อย่างน้อย 6 ตัวอักษร"
          style="width:100%;padding:9px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:.9rem;outline:none;box-sizing:border-box;">
      </div>
      <div style="margin-bottom:18px;">
        <label style="display:block;font-size:.82rem;font-weight:600;color:#555;margin-bottom:4px;">ยืนยันรหัสผ่านใหม่</label>
        <input type="password" id="cpw-confirm" placeholder="••••••••"
          style="width:100%;padding:9px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:.9rem;outline:none;box-sizing:border-box;">
      </div>

      <div id="cpw-error" style="display:none;background:#ffebee;color:#c62828;border:1px solid #ef9a9a;border-radius:8px;padding:8px 12px;font-size:.82rem;margin-bottom:14px;"></div>
      <div id="cpw-success" style="display:none;background:#e8f5e9;color:#2e7d32;border:1px solid #a5d6a7;border-radius:8px;padding:8px 12px;font-size:.82rem;margin-bottom:14px;"></div>

      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="closeChangePasswordModal()"
          style="padding:8px 18px;border:1.5px solid #ddd;border-radius:8px;cursor:pointer;font-size:.9rem;background:#fff;">ยกเลิก</button>
        <button onclick="submitChangePassword()" id="cpw-btn"
          style="padding:8px 18px;background:#1a237e;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:.9rem;font-weight:700;">บันทึก</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function openChangePasswordModal() {
  const modal = document.getElementById('change-pw-modal');
  document.getElementById('cpw-email').textContent = window.__currentUser?.email || '';
  document.getElementById('cpw-current').value = '';
  document.getElementById('cpw-new').value = '';
  document.getElementById('cpw-confirm').value = '';
  document.getElementById('cpw-error').style.display = 'none';
  document.getElementById('cpw-success').style.display = 'none';
  document.getElementById('cpw-btn').disabled = false;
  document.getElementById('cpw-btn').textContent = 'บันทึก';
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('cpw-current').focus(), 50);
}

function closeChangePasswordModal() {
  document.getElementById('change-pw-modal').style.display = 'none';
}

async function submitChangePassword() {
  const currentPassword = document.getElementById('cpw-current').value;
  const newPassword = document.getElementById('cpw-new').value;
  const confirm = document.getElementById('cpw-confirm').value;
  const errEl = document.getElementById('cpw-error');
  const okEl = document.getElementById('cpw-success');

  errEl.style.display = 'none';
  okEl.style.display = 'none';

  if (!currentPassword || !newPassword || !confirm) {
    errEl.textContent = 'กรุณากรอกข้อมูลให้ครบ';
    errEl.style.display = 'block';
    return;
  }
  if (newPassword.length < 6) {
    errEl.textContent = 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร';
    errEl.style.display = 'block';
    return;
  }
  if (newPassword !== confirm) {
    errEl.textContent = 'รหัสผ่านใหม่ไม่ตรงกัน';
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('cpw-btn');
  btn.disabled = true;
  btn.textContent = 'กำลังบันทึก...';

  try {
    const r = await fetch('/auth/change-password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await r.json();
    if (!r.ok) {
      errEl.textContent = data.error || 'เปลี่ยนรหัสผ่านไม่สำเร็จ';
      errEl.style.display = 'block';
      return;
    }
    okEl.textContent = 'เปลี่ยนรหัสผ่านสำเร็จ';
    okEl.style.display = 'block';
    setTimeout(closeChangePasswordModal, 1500);
  } finally {
    btn.disabled = false;
    btn.textContent = 'บันทึก';
  }
}

async function doLogout() {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.replace('/prompt/login.html');
}
