/**
 * TeacherService.gs — ทะเบียนครูและบัญชีผู้ใช้
 * ห้ามลบข้อมูลครูแบบถาวร หากมีประวัติการอยู่เวรให้เปลี่ยนเป็น INACTIVE
 * ห้ามส่ง password_hash ออกนอกเซิร์ฟเวอร์หรือบันทึกลง AUDIT_LOG
 */

/** คอลัมน์ลับที่ต้องตัดออกก่อนบันทึกประวัติ */
var TEACHER_SECRET_FIELDS = ['password_hash'];

/** สำเนาข้อมูลครูที่ปลอดภัยสำหรับบันทึกใน AUDIT_LOG */
function TEACHER_auditView_(row) {
  if (!row) return row;
  var out = {};
  Object.keys(row).forEach(function (k) {
    if (TEACHER_SECRET_FIELDS.indexOf(k) < 0) out[k] = row[k];
  });
  if (row.password_hash !== undefined) out.password_set = !!str(row.password_hash);
  return out;
}

function TEACHER_hasPassword_(t) { return !!str(t && t.password_hash); }

/** รายชื่อครู — ครูทั่วไปเห็นเฉพาะข้อมูลพื้นฐาน */
function TEACHER_list(ctx, opts) {
  AUTH_require(ctx);
  var o = opts || {};
  var rows = dbReadAll('TEACHERS');

  var full = AUTH_canSeeOthers(ctx);

  var filtered = rows.filter(function (t) {
    if (!o.includeInactive && str(t.status) !== 'ACTIVE') return false;
    if (o.department && str(t.department) !== o.department) return false;
    if (o.role && str(t.role) !== o.role) return false;
    if (o.q) {
      var q = str(o.q).toLowerCase();
      var hay = (teacherFullName(t) + str(t.code) + str(t.username) + str(t.email) +
        str(t.department)).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });

  filtered = sortBy(filtered, ['department', 'first_name']);

  return filtered.map(function (t) {
    var base = {
      id: t.id, code: str(t.code), name: teacherFullName(t),
      department: str(t.department), status: str(t.status)
    };
    if (full || t.id === ctx.teacherId) {
      base.username = str(t.username);
      base.hasPassword = TEACHER_hasPassword_(t);
      base.mustChangePassword = bool(t.must_change_password);
      base.prefix = str(t.prefix);
      base.firstName = str(t.first_name);
      base.lastName = str(t.last_name);
      base.email = str(t.email);
      base.position = str(t.position);
      base.phone = str(t.phone);
      base.role = str(t.role);
      base.roleName = ROLES[str(t.role)] ? ROLES[str(t.role)].name : '';
      base.note = str(t.note);
    }
    return base;
  });
}

/** รายชื่อแบบย่อสำหรับ dropdown (ทุกคนเรียกได้ ใช้ตอนขอเปลี่ยนเวร) */
function TEACHER_options(ctx) {
  AUTH_require(ctx);
  return dbFind('TEACHERS', { status: 'ACTIVE' }).map(function (t) {
    return { id: t.id, name: teacherFullName(t), department: str(t.department), code: str(t.code) };
  }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
}

function TEACHER_get(ctx, id) {
  AUTH_requireSelfOrReviewer(ctx, id);
  var t = dbGetById('TEACHERS', id);
  if (!t) throw new Error('ไม่พบข้อมูลครูรายนี้');
  return {
    id: t.id, code: str(t.code), prefix: str(t.prefix),
    firstName: str(t.first_name), lastName: str(t.last_name), name: teacherFullName(t),
    username: str(t.username), hasPassword: TEACHER_hasPassword_(t),
    mustChangePassword: bool(t.must_change_password),
    email: str(t.email), department: str(t.department), position: str(t.position),
    phone: str(t.phone), role: str(t.role),
    roleName: ROLES[str(t.role)] ? ROLES[str(t.role)].name : '',
    status: str(t.status), note: str(t.note)
  };
}

function TEACHER_validate_(data, existingId) {
  var errors = [];
  if (!str(data.firstName)) errors.push('กรุณากรอกชื่อ');
  if (!str(data.lastName)) errors.push('กรุณากรอกนามสกุล');

  var username = AUTH_normalizeUsername(data.username);
  var uProblem = AUTH_usernameProblem(username);
  if (uProblem) errors.push(uProblem);
  else {
    var dupU = AUTH_findByUsername_(username);
    if (dupU && dupU.id !== existingId) errors.push('ชื่อผู้ใช้ ' + username + ' ถูกใช้แล้วโดย ' + teacherFullName(dupU));
  }

  var password = String(data.password === null || data.password === undefined ? '' : data.password);
  if (password) errors = errors.concat(AUTH_passwordProblems(password, username));

  // อีเมลไม่บังคับ — ใช้รับการแจ้งเตือนเท่านั้น ไม่ได้ใช้เข้าสู่ระบบ
  var email = str(data.email).toLowerCase();
  if (email && !isEmail(email)) errors.push('รูปแบบอีเมลไม่ถูกต้อง');

  if (data.role && !ROLES[str(data.role)]) errors.push('บทบาทไม่ถูกต้อง');

  if (email) {
    var dup = dbGetBy('TEACHERS', { email: email });
    if (dup && dup.id !== existingId) errors.push('อีเมลนี้ถูกใช้แล้วโดย ' + teacherFullName(dup));
  }
  var code = str(data.code);
  if (code) {
    var dupC = dbGetBy('TEACHERS', { code: code });
    if (dupC && dupC.id !== existingId) errors.push('รหัสครู ' + code + ' ซ้ำกับ ' + teacherFullName(dupC));
  }
  return errors;
}

/**
 * เพิ่ม/แก้ไขครู — ถ้าเป็นครูใหม่และไม่ได้กรอกรหัสผ่าน ระบบจะสร้างรหัสผ่านชั่วคราว
 * แล้วคืนกลับมาให้ผู้ดูแลแจ้งครู (แสดงครั้งเดียว ไม่ได้เก็บเป็นข้อความธรรมดา)
 */
function TEACHER_save(ctx, data) {
  AUTH_requireAdmin(ctx);
  var d = data || {};
  var id = str(d.id);

  var errors = TEACHER_validate_(d, id);
  if (errors.length) throw new Error(errors.join('\n'));

  var password = String(d.password === null || d.password === undefined ? '' : d.password);
  var tempPassword = (!id && !password) ? AUTH_tempPassword_() : '';

  var payload = {
    code: sanitizeText(d.code),
    prefix: sanitizeText(d.prefix),
    first_name: sanitizeText(d.firstName),
    last_name: sanitizeText(d.lastName),
    username: AUTH_normalizeUsername(d.username),
    email: str(d.email).toLowerCase(),
    department: sanitizeText(d.department),
    position: sanitizeText(d.position),
    phone: sanitizeText(d.phone),
    role: str(d.role) || 'TEACHER',
    status: str(d.status) || 'ACTIVE',
    note: sanitizeText(d.note)
  };
  if (password || tempPassword) {
    var pw = AUTH_passwordPatch_(password || tempPassword, CFG_bool('password_force_change'));
    Object.keys(pw).forEach(function (k) { payload[k] = pw[k]; });
  }

  return withLock(function () {
    if (id) {
      var before = dbGetById('TEACHERS', id);
      if (!before) throw new Error('ไม่พบข้อมูลครูที่ต้องการแก้ไข');

      // กันการลดสิทธิ์ผู้ดูแลระบบคนสุดท้าย
      if (str(before.role) === 'SYS_ADMIN' && payload.role !== 'SYS_ADMIN') {
        var admins = dbFind('TEACHERS', { role: 'SYS_ADMIN', status: 'ACTIVE' });
        if (admins.length <= 1) throw new Error('ไม่สามารถลดสิทธิ์ผู้ดูแลระบบคนสุดท้ายได้');
      }

      var after = dbUpdate('TEACHERS', id, payload);
      if (payload.password_hash) AUTH_failClear_(payload.username);
      AUDIT_log(ctx, 'TEACHER_UPDATE', 'TEACHERS', id, TEACHER_auditView_(before), TEACHER_auditView_(payload));
      return { id: id, name: teacherFullName(after), username: payload.username };
    }
    var created = dbInsert('TEACHERS', payload);
    AUDIT_log(ctx, 'TEACHER_CREATE', 'TEACHERS', created.id, null, TEACHER_auditView_(payload));
    return {
      id: created.id, name: teacherFullName(created), username: payload.username,
      tempPassword: tempPassword
    };
  });
}

/**
 * รีเซ็ตรหัสผ่านของครูเป็นรหัสผ่านชั่วคราว — เซสชันเดิมของครูรายนั้นหมดอายุทันที
 * รหัสผ่านของตนเองให้เปลี่ยนผ่านเมนูบัญชีของฉัน
 */
function TEACHER_resetPassword(ctx, id) {
  AUTH_requireAdmin(ctx);
  var t = dbGetById('TEACHERS', str(id));
  if (!t) throw new Error('ไม่พบข้อมูลครูรายนี้');
  if (t.id === ctx.teacherId) throw new Error('รหัสผ่านของตนเองให้เปลี่ยนที่เมนู บัญชีของฉัน > เปลี่ยนรหัสผ่าน');
  if (!str(t.username)) throw new Error('ครูรายนี้ยังไม่มีชื่อผู้ใช้ กรุณากด "แก้ไข" เพื่อตั้งชื่อผู้ใช้ก่อน');

  var temp = AUTH_tempPassword_();
  withLock(function () {
    dbUpdate('TEACHERS', t.id, AUTH_passwordPatch_(temp, CFG_bool('password_force_change')));
  });
  AUTH_failClear_(t.username);
  AUDIT_log(ctx, 'PASSWORD_RESET', 'TEACHERS', t.id, null, null, 'ชื่อผู้ใช้ ' + str(t.username));
  return { id: t.id, name: teacherFullName(t), username: str(t.username), tempPassword: temp };
}

/**
 * ออกรหัสผ่านชั่วคราวให้ครูที่ยังใช้งานอยู่แต่ยังเข้าสู่ระบบไม่ได้
 * (ข้อมูลที่ย้ายมาจากระบบเดิมซึ่งเข้าด้วยอีเมล หรือเพิ่มตรงในชีต)
 */
function TEACHER_issuePasswords(ctx) {
  AUTH_requireAdmin(ctx);
  return withLock(function () {
    var rows = dbReadAll('TEACHERS');
    var taken = {};
    rows.forEach(function (r) {
      var u = AUTH_normalizeUsername(r.username);
      if (u) taken[u] = true;
    });

    var items = [], issued = [];
    rows.forEach(function (r) {
      if (str(r.status) !== 'ACTIVE' || TEACHER_hasPassword_(r)) return;
      var username = AUTH_normalizeUsername(r.username);
      if (!username) {
        username = TEACHER_uniqueUsername_(TEACHER_suggestUsername_(r), taken);
        if (!username) return;
        taken[username] = true;
      }
      var temp = AUTH_tempPassword_();
      var patch = AUTH_passwordPatch_(temp, CFG_bool('password_force_change'));
      patch.username = username;
      items.push({ id: r.id, patch: patch });
      issued.push({ name: teacherFullName(r), code: str(r.code), username: username, tempPassword: temp });
    });

    if (items.length) dbUpdateMany('TEACHERS', items);
    AUDIT_log(ctx, 'PASSWORD_ISSUE', 'TEACHERS', '', null, { count: issued.length });
    return { count: issued.length, accounts: issued };
  }, 120000);
}

/** ชื่อผู้ใช้ที่แนะนำจากอีเมลหรือรหัสครู (ว่าง = เดาไม่ได้) */
function TEACHER_suggestUsername_(t) {
  var candidates = [str(t.email).split('@')[0], str(t.code)];
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i].toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (/^[0-9]/.test(c)) c = 't' + c;
    c = c.substring(0, 32);
    if (!AUTH_usernameProblem(c)) return c;
  }
  return '';
}

