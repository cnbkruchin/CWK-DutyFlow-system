/**
 * AuthService.gs — เข้าสู่ระบบด้วยชื่อผู้ใช้/รหัสผ่าน และตรวจสิทธิ์
 *
 * กฎเหล็ก: ตรวจสอบสิทธิ์ฝั่ง Server ทุกครั้ง ห้ามเชื่อ role ที่ส่งมาจากหน้าเว็บ
 *
 * ลำดับการทำงาน
 *  1) หน้าเว็บส่งชื่อผู้ใช้และรหัสผ่านไปที่ auth.login
 *  2) เซิร์ฟเวอร์ตรวจรหัสผ่าน (PBKDF2-SHA256 + salt) แล้วออก token สุ่ม เก็บใน CacheService
 *  3) หน้าเว็บเก็บ token ไว้ในหน่วยความจำเท่านั้น และส่งมากับทุกคำขอ api(action, payload, token)
 *  4) ทุกคำขออ่านข้อมูลครูใหม่จาก token — บทบาทหรือสถานะที่เปลี่ยนมีผลทันที
 */

var ROLES = {
  SYS_ADMIN:  { level: 5, name: 'ผู้ดูแลระบบ' },
  EXECUTIVE:  { level: 4, name: 'ผู้บริหาร' },
  DUTY_ADMIN: { level: 3, name: 'หัวหน้างานเวร' },
  DAILY_HEAD: { level: 2, name: 'หัวหน้าเวรประจำวัน' },
  TEACHER:    { level: 1, name: 'ครู' }
};

var ROLE_KEYS = Object.keys(ROLES);

/** ระดับผู้อนุมัติการเปลี่ยนเวร 1=หัวหน้าเวร 2=หัวหน้างาน 3=ผู้บริหาร */
function AUTH_approvalLevel(role) {
  if (role === 'DAILY_HEAD') return 1;
  if (role === 'DUTY_ADMIN') return 2;
  if (role === 'EXECUTIVE' || role === 'SYS_ADMIN') return 3;
  return 0;
}

function AUTH_approvalLevelName(level) {
  return { 1: 'หัวหน้าเวรประจำวัน', 2: 'หัวหน้างานเวร', 3: 'ผู้บริหาร' }[num(level, 0)] || '';
}

/* ================================================================= */
/* ประตูความปลอดภัยระดับการประมวลผล                                    */
/* ================================================================= */

/*
 * google.script.run เรียกฟังก์ชันฝั่ง Server ที่ชื่อไม่ลงท้ายด้วย _ ได้ทุกตัว พร้อมอาร์กิวเมนต์ใดก็ได้
 * และเว็บแอปเปิดให้ผู้ที่ยังไม่ได้เข้าสู่ระบบเปิดหน้าได้ จึงมีสองชั้นป้องกัน
 *  - EXEC_TRUSTED: การอ่าน/เขียนข้อมูลเปิดเฉพาะเมื่อเริ่มจากจุดเข้าที่ตรวจแล้ว
 *    (api(), คำสั่งของเจ้าของสคริปต์ และงานอัตโนมัติ)
 *  - AUTH_SEAL: ctx ที่ใช้ตรวจสิทธิ์ต้องสร้างโดยเซิร์ฟเวอร์ในการเรียกครั้งนี้
 *    อ็อบเจ็กต์ที่ส่งมาจากหน้าเว็บไม่มีทางมีค่านี้ได้
 * ทุกการเรียกจากหน้าเว็บเป็นการประมวลผลใหม่ ตัวแปรระดับบนสุดจึงเริ่มจากค่าเริ่มต้นเสมอ
 */
var EXEC_TRUSTED = false;
var AUTH_SEAL = {};

function EXEC_trust_() { EXEC_TRUSTED = true; }

function EXEC_assert_() {
  if (!EXEC_TRUSTED) {
    throw new Error('ไม่อนุญาตให้เรียกฟังก์ชันนี้โดยตรง กรุณาใช้งานผ่านหน้าเว็บของระบบ');
  }
}

