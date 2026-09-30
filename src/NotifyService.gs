/**
 * NotifyService.gs — การแจ้งเตือนทางอีเมล
 * การแจ้งเตือนล้มเหลวต้องไม่ทำให้การทำงานหลักล้มเหลว
 */

function NOTIFY_enabled_() {
  try { return CFG_bool('notify_enabled'); } catch (e) { return false; }
}

function NOTIFY_send_(to, subject, htmlBody) {
  if (!NOTIFY_enabled_()) return false;
  var email = str(to);
  if (!isEmail(email)) return false;
  try {
    MailApp.sendEmail({
      to: email,
      subject: '[CWK DutyFlow] ' + subject,
      htmlBody: NOTIFY_wrap_(subject, htmlBody),
      name: CFG_str('school_short') || 'CWK DutyFlow'
    });
    return true;
  } catch (e) {
    return false;
  }
}

function NOTIFY_wrap_(title, body) {
  var primary = CFG_str('brand_primary') || '#7A1F2B';
  return '<div style="font-family:Sarabun,Tahoma,sans-serif;max-width:560px;margin:0 auto;' +
    'border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">' +
    '<div style="background:' + primary + ';color:#fff;padding:16px 20px">' +
    '<div style="font-size:18px;font-weight:700">' + escapeHtml(title) + '</div>' +
    '<div style="opacity:.85;font-size:13px">' + escapeHtml(CFG_str('school_name')) + '</div></div>' +
    '<div style="padding:20px;color:#1F2937;font-size:15px;line-height:1.7">' + body + '</div>' +
    '<div style="padding:12px 20px;background:#F7F7F9;color:#6b7280;font-size:12px">' +
    escapeHtml(CFG_str('report_footer')) + '</div></div>';
}

/** แจ้งผู้มีสิทธิ์อนุมัติว่ามีคำขอเปลี่ยนเวรใหม่ */
function NOTIFY_swapCreated(swapId) {
  if (!NOTIFY_enabled_()) return;
  try {
    var req = dbGetById('SWAP_REQUESTS', swapId);
    if (!req) return;
    var from = dbGetById('TEACHERS', req.from_teacher_id);
    var to = dbGetById('TEACHERS', req.to_teacher_id);
    var sch = dbGetById('DAILY_SCHEDULE', req.schedule_id) || {};
    var point = dbGetById('DUTY_POINTS', sch.point_id) || {};

    var body = '<p><b>' + escapeHtml(teacherFullName(from)) + '</b> ขอเปลี่ยนเวร</p>' +
      '<ul><li>วันที่: ' + escapeHtml(thaiDate(toDateStr(req.date), { weekday: true })) + '</li>' +
      '<li>จุดเวร: ' + escapeHtml(str(point.name)) + '</li>' +
      '<li>ผู้อยู่แทน: ' + escapeHtml(teacherFullName(to)) + '</li>' +
      '<li>เหตุผล: ' + escapeHtml(str(req.reason)) + '</li></ul>' +
      '<p>กรุณาเข้าระบบเพื่อพิจารณาอนุมัติ</p>';

    NOTIFY_reviewers_().forEach(function (t) {
      NOTIFY_send_(t.email, 'มีคำขอเปลี่ยนเวรรออนุมัติ', body);
    });
    if (to) NOTIFY_send_(to.email, 'ท่านถูกขอให้อยู่เวรแทน', body);
  } catch (e) { /* ไม่ขัดขวางงานหลัก */ }
}

/** แจ้งผลการพิจารณา */
function NOTIFY_swapDecided(swapId, approved) {
  if (!NOTIFY_enabled_()) return;
  try {
    var req = dbGetById('SWAP_REQUESTS', swapId);
    if (!req) return;
    var from = dbGetById('TEACHERS', req.from_teacher_id);
    var to = dbGetById('TEACHERS', req.to_teacher_id);
    var approver = dbGetById('TEACHERS', req.approver_id);

    var body = '<p>คำขอเปลี่ยนเวรวันที่ ' +
      escapeHtml(thaiDate(toDateStr(req.date), { weekday: true })) + ' ' +
      (approved ? '<b style="color:#15803d">ได้รับการอนุมัติ</b>' :
        '<b style="color:#b91c1c">ไม่ได้รับการอนุมัติ</b>') + '</p>' +
      '<ul><li>ผู้พิจารณา: ' + escapeHtml(teacherFullName(approver)) +
      ' (' + escapeHtml(AUTH_approvalLevelName(req.approval_level)) + ')</li>' +
      (approved ? '' : '<li>เหตุผล: ' + escapeHtml(str(req.reject_reason)) + '</li>') +
      '</ul>';

    if (from) NOTIFY_send_(from.email, 'ผลการพิจารณาคำขอเปลี่ยนเวร', body);
    if (to && approved) NOTIFY_send_(to.email, 'ท่านได้รับมอบหมายให้อยู่เวรแทน', body);
  } catch (e) { /* ignore */ }
}

