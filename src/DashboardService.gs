/**
 * DashboardService.gs — หน้า "วันนี้" แบบเรียกครั้งเดียวจบ
 *
 * ตอบ 5 คำถามหลักในหน้าจอเดียว
 *   1) ครูคนไหนอยู่เวรวันนี้ จุดไหน
 *   2) อยู่เวรหรือไม่
 *   3) มีหลักฐานไหม หลักฐานคืออะไร
 *   4) ถ้าเปลี่ยนเวร ใครอนุมัติ ระดับไหน
 *   5) ของฉันต้องทำอะไรต่อ
 */

var TODAY_CACHE_TTL = 60;   // วินาที

/** รวมทุกอย่างที่หน้าแรกต้องใช้ใน 1 รอบเรียก */
function TODAY_summary(ctx, opts) {
  AUTH_require(ctx);
  var o = opts || {};
  var d = toDateStr(o.date) || today();
  var canSeeAll = AUTH_canSeeOthers(ctx);

  var shared = TODAY_shared_(d, bool(o.force));

  // ส่วนที่ขึ้นกับผู้ใช้แต่ละคน คำนวณสด (เบามาก)
  var mine = shared.rows.filter(function (r) {
    return r.effectiveTeacherId === ctx.teacherId;
  }).map(function (r) {
    var c = DB_clone_(r);
    c.isMine = true;
    return c;
  });

  var visibleRows = canSeeAll ? shared.rows : mine;

  var alerts = [];
  if (canSeeAll) {
    var pendingSwaps = SWAP_pendingCount(ctx);
    if (pendingSwaps) {
      alerts.push({ type: 'INFO', text: 'มีคำขอเปลี่ยนเวรรออนุมัติ ' + pendingSwaps + ' รายการ', link: 'approve' });
    }
    var openInc = INCIDENT_openCount(ctx);
    if (openInc) {
      alerts.push({ type: 'WARN', text: 'มีเหตุการณ์ที่ยังไม่ปิด ' + openInc + ' รายการ', link: 'report' });
    }
    if (shared.summary.absent && d <= today()) {
      alerts.push({ type: 'DANGER', text: 'วันนี้ยังไม่พบการเช็คอิน ' + shared.summary.absent + ' จุด', link: 'today' });
    }
  }
  var myPending = mine.filter(function (r) { return r.attend === 'ABSENT'; });
  if (myPending.length && d === today()) {
    alerts.push({
      type: 'ACTION',
      text: 'ท่านมีเวรที่ยังไม่ได้เช็คอิน ' + myPending.length + ' รายการ',
      link: 'mine'
    });
  }

  return {
    date: d,
    dateThai: thaiDate(d, { weekday: true }),
    isToday: d === today(),
    isDutyDay: shared.isDutyDay,
    hasSchedule: shared.rows.length > 0,
    semesterName: shared.semesterName,
    canSeeAll: canSeeAll,
    canAdjust: ctx.level >= ROLES.DAILY_HEAD.level,
    summary: canSeeAll ? shared.summary : REPORT_summarize_(mine),
    bySlot: canSeeAll ? shared.bySlot : [],
    rows: sortBy(visibleRows, ['slotSort', 'pointSort', 'seatNo']),
    mine: sortBy(mine, ['slotSort', 'pointSort']),
    alerts: alerts,
    rotation: {
      mode: PR_mode_(),
      modeLabel: PR_MODES[PR_mode_()],
      offset: shared.rotationOffset
    },
    cached: shared.cached,
    prevDate: addDays(d, -1),
    nextDate: addDays(d, 1)
  };
}

