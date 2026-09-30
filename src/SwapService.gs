/**
 * SwapService.gs — การเปลี่ยน/สลับเวร และสายการอนุมัติ
 *
 * ระดับผู้อนุมัติ 1 = หัวหน้าเวรประจำวัน, 2 = หัวหน้างานเวร, 3 = ผู้บริหาร
 */

var SWAP_TYPES = {
  SUBSTITUTE:  'ขอให้ครูท่านอื่นอยู่แทน',
  EXCHANGE:    'ขอสลับเวรกัน',
  HEAD_ADJUST: 'หัวหน้าเวรปรับครูประจำจุด',
  HEAD_SWAP:   'หัวหน้าเวรสลับครูระหว่างจุด'
};

var SWAP_STATUS = {
  PENDING:   'รออนุมัติ',
  APPROVED:  'อนุมัติแล้ว',
  APPLIED:   'ดำเนินการแล้ว',
  REJECTED:  'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิกคำขอ'
};

function SWAP_typeLabel_(t) { return SWAP_TYPES[str(t)] || str(t); }
function SWAP_statusLabel_(s) { return SWAP_STATUS[str(s)] || str(s); }

/** ครูสร้างคำขอเปลี่ยนเวร */
function SWAP_create(ctx, payload) {
  AUTH_require(ctx);
  var p = payload || {};
  var type = str(p.type);
  if (type !== 'SUBSTITUTE' && type !== 'EXCHANGE') {
    throw new Error('ประเภทคำขอไม่ถูกต้อง');
  }

  var sch = dbGetById('DAILY_SCHEDULE', str(p.scheduleId));
  if (!sch) throw new Error('ไม่พบรายการเวรนี้');
  if (sch.effective_teacher_id !== ctx.teacherId) {
    throw new Error('ขอเปลี่ยนได้เฉพาะเวรของตนเอง');
  }
  if (str(sch.status) === 'CANCELLED') throw new Error('เวรรายการนี้ถูกยกเลิกแล้ว');

  var d = toDateStr(sch.date);
  if (d < today()) throw new Error('ขอเปลี่ยนเวรย้อนหลังไม่ได้ กรุณาแจ้งหัวหน้าเวรโดยตรง');

  if (dbFind('DUTY_LOGS', { schedule_id: sch.id }).length) {
    throw new Error('เวรรายการนี้มีการบันทึกการอยู่เวรแล้ว');
  }

  var pending = dbFind('SWAP_REQUESTS', { schedule_id: sch.id, approval_status: 'PENDING' });
  if (pending.length) throw new Error('เวรรายการนี้มีคำขอที่รออนุมัติอยู่แล้ว');

  var toT = dbGetById('TEACHERS', str(p.toTeacherId));
  if (!toT) throw new Error('กรุณาเลือกครูที่จะอยู่แทน');
  if (str(toT.status) !== 'ACTIVE') throw new Error('ครูรายนี้ถูกระงับการใช้งาน');
  if (toT.id === ctx.teacherId) throw new Error('ไม่สามารถเลือกตนเองได้');

  var reason = sanitizeText(p.reason);
  if (reason.length < 5) throw new Error('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร');

  var counterId = '';
  if (type === 'EXCHANGE') {
    var counter = dbGetById('DAILY_SCHEDULE', str(p.counterScheduleId));
    if (!counter) throw new Error('กรุณาเลือกเวรของอีกฝ่ายที่จะสลับ');
    if (counter.effective_teacher_id !== toT.id) {
      throw new Error('เวรที่เลือกไม่ใช่ของ ' + teacherFullName(toT));
    }
    if (toDateStr(counter.date) < today()) throw new Error('สลับกับเวรที่ผ่านมาแล้วไม่ได้');
    counterId = counter.id;
  } else {
    // ครูที่จะอยู่แทนต้องว่างในช่วงเวลานั้น
    var clash = dbReadAll('DAILY_SCHEDULE').filter(function (x) {
      return toDateStr(x.date) === d && x.slot_id === sch.slot_id &&
        x.effective_teacher_id === toT.id && str(x.status) !== 'CANCELLED';
    });
    if (clash.length) {
      throw new Error(teacherFullName(toT) + ' มีเวรในช่วงเวลาเดียวกันอยู่แล้ว');
    }
  }

  var needApproval = CFG_bool('swap_need_approval');
  var created = dbInsert('SWAP_REQUESTS', {
    request_type: type,
    date: d,
    schedule_id: sch.id,
    counter_schedule_id: counterId,
    from_teacher_id: ctx.teacherId,
    to_teacher_id: toT.id,
    reason: reason,
    approval_status: needApproval ? 'PENDING' : 'APPROVED',
    created_by: ctx.teacherId
  });

  if (!needApproval) {
    SWAP_applyApproved_(ctx, created.id);
  } else {
    NOTIFY_swapCreated(created.id);
  }

  AUDIT_log(ctx, 'SWAP_CREATE', 'SWAP_REQUESTS', created.id, null, {
    type: type, scheduleId: sch.id, to: toT.id, reason: reason
  });

  return { id: created.id, status: needApproval ? 'PENDING' : 'APPLIED' };
}