/** แจ้งเหตุการณ์รุนแรง */
function NOTIFY_incident(incidentId) {
  if (!NOTIFY_enabled_()) return;
  try {
    var inc = dbGetById('INCIDENTS', incidentId);
    if (!inc) return;
    if (['HIGH', 'CRITICAL'].indexOf(str(inc.severity)) < 0) return;

    var point = dbGetById('DUTY_POINTS', inc.point_id) || {};
    var reporter = dbGetById('TEACHERS', inc.reporter_id);
    var body = '<p><b>' + escapeHtml(str(inc.title)) + '</b></p>' +
      '<ul><li>ระดับ: ' + escapeHtml(INCIDENT_SEVERITY[str(inc.severity)] || '') + '</li>' +
      '<li>จุดเวร: ' + escapeHtml(str(point.name)) + '</li>' +
      '<li>ผู้รายงาน: ' + escapeHtml(teacherFullName(reporter)) + '</li>' +
      '<li>วันที่: ' + escapeHtml(thaiDate(toDateStr(inc.date))) + '</li></ul>' +
      '<p>' + escapeHtml(str(inc.detail)) + '</p>';

    NOTIFY_reviewers_(true).forEach(function (t) {
      NOTIFY_send_(t.email, 'แจ้งเหตุการณ์ระดับ' + (INCIDENT_SEVERITY[str(inc.severity)] || ''), body);
    });
  } catch (e) { /* ignore */ }
}

function NOTIFY_reviewers_(includeExecutive) {
  var roles = ['DUTY_ADMIN', 'DAILY_HEAD'];
  if (includeExecutive) roles.push('EXECUTIVE');
  return dbFind('TEACHERS', { status: 'ACTIVE' }).filter(function (t) {
    return roles.indexOf(str(t.role)) >= 0 && isEmail(str(t.email));
  }).map(function (t) { return { email: str(t.email), name: teacherFullName(t) }; });
}

/* ================================================================= */
/* ทริกเกอร์รายวัน                                                    */
/* ================================================================= */

/** เตือนครูที่มีเวรวันนี้ (ตั้งเป็น time-driven trigger ตอนเช้า) */
function แจ้งเตือนเวรประจำวัน() {
  if (!NOTIFY_enabled_()) return;
  var d = today();
  var rows = dbReadAll('DAILY_SCHEDULE').filter(function (r) {
    return toDateStr(r.date) === d && str(r.status) !== 'CANCELLED';
  });
  if (!rows.length) return;

  var teachers = indexBy(dbReadAll('TEACHERS'), 'id');
  var points = indexBy(dbReadAll('DUTY_POINTS'), 'id');
  var slots = indexBy(dbReadAll('TIME_SLOTS'), 'id');
  var byTeacher = groupBy(rows, function (r) { return r.effective_teacher_id; });

  Object.keys(byTeacher).forEach(function (tid) {
    var t = teachers[tid];
    if (!t || !isEmail(str(t.email))) return;
    var items = byTeacher[tid].map(function (r) {
      var s = slots[r.slot_id] || {}, p = points[r.point_id] || {};
      return '<li>' + escapeHtml(str(s.name)) + ' (' + escapeHtml(str(s.start_time)) +
        '–' + escapeHtml(str(s.end_time)) + ') ที่ <b>' + escapeHtml(str(p.name)) + '</b></li>';
    }).join('');
    NOTIFY_send_(t.email, 'เวรประจำวัน ' + thaiDate(d, { weekday: true }),
      '<p>เรียน ' + escapeHtml(teacherFullName(t)) + '</p>' +
      '<p>วันนี้ท่านมีเวรประจำวันดังนี้</p><ul>' + items + '</ul>' +
      '<p>อย่าลืมเช็คอินพร้อมแนบภาพหลักฐานผ่านระบบ</p>');
  });
}

/** สรุปผู้ไม่มาอยู่เวรให้หัวหน้างาน (ตั้งเป็น trigger ตอนเย็น) */
function สรุปผู้ไม่อยู่เวรประจำวัน() {
  if (!NOTIFY_enabled_() || !CFG_bool('notify_absent_summary')) return;
  var d = today();
  var rows = REPORT_buildRows_(d, d).filter(function (r) {
    return r.status !== 'CANCELLED' && (r.attend === 'ABSENT' || r.evidence !== 'FULL');
  });
  if (!rows.length) return;

  var items = rows.map(function (r) {
    return '<li>' + escapeHtml(r.pointName) + ' · ' + escapeHtml(r.slotName) + ' · ' +
      escapeHtml(r.effectiveTeacherName || '(ว่าง)') + ' — ' +
      escapeHtml(SCHEDULE_attendLabel_(r.attend)) + ' / ' +
      escapeHtml(SCHEDULE_evidenceLabel_(r.evidence)) + '</li>';
  }).join('');

  NOTIFY_reviewers_(true).forEach(function (t) {
    NOTIFY_send_(t.email, 'สรุปเวรที่ต้องติดตาม ' + thaiDate(d),
      '<p>รายการเวรวันนี้ที่ยังไม่สมบูรณ์ ' + rows.length + ' รายการ</p><ul>' + items + '</ul>');
  });
}

/** สร้างตารางล่วงหน้าอัตโนมัติ (ตั้งเป็น trigger รายสัปดาห์) */
function สร้างตารางเวรล่วงหน้าอัตโนมัติ() {
  var semester = SEMESTER_active();
  if (!semester) return;
  var ahead = num(CFG_get('schedule_generate_ahead', 30), 30);
  try {
    withLock(function () {
      SCHEDULE_build_(semester, today(), addDays(today(), ahead), false);
    }, 300000);
  } catch (e) { /* ignore */ }
}