/** ผู้ที่รันอยู่คือเจ้าของสคริปต์เอง (รันจากตัวแก้ไข เมนูสเปรดชีต หรือทริกเกอร์ของตน) */
function AUTH_isScriptOwner_() {
  var active = '', effective = '';
  try { active = str(Session.getActiveUser().getEmail()).toLowerCase(); } catch (e) { active = ''; }
  try { effective = str(Session.getEffectiveUser().getEmail()).toLowerCase(); } catch (e) { effective = ''; }
  return !!active && active === effective;
}

/** ctx ของเจ้าของสคริปต์ — ใช้กับคำสั่งในตัวแก้ไข Apps Script เท่านั้น */
function AUTH_ownerContext_() {
  var ctx = AUTH_blankCtx_();
  ctx.ok = true;
  ctx.username = '(เจ้าของสคริปต์)';
  ctx.name = 'เจ้าของสคริปต์';
  ctx.role = 'SYS_ADMIN';
  ctx.roleName = ROLES.SYS_ADMIN.name;
  ctx.level = ROLES.SYS_ADMIN.level;
  return ctx;
}

/** ใช้กับฟังก์ชันที่รันจากตัวแก้ไข/เมนูสเปรดชีต — ถ้าถูกเรียกผ่านหน้าเว็บจะถูกปฏิเสธ */
function AUTH_ownerOnly_() {
  if (!AUTH_isScriptOwner_()) {
    throw new Error('คำสั่งนี้ใช้ได้เฉพาะเจ้าของสคริปต์ โดยรันจากตัวแก้ไข Apps Script หรือเมนูในสเปรดชีต');
  }
  EXEC_trust_();
  return AUTH_ownerContext_();
}

/**
 * เริ่มงานอัตโนมัติ (ทริกเกอร์) — งานไม่รับข้อมูลจากผู้เรียก
 * ถ้าไม่ใช่เจ้าของสคริปต์เป็นผู้เรียก ให้ทำได้ไม่เกินวันละครั้ง กันการถูกเรียกซ้ำจากภายนอก
 */
function EXEC_beginJob_(name) {
  var owner = AUTH_isScriptOwner_();
  EXEC_trust_();
  var key = 'JOB_LAST_' + name;
  var d = today();
  if (!owner && PROP_get(key) === d) return false;
  PROP_set(key, d);
  return true;
}

/* ================================================================= */
/* รหัสผ่าน                                                           */
/* ================================================================= */

var AUTH_PW_ITER = 1000;
var AUTH_TEMP_PW_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';     // ตัดตัวที่สับสน เช่น l 1 o 0 i
var AUTH_USERNAME_RE = /^[a-z][a-z0-9._-]{2,31}$/;

function AUTH_bytesToHex_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xff;
    s += (b < 16 ? '0' : '') + b.toString(16);
  }
  return s;
}

function AUTH_hexToBytes_(hex) {
  var out = [];
  for (var i = 0; i + 1 < hex.length; i += 2) {
    var b = parseInt(hex.substr(i, 2), 16);
    out.push(b > 127 ? b - 256 : b);
  }
  return out;
}

/** ไบต์สุ่ม — Utilities.getUuid() ใช้ตัวสุ่มที่ปลอดภัยของ Java แล้วกระจายผ่าน SHA-256 */
function AUTH_randomBytes_(n) {
  var out = [];
  while (out.length < n) {
    out = out.concat(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + Utilities.getUuid() + new Date().getTime()));
  }
  return out.slice(0, n);
}

function AUTH_randomHex_(n) { return AUTH_bytesToHex_(AUTH_randomBytes_(n)); }

