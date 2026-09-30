/**
 * AuditService.gs — บันทึกร่องรอยการใช้งาน
 * ห้ามลบประวัติสำคัญ การแก้ไขต้องเก็บข้อมูลก่อนแก้และหลังแก้
 */

/** คิวบันทึก audit ภายในการเรียก 1 ครั้ง (เขียนรวดเดียวตอนจบ) */
var AUDIT_QUEUE = [];

function AUDIT_log(ctx, action, entity, entityId, before, after, note) {
  AUDIT_QUEUE.push({
    id: uuid(),
    ts: nowIso(),
    actor_id: (ctx && ctx.teacherId) || '',
    actor_email: (ctx && ctx.email) || '',
    actor_role: (ctx && ctx.role) || '',
    action: str(action),
    entity: str(entity),
    entity_id: str(entityId),
    before_json: before ? truncate(JSON.stringify(before), 4000) : '',
    after_json: after ? truncate(JSON.stringify(after), 4000) : '',
    note: str(note)
  });
}

/** เขียนคิวลงชีต — เรียกท้าย api() เสมอ */
function AUDIT_flush() {
  if (!AUDIT_QUEUE.length) return 0;
  var items = AUDIT_QUEUE;
  AUDIT_QUEUE = [];
  try {
    dbInsertMany('AUDIT_LOG', items);
    return items.length;
  } catch (e) {
    return 0;   // การบันทึก audit ล้มเหลวต้องไม่ทำให้คำขอหลักล้ม
  }
}

/** ค้นประวัติ (เฉพาะผู้ดูแล) */
function AUDIT_search(ctx, opts) {
  AUTH_requireRole(ctx, ['SYS_ADMIN', 'DUTY_ADMIN', 'EXECUTIVE']);
  var o = opts || {};
  var rows = dbReadAll('AUDIT_LOG');

  var from = toDateStr(o.from), to = toDateStr(o.to);
  var filtered = rows.filter(function (r) {
    var d = str(r.ts).substring(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (o.action && str(r.action) !== o.action) return false;
    if (o.entity && str(r.entity) !== o.entity) return false;
    if (o.actorEmail && str(r.actor_email) !== str(o.actorEmail)) return false;
    if (o.q) {
      var q = str(o.q).toLowerCase();
      var hay = (str(r.action) + str(r.entity) + str(r.entity_id) + str(r.actor_email) + str(r.note)).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });

  filtered.sort(function (a, b) { return str(b.ts) < str(a.ts) ? -1 : 1; });

  var limit = num(o.limit, 200);
  return { total: filtered.length, rows: filtered.slice(0, limit) };
}

/** รายการ action ทั้งหมดที่เคยเกิด (สำหรับตัวกรอง) */
function AUDIT_actions(ctx) {
  AUTH_requireRole(ctx, ['SYS_ADMIN', 'DUTY_ADMIN', 'EXECUTIVE']);
  var seen = {};
  dbReadAll('AUDIT_LOG').forEach(function (r) { seen[str(r.action)] = true; });
  return Object.keys(seen).filter(function (k) { return !!k; }).sort();
}
