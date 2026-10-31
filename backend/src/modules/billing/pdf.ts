import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import type { invoiceDetail } from '../projections.js';

export async function invoicePdf(invoice: ReturnType<typeof invoiceDetail>): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: `Invoice ${invoice.number}`, Author: 'Brightloop' } });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
  });
  const scripts = ['Devanagari', 'Bengali', 'Gurmukhi', 'Gujarati', 'Oriya', 'Tamil', 'Telugu', 'Kannada', 'Malayalam'];
  doc.registerFont('NotoSans', fileURLToPath(new URL('../../assets/fonts/NotoSans-Regular.ttf', import.meta.url)));
  for (const script of scripts) doc.registerFont(script, fileURLToPath(new URL(`../../assets/fonts/NotoSans${script}-Regular.ttf`, import.meta.url)));
  function text(value: string, options: PDFKit.Mixins.TextOptions = {}) {
    // Keep combining characters and joining sequences with their script font so
    // fontkit can shape complete Indic syllables, including conjuncts.
    const runs: Array<{ font: string; value: string }> = [];
    for (const char of value) {
      const point = char.codePointAt(0)!;
      const block = point >= 0x900 && point <= 0xd7f ? Math.floor((point - 0x900) / 128) : -1;
      const font = block >= 0 ? scripts[block]! : /[\u200c\u200d]/u.test(char) ? runs.at(-1)?.font ?? 'NotoSans' : 'NotoSans';
      if (runs.at(-1)?.font === font) runs.at(-1)!.value += char;
      else runs.push({ font, value: char });
    }
    runs.forEach((run, index) => doc.font(run.font).text(run.value, { ...options, continued: index < runs.length - 1 }));
    doc.font('NotoSans');
  }
  doc.fillColor('#183153').fontSize(24).text('BRIGHTLOOP');
  doc.fontSize(18).text(`Invoice ${invoice.number}`).moveDown(0.5);
  doc.fillColor('#333333').fontSize(10).text(`Status: ${invoice.status.toUpperCase()} | Currency: ${invoice.currency}`)
    .text(`Issued: ${invoice.issue_date} | Due: ${invoice.due_date}`)
    .text(`Service period: ${invoice.period_start} to ${invoice.period_end} (exclusive)`)
    .text(`Subscription: ${invoice.subscription_number}`).moveDown();
  doc.font('Helvetica-Bold').text('BILL TO');
  text(invoice.customer_name); text(invoice.billing_email);
  if (invoice.billing_address) text(invoice.billing_address);
  doc.moveDown();
  for (const [index, line] of invoice.lines.entries()) {
    const heading = `${index + 1}. ${line.description}`;
    if (doc.y + doc.heightOfString(heading) + 80 > 770) doc.addPage();
    text(heading);
    doc.text(`Quantity ${line.quantity} x INR ${line.unit_price}`)
      .text(`Subtotal ${line.subtotal}   Discount ${line.discount_amount}   Tax ${line.tax_amount}   Total ${line.total}`);
    for (const tax of line.taxes) text(`${tax.name} (${tax.rate_percent}%): INR ${tax.amount}`, { indent: 12 });
    for (const discount of line.discounts) text(`${discount.name}: -INR ${discount.amount}`, { indent: 12 });
    doc.moveDown();
  }
  if (doc.y > 650) doc.addPage();
  doc.font('Helvetica-Bold').fontSize(12).text(`Subtotal: INR ${invoice.subtotal}`, { align: 'right' })
    .text(`Discount: INR ${invoice.discount_total}`, { align: 'right' })
    .text(`Tax: INR ${invoice.tax_total}`, { align: 'right' })
    .text(`Total: INR ${invoice.total}`, { align: 'right' })
    .text(`Paid: INR ${invoice.amount_paid}`, { align: 'right' })
    .text(`Balance due: INR ${invoice.balance_due}`, { align: 'right' });
  const pages = doc.bufferedPageRange();
  for (let page = 0; page < pages.count; page++) {
    doc.switchToPage(page); doc.font('Helvetica').fontSize(8).fillColor('#666666')
      .text(`Brightloop | ${invoice.number} | Page ${page + 1} of ${pages.count}`, 48, 795, { lineBreak: false });
  }
  doc.end(); return result;
}
