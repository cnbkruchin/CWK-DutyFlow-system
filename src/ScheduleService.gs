/**
 * ScheduleService.gs — ตารางเวรรายวัน
 *
 * กฎเหล็ก: ห้ามเขียนทับ original_teacher_id เมื่อมีการเปลี่ยนเวร
 *          เปลี่ยนเฉพาะ effective_teacher_id เท่านั้น
 */

var SCHEDULE_STATUS = {
  SCHEDULED: 'ตามตาราง',
  ADJUSTED:  'ปรับโดยหัวหน้าเวร',
  SWAPPED:   'สลับ/เปลี่ยนเวร',
  CANCELLED: 'ยกเลิก'
};

/* ================================================================= */
/* สร้างตารางรายวัน                                                   */
/* ================================================================= */

/**
 * สร้างตารางเวรรายวันจากแม่แบบ ASSIGNMENTS ในช่วงวันที่ที่กำหนด
 * วันที่มีตารางอยู่แล้วจะถูกข้าม (ไม่ทับข้อมูลที่มีการเช็คอินไปแล้ว)
 */
function SCHEDULE_generate(ctx, opts) {
  AUTH_requireAdmin(ctx);
  var o = opts || {};
  var semester = o.semesterId ? dbGetById('SEMESTERS', o.semesterId) : SEMESTER_active();
  if (!semester) throw new Error('ยังไม่ได้กำหนดภาคเรียนที่ใช้งาน');

  var from = toDateStr(o.from) || today();
  var to = toDateStr(o.to) || addDays(from, num(CFG_get('schedule_generate_ahead', 30), 30));
  if (from < toDateStr(semester.start_date)) from = toDateStr(semester.start_date);
  if (to > toDateStr(semester.end_date)) to = toDateStr(semester.end_date);
  if (!from || !to || to < from) throw new Error('ช่วงวันที่ไม่ถูกต้อง');
  if (diffDays(from, to) > 200) throw new Error('สร้างได้ครั้งละไม่เกิน 200 วัน');

  return withLock(function () {
    var result = SCHEDULE_build_(semester, from, to, bool(o.rebuild));
    AUDIT_log(ctx, 'SCHEDULE_GENERATE', 'DAILY_SCHEDULE', semester.id, null, {
      from: from, to: to, created: result.created, skipped: result.skipped, days: result.days
    });
    return result;
  }, 300000);
}