/** ทำให้ชื่อผู้ใช้ไม่ซ้ำโดยเติมตัวเลขต่อท้าย */
function TEACHER_uniqueUsername_(base, taken) {
  if (!base) return '';
  if (!taken[base]) return base;
  for (var n = 2; n < 1000; n++) {
    var suffix = String(n);
    var c = base.substring(0, 32 - suffix.length) + suffix;
    if (!taken[c]) return c;
  }
  return '';
}

/** ระงับการใช้งาน (ไม่ลบถาวร) */
function TEACHER_setStatus(ctx, id, status) {
  AUTH_requireAdmin(ctx);
  var t = dbGetById('TEACHERS', id);
  if (!t) throw new Error('ไม่พบข้อมูลครูรายนี้');
  var s = str(status) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';

  if (s === 'INACTIVE') {
    if (str(t.role) === 'SYS_ADMIN') {
      var admins = dbFind('TEACHERS', { role: 'SYS_ADMIN', status: 'ACTIVE' });
      if (admins.length <= 1) throw new Error('ไม่สามารถระงับผู้ดูแลระบบคนสุดท้ายได้');
    }
    var upcoming = SCHEDULE_upcomingCountForTeacher_(id);
    if (upcoming > 0) {
      AUDIT_log(ctx, 'TEACHER_INACTIVE_WITH_DUTY', 'TEACHERS', id, null,
        { upcoming: upcoming }, 'ครูรายนี้ยังมีเวรค้างอยู่ ' + upcoming + ' รายการ');
    }
  }

  dbUpdate('TEACHERS', id, { status: s });
  AUDIT_log(ctx, 'TEACHER_STATUS', 'TEACHERS', id, { status: t.status }, { status: s });
  return { id: id, status: s };
}

