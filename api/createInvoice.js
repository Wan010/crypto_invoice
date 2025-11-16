// api/createInvoice.js
import PDFDocument from 'pdfkit';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed — use POST' });
    }

    const data = req.body || (await parseJsonBody(req));
    // Basic validation (fail early)
    if (!data || !data.items || !Array.isArray(data.items)) {
      return res.status(400).json({ error: 'Invalid payload: items required' });
    }

    // Create PDFKit document
    const doc = new PDFDocument({ size: 'A4', margin: 40 });

    // Collect the PDF into a buffer
    const buffers = [];
    doc.on('data', (d) => buffers.push(d));
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=invoice.pdf');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(pdfData);
    });

    // --- PDF content: Neon-inspired dark style (printed on white paper will still be readable) ---
    // Header
    doc.fillColor('#FFB86C').fontSize(20).font('Helvetica-Bold').text('CryptoInvoicePro', { continued: true });
    doc.fillColor('#7c5cff').fontSize(12).font('Helvetica').text('  •  Invoice', { align: 'right' });
    doc.moveDown(0.5);

    // Sender & Client
    doc.fillColor('#aaaaaa').fontSize(10);
    doc.text(`From:`, { continued: false });
    doc.moveDown(0.2);
    doc.fillColor('#222222').fontSize(11).text(data.sender || 'Your Business Name');
    doc.moveUp(0.4);
    doc.moveDown(0.6);

    doc.fillColor('#aaaaaa').fontSize(10).text('Bill To:');
    doc.fillColor('#222222').fontSize(11).text(data.client || 'Client Name');
    doc.moveDown(0.8);

    // Invoice meta
    const invId = data.id || `INV-${Date.now()}`;
    const created = data.createdAt || new Date().toISOString().split('T')[0];
    doc.fontSize(10).fillColor('#666').text(`Invoice #: ${invId}`, { continued: true }).text(`  Date: ${created}`, { align: 'right' });
    doc.moveDown(0.6);

    // Table header
    const tableTop = doc.y + 10;
    doc.fontSize(10).fillColor('#ffffff');
    doc.rect(doc.x - 2, tableTop - 4, 520, 24).fill('#1b2336').stroke();
    doc.fillColor('#7c5cff').font('Helvetica-Bold').text('Description', doc.x + 6, tableTop, { width: 300 });
    doc.fillColor('#9aa6b2').font('Helvetica-Bold').text('Qty', doc.x + 310, tableTop, { width: 60, align: 'right' });
    doc.fillColor('#9aa6b2').font('Helvetica-Bold').text('Price', doc.x + 375, tableTop, { width: 90, align: 'right' });
    doc.fillColor('#9aa6b2').font('Helvetica-Bold').text('Total', doc.x + 470, tableTop, { width: 80, align: 'right' });

    doc.moveDown(2);

    // Table rows
    let y = doc.y;
    doc.font('Helvetica').fontSize(10).fillColor('#e6eef8');
    let subtotal = 0;
    for (const it of data.items) {
      const desc = (it.name || it.description || '').toString();
      const qty = Number(it.qty || it.quantity || 1);
      const price = Number(it.price || 0);
      const rowTotal = Math.round((qty * price + Number.EPSILON) * 100) / 100;
      subtotal += rowTotal;

      doc.text(desc, doc.x + 6, y, { width: 300 });
      doc.text(String(qty), doc.x + 310, y, { width: 60, align: 'right' });
      doc.text(price.toFixed(2), doc.x + 375, y, { width: 90, align: 'right' });
      doc.text(rowTotal.toFixed(2), doc.x + 470, y, { width: 80, align: 'right' });

      y += 20;
      doc.y = y;
      // Add subtle separator
      doc.strokeColor('rgba(255,255,255,0.03)').moveTo(doc.x - 2, y - 6).lineTo(doc.page.width - doc.page.margins.right + 2, y - 6).stroke();
    }

    doc.moveDown(1);

    // Totals box
    const tax = Number(data.tax || 0);
    const discount = Number(data.discount || 0);
    const taxAmount = Math.round((subtotal * tax / 100 + Number.EPSILON) * 100) / 100;
    const total = Math.round((subtotal + taxAmount - discount + Number.EPSILON) * 100) / 100;

    const rightX = 380;
    doc.fontSize(10).fillColor('#9aa6b2').text('Subtotal', rightX, y + 10, { width: 180, align: 'right' });
    doc.fillColor('#e6eef8').text(subtotal.toFixed(2), rightX + 120, y + 10, { align: 'right' });

    doc.fillColor('#9aa6b2').text(`Tax (${tax}%)`, rightX, y + 30, { width: 180, align: 'right' });
    doc.fillColor('#e6eef8').text(taxAmount.toFixed(2), rightX + 120, y + 30, { align: 'right' });

    doc.fillColor('#9aa6b2').text('Discount', rightX, y + 50, { width: 180, align: 'right' });
    doc.fillColor('#e6eef8').text(discount.toFixed(2), rightX + 120, y + 50, { align: 'right' });

    doc.font('Helvetica-Bold').fillColor('#00e0d1').text('Total', rightX, y + 80, { width: 180, align: 'right' });
    doc.font('Helvetica-Bold').fillColor('#ffffff').text(total.toFixed(2), rightX + 120, y + 80, { align: 'right' });

    doc.moveDown(6);

    // Footer note
    doc.fontSize(9).fillColor('#9aa6b2').text('Thank you for your business. Pay by bank transfer or other agreed method.', { align: 'center' });

    // Finish PDF
    doc.end();

    // Helper: If body was a raw stream, parseJsonBody fallback
    function parseJsonBody(req) {
      return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { resolve({}); }
        });
        req.on('error', reject);
      });
    }
  } catch (err) {
    console.error('/api/createInvoice error', err);
    return res.status(500).json({ error: err.message || 'pdf error' });
  }
}