/** งานภายใน: สร้างตารางจริง */
function SCHEDULE_build_(semester, from, to, rebuild) {
  var calMap = CAL_map_(semester.id);
  var assignments = dbFind('ASSIGNMENTS', { semester_id: semester.id, status: 'ACTIVE' });
  if (!assignments.length) throw new Error('ภาคเรียนนี้ยังไม่มีการจัดเวร กรุณาจัดเวรก่อน');

  var pointsById = indexBy(dbReadAll('DUTY_POINTS'), 'id');
  var byWeekday = groupBy(assignments, function (a) { return num(a.weekday); });

  var existing = dbFind('DAILY_SCHEDULE', { semester_id: semester.id });
  var existingByDate = groupBy(existing, function (r) { return toDateStr(r.date); });

  var logsByDate = {};
  dbReadAll('DUTY_LOGS').forEach(function (l) {
    var d = toDateStr(l.date);
    logsByDate[d] = (logsByDate[d] || 0) + 1;
  });

  var respectPin = CFG_bool('point_rotation_respect_pin');
  var creates = [];
  var stats = { days: 0, created: 0, skipped: 0, rebuilt: 0, lockedDays: 0 };

  for (var d = from; d <= to; d = addDays(d, 1)) {
    if (!CAL_isDutyDay(d, semester.id, calMap)) continue;
    stats.days++;

    var already = existingByDate[d] || [];
    if (already.length) {
      if (!rebuild) { stats.skipped += already.length; continue; }
      if (logsByDate[d]) { stats.lockedDays++; stats.skipped += already.length; continue; }
      dbHardDelete('DAILY_SCHEDULE', already.map(function (r) { return r.id; }));
      stats.rebuilt += already.length;
    }

    var w = weekdayOf(d);
    var seats = (byWeekday[w] || []).map(function (a) {
      var p = pointsById[a.point_id] || {};
      return {
        id: a.id, teacher_id: a.teacher_id, seat_no: num(a.seat_no),
        slot_id: a.slot_id, point_id: a.point_id,
        rotation_group: str(a.rotation_group) || str(p.rotation_group) || 'DEFAULT',
        rotation_order: num(a.rotation_order, 999),
        rotation_scope: str(a.rotation_scope) || 'BOTH',
        pin_mode: str(a.pin_mode) || 'NONE',
        _point_sort: num(p.sort_order, 999)
      };
    });
    if (!seats.length) continue;

    var offset = PR_offsetFor_(d, semester, calMap);
    var rotated = PR_applyToDay_(seats, offset, respectPin);

    rotated.forEach(function (s, i) {
      var pinned = !PR_participates_(s, respectPin);
      creates.push({
        semester_id: semester.id,
        date: d,
        weekday: w,
        slot_id: s.slot_id,
        point_id: s.point_id,
        seat_no: s.seat_no,
        assignment_id: s.id,
        original_teacher_id: s.teacher_id,      // ครูตามตารางหลังหมุน = ครูต้นทางของวันนั้น
        effective_teacher_id: s.teacher_id,
        source: offset && seats[i].teacher_id !== s.teacher_id ? 'ROTATION' : (pinned ? 'PIN' : 'TEMPLATE'),
        point_rotation_offset: offset,
        status: 'SCHEDULED',
        version: 1
      });
    });
  }

  if (creates.length) {
    // เขียนเป็นก้อนละ 2000 แถว กัน timeout
    for (var i = 0; i < creates.length; i += 2000) {
      dbInsertMany('DAILY_SCHEDULE', creates.slice(i, i + 2000));
    }
    stats.created = creates.length;
  }

  return stats;
}

/** จำนวนเวรในอนาคตของครูคนหนึ่ง (ใช้เตือนก่อนระงับบัญชี) */
function SCHEDULE_upcomingCountForTeacher_(teacherId) {
  var t = today();
  return dbReadAll('DAILY_SCHEDULE').filter(function (r) {
    return r.effective_teacher_id === teacherId &&
      toDateStr(r.date) >= t && str(r.status) !== 'CANCELLED';
  }).length;
}

/* ================================================================= */
/* อ่านตาราง                                                          */
/* ================================================================= */

