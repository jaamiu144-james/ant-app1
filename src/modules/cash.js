/* ---------------------------------------------------------------------
   cash.js — receipts list and the day-end counter close.

   Day-end close reflects ONLY sales & collections: "expected" per method
   is built by summing that date's RECEIPT records for the method (never
   from raw ledger movement on the account), so vendor bill payments,
   petty cash replenishment, payroll payouts and other back-office cash/
   bank postings never leak into the expected figures even though they
   post to the same accounts.

   The built-in CASH method carries its opening balance forward from the
   prior close's counted cash (per currency — MVR/USD/EUR each have their
   own control account and their own carried float); every other method
   (card, bank, a shop's own custom methods) starts each day/shift at
   zero — they reflect only that day's collections, never a running float.
--------------------------------------------------------------------- */

(function(){

  const DENOMINATIONS = [100,50,20,10,5,2,1,0.5,0.25];
  const CASH_CURRENCIES = ['MVR','USD','EUR'];

  function paymentMethods(){ return (Store.settings.paymentMethods||[]).filter(m=>m.kind!=='FOB'); }
  function methodLabel(id){ const m=(Store.settings.paymentMethods||[]).find(x=>x.id===id); return m?m.label:id; }

  /* ---------------- RECEIPTS ---------------- */
  function renderReceipts(params){
    setPageTitle('Receipts', 'Finance');
    renderNav();
    const rows = Store.all('receipts').slice().sort((a,b)=>b.date.localeCompare(a.date));
    qs('#content').innerHTML = `
      <div class="help-box mb-16">Receipts are recorded from a booking's page, so payment always ties to the guests it covers. This is a read-only list of everything received. Cash receipts post straight to that currency's Cash on Hand account; FOB receipts are a complimentary write-off, not cash.</div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Receipt #</th><th>Date</th><th>Customer</th><th>Booking</th><th>Method</th><th>Currency</th><th class="num">Amount</th></tr></thead>
        <tbody>
        ${rows.length ? rows.map(r=>{
          const cust = Store.find('customers', r.customerId), b = Store.find('bookings', r.bookingId);
          return `<tr><td>${esc(r.receiptNo)}</td><td>${fmtDate(r.date)}</td><td>${esc(cust?cust.name:'—')}</td>
            <td>${b?`<a onclick="Router.navigate('bookings/${b.id}')">${esc(b.bookingNo)}</a>`:'—'}</td><td>${esc(methodLabel(r.method))}</td><td>${esc(r.currency||Pricing.baseCurrency())}</td><td class="num">${fmtCur(r.amount, r.currency)}</td></tr>`;
        }).join('') : `<tr><td colspan="7" class="table-empty">No receipts yet.</td></tr>`}
        </tbody>
      </table></div>
    `;
  }

  /* ---------------- DAY-END CLOSE ---------------- */

  // Sums this date's RECEIPT collections for one method (and, for a cash-type
  // row, one currency) — never raw ledger movement, so back-office voucher/
  // bill/payroll postings to the same account never affect this figure.
  function collectionsFor(methodId, currency, date){
    let sum = 0;
    Store.all('receipts').forEach(r=>{
      if(r.date!==date || r.method!==methodId) return;
      if(currency!=null && (r.currency||Pricing.baseCurrency())!==currency) return;
      sum += (r.amount||0);
    });
    return Ledger.round2(sum);
  }

  // Prior LOCKED close's counted amount for this exact row (method+currency),
  // most recent first. Only cash-type rows carry this forward — see the
  // module comment above.
  function openingFor(methodId, currency, cashType, beforeDate){
    if(!cashType) return 0;
    const closes = Store.all('dayEndCloses').filter(c=>c.status==='LOCKED' && c.date<beforeDate).sort((a,b)=>b.date.localeCompare(a.date));
    for(const c of closes){
      const m = (c.methods||[]).find(x=>x.methodId===methodId && x.currency===currency);
      if(m) return m.counted||0;
    }
    return 0;
  }

  // Builds the row list for a given date: the built-in CASH method expands
  // into one row per currency (each with its own control account and its
  // own carried-forward opening float); every other method is a single row
  // that always opens at zero.
  function buildRows(date){
    const rows = [];
    paymentMethods().forEach(m=>{
      if(m.kind==='CASH'){
        CASH_CURRENCIES.forEach(cur=>{
          const opening = openingFor(m.id, cur, true, date);
          const collected = collectionsFor(m.id, cur, date);
          rows.push({
            methodId: m.id, currency: cur, label: `${m.label} (${cur})`, cashType: true,
            accountId: Posting.resolveMethodAccountId(m.id, cur),
            opening, collected, expected: Ledger.round2(opening+collected)
          });
        });
      } else {
        const cashType = !!m.cashType;
        const opening = openingFor(m.id, null, cashType, date);
        const collected = collectionsFor(m.id, null, date);
        rows.push({
          methodId: m.id, currency: null, label: m.label, cashType,
          accountId: Posting.resolveMethodAccountId(m.id, null),
          opening, collected, expected: Ledger.round2(opening+collected)
        });
      }
    });
    return rows;
  }

  // Sums a set of day-end method rows by their own currency (falling back to
  // the ledger base currency for non-cash methods, which always carry
  // currency:null) — never adding different currencies' figures together —
  // then renders each currency's subtotal on its own line. Most closes only
  // ever touch one currency, so this collapses to a single amount exactly
  // like before; it only expands when a close actually has foreign-currency
  // (e.g. USD Cash) collections alongside the base-currency ones.
  function sumByCurrencyHtml(ms, key){
    const byCur = {};
    ms.forEach(m=>{
      const cur = m.currency || Pricing.baseCurrency();
      byCur[cur] = Ledger.round2((byCur[cur]||0) + (m[key]||0));
    });
    const currencies = Object.keys(byCur);
    if(currencies.length<=1){
      const cur = currencies[0];
      return fmtCur(cur?byCur[cur]:0, cur);
    }
    return currencies.map(cur=>fmtCur(byCur[cur], cur)).join('<br>');
  }

  function renderDayEnd(params){
    setPageTitle('Day-end close', 'Finance');
    renderNav();
    const vo = Auth.isViewOnly();
    const closes = Store.all('dayEndCloses').slice().sort((a,b)=>b.date.localeCompare(a.date));
    const todayClosed = closes.find(c=>c.date===todayISO() && c.status==='LOCKED');
    qs('#content').innerHTML = `
      <div class="toolbar">
        <div class="spacer"></div>
        ${!todayClosed && !vo ? `<button class="btn btn-primary" id="de-close-today">Close today (${fmtDate(todayISO())})</button>` : todayClosed ? `<span class="badge badge-green">Today is closed</span>` : ''}
      </div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Date</th><th>Methods</th><th class="num">Expected</th><th class="num">Counted</th><th class="num">Variance</th><th>Status</th></tr></thead>
        <tbody>
        ${closes.length ? closes.map(c=>{
          const ms = c.methods||[];
          return `<tr style="cursor:pointer" data-view="${c.id}">
          <td>${fmtDate(c.date)}</td><td>${ms.map(m=>esc(m.label||m.method)).join(', ')}</td>
          <td class="num">${sumByCurrencyHtml(ms,'expected')}</td><td class="num">${sumByCurrencyHtml(ms,'counted')}</td>
          <td class="num" style="color:${Math.abs(Ledger.round2(ms.reduce((s,m)=>s+(m.variance||0),0)))>0.01?'var(--danger)':'inherit'}">${sumByCurrencyHtml(ms,'variance')}</td>
          <td><span class="badge badge-teal">${esc(c.status)}</span></td>
        </tr>`;
        }).join('') : `<tr><td colspan="6" class="table-empty">No day-end closes yet.</td></tr>`}
        </tbody>
      </table></div>
    `;
    if(qs('#de-close-today')) qs('#de-close-today').addEventListener('click', ()=>openCloseForm(todayISO()));
    qsa('[data-view]').forEach(r=>r.addEventListener('click', ()=>openCloseDetail(Store.find('dayEndCloses', r.dataset.view))));
  }

  function openCloseDetail(close){
    if(!close) return;
    openModal({
      title: `Day-end close — ${fmtDate(close.date)}`,
      size:'lg',
      bodyHtml: `
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Method</th><th class="num">Opening</th><th class="num">Collected</th><th class="num">Expected</th><th class="num">Counted</th><th class="num">Variance</th><th>Note</th></tr></thead>
          <tbody>${(close.methods||[]).map(m=>`<tr><td>${esc(m.label||m.method)}</td><td class="num">${fmtCur(m.opening||0, m.currency)}</td><td class="num">${fmtCur(m.collected!=null?m.collected:m.expected, m.currency)}</td><td class="num">${fmtCur(m.expected, m.currency)}</td><td class="num">${fmtCur(m.counted, m.currency)}</td>
            <td class="num" style="color:${Math.abs(m.variance)>0.01?'var(--danger)':'inherit'}">${fmtCur(m.variance, m.currency)}</td><td class="small">${esc(m.note||'—')}</td></tr>`).join('')}</tbody>
        </table></div>
      `,
      footerHtml: `<button class="btn" data-close>Close</button>`
    });
  }

  // Suggests a denomination breakdown that sums to `expected`, so the count
  // starts pre-filled to match and the accountant adjusts it to what's actually
  // in the drawer (rather than typing every count from a blank slate).
  function suggestDenomQtys(expected){
    let remaining = Ledger.round2(Math.max(0, expected||0));
    const qtys = {};
    DENOMINATIONS.forEach(v=>{
      const qty = Math.floor((remaining+1e-9)/v);
      qtys[v] = qty;
      remaining = Ledger.round2(remaining - qty*v);
    });
    return qtys;
  }

  function denominationRowsHtml(expected){
    const qtys = suggestDenomQtys(expected);
    return DENOMINATIONS.map(v=>`<div class="inline-item">
      <span class="grow">${v>=1?v.toFixed(0):v.toFixed(2)}</span>
      <input type="number" min="0" step="1" value="${qtys[v]||0}" data-denom="${v}" style="width:70px">
    </div>`).join('');
  }

  // A modal stacked ON TOP OF the day-end close modal that's already open.
  // The shared openModal()/closeModal() in util.js always closes whatever is
  // currently open before showing the next one (single-modal semantics used
  // everywhere else in the app), which would wipe out the close modal
  // underneath — so this builds its own backdrop instead, closed only by
  // itself, leaving the parent modal untouched.
  function openStackedModal(opts){
    const backdrop = el(`<div class="modal-backdrop" style="z-index:150"></div>`);
    const modal = el(`<div class="modal"><div class="modal-head"><h2>${esc(opts.title||'')}</h2><button class="close-x" data-stacked-close>&times;</button></div>
      <div class="modal-body">${opts.bodyHtml||''}</div><div class="modal-foot">${opts.footerHtml||''}</div></div>`);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    function close(){ backdrop.remove(); }
    backdrop.addEventListener('mousedown', e=>{ if(e.target===backdrop) close(); });
    qsa('[data-stacked-close]', modal).forEach(b=>b.addEventListener('click', close));
    if(opts.onMount) opts.onMount(modal, close);
    return { close };
  }

  // The denomination-count modal for one cash-type row. Calling onSave(counted,
  // denominations) is how the table row picks up the result.
  function openCashCountModal(row, currentCounted, currentDenoms, onSave){
    openStackedModal({
      title: `Count cash — ${row.label}`,
      bodyHtml: `
        <p class="small muted mb-12">Expected ${fmtCur(row.expected, row.currency)} (opening ${fmtCur(row.opening, row.currency)} + today's collections ${fmtCur(row.collected, row.currency)}). Count what's actually in the drawer.</p>
        <div class="grid grid-3" id="cc-denom"></div>
        <div class="mt-8"><strong>Counted total: <span id="cc-total">${fmtCur(currentCounted||0, row.currency)}</span></strong></div>
      `,
      footerHtml: `<button class="btn" data-stacked-close>Cancel</button><button class="btn btn-primary" id="cc-save">Save count</button>`,
      onMount(modal, close){
        const box = qs('#cc-denom', modal);
        const seed = currentDenoms && currentDenoms.length ? currentDenoms : DENOMINATIONS.map(v=>({value:v, qty:(suggestDenomQtys(row.expected)[v]||0)}));
        box.innerHTML = DENOMINATIONS.map(v=>{
          const found = seed.find(d=>d.value===v);
          return `<div class="inline-item"><span class="grow">${v>=1?v.toFixed(0):v.toFixed(2)}</span><input type="number" min="0" step="1" value="${found?found.qty:0}" data-denom="${v}" style="width:70px"></div>`;
        }).join('');
        const inputs = qsa('[data-denom]', modal);
        function recalc(){
          const total = inputs.reduce((s,inp)=> s + (parseFloat(inp.dataset.denom)*(parseInt(inp.value)||0)), 0);
          qs('#cc-total', modal).textContent = fmtCur(Ledger.round2(total), row.currency);
        }
        inputs.forEach(inp=>inp.addEventListener('input', recalc));
        recalc();
        qs('#cc-save', modal).addEventListener('click', ()=>{
          const denominations = inputs.map(inp=>({ value: parseFloat(inp.dataset.denom), qty: parseInt(inp.value)||0 }));
          const total = Ledger.round2(denominations.reduce((s,d)=>s+d.value*d.qty,0));
          close();
          onSave(total, denominations);
        });
      }
    });
  }

  function openCloseForm(date){
    if(!Auth.can('DAY_END_CLOSE')){ toast('Only an accountant or admin can close the day.', 'err'); return; }
    const rows = buildRows(date);
    // per-row mutable state carried between the table and the cash-count modal
    const state = rows.map(r=>({ counted: r.expected, denominations: null, note:'' }));

    openModal({
      title: `Close ${fmtDate(date)}`,
      size:'lg',
      bodyHtml: `
        <p class="small muted mb-12">Expected is built only from today's sales &amp; collection receipts — vendor payments, petty cash top-ups and payroll never affect it. Cash carries its opening float from the last close; every other method starts the day at zero.</p>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Method</th><th class="num">Expected</th><th>Counted</th><th class="num">Variance</th><th>Note</th></tr></thead>
          <tbody id="de-rows"></tbody>
        </table></div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="de-save">Lock the day</button>`,
      onMount(modal){
        function renderRows(){
          qs('#de-rows', modal).innerHTML = rows.map((r,i)=>{
            const s = state[i];
            const variance = Ledger.round2((s.counted||0)-r.expected);
            const showNote = Math.abs(variance)>0.004;
            return `<tr data-row="${i}">
              <td>${esc(r.label)}</td>
              <td class="num">${fmtCur(r.expected, r.currency)}</td>
              <td>${r.cashType
                  ? `<div class="flex-gap"><strong id="de-counted-disp-${i}">${fmtCur(s.counted||0, r.currency)}</strong><button type="button" class="btn btn-sm" data-count="${i}">Count cash</button></div>`
                  : `<input type="number" step="0.01" id="de-counted-${i}" value="${s.counted}" style="max-width:140px">`}
              </td>
              <td class="num" id="de-var-${i}" style="color:${showNote?'var(--danger)':'inherit'}">${fmtCur(variance, r.currency)}</td>
              <td>${showNote ? `<input type="text" id="de-note-${i}" placeholder="Reason for variance" value="${esc(s.note)}" style="min-width:160px">` : '<span class="muted small">—</span>'}</td>
            </tr>`;
          }).join('');
          qsa('[data-count]', modal).forEach(btn=>btn.addEventListener('click', ()=>{
            const i = +btn.dataset.count;
            openCashCountModal(rows[i], state[i].counted, state[i].denominations, (total, denoms)=>{
              state[i].counted = total; state[i].denominations = denoms;
              renderRows();
            });
          }));
          rows.forEach((r,i)=>{
            if(!r.cashType){
              const inp = qs(`#de-counted-${i}`, modal);
              if(inp) inp.addEventListener('input', ()=>{ state[i].counted = parseFloat(inp.value)||0; renderRows(); });
            }
            const noteInp = qs(`#de-note-${i}`, modal);
            if(noteInp) noteInp.addEventListener('input', ()=>{ state[i].note = noteInp.value; });
          });
        }
        renderRows();

        qs('#de-save', modal).addEventListener('click', ()=>{
          const methods = [];
          for(let i=0;i<rows.length;i++){
            const r = rows[i], s = state[i];
            const variance = Ledger.round2((s.counted||0)-r.expected);
            if(Math.abs(variance)>0.004 && !(s.note||'').trim()){ toast(`Variance on ${r.label} needs a note before you can lock the day.`, 'err'); return; }
            methods.push({
              methodId: r.methodId, method: r.label, label: r.label, currency: r.currency, accountId: r.accountId,
              opening: r.opening, collected: r.collected, expected: r.expected,
              counted: s.counted||0, variance, note: s.note||'', denominations: s.denominations
            });
          }
          const close = Store.insert('dayEndCloses', {
            date, methods, approvedBy: Auth.currentUser().name, status:'OPEN',
            systemCash: Ledger.round2(methods.reduce((s,m)=>s+m.expected,0)),
            countedCash: Ledger.round2(methods.reduce((s,m)=>s+m.counted,0)),
            variance: Ledger.round2(methods.reduce((s,m)=>s+m.variance,0))
          });
          try{
            Posting.postDayEndClose(close);
            closeModal(); toast('Day locked', 'ok'); renderDayEnd({});
          }catch(e){ toast(e.message, 'err'); }
        });
      }
    });
  }

  Router.on('/receipts', renderReceipts);
  Router.on('/dayend', renderDayEnd);
  window.CashModule = { paymentMethods, methodLabel, buildRows };
})();
