// api/createCryptoInvoice.js
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed — use POST' });
    }

    const data = req.body || (await parseJsonBody(req));
    if (!data || !data.items || !Array.isArray(data.items)) {
      return res.status(400).json({ error: 'Invalid payload: items required' });
    }

    // Prepare crypto info
    const cryptoSymbol = (data.crypto || 'BTC').toUpperCase();
    const wallet = (data.wallet || '').trim();
    const usdTotal = Number(data.usdTotal || data.usdTotal === 0 ? data.usdTotal : data.total || 0);

    // If crypto price is provided by frontend, use it; else fetch via CoinGecko
    let price = Number(data.price || 0);
    if (!price || price <= 0) {
      // fallback fetch
      const coinId = cryptoSymbol === 'BTC' ? 'bitcoin' : (cryptoSymbol === 'ETH' ? 'ethereum' : 'tether');
      const resp = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`);
      const j = await resp.json();
      price = j[coinId] && j[coinId].usd ? j[coinId].usd : 1;
    }

    const cryptoAmount = price > 0 ? Math.round(((usdTotal / price) + Number.EPSILON) * 1e8) / 1e8 : 0;

    // Generate QR data URL (uri scheme: bitcoin:addr?amount=)
    const uri = wallet ? `${cryptoSymbol.toLowerCase()}:${wallet}?amount=${cryptoAmount}` : '';
    const qrDataUrl = uri ? await QRCode.toDataURL(uri, { margin: 1, color: { dark: '#00e0d1', light: '#071229' } }) : null;

    // Generate PDF
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const buffers = [];
    doc.on('data', (d) => buffers.push(d));
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=crypto-invoice.pdf');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(pdfData);
    });

    // Header
    doc.fillColor('#FFB86C').fontSize(20).font('Helvetica-Bold').text('CryptoInvoicePro', { continued: true });
    doc.fillColor('#7c5cff').fontSize(12).text('  •  Crypto Invoice', { align: 'right' });
    doc.moveDown(0.6);

    // Sender & Client
    doc.fillColor('#9aa6b2').fontSize(10).text('From:');
    doc.fillColor('#e6eef8').fontSize(11).text(data.sender || 'Your Business Name');
    doc.moveDown(0.4);
    doc.fillColor('#9aa6b2').fontSize(10).text('Bill To:');
    doc.fillColor('#e6eef8').fontSize(11).text(data.client || 'Client Name');
    doc.moveDown(0.8);

    // Items table (similar to normal)
    let y = doc.y;
    doc.fontSize(10).fillColor('#ffffff');
    doc.rect(doc.x - 2, y - 4, 520, 24).fill('#0f1724').stroke();
    doc.fillColor('#7c5cff').font('Helvetica-Bold').text('Description', doc.x + 6, y, { width: 300 });
    doc.fillColor('#9aa6b2').font('Helvetica-Bold').text('Qty', doc.x + 310, y, { width: 60, align: 'right' });
    doc.fillColor('#9aa6b2').font('Helvetica-Bold').text('Price (USD)', doc.x + 375, y, { width: 90, align: 'right' });
    doc.fillColor('#9aa6b2').font('Helvetica-Bold').text('Total (USD)', doc.x + 470, y, { width: 80, align: 'right' });
    doc.moveDown(2);

    let subtotal = 0;
    for (const it of data.items) {
      const desc = (it.name || it.description || '').toString();
      const qty = Number(it.qty || 1);
      const priceItem = Number(it.price || 0);
      const rowTotal = Math.round((qty * priceItem + Number.EPSILON) * 100) / 100;
      subtotal += rowTotal;

      doc.font('Helvetica').fontSize(10).fillColor('#e6eef8');
      doc.text(desc, { continued: false, width: 300 });
      doc.text(String(qty), { align: 'right', continued: false, paragraphGap: 0 });
      // Absolute placement for reliability:
      const currentY = doc.y;
      doc.text(priceItem.toFixed(2), 375, currentY - 12, { width: 90, align: 'right' });
      doc.text(rowTotal.toFixed(2), 470, currentY - 12, { width: 80, align: 'right' });
      doc.moveDown(1);
    }

    // Totals
    const tax = Number(data.tax || 0);
    const taxAmount = Math.round((subtotal * tax / 100 + Number.EPSILON) * 100) / 100;
    const totalUsd = Math.round((subtotal + taxAmount - (Number(data.discount || 0) || 0) + Number.EPSILON) * 100) / 100;

    const rightX = 380;
    doc.fillColor('#9aa6b2').text('Subtotal', rightX, doc.y + 10, { width: 180, align: 'right' });
    doc.fillColor('#e6eef8').text(subtotal.toFixed(2), rightX + 120, doc.y + 10, { align: 'right' });

    doc.fillColor('#9aa6b2').text(`Tax (${tax}%)`, rightX, doc.y + 30, { width: 180, align: 'right' });
    doc.fillColor('#e6eef8').text(taxAmount.toFixed(2), rightX + 120, doc.y + 30, { align: 'right' });

    doc.font('Helvetica-Bold').fillColor('#00e0d1').text('Total (USD)', rightX, doc.y + 60, { width: 180, align: 'right' });
    doc.font('Helvetica-Bold').fillColor('#ffffff').text(totalUsd.toFixed(2), rightX + 120, doc.y + 60, { align: 'right' });

    // Crypto summary box
    doc.moveDown(4);
    doc.rect(doc.x - 2, doc.y - 6, 520, 72).fill('#071229').stroke();
    doc.fillColor('#00e0d1').font('Helvetica-Bold').fontSize(12).text(`${cryptoSymbol} Amount Due:`, doc.x + 6, doc.y - 2);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text(`${cryptoAmount} ${cryptoSymbol}`, doc.x + 6, doc.y + 18);

    doc.fillColor('#9aa6b2').font('Helvetica').fontSize(10).text(`Rate used: $${price} per ${cryptoSymbol}`, doc.x + 6, doc.y + 44);

    // QR: embed if available
    if (qrDataUrl) {
      // decode base64 data URL
      const base64 = qrDataUrl.split(',')[1];
      const imgBuffer = Buffer.from(base64, 'base64');
      // Place QR on the right inside the crypto box
      doc.image(imgBuffer, doc.page.width - 170, doc.y - 66, { fit: [140, 140], align: 'right', valign: 'center' });
    }

    // Footer note
    doc.moveDown(8);
    doc.fontSize(9).fillColor('#9aa6b2').text('This invoice includes crypto payment instructions. Payment confirmation occurs on-chain and may take several confirmations depending on the network.', { align: 'center' });

    doc.end();

    // Helper for raw body parsing
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
    console.error('/api/createCryptoInvoice error', err);
    return res.status(500).json({ error: err.message || 'crypto pdf error' });
  }
}