/** รวมข้อมูลตารางของวันหนึ่งพร้อมหลักฐานและการอนุมัติ (ใช้ร่วมกันหลายหน้าจอ) */
function SCHEDULE_dayRows_(date) {
  var d = toDateStr(date);
  var rows = dbReadAll('DAILY_SCHEDULE').filter(function (r) { return toDateStr(r.date) === d; });
  if (!rows.length) return [];

  var teachers = indexBy(dbReadAll('TEACHERS'), 'id');
  var points = indexBy(dbReadAll('DUTY_POINTS'), 'id');
  var slots = indexBy(dbReadAll('TIME_SLOTS'), 'id');

  var logs = dbReadAll('DUTY_LOGS').filter(function (l) { return toDateStr(l.date) === d; });
  var logsBySched = groupBy(logs, function (l) { return l.schedule_id; });

  var photos = dbReadAll('DUTY_PHOTOS').filter(function (p) { return toDateStr(p.date) === d; });
  var photosBySched = groupBy(photos, function (p) { return p.schedule_id; });

  var incidents = dbReadAll('INCIDENTS').filter(function (x) { return toDateStr(x.date) === d; });
  var incBySched = groupBy(incidents, function (x) { return x.schedule_id; });

  var swaps = dbReadAll('SWAP_REQUESTS').filter(function (s) { return toDateStr(s.date) === d; });
  var swapBySched = groupBy(swaps, function (s) { return s.schedule_id; });

  var graceMin = num(CFG_get('late_grace_minutes', 10), 10);
  var minPhotos = num(CFG_get('evidence_min_photos', 1), 1);
  var requirePhoto = CFG_bool('evidence_require_photo');

  return rows.map(function (r) {
    var slot = slots[r.slot_id] || {};
    var point = points[r.point_id] || {};
    var myLogs = sortBy(logsBySched[r.id] || [], ['ts']);
    var checkIn = null, checkOut = null;
    myLogs.forEach(function (l) {
      if (str(l.action) === 'CHECK_IN' && !checkIn) checkIn = l;
      if (str(l.action) === 'CHECK_OUT') checkOut = l;
    });

    var myPhotos = photosBySched[r.id] || [];
    var myIncidents = incBySched[r.id] || [];
    var mySwaps = sortBy(swapBySched[r.id] || [], ['-created_at']);
    var approvedSwap = null;
    for (var i = 0; i < mySwaps.length; i++) {
      var st = str(mySwaps[i].approval_status);
      if (st === 'APPROVED' || st === 'APPLIED') { approvedSwap = mySwaps[i]; break; }
    }

    // สถานะการอยู่เวร
    var attend = 'ABSENT';
    var lateMin = 0;
    if (checkIn) {
      var startM = minutesOfDay(slot.start_time);
      var inM = minutesOfDay(hhmm(checkIn.ts));
      if (startM >= 0 && inM >= 0 && inM > startM + graceMin) {
        lateMin = inM - startM;
        attend = 'LATE';
      } else {
        attend = 'PRESENT';
      }
      if (str(checkIn.geo_status) === 'OUT_OF_RANGE') attend = 'PARTIAL';
      if (CFG_bool('require_checkout') && !checkOut) attend = 'PARTIAL';
    }
    if (str(r.status) === 'CANCELLED') attend = 'CANCELLED';

    // ระดับหลักฐาน
    var evidence = 'NONE';
    if (checkIn) {
      var geoOk = str(checkIn.geo_status) === 'IN_RANGE' || str(checkIn.geo_status) === 'NEAR';
      var photoOk = !requirePhoto || myPhotos.length >= minPhotos;
      evidence = (geoOk && photoOk) ? 'FULL' : 'PARTIAL';
    }

    var origId = str(r.original_teacher_id);
    var effId = str(r.effective_teacher_id);

    return {
      id: r.id,
      date: d,
      weekday: num(r.weekday),
      weekdayName: thaiWeekday(num(r.weekday)),
      slotId: r.slot_id,
      slotName: str(slot.name),
      startTime: str(slot.start_time),
      endTime: str(slot.end_time),
      slotSort: num(slot.sort_order, 99),
      pointId: r.point_id,
      pointName: str(point.name),
      pointSort: num(point.sort_order, 99),
      pointLat: num(point.lat),
      pointLng: num(point.lng),
      pointRadius: num(point.radius_m, CFG_num('default_radius_m')),
      seatNo: num(r.seat_no),
      originalTeacherId: origId,
      originalTeacherName: teacherFullName(teachers[origId]),
      effectiveTeacherId: effId,
      effectiveTeacherName: teacherFullName(teachers[effId]),
      department: str((teachers[effId] || {}).department),
      changed: origId !== effId,
      status: str(r.status),
      statusLabel: SCHEDULE_STATUS[str(r.status)] || str(r.status),
      source: str(r.source),
      rotationOffset: num(r.point_rotation_offset),
      version: num(r.version, 1),

      attend: attend,
      attendLabel: SCHEDULE_attendLabel_(attend),
      lateMinutes: lateMin,
      checkInAt: checkIn ? hhmm(checkIn.ts) : '',
      checkOutAt: checkOut ? hhmm(checkOut.ts) : '',
      distanceM: checkIn ? num(checkIn.distance_m) : null,
      geoStatus: checkIn ? str(checkIn.geo_status) : '',
      photoCount: myPhotos.length,
      photos: myPhotos.map(function (p) {
        return { id: p.id, url: str(p.thumb_url) || str(p.file_url), caption: str(p.caption) };
      }),
      incidentCount: myIncidents.length,
      incidents: myIncidents.map(function (x) {
        return { id: x.id, title: str(x.title), severity: str(x.severity), status: str(x.status) };
      }),
      evidence: evidence,
      evidenceLabel: SCHEDULE_evidenceLabel_(evidence),

      approval: approvedSwap ? {
        swapId: approvedSwap.id,
        type: str(approvedSwap.request_type),
        typeLabel: SWAP_typeLabel_(str(approvedSwap.request_type)),
        fromName: teacherFullName(teachers[approvedSwap.from_teacher_id]),
        toName: teacherFullName(teachers[approvedSwap.to_teacher_id]),
        reason: str(approvedSwap.reason),
        approverName: teacherFullName(teachers[approvedSwap.approver_id]),
        approverRole: str(approvedSwap.approver_role),
        approvalLevel: num(approvedSwap.approval_level),
        approvalLevelName: AUTH_approvalLevelName(approvedSwap.approval_level),
        approvedAt: str(approvedSwap.approved_at)
      } : null,
      pendingSwaps: mySwaps.filter(function (s) {
        return str(s.approval_status) === 'PENDING';
      }).length
    };
  });
}