/** ส่วนที่ใช้ร่วมกันทุกคนของวันหนึ่ง — แคชไว้ 60 วินาที */
function TODAY_shared_(d, force) {
  var key = 'today:' + d;
  if (!force) {
    var hit = CACHE_get(key);
    if (hit) { hit.cached = true; return hit; }
  }

  var semester = SEMESTER_forDate(d);
  var rows = SCHEDULE_dayRows_(d);

  var payload = {
    rows: rows,
    summary: REPORT_summarize_(rows),
    bySlot: REPORT_groupSummary_(rows, function (r) { return r.slotName || 'ไม่ระบุช่วงเวลา'; }),
    isDutyDay: semester ? CAL_isDutyDay(d, semester.id) : (weekdayOf(d) >= 1 && weekdayOf(d) <= 5),
    semesterName: semester ? str(semester.name) : '',
    rotationOffset: rows.length ? num(rows[0].rotationOffset) : 0,
    cached: false
  };

  CACHE_put_short_(key, payload);
  return payload;
}

/** แคชอายุสั้นสำหรับหน้าวันนี้ */
function CACHE_put_short_(key, value) {
  try {
    var json = JSON.stringify(value);
    if (json.length > DB_CHUNK * DB_MAX_CHUNKS) return false;
    var c = CacheService.getScriptCache();
    var n = Math.ceil(json.length / DB_CHUNK);
    var map = {};
    for (var i = 0; i < n; i++) map[key + ':' + i] = json.substr(i * DB_CHUNK, DB_CHUNK);
    c.putAll(map, TODAY_CACHE_TTL);
    c.put(key, JSON.stringify({ n: n, at: nowIso() }), TODAY_CACHE_TTL);
    return true;
  } catch (e) {
    return false;
  }
}

/** การ์ดสรุปแต่ละจุดสำหรับหน้าวันนี้ (มุมมองแบบการ์ด) */
function TODAY_cards(ctx, date) {
  var data = TODAY_summary(ctx, { date: date });
  var byPoint = groupBy(data.rows, function (r) { return r.pointId; });
  var cards = Object.keys(byPoint).map(function (pid) {
    var list = sortBy(byPoint[pid], ['slotSort', 'seatNo']);
    var s = REPORT_summarize_(list);
    return {
      pointId: pid,
      pointName: list[0].pointName,
      pointSort: list[0].pointSort,
      seats: list,
      summary: s,
      worst: s.absent ? 'ABSENT' : (s.partial || s.late ? 'WARN' : 'OK')
    };
  });
  return {
    date: data.date, dateThai: data.dateThai,
    summary: data.summary,
    cards: sortBy(cards, ['pointSort', 'pointName'])
  };
}

/**
 * แดชบอร์ดภาพรวม (ใช้ในหน้าผู้บริหาร)
 * ย่อลงเหลือเฉพาะตัวเลขที่ตัดสินใจได้จริง
 */
function DASH_overview(ctx, opts) {
  AUTH_requireReviewer(ctx);
  var o = opts || {};
  var to = toDateStr(o.to) || today();
  var from = toDateStr(o.from) || addDays(to, -29);

  var rows = REPORT_buildRows_(from, to);
  var past = rows.filter(function (r) { return r.date <= today() && r.status !== 'CANCELLED'; });

  var byDate = groupBy(past, function (r) { return r.date; });
  var trend = Object.keys(byDate).sort().map(function (d) {
    var s = REPORT_summarize_(byDate[d]);
    return {
      date: d, dateThai: thaiDate(d, { short: true }),
      attendRate: s.attendRate, evidenceRate: s.evidenceRate, total: s.total
    };
  });

  var worst = REPORT_groupSummary_(past, function (r) { return r.department || 'ไม่ระบุ'; })
    .sort(function (a, b) { return a.attendRate - b.attendRate; }).slice(0, 5);

  return {
    from: from, to: to,
    fromThai: thaiDate(from), toThai: thaiDate(to),
    overall: REPORT_summarize_(past),
    trend: trend,
    lowestDepartments: worst,
    byPoint: REPORT_groupSummary_(past, function (r) { return r.pointName || 'ไม่ระบุ'; }),
    pendingSwaps: SWAP_pendingCount(ctx),
    openIncidents: INCIDENT_openCount(ctx)
  };
}
