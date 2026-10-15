import { downloadBlob, pngFilePart } from './index.js?v=png-local-save-20260825-1';

const encoder = new TextEncoder();
const escapeXml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
const columnName = index => {
  let name = '';
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name;
  return name;
};

function sheetXml(rows, widths) {
  const sheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${reference}" s="${rowIndex ? 2 : 1}"><v>${value}</v></c>`;
    return `<c r="${reference}" t="inlineStr" s="${rowIndex ? 0 : 1}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${columns}</cols><sheetData>${sheetRows}</sheetData></worksheet>`;
}

let crcTable;
function crc32(bytes) {
  crcTable ||= Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    return crc >>> 0;
  });
  let crc = 0xffffffff;
  bytes.forEach(byte => { crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]; });
  return (crc ^ 0xffffffff) >>> 0;
}

const write16 = (view, offset, value) => view.setUint16(offset, value, true);
const write32 = (view, offset, value) => view.setUint32(offset, value >>> 0, true);
function zipStore(files) {
  const chunks = [], central = [];
  let offset = 0;
  Object.entries(files).forEach(([name, content]) => {
    const nameBytes = encoder.encode(name), data = encoder.encode(content), crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length), localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50); write16(localView, 4, 20); write16(localView, 6, 0x0800); write32(localView, 14, crc); write32(localView, 18, data.length); write32(localView, 22, data.length); write16(localView, 26, nameBytes.length);
    local.set(nameBytes, 30); chunks.push(local, data);
    const directory = new Uint8Array(46 + nameBytes.length), directoryView = new DataView(directory.buffer);
    write32(directoryView, 0, 0x02014b50); write16(directoryView, 4, 20); write16(directoryView, 6, 20); write16(directoryView, 8, 0x0800); write32(directoryView, 16, crc); write32(directoryView, 20, data.length); write32(directoryView, 24, data.length); write16(directoryView, 28, nameBytes.length); write32(directoryView, 42, offset);
    directory.set(nameBytes, 46); central.push(directory); offset += local.length + data.length;
  });
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = new Uint8Array(22), endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50); write16(endView, 8, central.length); write16(endView, 10, central.length); write32(endView, 12, centralSize); write32(endView, 16, offset);
  return new Blob([...chunks, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function createExpenseWorkbook(entries, tripName = '行程') {
  const detailRows = [['日期', '类别', '所属事件', '金额事项', '计价方式', '单价（元）', '人数', '小计（元）', '来源'], ...entries.map(item => [
    item.date || '未定日期', item.category || '其他', item.event || item.note || '', item.item || item.note || '未命名支出',
    item.pricingMode || (item.source === 'event' ? '事件费用' : '独立账目'), Number(item.unitPrice ?? item.amount ?? 0), item.people ?? '',
    Number(item.amount || 0), item.source === 'event' ? '时间表安排' : '独立账目'
  ])];
  const daily = new Map();
  entries.forEach(item => daily.set(item.date || '未定日期', (daily.get(item.date || '未定日期') || 0) + Number(item.amount || 0)));
  const summaryRows = [['日期', '当日开销（元）'], ...[...daily].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => [date, amount]), ['全程合计', entries.reduce((sum, item) => sum + Number(item.amount || 0), 0)]];
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><fileVersion appName="行远"/><workbookPr/><bookViews><workbookView/></bookViews><sheets><sheet name="开销明细" sheetId="1" r:id="rId1"/><sheet name="每日汇总" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="0"/></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF176B50"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': sheetXml(detailRows, [14, 12, 28, 28, 14, 14, 10, 14, 14]),
    'xl/worksheets/sheet2.xml': sheetXml(summaryRows, [16, 18])
  };
  return { blob: zipStore(files), filename: `${pngFilePart(tripName)}-每日开销.xlsx` };
}

export async function exportExpenseWorkbook(entries, tripName) {
  const { blob, filename } = createExpenseWorkbook(entries, tripName);
  return downloadBlob(blob, filename, '导出每日开销');
}
