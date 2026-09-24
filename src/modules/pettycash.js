/* ---------------------------------------------------------------------
   pettycash.js — petty cash on the imprest system, one or more floats.
   A float is pure control data (float #, purpose, custodian, fixed
   imprest value) plus its own GL sub-account under 1020 Petty Cash —
   creating or editing a float never posts anything. Money only moves
   into a float through a Bank voucher: the initial deposit and every
   later replenishment are both Bank vouchers (debit the float's account,
   credit 1060 Bank Account), approved the same way as any other payment.
   Each expense out of the box posts immediately as a PETTY voucher
   against that float; replenishing tops the box back up to its float.
--------------------------------------------------------------------- */

(function(){

  function floats(){ return Store.all('pettyCashFloats'); }
  function activeFloats(){ return floats().filter(f=>f.active!==false); }

  function render(params){
    setPageTitle('Petty cash', 'Finance');
    renderNav();
    const fs = floats();
    if(params.float){
      const f = Store.find('pettyCashFloats', params.float);
      if(f){ renderFloatDetail(f); return; }
    }
    const vo = Auth.isViewOnly();
    qs('#content').innerHTML = `
      <div class="toolbar"><div class="spacer"></div>${vo?'':`<button class="btn btn-primary" id="pc-new-float">+ New float</button>`}</div>
      <div class="card">
        <div class="card-head"><h2>Petty cash floats</h2></div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Float #</th><th>Purpose</th><th>Custodian</th><th class="num">Fixed float</th><th class="num">Ledger balance</th><th>Status</th></tr></thead>
          <tbody>
          ${fs.length ? fs.map(f=>{
            const bal = f.accountId ? Ledger.accountBalance(f.accountId) : 0;
            const funded = !!f.fundedAt || bal>0.004;
            return `<tr style="cursor:pointer" data-float="${f.id}">
              <td><strong>${esc(f.floatNo)}</strong></td><td>${esc(f.purpose||'—')}</td><td>${esc(f.custodian||'—')}</td>
              <td class="num">${fmtMoney(f.imprestAmount)}</td><td class="num">${fmtMoney(bal)}</td>
              <td>${funded ? (f.active===false?'<span class="badge badge-gray">Inactive</span>':'<span class="badge badge-green">Active</span>') : '<span class="badge badge-amber">Not yet funded</span>'}</td>
            </tr>`;
          }).join('')
            : `<tr><td colspan="6" class="table-empty">No petty cash floats yet — ${vo?'ask an admin to set one up.':'create one to get started.'}</td></tr>`}
          </tbody>
        </table></div>
      </div>
    `;
    if(qs('#pc-new-float')) qs('#pc-new-float').addEventListener('click', ()=>openFloatForm());
    qsa('[data-float]').forEach(r=>r.addEventListener('click', ()=>Router.navigate('pettycash?float='+r.dataset.float)));
  }

  function renderFloatDetail(f){
    const vo = Auth.isViewOnly();
    const ledgerBalance = f.accountId ? Ledger.accountBalance(f.accountId) : 0;
    const unreplenished = Store.all('vouchers').filter(v=>v.kind==='PETTY' && v.floatId===f.id && v.status==='PAID' && !v.replenishedInVoucherId);
    const unreplenishedTotal = Ledger.round2(unreplenished.reduce((s,v)=>s+v.amount,0));
    const replenishments = Store.all('vouchers').filter(v=>v.kind==='BANK_CASH' && v.isReplenishment && v.floatId===f.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    const funded = !!f.fundedAt || ledgerBalance>0.004 || replenishments.length>0;

    qs('#content').innerHTML = `
      <div class="toolbar"><button class="btn" onclick="Router.navigate('pettycash')">&larr; All floats</button><div class="spacer"></div>
        ${vo?'':`<button class="btn" id="pc-edit-float">Edit float</button>`}
      </div>
      <div class="grid grid-3 mb-16">
        <div class="stat"><div class="label">Fixed float — ${esc(f.floatNo)}</div><div class="value">${fmtMoney(f.imprestAmount)}</div><div class="sub">Custodian: ${esc(f.custodian||'—')}</div></div>
        <div class="stat"><div class="label">Ledger balance now</div><div class="value">${fmtMoney(ledgerBalance)}</div><div class="sub">${!funded?'Not yet funded':(ledgerBalance<f.imprestAmount-0.01?'Below float — replenish when convenient':'At or above float')}</div></div>
        <div class="stat"><div class="label">Since last top-up</div><div class="value">${fmtMoney(unreplenishedTotal)}</div><div class="sub">${unreplenished.length} expense(s)</div></div>
      </div>
      ${!funded ? `<div class="hint mb-16">This float has been set up but not funded yet. Fund it with a Bank voucher before recording expenses against it.</div>` : ''}
      <div class="toolbar">
        <div class="spacer"></div>
        <button class="btn" id="pc-count">Count &amp; reconcile</button>
        ${vo?'':`
        ${!funded ? `<button class="btn btn-primary" id="pc-fund">Fund float (Bank voucher, ${fmtMoney(f.imprestAmount)})</button>`
                  : `<button class="btn btn-sand" id="pc-replenish" ${unreplenished.length?'':'disabled'}>Replenish (${fmtMoney(unreplenishedTotal)}) — Bank voucher</button>
        <button class="btn btn-primary" id="pc-expense" ${f.active===false?'disabled':''}>+ Petty expense</button>`}`}
      </div>
      <div class="card">
        <div class="card-head"><h2>Expenses since last top-up</h2></div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Voucher #</th><th>Date</th><th>Paid to</th><th>Account</th><th class="num">Amount</th></tr></thead>
          <tbody>
          ${unreplenished.length ? unreplenished.map(v=>{
            const line = (v.lines||[])[0]||{};
            return `<tr><td>${esc(v.voucherNo)}</td><td>${fmtDate(v.date)}</td><td>${esc(v.payee||'')}</td><td>${esc((Store.find('accounts', line.accountId)||{}).name||'')}</td><td class="num">${fmtMoney(v.amount)}</td></tr>`;
          }).join('')
            : `<tr><td colspan="5" class="table-empty">No expenses since the last top-up.</td></tr>`}
          </tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Bank voucher history (deposits &amp; replenishments)</h2></div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Voucher #</th><th>Date</th><th>Status</th><th class="num">Amount</th></tr></thead>
          <tbody>
          ${replenishments.length ? replenishments.map(v=>`<tr><td>${esc(v.voucherNo)}</td><td>${fmtDate(v.date)}</td><td>${v.status==='PAID'?'<span class="badge badge-green">Paid</span>':'<span class="badge badge-amber">Draft</span>'}</td><td class="num">${fmtMoney(v.amount)}</td></tr>`).join('')
            : `<tr><td colspan="4" class="table-empty">No deposits or replenishments yet.</td></tr>`}
          </tbody>
        </table></div>
      </div>
    `;
    if(qs('#pc-edit-float')) qs('#pc-edit-float').addEventListener('click', ()=>openFloatForm(f));
    if(qs('#pc-fund')) qs('#pc-fund').addEventListener('click', ()=>openFundForm(f));
    if(qs('#pc-expense')) qs('#pc-expense').addEventListener('click', ()=>openExpenseForm(f));
    if(qs('#pc-replenish') && !qs('#pc-replenish').disabled) qs('#pc-replenish').addEventListener('click', ()=>openReplenishForm(f, unreplenished, unreplenishedTotal));
    qs('#pc-count').addEventListener('click', ()=>openCountForm(f, ledgerBalance, unreplenishedTotal));
  }

  // Pure control data — float number, purpose, custodian, fixed float value.
  // Saving this never posts a journal entry; a new float starts at zero
  // until it's funded through a Bank voucher (openFundForm).
  function openFloatForm(existing){
    const nextNo = existing ? existing.floatNo : 'PC-'+String((floats().length||0)+1).padStart(3,'0');
    openModal({
      title: existing ? 'Edit petty cash float' : 'New petty cash float',
      bodyHtml: `
        <div class="form-row">
          <div class="field"><label>Float #</label><input id="pf-no" type="text" value="${esc(nextNo)}"></div>
          <div class="field"><label>Fixed float value</label><input id="pf-amt" type="number" min="0" step="0.01" value="${existing?existing.imprestAmount:''}"></div>
        </div>
        <div class="field"><label>Purpose</label><input id="pf-purpose" type="text" placeholder="e.g. Front desk day-to-day expenses" value="${esc(existing?existing.purpose:'')}"></div>
        <div class="field"><label>Custodian</label><input id="pf-cust" type="text" value="${esc(existing?existing.custodian:'')}"></div>
        ${existing ? `<label class="checkline"><input type="checkbox" id="pf-active" ${existing.active!==false?'checked':''}> Active</label>` : ''}
        <p class="hint">${existing ? 'Editing here only updates the control record — it never posts anything.' : 'This just registers the float and creates its own account under Petty Cash. Fund it with a Bank voucher afterwards.'}</p>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="pf-save">Save</button>`,
      onMount(modal){
        qs('#pf-save', modal).addEventListener('click', ()=>{
          const floatNo = qs('#pf-no', modal).value.trim();
          const imprestAmount = parseFloat(qs('#pf-amt', modal).value);
          if(!floatNo){ toast('Enter a float number.', 'err'); return; }
          if(!imprestAmount || imprestAmount<=0){ toast('Enter the fixed float value.', 'err'); return; }
          const purpose = qs('#pf-purpose', modal).value.trim();
          const custodian = qs('#pf-cust', modal).value.trim();
          if(existing){
            Store.update('pettyCashFloats', existing.id, { floatNo, imprestAmount, purpose, custodian, active: qs('#pf-active', modal).checked });
            closeModal(); toast('Float updated', 'ok'); render({float: existing.id});
          } else {
            const acct = Store.insert('accounts', {
              code: nextFloatAccountCode(), name: 'Petty Cash — '+(floatNo||custodian||'Float'),
              type:'ASSET', accountType:'Bank', subtype:'CASH', parentAccountId: Store.acctId('1020'), active:true, system:false
            });
            const f = Store.insert('pettyCashFloats', { floatNo, imprestAmount, purpose, custodian, accountId: acct.id, fundedAt:null, active:true });
            closeModal(); toast('Float created — fund it with a Bank voucher to activate it', 'ok'); render({float: f.id});
          }
        });
      }
    });
  }

  // 1020.1, 1020.2, ... — sits under the 1020 Petty Cash header without
  // colliding with any other standard code.
  function nextFloatAccountCode(){
    const used = new Set(Store.all('accounts').map(a=>a.code));
    let n = 1;
    while(used.has('1020.'+n)) n++;
    return '1020.'+n;
  }

  // Both the very first deposit and every later top-up are a Bank voucher:
  // debit this float's account, credit 1060 Bank Account. Only an
  // accountant/admin can approve it, same as any other outgoing payment.
  function fundVoucher(f, amount, memo, isReplenishment){
    return VouchersModule.quickCreate('BANK_CASH', {
      payee: f.custodian || f.floatNo, method:'BANK', memo, isReplenishment, floatId: f.id,
      lines:[{ kind:'GL', accountId: f.accountId, description: memo, amount }]
    }, true);
  }

  function openFundForm(f){
    openModal({
      title:'Fund petty cash float',
      bodyHtml: `<p>This posts a Bank voucher for <strong>${fmtMoney(f.imprestAmount)}</strong>, debiting ${esc(f.floatNo)}'s account and crediting Bank Account.</p>`,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="pf2-save">Approve &amp; pay</button>`,
      onMount(modal){
        qs('#pf2-save', modal).addEventListener('click', ()=>{
          if(!Auth.can('APPROVE_VOUCHER')){ toast('Only an accountant or admin can approve this.', 'err'); return; }
          try{
            fundVoucher(f, f.imprestAmount, 'Initial float deposit — '+f.floatNo, false);
            Store.update('pettyCashFloats', f.id, { fundedAt: new Date().toISOString() });
            closeModal(); toast('Float funded from the bank', 'ok'); render({float: f.id});
          }catch(e){ toast(e.message, 'err'); }
        });
      }
    });
  }

  function openExpenseForm(f){
    const expenseAccounts = Store.all('accounts').filter(a=>a.type==='EXPENSE' && a.active);
    openModal({
      title:'Petty cash expense — '+f.floatNo,
      bodyHtml: `
        <div class="field"><label>Paid to</label><input id="pe-payee" type="text"></div>
        <div class="field"><label>Expense account</label><select id="pe-acct">${expenseAccounts.map(a=>`<option value="${a.id}">${esc(a.code)} — ${esc(a.name)}</option>`).join('')}</select></div>
        <div class="form-row">
          <div class="field"><label>Date</label><input id="pe-date" type="date" value="${todayISO()}"></div>
          <div class="field"><label>Amount</label><input id="pe-amt" type="number" min="0" step="0.01"></div>
        </div>
        <div class="field"><label>Receipt / memo</label><input id="pe-memo" type="text" placeholder="Receipt number or note"></div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="pe-save">Record expense</button>`,
      onMount(modal){
        qs('#pe-save', modal).addEventListener('click', ()=>{
          const amount = parseFloat(qs('#pe-amt', modal).value);
          const payeeName = qs('#pe-payee', modal).value.trim();
          if(!payeeName || !amount || amount<=0){ toast('Enter who was paid and an amount.', 'err'); return; }
          try{
            VouchersModule.quickCreate('PETTY', {
              payee: payeeName, date: qs('#pe-date', modal).value||todayISO(), method:'CASH', floatId: f.id,
              memo: qs('#pe-memo', modal).value.trim(),
              lines:[{ kind:'GL', accountId: qs('#pe-acct', modal).value, description: qs('#pe-memo', modal).value.trim(), amount }]
            }, true);
            closeModal(); toast('Expense posted', 'ok'); render({float: f.id});
          }catch(e){ toast(e.message, 'err'); }
        });
      }
    });
  }

  function openReplenishForm(f, unreplenished, total){
    openModal({
      title:'Replenish petty cash — '+f.floatNo,
      bodyHtml: `<p>This posts a Bank voucher topping the box back up by <strong>${fmtMoney(total)}</strong>, covering ${unreplenished.length} expense(s) since the last top-up — debiting ${esc(f.floatNo)}'s account and crediting Bank Account.</p>`,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="rp-save">Approve &amp; pay</button>`,
      onMount(modal){
        qs('#rp-save', modal).addEventListener('click', ()=>{
          if(!Auth.can('APPROVE_VOUCHER')){ toast('Only an accountant or admin can approve this.', 'err'); return; }
          try{
            const v = fundVoucher(f, total, 'Replenishment — '+f.floatNo, true);
            unreplenished.forEach(u=>Store.update('vouchers', u.id, { replenishedInVoucherId: v.id }));
            closeModal(); toast('Petty cash replenished', 'ok'); render({float: f.id});
          }catch(e){ toast(e.message, 'err'); }
        });
      }
    });
  }

  function openCountForm(f, ledgerBalance, unreplenishedTotal){
    openModal({
      title:'Count petty cash — '+f.floatNo,
      bodyHtml: `
        <dl class="kv mb-12"><dt>Ledger balance</dt><dd>${fmtMoney(ledgerBalance)}</dd><dt>Should equal</dt><dd>Cash in the box + unreplenished vouchers</dd></dl>
        <div class="field"><label>Cash counted in the box</label><input id="cc-cash" type="number" min="0" step="0.01"></div>
        <div id="cc-result"></div>
      `,
      footerHtml: `<button class="btn" data-close>Close</button>`,
      onMount(modal){
        qs('#cc-cash', modal).addEventListener('input', (e)=>{
          const counted = parseFloat(e.target.value)||0;
          const box = qs('#cc-result', modal);
          const diff = Ledger.round2(counted - ledgerBalance);
          box.innerHTML = Math.abs(diff)<0.01
            ? `<div class="help-box mt-8">Box matches the ledger.</div>`
            : `<div class="warn-box mt-8">Variance of ${fmtMoney(diff)} against the ledger balance. Record any correction as a petty expense (shortage) or note it for review.</div>`;
        });
      }
    });
  }

  window.PettyCashModule = { activeFloats };
  Router.on('/pettycash', render);
})();