/** รายชื่อกลุ่มสาระ/ฝ่ายทั้งหมดที่มีอยู่ */
function TEACHER_departments(ctx) {
  AUTH_require(ctx);
  var seen = {};
  dbReadAll('TEACHERS').forEach(function (t) {
    var d = str(t.department);
    if (d) seen[d] = true;
  });
  return Object.keys(seen).sort();
}

/**
 * นำเข้าครูหลายรายการจากข้อความ CSV/TSV
 * หัวตาราง: รหัส, คำนำหน้า, ชื่อ, นามสกุล, ชื่อผู้ใช้, รหัสผ่าน, กลุ่มสาระ, ตำแหน่ง, โทรศัพท์, อีเมล, บทบาท
 * ชื่อผู้ใช้ว่าง = ใช้ส่วนหน้า @ ของอีเมลหรือรหัสครู · รหัสผ่านว่าง = ระบบสร้างรหัสผ่านชั่วคราว
 * ถ้าชื่อผู้ใช้ตรงกับครูที่มีอยู่แล้ว จะเป็นการอัปเดตข้อมูล (รหัสผ่านเดิมคงไว้ ถ้าไม่ได้กรอก)
 */
var TEACHER_IMPORT_HEADERS = [
  { key: 'code', aliases: ['รหัส', 'รหัสครู', 'code', 'id'] },
  { key: 'prefix', aliases: ['คำนำหน้า', 'prefix', 'title'] },
  { key: 'firstName', aliases: ['ชื่อ', 'firstname', 'first_name', 'name'] },
  { key: 'lastName', aliases: ['นามสกุล', 'สกุล', 'lastname', 'last_name', 'surname'] },
  { key: 'username', aliases: ['ชื่อผู้ใช้', 'username', 'user', 'login'] },
  { key: 'password', aliases: ['รหัสผ่าน', 'password', 'pass'] },
  { key: 'email', aliases: ['อีเมล', 'อีเมล์', 'email', 'e-mail'] },
  { key: 'department', aliases: ['กลุ่มสาระ', 'กลุ่ม', 'ฝ่าย', 'department', 'dept'] },
  { key: 'position', aliases: ['ตำแหน่ง', 'position'] },
  { key: 'phone', aliases: ['โทรศัพท์', 'เบอร์', 'โทร', 'phone', 'tel'] },
  { key: 'role', aliases: ['บทบาท', 'สิทธิ์', 'role'] }
];

