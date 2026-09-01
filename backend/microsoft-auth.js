/**
 * เข้าสู่ระบบด้วยบัญชี Microsoft 365 ขององค์กร (Microsoft Entra ID)
 *
 * ใช้ OAuth 2.0 Authorization Code Flow แบบ confidential client
 * ไม่เพิ่ม dependency ใหม่เลย — Node 20 มี fetch ในตัวแล้ว
 *
 * ทำไมไม่ตรวจลายเซ็น id_token ด้วย JWKS:
 *   id_token ไม่ได้มาจากเบราว์เซอร์ แต่เราไปแลกมาเองจาก
 *   https://login.microsoftonline.com/.../oauth2/v2.0/token ผ่าน TLS
 *   ด้วย client_secret ของเรา ช่องทางนี้เชื่อถือได้อยู่แล้ว
 *   สิ่งที่ยังต้องตรวจคือ "เนื้อหา" ว่าเป็นของ tenant และ app เรา -> ตรวจครบด้านล่าง
 *   (ถ้าวันหน้าย้ายไป implicit/SPA flow ต้องกลับมาตรวจลายเซ็นด้วย)
 *
 * ตัวแปรที่ต้องตั้ง (ถ้าไม่ครบ ระบบจะปิดฟีเจอร์นี้เงียบๆ และล็อกอินด้วยรหัสผ่านตามปกติ):
 *   MS_TENANT_ID      Directory (tenant) ID
 *   MS_CLIENT_ID      Application (client) ID
 *   MS_CLIENT_SECRET  Client secret
 *   MS_REDIRECT_URI   ต้องตรงกับที่ลงทะเบียนใน Entra เป๊ะ
 *                     เช่น https://promberk.ha.or.th/auth/microsoft/callback
 */

const crypto = require('crypto');

const CFG = {
  tenantId:     process.env.MS_TENANT_ID     || '',
  clientId:     process.env.MS_CLIENT_ID     || '',
  clientSecret: process.env.MS_CLIENT_SECRET || '',
  redirectUri:  process.env.MS_REDIRECT_URI  || ''
};

/** เปิดใช้เฉพาะเมื่อตั้งค่าครบทั้ง 4 ตัว */
const ENABLED = !!(CFG.tenantId && CFG.clientId && CFG.clientSecret && CFG.redirectUri);

/** ให้คนใช้ใหม่ที่ล็อกอินผ่าน M365 ครั้งแรกถูกสร้างบัญชีอัตโนมัติหรือไม่ */
const AUTO_CREATE = (process.env.MS_AUTO_CREATE_USERS || 'true') !== 'false';

const AUTHORITY = () => `https://login.microsoftonline.com/${CFG.tenantId}`;
const STATE_COOKIE = 'ms_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;

/** รหัสผ่านที่ไม่มีทางตรงกับอะไรได้ ใช้กับบัญชีที่สร้างจาก M365 */
const NO_PASSWORD = '!microsoft-only';

/** อ่าน payload ของ JWT โดยไม่ตรวจลายเซ็น (ดูเหตุผลหัวไฟล์) */
function decodeJwtPayload(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) throw new Error('id_token ผิดรูปแบบ');
  const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json);
}

/** ตรวจว่า token นี้ออกให้ tenant และ app ของเราจริง และยังไม่หมดอายุ */
function assertClaimsAreOurs(claims) {
  if (claims.tid !== CFG.tenantId)
    throw new Error('บัญชีนี้ไม่ได้อยู่ในองค์กรของเรา');
  if (claims.aud !== CFG.clientId)
    throw new Error('token ไม่ได้ออกให้แอปนี้');
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now())
    throw new Error('token หมดอายุแล้ว');
}

function emailFromClaims(claims) {
  const raw = claims.email || claims.preferred_username || claims.upn || '';
  return String(raw).trim().toLowerCase();
}

/**
 * ที่อยู่ของหน้าเว็บ คิดจาก MS_REDIRECT_URI โดยตัดส่วน /auth/... ท้ายออก
 *   https://promberk.ha.or.th/auth/microsoft/callback -> https://promberk.ha.or.th
 *   https://x/prompt/auth/microsoft/callback          -> https://x/prompt
 * ห้ามใช้ path สัมพัทธ์ตรงนี้ เพราะเบราว์เซอร์จะคิดจาก /auth/microsoft/
 * แล้วได้ /auth/microsoft/login.html ซึ่งไม่มีอยู่จริง
 */
function appBase() {
  try {
    const u = new URL(CFG.redirectUri);
    return u.origin + u.pathname.replace(/\/auth\/microsoft\/callback\/?$/, '');
  } catch (_) {
    return '';
  }
}

/** ส่งผู้ใช้กลับหน้าเข้าสู่ระบบพร้อมข้อความบอกสาเหตุ */
function backToLogin(_req, res, message) {
  res.redirect(302, `${appBase()}/login.html?error=${encodeURIComponent(message)}`);
}

/**
 * @param {import('express').Express} app
 * @param {{db:any, createSession:(userId:number)=>string, sessionTtlHours:number}} deps
 */