/** PBKDF2-HMAC-SHA256 ความยาว 32 ไบต์ (บล็อกเดียว) คืนค่าเป็น hex */
function AUTH_pbkdf2Hex_(password, saltHex, iterations) {
  var key = Utilities.newBlob(password).getBytes();
  var u = Utilities.computeHmacSha256Signature(AUTH_hexToBytes_(saltHex).concat([0, 0, 0, 1]), key);
  var t = u.slice();
  for (var i = 1; i < iterations; i++) {
    u = Utilities.computeHmacSha256Signature(u, key);
    for (var j = 0; j < t.length; j++) t[j] ^= u[j];
  }
  return AUTH_bytesToHex_(t);
}

/** เข้ารหัสรหัสผ่านเพื่อเก็บ รูปแบบ pbkdf2_sha256$รอบ$salt$hash */
function AUTH_hashPassword(password, saltHex, iterations) {
  var p = String(password === null || password === undefined ? '' : password);
  if (!p) throw new Error('รหัสผ่านว่างเปล่า');
  var salt = saltHex || AUTH_randomHex_(16);
  var n = iterations || AUTH_PW_ITER;
  return 'pbkdf2_sha256$' + n + '$' + salt + '$' + AUTH_pbkdf2Hex_(p, salt, n);
}

/** เทียบข้อความแบบใช้เวลาคงที่ */
function AUTH_safeEqual_(a, b) {
  var x = String(a), y = String(b);
  if (x.length !== y.length) return false;
  var r = 0;
  for (var i = 0; i < x.length; i++) r |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return r === 0;
}

function AUTH_verifyPassword(password, stored) {
  var p = String(password === null || password === undefined ? '' : password);
  if (!p) return false;
  var parts = str(stored).split('$');
  var iter = parts.length === 4 ? num(parts[1], 0) : 0;
  if (parts[0] !== 'pbkdf2_sha256' || iter < 1 || !/^[0-9a-f]+$/.test(parts[2] || '')) {
    // ใช้เวลาเท่ากับการตรวจจริง จะได้ไม่บอกใบ้ว่ามีบัญชีนี้หรือไม่
    AUTH_pbkdf2Hex_(p, '00', AUTH_PW_ITER);
    return false;
  }
  return AUTH_safeEqual_(AUTH_pbkdf2Hex_(p, parts[2], iter), parts[3]);
}

/** รหัสผ่านชั่วคราวที่อ่านง่าย (ไม่มีตัวที่สับสน) */
function AUTH_tempPassword_() {
  var len = Math.max(8, AUTH_passwordMinLength_());
  var bytes = AUTH_randomBytes_(len);
  var s = '';
  for (var i = 0; i < len; i++) s += AUTH_TEMP_PW_CHARS.charAt((bytes[i] & 0xff) % AUTH_TEMP_PW_CHARS.length);
  return s;
}

function AUTH_passwordMinLength_() {
  return Math.max(4, Math.min(64, CFG_num('password_min_length') || 6));
}

/** ตรวจนโยบายรหัสผ่าน คืนรายการปัญหา (ว่าง = ผ่าน) */
function AUTH_passwordProblems(password, username) {
  var p = String(password === null || password === undefined ? '' : password);
  var min = AUTH_passwordMinLength_();
  var errs = [];
  if (p.length < min) errs.push('รหัสผ่านต้องมีอย่างน้อย ' + min + ' ตัวอักษร');
  if (p.length > 128) errs.push('รหัสผ่านต้องยาวไม่เกิน 128 ตัวอักษร');
  if (/^\s|\s$/.test(p)) errs.push('รหัสผ่านต้องไม่ขึ้นต้นหรือลงท้ายด้วยช่องว่าง');
  if (username && p.toLowerCase() === str(username).toLowerCase()) errs.push('รหัสผ่านต้องไม่เหมือนชื่อผู้ใช้');
  return errs;
}

/** ข้อมูลที่ต้องบันทึกลงชีตเมื่อกำหนดรหัสผ่านใหม่ */
function AUTH_passwordPatch_(password, mustChange) {
  return {
    password_hash: AUTH_hashPassword(password),
    must_change_password: mustChange ? 'TRUE' : 'FALSE',
    password_changed_at: nowIso()
  };
}

/* ================================================================= */
/* ชื่อผู้ใช้                                                          */
/* ================================================================= */