/** ยกเลิกคำขอของตนเอง */
function SWAP_cancel(ctx, id) {
  AUTH_require(ctx);
  var req = dbGetById('SWAP_REQUESTS', id);
  if (!req) throw new Error('ไม่พบคำขอนี้');
  if (req.created_by !== ctx.teacherId && !AUTH_canSeeOthers(ctx)) {
    throw new Error('ยกเลิกได้เฉพาะคำขอของตนเอง');
  }
  if (str(req.approval_status) !== 'PENDING') {
    throw new Error('คำขอนี้ไม่อยู่ในสถานะรออนุมัติ');
  }
  dbUpdate('SWAP_REQUESTS', id, { approval_status: 'CANCELLED' });
  AUDIT_log(ctx, 'SWAP_CANCEL', 'SWAP_REQUESTS', id, { status: 'PENDING' }, { status: 'CANCELLED' });
  return { id: id, status: 'CANCELLED' };
}

/** อนุมัติ — บันทึกทั้งผู้อนุมัติ บทบาท และระดับ */
function SWAP_approve(ctx, id, note) {
  AUTH_requireReviewer(ctx);
  var req = dbGetById('SWAP_REQUESTS', id);
  if (!req) throw new Error('ไม่พบคำขอนี้');
  if (str(req.approval_status) !== 'PENDING') {
    throw new Error('คำขอนี้ถูกดำเนินการไปแล้ว (' + SWAP_statusLabel_(req.approval_status) + ')');
  }

  var level = AUTH_approvalLevel(ctx.role);
  var minLevel = num(CFG_get('swap_min_level', 1), 1);
  if (level < minLevel) {
    throw new Error('ต้องได้รับอนุมัติจาก ' + AUTH_approvalLevelName(minLevel) + ' ขึ้นไป');
  }
  if (req.from_teacher_id === ctx.teacherId || req.to_teacher_id === ctx.teacherId) {
    throw new Error('ไม่สามารถอนุมัติคำขอที่ตนเองเกี่ยวข้องได้');
  }

  return withLock(function () {
    dbUpdate('SWAP_REQUESTS', id, {
      approval_status: 'APPROVED',
      approver_id: ctx.teacherId,
      approver_role: ctx.role,
      approval_level: level,
      approved_at: nowIso(),
      reject_reason: ''
    });
    var res = SWAP_applyApproved_(ctx, id);
    AUDIT_log(ctx, 'SWAP_APPROVE', 'SWAP_REQUESTS', id, { status: 'PENDING' },
      { status: 'APPLIED', level: level, note: sanitizeText(note) });
    NOTIFY_swapDecided(id, true);
    return res;
  });
}

function SWAP_reject(ctx, id, reason) {
  AUTH_requireReviewer(ctx);
  var req = dbGetById('SWAP_REQUESTS', id);
  if (!req) throw new Error('ไม่พบคำขอนี้');
  if (str(req.approval_status) !== 'PENDING') {
    throw new Error('คำขอนี้ถูกดำเนินการไปแล้ว');
  }
  var r = sanitizeText(reason);
  if (r.length < 5) throw new Error('กรุณาระบุเหตุผลที่ไม่อนุมัติอย่างน้อย 5 ตัวอักษร');

  dbUpdate('SWAP_REQUESTS', id, {
    approval_status: 'REJECTED',
    approver_id: ctx.teacherId,
    approver_role: ctx.role,
    approval_level: AUTH_approvalLevel(ctx.role),
    approved_at: nowIso(),
    reject_reason: r
  });
  AUDIT_log(ctx, 'SWAP_REJECT', 'SWAP_REQUESTS', id, { status: 'PENDING' },
    { status: 'REJECTED', reason: r });
  NOTIFY_swapDecided(id, false);
  return { id: id, status: 'REJECTED' };
}

/** นำคำขอที่อนุมัติแล้วไปเปลี่ยนตารางจริง */
function SWAP_applyApproved_(ctx, id) {
  var req = dbGetById('SWAP_REQUESTS', id);
  if (!req) throw new Error('ไม่พบคำขอนี้');

  var sch = dbGetById('DAILY_SCHEDULE', req.schedule_id);
  if (!sch) throw new Error('ไม่พบรายการเวรของคำขอนี้');

  var patches = [{
    id: sch.id,
    patch: {
      effective_teacher_id: req.to_teacher_id,
      status: 'SWAPPED',
      source: 'SWAP',
      version: num(sch.version, 1) + 1
    }
  }];

  if (str(req.request_type) === 'EXCHANGE' && str(req.counter_schedule_id)) {
    var counter = dbGetById('DAILY_SCHEDULE', req.counter_schedule_id);
    if (counter) {
      patches.push({
        id: counter.id,
        patch: {
          effective_teacher_id: req.from_teacher_id,
          status: 'SWAPPED',
          source: 'SWAP',
          version: num(counter.version, 1) + 1
        }
      });
    }
  }

  dbUpdateMany('DAILY_SCHEDULE', patches);
  dbUpdate('SWAP_REQUESTS', id, { approval_status: 'APPLIED' });
  CACHE_remove('today:' + toDateStr(req.date));

  return { id: id, status: 'APPLIED', affected: patches.length };
}

