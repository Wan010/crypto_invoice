// script.js — unified frontend controller for CryptoInvoicePro
// Works across index.html, invoice-normal.html, invoice-crypto.html, dashboard.html
// Features: live prices, invoice logic, localStorage persistence, server-side PDF generation

(() => {
  // ---------- Utilities ----------
  const $ = id => document.getElementById(id);
  const q = sel => document.querySelector(sel);
  const qa = sel => Array.from(document.querySelectorAll(sel));

  function safeJSONParse(s, fallback) {
    try { return JSON.parse(s); } catch (e) { return fallback; }
  }

  function toast(msg) {
    // Simple toast using alert fallback
    try {
      if (window._custom_toast) window._custom_toast(msg);
      else alert(msg);
    } catch (e) { alert(msg); }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'file.bin';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function currencyFormat(n, digits = 2) {
    // safe numeric formatting
    const num = Number(n || 0);
    return num.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  // ---------- Price fetching ----------
  // Strategy: try server endpoint /api/getCryptoPrice (edge-cached) -> fallback to CoinGecko direct
  let latestPrices = { btc: null, eth: null, sol: null, bnb: null, usdt: 1 };

  async function fetchPricesFromServer() {
    try {
      const r = await fetch('/api/getCryptoPrice');
      if (!r.ok) throw new Error('Server price endpoint failed');
      const json = await r.json();
      return json;
    } catch (e) {
      return null;
    }
  }

  async function fetchPricesFromCoinGecko() {
    try {
      const ids = ['bitcoin','ethereum','solana','binancecoin','tether'];
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`;
      const r = await fetch(url);
      if (!r.ok) throw new Error('CoinGecko error');
      const j = await r.json();
      const out = {
        btc: j.bitcoin?.usd || null,
        eth: j.ethereum?.usd || null,
        sol: j.solana?.usd || null,
        bnb: j.binancecoin?.usd || null,
        usdt: j.tether?.usd || 1
      };
      return out;
    } catch (e) {
      console.warn('fetchPricesFromCoinGecko error', e);
      return null;
    }
  }

  async function refreshPrices() {
    // try server
    let p = await fetchPricesFromServer();
    if (!p) p = await fetchPricesFromCoinGecko();
    if (!p) {
      // leave latestPrices unchanged
      return;
    }
    latestPrices = Object.assign({}, latestPrices, p);
    updatePriceUI();
  }

  function updatePriceUI() {
    // Update common UI elements if present
    try {
      if ($('btc-price')) $('btc-price').innerText = latestPrices.btc ? `$${currencyFormat(latestPrices.btc,2)}` : 'N/A';
      if ($('eth-price')) $('eth-price').innerText = latestPrices.eth ? `$${currencyFormat(latestPrices.eth,2)}` : 'N/A';
      if ($('sol-price')) $('sol-price').innerText = latestPrices.sol ? `$${currencyFormat(latestPrices.sol,2)}` : 'N/A';
      if ($('bnb-price')) $('bnb-price').innerText = latestPrices.bnb ? `$${currencyFormat(latestPrices.bnb,2)}` : 'N/A';

      // ticker variants
      qa('.ticker-item').forEach(el => {
        if (el.id === 'btcTicker' && latestPrices.btc) el.innerText = `BTC: $${currencyFormat(latestPrices.btc,2)}`;
        if (el.id === 'ethTicker' && latestPrices.eth) el.innerText = `ETH: $${currencyFormat(latestPrices.eth,2)}`;
      });
    } catch (e) {
      console.warn('updatePriceUI error', e);
    }
  }

  // Initial fetch + periodic refresh
  refreshPrices();
  setInterval(refreshPrices, 20_000); // every 20s

  // ---------- Invoice storage helpers ----------
  const STORAGE_KEYS = {
    INVOICES: 'cip_invoices_v2',
    PROFILE: 'cip_profile_v2',
    DRAFT_ITEMS: 'cip_items_v2'
  };

  function loadInvoices() {
    return safeJSONParse(localStorage.getItem(STORAGE_KEYS.INVOICES), []);
  }
  function saveInvoices(arr) {
    localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(arr));
  }

  function loadProfile() {
    return safeJSONParse(localStorage.getItem(STORAGE_KEYS.PROFILE), { business: '', wallet: '' });
  }
  function saveProfile(obj) {
    localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(obj));
  }

  // ---------- Normal Invoice Page Logic ----------
  function initNormalInvoicePage() {
    if (!document.querySelector('.page')) return; // not the invoice page
    const senderEl = $('sender');
    const clientEl = $('client');
    const itemRows = document.getElementById('itemRows');
    const subtotalVal = $('subtotalVal');
    const taxVal = $('taxVal');
    const finalTotal = $('finalTotal');

    // Ensure there is at least one row
    function ensureRow() {
      if (!itemRows.querySelector('tr')) {
        addNormalRow();
      }
      recalc();
    }

    function addNormalRow() {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="text" class="itemName"></td>
        <td><input type="number" value="1" class="itemQty" min="0"></td>
        <td><input type="number" value="0" class="itemPrice" min="0" step="0.01"></td>
        <td class="rowTotal">0</td>`;
      itemRows.appendChild(tr);
      attachNormalInputs(tr);
    }

    function attachNormalInputs(tr) {
      const qty = tr.querySelector('.itemQty');
      const price = tr.querySelector('.itemPrice');
      const name = tr.querySelector('.itemName');
      [qty, price, name].forEach(inp => {
        inp.addEventListener('input', () => recalc());
      });
    }

    function recalc() {
      let subtotal = 0;
      itemRows.querySelectorAll('tr').forEach(tr => {
        const qVal = Number(tr.querySelector('.itemQty').value || 0);
        const pVal = Number(tr.querySelector('.itemPrice').value || 0);
        // step-wise arithmetic:
        const rowTotal = Math.round((qVal * pVal + Number.EPSILON) * 100) / 100;
        tr.querySelector('.rowTotal').innerText = rowTotal.toFixed(2);
        subtotal += rowTotal;
      });
      subtotalVal.innerText = subtotal.toFixed(2);
      const tax = Number(taxVal.value || 0);
      const total = Math.round((subtotal + tax + Number.EPSILON) * 100) / 100;
      finalTotal.innerText = total.toFixed(2);
    }

    // hook up existing buttons
    // Add row button may be present inline with page; fallback to find any .btn.small that has + Add Item text
    const addBtns = qa('button').filter(b => /add item/i.test(b.innerText) || b.id === 'addItemBtn');
    addBtns.forEach(b => b.addEventListener('click', addNormalRow));

    // If page has generateNormalPDF function event inline, it's handled in HTML script; but we wire fetch to /api/createInvoice when clicking .btn that contains 'Generate PDF'
    qa('button').forEach(btn => {
      if (/generate pdf/i.test(btn.innerText)) {
        btn.addEventListener('click', async () => {
          // package payload
          const payload = {
            sender: senderEl?.value || '',
            client: clientEl?.value || '',
            items: [],
            tax: Number(taxVal?.value || 0),
            createdAt: new Date().toISOString()
          };
          itemRows.querySelectorAll('tr').forEach(tr => {
            payload.items.push({
              name: tr.querySelector('.itemName').value || '',
              qty: Number(tr.querySelector('.itemQty').value || 0),
              price: Number(tr.querySelector('.itemPrice').value || 0)
            });
          });

          // call server
          try {
            btn.disabled = true;
            btn.innerText = 'Generating...';
            const res = await fetch('/api/createInvoice', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('PDF generation failed');
            const blob = await res.blob();
            downloadBlob(blob, `invoice-${Date.now()}.pdf`);
          } catch (err) {
            console.error(err);
            toast('Could not generate PDF — try again.');
          } finally {
            btn.disabled = false;
            btn.innerText = 'Generate PDF';
          }
        });
      }
    });

    // initialize
    ensureRow();
    recalc();
  }

  // ---------- Crypto Invoice Page Logic ----------
  function initCryptoInvoicePage() {
    // detect crypto page by id presence
    const cryptoSelect = $('cryptoSelect');
    if (!cryptoSelect) return;

    const senderEl = $('sender');
    const clientEl = $('client');
    const itemRows = document.getElementById('itemRows');
    const subtotalVal = $('subtotalVal');
    const taxVal = $('taxVal');
    const finalTotal = $('finalTotal');
    const walletAddress = $('walletAddress');
    const cryptoPriceEl = $('cryptoPrice');
    const cryptoTotalEl = $('cryptoTotal');
    const qrArea = $('qrCode') || $('qrArea');

    function addCryptoRow() {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="text" class="itemName"></td>
        <td><input type="number" value="1" class="itemQty" min="0"></td>
        <td><input type="number" value="0" class="itemPrice" min="0" step="0.01"></td>
        <td class="rowTotal">0</td>`;
      itemRows.appendChild(tr);
      attachCryptoInputs(tr);
    }

    function attachCryptoInputs(tr) {
      const qty = tr.querySelector('.itemQty');
      const price = tr.querySelector('.itemPrice');
      const name = tr.querySelector('.itemName');
      [qty, price, name].forEach(inp => inp.addEventListener('input', recalcCrypto));
    }

    function recalcCrypto() {
      let subtotal = 0;
      itemRows.querySelectorAll('tr').forEach(tr => {
        const qVal = Number(tr.querySelector('.itemQty').value || 0);
        const pVal = Number(tr.querySelector('.itemPrice').value || 0);
        const rowTotal = Math.round((qVal * pVal + Number.EPSILON) * 100) / 100;
        tr.querySelector('.rowTotal').innerText = rowTotal.toFixed(2);
        subtotal += rowTotal;
      });
      subtotalVal.innerText = subtotal.toFixed(2);
      const tax = Number(taxVal.value || 0);
      const usdTotal = Math.round((subtotal + tax + Number.EPSILON) * 100) / 100;
      finalTotal.innerText = usdTotal.toFixed(2);
      convertToCrypto(usdTotal);
    }

    async function convertToCrypto(usdTotal) {
      const coin = (cryptoSelect.value || 'BTC').toUpperCase();
      // choose price from latestPrices if available
      let price = 0;
      if (coin === 'BTC' && latestPrices.btc) price = latestPrices.btc;
      else if (coin === 'ETH' && latestPrices.eth) price = latestPrices.eth;
      else if (coin === 'USDT' && latestPrices.usdt) price = latestPrices.usdt || 1;

      // fallback: try server endpoint
      if (!price) {
        try {
          const r = await fetch('/api/getCryptoPrice');
          if (r.ok) {
            const j = await r.json();
            if (coin === 'BTC') price = j.btc;
            else if (coin === 'ETH') price = j.eth;
            else price = j.usdt || 1;
          }
        } catch (e) { /* ignore */ }
      }

      // final fallback to direct CoinGecko
      if (!price) {
        const cg = await fetchPricesFromCoinGecko();
        price = coin === 'BTC' ? cg.btc : coin === 'ETH' ? cg.eth : cg.usdt || 1;
      }

      cryptoPriceEl.innerText = price ? `$${currencyFormat(price,2)}` : 'N/A';

      const cryptoAmt = price ? Math.round(((usdTotal / price) + Number.EPSILON) * 1e8) / 1e8 : 0;
      cryptoTotalEl.innerText = cryptoAmt.toFixed(8);

      // update QR
      updateQR(cryptoAmt);
    }

    function updateQR(amount) {
      const coin = (cryptoSelect.value || 'BTC').toUpperCase();
      const addr = (walletAddress?.value || '') .trim();
      if (!addr) {
        if (qrArea) qrArea.innerHTML = `<div class="small muted">Add wallet address in Profile to show QR</div>`;
        return;
      }
      const uri = `${coin.toLowerCase()}:${addr}?amount=${amount}`;
      // If qrcode lib present:
      const container = document.getElementById('qrCode') || document.getElementById('qrArea');
      if (!container) return;
      container.innerHTML = '';
      if (window.QRCode) {
        new QRCode(container, { text: uri, width: 140, height: 140, colorDark: "#00e0d1", colorLight: "#071229" });
      } else {
        // Google chart fallback
        const src = `https://chart.googleapis.com/chart?cht=qr&chs=200x200&chl=${encodeURIComponent(uri)}`;
        container.innerHTML = `<img src="${src}" alt="QR" style="width:140px;height:140px;border-radius:8px"/>`;
      }
    }

    // wire add button(s)
    qa('button').forEach(b => {
      if (/add item/i.test(b.innerText) || b.id === 'addItemBtn') b.addEventListener('click', addCryptoRow);
      if (/generate crypto pdf/i.test(b.innerText) || /generate pdf/i.test(b.innerText) && b.closest('.page')) {
        b.addEventListener('click', async () => {
          // build payload
          const payload = {
            sender: senderEl?.value || '',
            client: clientEl?.value || '',
            wallet: walletAddress?.value || '',
            crypto: cryptoSelect?.value || 'BTC',
            price: (latestPrices[cryptoSelect?.value?.toLowerCase?.()] || 0), // may be undefined
            usdTotal: Number(finalTotal?.innerText || 0),
            items: []
          };
          itemRows.querySelectorAll('tr').forEach(tr => {
            payload.items.push({
              name: tr.querySelector('.itemName').value || '',
              qty: Number(tr.querySelector('.itemQty').value || 0),
              price: Number(tr.querySelector('.itemPrice').value || 0)
            });
          });

          try {
            b.disabled = true; b.innerText = 'Generating...';
            const res = await fetch('/api/createCryptoInvoice', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('Crypto PDF generation failed');
            const blob = await res.blob();
            downloadBlob(blob, `crypto-invoice-${Date.now()}.pdf`);
          } catch (err) {
            console.error(err);
            toast('Could not generate crypto PDF — try again.');
          } finally {
            b.disabled = false; b.innerText = 'Generate Crypto PDF';
          }
        });
      }
    });

    // initial row(s) + listeners
    if (!itemRows.querySelector('tr')) addCryptoRow();
    recalcCrypto();

    // when wallet or coin changes, recalc
    cryptoSelect?.addEventListener('change', () => {
      recalcCrypto();
    });
    walletAddress?.addEventListener('input', () => {
      recalcCrypto();
    });
  }

  // ---------- Dashboard Page ----------
  function initDashboardPage() {
    const listBody = $('listBody');
    if (!listBody) return;
    function renderList() {
      const arr = loadInvoices();
      $('totalInvoices').innerText = arr.length;
      const paid = arr.filter(i=>i.status==='Paid').length;
      $('paidInvoices').innerText = paid;
      $('unpaidInvoices').innerText = arr.length - paid;

      listBody.innerHTML = '';
      arr.forEach((inv, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${inv.id||('INV-'+(idx+1))}</td>
                        <td>${inv.clientName||inv.client||'—'}</td>
                        <td>${inv.total?inv.total+' '+(inv.fiat||'USD') : (inv.usdTotal||'—')}</td>
                        <td>${inv.crypto||inv.cryptoSymbol||'—'}</td>
                        <td>${inv.status||'Unpaid'}</td>
                        <td>
                          <button class="view" data-i="${idx}">View</button>
                          <button class="mark" data-i="${idx}">Mark Paid</button>
                        </td>`;
        listBody.appendChild(tr);
      });

      qa('.view').forEach(btn => btn.addEventListener('click', e => {
        const idx = Number(e.target.dataset.i);
        const arr = loadInvoices();
        const inv = arr[idx];
        toast(JSON.stringify(inv, null, 2));
      }));
      qa('.mark').forEach(btn => btn.addEventListener('click', e => {
        const idx = Number(e.target.dataset.i);
        const arr = loadInvoices();
        arr[idx].status = 'Paid';
        saveInvoices(arr);
        renderList();
      }));
    }
    renderList();
  }

  // ---------- Profile Page ----------
  function initProfilePage() {
    if (!$('saveProfile')) return;
    const profile = loadProfile();
    $('profileBusiness').value = profile.business || '';
    $('profileWallet').value = profile.wallet || '';
    $('profilePreview').innerText = JSON.stringify(profile, null, 2);

    $('saveProfile').addEventListener('click', () => {
      const obj = { business: $('profileBusiness').value || '', wallet: $('profileWallet').value || '' };
      saveProfile(obj);
      localStorage.setItem('cip_wallet', obj.wallet || '');
      $('profilePreview').innerText = JSON.stringify(obj, null, 2);
      toast('Profile saved locally');
    });
  }

  // ---------- Common small UI tasks ----------
  function wireLogo() {
    // Ensure logo path works: try alternatives if missing
    const logoEl = document.querySelector('.logo');
    if (!logoEl) return;
    const tryPaths = ['/assets/logo.png','/assets/logos/logo.png','/logo.png','assets/logo.png'];
    (async function findWorking(){
      for (const p of tryPaths) {
        try {
          const r = await fetch(p, { method: 'HEAD' });
          if (r.ok) { logoEl.src = p; return; }
        } catch (e) { /* ignore */ }
      }
      // fallback to data URI simple placeholder
      logoEl.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect rx='12' width='100%' height='100%' fill='#071229'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='#00e0d1' font-size='14'>CI</text></svg>`);
    })();
  }

  // ---------- Init all pages ----------
  document.addEventListener('DOMContentLoaded', () => {
    wireLogo();
    initNormalInvoicePage();
    initCryptoInvoicePage();
    initDashboardPage();
    initProfilePage();
    updatePriceUI();
  });

  // Expose for debugging
  window.CryptoInvoice = {
    refreshPrices, latestPrices, loadInvoices, saveInvoices
  };
})();