/** ตรวจข้อมูลนำเข้า (ส่งกลับหน้าเว็บโดยไม่มีรหัสผ่านที่วางมา) */
function TEACHER_importPreview(ctx, text) {
  AUTH_requireAdmin(ctx);
  var preview = TEACHER_importAnalyze_(text);
  preview.rows = preview.rows.map(function (r) {
    var o = {};
    Object.keys(r).forEach(function (k) { if (k !== 'password') o[k] = r[k]; });
    return o;
  });
  return preview;
}

/** หาครูเดิมจากอีเมลหรือรหัสครู — ใช้เมื่อไฟล์นำเข้าไม่มีชื่อผู้ใช้ (เช่น ไฟล์จากระบบเดิม) */
function TEACHER_matchExisting_(rec) {
  var rows = dbReadAll('TEACHERS');
  for (var i = 0; i < rows.length; i++) {
    if (rec.email && str(rows[i].email).toLowerCase() === rec.email) return DB_clone_(rows[i]);
  }
  for (var j = 0; j < rows.length; j++) {
    if (rec.code && str(rows[j].code) === rec.code) return DB_clone_(rows[j]);
  }
  return null;
}

function TEACHER_importAnalyze_(text) {
  var rows = parseCsv(text);
  if (rows.length < 2) throw new Error('ข้อมูลไม่ครบ ต้องมีบรรทัดหัวตารางและอย่างน้อย 1 บรรทัดข้อมูล');

  var header = rows[0].map(function (h) { return str(h).toLowerCase(); });
  var colOf = {};
  TEACHER_IMPORT_HEADERS.forEach(function (h) {
    for (var i = 0; i < header.length; i++) {
      if (h.aliases.indexOf(header[i]) >= 0) { colOf[h.key] = i; return; }
    }
  });

  if (colOf.firstName === undefined || colOf.lastName === undefined) {
    throw new Error('ไม่พบคอลัมน์ที่จำเป็น — ต้องมี ชื่อ และ นามสกุล (แนะนำให้มี ชื่อผู้ใช้ ด้วย)');
  }

  var taken = {};
  dbReadAll('TEACHERS').forEach(function (t) {
    var u = AUTH_normalizeUsername(t.username);
    if (u) taken[u] = true;
  });

  var seenUser = {}, seenEmail = {};
  var out = rows.slice(1).map(function (r, idx) {
    var rec = {};
    Object.keys(colOf).forEach(function (k) { rec[k] = sanitizeText(r[colOf[k]]); });
    rec.password = colOf.password === undefined ? '' : String(r[colOf.password] || '');
    rec.email = str(rec.email).toLowerCase();
    rec.role = TEACHER_normalizeRole_(rec.role);
    rec._line = idx + 2;

    rec.username = AUTH_normalizeUsername(rec.username);
    var existing = null;
    if (rec.username) {
      existing = AUTH_findByUsername_(rec.username);
    } else {
      existing = TEACHER_matchExisting_(rec);
      rec.username = existing && str(existing.username) ? AUTH_normalizeUsername(existing.username) :
        TEACHER_uniqueUsername_(TEACHER_suggestUsername_(rec), Object.assign({}, taken, seenUser));
      rec._usernameGenerated = !!rec.username;
    }
    rec._mode = existing ? 'UPDATE' : 'CREATE';
    rec._existingId = existing ? existing.id : '';

    var errs = TEACHER_validate_(rec, rec._existingId);
    if (rec.username && seenUser[rec.username]) errs.push('ชื่อผู้ใช้ซ้ำกับบรรทัดที่ ' + seenUser[rec.username]);
    else if (rec.username) seenUser[rec.username] = rec._line;
    if (rec.email && seenEmail[rec.email]) errs.push('อีเมลซ้ำกับบรรทัดที่ ' + seenEmail[rec.email]);
    else if (rec.email) seenEmail[rec.email] = rec._line;

    rec._passwordMode = rec.password ? 'GIVEN' :
      ((existing && TEACHER_hasPassword_(existing)) ? 'KEEP' : 'GENERATE');
    rec._errors = errs;
    return rec;
  });

  return {
    total: out.length,
    ok: out.filter(function (r) { return !r._errors.length; }).length,
    error: out.filter(function (r) { return r._errors.length; }).length,
    create: out.filter(function (r) { return r._mode === 'CREATE' && !r._errors.length; }).length,
    update: out.filter(function (r) { return r._mode === 'UPDATE' && !r._errors.length; }).length,
    rows: out
  };
}