function AUTH_normalizeUsername(v) { return str(v).toLowerCase(); }

/** ข้อความปัญหาของชื่อผู้ใช้ (ว่าง = ผ่าน) */
function AUTH_usernameProblem(username) {
  var u = AUTH_normalizeUsername(username);
  if (!u) return 'กรุณากรอกชื่อผู้ใช้';
  if (!AUTH_USERNAME_RE.test(u)) {
    return 'ชื่อผู้ใช้ต้องยาว 3–32 ตัว ขึ้นต้นด้วยตัวอักษรภาษาอังกฤษ ' +
      'และใช้ได้เฉพาะ a-z 0-9 จุด (.) ขีดล่าง (_) ขีดกลาง (-)';
  }
  return '';
}

/** หาครูจากชื่อผู้ใช้ (ไม่สนตัวพิมพ์เล็ก/ใหญ่) */
function AUTH_findByUsername_(username) {
  var u = AUTH_normalizeUsername(username);
  if (!u) return null;
  var rows = dbReadAll('TEACHERS');
  for (var i = 0; i < rows.length; i++) {
    if (AUTH_normalizeUsername(rows[i].username) === u) return DB_clone_(rows[i]);
  }
  return null;
}

/* ================================================================= */
/* เซสชัน                                                             */
/* ================================================================= */

var AUTH_TOKEN_RE = /^[0-9a-f]{64}$/;

function AUTH_sessionKey_(token) { return 'sess:' + token; }

/** อายุเซสชัน (วินาที) — CacheService เก็บได้นานสุด 6 ชั่วโมง */
function AUTH_sessionTtl_() {
  var min = CFG_num('session_timeout_min') || 360;
  return Math.max(900, Math.min(21600, Math.round(min * 60)));
}

