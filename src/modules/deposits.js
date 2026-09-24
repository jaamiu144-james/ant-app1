/* ---------------------------------------------------------------------
   deposits.js — deposit / bank reconciliation. Sweeps the Cash on Hand
   (per currency) and Card Clearing balances into the real Bank account
   once the money has actually been banked.

   Note: cash receipts post straight to the per-currency Cash on Hand
   control accounts (1000 MVR / 1001 USD / 1002 EUR), not to a separate
   Undeposited Funds holding account — see Posting.resolveMethodAccountId.
   Card receipts still clear through 1020 Card Clearing until banked.
--------------------------------------------------------------------- */

(function(){

  const SOURCES = [
    { acctCode:'1010', label:'Cash on Hand — MVR' },
    { acctCode:'1011', label:'Cash on Hand — USD' },
    { acctCode:'1012', label:'Cash on Hand — EUR' },
    { acctCode:'1030', label:'Card Clearing' },
  ];

  function render(params){
    setPageTitle('Deposits', 'Finance');
    renderNav();
    const vo = Auth.isViewOnly();
    const rows = Store.all('deposits').slice().sort((a,b)=>b.date.localeCompare(a.date));
    const balances = SOURCES.map(s=>({ ...s, accountId: Store.acctId(s.acctCode), balance: Ledger.accountBalance(Store.acctId(s.acctCode)) }));
    qs('#content').innerHTML = `
      <div class="grid grid-2 mb-16">
        ${balances.map(b=>`<div class="stat"><div class="label">${esc(b.label)}</div><div class="value">${fmtMoney(b.balance)}</div><div class="sub">Awaiting deposit</div></div>`).join('')}
      </div>
      <div class="toolbar"><div class="spacer"></div>${vo?'':`<button class="btn btn-primary" id="dp-new">+ New deposit</button>`}</div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Deposit #</th><th>Date</th><th>To</th><th class="num">Amount</th></tr></thead>
        <tbody>
        ${rows.length ? rows.map(d=>`<tr><td>${esc(d.depositNo)}</td><td>${fmtDate(d.date)}</td><td>${esc((Store.find('accounts', d.toAccountId)||{}).name||'—')}</td><td class="num">${fmtMoney(d.amount)}</td></tr>`).join('')
          : `<tr><td colspan="4" class="table-empty">No deposits recorded yet.</td></tr>`}
        </tbody>
      </table></div>
    `;
    if(qs('#dp-new')) qs('#dp-new').addEventListener('click', ()=>openForm(balances));
  }

  function openForm(balances){
    const targets = [
      { id: Store.acctId('1010'), label:'Cash on Hand' },
      { id: Store.acctId('1060'), label:'Bank Account' },
    ];
    openModal({
      title:'New deposit', size:'lg',
      bodyHtml: `
        <p class="small muted mb-8">Pick how much of each clearing balance was actually banked, and where it landed.</p>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Source</th><th class="num">Available</th><th class="num">Deposit amount</th></tr></thead>
          <tbody>${balances.map((b,i)=>`<tr><td>${esc(b.label)}</td><td class="num">${fmtMoney(b.balance)}</td>
            <td class="num"><input type="number" min="0" step="0.01" max="${Math.max(0,b.balance)}" data-src="${i}" value="${Math.max(0,b.balance)>0?Math.max(0,b.balance):0}" style="width:110px;text-align:right"></td></tr>`).join('')}</tbody>
        </table></div>
        <div class="form-row mt-12">
          <div class="field"><label>Deposit into</label><select id="dp-target">${targets.map(t=>`<option value="${t.id}">${esc(t.label)}</option>`).join('')}</select></div>
          <div class="field"><label>Date</label><input id="dp-date" type="date" value="${todayISO()}"></div>
        </div>
        <div class="field"><label>Total</label><input id="dp-total" type="text" readonly style="background:#f4f2ea;font-weight:600"></div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="dp-save">Post deposit</button>`,
      onMount(modal){
        function updateTotal(){
          const total = balances.reduce((s,b,i)=> s + (parseFloat(qs(`[data-src="${i}"]`, modal).value)||0), 0);
          qs('#dp-total', modal).value = fmtMoney(Ledger.round2(total));
        }
        qsa('[data-src]', modal).forEach(inp=>inp.addEventListener('input', updateTotal));
        updateTotal();
        qs('#dp-save', modal).addEventListener('click', ()=>{
          if(!Auth.can('POST_DEPOSIT')){ toast('Only an accountant or admin can post a deposit.', 'err'); return; }
          const lines = balances.map((b,i)=>({ fromAccountId: b.accountId, amount: Ledger.round2(parseFloat(qs(`[data-src="${i}"]`, modal).value)||0) })).filter(l=>l.amount>0.004);
          if(!lines.length){ toast('Enter at least one deposit amount.', 'err'); return; }
          const deposit = Store.insert('deposits', { depositNo: Store.docNo('DEP','deposit'), date: qs('#dp-date', modal).value||todayISO(), toAccountId: qs('#dp-target', modal).value, lines, amount:0 });
          try{ Posting.postDeposit(deposit); closeModal(); toast('Deposit posted', 'ok'); render({}); }
          catch(e){ toast(e.message, 'err'); Store.remove('deposits', deposit.id); }
        });
      }
    });
  }

  Router.on('/deposits', render);
})();