function mountMicrosoftAuth(app, { db, createSession, sessionTtlHours }) {

  /** หน้าเว็บถามว่าเปิดปุ่ม Microsoft ไหม และล็อกอินด้วยรหัสผ่านได้แค่ไหน */
  app.get('/auth/config', (_req, res) => {
    // คุกกี้ state ผูกกับโดเมน ถ้าเริ่มล็อกอินจากโดเมนหนึ่งแต่ Microsoft
    // ส่งกลับมาอีกโดเมนหนึ่ง คุกกี้จะไม่ถูกส่งมาด้วยและล็อกอินจะล้ม
    // จึงบอกหน้าเว็บว่าโดเมนที่ถูกต้องคืออันไหน เพื่อพาไปให้ถูกก่อนเริ่ม
    let canonicalOrigin = '';
    try { if (CFG.redirectUri) canonicalOrigin = new URL(CFG.redirectUri).origin; } catch (_) {}

    res.json({
      microsoftEnabled: ENABLED,
      // เมื่อเปิด M365 แล้ว รหัสผ่านเหลือไว้เป็นทางเข้าสำรองของผู้ดูแลระบบเท่านั้น
      passwordLoginFor: ENABLED ? 'admin' : 'all',
      selfRegisterAllowed: !ENABLED,
      canonicalOrigin
    });
  });

  if (!ENABLED) {
    console.log('[microsoft-auth] ยังไม่ได้ตั้งค่า MS_* — ปิดฟีเจอร์ ล็อกอินด้วยรหัสผ่านตามปกติ');
    return;
  }
  console.log('[microsoft-auth] เปิดใช้งาน  tenant=' + CFG.tenantId.slice(0, 8) + '…  redirect=' + CFG.redirectUri);

  // ── 1) เริ่มขั้นตอน: พาไปหน้าเข้าสู่ระบบของ Microsoft ──
  app.get('/auth/microsoft', (req, res) => {
    const state = crypto.randomBytes(24).toString('hex');
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true, sameSite: 'lax', maxAge: STATE_TTL_MS,
      secure: req.protocol === 'https' || req.get('x-forwarded-proto') === 'https'
    });

    const url = new URL(AUTHORITY() + '/oauth2/v2.0/authorize');
    url.searchParams.set('client_id',     CFG.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri',  CFG.redirectUri);
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope',         'openid profile email');
    url.searchParams.set('state',         state);

    // ปกติปล่อยให้ Microsoft เข้าด้วยบัญชีที่ค้างอยู่ (SSO) — สะดวกและเป็นเรื่องปกติขององค์กร
    // แต่ถ้าผู้ใช้กด "เข้าด้วยบัญชีอื่น" ให้บังคับถามว่าจะใช้บัญชีไหน
    // จำเป็นบนเครื่องที่ใช้ร่วมกัน และใช้ทดสอบด้วย
    if (req.query.prompt === 'select_account') url.searchParams.set('prompt', 'select_account');

    res.redirect(302, url.toString());
  });

  // ── 2) Microsoft ส่งกลับมาพร้อม code ──
  app.get('/auth/microsoft/callback', async (req, res) => {
    try {
      const { code, state, error, error_description } = req.query;

      if (error) throw new Error(error_description || String(error));
      if (!code)  throw new Error('ไม่ได้รับรหัสยืนยันจาก Microsoft');

      // กัน CSRF: state ต้องตรงกับที่เราออกให้ตอนเริ่ม
      const expected = req.cookies?.[STATE_COOKIE];
      res.clearCookie(STATE_COOKIE);
      if (!expected || state !== expected)
        throw new Error('คำขอไม่ถูกต้อง กรุณาเริ่มเข้าสู่ระบบใหม่');

      // แลก code เป็น token (เซิร์ฟเวอร์คุยกับ Microsoft ตรงๆ ผ่าน TLS)
      const body = new URLSearchParams({
        client_id:     CFG.clientId,
        client_secret: CFG.clientSecret,
        grant_type:    'authorization_code',
        code:          String(code),
        redirect_uri:  CFG.redirectUri,
        scope:         'openid profile email'
      });

      const r = await fetch(AUTHORITY() + '/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error_description || 'แลกรหัสกับ Microsoft ไม่สำเร็จ');
      if (!data.id_token) throw new Error('Microsoft ไม่ได้ส่งข้อมูลผู้ใช้กลับมา');

      const claims = decodeJwtPayload(data.id_token);
      assertClaimsAreOurs(claims);

      const email = emailFromClaims(claims);
      if (!email) throw new Error('บัญชี Microsoft นี้ไม่มีอีเมล');

      // จับคู่กับผู้ใช้เดิม หรือสร้างใหม่ถ้าอนุญาต
      let user = db.prepare('SELECT id, email, role FROM users WHERE email = ?').get(email);
      if (!user) {
        if (!AUTO_CREATE)
          throw new Error(`ยังไม่มีบัญชี ${email} ในระบบ กรุณาติดต่อผู้ดูแลระบบ`);
        const ins = db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)')
                      .run(email, NO_PASSWORD, 'user');
        user = { id: ins.lastInsertRowid, email, role: 'user' };
        console.log('[microsoft-auth] สร้างบัญชีใหม่จาก M365: ' + email);
      }

      const token = createSession(user.id);
      res.cookie('session', token, {
        httpOnly: true, sameSite: 'lax',
        maxAge: sessionTtlHours * 3600 * 1000,
        secure: req.protocol === 'https' || req.get('x-forwarded-proto') === 'https'
      });

      // ส่ง token ให้หน้าเว็บเก็บลง localStorage แล้วเข้าหน้าแรก
      res.redirect(302, `${appBase()}/login.html#ms=` + encodeURIComponent(token));

    } catch (e) {
      console.error('[microsoft-auth] ล้มเหลว:', e.message);
      backToLogin(req, res, e.message || 'เข้าสู่ระบบด้วย Microsoft ไม่สำเร็จ');
    }
  });
}

module.exports = { mountMicrosoftAuth, MICROSOFT_LOGIN_ENABLED: ENABLED, NO_PASSWORD };