function SCHEDULE_attendLabel_(a) {
  return {
    PRESENT: 'อยู่ครบ', LATE: 'สาย', PARTIAL: 'อยู่ไม่ครบ',
    ABSENT: 'ไม่อยู่', CANCELLED: 'ยกเลิก'
  }[a] || a;
}

function SCHEDULE_evidenceLabel_(e) {
  return { FULL: 'หลักฐานครบ', PARTIAL: 'หลักฐานไม่ครบ', NONE: 'ไม่มีหลักฐาน' }[e] || e;
}

/** ตารางเวรของวันหนึ่ง */
function SCHEDULE_forDate(ctx, date) {
  AUTH_require(ctx);
  var d = toDateStr(date) || today();
  var rows = SCHEDULE_dayRows_(d);

  if (!AUTH_canSeeOthers(ctx)) {
    rows = rows.filter(function (r) {
      return r.effectiveTeacherId === ctx.teacherId || r.originalTeacherId === ctx.teacherId;
    });
  }

  return {
    date: d,
    dateThai: thaiDate(d, { weekday: true }),
    isDutyDay: CAL_isDutyDay(d, (SEMESTER_forDate(d) || {}).id),
    rows: sortBy(rows, ['slotSort', 'pointSort', 'seatNo'])
  };
}