/** รายการคำขอ */
function SWAP_list(ctx, opts) {
  AUTH_require(ctx);
  var o = opts || {};
  var canAll = AUTH_canSeeOthers(ctx);

  var rows = dbReadAll('SWAP_REQUESTS');
  if (!canAll) {
    rows = rows.filter(function (r) {
      return r.from_teacher_id === ctx.teacherId || r.to_teacher_id === ctx.teacherId ||
        r.created_by === ctx.teacherId;
    });
  }
  if (o.status) rows = rows.filter(function (r) { return str(r.approval_status) === o.status; });
  if (o.from) rows = rows.filter(function (r) { return toDateStr(r.date) >= toDateStr(o.from); });
  if (o.to) rows = rows.filter(function (r) { return toDateStr(r.date) <= toDateStr(o.to); });
  if (o.type) rows = rows.filter(function (r) { return str(r.request_type) === o.type; });

  var teachers = indexBy(dbReadAll('TEACHERS'), 'id');
  var schedules = indexBy(dbReadAll('DAILY_SCHEDULE'), 'id');
  var points = indexBy(dbReadAll('DUTY_POINTS'), 'id');
  var slots = indexBy(dbReadAll('TIME_SLOTS'), 'id');

  var dto = rows.map(function (r) {
    var sch = schedules[r.schedule_id] || {};
    return {
      id: r.id,
      type: str(r.request_type), typeLabel: SWAP_typeLabel_(r.request_type),
      date: toDateStr(r.date), dateThai: thaiDate(toDateStr(r.date), { short: true, weekday: true }),
      pointName: str((points[sch.point_id] || {}).name),
      slotName: str((slots[sch.slot_id] || {}).name),
      fromName: teacherFullName(teachers[r.from_teacher_id]),
      toName: teacherFullName(teachers[r.to_teacher_id]),
      reason: str(r.reason),
      status: str(r.approval_status), statusLabel: SWAP_statusLabel_(r.approval_status),
      approverName: teacherFullName(teachers[r.approver_id]),
      approverRole: str(r.approver_role),
      approvalLevel: num(r.approval_level),
      approvalLevelName: AUTH_approvalLevelName(r.approval_level),
      approvedAt: str(r.approved_at),
      rejectReason: str(r.reject_reason),
      createdAt: str(r.created_at),
      canDecide: canAll && str(r.approval_status) === 'PENDING' &&
        r.from_teacher_id !== ctx.teacherId && r.to_teacher_id !== ctx.teacherId,
      canCancel: str(r.approval_status) === 'PENDING' && r.created_by === ctx.teacherId
    };
  });

  dto.sort(function (a, b) {
    if (a.status === 'PENDING' && b.status !== 'PENDING') return -1;
    if (b.status === 'PENDING' && a.status !== 'PENDING') return 1;
    return a.date < b.date ? 1 : -1;
  });

  var limit = num(o.limit, 200);
  return {
    total: dto.length,
    pending: dto.filter(function (r) { return r.status === 'PENDING'; }).length,
    rows: dto.slice(0, limit),
    typeOptions: Object.keys(SWAP_TYPES).map(function (k) { return { value: k, label: SWAP_TYPES[k] }; }),
    statusOptions: Object.keys(SWAP_STATUS).map(function (k) { return { value: k, label: SWAP_STATUS[k] }; })
  };
}

/** จำนวนคำขอที่รออนุมัติ (ใช้แสดงป้ายบนเมนู) */
function SWAP_pendingCount(ctx) {
  if (!AUTH_canSeeOthers(ctx)) return 0;
  return dbFind('SWAP_REQUESTS', { approval_status: 'PENDING' }).length;
}

/** เวรของอีกฝ่ายที่สลับได้ (ใช้ตอนขอสลับเวร) */
function SWAP_counterOptions(ctx, scheduleId, toTeacherId) {
  AUTH_require(ctx);
  var sch = dbGetById('DAILY_SCHEDULE', scheduleId);
  if (!sch) throw new Error('ไม่พบรายการเวรนี้');

  var t = today();
  var slots = indexBy(dbReadAll('TIME_SLOTS'), 'id');
  var points = indexBy(dbReadAll('DUTY_POINTS'), 'id');

  var rows = dbReadAll('DAILY_SCHEDULE').filter(function (r) {
    return r.effective_teacher_id === str(toTeacherId) &&
      toDateStr(r.date) >= t && str(r.status) !== 'CANCELLED' && r.id !== sch.id;
  });

  return sortBy(rows.map(function (r) {
    var d = toDateStr(r.date);
    return {
      id: r.id, date: d,
      dateThai: thaiDate(d, { short: true, weekday: true }),
      pointName: str((points[r.point_id] || {}).name),
      slotName: str((slots[r.slot_id] || {}).name)
    };
  }), ['date']).slice(0, 60);
}
