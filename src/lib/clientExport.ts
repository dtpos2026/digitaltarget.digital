// DT POS — Super Admin client list export (Excel, CSV, PDF)
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';

export interface ClientExportRow {
  restaurantName: string;
  ownerEmail: string;
  phone: string;
  city: string;
  address: string;
  plan: string;
  planExpiry: string;
  daysLeft: string;
  activeDevices: number;
  tenantId: string;
}

const HEADERS = [
  'Restaurant', 'Owner Email', 'Phone', 'City', 'Address',
  'Plan', 'Expiry', 'Days Left', 'Active Devices', 'Tenant ID',
];

function toMatrix(rows: ClientExportRow[]): (string | number)[][] {
  return rows.map(r => [
    r.restaurantName, r.ownerEmail, r.phone, r.city, r.address,
    r.plan, r.planExpiry, r.daysLeft, r.activeDevices, r.tenantId,
  ]);
}

export function exportClientsToExcel(rows: ClientExportRow[]) {
  const data = [HEADERS, ...toMatrix(rows)];
  const ws = XLSX.utils.aoa_to_sheet(data);
  // column widths
  ws['!cols'] = [
    { wch: 28 }, { wch: 26 }, { wch: 14 }, { wch: 14 }, { wch: 30 },
    { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 28 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Clients');
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `DT-POS-Clients-${stamp}.xlsx`);
}

export function exportClientsToCSV(rows: ClientExportRow[]) {
  const data = [HEADERS, ...toMatrix(rows)];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `DT-POS-Clients-${stamp}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportClientsToPDF(rows: ClientExportRow[]) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 28;
  let y = margin;

  // Header
  doc.setFillColor(60, 9, 108);
  doc.rect(0, 0, pageW, 60, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Digital Target — DT POS', margin, 28);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`Client List · ${new Date().toLocaleDateString()} · Total ${rows.length}`, margin, 46);

  y = 80;
  doc.setTextColor(0, 0, 0);

  // Column layout (widths in pt)
  const cols = [
    { k: 'restaurantName', label: 'Restaurant', w: 130 },
    { k: 'ownerEmail',     label: 'Email',      w: 150 },
    { k: 'phone',          label: 'Phone',      w: 80 },
    { k: 'city',           label: 'City',       w: 70 },
    { k: 'plan',           label: 'Plan',       w: 60 },
    { k: 'planExpiry',     label: 'Expiry',     w: 70 },
    { k: 'daysLeft',       label: 'Days',       w: 50 },
    { k: 'activeDevices',  label: 'Devices',    w: 50 },
    { k: 'address',        label: 'Address',    w: 140 },
  ] as const;

  const drawHeader = () => {
    doc.setFillColor(124, 58, 237);
    doc.rect(margin, y, pageW - margin * 2, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    let x = margin + 6;
    cols.forEach(c => { doc.text(c.label, x, y + 15); x += c.w; });
    y += 22;
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
  };

  drawHeader();

  doc.setFontSize(8);
  const rowH = 20;
  rows.forEach((r, idx) => {
    if (y + rowH > doc.internal.pageSize.getHeight() - margin) {
      doc.addPage();
      y = margin;
      drawHeader();
    }
    if (idx % 2 === 0) {
      doc.setFillColor(245, 243, 255);
      doc.rect(margin, y, pageW - margin * 2, rowH, 'F');
    }
    let x = margin + 6;
    cols.forEach(c => {
      const v = String((r as any)[c.k] ?? '');
      const truncated = doc.splitTextToSize(v, c.w - 8)[0] || '';
      doc.text(truncated, x, y + 13);
      x += c.w;
    });
    y += rowH;
  });

  // Footer
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Page ${i} / ${pages} · Digital Target · 0345-1873354`,
      pageW / 2,
      doc.internal.pageSize.getHeight() - 12,
      { align: 'center' },
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`DT-POS-Clients-${stamp}.pdf`);
}