function AUTH_sessionGet_(token) {
  try {
    var raw = CacheService.getScriptCache().get(AUTH_sessionKey_(token));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function AUTH_sessionPut_(token, sess) {
  CacheService.getScriptCache().put(AUTH_sessionKey_(token), JSON.stringify(sess), AUTH_sessionTtl_());
}

/** ต่ออายุแบบเลื่อนตามการใช้งาน แต่เขียนแคชไม่เกินนาทีละครั้ง */
function AUTH_sessionTouch_(token, sess) {
  var now = new Date().getTime();
  if (now - num(sess.at, 0) < 60000) return;
  sess.at = now;
  try { AUTH_sessionPut_(token, sess); } catch (e) { /* ไม่ต้องทำอะไร */ }
}

function AUTH_sessionRemove_(token) {
  try { CacheService.getScriptCache().remove(AUTH_sessionKey_(token)); } catch (e) { /* ignore */ }
}

/** ลายนิ้วมือของรหัสผ่าน — เปลี่ยนรหัสผ่านแล้วเซสชันเดิมทุกเครื่องหมดอายุทันที */
function AUTH_pwFingerprint_(teacher) {
  return str(teacher && teacher.password_hash).slice(-16);
}

/* ---------------- นับการเข้าสู่ระบบผิด ---------------- */

function AUTH_maxAttempts_() { return Math.max(3, CFG_num('login_max_attempts') || 5); }
function AUTH_lockMinutes_() { return Math.max(1, CFG_num('login_lock_min') || 15); }

function AUTH_failCount_(username) {
  try { return num(CacheService.getScriptCache().get('lf:' + username), 0); } catch (e) { return 0; }
}

function AUTH_failAdd_(username, count) {
  try { CacheService.getScriptCache().put('lf:' + username, String(count), AUTH_lockMinutes_() * 60); } catch (e) { }
}

function AUTH_failClear_(username) {
  try { CacheService.getScriptCache().remove('lf:' + AUTH_normalizeUsername(username)); } catch (e) { }
}

/* ================================================================= */
/* บริบทผู้ใช้                                                         */
/* ================================================================= */

var AUTH_MEM = null;

function AUTH_blankCtx_() {
  return {
    ok: false, token: '', username: '', email: '', teacherId: '', name: '', role: '', roleName: '',
    level: 0, department: '', code: '', mustChangePassword: false,
    reason: '', code_reason: '', _seal: AUTH_SEAL
  };
}

function AUTH_fail_(ctx, reason, code) {
  ctx.reason = reason;
  ctx.code_reason = code;
  AUTH_MEM = ctx;
  return ctx;
}

/**
 * บริบทผู้ใช้จาก token — เรียกได้หลายครั้ง คำนวณจริงครั้งเดียว
 * คืนค่าเสมอ (ไม่ throw) เพื่อให้หน้าเว็บแสดงสาเหตุได้
 */
function AUTH_context(token) {
  if (AUTH_MEM) return AUTH_MEM;
  var ctx = AUTH_blankCtx_();

  var t = str(token).toLowerCase();
  if (!t) return AUTH_fail_(ctx, 'กรุณาเข้าสู่ระบบ', 'NO_SESSION');

  var sess = AUTH_TOKEN_RE.test(t) ? AUTH_sessionGet_(t) : null;
  if (!sess || !sess.tid) {
    return AUTH_fail_(ctx, 'หมดเวลาการใช้งานหรือยังไม่ได้เข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่', 'SESSION_EXPIRED');
  }

  var teacher;
  try {
    teacher = dbGetById('TEACHERS', sess.tid);
  } catch (e) {
    return AUTH_fail_(ctx, 'อ่านข้อมูลผู้ใช้ไม่สำเร็จ: ' + ((e && e.message) || 'ไม่ทราบสาเหตุ'), 'AUTH_ERROR');
  }

  if (!teacher) {
    AUTH_sessionRemove_(t);
    return AUTH_fail_(ctx, 'ไม่พบบัญชีผู้ใช้นี้แล้ว กรุณาติดต่อผู้ดูแลระบบ', 'NOT_FOUND');
  }
  if (str(teacher.status) !== 'ACTIVE') {
    AUTH_sessionRemove_(t);
    return AUTH_fail_(ctx, 'บัญชี ' + str(teacher.username) + ' ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ', 'INACTIVE');
  }
  if (!AUTH_safeEqual_(AUTH_pwFingerprint_(teacher), str(sess.fp))) {
    AUTH_sessionRemove_(t);
    return AUTH_fail_(ctx, 'รหัสผ่านของบัญชีนี้ถูกเปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่', 'PASSWORD_CHANGED');
  }

  var role = str(teacher.role) || 'TEACHER';
  if (!ROLES[role]) role = 'TEACHER';

  ctx.ok = true;
  ctx.token = t;
  ctx.teacherId = teacher.id;
  ctx.username = str(teacher.username);
  ctx.email = str(teacher.email).toLowerCase();
  ctx.name = teacherFullName(teacher);
  ctx.code = str(teacher.code);
  ctx.department = str(teacher.department);
  ctx.role = role;
  ctx.roleName = ROLES[role].name;
  ctx.level = ROLES[role].level;
  ctx.mustChangePassword = bool(teacher.must_change_password);

  AUTH_sessionTouch_(t, sess);
  AUTH_MEM = ctx;
  return ctx;
}

function AUTH_error_(message, code) {
  var e = new Error(message);
  e.authCode = code;
  return e;
}

/* ================================================================= */
/* เข้าสู่ระบบ / ออกจากระบบ / เปลี่ยนรหัสผ่าน                          */
/* ================================================================= */

/** ตรวจชื่อผู้ใช้และรหัสผ่าน แล้วออกเซสชันใหม่ คืน ctx ของผู้ใช้ */
function AUTH_login(username, password) {
  var u = AUTH_normalizeUsername(username);
  var p = String(password === null || password === undefined ? '' : password);
  if (!u || !p) throw AUTH_error_('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน', 'LOGIN_FAILED');
  if (u.length > 64) u = u.substring(0, 64);

  var max = AUTH_maxAttempts_();
  var fails = AUTH_failCount_(u);
  if (fails >= max) {
    throw AUTH_error_('เข้าสู่ระบบผิดเกิน ' + max + ' ครั้ง บัญชีนี้ถูกพักไว้ชั่วคราว\n' +
      'กรุณารอ ' + AUTH_lockMinutes_() + ' นาทีแล้วลองใหม่ หรือติดต่อผู้ดูแลระบบให้รีเซ็ตรหัสผ่าน', 'LOCKED');
  }

  var teacher = AUTH_USERNAME_RE.test(u) ? AUTH_findByUsername_(u) : null;
  var passed = AUTH_verifyPassword(p, teacher ? teacher.password_hash : '');

  if (!teacher || !passed) {
    AUTH_failAdd_(u, fails + 1);
    if (teacher) {
      AUDIT_log(null, 'LOGIN_FAILED', 'TEACHERS', teacher.id, null, null,
        'ชื่อผู้ใช้ ' + u + ' ครั้งที่ ' + (fails + 1));
    }
    var left = max - fails - 1;
    throw AUTH_error_('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' +
      (left > 0 && left <= 2 ? ' (ลองได้อีก ' + left + ' ครั้ง)' : ''), 'LOGIN_FAILED');
  }

  if (str(teacher.status) !== 'ACTIVE') {
    throw AUTH_error_('บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ', 'INACTIVE');
  }

  AUTH_failClear_(u);
  var token = AUTH_randomHex_(32);
  AUTH_sessionPut_(token, { tid: teacher.id, fp: AUTH_pwFingerprint_(teacher), at: new Date().getTime() });

  AUTH_MEM = null;
  var ctx = AUTH_context(token);
  AUDIT_log(ctx, 'LOGIN', 'TEACHERS', teacher.id, null, null);
  return ctx;
}

function AUTH_logout(ctx) {
  if (ctx && ctx.token) AUTH_sessionRemove_(ctx.token);
  if (ctx && ctx.ok) AUDIT_log(ctx, 'LOGOUT', 'TEACHERS', ctx.teacherId, null, null);
  return { loggedOut: true };
}

/** ผู้ใช้เปลี่ยนรหัสผ่านของตนเอง — เซสชันปัจจุบันใช้ต่อได้ เซสชันบนเครื่องอื่นหมดอายุ */
function AUTH_changePassword(ctx, currentPassword, newPassword) {
  AUTH_require(ctx);
  if (!ctx.teacherId || !ctx.token) throw new Error('บัญชีนี้เปลี่ยนรหัสผ่านผ่านหน้าเว็บไม่ได้');

  var t = dbGetById('TEACHERS', ctx.teacherId);
  if (!t) throw new Error('ไม่พบข้อมูลบัญชีผู้ใช้');
  if (!AUTH_verifyPassword(currentPassword, t.password_hash)) throw new Error('รหัสผ่านปัจจุบันไม่ถูกต้อง');

  var next = String(newPassword === null || newPassword === undefined ? '' : newPassword);
  var errs = AUTH_passwordProblems(next, t.username);
  if (next === String(currentPassword)) errs.push('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
  if (errs.length) throw new Error(errs.join('\n'));

  var patch = AUTH_passwordPatch_(next, false);
  withLock(function () { dbUpdate('TEACHERS', t.id, patch); });

  AUTH_sessionPut_(ctx.token, {
    tid: t.id, fp: AUTH_pwFingerprint_(patch), at: new Date().getTime()
  });
  ctx.mustChangePassword = false;
  AUDIT_log(ctx, 'PASSWORD_CHANGE', 'TEACHERS', t.id, null, null);
  return { changed: true };
}

/* ================================================================= */
/* ตรวจสิทธิ์                                                          */
/* ================================================================= */

/** ต้องเข้าสู่ระบบสำเร็จ และ ctx ต้องสร้างโดยเซิร์ฟเวอร์ */
function AUTH_require(ctx) {
  if (!ctx || ctx._seal !== AUTH_SEAL || !ctx.ok) {
    var sealed = ctx && ctx._seal === AUTH_SEAL;
    throw AUTH_error_(sealed && ctx.reason ? ctx.reason : 'กรุณาเข้าสู่ระบบ', 'AUTH_REQUIRED');
  }
  return ctx;
}

/** ต้องมีบทบาทอยู่ในรายการ */
function AUTH_requireRole(ctx, roles) {
  AUTH_require(ctx);
  if (roles.indexOf(ctx.role) < 0) {
    throw new Error('สิทธิ์ไม่เพียงพอ — ต้องเป็น ' +
      roles.map(function (r) { return ROLES[r] ? ROLES[r].name : r; }).join(' หรือ ') +
      ' (บัญชีนี้คือ ' + ctx.roleName + ')');
  }
  return ctx;
}

/** ต้องมีระดับสิทธิ์ตั้งแต่ n ขึ้นไป */
function AUTH_requireLevel(ctx, n) {
  AUTH_require(ctx);
  if (ctx.level < n) throw new Error('สิทธิ์ไม่เพียงพอสำหรับการดำเนินการนี้');
  return ctx;
}

/** ผู้ที่ตรวจ/อนุมัติเวรได้ */
function AUTH_requireReviewer(ctx) {
  return AUTH_requireRole(ctx, ['DAILY_HEAD', 'DUTY_ADMIN', 'EXECUTIVE', 'SYS_ADMIN']);
}

/** ผู้ที่จัดการข้อมูลหลัก/ตั้งค่าได้ */
function AUTH_requireAdmin(ctx) {
  return AUTH_requireRole(ctx, ['DUTY_ADMIN', 'SYS_ADMIN']);
}

/** ดูข้อมูลของครูคนอื่นได้หรือไม่ */
function AUTH_canSeeOthers(ctx) {
  return ctx.ok && ctx.level >= ROLES.DAILY_HEAD.level;
}

/** เป็นเจ้าของข้อมูล หรือมีสิทธิ์ดูแทน */
function AUTH_requireSelfOrReviewer(ctx, teacherId) {
  AUTH_require(ctx);
  if (ctx.teacherId === teacherId) return ctx;
  return AUTH_requireReviewer(ctx);
}

/** ข้อมูลบทบาททั้งหมด (สำหรับ dropdown) */
function AUTH_roleOptions() {
  return ROLE_KEYS.map(function (k) {
    return { value: k, label: ROLES[k].name, level: ROLES[k].level };
  }).sort(function (a, b) { return b.level - a.level; });
}

/** เมนูที่ผู้ใช้คนนี้เห็นได้ — ใช้ตกแต่ง UI เท่านั้น สิทธิ์จริงตรวจฝั่ง Server */
function AUTH_menuFor(ctx) {
  var m = [{ key: 'today', label: 'วันนี้', icon: '📌' },
           { key: 'mine', label: 'เวรของฉัน', icon: '🙋' }];
  if (ctx.level >= ROLES.DAILY_HEAD.level) {
    m.push({ key: 'assign', label: 'จัดเวร', icon: '🗓️' });
    m.push({ key: 'approve', label: 'อนุมัติ', icon: '✅' });
    m.push({ key: 'report', label: 'รายงาน', icon: '📊' });
  }
  if (ctx.level >= ROLES.DUTY_ADMIN.level) {
    m.push({ key: 'master', label: 'ข้อมูลหลัก', icon: '📚' });
    m.push({ key: 'settings', label: 'ตั้งค่า', icon: '⚙️' });
  }
  if (ctx.role === 'SYS_ADMIN') {
    m.push({ key: 'system', label: 'ระบบ', icon: '🛠️' });
  }
  if (ctx.role === 'EXECUTIVE') {
    m.splice(2, 0, { key: 'report', label: 'รายงาน', icon: '📊' });
    m = m.filter(function (x, i, arr) {
      return arr.map(function (y) { return y.key; }).indexOf(x.key) === i;
    });
  }
  return m;
}
