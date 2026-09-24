/* ---------------------------------------------------------------------
   invoices.js — sales invoices generated when a booking is confirmed.
   Line items show package + guest name per line; each unit price carries
   its own currency code inline when it was sold in something other than
   the ledger's base currency, so there's no separate Currency column.
   Layout (title, accent color, which optional lines show, a footer note)
   comes from Store.settings.invoiceTemplate — see settings.js "Invoice
   template" tab.
--------------------------------------------------------------------- */

(function(){

  // Sales invoices use a split view: every invoice on the left, the selected
  // one's full detail on the right — so browsing invoices never leaves the
  // list. /invoices and /invoices/:id both render this same screen; picking
  // a row just re-navigates to /invoices/:id, which re-renders with that
  // row highlighted and its detail on the right.
  function render(params){
    const rows = Store.all('salesInvoices').slice().sort((a,b)=>b.date.localeCompare(a.date));
    const selectedId = params.id || (rows[0] && rows[0].id) || null;
    const selected = selectedId ? Store.find('salesInvoices', selectedId) : null;
    setPageTitle(selected ? selected.invoiceNo : 'Sales invoices', 'Bookings');
    renderNav();
    qs('#content').innerHTML = `
      <div class="split-view">
        <div class="split-list" id="inv-list">
          ${rows.length ? rows.map(inv=>listRowHtml(inv, inv.id===selectedId)).join('')
            : `<div class="split-list-empty">No sales invoices yet — confirm a booking to generate one.</div>`}
        </div>
        <div class="split-detail" id="inv-detail">${selected ? detailHtml(selected) : emptyDetailHtml()}</div>
      </div>
    `;
    qsa('[data-view]', qs('#inv-list')).forEach(r=>r.addEventListener('click', ()=>Router.navigate('invoices/'+r.dataset.view)));
    if(selected){
      if(qs('#inv-print')) qs('#inv-print').addEventListener('click', ()=>window.print());
      if(qs('[data-bill-to-edit]') && !Auth.isViewOnly()) qs('[data-bill-to-edit]').addEventListener('click', ()=>startBillToEdit(selected));
      if(qs('#inv-collect-payment')) qs('#inv-collect-payment').addEventListener('click', ()=>{
        const booking = Store.find('bookings', selected.bookingId);
        if(!booking){ toast('The booking behind this invoice no longer exists.', 'err'); return; }
        BookingsModule.openCollectPaymentForm(booking, ()=>render({id: selected.id}));
      });
    }
  }

  function listRowHtml(inv, active){
    const currency = inv.currency || inv.baseCurrency || Pricing.baseCurrency();
    const totalDisplay = currency===Pricing.baseCurrency() ? inv.total : (inv.totalDisplay!=null ? inv.totalDisplay : inv.total);
    // A booking's guests each get their own invoice (see posting.js), so the
    // customer name alone can be ambiguous across a booking's invoices —
    // the guest name distinguishes them in the list.
    const sub = inv.guestName && inv.guestName!==inv.customerName ? `${esc(inv.customerName)} &middot; ${esc(inv.guestName)}` : esc(inv.customerName);
    return `<div class="split-list-row ${active?'active':''}" data-view="${inv.id}">
      <div class="sl-title">${esc(inv.invoiceNo)}</div>
      <div class="sl-sub">${sub} &middot; ${fmtDate(inv.date)}</div>
      <div class="sl-amt">${fmtCur(totalDisplay, currency)}</div>
    </div>`;
  }

  function emptyDetailHtml(){
    return `<div class="card empty-state"><h3>No invoice selected</h3><p class="muted">Pick an invoice from the list to view it.</p></div>`;
  }

  // A guest line's unit price already carries its own currency code inline
  // (e.g. "10.00 USD") when it differs from the ledger's base currency —
  // that's what makes a separate Currency column redundant.
  function unitPriceCell(l, baseCurrency){
    const amt = (l.unitPrice||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
    if(l.currency && l.currency!==baseCurrency) return `${amt} ${esc(l.currency)}`;
    return amt;
  }

  function detailHtml(inv){
    const s = Store.settings;
    const tpl = s.invoiceTemplate || {};
    const customer = Store.find('customers', inv.customerId);
    const billTo = inv.billTo || inv.customerName;
    const baseCurrency = inv.baseCurrency || Pricing.baseCurrency();
    // Foreign-currency bookings carry a face-value set (currency/xDisplay) in
    // addition to the base-ledger amounts — show that to match what the
    // guest/agent was actually quoted, falling back to the base amounts for
    // older invoices generated before this existed.
    const currency = inv.currency || baseCurrency;
    const isForeign = currency !== baseCurrency;
    const subTotal = isForeign && inv.subTotalDisplay!=null ? inv.subTotalDisplay : inv.subTotal;
    const tax = isForeign && inv.taxDisplay!=null ? inv.taxDisplay : inv.tax;
    const total = isForeign && inv.totalDisplay!=null ? inv.totalDisplay : inv.total;
    const booking = Store.find('bookings', inv.bookingId);
    const balInfo = booking ? BookingsModule.bookingBalanceInfo(booking) : null;
    // Sibling invoices: this booking may have generated one invoice per
    // distinct guest (see posting.js) — they all share the one AR posting
    // on the booking, so surface the others here for quick switching.
    const siblingIds = (booking && booking.salesInvoiceIds || []).filter(id=>id!==inv.id);
    const siblings = siblingIds.map(id=>Store.find('salesInvoices', id)).filter(Boolean);
    return `
      <div class="toolbar no-print"><div class="spacer"></div>
        ${balInfo && balInfo.balance>0.004 && !Auth.isViewOnly() ? `<button class="btn btn-primary" id="inv-collect-payment" style="margin-right:8px">Collect payment</button>` : ''}
        <button class="btn" id="inv-print">Print</button>
      </div>
      <div class="card" style="max-width:760px;margin:0 auto;border-top:3px solid ${esc(tpl.accentColor||'#0b5d56')}">
        <div class="flex-between mb-16">
          <div>
            ${tpl.showLogo!==false && s.logoDataUrl?`<img src="${s.logoDataUrl}" style="max-height:52px;max-width:200px;display:block;margin-bottom:8px">`:''}
            <h1>${esc(s.companyName||'')}</h1>
            ${tpl.showAddress!==false && s.companyAddress?`<div class="small muted" style="white-space:pre-line">${esc(s.companyAddress)}</div>`:''}
          </div>
          <div style="text-align:right">
            <h2 style="color:${esc(tpl.accentColor||'#0b5d56')}">${esc(tpl.title||'Sales Invoice')}</h2>
            <div class="small muted">${esc(inv.invoiceNo)}</div>
            <div class="small muted">${fmtDate(inv.date)}</div>
            <div class="small muted">Currency: ${esc(currency)}</div>
          </div>
        </div>
        <dl class="kv mb-16">
          <dt>Customer</dt><dd>${esc(inv.customerName)}${customer&&customer.type==='AGENT'?' <span class="badge badge-gray small">Agent</span>':''}</dd>
          ${inv.guestName ? `<dt>Guest</dt><dd>${esc(inv.guestName)}</dd>` : ''}
          ${tpl.showBillTo!==false ? `<dt>Bill to</dt><dd>${Auth.isViewOnly() ? esc(billTo||'—') : `<span class="price-editable" data-bill-to-edit title="Click to edit">${esc(billTo||'— click to set —')}</span>`}</dd>` : ''}
          ${tpl.showBookingLink!==false ? `<dt>Booking</dt><dd><a onclick="Router.navigate('bookings/${inv.bookingId}')">${esc(inv.bookingNo)}</a>${siblings.length?` &middot; also invoiced: ${siblings.map(s=>`<a onclick="Router.navigate('invoices/${s.id}')">${esc(s.guestName||s.invoiceNo)}</a>`).join(', ')}`:''}</dd>` : ''}
          ${balInfo ? `<dt>Booking balance due</dt><dd>${fmtCur(balInfo.balance, balInfo.currency)}</dd>` : ''}
        </dl>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Guest</th><th>Package</th><th class="num">Unit price</th><th class="num">Qty</th><th class="num">Amount (${esc(currency)})</th></tr></thead>
          <tbody>
          ${(inv.lines||[]).map(l=>`<tr><td>${esc(l.guestName)}</td><td>${esc(l.packageName)}</td>
            <td class="num">${unitPriceCell(l, baseCurrency)}</td>
            <td class="num">${l.qty||1}</td>
            <td class="num">${isForeign && l.netFace!=null ? l.netFace.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) : fmtMoney(l.amountBase)}</td></tr>`).join('')}
          <tr style="font-weight:600"><td colspan="4">Subtotal</td><td class="num">${fmtCur(subTotal, currency)}</td></tr>
          <tr><td colspan="4">Tax</td><td class="num">${fmtCur(tax, currency)}</td></tr>
          <tr style="font-weight:700;border-top:2px solid var(--line-strong)"><td colspan="4">Total</td><td class="num">${fmtCur(total, currency)}</td></tr>
          </tbody>
        </table></div>
        ${tpl.footerNote ? `<div class="small muted mt-16" style="text-align:center;white-space:pre-line">${esc(tpl.footerNote)}</div>` : ''}
      </div>
    `;
  }

  // Bill to is who/where the invoice is addressed — it can differ from the
  // Customer (the account the booking is on, e.g. an agent). Editing it here
  // only changes this invoice; it never touches the customer record.
  function startBillToEdit(inv){
    const el = qs('[data-bill-to-edit]');
    if(!el) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = inv.billTo || inv.customerName || '';
    input.className = 'price-inline-input';
    input.style.width = '220px';
    el.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const commit = ()=>{
      if(done) return; done = true;
      const val = input.value.trim();
      Store.update('salesInvoices', inv.id, { billTo: val });
      toast('Bill to updated', 'ok');
      render({id: inv.id});
    };
    const cancel = ()=>{ if(done) return; done = true; render({id: inv.id}); };
    input.addEventListener('keydown', (e)=>{
      if(e.key==='Enter'){ e.preventDefault(); commit(); }
      else if(e.key==='Escape'){ e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
  }

  Router.on('/invoices', render);
})();