function TEACHER_normalizeRole_(v) {
  var s = str(v).toUpperCase();
  if (ROLES[s]) return s;
  var map = {
    'ผู้ดูแลระบบ': 'SYS_ADMIN', 'แอดมิน': 'SYS_ADMIN', 'ADMIN': 'SYS_ADMIN',
    'ผู้บริหาร': 'EXECUTIVE', 'ผอ': 'EXECUTIVE', 'รองผอ': 'EXECUTIVE',
    'หัวหน้างานเวร': 'DUTY_ADMIN', 'หัวหน้างาน': 'DUTY_ADMIN',
    'หัวหน้าเวร': 'DAILY_HEAD', 'หัวหน้าเวรประจำวัน': 'DAILY_HEAD',
    'ครู': 'TEACHER', '': 'TEACHER'
  };
  return map[str(v)] || 'TEACHER';
}

function TEACHER_importCommit(ctx, text) {
  AUTH_requireAdmin(ctx);
  var preview = TEACHER_importAnalyze_(text);
  var valid = preview.rows.filter(function (r) { return !r._errors.length; });
  if (!valid.length) throw new Error('ไม่มีข้อมูลที่ผ่านการตรวจสอบ');

  var forceChange = CFG_bool('password_force_change');
  return withLock(function () {
    var toCreate = [], toUpdate = [], accounts = [];
    valid.forEach(function (r) {
      var payload = {
        code: r.code, prefix: r.prefix, first_name: r.firstName, last_name: r.lastName,
        username: r.username, email: r.email, department: r.department, position: r.position,
        phone: r.phone, role: r.role || 'TEACHER', status: 'ACTIVE'
      };
      if (r._passwordMode !== 'KEEP') {
        var temp = r._passwordMode === 'GENERATE' ? AUTH_tempPassword_() : '';
        var pw = AUTH_passwordPatch_(r.password || temp, forceChange);
        Object.keys(pw).forEach(function (k) { payload[k] = pw[k]; });
        if (temp) {
          accounts.push({
            name: str(r.prefix) + str(r.firstName) + ' ' + str(r.lastName),
            code: str(r.code), username: r.username, tempPassword: temp
          });
        }
      }
      if (r._mode === 'UPDATE') toUpdate.push({ id: r._existingId, patch: payload });
      else toCreate.push(payload);
    });

    if (toCreate.length) dbInsertMany('TEACHERS', toCreate);
    if (toUpdate.length) dbUpdateMany('TEACHERS', toUpdate);

    AUDIT_log(ctx, 'TEACHER_IMPORT', 'TEACHERS', '', null,
      { created: toCreate.length, updated: toUpdate.length, passwordsIssued: accounts.length });

    return {
      created: toCreate.length, updated: toUpdate.length, skipped: preview.error,
      accounts: accounts
    };
  }, 120000);
}

/** ตัวอย่างไฟล์นำเข้า */
function TEACHER_importTemplate() {
  return 'รหัส,คำนำหน้า,ชื่อ,นามสกุล,ชื่อผู้ใช้,รหัสผ่าน,กลุ่มสาระ,ตำแหน่ง,โทรศัพท์,อีเมล,บทบาท\n' +
    'T001,นาย,สมชาย,ใจดี,somchai,,วิทยาศาสตร์และเทคโนโลยี,ครูชำนาญการ,0812345678,,ครู\n' +
    'T002,นาง,สมหญิง,ตั้งใจ,somying,,ภาษาไทย,ครูชำนาญการพิเศษ,0823456789,,หัวหน้าเวร\n';
}
