/* ---------------------------------------------------------------------
   reconciliation.js — bank/cash account reconciliation. Standard QuickBooks-
   style workflow: pick an account, enter the bank/card statement's end date
   and ending balance, tick off which posted lines actually cleared, and
   finish once the cleared balance matches the statement (or the difference
   is explicitly explained). This never posts a journal entry — it only
   marks existing lines `reconciled`, which then protects their journal
   entry from Ledger.reverse(), mirroring the day-end close's date-lock in
   spirit (a reconciliation lock instead of a date lock).
--------------------------------------------------------------------- */

(function(){

  // Any balance-sheet account can be reconciled against a statement; a Bank/
  // Cash account is the common case, but AR/AP control accounts work too
  // (e.g. tying out to an agent's statement).
  function reconcilableAccounts(){
    return Store.all('accounts')
      .filter(a=>a.active && ['ASSET','LIABILITY'].includes(a.type))
      .sort((a,b)=>a.code.localeCompare(b.code));
  }

  function lastReconciliation(accountId){
    const list = Store.where('reconciliations', r=>r.accountId===accountId).sort((a,b)=>b.statementDate.localeCompare(a.statementDate));
    return list[0] || null;
  }

  function historyFor(accountId){
    return Store.where('reconciliations', r=>r.accountId===accountId).sort((a,b)=>b.statementDate.localeCompare(a.statementDate));
  }

  /* ---------------- LIST / PICKER ---------------- */
  function render(params){
    setPageTitle('Reconciliation', 'Finance');
    renderNav();
    const accounts = reconcilableAccounts();
    const accId = params.account || null;
    if(accId) return renderAccountWorkspace(accId);

    qs('#content').innerHTML = `
      <div class="help-box mb-16">Reconciling ties this app's books to a real statement (bank, card processor, an agent's running account). It never creates a posting — it only marks the lines that appear on the statement as cleared, then locks them from being reversed.</div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Code</th><th>Account</th><th class="num">Book balance</th><th>Last reconciled</th><th></th></tr></thead>
        <tbody>
        ${accounts.map(a=>{
          const last = lastReconciliation(a.id);
          return `<tr>
            <td class="mono">${esc(a.code)}</td><td>${esc(a.name)} ${a.accountType?`<span class="badge badge-gray">${esc(a.accountType)}</span>`:''}</td>
            <td class="num">${fmtMoney(Ledger.accountBalance(a.id))}</td>
            <td>${last? fmtDate(last.statementDate) : '<span class="muted">Never</span>'}</td>
            <td class="row-actions"><button class="btn btn-sm btn-primary" data-open="${a.id}">Reconcile</button></td>
          </tr>`;
        }).join('') || `<tr><td colspan="5" class="table-empty">No balance-sheet accounts to reconcile.</td></tr>`}
        </tbody>
      </table></div>
    `;
    qsa('[data-open]').forEach(b=>b.addEventListener('click', ()=>Router.navigate('reconcile?account='+b.dataset.open)));
  }

  /* ---------------- PER-ACCOUNT WORKSPACE ---------------- */
  // Module-scope state for the in-progress reconciliation on this account —
  // reset whenever a fresh one is started.
  let inProgress = null; // { accountId, statementDate, statementBalance, opening, checked:Set }

  function renderAccountWorkspace(accountId){
    const acc = Store.find('accounts', accountId);
    if(!acc){ Router.navigate('reconcile'); return; }
    setPageTitle('Reconcile — '+acc.name, 'Finance');
    renderNav();
    const history = historyFor(accountId);
    const last = history[0] || null;

    if(inProgress && inProgress.accountId===accountId){
      return renderChecklist(acc);
    }

    qs('#content').innerHTML = `
      <p class="linkbtn mb-12" onclick="Router.navigate('reconcile')">&larr; All accounts</p>
      <div class="grid grid-3 mb-16">
        <div class="stat"><div class="label">Book balance</div><div class="value">${fmtMoney(Ledger.accountBalance(accountId))}</div></div>
        <div class="stat"><div class="label">Last reconciled</div><div class="value" style="font-size:16px">${last?fmtDate(last.statementDate):'Never'}</div><div class="sub">${last?fmtMoney(last.statementBalance):''}</div></div>
        <div class="stat"><div class="label">Reconciliations on file</div><div class="value">${history.length}</div></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Start a reconciliation</h2></div>
        <div class="form-row">
          <div class="field"><label>Statement end date</label><input id="rc-date" type="date" value="${todayISO()}"></div>
          <div class="field"><label>Statement ending balance</label><input id="rc-bal" type="number" step="0.01" value=""></div>
        </div>
        <p class="small muted mb-12">Beginning balance will be ${fmtMoney(Ledger.reconciledBalanceAsOf(accountId, last?last.statementDate:null))} — the balance of everything already reconciled${last?` through ${fmtDate(last.statementDate)}`:''}.</p>
        <button class="btn btn-primary" id="rc-start">Start reconciling</button>
      </div>
      <div class="card">
        <div class="card-head"><h2>History</h2></div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Statement date</th><th class="num">Opening</th><th class="num">Statement balance</th><th class="num">Cleared</th><th>Reconciled</th><th></th></tr></thead>
          <tbody>${history.length ? history.map(r=>`<tr>
            <td>${fmtDate(r.statementDate)}</td><td class="num">${fmtMoney(r.openingBalance)}</td><td class="num">${fmtMoney(r.statementBalance)}</td>
            <td class="num">${fmtMoney(r.clearedTotal)}</td><td>${fmtDateTime(r.createdAt)}</td>
            <td class="row-actions"><button class="btn btn-sm" data-report="${r.id}">Report</button></td>
          </tr>`).join('') : `<tr><td colspan="6" class="table-empty">No reconciliations yet for this account.</td></tr>`}</tbody>
        </table></div>
      </div>
    `;
    qs('#rc-start').addEventListener('click', ()=>{
      if(!Auth.can('RECONCILE_ACCOUNT')){ toast('Only an accountant or admin can reconcile an account.', 'err'); return; }
      const statementDate = qs('#rc-date').value || todayISO();
      const statementBalance = parseFloat(qs('#rc-bal').value);
      if(isNaN(statementBalance)){ toast('Enter the statement ending balance.', 'err'); return; }
      inProgress = {
        accountId, statementDate, statementBalance,
        opening: Ledger.reconciledBalanceAsOf(accountId, last?last.statementDate:null),
        checked: new Set()
      };
      Router.render();
    });
    qsa('[data-report]').forEach(b=>b.addEventListener('click', ()=>openReport(Store.find('reconciliations', b.dataset.report))));
  }

  function renderChecklist(acc){
    const st = inProgress;
    const candidates = Ledger.unreconciledEntriesForAccount(acc.id, st.statementDate);
    const natural = ['ASSET','EXPENSE'].includes(acc.type) ? 'DEBIT' : 'CREDIT';
    function signedAmt(line){ return natural==='DEBIT' ? Ledger.round2(line.debit-line.credit) : Ledger.round2(line.credit-line.debit); }

    function clearedTotal(){
      let t = st.opening;
      candidates.forEach((c,i)=>{ if(st.checked.has(i)) t = Ledger.round2(t + signedAmt(c.line)); });
      return t;
    }

    function paint(){
      const cleared = clearedTotal();
      const diff = Ledger.round2(st.statementBalance - cleared);
      qs('#rc-cleared').textContent = fmtMoney(cleared);
      qs('#rc-diff').textContent = fmtMoney(diff);
      qs('#rc-diff').style.color = Math.abs(diff)>0.004 ? 'var(--danger)' : 'var(--success)';
      qs('#rc-finish').disabled = false;
      qs('#rc-note-wrap').style.display = Math.abs(diff)>0.004 ? '' : 'none';
    }

    qs('#content').innerHTML = `
      <p class="linkbtn mb-12" onclick="(function(){})()" id="rc-cancel">&larr; Cancel this reconciliation</p>
      <div class="recon-summary">
        <div class="stat"><div class="label">Beginning balance</div><div class="value" style="font-size:18px">${fmtMoney(st.opening)}</div></div>
        <div class="stat"><div class="label">Statement balance</div><div class="value" style="font-size:18px">${fmtMoney(st.statementBalance)}</div></div>
        <div class="stat"><div class="label">Cleared balance</div><div class="value" style="font-size:18px" id="rc-cleared">${fmtMoney(st.opening)}</div></div>
        <div class="stat"><div class="label">Difference</div><div class="value" style="font-size:18px" id="rc-diff">${fmtMoney(Ledger.round2(st.statementBalance-st.opening))}</div></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Tick off everything that appears on the statement</h2><div class="sub">Through ${fmtDate(st.statementDate)} · ${candidates.length} not yet reconciled</div></div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th></th><th>Date</th><th>Description</th><th class="num">Amount</th></tr></thead>
          <tbody>${candidates.length ? candidates.map((c,i)=>`<tr>
            <td><input type="checkbox" data-chk="${i}"></td>
            <td>${fmtDate(c.je.date)}</td><td>${esc(c.je.description)}${c.line.memo?' — '+esc(c.line.memo):''}</td>
            <td class="num">${fmtMoney(signedAmt(c.line))}</td>
          </tr>`).join('') : `<tr><td colspan="4" class="table-empty">Nothing posted to this account before ${fmtDate(st.statementDate)} is left unreconciled.</td></tr>`}</tbody>
        </table></div>
        <div class="field mt-16" id="rc-note-wrap" style="display:none">
          <label>Explain the discrepancy</label>
          <input id="rc-note" type="text" placeholder="e.g. a deposit in transit, a bank fee not yet entered">
        </div>
        <button class="btn btn-primary mt-12" id="rc-finish">Finish reconciliation</button>
      </div>
    `;
    qs('#rc-cancel').addEventListener('click', ()=>{ inProgress=null; Router.render(); });
    qsa('[data-chk]').forEach(cb=>cb.addEventListener('change', e=>{
      const i = +e.target.dataset.chk;
      if(e.target.checked) st.checked.add(i); else st.checked.delete(i);
      paint();
    }));
    paint();

    qs('#rc-finish').addEventListener('click', ()=>{
      const cleared = clearedTotal();
      const diff = Ledger.round2(st.statementBalance - cleared);
      const note = (qs('#rc-note')?qs('#rc-note').value:'').trim();
      if(Math.abs(diff)>0.004 && !note){
        toast('The cleared balance doesn\'t match the statement — tick the missing items, or explain the difference before finishing.', 'err');
        return;
      }
      const lineRefs = [];
      candidates.forEach((c,i)=>{ if(st.checked.has(i)) lineRefs.push({ journalEntryId: c.je.id, lineIndex: c.je.lines.indexOf(c.line), date: c.je.date, amount: signedAmt(c.line), description: c.je.description }); });
      const rec = Store.insert('reconciliations', {
        accountId: acc.id, statementDate: st.statementDate, statementBalance: st.statementBalance,
        openingBalance: st.opening, clearedTotal: cleared, discrepancy: diff, note,
        lineRefs, createdBy: (Auth.currentUser()||{}).name || ''
      });
      Ledger.markLinesReconciled(lineRefs.map(r=>({journalEntryId:r.journalEntryId, lineIndex:r.lineIndex})), rec.id);
      inProgress = null;
      toast('Reconciliation finished — '+lineRefs.length+' item(s) locked', 'ok');
      Router.navigate('reconcile?account='+acc.id);
      openReport(rec);
    });
  }

  function openReport(rec){
    if(!rec) return;
    const acc = Store.find('accounts', rec.accountId);
    openModal({
      title: 'Reconciliation report — '+(acc?acc.name:''),
      size:'lg',
      bodyHtml: `
        <div class="kv mb-12">
          <dt>Statement date</dt><dd>${fmtDate(rec.statementDate)}</dd>
          <dt>Opening balance</dt><dd>${fmtMoney(rec.openingBalance)}</dd>
          <dt>Statement balance</dt><dd>${fmtMoney(rec.statementBalance)}</dd>
          <dt>Cleared balance</dt><dd>${fmtMoney(rec.clearedTotal)}</dd>
          <dt>Discrepancy</dt><dd>${fmtMoney(rec.discrepancy||0)}${rec.note?' — '+esc(rec.note):''}</dd>
          <dt>Reconciled</dt><dd>${fmtDateTime(rec.createdAt)}${rec.createdBy?' by '+esc(rec.createdBy):''}</dd>
        </div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th></tr></thead>
          <tbody>${(rec.lineRefs||[]).map(l=>`<tr><td>${fmtDate(l.date)}</td><td>${esc(l.description)}</td><td class="num">${fmtMoney(l.amount)}</td></tr>`).join('') || `<tr><td colspan="3" class="table-empty">No items cleared.</td></tr>`}</tbody>
        </table></div>
      `,
      footerHtml: `<button class="btn" id="rc-report-csv">Export CSV</button><button class="btn btn-primary" data-close>Close</button>`,
      onMount(modal){
        qs('#rc-report-csv', modal).addEventListener('click', ()=>{
          const csv = toCsv(['Date','Description','Amount'], (rec.lineRefs||[]).map(l=>[fmtDate(l.date), l.description, l.amount]));
          downloadFile('reconciliation-'+rec.statementDate+'.csv', csv, 'text/csv');
        });
      }
    });
  }

  Router.on('/reconcile', render);
  window.ReconciliationModule = { reconcilableAccounts };
})();