/** เวรของฉัน — ช่วงวันที่ */
function SCHEDULE_mine(ctx, opts) {
  AUTH_require(ctx);
  var o = opts || {};
  var from = toDateStr(o.from) || today();
  var to = toDateStr(o.to) || addDays(from, 30);
  if (diffDays(from, to) > 200) throw new Error('ช่วงวันที่ยาวเกินไป');

  var tid = str(o.teacherId) || ctx.teacherId;
  if (tid !== ctx.teacherId) AUTH_requireReviewer(ctx);

  var slots = indexBy(dbReadAll('TIME_SLOTS'), 'id');
  var points = indexBy(dbReadAll('DUTY_POINTS'), 'id');

  var rows = dbReadAll('DAILY_SCHEDULE').filter(function (r) {
    var d = toDateStr(r.date);
    return d >= from && d <= to && r.effective_teacher_id === tid && str(r.status) !== 'CANCELLED';
  });

  var logs = groupBy(dbReadAll('DUTY_LOGS'), function (l) { return l.schedule_id; });

  var out = rows.map(function (r) {
    var slot = slots[r.slot_id] || {};
    var point = points[r.point_id] || {};
    var myLogs = logs[r.id] || [];
    var hasIn = myLogs.some(function (l) { return str(l.action) === 'CHECK_IN'; });
    var hasOut = myLogs.some(function (l) { return str(l.action) === 'CHECK_OUT'; });
    var d = toDateStr(r.date);
    return {
      id: r.id, date: d,
      dateThai: thaiDate(d, { short: true, weekday: true }),
      weekdayName: thaiWeekday(num(r.weekday)),
      slotName: str(slot.name), startTime: str(slot.start_time), endTime: str(slot.end_time),
      slotSort: num(slot.sort_order, 99),
      pointId: r.point_id, pointName: str(point.name),
      pointLat: num(point.lat), pointLng: num(point.lng),
      pointRadius: num(point.radius_m, CFG_num('default_radius_m')),
      seatNo: num(r.seat_no),
      status: str(r.status), statusLabel: SCHEDULE_STATUS[str(r.status)] || str(r.status),
      substitute: str(r.original_teacher_id) !== str(r.effective_teacher_id),
      checkedIn: hasIn, checkedOut: hasOut,
      isToday: d === today(), isPast: d < today()
    };
  });

  return {
    teacherId: tid,
    from: from, to: to,
    rows: sortBy(out, ['date', 'slotSort']),
    stats: {
      total: out.length,
      done: out.filter(function (r) { return r.checkedIn; }).length,
      upcoming: out.filter(function (r) { return !r.isPast && !r.checkedIn; }).length,
      missed: out.filter(function (r) { return r.isPast && !r.checkedIn; }).length
    }
  };
}

/* ================================================================= */
/* หัวหน้าเวรปรับเวรรายวัน                                            */
/* ================================================================= */

function SCHEDULE_adjustBackDays_(ctx) {
  if (ctx.level >= ROLES.DUTY_ADMIN.level) return 3650;   // ผู้ดูแลไม่จำกัด
  return num(CFG_get('daily_adjust_backdays', 1), 1);
}

function SCHEDULE_assertAdjustable_(ctx, date) {
  AUTH_requireReviewer(ctx);
  var d = toDateStr(date);
  if (!d) throw new Error('วันที่ไม่ถูกต้อง');
  var back = SCHEDULE_adjustBackDays_(ctx);
  var delta = diffDays(d, today());        // > 0 แปลว่าเป็นวันในอดีต
  if (delta > back) {
    throw new Error('ปรับเวรย้อนหลังได้ไม่เกิน ' + back + ' วัน (วันที่เลือกผ่านมาแล้ว ' + delta + ' วัน)');
  }
  return true;
}

/** ครูที่เลือกแทนได้สำหรับที่นั่งหนึ่ง (ไม่ติดเวรอื่นในช่วงเวลาเดียวกัน) */
function SCHEDULE_dailyCandidates(ctx, scheduleId) {
  AUTH_requireReviewer(ctx);
  var sch = dbGetById('DAILY_SCHEDULE', scheduleId);
  if (!sch) throw new Error('ไม่พบรายการเวรนี้');

  var d = toDateStr(sch.date);
  var sameSlot = dbReadAll('DAILY_SCHEDULE').filter(function (r) {
    return toDateStr(r.date) === d && r.slot_id === sch.slot_id &&
      r.id !== sch.id && str(r.status) !== 'CANCELLED';
  });
  var busy = {};
  sameSlot.forEach(function (r) { busy[r.effective_teacher_id] = r; });

  var points = indexBy(dbReadAll('DUTY_POINTS'), 'id');
  var teachers = dbFind('TEACHERS', { status: 'ACTIVE' });

  var free = [], occupied = [];
  teachers.forEach(function (t) {
    if (t.id === sch.effective_teacher_id) return;
    var item = { id: t.id, name: teacherFullName(t), department: str(t.department) };
    if (busy[t.id]) {
      item.busyAt = str((points[busy[t.id].point_id] || {}).name);
      item.busyScheduleId = busy[t.id].id;
      occupied.push(item);
    } else {
      free.push(item);
    }
  });

  return {
    scheduleId: scheduleId,
    date: d,
    dateThai: thaiDate(d, { weekday: true }),
    currentTeacherName: teacherFullName(dbGetById('TEACHERS', sch.effective_teacher_id)),
    pointName: str((points[sch.point_id] || {}).name),
    free: sortBy(free, ['name']),
    occupied: sortBy(occupied, ['name'])
  };
}

