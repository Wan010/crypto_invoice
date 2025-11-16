// script.js — client-side core logic
(async () => {
  // Utilities
  function $(id){return document.getElementById(id)}
  function format(n){ return Number(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:8}) }

  // ----- Invoice create page logic -----
  if (document.getElementById('itemsBody')) {
    // initialize with one item
    let items = JSON.parse(localStorage.getItem('cip_items')||'[]')
    if (items.length===0) items = [{description:'Service', qty:1, price:0, subtotal:0}]

    function renderItems(){
      const tbody = $('itemsBody')
      tbody.innerHTML = ''
      items.forEach((it, idx) => {
        const tr = document.createElement('tr')
        tr.innerHTML = `<td><input class="desc" data-i="${idx}" value="${it.description}"></td>
                        <td><input class="qty" type="number" min="0" data-i="${idx}" value="${it.qty}"></td>
                        <td><input class="price" type="number" min="0" step="0.01" data-i="${idx}" value="${it.price}"></td>
                        <td class="sub">${format(it.subtotal)}</td>
                        <td><button class="del" data-i="${idx}">✕</button></td>`
        tbody.appendChild(tr)
      })
      attachItemListeners()
      recalc()
    }

    function attachItemListeners(){
      Array.from(document.querySelectorAll('.desc')).forEach(inp=>{
        inp.oninput = e => { items[+e.target.dataset.i].description = e.target.value; saveDraft() }
      })
      Array.from(document.querySelectorAll('.qty')).forEach(inp=>{
        inp.oninput = e => { items[+e.target.dataset.i].qty = Number(e.target.value||0); updateSubtotal(+e.target.dataset.i); saveDraft() }
      })
      Array.from(document.querySelectorAll('.price')).forEach(inp=>{
        inp.oninput = e => { items[+e.target.dataset.i].price = Number(e.target.value||0); updateSubtotal(+e.target.dataset.i); saveDraft() }
      })
      Array.from(document.querySelectorAll('.del')).forEach(btn=>{
        btn.onclick = e => { items.splice(+e.target.dataset.i,1); renderItems(); saveDraft() }
      })
    }

    function updateSubtotal(i){
      const it = items[i]
      // step-by-step arithmetic: qty * price
      const q = Number(it.qty||0)
      const p = Number(it.price||0)
      const s = q * p
      it.subtotal = Math.round((s + Number.EPSILON) * 100) / 100
      renderItems()
    }

    function recalc(){
      const subtotal = items.reduce((acc, it) => acc + (Number(it.subtotal)||0), 0)
      const taxPerc = Number($('tax').value||0)
      const discount = Number($('discount').value||0)
      const taxAmt = Math.round((subtotal * taxPerc / 100 + Number.EPSILON) * 100) / 100
      const total = Math.round((subtotal + taxAmt - discount + Number.EPSILON) * 100) / 100

      $('subtotalText').innerText = format(subtotal)
      $('taxText').innerText = format(taxAmt)
      $('discountText').innerText = format(discount)
      $('totalText').innerText = format(total)

      // update crypto conversion
      const cryptoSel = $('crypto').value
      $('cryptoLabel').innerText = $('crypto').selectedOptions[0].text
      // fetch price
      fetch(`/api/getCryptoPrice?coin=${cryptoSel}&vs=${$('fiat').value}`)
        .then(r=>r.json())
        .then(data=>{
          if (data && data.price) {
            const price = Number(data.price)
            // crypto amount = total / price
            const cryptoAmt = price>0 ? Math.round(((total/price) + Number.EPSILON) * 1e8) / 1e8 : 0
            $('cryptoAmount').innerText = format(cryptoAmt)
            // create QR (simple bitcoin: style for demonstration)
            const wallet = localStorage.getItem('cip_wallet') || ''
            const uri = wallet ? `${wallet}?amount=${cryptoAmt}` : ''
            if (uri) {
              // Use Google Chart QR generator (simple)
              const qrImg = `https://chart.googleapis.com/chart?cht=qr&chs=200x200&chl=${encodeURIComponent(uri)}`
              $('qrArea').innerHTML = `<img src="${qrImg}" alt="QR">`
            } else {
              $('qrArea').innerHTML = `<p class="muted">Add your wallet in Profile to show QR</p>`
            }
          } else {
            $('cryptoAmount').innerText = '—'
            $('qrArea').innerHTML = `<p class="muted">Price unavailable</p>`
          }
        }).catch(err=>{
          $('cryptoAmount').innerText = '—'
          $('qrArea').innerHTML = `<p class="muted">Price API error</p>`
        })
    }

    function saveDraft(){
      localStorage.setItem('cip_items', JSON.stringify(items))
    }

    $('addItemBtn').onclick = () => { items.push({description:'New Item', qty:1, price:0, subtotal:0}); renderItems(); saveDraft() }
    $('tax').oninput = recalc
    $('discount').oninput = recalc
    $('fiat').onchange = recalc
    $('crypto').onchange = recalc

    // Save invoice: package data and push to localStorage
    $('saveInvoice').onclick = () => {
      // build invoice object
      const inv = {
        id: 'INV-'+Date.now(),
        fromName: $('fromName').value||'',
        fromAddress: $('fromAddress').value||'',
        clientName: $('clientName').value||'',
        clientEmail: $('clientEmail').value||'',
        items: items,
        tax: Number($('tax').value||0),
        discount: Number($('discount').value||0),
        fiat: $('fiat').value,
        crypto: $('crypto').value,
        subtotal: Number($('subtotalText').innerText.replace(/,/g,''))||0,
        total: Number($('totalText').innerText.replace(/,/g,''))||0,
        cryptoAmount: $('cryptoAmount').innerText,
        createdAt: new Date().toISOString(),
        status: 'Unpaid'
      }
      const all = JSON.parse(localStorage.getItem('cip_invoices')||'[]')
      all.unshift(inv)
      localStorage.setItem('cip_invoices', JSON.stringify(all))
      alert('Invoice saved locally. You can view it in Dashboard.')
      // clear draft
      localStorage.removeItem('cip_items')
      items = [{description:'Service', qty:1, price:0, subtotal:0}]
      renderItems()
      recalc()
    }

    // download as PDF (client-side)
    $('downloadPdf').onclick = async () => {
      // capture a printable invoice layout — for simplicity we'll create a new window with invoice HTML
      const invHtml = createInvoiceHTML()
      const w = window.open('', '_blank', 'noopener')
      w.document.write(invHtml)
      w.document.close()
      // wait for load then call print (user can Save as PDF)
      setTimeout(()=> w.print(), 700)
    }

    function createInvoiceHTML(){
      const wn = $('fromName').value || ''
      const ca = $('clientName').value || ''
      const total = $('totalText').innerText || ''
      const itemsHtml = items.map(it=>`<tr><td>${it.description}</td><td>${it.qty}</td><td>${it.price}</td><td>${it.subtotal}</td></tr>`).join('')
      return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice</title>
        <style>body{font-family:Arial;padding:24px;color:#111}table{width:100%;border-collapse:collapse}td,th{padding:8px;border:1px solid #ddd}</style>
        </head><body>
        <h2>Invoice</h2><p><strong>From:</strong> ${wn}</p><p><strong>To:</strong> ${ca}</p>
        <table><thead><tr><th>Description</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr></thead><tbody>${itemsHtml}</tbody></table>
        <h3>Total: ${total}</h3></body></html>`
    }

    // share link (generates a temporary share id stored locally)
    $('shareLink').onclick = () => {
      const all = JSON.parse(localStorage.getItem('cip_invoices')||'[]')
      if (all.length===0) return alert('Save invoice first.')
      const top = all[0]
      const shareId = 'S' + Date.now().toString(36)
      top.shareId = shareId
      localStorage.setItem('cip_invoices', JSON.stringify(all))
      const link = `${location.origin}/invoice_view.html?id=${shareId}`
      // For now we just copy to clipboard
      navigator.clipboard?.writeText(link).then(()=> alert('Share link copied:\n'+link), ()=> alert('Share link: '+link))
    }

    // initial render
    renderItems()
    recalc()
  }

  // ----- Dashboard logic -----
  if (document.getElementById('listBody')) {
    function renderList(){
      const all = JSON.parse(localStorage.getItem('cip_invoices')||'[]')
      $('totalInvoices').innerText = all.length
      const paid = all.filter(i=>i.status==='Paid').length
      const unpaid = all.length - paid
      $('paidInvoices').innerText = paid
      $('unpaidInvoices').innerText = unpaid

      const tbody = $('listBody'); tbody.innerHTML = ''
      all.forEach((inv, idx) => {
        const tr = document.createElement('tr')
        tr.innerHTML = `<td>${inv.id}</td><td>${inv.clientName}</td><td>${inv.total} ${inv.fiat.toUpperCase()}</td>
                        <td>${inv.crypto}</td><td>${inv.status}</td>
                        <td>
                          <button class="view" data-i="${idx}">View</button>
                          <button class="mark" data-i="${idx}">Mark Paid</button>
                        </td>`
        tbody.appendChild(tr)
      })
      Array.from(document.querySelectorAll('.view')).forEach(b=>b.onclick=e=>{
        const inv = JSON.parse(localStorage.getItem('cip_invoices')||'[]')[+e.target.dataset.i]
        alert('Invoice: '+JSON.stringify(inv,null,2))
      })
      Array.from(document.querySelectorAll('.mark')).forEach(b=>b.onclick=e=>{
        const idx = +e.target.dataset.i
        const arr = JSON.parse(localStorage.getItem('cip_invoices')||'[]')
        arr[idx].status = 'Paid'
        localStorage.setItem('cip_invoices', JSON.stringify(arr))
        renderList()
      })
    }
    renderList()
  }

  // ----- Profile logic -----
  if ($('saveProfile')) {
    $('saveProfile').onclick = () => {
      const obj = {business: $('profileBusiness').value||'', wallet: $('profileWallet').value||''}
      localStorage.setItem('cip_profile', JSON.stringify(obj))
      $('profilePreview').innerText = JSON.stringify(obj, null, 2)
      localStorage.setItem('cip_wallet', obj.wallet || '')
      alert('Profile saved locally.')
    }
    const saved = JSON.parse(localStorage.getItem('cip_profile')||'null')
    if (saved) {
      $('profileBusiness').value = saved.business || ''
      $('profileWallet').value = saved.wallet || ''
      $('profilePreview').innerText = JSON.stringify(saved,null,2)
    }
  }
})();
