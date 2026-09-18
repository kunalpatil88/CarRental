/* ============================================================
   Enquiries: stored in data/enquiries.json, exported as .xlsx
   Zero dependencies: the Excel file is written by hand (it is a zip of XML files).
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const STATUSES = ["new", "contacted", "booked", "closed"];
const STATUS_LABEL = { new: "New", contacted: "Contacted", booked: "Booked", closed: "Closed" };

/* ---------- store ---------- */
function createStore(file) {
  let cache = null;
  let queue = Promise.resolve();
  function load() {
    if (cache) return cache;
    try { cache = JSON.parse(fs.readFileSync(file, "utf8")); if (!Array.isArray(cache)) cache = []; } catch (e) { cache = []; }
    return cache;
  }
  // Writes go through a queue and a temp file, so two enquiries at once can't corrupt the file.
  function persist() {
    queue = queue.then(() => {
      const tmp = file + ".tmp";
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(cache, null, 1));
      fs.renameSync(tmp, file);
    }).catch((e) => console.error("Could not save enquiries:", e.message));
    return queue;
  }
  return {
    all: () => load(),
    add(e) { load().push(e); return persist(); },
    update(id, patch) { const e = load().find((x) => x.id === id); if (!e) return null; Object.assign(e, patch, { updatedAt: new Date().toISOString() }); persist(); return e; },
    remove(id) { const list = load(); const i = list.findIndex((x) => x.id === id); if (i < 0) return false; list.splice(i, 1); persist(); return true; },
  };
}

/* ---------- validation of a public submission ---------- */
const str = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
function cleanEnquiry(b) {
  const phone = str(b.phone, 20);
  if (str(b.name, 80).length < 2) return { error: "Name is required" };
  if (phone.replace(/\D/g, "").length < 10) return { error: "A 10-digit mobile number is required" };
  const pickup = isDate(b.pickup) ? b.pickup : "", ret = isDate(b.return) ? b.return : "";
  const ref = /^DP-\d{6}-[A-Z0-9]{4}$/.test(b.ref) ? b.ref : "DP-" + new Date().toISOString().slice(2, 10).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  return {
    enquiry: {
      id: ref, createdAt: new Date().toISOString(), status: "new", notes: "",
      source: b.source === "contact" ? "Contact form" : "Car page",
      name: str(b.name, 80), phone,
      carId: str(b.carId, 60), carName: str(b.carName, 100),
      pickup, return: ret, days: Math.max(0, Math.min(365, parseInt(b.days, 10) || 0)),
      pricePerDay: Math.max(0, Number(b.pricePerDay) || 0), estimate: Math.max(0, Number(b.estimate) || 0),
      message: str(b.message, 600),
    },
  };
}

/* ---------- filtering (shared by list + export) ---------- */
function filterList(list, q) {
  const s = String(q.q || "").toLowerCase(), st = STATUSES.includes(q.status) ? q.status : "";
  const from = isDate(q.from) ? q.from : "", to = isDate(q.to) ? q.to : "";
  return list.filter((e) => {
    const day = e.createdAt.slice(0, 10);
    return (!st || e.status === st) && (!from || day >= from) && (!to || day <= to) &&
      (!s || [e.id, e.name, e.phone, e.carName, e.message, e.notes].join(" ").toLowerCase().includes(s));
  });
}

/* ============================================================
   Minimal .xlsx writer
   ============================================================ */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zip(files) {
  const locals = [], centrals = []; let offset = 0;
  const now = new Date(), dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = Buffer.from(f.name), data = Buffer.from(f.data, "utf8"), comp = zlib.deflateRawSync(data), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, comp); centrals.push(ch, name); offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const xml = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const colName = (i) => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
// Excel stores dates as days since 1899-12-30. IST (UTC+5:30) so times match what the owner saw.
const IST = 5.5 * 3600 * 1000;
const serialDateTime = (iso) => (Date.parse(iso) + IST - Date.UTC(1899, 11, 30)) / 86400000;
const serialDate = (ymd) => { const [y, m, d] = ymd.split("-").map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; };

/* columns: [header, width, (enquiry) => value, style]  styles: 0 text, 2 datetime, 3 date, 4 rupees, 5 number */
const COLUMNS = [
  ["Reference", 17, (e) => e.id, 0],
  ["Received", 22, (e) => serialDateTime(e.createdAt), 2],
  ["Status", 11, (e) => STATUS_LABEL[e.status] || e.status, 0],
  ["Customer name", 22, (e) => e.name, 0],
  ["Mobile", 15, (e) => e.phone, 0],
  ["Car", 28, (e) => e.carName || "Not decided", 0],
  ["Pickup date", 13, (e) => (e.pickup ? serialDate(e.pickup) : ""), 3],
  ["Return date", 13, (e) => (e.return ? serialDate(e.return) : ""), 3],
  ["Days", 7, (e) => e.days || "", 5],
  ["Rate per day", 13, (e) => e.pricePerDay || "", 4],
  ["Estimated total", 15, (e) => e.estimate || "", 4],
  ["Source", 13, (e) => e.source, 0],
  ["Customer message", 40, (e) => e.message, 0],
  ["Your notes", 40, (e) => e.notes, 0],
];

function toXlsx(list, title) {
  const rows = [COLUMNS.map((c) => c[0])].concat(list.map((e) => COLUMNS.map((c) => c[2](e))));
  const sheetRows = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = colName(ci) + (ri + 1), style = ri === 0 ? 1 : COLUMNS[ci][3];
    if (v === "" || v == null) return style ? `<c r="${ref}" s="${style}"/>` : "";
    if (typeof v === "number" && ri > 0) return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  }).join("")}</row>`).join("");
  const lastCol = colName(COLUMNS.length - 1), lastRow = rows.length;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
<cols>${COLUMNS.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c[1]}" customWidth="1"/>`).join("")}</cols>
<sheetData>${sheetRows}</sheetData>
<autoFilter ref="A1:${lastCol}${lastRow}"/>
</worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="dd-mmm-yyyy hh:mm AM/PM"/><numFmt numFmtId="165" formatCode="dd-mmm-yyyy"/><numFmt numFmtId="166" formatCode="&quot;₹&quot;#,##,##0"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0071E3"/></patternFill></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" horizontal="left"/></xf>
<xf numFmtId="165" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" horizontal="left"/></xf>
<xf numFmtId="166" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
</cellXfs>
</styleSheet>`;
  const sheetName = xml(String(title || "Enquiries").replace(/[\\/?*[\]:]/g, "").slice(0, 31));
  return zip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sheetName}'!$A$1:$${lastCol}$${lastRow}</definedName></definedNames></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/worksheets/sheet1.xml", data: sheet },
    { name: "xl/styles.xml", data: styles },
  ]);
}

module.exports = { createStore, cleanEnquiry, filterList, toXlsx, STATUSES };
