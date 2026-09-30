/**
 * AuthService.gs — ตรวจสอบตัวตนและสิทธิ์
 *
 * กฎเหล็ก: ตรวจสอบสิทธิ์ฝั่ง Server ทุกครั้ง ห้ามเชื่อ role ที่ส่งมาจากหน้าเว็บ
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

var AUTH_MEM = null;

/**
 * บริบทผู้ใช้ปัจจุบัน — เรียกได้หลายครั้ง คำนวณจริงครั้งเดียว
 * คืนค่าเสมอ (ไม่ throw) เพื่อให้หน้าเว็บแสดงสาเหตุได้
 */
function AUTH_context() {
  if (AUTH_MEM) return AUTH_MEM;

  var ctx = {
    ok: false, email: '', teacherId: '', name: '', role: '', roleName: '',
    level: 0, department: '', code: '', reason: '', code_reason: ''
  };

  var email = '';
  try { email = str(Session.getActiveUser().getEmail()).toLowerCase(); } catch (e) { email = ''; }

  if (!email) {
    ctx.reason = 'ระบบไม่สามารถอ่านอีเมลผู้ใช้ได้ กรุณาเปิดจากบัญชี Google ของโรงเรียน ' +
      'และตรวจสอบว่าการ Deploy ตั้งค่า "ผู้ใช้ที่เข้าถึง" เป็นโดเมนโรงเรียน';
    ctx.code_reason = 'NO_EMAIL';
    AUTH_MEM = ctx;
    return ctx;
  }

  ctx.email = email;

  var bootstrap = PROP_bootstrapAdmin();
  var domain = CFG_schoolDomain();
  if (domain && email.indexOf('@' + domain) < 0 && email !== bootstrap) {
    ctx.reason = 'บัญชี ' + email + ' ไม่ได้อยู่ในโดเมนของโรงเรียน (@' + domain + ')\n' +
      'กรุณาออกจากระบบแล้วเข้าใหม่ด้วยบัญชีอีเมลของโรงเรียน';
    ctx.code_reason = 'WRONG_DOMAIN';
    AUTH_MEM = ctx;
    return ctx;
  }

  var teacher = null;
  try { teacher = dbGetBy('TEACHERS', { email: email }); } catch (e) { teacher = null; }

  if (!teacher && email === bootstrap) {
    // ผู้ติดตั้งระบบเข้าใช้ได้เสมอ แม้ยังไม่มีข้อมูลครู
    ctx.ok = true;
    ctx.role = 'SYS_ADMIN';
    ctx.roleName = ROLES.SYS_ADMIN.name;
    ctx.level = ROLES.SYS_ADMIN.level;
    ctx.name = 'ผู้ติดตั้งระบบ';
    AUTH_MEM = ctx;
    return ctx;
  }

  if (!teacher) {
    ctx.reason = 'ไม่พบบัญชี ' + email + ' ในทะเบียนครู กรุณาติดต่อผู้ดูแลระบบเพื่อเพิ่มข้อมูล';
    ctx.code_reason = 'NOT_REGISTERED';
    AUTH_MEM = ctx;
    return ctx;
  }

  if (str(teacher.status) !== 'ACTIVE') {
    ctx.reason = 'บัญชี ' + email + ' ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ';
    ctx.code_reason = 'INACTIVE';
    AUTH_MEM = ctx;
    return ctx;
  }

  var role = str(teacher.role) || 'TEACHER';
  if (!ROLES[role]) role = 'TEACHER';

  ctx.ok = true;
  ctx.teacherId = teacher.id;
  ctx.name = teacherFullName(teacher);
  ctx.code = str(teacher.code);
  ctx.department = str(teacher.department);
  ctx.role = role;
  ctx.roleName = ROLES[role].name;
  ctx.level = ROLES[role].level;

  AUTH_MEM = ctx;
  return ctx;
}

/** ต้องเข้าสู่ระบบสำเร็จ */
function AUTH_require(ctx) {
  if (!ctx || !ctx.ok) {
    var e = new Error(ctx && ctx.reason ? ctx.reason : 'กรุณาเข้าสู่ระบบ');
    e.authCode = ctx && ctx.code_reason;
    throw e;
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
