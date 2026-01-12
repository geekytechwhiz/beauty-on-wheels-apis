import PDFDocument from 'pdfkit';
import getStream from 'get-stream';
import { PassThrough } from 'stream';
import path from 'path';
import fs from 'fs';

export async function generateInvoiceBuffer(invoice: any): Promise<Buffer> {
  if (!invoice) throw new Error('Missing invoice data');

  // Create PDF without auto page to avoid Helvetica fallback
  const doc = new PDFDocument({ size: 'A4', margin: 50, autoFirstPage: false });
  const stream = doc.pipe(new PassThrough());

  // Resolve font path from project root
  const fontPath = path.join(process.cwd(), 'src/utils/fonts/NotoSans-Regular.ttf');
  console.log('[Invoice PDF] Resolved font path:', fontPath);

  if (!fs.existsSync(fontPath)) {
    throw new Error(`[Invoice PDF] Font file missing at: ${fontPath}`);
  }

  //  Register and apply custom font before adding page
  doc.registerFont('NotoSans', fontPath);
  doc.addPage();
  doc.font('NotoSans');

  //  Write content
  doc.fontSize(20)
    .text(`Invoice - ${invoice.invoiceId}`, { align: 'center' })
    .moveDown();

  const org = invoice.orgInfo || {};
  doc.fontSize(14).text('Organization Info', { underline: true });
  doc.fontSize(12).text(
    `${org.name ?? ''}\n${org.email ?? ''}\n${org.address ?? ''}, ${org.city ?? ''}, ${org.state ?? ''}, ${org.country ?? ''}`
  ).moveDown();

  const billed = invoice.billedTo || {};
  doc.fontSize(14).text('Billed To', { underline: true });
  doc.fontSize(12).text(
    `${billed.name ?? ''}\n${billed.email ?? ''}\n${billed.address ?? ''}, ${billed.city ?? ''}, ${billed.state ?? ''}, ${billed.country ?? ''}`
  ).moveDown();

  const products = invoice.products || [];
  doc.fontSize(14).text('Products', { underline: true }).moveDown(0.5);

  const tableTop = doc.y;
  const itemX = [50, 200, 300, 400];
  doc.fontSize(12)
    .text('Title', itemX[0], tableTop)
    .text('Qty', itemX[1], tableTop)
    .text('Unit Price', itemX[2], tableTop)
    .text('Amount', itemX[3], tableTop);

  let y = tableTop + 20;
  for (const p of products) {
    doc.text(p.title, itemX[0], y)
      .text(p.quantity?.toString() ?? '', itemX[1], y)
      .text(`₹${(p.unitPrice ?? 0).toFixed(2)}`, itemX[2], y)
      .text(`₹${(p.amount ?? 0).toFixed(2)}`, itemX[3], y);
    y += 20;
  }

  doc.moveDown(2);

  const summary = invoice.summary || {};
  doc.fontSize(14).text('Summary', { underline: true });
  doc.fontSize(12)
    .text(`Subtotal: ₹${summary.subtotal ?? 0}`)
    .text(`Discount: ${summary.discount?.value ?? 0}%`)
    .text(`Tax: ₹${summary.tax ?? 0}`)
    .text(`Total: ₹${summary.amount ?? 0}`);

  doc.end();
  return await getStream.buffer(stream);
}
