/* ---------------------------------------------------------------------
   bookings.js — booking list, editor and guest-line lifecycle.
   Every booking belongs to one customer (Direct Booking or an agent).
   Each guest line carries its own package, trip, price and status, so
   one guest can cancel without touching the rest of the booking.
--------------------------------------------------------------------- */

(function(){

  function render(params){
    setPageTitle('Bookings', 'Bookings');
    renderNav();
    Availability.sweepExpiredHolds();
    const q = (params.q||'').toLowerCase();
    let rows = Store.all('bookings').slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    if(q){
      rows = rows.filter(b=>{
        const cust = Store.find('customers', b.customerId);
        return b.bookingNo.toLowerCase().includes(q) || (cust && cust.name.toLowerCase().includes(q));
      });
    }
    const vo = Auth.isViewOnly();
    qs('#content').innerHTML = `
      <div class="toolbar">
        <input class="search-input" id="bk-search" type="text" placeholder="Search booking # or customer…" value="${esc(params.q||'')}">
        <div class="spacer"></div>
        ${vo?'':`<button class="btn btn-primary" id="bk-add">+ New booking</button>`}
      </div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Booking #</th><th>Customer</th><th>Guests</th><th>Status</th><th class="num">Total</th><th class="num">Balance</th><th>Created</th></tr></thead>
        <tbody>
        ${rows.length ? rows.map(rowHtml).join('') : `<tr><td colspan="7" class="table-empty">No bookings yet.</td></tr>`}
        </tbody>
      </table></div>
    `;
    qs('#bk-search').addEventListener('input', debounce(e=>Router.navigate('bookings?q='+encodeURIComponent(e.target.value))));
    if(qs('#bk-add')) qs('#bk-add').addEventListener('click', ()=>openNewBookingFlow());
    qsa('[data-view]').forEach(r=>r.addEventListener('click', ()=>Router.navigate('bookings/'+r.dataset.view)));
  }

  function rowHtml(b){
    const cust = Store.find('customers', b.customerId);
    const currency = b.currency || Pricing.baseCurrency();
    const dTotal = bookingDisplayTotal(b);
    const dPaid = currency===Pricing.baseCurrency() ? Store.where('receipts', r=>r.bookingId===b.id).reduce((s,r)=>s+(r.amount||0),0) : bookingDisplayPaid(b);
    const dBal = Ledger.round2(dTotal - dPaid);
    return `<tr style="cursor:pointer" data-view="${b.id}">
      <td><strong>${esc(b.bookingNo)}</strong></td>
      <td>${esc(cust?cust.name:'—')} ${cust&&cust.type==='DIRECT'?'<span class="badge badge-gray">Direct</span>':''}</td>
      <td>${(b.guestLines||[]).length}</td>
      <td>${bookingStatusBadge(b)}</td>
      <td class="num">${fmtCur(dTotal, currency)}</td>
      <td class="num">${fmtCur(dBal, currency)}</td>
      <td>${fmtDate(b.createdAt.slice(0,10))}</td>
    </tr>`;
  }

  function balanceDue(b){
    const receipts = Store.where('receipts', r=>r.bookingId===b.id).reduce((s,r)=>s+r.amount,0);
    return Ledger.round2((b.invoiceTotal||0) - receipts);
  }

  // Total/Balance due are shown in the booking's own currency, not always
  // the base ledger currency: every guest line already carries its unitPrice
  // frozen in that currency at add-time, so summing those (plus tax) gives
  // the face-value total the guest actually sees, without a re-conversion.
  // For a base-currency booking this is just the ledger's invoiceTotal.
  function bookingDisplayTotal(b){
    const currency = b.currency || Pricing.baseCurrency();
    if(currency===Pricing.baseCurrency()) return b.invoiceTotal||0;
    const lines = (b.guestLines||[]).filter(gl=>!['CANCELLED','EXPIRED'].includes(gl.status));
    return Ledger.round2(lines.reduce((s,gl)=>{
      const pkg = Store.find('packages', gl.packageId);
      const net = Ledger.round2((gl.unitPrice||0)*(gl.qty||1));
      return s + Ledger.round2(net*(1+Posting.taxRateFor(pkg)));
    }, 0));
  }
  function bookingDisplayPaid(b){
    return Ledger.round2(Store.where('receipts', r=>r.bookingId===b.id).reduce((s,r)=>s+(r.amount||0),0));
  }
  // fmtCur(n, currency) is defined globally in lib/util.js — reused as-is here.

  // Single source of truth for "how much is owed on this booking, in what
  // currency" — used by the booking detail page, the bookings list, and the
  // linked sales invoice (which reaches this via BookingsModule rather than
  // recomputing it).
  function bookingBalanceInfo(b){
    const currency = b.currency || Pricing.baseCurrency();
    const total = bookingDisplayTotal(b);
    const paid = currency===Pricing.baseCurrency()
      ? Store.where('receipts', r=>r.bookingId===b.id).reduce((s,r)=>s+(r.amount||0),0)
      : bookingDisplayPaid(b);
    const balance = Ledger.round2(total - paid);
    return { currency, total, paid, balance };
  }

  function bookingStatusBadge(b){
    const lines = b.guestLines||[];
    const map = { OPEN:'badge-gray', CONFIRMED:'badge-teal', COMPLETED:'badge-green', CANCELLED:'badge-red' };
    return `<span class="badge ${map[b.status]||'badge-gray'}">${esc(b.status)}</span>`;
  }

  function lineStatusBadge(s){
    const map = { HOLD:'badge-amber', CONFIRMED:'badge-teal', CHECKED_IN:'badge-sand', COMPLETED:'badge-green', CANCELLED:'badge-red', NO_SHOW:'badge-red', EXPIRED:'badge-gray' };
    return `<span class="badge ${map[s]||'badge-gray'}">${esc((s||'').replace('_',' '))}</span>`;
  }

  function newBookingNo(){ return Store.docNo('BK', 'booking'); }

  function openNewBookingFlow(){
    const customers = Store.all('customers').filter(c=>c.active!==false);
    const base = Pricing.baseCurrency();
    openModal({
      title:'New booking',
      bodyHtml: `
        <div class="field"><label>Customer</label>
          <select id="nb-customer">
            ${customers.map(c=>`<option value="${c.id}" ${c.type==='DIRECT'?'selected':''}>${esc(c.name)}${c.type==='DIRECT'?' (walk-in / direct guests)':''}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Booking currency</label>
          <select id="nb-currency">${['MVR','USD','EUR'].map(c=>`<option value="${c}" ${c===base?'selected':''}>${c}</option>`).join('')}</select>
          <div class="hint">Every guest on this booking is priced off the price list in this currency. Choose it once — it can't be changed after guests are added.</div>
        </div>
        <p class="hint">You'll add guests and pick their trip and package on the next screen.</p>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="nb-go">Continue</button>`,
      onMount(modal){
        qs('#nb-go', modal).addEventListener('click', ()=>{
          const customerId = qs('#nb-customer', modal).value;
          const currency = qs('#nb-currency', modal).value;
          const b = Store.insert('bookings', { bookingNo: newBookingNo(), customerId, currency, status:'OPEN', guestLines: [] });
          closeModal(); Router.navigate('bookings/'+b.id);
        });
      }
    });
  }

  function detail(params){
    const b = Store.find('bookings', params.id);
    if(!b){ Router.navigate('bookings'); return; }
    setPageTitle(b.bookingNo, 'Bookings');
    renderNav();
    Availability.sweepExpiredHolds();
    const cust = Store.find('customers', b.customerId);
    const receipts = Store.where('receipts', r=>r.bookingId===b.id).sort((a,b2)=>b2.date.localeCompare(a.date));
    const paid = receipts.reduce((s,r)=>s+r.amount,0);
    const bal = Ledger.round2((b.invoiceTotal||0)-paid);
    const bCurrency = b.currency || Pricing.baseCurrency();
    const dTotal = bookingDisplayTotal(b);
    const dPaid = bCurrency===Pricing.baseCurrency() ? paid : bookingDisplayPaid(b);
    const dBal = Ledger.round2(dTotal - dPaid);
    const anyHold = (b.guestLines||[]).some(gl=>gl.status==='HOLD');
    const allInactiveOrDone = (b.guestLines||[]).length>0 && (b.guestLines||[]).every(gl=>['COMPLETED','CANCELLED','NO_SHOW','EXPIRED'].includes(gl.status));

    // A booking can generate more than one printable invoice — one per
    // distinct guest name on it (see Posting.generateSalesInvoice) — even
    // though they all post to the same underlying AR journal entry. Show
    // each as its own button, labelled by guest once there's more than one.
    const invoiceIds = b.salesInvoiceIds || [];
    const invoiceBtns = invoiceIds.map(id=>{
      const inv = Store.find('salesInvoices', id);
      if(!inv) return '';
      const label = invoiceIds.length>1 ? `Invoice — ${esc(inv.guestName||'—')}` : 'View invoice';
      return `<button class="btn" onclick="Router.navigate('invoices/${id}')" style="margin-left:8px">${label}</button>`;
    }).join('');
    // Once a booking has been invoiced, no more guests can be added to it —
    // a new guest arriving after that point needs a booking of their own,
    // rather than silently riding along on a booking whose invoice has
    // already been cut.
    const canAddGuest = !b.locked && !b.invoiceJournalId && b.status!=='CANCELLED' && !Auth.isViewOnly();
    const addGuestBlockedByInvoice = !b.locked && b.invoiceJournalId && b.status!=='CANCELLED' && !Auth.isViewOnly();

    qs('#content').innerHTML = `
      <div class="toolbar"><button class="btn" onclick="Router.navigate('bookings')">&larr; All bookings</button><div class="spacer"></div>
        ${invoiceBtns}
        ${canAddGuest ? `<button class="btn btn-primary" id="bk-add-guest" style="margin-left:8px">+ Add guest</button>`:''}
      </div>
      ${addGuestBlockedByInvoice ? `<div class="hint mb-16">This booking has already been invoiced, so no more guests can be added to it — start a new booking for anyone else.</div>` : ''}
      <div class="grid grid-4 mb-16">
        <div class="stat"><div class="label">Customer</div><div class="value" style="font-size:16px">${esc(cust?cust.name:'—')}</div><div class="sub">${cust&&cust.type==='AGENT'?'Agent — posts to their account':'Direct — settled at the counter'}</div></div>
        <div class="stat"><div class="label">Status</div><div class="value" style="font-size:16px">${bookingStatusBadge(b)}</div></div>
        <div class="stat"><div class="label">Currency</div><div class="value" style="font-size:16px">${esc(b.currency||Pricing.baseCurrency())}</div></div>
        <div class="stat"><div class="label">Total</div><div class="value">${fmtCur(dTotal, bCurrency)}</div></div>
        <div class="stat"><div class="label">Balance due</div><div class="value">${fmtCur(dBal, bCurrency)}</div></div>
      </div>

      ${anyHold && !Auth.isViewOnly() ? `<div class="warn-box mb-16">This booking has guests still on hold — nothing posts to the ledger until each guest is settled. <button class="btn btn-sm btn-sand" id="bk-settle-all" style="margin-left:8px">Settle all guests</button></div>` : ''}

      <div class="card">
        <div class="card-head"><h2>Guests</h2></div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Guest</th><th>Package</th><th>Trip</th><th>Own gear</th><th class="num">Qty</th><th class="num">Price</th><th>Status</th><th></th></tr></thead>
          <tbody>
          ${(b.guestLines||[]).length ? b.guestLines.map(gl=>guestLineRow(b, gl)).join('') : `<tr><td colspan="8" class="table-empty">No guests added yet.</td></tr>`}
          </tbody>
        </table></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Payments</h2>${!Auth.isViewOnly() && b.invoiceJournalId && dBal>0.004 ? `<button class="btn btn-sm btn-primary" id="bk-collect-payment">Collect payment</button>` : ''}</div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Receipt #</th><th>Date</th><th>Method</th><th class="num">Amount</th></tr></thead>
          <tbody>
          ${receipts.length ? receipts.map(r=>`<tr><td>${esc(r.receiptNo)}</td><td>${fmtDate(r.date)}</td><td>${esc(r.method==='PENDING'?'Pending (credit)':CashModule.methodLabel(r.method))}</td><td class="num">${fmtCur(r.amount, r.currency)}</td></tr>`).join('')
            : `<tr><td colspan="4" class="table-empty">No payments recorded yet. Guests are settled one by one (or all at once) from the Guests table above.</td></tr>`}
          </tbody>
        </table></div>
        ${!receipts.length && b.invoiceJournalId && dBal>0.004 ? `<p class="hint mt-8">This booking was confirmed on credit (Pending) — use "Collect payment" above once the guest or agent pays.</p>` : ''}
      </div>
    `;

    if(qs('#bk-add-guest')) qs('#bk-add-guest').addEventListener('click', ()=>openAddGuestLine(b));
    if(qs('#bk-collect-payment')) qs('#bk-collect-payment').addEventListener('click', ()=>openCollectPaymentForm(b));
    if(qs('#bk-settle-all')) qs('#bk-settle-all').addEventListener('click', ()=>openSettleForm(b, null));
    qsa('[data-gl-action]').forEach(btn=>btn.addEventListener('click', ()=>handleLineAction(b, btn.dataset.glAction, btn.dataset.glId)));
    qsa('[data-gl-price]').forEach(el=>el.addEventListener('click', ()=>startInlinePriceEdit(b, el)));
    qsa('[data-gl-qty]').forEach(inp=>inp.addEventListener('change', ()=>commitQtyEdit(b, inp)));
  }

  // Line-level Qty is a pure billing multiplier (dives per line — e.g. a DSD
  // guest doing 2 dives on one trip) plus, for gear types flagged "consumed
  // per dive", a multiplier on how much house gear that line needs. It never
  // changes how many seats/waivers/check-ins the line counts as.
  function guestLineRow(b, gl){
    const guest = Store.find('guests', gl.guestId);
    const pkg = Store.find('packages', gl.packageId);
    const trip = Store.find('trips', gl.tripId);
    const boat = trip ? Store.find('boats', trip.boatId) : null;
    const ownGear = (gl.ownGearTypeIds||[]).map(id=>{ const t=Store.find('equipmentTypes', id); return t?t.name:''; }).filter(Boolean);
    const active = Availability.isLineActive(gl);
    // Price & qty can be hand-edited while a line is still on HOLD (not yet
    // settled). Once it's settled/confirmed, only an accountant or admin can
    // still change the rate (item 5) — front desk is locked out from there on.
    const terminal = ['COMPLETED','CANCELLED','NO_SHOW','EXPIRED'].includes(gl.status);
    const rateLocked = gl.status!=='HOLD' && !Auth.can('EDIT_CONFIRMED_RATE');
    const canEditLine = active && !Auth.isViewOnly() && !terminal && !rateLocked;
    const actions = [];
    if(active && !Auth.isViewOnly()){
      if(gl.status==='HOLD') actions.push(`<button class="btn btn-sm btn-primary" data-gl-action="settle" data-gl-id="${gl.id}">Settle</button>`);
      if(gl.status==='CONFIRMED') actions.push(`<button class="btn btn-sm" data-gl-action="checkin" data-gl-id="${gl.id}">Check in</button>`);
      if(gl.status==='CHECKED_IN' && !(gl.equipmentIssued&&gl.equipmentIssued.length)) actions.push(`<button class="btn btn-sm" data-gl-action="issue" data-gl-id="${gl.id}">Issue gear</button>`);
      if(gl.status==='CHECKED_IN' && gl.equipmentIssued&&gl.equipmentIssued.length) actions.push(`<button class="btn btn-sm" data-gl-action="return" data-gl-id="${gl.id}">Return gear</button>`);
      if(gl.status==='CHECKED_IN') actions.push(`<button class="btn btn-sm btn-sand" data-gl-action="complete" data-gl-id="${gl.id}">Complete</button>`);
      if(['HOLD','CONFIRMED'].includes(gl.status)) actions.push(`<button class="btn btn-sm btn-ghost" data-gl-action="reschedule" data-gl-id="${gl.id}">Reschedule</button>`);
      if(!['COMPLETED'].includes(gl.status)) actions.push(`<button class="btn btn-sm btn-ghost" data-gl-action="cancel" data-gl-id="${gl.id}">Cancel</button>`);
      if(gl.status==='CHECKED_IN') actions.push(`<button class="btn btn-sm btn-ghost" data-gl-action="noshow" data-gl-id="${gl.id}">No-show</button>`);
    }
    return `<tr>
      <td>${esc(guest?guest.name:'—')}</td>
      <td>${esc(pkg?pkg.name:'—')}</td>
      <td>${trip?`${fmtDate(trip.tripDate)} ${trip.startTime||''} · ${esc(boat?boat.name:'')}`:'—'}</td>
      <td>${ownGear.length?esc(ownGear.join(', ')):'<span class="muted">None</span>'}</td>
      <td class="num">${canEditLine ? `<input type="number" class="qty-inline" data-gl-qty="${gl.id}" min="1" step="1" value="${gl.qty||1}" style="width:56px;text-align:right">` : (gl.qty||1)}</td>
      <td class="num">${canEditLine ? `<span class="price-editable" data-gl-price="${gl.id}" title="Click to edit price">${fmtGuestPrice(gl)}</span>` : fmtGuestPrice(gl)}${gl.priceOverridden?' <span class="badge badge-amber small">Overridden</span>':''}</td>
      <td>${lineStatusBadge(active?gl.status:'EXPIRED')}${gl.status==='HOLD'&&gl.holdExpiresAt?`<div class="small muted">Holds till ${fmtDateTime(gl.holdExpiresAt)}</div>`:''}</td>
      <td class="row-actions">${actions.join('')}</td>
    </tr>`;
  }

  function fmtGuestPrice(gl){
    const unit = gl.unitPrice||0;
    const qty = gl.qty||1;
    const isForeign = gl.currency && gl.currency!==Pricing.baseCurrency();
    const fmt = (n)=> isForeign ? n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})+' '+gl.currency : fmtMoney(n);
    if(qty>1) return `${fmt(unit)} &times; ${qty} = <strong>${fmt(Ledger.round2(unit*qty))}</strong>`;
    return fmt(unit);
  }

  // Click-to-edit: swaps the price display for a number input right in the
  // row, commits on blur/Enter, discards on Escape. Never touches the price
  // list or agent special prices — only this one guest line's charge.
  function startInlinePriceEdit(b, el){
    const glId = el.dataset.glPrice;
    const gl = (b.guestLines||[]).find(l=>l.id===glId);
    if(!gl) return;
    const input = document.createElement('input');
    input.type = 'number'; input.step = '0.01'; input.min = '0';
    input.value = gl.unitPrice||0;
    input.className = 'price-inline-input';
    input.style.width = '110px';
    el.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const commit = ()=>{
      if(done) return; done = true;
      const amt = parseFloat(input.value);
      if(isNaN(amt) || amt<0){ toast('Enter a valid price.', 'err'); detail({id:b.id}); return; }
      commitPriceEdit(b, gl, amt);
    };
    const cancel = ()=>{ if(done) return; done = true; detail({id:b.id}); };
    input.addEventListener('keydown', (e)=>{
      if(e.key==='Enter'){ e.preventDefault(); commit(); }
      else if(e.key==='Escape'){ e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
  }

  function commitPriceEdit(b, gl, amt){
    const resolved = Pricing.resolvePrice(b.customerId, gl.packageId);
    const isBase = !gl.currency || gl.currency===Pricing.baseCurrency();
    const listAmount = resolved ? (isBase ? resolved.amounts.MVR : resolved.amounts[gl.currency]) : null;
    const trip = Store.find('trips', gl.tripId);
    const conv = isBase ? { amountBase: amt, rate:1 } : Pricing.toBase(amt, gl.currency, trip?trip.tripDate:todayISO());
    if(gl.resolvedUnitPrice===undefined && listAmount!=null) gl.resolvedUnitPrice = listAmount;
    gl.unitPrice = amt;
    gl.unitPriceBase = conv.amountBase;
    gl.fxRate = conv.rate;
    gl.priceOverridden = listAmount==null || amt!==listAmount;
    saveBookingLines(b);
    toast('Price updated for this guest', 'ok');
    detail({id:b.id});
  }

  function commitQtyEdit(b, inp){
    const gl = (b.guestLines||[]).find(l=>l.id===inp.dataset.glQty);
    if(!gl) return;
    let q = parseInt(inp.value);
    if(isNaN(q) || q<1) q = 1;
    if(q===(gl.qty||1)) return;
    // Re-run the availability gear gate with the new qty — gear types flagged
    // "consumed per dive" need more stock for more dives; seats/ratio/cert
    // are unaffected since qty never counts as extra guests.
    const result = Availability.checkTrip({ tripId: gl.tripId, packageId: gl.packageId, ownGearTypeIds: gl.ownGearTypeIds, guestId: gl.guestId, excludeGuestLineId: gl.id, qty: q });
    const gearGate = result.gates.find(g=>g.key==='gear');
    if(gearGate && !gearGate.ok){
      toast('Not enough gear in stock for that many dives — '+gearGate.detail, 'err');
      detail({id:b.id});
      return;
    }
    gl.qty = q;
    saveBookingLines(b);
    toast('Quantity updated', 'ok');
    detail({id:b.id});
  }

  function saveBookingLines(b){ Store.update('bookings', b.id, { guestLines: b.guestLines }); }

  // Booking status is never set by hand — it's derived from the guest lines'
  // own statuses every time a line changes. CANCELLED/NO_SHOW-as-cancelled
  // lines are excluded from the vote entirely, so e.g. 2 cancelled + 1
  // confirmed reads as a CONFIRMED booking, not a mixed one.
  const CONFIRMED_OR_BEYOND = ['CONFIRMED','CHECKED_IN','COMPLETED','NO_SHOW'];
  function deriveBookingStatus(b){
    const lines = b.guestLines || [];
    if(!lines.length) return 'OPEN';
    const active = lines.filter(l=>!['CANCELLED','EXPIRED'].includes(l.status));
    if(!active.length) return 'CANCELLED';
    if(active.every(l=>l.status==='COMPLETED')) return 'COMPLETED';
    if(active.every(l=>CONFIRMED_OR_BEYOND.includes(l.status))) return 'CONFIRMED';
    return 'OPEN';
  }

  // Recomputes and saves the booking's status from its current guest lines,
  // and — the moment the derived status FIRST becomes CONFIRMED — posts the
  // booking's invoice to the ledger automatically (item 7: nothing posts
  // before confirmation, and confirmation posts without a manual button).
  // Safe to call after any guest-line change; postBookingInvoice/
  // generateSalesInvoice are both idempotent (gated on the ids they set).
  function applyDerivedStatus(b){
    const status = deriveBookingStatus(b);
    if(status!==b.status) Store.update('bookings', b.id, { status });
    else b.status = status;
    if(status==='CONFIRMED' || status==='COMPLETED'){
      const fresh = Store.find('bookings', b.id);
      if(!fresh.invoiceJournalId){
        try{
          Posting.postBookingInvoice(fresh);
          const withInvoice = Store.find('bookings', b.id);
          Posting.generateSalesInvoice(withInvoice);
        }catch(e){ toast(e.message, 'err'); }
      }
    }
    return Store.find('bookings', b.id);
  }

  function openAddGuestLine(b, presetGuestId){
    const cust = Store.find('customers', b.customerId);
    const guests = Store.all('guests');
    const packages = Store.all('packages').filter(p=>p.kind!=='ADDON' && p.active!==false);
    let selectedTypes = new Set();

    const bodyId = 'aglBody';
    openModal({
      title:'Add guest to booking', size:'lg',
      bodyHtml: `<div id="${bodyId}">${addGuestFormHtml(guests, packages)}</div>`,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="agl-save">Add guest</button>`,
      onMount(modal){
        wireAddGuestForm(modal, b, cust, packages, guests);
        if(presetGuestId){
          const sel = qs('#agl-guest', modal);
          sel.value = presetGuestId;
          const filter = qs('#agl-guest-filter', modal);
          if(filter) filter.value = (Store.find('guests', presetGuestId)||{}).name || '';
        }
      }
    });
  }

  function addGuestFormHtml(guests, packages){
    return `
      <div class="form-row">
        <div class="field"><label>Guest <span class="hint">(type to search, or add a new one below)</span></label>
          <input type="text" id="agl-guest-filter" placeholder="Type a name…" autocomplete="off">
          <select id="agl-guest" size="1">
            <option value="">— pick or add new —</option>
            ${guests.map(g=>`<option value="${g.id}" data-name="${esc(g.name.toLowerCase())}">${esc(g.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>&nbsp;</label><button type="button" class="btn btn-sm" id="agl-new-guest">+ Quick-add new guest</button></div>
      </div>
      <div class="field"><label>Package</label>
        <select id="agl-pkg"><option value="">— select —</option>${packages.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      </div>
      <div class="form-row">
        <div class="field"><label>Trip</label>
          <select id="agl-trip"><option value="">Pick a package first</option></select>
        </div>
        <div class="field" style="max-width:120px"><label>Qty <span class="hint">(pax)</span></label><input type="number" id="agl-qty" min="1" step="1" value="1"></div>
      </div>
      <div class="field" id="agl-gear-wrap" style="display:none">
        <label>Guest is bringing their own</label>
        <div class="pill-select" id="agl-gear"></div>
        <div class="hint">Ticking an item only affects the stock check — the price doesn't change.</div>
      </div>
      <div id="agl-avail"></div>
      <label class="checkline mt-8"><input type="checkbox" id="agl-keep-open"> Keep this open to add another guest</label>
    `;
  }

  function wireAddGuestForm(modal, b, cust, packages, guests){
    const pkgSel = qs('#agl-pkg', modal), tripSel = qs('#agl-trip', modal), gearWrap = qs('#agl-gear-wrap', modal), gearBox = qs('#agl-gear', modal), availBox = qs('#agl-avail', modal);
    const guestSel = qs('#agl-guest', modal), guestFilter = qs('#agl-guest-filter', modal);
    // Every guest on a booking is priced in that booking's own fixed currency
    // (chosen once at creation) — never chosen per guest, and never hand-typed
    // at add-time. The price always comes straight from the price list; it can
    // only be edited afterwards, on the guest line itself, once added.
    const bookingCurrency = b.currency || Pricing.baseCurrency();
    let selectedTypes = new Set();
    let priceInfo = null; // { amounts, source, priceListName }

    // typeahead: filter the option list as the person types; Enter with no exact
    // match quick-creates a minimal guest inline without leaving this flow.
    guestFilter.addEventListener('input', ()=>{
      const q = guestFilter.value.trim().toLowerCase();
      let anyVisible = false;
      qsa('option', guestSel).forEach(o=>{
        if(!o.value){ o.hidden = false; return; }
        const match = !q || (o.dataset.name||'').includes(q);
        o.hidden = !match;
        if(match) anyVisible = true;
      });
      if(q && guestSel.value && !(Store.find('guests', guestSel.value)||{name:''}).name.toLowerCase().includes(q)) guestSel.value = '';
    });
    guestFilter.addEventListener('keydown', (e)=>{
      if(e.key==='Enter'){
        e.preventDefault();
        const q = guestFilter.value.trim();
        if(!q) return;
        const exact = Store.all('guests').find(g=>g.name.toLowerCase()===q.toLowerCase());
        if(exact){ guestSel.value = exact.id; runCheck(); }
        else quickAddGuest(q);
      }
    });
    qs('#agl-new-guest', modal).addEventListener('click', ()=>quickAddGuest(guestFilter.value.trim()));
    function quickAddGuest(prefillName){
      // openQuickGuestForm opens its own modal, which (like every openModal
      // call) closes whatever modal is currently open first — so rather than
      // trying to keep editing this modal's now-gone DOM, reopen a fresh
      // "Add guest to booking" modal with the new guest preselected.
      openQuickGuestForm((newGuest)=>{
        openAddGuestLine(b, newGuest.id);
      }, prefillName);
    }
    guestSel.addEventListener('change', runCheck);

    pkgSel.addEventListener('change', ()=>{
      const pkg = Store.find('packages', pkgSel.value);
      selectedTypes = new Set();
      priceInfo = pkg ? Pricing.resolvePrice(b.customerId, pkg.id) : null;
      if(!pkg){ tripSel.innerHTML = '<option value="">Pick a package first</option>'; gearWrap.style.display='none'; availBox.innerHTML=''; return; }
      const trips = Store.all('trips').filter(t=> (t.packageIds||[]).includes(pkg.id) && t.status!=='CANCELLED' && t.status!=='CLOSED' && t.tripDate>=todayISO()).sort((a,b2)=>a.tripDate.localeCompare(b2.tripDate));
      tripSel.innerHTML = trips.length ? trips.map(t=>{
        const boat = Store.find('boats', t.boatId);
        return `<option value="${t.id}">${esc(t.tripNo||'')} — ${fmtDate(t.tripDate)} ${t.startTime||''} — ${esc(boat?boat.name:'')}</option>`;
      }).join('') : '<option value="">No trips offer this package — add one from Calendar</option>';
      if(pkg.kit && pkg.kit.length){
        gearWrap.style.display = '';
        gearBox.innerHTML = pkg.kit.map(k=>{
          const t = Store.find('equipmentTypes', k.equipmentTypeId);
          return `<button type="button" class="pill" data-id="${k.equipmentTypeId}">${esc(t?t.name:'')}</button>`;
        }).join('');
        qsa('.pill', gearBox).forEach(p=>p.addEventListener('click', ()=>{
          p.classList.toggle('active');
          if(p.classList.contains('active')) selectedTypes.add(p.dataset.id); else selectedTypes.delete(p.dataset.id);
          runCheck();
        }));
      } else { gearWrap.style.display='none'; gearBox.innerHTML=''; }
      runCheck();
    });
    tripSel.addEventListener('change', runCheck);
    qs('#agl-qty', modal).addEventListener('input', runCheck);

    // The booking's fixed currency picks straight out of the resolved price
    // list amounts — never editable here.
    function currentCurrencyAmount(){
      if(!priceInfo) return null;
      const amt = bookingCurrency===Pricing.baseCurrency() ? priceInfo.amounts.MVR : priceInfo.amounts[bookingCurrency];
      return { code: bookingCurrency, amount: amt };
    }

    function currentQty(){
      const qtyInp = qs('#agl-qty', modal);
      const q = qtyInp ? parseInt(qtyInp.value) : 1;
      return (isNaN(q) || q<1) ? 1 : q;
    }

    function runCheck(){
      const guestId = guestSel.value, packageId = pkgSel.value, tripId = tripSel.value;
      if(!packageId || !tripId){ availBox.innerHTML=''; return; }
      const result = Availability.checkTrip({ tripId, packageId, ownGearTypeIds:[...selectedTypes], guestId, qty: currentQty() });
      const chosen = currentCurrencyAmount();
      const displayAmount = chosen ? chosen.amount : null;
      const qty = currentQty();
      const noPrice = priceInfo && chosen && displayAmount==null;
      availBox.innerHTML = `
        <div class="section-title">Availability</div>
        ${result.gates.map(g=>`<div class="small ${g.ok?'':''}" style="margin-bottom:4px"><span class="badge ${g.ok?'badge-green':'badge-red'}">${g.ok?'OK':'Blocked'}</span> ${esc(g.label)} — <span class="muted">${esc(g.detail)}</span></div>`).join('')}
        ${priceInfo && chosen && displayAmount!=null ? `<div class="field mt-8 mb-0">
            <label>Price per pax (${esc(chosen.code)})</label>
            <div class="kv-line" style="font-size:18px;font-weight:600">${displayAmount.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} ${esc(chosen.code)}</div>
            <div class="hint">Taken as-is from ${esc(priceSourceLabel(priceInfo.source, priceInfo.priceListName))} — this booking's currency is ${esc(chosen.code)}. You can edit the rate for this guest afterwards, once they're added.</div>
            ${qty>1 ? `<div class="small mt-4"><strong>${qty} × ${displayAmount.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} = ${(qty*displayAmount).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} ${esc(chosen.code)}</strong> for this line</div>` : ''}
          </div>` : ''}
        ${noPrice ? `<div class="danger-box mt-8">No ${esc(chosen.code)} price is set for this package. Add one to the price list before booking this guest.</div>` : ''}
        ${!result.ok ? `<div class="danger-box mt-8">This trip can't take this guest right now.
          ${!result.gates.find(g=>g.key==='seats').ok || !result.gates.find(g=>g.key==='ratio').ok ? `<button type="button" class="btn btn-sm btn-sand mt-8" id="agl-add-rental-boat">+ Add rental boat for this trip</button>` : ''}
          ${!result.gates.find(g=>g.key==='gear').ok ? `<button type="button" class="btn btn-sm btn-sand mt-8" id="agl-add-rental-gear">+ Add rental gear for this trip</button>` : ''}
        </div>` : ''}
      `;
      if(qs('#agl-add-rental-boat', modal)) qs('#agl-add-rental-boat', modal).addEventListener('click', ()=>{
        closeModal();
        if(window.CalendarModule && CalendarModule.openRentalBoatForTrip) CalendarModule.openRentalBoatForTrip(tripId);
        else Router.navigate('calendar');
      });
      if(qs('#agl-add-rental-gear', modal)) qs('#agl-add-rental-gear', modal).addEventListener('click', ()=>{
        openRentalGearForm(tripId, packageId, selectedTypes, ()=>{ closeModal(); openAddGuestLine(b); });
      });
    }

    qs('#agl-save', modal).addEventListener('click', ()=>{
      const guestId = guestSel.value, packageId = pkgSel.value, tripId = tripSel.value;
      if(!guestId){ toast('Pick or quick-add a guest.', 'err'); return; }
      if(!packageId || !tripId){ toast('Pick a package and a trip.', 'err'); return; }
      const result = Availability.checkTrip({ tripId, packageId, ownGearTypeIds:[...selectedTypes], guestId, qty: currentQty() });
      if(!result.ok){ toast('This trip cannot take this guest — check the availability gates.', 'err'); return; }
      const trip = Store.find('trips', tripId);
      const chosen = currentCurrencyAmount();
      // Always the price list's own resolved amount for this booking's
      // currency — never a hand-typed figure. It can only be edited on the
      // guest line afterwards, once added (item 1).
      const rawAmount = chosen ? chosen.amount : null;
      if(rawAmount==null || isNaN(rawAmount) || rawAmount<0){ toast('No price is set for this package in '+bookingCurrency+' — add one to the price list first.', 'err'); return; }
      const currencyCode = bookingCurrency;
      const conv = (currencyCode!==Pricing.baseCurrency()) ? Pricing.toBase(rawAmount, currencyCode, trip?trip.tripDate:todayISO()) : { amountBase: rawAmount, rate:1 };
      const holdMins = Store.settings.holdExpiryMinutes || 120;
      const line = {
        id: Store.uid('gl'), guestId, packageId, tripId,
        unitPrice: rawAmount, unitPriceBase: conv.amountBase, currency: currencyCode, fxRate: conv.rate,
        qty: currentQty(),
        priceSource: priceInfo?priceInfo.source:'NONE',
        priceOverridden: false, resolvedUnitPrice: undefined,
        ownGearTypeIds: [...selectedTypes], status:'HOLD',
        holdExpiresAt: new Date(Date.now()+holdMins*60000).toISOString(),
        equipmentIssued: [], addons: []
      };
      b.guestLines = b.guestLines || [];
      b.guestLines.push(line);
      saveBookingLines(b);
      applyDerivedStatus(b);
      const keepOpen = qs('#agl-keep-open', modal) && qs('#agl-keep-open', modal).checked;
      toast('Guest added on hold', 'ok');
      if(keepOpen){ closeModal(); openAddGuestLine(b); }
      else { closeModal(); detail({id:b.id}); }
    });
  }

  function openRentalGearForm(tripId, packageId, ownGearTypeIds, onDone){
    const needed = Availability.gearNeededForLine(packageId, [...(ownGearTypeIds||[])]);
    if(!needed.length){ toast('No house gear needed for this package.'); return; }
    const vendors = Store.all('vendors');
    openModal({
      title:'Add rental gear for this trip',
      bodyHtml: `
        <div class="field"><label>Gear type short</label><select id="rg-type">${needed.map(n=>{ const t=Store.find('equipmentTypes', n.typeId); return `<option value="${n.typeId}">${esc(t?t.name:'')}</option>`; }).join('')}</select></div>
        <div class="field"><label>Extra quantity for this trip</label><input id="rg-qty" type="number" min="1" value="2"></div>
        <div class="field"><label>Vendor <span class="hint">(optional — for the rental bill)</span></label><select id="rg-vendor"><option value="">—</option>${vendors.map(v=>`<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Rental cost</label><input id="rg-cost" type="number" min="0" step="0.01" value="0"></div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="rg-save">Add</button>`,
      onMount(modal){
        qs('#rg-save', modal).addEventListener('click', ()=>{
          const typeId = qs('#rg-type', modal).value, qty = parseInt(qs('#rg-qty', modal).value)||0;
          const trip = Store.find('trips', tripId);
          const extra = (trip.rentalGearExtra||[]).filter(r=>r.typeId!==typeId);
          extra.push({ typeId, qty });
          Store.update('trips', tripId, { rentalGearExtra: extra });
          const vendorId = qs('#rg-vendor', modal).value, cost = parseFloat(qs('#rg-cost', modal).value)||0;
          if(vendorId && cost>0 && window.BillsModule){
            closeModal();
            BillsModule.openForm({ vendorId, tripId, accountId: Store.acctId('5010'), amount: cost, description:'Rental gear — trip '+(trip.tripNo||''), title:'Rental gear bill', onSaved: onDone });
          } else { closeModal(); toast('Rental gear added for this trip', 'ok'); if(onDone) onDone(); }
        });
      }
    });
  }

  function priceSourceLabel(source, listName){
    return { AGENT_SPECIAL:'agent special price', PRICE_LIST: listName?`from ${listName}`:'price list', DIRECT:'Direct rate', NONE:'no price set' }[source] || source;
  }

  function openQuickGuestForm(onDone, prefillName){
    openModal({
      title:'Quick-add guest',
      bodyHtml: `
        <p class="hint mb-8">Just enough to add them to this booking — fill in the rest later from the Guests register.</p>
        <div class="field"><label>Full name</label><input id="qg-name" type="text" value="${esc(prefillName||'')}"></div>
        <div class="form-row">
          <div class="field"><label>Certification level</label><input id="qg-cert" type="text"></div>
          <div class="field"><label>Waiver signed today?</label><label class="checkline mt-8"><input type="checkbox" id="qg-waiver"> Yes</label></div>
        </div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="qg-save">Save guest</button>`,
      onMount(modal){
        qs('#qg-save', modal).addEventListener('click', ()=>{
          const name = qs('#qg-name', modal).value.trim();
          if(!name){ toast('Enter a name.', 'err'); return; }
          const g = Store.insert('guests', { name, certLevel: qs('#qg-cert', modal).value.trim(),
            waiverSigned: qs('#qg-waiver', modal).checked, waiverDate: qs('#qg-waiver', modal).checked?todayISO():null, active:true });
          closeModal(); toast('Guest registered', 'ok'); onDone(g);
        });
      }
    });
  }

  // Settle is how a guest line moves HOLD -> CONFIRMED (item 6): it always
  // goes through a payment method (any configured method) or "Pending", which
  // records the sale on credit with no receipt. Pass a single guest line to
  // settle just that guest, or null to settle every HOLD line on the booking
  // in one go (item: "settlement in full as well as ... one by one").
  // Confirming (via applyDerivedStatus) is what actually posts the booking's
  // invoice to the ledger — nothing posts before that (item 7).
  function openSettleForm(b, gl){
    const targetLines = gl ? [gl] : (b.guestLines||[]).filter(l=>l.status==='HOLD');
    if(!targetLines.length){ toast('No guests on hold to settle.', 'err'); return; }
    const cust = Store.find('customers', b.customerId);
    const isAgent = cust && cust.type==='AGENT';
    const currency = b.currency || Pricing.baseCurrency();
    // Net (pre-tax) totals, in the line's own face currency — used for the
    // direct-collect commission comparison, which is a revenue gap, not a
    // tax one. What the guest actually owes/pays is the GROSS (tax-inclusive)
    // amount, matching what postBookingInvoice will put on the AR line.
    const lineTotal = (l)=> Ledger.round2((l.unitPrice||0)*(l.qty||1));
    const lineTax = (l)=> Posting.taxRateFor(Store.find('packages', l.packageId));
    const lineGrossFace = (l)=> Ledger.round2(lineTotal(l)*(1+lineTax(l)));
    const lineGrossBase = (l)=> Ledger.round2(Ledger.round2((l.unitPriceBase||0)*(l.qty||1))*(1+lineTax(l)));
    const totalDue = Ledger.round2(targetLines.reduce((s,l)=>s+lineGrossFace(l),0));
    // A method tied to one currency (e.g. a USD card terminal) only makes
    // sense for a booking priced in that same currency — everything else
    // (including the built-in Cash method, which has no currency of its
    // own and resolves to the right per-currency account automatically)
    // stays available regardless of the booking's currency.
    const methods = (Store.settings.paymentMethods||[]).filter(m=>!m.currency || m.currency===currency);
    const singleAgentLine = gl && isAgent; // direct-collect only makes sense one guest at a time

    openModal({
      title: gl ? 'Settle guest' : `Settle ${targetLines.length} guest(s)`,
      bodyHtml: `
        <dl class="kv mb-16">
          <dt>Guest(s)</dt><dd>${targetLines.map(l=>esc((Store.find('guests', l.guestId)||{}).name||'—')).join(', ')}</dd>
          <dt>Amount due</dt><dd>${totalDue.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} ${esc(currency)}</dd>
        </dl>
        ${singleAgentLine ? `
          <label class="checkline mb-8"><input type="checkbox" id="st-direct"> Guest is paying the shop directly, at the Direct rate</label>
          <div class="hint mb-8" id="st-direct-hint" style="display:none"></div>
        ` : ''}
        <div class="form-row">
          <div class="field"><label>Settle via</label>
            <select id="st-method">
              ${methods.map(m=>`<option value="${m.id}">${esc(m.label)}</option>`).join('')}
              <option value="PENDING">Pending — credit sale, settle later</option>
            </select>
          </div>
          <div class="field"><label>Date</label><input id="st-date" type="date" value="${todayISO()}"></div>
        </div>
        <p class="hint" id="st-pending-hint" style="display:none">No payment is recorded now — the guest is confirmed on credit, and the booking still invoices normally.</p>
        <p class="hint" id="st-fob-hint" style="display:none">FOB records this as a complimentary write-off — no cash or bank is debited, and no money changes hands.</p>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="st-save">Settle</button>`,
      onMount(modal){
        const methodSel = qs('#st-method', modal), pendingHint = qs('#st-pending-hint', modal), fobHint2 = qs('#st-fob-hint', modal);
        const directChk = qs('#st-direct', modal), directHint = qs('#st-direct-hint', modal);
        function directInfo(){
          if(!gl) return null;
          const trip = Store.find('trips', gl.tripId);
          const direct = Pricing.resolvePrice('CUST_DIRECT', gl.packageId, trip?trip.tripDate:todayISO());
          const directUnit = currency===Pricing.baseCurrency() ? direct.amounts.MVR : direct.amounts[currency];
          if(directUnit==null) return null;
          const qty = gl.qty||1;
          const directTotal = Ledger.round2(directUnit*qty);
          const agentTotal = lineTotal(gl);
          return { directUnit, directTotal, commission: Ledger.round2(directTotal-agentTotal) };
        }
        function updateUi(){
          pendingHint.style.display = methodSel.value==='PENDING' ? '' : 'none';
          const md = methods.find(m=>m.id===methodSel.value);
          fobHint2.style.display = (md && md.kind==='FOB') ? '' : 'none';
          if(directChk){
            const info = directChk.checked ? directInfo() : null;
            if(directChk.checked && !info){
              directHint.style.display=''; directHint.textContent = 'No Direct-list price is set for this package/currency — add one first.';
            } else if(info){
              directHint.style.display='';
              directHint.textContent = `Guest pays ${info.directTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} ${currency} at the Direct rate. Commission owed to ${cust.name}: ${info.commission.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} ${currency}.`;
            } else { directHint.style.display='none'; }
          }
        }
        methodSel.addEventListener('change', updateUi);
        if(directChk) directChk.addEventListener('change', updateUi);
        updateUi();

        qs('#st-save', modal).addEventListener('click', ()=>{
          const method = methodSel.value;
          const date = qs('#st-date', modal).value || todayISO();
          const wantsDirect = directChk && directChk.checked;
          let commissionToPost = 0;

          if(wantsDirect){
            const info = directInfo();
            if(!info){ toast('No Direct-list price is set for this package in '+currency+'.', 'err'); return; }
            const trip = Store.find('trips', gl.tripId);
            const conv = currency!==Pricing.baseCurrency() ? Pricing.toBase(info.directUnit, currency, trip?trip.tripDate:todayISO()) : { amountBase: info.directUnit, rate:1 };
            const priorBase = gl.unitPriceBase||0;
            gl.agentRateUnitBase = priorBase;
            gl.unitPrice = info.directUnit;
            gl.unitPriceBase = conv.amountBase;
            gl.fxRate = conv.rate;
            gl.directCollect = true;
            commissionToPost = Ledger.round2((conv.amountBase*(gl.qty||1)) - (priorBase*(gl.qty||1)));
          }

          if(method==='PENDING'){
            targetLines.forEach(l=>{ l.status='CONFIRMED'; l.settlement = { type:'PENDING', date }; });
          } else {
            const totalFace = Ledger.round2(targetLines.reduce((s,l)=>s+lineGrossFace(l),0));
            const totalBase = Ledger.round2(targetLines.reduce((s,l)=>s+lineGrossBase(l),0));
            const receipt = { receiptNo: Store.docNo('RCT','receipt'), customerId: b.customerId, bookingId: b.id,
              guestLineIds: targetLines.map(l=>l.id), date, method, currency, amount: totalFace, amountBase: totalBase };
            Store.insert('receipts', receipt);
            try{ Posting.postReceipt(receipt); }
            catch(e){ toast(e.message, 'err'); return; }
            targetLines.forEach(l=>{ l.status='CONFIRMED'; l.settlement = { type:'PAID', method, receiptId: receipt.id }; });
          }

          saveBookingLines(b);
          if(wantsDirect && commissionToPost>0.004){
            try{ Posting.postAgentCommission(b, gl, commissionToPost, b.customerId); }
            catch(e){ toast(e.message, 'err'); }
          }
          applyDerivedStatus(b);
          closeModal();
          toast(gl ? 'Guest settled' : 'Guests settled', 'ok');
          detail({id:b.id});
        });
      }
    });
  }

  // Collect payment: the counterpart to settling a guest line as "Pending"
  // (credit sale — confirms and invoices the guest with no receipt). Once a
  // booking carries an outstanding AR balance, this records an ordinary
  // receipt against it — full or partial, in the booking's own currency —
  // without touching any guest line's status (they're already CONFIRMED).
  // Reachable from the booking page and, via BookingsModule, from the
  // linked sales invoice too.
  function openCollectPaymentForm(b, onSaved){
    const info = bookingBalanceInfo(b);
    if(info.balance<=0.004){ toast('This booking has no balance due.', 'err'); return; }
    const cust = Store.find('customers', b.customerId);
    // Same currency-matching rule as Settle (see there): a method tied to
    // one currency only appears when collecting a balance in that currency.
    const methods = (Store.settings.paymentMethods||[]).filter(m=>!m.currency || m.currency===info.currency);
    if(!methods.length){ toast('No payment methods are configured.', 'err'); return; }
    openModal({
      title:'Collect payment',
      bodyHtml: `
        <dl class="kv mb-16">
          <dt>Booking</dt><dd>${esc(b.bookingNo)} — ${esc(cust?cust.name:'—')}</dd>
          <dt>Balance due</dt><dd>${info.balance.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} ${esc(info.currency)}</dd>
        </dl>
        <div class="form-row">
          <div class="field"><label>Settle via</label>
            <select id="cp-method">${methods.map(m=>`<option value="${m.id}">${esc(m.label)}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Date</label><input id="cp-date" type="date" value="${todayISO()}"></div>
        </div>
        <div class="field"><label>Amount (${esc(info.currency)})</label><input id="cp-amount" type="number" min="0.01" step="0.01" value="${info.balance.toFixed(2)}"></div>
        <p class="hint" id="cp-fob-hint" style="display:none">FOB records this as a complimentary write-off — no cash or bank is debited, and no money changes hands.</p>
        <p class="hint">Leave the amount as the full balance to settle it, or lower it to record a partial payment.</p>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="cp-save">Record payment</button>`,
      onMount(modal){
        const methodSel = qs('#cp-method', modal), fobHint = qs('#cp-fob-hint', modal);
        function updateUi(){
          const md = methods.find(m=>m.id===methodSel.value);
          fobHint.style.display = (md && md.kind==='FOB') ? '' : 'none';
        }
        methodSel.addEventListener('change', updateUi);
        updateUi();
        qs('#cp-save', modal).addEventListener('click', ()=>{
          const method = methodSel.value;
          const date = qs('#cp-date', modal).value || todayISO();
          const amount = parseFloat(qs('#cp-amount', modal).value);
          if(!amount || isNaN(amount) || amount<=0){ toast('Enter an amount.', 'err'); return; }
          if(amount > info.balance+0.01){ toast('Amount cannot exceed the balance due ('+info.balance.toFixed(2)+' '+info.currency+').', 'err'); return; }
          const amountRounded = Ledger.round2(amount);
          const amountBase = info.currency===Pricing.baseCurrency() ? amountRounded : Pricing.toBase(amountRounded, info.currency, date).amountBase;
          const receipt = { receiptNo: Store.docNo('RCT','receipt'), customerId: b.customerId, bookingId: b.id,
            guestLineIds: [], date, method, currency: info.currency, amount: amountRounded, amountBase: Ledger.round2(amountBase) };
          Store.insert('receipts', receipt);
          try{ Posting.postReceipt(receipt); }
          catch(e){ toast(e.message, 'err'); return; }
          closeModal();
          toast('Payment recorded', 'ok');
          if(onSaved) onSaved(); else detail({id:b.id});
        });
      }
    });
  }

  function handleLineAction(b, action, glId){
    const gl = b.guestLines.find(l=>l.id===glId);
    if(!gl) return;
    if(action==='settle'){ openSettleForm(b, gl); }
    else if(action==='checkin'){
      const guest = Store.find('guests', gl.guestId);
      if(guest && !guest.waiverSigned) toast('Note: waiver is not on file for this guest.', 'err');
      gl.status='CHECKED_IN'; saveBookingLines(b); applyDerivedStatus(b); toast('Checked in'); detail({id:b.id});
    }
    else if(action==='issue'){ issueGear(b, gl); }
    else if(action==='return'){ returnGear(b, gl); }
    else if(action==='complete'){
      const outstanding = outstandingGearFor(gl);
      if(outstanding.length){
        toast('Cannot complete — outstanding gear not yet returned: '+outstanding.join(', '), 'err');
        return;
      }
      gl.status='COMPLETED'; saveBookingLines(b);
      applyDerivedStatus(b);
      toast('Marked completed'); detail({id:b.id});
    }
    else if(action==='cancel'){
      confirmDialog('Cancel this guest\'s line? This frees their seat and gear.', ()=>{
        gl.status='CANCELLED'; saveBookingLines(b); applyDerivedStatus(b); toast('Guest line cancelled'); detail({id:b.id});
      });
    }
    else if(action==='noshow'){ gl.status='NO_SHOW'; saveBookingLines(b); applyDerivedStatus(b); toast('Marked no-show'); detail({id:b.id}); }
    else if(action==='reschedule'){ openRescheduleForm(b, gl); }
  }

  function issueGear(b, gl){
    const needed = Availability.gearNeededForLine(gl.packageId, gl.ownGearTypeIds, gl.qty||1);
    if(!needed.length){ toast('No house gear needed for this guest.'); gl.equipmentIssued=[]; saveBookingLines(b); detail({id:b.id}); return; }
    const issued = [];
    let short = [];
    needed.forEach(n=>{
      const available = Store.where('equipment', e=>e.equipmentTypeId===n.typeId && e.status==='IN_STOCK');
      const take = available.slice(0, n.qty);
      if(take.length < n.qty){ const t=Store.find('equipmentTypes', n.typeId); short.push(t?t.name:'gear'); }
      take.forEach(item=>{
        Store.update('equipment', item.id, {status:'ISSUED', issuedToType:'GUEST', issuedToId: gl.guestId, issuedTripId: gl.tripId, issuedTripDate: (Store.find('trips', gl.tripId)||{}).tripDate});
        issued.push({equipmentId:item.id, typeId:n.typeId});
        Store.insert('equipmentUsageLog', { equipmentId:item.id, typeId:n.typeId, tripId: gl.tripId, guestLineId: gl.id, date: todayISO(), assigneeType:'GUEST' });
      });
    });
    gl.equipmentIssued = issued;
    saveBookingLines(b);
    if(short.length) toast('Issued what was available — short on: '+short.join(', '), 'err');
    else toast('Gear issued', 'ok');
    detail({id:b.id});
  }

  // Gear still outstanding for this guest line (issued to the guest and not
  // yet returned) plus any gear issued to STAFF for this same trip and not
  // yet returned — both must be clear before the line can be completed.
  function outstandingGearFor(gl){
    const names = [];
    (gl.equipmentIssued||[]).forEach(ei=>{
      const item = Store.find('equipment', ei.equipmentId);
      if(item && item.status==='ISSUED') names.push(item.tag);
    });
    Store.where('equipment', e=>e.status==='ISSUED' && e.issuedToType==='STAFF' && e.issuedTripId===gl.tripId).forEach(item=>names.push(item.tag+' (staff)'));
    return names;
  }

  // Return flow for gear issued to a guest: a normal return (back to stock or
  // service), or — only for guest-issued gear — damaged/lost, which charges
  // the guest and updates the equipment record (SERVICE for repairable
  // damage, RETIRED for a lost item).
  function returnGear(b, gl){
    openModal({
      title:'Return gear', size:'lg',
      bodyHtml: `<div class="inline-list">${(gl.equipmentIssued||[]).map(ei=>{
        const item = Store.find('equipment', ei.equipmentId);
        return `<div class="inline-item" style="flex-wrap:wrap"><span class="grow">${esc(item?item.tag:'—')} ${item?`(${(Store.find('equipmentTypes',item.equipmentTypeId)||{}).name||''})`:''}</span>
          <select data-cond="${ei.equipmentId}">
            <option value="ok">OK — back to stock</option>
            <option value="service">Needs service</option>
            <option value="damaged">Damaged — charge guest</option>
            <option value="lost">Lost — charge guest</option>
          </select>
          <input type="number" min="0" step="0.01" data-charge="${ei.equipmentId}" style="width:100px;display:none" value="${item?(item.cost||0):0}" placeholder="Charge">
        </div>`;
      }).join('') || '<p class="muted">No gear was issued.</p>'}</div>`,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="rg-save">Confirm return</button>`,
      onMount(modal){
        qsa('[data-cond]', modal).forEach(sel=>sel.addEventListener('change', ()=>{
          const chargeInp = qs(`[data-charge="${sel.dataset.cond}"]`, modal);
          chargeInp.style.display = (sel.value==='damaged'||sel.value==='lost') ? '' : 'none';
        }));
        qs('#rg-save', modal).addEventListener('click', ()=>{
          let totalCharged = 0;
          const chargedItems = [];
          (gl.equipmentIssued||[]).forEach(ei=>{
            const sel = qs(`[data-cond="${ei.equipmentId}"]`, modal);
            const val = sel ? sel.value : 'ok';
            const item = Store.find('equipment', ei.equipmentId);
            if(val==='damaged' || val==='lost'){
              const chargeAmt = parseFloat(qs(`[data-charge="${ei.equipmentId}"]`, modal).value)||0;
              Store.update('equipment', ei.equipmentId, { status: val==='lost'?'RETIRED':'SERVICE',
                issuedToType:null, issuedToId:null, issuedTripId:null, issuedTripDate:null,
                serviceReason: (val==='lost'?'Lost':'Damaged')+' on return — trip '+(Store.find('trips',gl.tripId)||{}).tripNo, serviceLoggedAt: nowISO() });
              if(chargeAmt>0 && item){ totalCharged += chargeAmt; chargedItems.push(item.tag); }
            } else {
              Store.update('equipment', ei.equipmentId, { status: val==='service' ? 'SERVICE' : 'IN_STOCK', issuedToType:null, issuedToId:null, issuedTripId:null, issuedTripDate:null });
            }
          });
          gl.equipmentIssued = [];
          saveBookingLines(b);
          if(totalCharged>0){
            try{ chargeGuestForDamagedGear(b, chargedItems, totalCharged); }
            catch(e){ toast(e.message, 'err'); }
          }
          closeModal();
          toast(totalCharged>0 ? `Gear returned — guest charged ${fmtMoney(totalCharged)} for ${chargedItems.join(', ')}` : 'Gear returned', 'ok');
          detail({id:b.id});
        });
      }
    });
  }

  // Posts a supplementary AR charge to the guest's customer account for
  // damaged/lost gear (Dr AR, Cr Equipment Damage/Loss Recovery), and grows
  // the booking's invoice total to match so "balance due" stays correct.
  function chargeGuestForDamagedGear(b, itemTags, amount){
    const customer = Store.find('customers', b.customerId);
    if(!customer) return;
    const arAccount = customer.type==='AGENT' ? Store.acctId('1110') : Store.acctId('1120');
    const je = Ledger.post({
      date: todayISO(), ref: 'DMG-'+b.bookingNo,
      description: `Equipment damage/loss charge — ${itemTags.join(', ')} — booking ${b.bookingNo}`,
      sourceType:'equipmentDamage', sourceId: b.id,
      lines: [
        { accountId: arAccount, debit: amount, credit:0, partyType:'customer', partyId: b.customerId, memo: itemTags.join(', ') },
        { accountId: Store.acctId('4020'), debit:0, credit: amount, memo: itemTags.join(', ') }
      ]
    });
    Store.update('bookings', b.id, { invoiceTotal: Ledger.round2((b.invoiceTotal||0)+amount) });
    return je;
  }

  function openRescheduleForm(b, gl){
    const pkg = Store.find('packages', gl.packageId);
    const trips = Store.all('trips').filter(t=> (t.packageIds||[]).includes(gl.packageId) && t.status!=='CANCELLED' && t.status!=='CLOSED' && t.id!==gl.tripId).sort((a,b2)=>a.tripDate.localeCompare(b2.tripDate));
    openModal({
      title:'Reschedule guest',
      bodyHtml: `
        <div class="field"><label>New trip</label>
          <select id="rs-trip">${trips.map(t=>{ const boat=Store.find('boats',t.boatId); return `<option value="${t.id}">${fmtDate(t.tripDate)} ${t.startTime||''} — ${esc(boat?boat.name:'')}</option>`; }).join('') || '<option value="">No other trips offer this package</option>'}</select>
        </div>
        <div id="rs-avail"></div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="rs-save">Reschedule</button>`,
      onMount(modal){
        const sel = qs('#rs-trip', modal), availBox = qs('#rs-avail', modal);
        function check(){
          const tripId = sel.value;
          if(!tripId){ availBox.innerHTML=''; return; }
          const result = Availability.checkTrip({ tripId, packageId: gl.packageId, ownGearTypeIds: gl.ownGearTypeIds, guestId: gl.guestId, excludeGuestLineId: gl.id, qty: gl.qty||1 });
          availBox.innerHTML = result.gates.map(g=>`<div class="small" style="margin-bottom:4px"><span class="badge ${g.ok?'badge-green':'badge-red'}">${g.ok?'OK':'Blocked'}</span> ${esc(g.label)}</div>`).join('');
        }
        sel.addEventListener('change', check); check();
        qs('#rs-save', modal).addEventListener('click', ()=>{
          const tripId = sel.value;
          if(!tripId){ toast('Pick a trip.', 'err'); return; }
          const result = Availability.checkTrip({ tripId, packageId: gl.packageId, ownGearTypeIds: gl.ownGearTypeIds, guestId: gl.guestId, excludeGuestLineId: gl.id, qty: gl.qty||1 });
          if(!result.ok){ toast('That trip cannot take this guest.', 'err'); return; }
          gl.tripId = tripId;
          saveBookingLines(b);
          closeModal(); toast('Rescheduled', 'ok'); detail({id:b.id});
        });
      }
    });
  }

  Router.on('/bookings', (p)=> p.id ? detail(p) : render(p));
  window.BookingsModule = { openAddGuestLine, handleLineAction, guestLineRow, lineStatusBadge, saveBookingLines, issueGear, returnGear, openSettleForm, deriveBookingStatus, applyDerivedStatus, openCollectPaymentForm, bookingBalanceInfo, bookingDisplayTotal };
})();
