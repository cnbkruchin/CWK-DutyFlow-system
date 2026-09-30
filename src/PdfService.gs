/**
 * PdfService.gs — ออกรายงาน PDF ผ่าน Google Docs (ได้ฟอนต์ไทยจริง)
 */

/** รายงานการปฏิบัติงานเวรประจำวัน เป็น PDF */
function PDF_dailyReport(ctx, opts) {
  AUTH_requireReviewer(ctx);
  var o = opts || {};
  var rep = REPORT_dailyPerformance(ctx, o);

  var folderId = PROP_reportFolderId();
  var docName = 'รายงานเวรประจำวัน ' + rep.date;
  var doc = DocumentApp.create(docName);
  var body = doc.getBody();
  body.setMarginTop(36).setMarginBottom(36).setMarginLeft(36).setMarginRight(36);

  var primary = CFG_str('brand_primary') || '#7A1F2B';

  var h = body.appendParagraph(CFG_str('school_name') || 'โรงเรียนจุนวิทยาคม');
  h.setHeading(DocumentApp.ParagraphHeading.HEADING1);
  h.setAttributes(PDF_attr_({ FONT_FAMILY: 'Sarabun', FOREGROUND_COLOR: primary, FONT_SIZE: 20 }));

  var sub = body.appendParagraph('รายงานการปฏิบัติงานเวรประจำวัน');
  sub.setAttributes(PDF_attr_({ FONT_FAMILY: 'Sarabun', FONT_SIZE: 16, BOLD: true }));

  var meta = body.appendParagraph(rep.dateThai + '   |   ออกรายงานโดย ' + ctx.name +
    ' เมื่อ ' + thaiDate(today()));
  meta.setAttributes(PDF_attr_({ FONT_FAMILY: 'Sarabun', FONT_SIZE: 11, FOREGROUND_COLOR: '#6b7280' }));

  body.appendHorizontalRule();

  // สรุป
  var s = rep.summary;
  var sum = body.appendParagraph(
    'เวรทั้งหมด ' + s.total + ' ช่อง   ·   อยู่ครบ ' + s.present +
    '   ·   สาย ' + s.late + '   ·   อยู่ไม่ครบ ' + s.partial +
    '   ·   ไม่อยู่ ' + s.absent +
    '\nอัตราการปฏิบัติงาน ' + s.attendRate + '%   ·   หลักฐานครบ ' + s.evidenceRate + '%' +
    '   ·   เปลี่ยนเวร ' + s.changed + ' รายการ   ·   เหตุการณ์ ' + s.incidents + ' รายการ');
  sum.setAttributes(PDF_attr_({ FONT_FAMILY: 'Sarabun', FONT_SIZE: 12 }));

  // ตาราง
  var header = ['จุดเวร', 'ช่วงเวลา', 'ครูตามตาราง', 'ครูที่ปฏิบัติจริง', 'สถานะ',
    'เข้า-ออก', 'หลักฐาน', 'ผู้อนุมัติการเปลี่ยนเวร'];
  var cells = [header];
  rep.rows.forEach(function (r) {
    cells.push([
      r.pointName + (r.seatNo > 1 ? ' (' + r.seatNo + ')' : ''),
      r.slotName,
      r.originalTeacherName || '-',
      r.effectiveTeacherName || '-',
      r.attendLabel + (r.lateMinutes ? ' ' + r.lateMinutes + ' นาที' : ''),
      (r.checkInAt || '-') + ' / ' + (r.checkOutAt || '-'),
      r.evidenceLabel + (r.photoCount ? ' · ' + r.photoCount + ' ภาพ' : ''),
      r.approval ? (r.approval.approverName + ' (' + r.approval.approvalLevelName + ')') : '-'
    ]);
  });

  var table = body.appendTable(cells);
  table.setAttributes(PDF_attr_({ FONT_FAMILY: 'Sarabun', FONT_SIZE: 9 }));
  try {
    var hRow = table.getRow(0);
    for (var c = 0; c < header.length; c++) {
      hRow.getCell(c).setBackgroundColor(primary);
      hRow.getCell(c).editAsText().setForegroundColor('#FFFFFF').setBold(true);
    }
  } catch (e) { /* ignore */ }

  // ลงนาม
  body.appendParagraph('');
  var sign = body.appendParagraph(
    'ลงชื่อ ....................................................  ผู้รายงาน\n' +
    '      (' + ctx.name + ')\n\n' +
    'ลงชื่อ ....................................................  ผู้อำนวยการโรงเรียน\n' +
    '      (' + (CFG_str('director_name') || '.....................................') + ')');
  sign.setAttributes(PDF_attr_({ FONT_FAMILY: 'Sarabun', FONT_SIZE: 12 }));

  var foot = body.appendParagraph(CFG_str('report_footer'));
  foot.setAttributes(PDF_attr_({ FONT_FAMILY: 'Sarabun', FONT_SIZE: 9, FOREGROUND_COLOR: '#9ca3af' }));

  doc.saveAndClose();

  var file = DriveApp.getFileById(doc.getId());
  var pdf = file.getAs('application/pdf').setName(docName + '.pdf');

  var out;
  if (folderId) {
    out = DriveApp.getFolderById(folderId).createFile(pdf);
    file.setTrashed(true);                       // ลบไฟล์ Docs ชั่วคราว
  } else {
    out = DriveApp.createFile(pdf);
    file.setTrashed(true);
  }

  try {
    var domain = CFG_schoolDomain();
    if (domain) out.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) { /* ignore */ }

  AUDIT_log(ctx, 'REPORT_PDF', 'REPORT', rep.date, null, { rows: rep.rows.length });

  return {
    name: out.getName(),
    url: out.getUrl(),
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' + out.getId(),
    rows: rep.rows.length
  };
}

function PDF_attr_(map) {
  var a = {};
  Object.keys(map).forEach(function (k) { a[DocumentApp.Attribute[k]] = map[k]; });
  return a;
}