/**
 * หัวหน้าเวรเปลี่ยนครูของที่นั่งหนึ่งในวันหนึ่ง
 * เขียนเฉพาะ effective_teacher_id และบันทึกคำขอที่อนุมัติแล้วไว้ใน SWAP_REQUESTS
 */
function SCHEDULE_adjustDaily(ctx, scheduleId, newTeacherId, reason) {
  var sch = dbGetById('DAILY_SCHEDULE', scheduleId);
  if (!sch) throw new Error('ไม่พบรายการเวรนี้');
  SCHEDULE_assertAdjustable_(ctx, sch.date);

  var newT = dbGetById('TEACHERS', str(newTeacherId));
  if (!newT) throw new Error('ไม่พบครูที่เลือก');
  if (str(newT.status) !== 'ACTIVE') throw new Error('ครูรายนี้ถูกระงับการใช้งาน');
  if (newT.id === sch.effective_teacher_id) throw new Error('เป็นครูคนเดิมอยู่แล้ว');

  var r = sanitizeText(reason);
  if (r.length < 5) throw new Error('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร');

  return withLock(function () {
    var d = toDateStr(sch.date);

    // ครูใหม่ต้องไม่ติดเวรอื่นในช่วงเวลาเดียวกัน
    var clash = dbReadAll('DAILY_SCHEDULE').filter(function (x) {
      return toDateStr(x.date) === d && x.slot_id === sch.slot_id &&
        x.id !== sch.id && x.effective_teacher_id === newT.id && str(x.status) !== 'CANCELLED';
    });
    if (clash.length) {
      var p = dbGetById('DUTY_POINTS', clash[0].point_id);
      throw new Error(teacherFullName(newT) + ' มีเวรที่ "' + (p ? p.name : 'จุดอื่น') +
        '" ในช่วงเวลาเดียวกันแล้ว');
    }

    // มีการเช็คอินไปแล้วหรือยัง
    var logged = dbFind('DUTY_LOGS', { schedule_id: sch.id });
    if (logged.length) {
      throw new Error('เปลี่ยนครูไม่ได้ — มีการบันทึกการอยู่เวรของที่นั่งนี้ไปแล้ว');
    }

    var prevTeacherId = str(sch.effective_teacher_id);

    dbUpdate('DAILY_SCHEDULE', sch.id, {
      effective_teacher_id: newT.id,
      status: str(sch.status) === 'SCHEDULED' ? 'ADJUSTED' : str(sch.status),
      source: 'MANUAL',
      version: num(sch.version, 1) + 1,
      note: truncate(r, 300)
    });

    var level = AUTH_approvalLevel(ctx.role);
    dbInsert('SWAP_REQUESTS', {
      request_type: 'HEAD_ADJUST',
      date: d,
      schedule_id: sch.id,
      from_teacher_id: prevTeacherId,
      to_teacher_id: newT.id,
      reason: r,
      approval_status: 'APPLIED',
      approver_id: ctx.teacherId,
      approver_role: ctx.role,
      approval_level: level,
      approved_at: nowIso(),
      created_by: ctx.teacherId
    });

    AUDIT_log(ctx, 'DAILY_ADJUST', 'DAILY_SCHEDULE', sch.id,
      { effective_teacher_id: prevTeacherId },
      { effective_teacher_id: newT.id, reason: r });

    CACHE_remove('today:' + d);
    return { id: sch.id, effectiveTeacherId: newT.id, effectiveTeacherName: teacherFullName(newT) };
  });
}

