/**
 * Code.gs — จุดเข้าเว็บแอปและประตูเรียก API เพียงทางเดียว
 *
 * ฝั่ง Client เรียกได้ทางเดียวคือ api(action, payload, token)
 * ทุก action ตรวจสอบสิทธิ์ฝั่ง Server เสมอ ยกเว้นรายการใน API_PUBLIC_
 */

var APP_VERSION = '2.0.0';

function doGet(e) {
  var t = HtmlService.createTemplateFromFile('Index');
  t.appVersion = APP_VERSION;
  return t.evaluate()
    .setTitle('CWK DutyFlow — ระบบบริหารเวรประจำวัน')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ================================================================= */
/* ตารางเส้นทาง                                                       */
/* ================================================================= */

function API_ROUTES_() {
  return {
    // ระบบ
    'ping':               function (ctx) { return { pong: true, at: nowIso(), version: APP_VERSION }; },
    'bootstrap':          function (ctx) { return API_bootstrap_(ctx); },
    'system.selfTest':    function (ctx) { return DIAG_selfTest(ctx); },
    'system.repair':      function (ctx) { return DIAG_repair(ctx); },
    'system.clearCache':  function (ctx) { return DIAG_clearCache(ctx); },

    // เข้าสู่ระบบ
    'auth.login':         function (ctx, p) { return API_login_(p); },
    'auth.logout':        function (ctx) { return AUTH_logout(ctx); },
    'auth.changePassword':function (ctx, p) { return AUTH_changePassword(ctx, (p || {}).currentPassword, (p || {}).newPassword); },

    // หน้าวันนี้
    'today.summary':      function (ctx, p) { return TODAY_summary(ctx, p); },
    'today.cards':        function (ctx, p) { return TODAY_cards(ctx, (p || {}).date); },
    'dash.overview':      function (ctx, p) { return DASH_overview(ctx, p); },

    // ตารางเวร
    'schedule.forDate':   function (ctx, p) { return SCHEDULE_forDate(ctx, (p || {}).date); },
    'schedule.mine':      function (ctx, p) { return SCHEDULE_mine(ctx, p); },
    'schedule.generate':  function (ctx, p) { return SCHEDULE_generate(ctx, p); },
    'schedule.candidates':function (ctx, p) { return SCHEDULE_dailyCandidates(ctx, (p || {}).scheduleId); },
    'schedule.adjust':    function (ctx, p) { return SCHEDULE_adjustDaily(ctx, (p || {}).scheduleId, (p || {}).teacherId, (p || {}).reason); },
    'schedule.swap':      function (ctx, p) { return SCHEDULE_swapDaily(ctx, (p || {}).a, (p || {}).b, (p || {}).reason); },
    'schedule.cancel':    function (ctx, p) { return SCHEDULE_cancel(ctx, (p || {}).scheduleId, (p || {}).reason); },

    // เช็คอิน
    'checkin.context':    function (ctx, p) { return CHECKIN_context(ctx, (p || {}).scheduleId); },
    'checkin.submit':     function (ctx, p) { return CHECKIN_submit(ctx, p); },
    'checkin.addPhoto':   function (ctx, p) { return CHECKIN_addPhoto(ctx, (p || {}).scheduleId, (p || {}).photo); },
    'checkin.pending':    function (ctx) { return CHECKIN_pendingToday(ctx); },
    'photo.data':         function (ctx, p) { return PHOTO_data(ctx, (p || {}).photoId); },

    // เปลี่ยนเวร
    'swap.create':        function (ctx, p) { return SWAP_create(ctx, p); },
    'swap.cancel':        function (ctx, p) { return SWAP_cancel(ctx, (p || {}).id); },
    'swap.approve':       function (ctx, p) { return SWAP_approve(ctx, (p || {}).id, (p || {}).note); },
    'swap.reject':        function (ctx, p) { return SWAP_reject(ctx, (p || {}).id, (p || {}).reason); },
    'swap.list':          function (ctx, p) { return SWAP_list(ctx, p); },
    'swap.counterOptions':function (ctx, p) { return SWAP_counterOptions(ctx, (p || {}).scheduleId, (p || {}).teacherId); },

    // เหตุการณ์
    'incident.create':    function (ctx, p) { return INCIDENT_create(ctx, p); },
    'incident.list':      function (ctx, p) { return INCIDENT_list(ctx, p); },
    'incident.handle':    function (ctx, p) { return INCIDENT_handle(ctx, (p || {}).id, (p || {}).status, (p || {}).note); },
    'incident.options':   function () { return INCIDENT_options(); },

    // จัดเวร
    'assign.board':       function (ctx, p) { return ASSIGN_board(ctx, p); },
    'assign.save':        function (ctx, p) { return ASSIGN_save(ctx, p); },
    'assign.remove':      function (ctx, p) { return ASSIGN_remove(ctx, (p || {}).id); },
    'assign.setTeacher':  function (ctx, p) { return ASSIGN_setTeacher(ctx, (p || {}).id, (p || {}).teacherId); },
    'assign.setScope':    function (ctx, p) { return ASSIGN_setScope(ctx, (p || {}).id, (p || {}).scope); },
    'assign.setOrder':    function (ctx, p) { return ASSIGN_setRotationOrder(ctx, (p || {}).items); },
    'assign.workload':    function (ctx, p) { return ASSIGN_workload(ctx, (p || {}).semesterId); },

    // ปักหมุด
    'pin.list':           function (ctx, p) { return PIN_list(ctx, p); },
    'pin.set':            function (ctx, p) { return PIN_set(ctx, (p || {}).id, (p || {}).pinMode, (p || {}).reason); },
    'pin.clear':          function (ctx, p) { return PIN_clear(ctx, (p || {}).id); },
    'pin.setMany':        function (ctx, p) { return PIN_setMany(ctx, (p || {}).ids, (p || {}).pinMode, (p || {}).reason); },

    // การหมุนเวร
    'rotation.settings':    function (ctx) { return PR_settings(ctx); },
    'rotation.saveSettings':function (ctx, p) { return PR_saveSettings(ctx, p); },
    'rotation.pointPreview':function (ctx, p) { return PR_preview(ctx, p); },
    'rotation.dayPreview':  function (ctx, p) { return ROTATION_preview(ctx, p); },
    'rotation.apply':       function (ctx, p) { return ROTATION_apply(ctx, p); },
    'rotation.undo':        function (ctx, p) { return ROTATION_undo(ctx, (p || {}).historyId); },
    'rotation.history':     function (ctx) { return ROTATION_history(ctx); },

    // รายงาน
    'report.daily':       function (ctx, p) { return REPORT_dailyPerformance(ctx, p); },
    'report.group':       function (ctx, p) { return REPORT_attendanceByGroup(ctx, p); },
    'report.drill':       function (ctx, p) { return REPORT_attendanceDrill(ctx, p); },
    'report.evidence':    function (ctx, p) { return REPORT_evidenceGaps(ctx, p); },
    'report.swapLog':     function (ctx, p) { return REPORT_swapLog(ctx, p); },
    'report.point':       function (ctx, p) { return REPORT_pointSummary(ctx, p); },
    'report.teacher':     function (ctx, p) { return REPORT_teacherSummary(ctx, p); },
    'report.executive':   function (ctx, p) { return REPORT_executiveOverview(ctx, p); },
    'report.export':      function (ctx, p) { return REPORT_exportSheet(ctx, (p || {}).kind, p); },
    'report.pdf':         function (ctx, p) { return PDF_dailyReport(ctx, p); },

    // ข้อมูลหลัก
    'teacher.list':       function (ctx, p) { return TEACHER_list(ctx, p); },
    'teacher.options':    function (ctx) { return TEACHER_options(ctx); },
    'teacher.get':        function (ctx, p) { return TEACHER_get(ctx, (p || {}).id); },
    'teacher.save':       function (ctx, p) { return TEACHER_save(ctx, p); },
    'teacher.status':     function (ctx, p) { return TEACHER_setStatus(ctx, (p || {}).id, (p || {}).status); },
    'teacher.resetPassword': function (ctx, p) { return TEACHER_resetPassword(ctx, (p || {}).id); },
    'teacher.issuePasswords':function (ctx) { return TEACHER_issuePasswords(ctx); },
    'teacher.departments':function (ctx) { return TEACHER_departments(ctx); },
    'teacher.importPreview': function (ctx, p) { return TEACHER_importPreview(ctx, (p || {}).text); },
    'teacher.importCommit':  function (ctx, p) { return TEACHER_importCommit(ctx, (p || {}).text); },
    'teacher.importTemplate':function (ctx) { AUTH_requireAdmin(ctx); return { text: TEACHER_importTemplate() }; },

    'point.list':         function (ctx, p) { return POINT_list(ctx, p); },
    'point.save':         function (ctx, p) { return POINT_save(ctx, p); },
    'point.status':       function (ctx, p) { return POINT_setStatus(ctx, (p || {}).id, (p || {}).status); },
    'point.groups':       function (ctx) { return POINT_rotationGroups(ctx); },

    'slot.list':          function (ctx, p) { return SLOT_list(ctx, p); },
    'slot.save':          function (ctx, p) { return SLOT_save(ctx, p); },
    'slot.status':        function (ctx, p) { return SLOT_setStatus(ctx, (p || {}).id, (p || {}).status); },

    'semester.list':      function (ctx) { return SEMESTER_list(ctx); },
    'semester.save':      function (ctx, p) { return SEMESTER_save(ctx, p); },
    'semester.activate':  function (ctx, p) { return SEMESTER_activate(ctx, (p || {}).id); },

    'calendar.list':      function (ctx, p) { return CAL_list(ctx, (p || {}).semesterId); },
    'calendar.save':      function (ctx, p) { return CAL_save(ctx, p); },
    'calendar.remove':    function (ctx, p) { return CAL_remove(ctx, (p || {}).id); },
    'calendar.addRange':  function (ctx, p) { return CAL_addRange(ctx, (p || {}).semesterId, (p || {}).from, (p || {}).to, (p || {}).dayType, (p || {}).note); },
    'calendar.dayTypes':  function () { return CAL_dayTypeOptions(); },

    // ตั้งค่า
    'config.list':        function (ctx) { return CFG_list(ctx); },
    'config.set':         function (ctx, p) { return CFG_set(ctx, (p || {}).key, (p || {}).value); },
    'setup.status':       function (ctx) { return SETUP_status(ctx); },
    'setup.seedSample':   function (ctx) { return SETUP_seedSample(ctx); },

    // ประวัติ
    'audit.search':       function (ctx, p) { return AUDIT_search(ctx, p); },
    'audit.actions':      function (ctx) { return AUDIT_actions(ctx); }
  };
}

/** คำสั่งที่เรียกได้ก่อนเข้าสู่ระบบ */
var API_PUBLIC_ = { 'ping': true, 'bootstrap': true, 'auth.login': true, 'auth.logout': true };

/** คำสั่งที่ใช้ได้ระหว่างที่ผู้ใช้ยังต้องตั้งรหัสผ่านใหม่ */
var API_DURING_PW_CHANGE_ = { 'auth.changePassword': true };

/** เข้าสู่ระบบแล้วส่งข้อมูลตั้งต้นกลับไปในรอบเดียว */
function API_login_(p) {
  var d = p || {};
  var ctx = AUTH_login(d.username, d.password);
  if (!ctx.ok || !ctx.token) throw new Error(ctx.reason || 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
  return { token: ctx.token, boot: API_bootstrap_(ctx) };
}

/** ข้อมูลตั้งต้นที่หน้าเว็บต้องใช้ทันที — เบาที่สุดเท่าที่จะทำได้ */
function API_bootstrap_(ctx) {
  var brand = CFG_brand();
  if (!ctx.ok) {
    return {
      authorized: false,
      loginRequired: true,
      reason: ctx.reason || 'กรุณาเข้าสู่ระบบ',
      reasonCode: ctx.code_reason || 'UNKNOWN',
      brand: brand,
      version: APP_VERSION
    };
  }

  var setup = SETUP_status(ctx);
  return {
    authorized: true,
    version: APP_VERSION,
    brand: brand,
    user: {
      name: ctx.name, username: ctx.username, email: ctx.email, role: ctx.role, roleName: ctx.roleName,
      level: ctx.level, department: ctx.department, teacherId: ctx.teacherId,
      mustChangePassword: ctx.mustChangePassword
    },
    menu: AUTH_menuFor(ctx),
    today: today(),
    todayThai: thaiDate(today(), { weekday: true }),
    setup: setup,
    badges: {
      pendingSwaps: SWAP_pendingCount(ctx),
      openIncidents: INCIDENT_openCount(ctx)
    }
  };
}

/* ================================================================= */
/* ประตูเรียกเดียว                                                    */
/* ================================================================= */

/**
 * ทุกคำขอจากหน้าเว็บผ่านฟังก์ชันนี้
 * คืนค่าเป็น { ok, data } หรือ { ok:false, error, code } เสมอ — ไม่เคยคืนข้อความว่าง
 * ห้ามบันทึก payload ลง log เพราะอาจมีรหัสผ่าน
 */
function api(action, payload, token) {
  var started = new Date().getTime();
  DB_STATS = { sheetReads: 0, memHits: 0, cacheHits: 0 };
  AUTH_MEM = null;
  EXEC_trust_();   // ทุกเส้นทางด้านล่างตรวจสิทธิ์ของตนเอง

  var act = str(action);
  try {
    if (!act) throw new Error('ไม่ได้ระบุคำสั่งที่ต้องการเรียก');

    var routes = API_ROUTES_();
    var fn = Object.prototype.hasOwnProperty.call(routes, act) ? routes[act] : null;
    if (!fn) throw new Error('ไม่รู้จักคำสั่ง "' + act + '" — กรุณารีเฟรชหน้าเว็บ');

    var ctx = AUTH_context(token);
    var isPublic = API_PUBLIC_[act] === true;

    if (!isPublic) {
      AUTH_require(ctx);
      if (ctx.mustChangePassword && API_DURING_PW_CHANGE_[act] !== true) {
        throw AUTH_error_('กรุณาตั้งรหัสผ่านใหม่ก่อนเริ่มใช้งาน', 'MUST_CHANGE_PASSWORD');
      }
    }

    // ระบบปิดปรับปรุง (ยังเข้าสู่ระบบได้ เพื่อให้ผู้ดูแลระบบเข้ามาเปิดระบบคืน)
    if (!isPublic && CFG_str('system_status') === 'MAINTENANCE') {
      if (ctx.role !== 'SYS_ADMIN') {
        throw new Error(CFG_str('maintenance_message') ||
          'ระบบปิดปรับปรุงชั่วคราว กรุณาลองใหม่ภายหลัง');
      }
    }

    var data = fn(ctx, payload || {});
    AUDIT_flush();

    return {
      ok: true,
      data: data === undefined ? null : data,
      // token ใหม่เมื่อต่ออายุหรือเปลี่ยนรหัสผ่าน — หน้าเว็บสลับไปใช้เอง
      _token: (ctx.ok && ctx.renewedToken && act !== 'auth.logout') ? ctx.renewedToken : undefined,
      _perf: {
        ms: new Date().getTime() - started,
        sheetReads: DB_STATS.sheetReads,
        memHits: DB_STATS.memHits,
        cacheHits: DB_STATS.cacheHits
      }
    };

  } catch (err) {
    try { AUDIT_flush(); } catch (e2) { /* ignore */ }

    var message = API_errorMessage_(err);
    try {
      console.error('[api] ' + act + ' : ' + message + '\n' + (err && err.stack ? err.stack : ''));
    } catch (e3) { /* ignore */ }

    return {
      ok: false,
      error: message,
      code: (err && err.authCode) ? err.authCode : 'ERROR',
      action: act,
      _perf: { ms: new Date().getTime() - started }
    };
  }
}

/**
 * แปลงข้อผิดพลาดเป็นข้อความภาษาไทยที่ไม่มีวันว่าง
 * (กล่องแจ้งเตือนว่างเปล่าคือปัญหาที่ผู้ใช้เจอบ่อยที่สุด)
 */
function API_errorMessage_(err) {
  var m = '';
  if (err === null || err === undefined) m = '';
  else if (typeof err === 'string') m = err;
  else if (err.message) m = String(err.message);
  else {
    try { m = JSON.stringify(err); } catch (e) { m = String(err); }
  }
  m = str(m).replace(/^Error:\s*/, '');

  if (!m || m === '{}' || m === 'null' || m === 'undefined') {
    m = 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ กรุณาลองใหม่อีกครั้ง ' +
      'หากยังพบปัญหาให้ไปที่เมนู ตั้งค่า > ตรวจสอบระบบ';
  }

  // ข้อความจาก Apps Script ที่ผู้ใช้ทั่วไปอ่านไม่เข้าใจ
  if (m.indexOf('Service Spreadsheets') >= 0 || m.indexOf('Service invoked too many times') >= 0) {
    m = 'ระบบเรียกใช้งาน Google Sheets ถี่เกินกำหนด กรุณารอสักครู่แล้วลองใหม่';
  }
  if (m.indexOf('Exceeded maximum execution time') >= 0) {
    m = 'การประมวลผลใช้เวลานานเกินกำหนด กรุณาลดช่วงวันที่หรือแบ่งทำเป็นหลายครั้ง';
  }
  if (m.indexOf('You do not have permission') >= 0) {
    m = 'บัญชีนี้ไม่มีสิทธิ์เข้าถึงไฟล์ที่ระบบใช้งาน กรุณาติดต่อผู้ดูแลระบบ';
  }
  return m;
}