/** สลับครูระหว่างสองที่นั่งในวันเดียวกัน */
function SCHEDULE_swapDaily(ctx, scheduleIdA, scheduleIdB, reason) {
  var a = dbGetById('DAILY_SCHEDULE', scheduleIdA);
  var b = dbGetById('DAILY_SCHEDULE', scheduleIdB);
  if (!a || !b) throw new Error('ไม่พบรายการเวรที่เลือก');
  if (a.id === b.id) throw new Error('กรุณาเลือกสองรายการที่ต่างกัน');
  if (toDateStr(a.date) !== toDateStr(b.date)) throw new Error('สลับได้เฉพาะภายในวันเดียวกัน');

  SCHEDULE_assertAdjustable_(ctx, a.date);

  var r = sanitizeText(reason);
  if (r.length < 5) throw new Error('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร');

  return withLock(function () {
    var logged = dbReadAll('DUTY_LOGS').filter(function (l) {
      return l.schedule_id === a.id || l.schedule_id === b.id;
    });
    if (logged.length) throw new Error('สลับไม่ได้ — มีการบันทึกการอยู่เวรไปแล้ว');

    var ta = str(a.effective_teacher_id), tb = str(b.effective_teacher_id);
    var d = toDateStr(a.date);

    dbUpdateMany('DAILY_SCHEDULE', [
      { id: a.id, patch: { effective_teacher_id: tb, status: 'SWAPPED', source: 'SWAP', version: num(a.version, 1) + 1, note: truncate(r, 300) } },
      { id: b.id, patch: { effective_teacher_id: ta, status: 'SWAPPED', source: 'SWAP', version: num(b.version, 1) + 1, note: truncate(r, 300) } }
    ]);

    var level = AUTH_approvalLevel(ctx.role);
    var ts = nowIso();
    dbInsertMany('SWAP_REQUESTS', [
      {
        request_type: 'HEAD_SWAP', date: d, schedule_id: a.id, counter_schedule_id: b.id,
        from_teacher_id: ta, to_teacher_id: tb, reason: r,
        approval_status: 'APPLIED', approver_id: ctx.teacherId, approver_role: ctx.role,
        approval_level: level, approved_at: ts, created_by: ctx.teacherId
      },
      {
        request_type: 'HEAD_SWAP', date: d, schedule_id: b.id, counter_schedule_id: a.id,
        from_teacher_id: tb, to_teacher_id: ta, reason: r,
        approval_status: 'APPLIED', approver_id: ctx.teacherId, approver_role: ctx.role,
        approval_level: level, approved_at: ts, created_by: ctx.teacherId
      }
    ]);

    AUDIT_log(ctx, 'DAILY_SWAP', 'DAILY_SCHEDULE', a.id + '|' + b.id,
      { a: ta, b: tb }, { a: tb, b: ta, reason: r });

    CACHE_remove('today:' + d);
    return { a: a.id, b: b.id };
  });
}

/** ยกเลิกเวรของที่นั่งหนึ่ง (เช่น จุดนั้นปิดชั่วคราว) */
function SCHEDULE_cancel(ctx, scheduleId, reason) {
  var sch = dbGetById('DAILY_SCHEDULE', scheduleId);
  if (!sch) throw new Error('ไม่พบรายการเวรนี้');
  SCHEDULE_assertAdjustable_(ctx, sch.date);

  var r = sanitizeText(reason);
  if (r.length < 5) throw new Error('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร');

  dbUpdate('DAILY_SCHEDULE', scheduleId, {
    status: 'CANCELLED', note: truncate(r, 300), version: num(sch.version, 1) + 1
  });
  AUDIT_log(ctx, 'DAILY_CANCEL', 'DAILY_SCHEDULE', scheduleId, { status: sch.status },
    { status: 'CANCELLED', reason: r });
  CACHE_remove('today:' + toDateStr(sch.date));
  return { id: scheduleId };
}
