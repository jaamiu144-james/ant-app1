/* ---------------------------------------------------------------------
   reports.js — the Reports suite: a categorized landing page (Business
   overview / Who owes you / What you owe / Accountant) plus the standard
   set of financial reports (P&L, Balance Sheet, Trial Balance, a simplified
   Statement of Cash Flows, AR/AP aging, General Ledger) alongside the
   existing Trip P&L, Equipment usage, Customer, Vendor and Tax reports.
   Everything here reads from the ledger (or bills/bookings for aging), so
   it always agrees with the journal — nothing is entered directly.
--------------------------------------------------------------------- */

(function(){

  const AGING_BUCKETS = ['Current','1-30','31-60','61-90','90+'];

  /* ---------------- shared: date-range presets ---------------- */
  function monthBounds(d){ return [d.slice(0,8)+'01', d]; }
  function presetRange(preset){
    const t = todayISO();
    const now = new Date(t+'T00:00:00');
    const y = now.getFullYear(), m = now.getMonth();
    const pad = n=>String(n).padStart(2,'0');
    const iso = (yy,mm,dd)=> `${yy}-${pad(mm+1)}-${pad(dd)}`;
    const lastDayOfMonth = (yy,mm)=> new Date(yy, mm+1, 0).getDate();
    switch(preset){
      case 'THIS_MONTH': return [iso(y,m,1), t];
      case 'LAST_MONTH': { const mm = m===0?11:m-1, yy = m===0?y-1:y; return [iso(yy,mm,1), iso(yy,mm,lastDayOfMonth(yy,mm))]; }
      case 'THIS_QUARTER': { const q = Math.floor(m/3); return [iso(y,q*3,1), t]; }
      case 'THIS_YEAR': return [iso(y,0,1), t];
      case 'LAST_YEAR': return [iso(y-1,0,1), iso(y-1,11,31)];
      default: return [iso(y,m,1), t];
    }
  }
  // shifts a [from,to] range back by its own length, for "compare to previous period"
  function previousRange(from, to){
    const f = new Date(from+'T00:00:00'), t = new Date(to+'T00:00:00');
    const days = Math.max(1, Math.round((t-f)/86400000)+1);
    const prevTo = new Date(f); prevTo.setDate(prevTo.getDate()-1);
    const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate()-(days-1));
    const iso = d=>d.toISOString().slice(0,10);
    return [iso(prevFrom), iso(prevTo)];
  }
  function dateRangeBar(prefix, from, to, extra){
    const presets = [['THIS_MONTH','This month'],['LAST_MONTH','Last month'],['THIS_QUARTER','This quarter'],['THIS_YEAR','This year'],['LAST_YEAR','Last year']];
    return `<div class="drange mb-16">
      <div class="pill-select">${presets.map(([k,l])=>`<span class="pill" data-preset="${prefix}:${k}">${l}</span>`).join('')}</div>
      <span class="muted small">from</span><input type="date" id="${prefix}-from" value="${from}">
      <span class="muted small">to</span><input type="date" id="${prefix}-to" value="${to}">
      <button class="btn btn-sm" id="${prefix}-apply">Apply</button>
      ${extra||''}
    </div>`;
  }
  function wireDateRangeBar(prefix, onApply){
    qsa(`[data-preset^="${prefix}:"]`).forEach(p=>p.addEventListener('click', ()=>{
      const [from,to] = presetRange(p.dataset.preset.split(':')[1]);
      qs(`#${prefix}-from`).value = from; qs(`#${prefix}-to`).value = to;
      onApply(from,to);
    }));
    qs(`#${prefix}-apply`).addEventListener('click', ()=> onApply(qs(`#${prefix}-from`).value, qs(`#${prefix}-to`).value));
  }

  /* ---------------- shared: drill-down modal ---------------- */
  function drillHtml(label, amount, attrs){
    return `<span class="drill" data-drill="${attrs}">${fmtMoney(amount)}</span>`;
  }
  function openEntriesModal(title, entries){
    openModal({
      title, size:'lg',
      bodyHtml: entries.length ? `<div class="table-wrap"><table class="t">
        <thead><tr><th>Date</th><th>Ref</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${entries.map(({je,line})=>`<tr><td>${fmtDate(je.date)}</td><td class="mono">${esc(je.ref)}</td><td>${esc(je.description)}</td>
          <td class="num">${line.debit?fmtMoney(line.debit):''}</td><td class="num">${line.credit?fmtMoney(line.credit):''}</td></tr>`).join('')}</tbody>
      </table></div>` : `<p class="muted">No transactions.</p>`,
      footerHtml: `<button class="btn" data-close>Close</button>`
    });
  }
  function wireDrillDowns(root, resolver){
    qsa('[data-drill]', root||document).forEach(el=>el.addEventListener('click', ()=>{
      const { title, entries } = resolver(el.dataset.drill);
      openEntriesModal(title, entries);
    }));
  }
  function entriesForAccountInRange(accountId, from, to){
    return Ledger.entriesForAccount(accountId, to, from);
  }

  /* ---------------- landing ---------------- */
  function tabAllowed(t){
    return !(window.EditionGuard && typeof EditionGuard.isReportTabAllowed==='function') || EditionGuard.isReportTabAllowed(t);
  }

  function render(params){
    setPageTitle('Reports', '');
    renderNav();
    let tab = params.sub || 'menu';
    if(!tabAllowed(tab)) tab = 'menu';
    const ALL_TABS = [
      {t:'menu', label:'Overview'},
      {t:'pnl', label:'Profit &amp; loss'},
      {t:'bs', label:'Balance sheet'},
      {t:'tb', label:'Trial balance'},
      {t:'cashflow', label:'Cash flow'},
      {t:'gl', label:'General ledger'},
      {t:'araging', label:'AR aging'},
      {t:'apaging', label:'AP aging'},
      {t:'customers', label:'Customers'},
      {t:'vendors', label:'Vendors'},
      {t:'tax', label:'Tax'},
      {t:'trips', label:'Trip P&amp;L'},
      {t:'equipment', label:'Equipment usage'},
    ];
    qs('#content').innerHTML = `
      <div class="tabs">
        ${ALL_TABS.filter(x=>tabAllowed(x.t)).map(x=>`<div class="tab ${tab===x.t?'active':''}" data-tab="${x.t}">${x.label}</div>`).join('')}
      </div>
      <div id="rp-body"></div>
    `;
    qsa('[data-tab]').forEach(t=>t.addEventListener('click', ()=>Router.navigate('reports/x/'+t.dataset.tab)));
    const map = {
      menu: renderMenu, pnl: renderPnL, bs: renderBS, tb: renderTB, cashflow: renderCashFlow,
      gl: renderGL, araging: renderARAging, apaging: renderAPAging,
      customers: renderCustomers, vendors: renderVendors, tax: renderTax,
      trips: renderTripPnL, equipment: renderEquipmentUsage
    };
    (map[tab]||renderMenu)();
  }

  function renderMenu(){
    const asOf = todayISO();
    const tb = Ledger.trialBalance(asOf);
    const tbDebit = Ledger.round2(tb.reduce((s,r)=>s+r.debit,0));
    const tbCredit = Ledger.round2(tb.reduce((s,r)=>s+r.credit,0));
    const is = Ledger.incomeStatement(null, asOf);
    const arTotal = Ledger.round2(Store.all('accounts').filter(a=>a.accountType==='Accounts Receivable' && a.parentAccountId).reduce((s,a)=>s+Ledger.accountBalance(a.id),0));
    const apTotal = -Ledger.accountBalance(Store.acctId('2000'));

    const cats = [
      { title:'Business overview', items:[
        ['pnl','Profit & loss','Income and expenses over a period'],
        ['bs','Balance sheet','Assets, liabilities and equity as of a date'],
        ['tb','Trial balance','Every account\'s debit/credit balance'],
        ['cashflow','Statement of cash flows','Simplified indirect-method cash flow'],
        ['trips','Trip P&L','Revenue and cost per trip'],
        ['equipment','Equipment usage','Gear issue counts'],
      ]},
      { title:'Who owes you (AR)', items:[
        ['araging','AR aging summary & detail','Outstanding customer balances by age'],
        ['customers','Customer report','Bookings, sales and balance per customer'],
      ]},
      { title:'What you owe (AP)', items:[
        ['apaging','AP aging summary & detail','Outstanding vendor bills by age'],
        ['vendors','Vendor report','Bills, payments and balance per vendor'],
      ]},
      { title:'Accountant', items:[
        ['gl','General ledger','Per-account activity with running balance'],
        ['tb','Trial balance','Every account\'s debit/credit balance'],
        ['tax','Tax','Output/input tax and periods filed'],
        ['journal','Journal report','Chronological list of every posting (opens Journal entries)'],
      ]},
    ];

    qs('#rp-body').innerHTML = `
      <div class="grid grid-4 mb-16">
        <div class="stat"><div class="label">Net income (all time)</div><div class="value">${fmtMoney(is.netIncome)}</div></div>
        <div class="stat"><div class="label">Trial balance</div><div class="value" style="color:${Math.abs(tbDebit-tbCredit)<0.01?'var(--success)':'var(--danger)'}">${Math.abs(tbDebit-tbCredit)<0.01?'Balanced':'Out of balance'}</div></div>
        <div class="stat"><div class="label">Total receivable</div><div class="value">${fmtMoney(arTotal)}</div></div>
        <div class="stat"><div class="label">Total payable</div><div class="value">${fmtMoney(apTotal)}</div></div>
      </div>
      <div class="report-menu">
        ${cats.map(c=>`<div class="report-menu-cat"><h3>${esc(c.title)}</h3>
          ${c.items.map(([key,name,sub])=>`<div class="report-menu-link" data-goto="${key}"><span><span class="rm-name">${esc(name)}</span><br><span class="sub">${esc(sub)}</span></span><span>&rarr;</span></div>`).join('')}
        </div>`).join('')}
      </div>
      <p class="linkbtn mt-16" onclick="Router.navigate('journal')">Open the full journal entries list &rarr;</p>
    `;
    qsa('[data-goto]').forEach(el=>el.addEventListener('click', ()=>{
      if(el.dataset.goto==='journal') Router.navigate('journal');
      else Router.navigate('reports/x/'+el.dataset.goto);
    }));
  }

  /* ---------------- PROFIT & LOSS ---------------- */
  const pnlState = { from:null, to:null, compare:false };
  function renderPnL(){
    if(!pnlState.from){ const [f,t] = presetRange('THIS_MONTH'); pnlState.from=f; pnlState.to=t; }
    paintPnL();
  }
  function paintPnL(){
    const { from, to, compare } = pnlState;
    const is = Ledger.incomeStatement(from, to);
    let prevIs = null, prevFrom, prevTo;
    if(compare){ [prevFrom, prevTo] = previousRange(from, to); prevIs = Ledger.incomeStatement(prevFrom, prevTo); }
    function lineRow(l, prevMap){
      const prev = prevMap ? (prevMap[l.account.id]||0) : null;
      const variance = prev!=null ? Ledger.round2(l.amount-prev) : null;
      return `<tr><td style="padding-left:24px">${esc(l.account.code)} — ${esc(l.account.name)}</td>
        <td class="num">${drillHtml('', l.amount, 'acct:'+l.account.id)}</td>
        ${compare?`<td class="num">${fmtMoney(prev)}</td><td class="num" style="color:${variance>=0?'var(--success)':'var(--danger)'}">${fmtMoney(variance)}</td>`:''}
      </tr>`;
    }
    const prevRevMap = {}, prevExpMap = {};
    if(prevIs){ prevIs.revenueLines.forEach(l=>prevRevMap[l.account.id]=l.amount); prevIs.expenseLines.forEach(l=>prevExpMap[l.account.id]=l.amount); }

    qs('#rp-body').innerHTML = `
      <div class="card">
        <div class="card-head"><h2>Profit &amp; loss</h2><div class="sub">${fmtDate(from)} – ${fmtDate(to)}</div></div>
        ${dateRangeBar('pnl', from, to, `<label class="checkline mb-0"><input type="checkbox" id="pnl-compare" ${compare?'checked':''}> Compare to previous period</label><button class="btn btn-sm" id="pnl-csv">Export CSV</button>`)}
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Account</th><th class="num">Amount</th>${compare?`<th class="num">Prev. period</th><th class="num">Change</th>`:''}</tr></thead>
          <tbody>
            <tr class="report-group-row"><td colspan="${compare?4:2}">Revenue</td></tr>
            ${is.revenueLines.map(l=>lineRow(l, prevRevMap)).join('')}
            <tr class="report-subtotal"><td>Total revenue</td><td class="num">${fmtMoney(is.totalRevenue)}</td>${compare?`<td class="num">${fmtMoney(prevIs.totalRevenue)}</td><td class="num">${fmtMoney(Ledger.round2(is.totalRevenue-prevIs.totalRevenue))}</td>`:''}</tr>
            <tr class="report-group-row"><td colspan="${compare?4:2}">Cost of goods sold &amp; expenses</td></tr>
            ${is.expenseLines.map(l=>lineRow(l, prevExpMap)).join('')}
            <tr class="report-subtotal"><td>Total expenses</td><td class="num">${fmtMoney(is.totalExpense)}</td>${compare?`<td class="num">${fmtMoney(prevIs.totalExpense)}</td><td class="num">${fmtMoney(Ledger.round2(is.totalExpense-prevIs.totalExpense))}</td>`:''}</tr>
            <tr class="report-total"><td>Net income</td><td class="num">${fmtMoney(is.netIncome)}</td>${compare?`<td class="num">${fmtMoney(prevIs.netIncome)}</td><td class="num">${fmtMoney(Ledger.round2(is.netIncome-prevIs.netIncome))}</td>`:''}</tr>
          </tbody>
        </table></div>
      </div>
    `;
    wireDateRangeBar('pnl', (f,t)=>{ pnlState.from=f; pnlState.to=t; paintPnL(); });
    qs('#pnl-compare').addEventListener('change', e=>{ pnlState.compare = e.target.checked; paintPnL(); });
    qs('#pnl-csv').addEventListener('click', ()=>{
      const rows = [...is.revenueLines, ...is.expenseLines].map(l=>[l.account.code, l.account.name, l.amount]);
      rows.push(['','Total revenue', is.totalRevenue]); rows.push(['','Total expenses', is.totalExpense]); rows.push(['','Net income', is.netIncome]);
      downloadFile('profit-and-loss.csv', toCsv(['Code','Account','Amount'], rows), 'text/csv');
    });
    wireDrillDowns(qs('#rp-body'), (key)=>{
      const [,accId] = key.split(':');
      const acc = Store.find('accounts', accId);
      return { title: (acc?acc.code+' — '+acc.name:'Account'), entries: entriesForAccountInRange(accId, from, to) };
    });
  }

  /* ---------------- BALANCE SHEET ---------------- */
  const bsState = { asOf:null, compareAsOf:null, compare:false };
  function renderBS(){
    if(!bsState.asOf) bsState.asOf = todayISO();
    paintBS();
  }
  function bsSectionRows(secLines, prevLines, compare){
    return secLines.map(l=>{
      const prev = compare ? (prevLines.find(p=>p.account.id===l.account.id)||{amount:0}).amount : null;
      return `<tr><td>${esc(l.account.code)} — ${esc(l.account.name)}</td><td class="num">${drillHtml('', l.amount, 'acct:'+l.account.id)}</td>${compare?`<td class="num">${fmtMoney(prev)}</td>`:''}</tr>`;
    }).join('');
  }
  function paintBS(){
    const { asOf, compareAsOf, compare } = bsState;
    const bs = Ledger.balanceSheet(asOf);
    const prevBs = compare && compareAsOf ? Ledger.balanceSheet(compareAsOf) : null;
    qs('#rp-body').innerHTML = `
      <div class="card">
        <div class="card-head"><h2>Balance sheet</h2><div class="sub">As of ${fmtDate(asOf)}</div></div>
        <div class="drange mb-16">
          <span class="muted small">As of</span><input type="date" id="bs-asof" value="${asOf}">
          <label class="checkline mb-0"><input type="checkbox" id="bs-compare" ${compare?'checked':''}> Compare to</label>
          <input type="date" id="bs-compareto" value="${compareAsOf||asOf}" ${compare?'':'disabled'}>
          <button class="btn btn-sm" id="bs-apply">Apply</button>
          <button class="btn btn-sm" id="bs-csv">Export CSV</button>
        </div>
        <div class="grid grid-2">
          <div>
            <h3 class="mb-8">Assets</h3>
            <table class="t"><tbody>
              ${bsSectionRows(bs.assets.lines, prevBs?prevBs.assets.lines:null, compare)}
              <tr class="report-total"><td>Total assets</td><td class="num">${fmtMoney(bs.assets.total)}</td>${compare?`<td class="num">${fmtMoney(prevBs.assets.total)}</td>`:''}</tr>
            </tbody></table>
          </div>
          <div>
            <h3 class="mb-8">Liabilities &amp; equity</h3>
            <table class="t"><tbody>
              ${bsSectionRows(bs.liabilities.lines, prevBs?prevBs.liabilities.lines:null, compare)}
              <tr class="report-subtotal"><td>Total liabilities</td><td class="num">${fmtMoney(bs.liabilities.total)}</td>${compare?`<td class="num">${fmtMoney(prevBs.liabilities.total)}</td>`:''}</tr>
              ${bsSectionRows(bs.equity.lines, prevBs?prevBs.equity.lines:null, compare)}
              <tr><td>Net income to date</td><td class="num">${fmtMoney(bs.netIncomeToDate)}</td>${compare?`<td class="num">${fmtMoney(prevBs.netIncomeToDate)}</td>`:''}</tr>
              <tr class="report-subtotal"><td>Total equity</td><td class="num">${fmtMoney(bs.equityTotalWithNI)}</td>${compare?`<td class="num">${fmtMoney(prevBs.equityTotalWithNI)}</td>`:''}</tr>
              <tr class="report-total"><td>Total liabilities &amp; equity</td><td class="num">${fmtMoney(bs.totalLiabEquity)}</td>${compare?`<td class="num">${fmtMoney(prevBs.totalLiabEquity)}</td>`:''}</tr>
            </tbody></table>
          </div>
        </div>
      </div>
    `;
    qs('#bs-compare').addEventListener('change', e=>{ bsState.compare = e.target.checked; paintBS(); });
    qs('#bs-apply').addEventListener('click', ()=>{ bsState.asOf = qs('#bs-asof').value||todayISO(); bsState.compareAsOf = qs('#bs-compareto').value||bsState.asOf; paintBS(); });
    qs('#bs-csv').addEventListener('click', ()=>{
      const rows = [...bs.assets.lines, ...bs.liabilities.lines, ...bs.equity.lines].map(l=>[l.account.code, l.account.name, l.amount]);
      downloadFile('balance-sheet.csv', toCsv(['Code','Account','Amount'], rows), 'text/csv');
    });
    wireDrillDowns(qs('#rp-body'), (key)=>{
      const [,accId] = key.split(':');
      const acc = Store.find('accounts', accId);
      return { title: (acc?acc.code+' — '+acc.name:'Account'), entries: Ledger.entriesForAccount(accId, asOf) };
    });
  }

  /* ---------------- TRIAL BALANCE ---------------- */
  function renderTB(){
    const asOf = todayISO();
    const tb = Ledger.trialBalance(asOf).filter(r=>r.debit!==0 || r.credit!==0);
    const tbDebit = Ledger.round2(tb.reduce((s,r)=>s+r.debit,0));
    const tbCredit = Ledger.round2(tb.reduce((s,r)=>s+r.credit,0));
    qs('#rp-body').innerHTML = `
      <div class="card">
        <div class="card-head"><h2>Trial balance</h2><div class="sub">As of ${fmtDate(asOf)}</div></div>
        <div class="toolbar"><div class="spacer"></div><button class="btn btn-sm" id="tb-csv">Export CSV</button></div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Code</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
          <tbody>${tb.map(r=>`<tr><td class="mono">${esc(r.account.code)}</td><td>${esc(r.account.name)}</td>
            <td class="num">${r.debit?drillHtml('',r.debit,'acct:'+r.account.id):''}</td><td class="num">${r.credit?drillHtml('',r.credit,'acct:'+r.account.id):''}</td></tr>`).join('')}
          <tr class="report-total"><td colspan="2">Total</td><td class="num">${fmtMoney(tbDebit)}</td><td class="num">${fmtMoney(tbCredit)}</td></tr>
          </tbody>
        </table></div>
        <p class="small mt-8" style="color:${Math.abs(tbDebit-tbCredit)<0.01?'var(--success)':'var(--danger)'}">${Math.abs(tbDebit-tbCredit)<0.01?'Balanced':'Out of balance'}</p>
      </div>
    `;
    qs('#tb-csv').addEventListener('click', ()=>{
      downloadFile('trial-balance.csv', toCsv(['Code','Account','Debit','Credit'], tb.map(r=>[r.account.code, r.account.name, r.debit, r.credit])), 'text/csv');
    });
    wireDrillDowns(qs('#rp-body'), (key)=>{
      const [,accId] = key.split(':');
      const acc = Store.find('accounts', accId);
      return { title: (acc?acc.code+' — '+acc.name:'Account'), entries: Ledger.entriesForAccount(accId, asOf) };
    });
  }

  /* ---------------- STATEMENT OF CASH FLOWS (simplified indirect method) ---------------- */
  const cfState = { from:null, to:null };
  function renderCashFlow(){
    if(!cfState.from){ const [f,t] = presetRange('THIS_MONTH'); cfState.from=f; cfState.to=t; }
    paintCashFlow();
  }
  function paintCashFlow(){
    const { from, to } = cfState;
    const dayBefore = (d)=>{ const dt = new Date(d+'T00:00:00'); dt.setDate(dt.getDate()-1); return dt.toISOString().slice(0,10); };
    const prev = dayBefore(from);
    const is = Ledger.incomeStatement(from, to);

    const nonCashAssetAccts = Store.all('accounts').filter(a=>a.type==='ASSET' && a.active && a.accountType!=='Bank' && a.accountType!=='Fixed Asset');
    const fixedAssetAccts = Store.all('accounts').filter(a=>a.type==='ASSET' && a.active && a.accountType==='Fixed Asset');
    const liabAccts = Store.all('accounts').filter(a=>a.type==='LIABILITY' && a.active);
    const equityAccts = Store.all('accounts').filter(a=>a.type==='EQUITY' && a.active && a.name!=='Retained Earnings');
    const bankAccts = Store.all('accounts').filter(a=>a.type==='ASSET' && a.active && a.accountType==='Bank');

    function delta(acc){ return Ledger.round2(Ledger.accountBalance(acc.id, to) - Ledger.accountBalance(acc.id, prev)); }

    const assetAdj = nonCashAssetAccts.map(a=>({ acc:a, change: delta(a), effect: Ledger.round2(-delta(a)) })).filter(r=>Math.abs(r.change)>0.004);
    const liabAdj = liabAccts.map(a=>({ acc:a, change: delta(a), effect: delta(a) })).filter(r=>Math.abs(r.change)>0.004);
    const investingAdj = fixedAssetAccts.map(a=>({ acc:a, change: delta(a), effect: Ledger.round2(-delta(a)) })).filter(r=>Math.abs(r.change)>0.004);
    const financingAdj = equityAccts.map(a=>({ acc:a, change: delta(a), effect: delta(a) })).filter(r=>Math.abs(r.change)>0.004);

    const operating = Ledger.round2(is.netIncome + assetAdj.reduce((s,r)=>s+r.effect,0) + liabAdj.reduce((s,r)=>s+r.effect,0));
    const investing = Ledger.round2(investingAdj.reduce((s,r)=>s+r.effect,0));
    const financing = Ledger.round2(financingAdj.reduce((s,r)=>s+r.effect,0));
    const netChange = Ledger.round2(operating+investing+financing);
    const cashBegin = Ledger.round2(bankAccts.reduce((s,a)=>s+Ledger.accountBalance(a.id, prev),0));
    const cashEnd = Ledger.round2(bankAccts.reduce((s,a)=>s+Ledger.accountBalance(a.id, to),0));
    const actualChange = Ledger.round2(cashEnd-cashBegin);

    function block(title, rows, total){
      return `<tr class="report-group-row"><td colspan="2">${esc(title)}</td></tr>
        ${rows.map(r=>`<tr><td style="padding-left:24px">${esc(r.acc.name)} ${r.change>0?'increase':'decrease'}</td><td class="num">${fmtMoney(r.effect)}</td></tr>`).join('') || `<tr><td style="padding-left:24px" class="muted">No change</td><td></td></tr>`}
        <tr class="report-subtotal"><td>Net cash from ${title.toLowerCase()}</td><td class="num">${fmtMoney(total)}</td></tr>`;
    }

    qs('#rp-body').innerHTML = `
      <div class="card">
        <div class="card-head"><h2>Statement of cash flows</h2><div class="sub">${fmtDate(from)} – ${fmtDate(to)} · indirect method</div></div>
        ${dateRangeBar('cf', from, to, `<button class="btn btn-sm" id="cf-csv">Export CSV</button>`)}
        <div class="help-box mb-16">Simplified for a service business with minimal inventory/depreciation: operating cash flow is net income adjusted for the period's change in every non-cash current asset and liability account; investing is the change in fixed-asset accounts; financing is the change in equity accounts (excluding Retained Earnings). "Check" below should match the account cash + bank movement over the period — a mismatch usually means an account was reclassified rather than moved by an actual transaction.</div>
        <table class="t"><tbody>
          <tr><td>Net income</td><td class="num">${fmtMoney(is.netIncome)}</td></tr>
          ${block('Operating activities', [...assetAdj, ...liabAdj], operating)}
          ${block('Investing activities', investingAdj, investing)}
          ${block('Financing activities', financingAdj, financing)}
          <tr class="report-total"><td>Net change in cash</td><td class="num">${fmtMoney(netChange)}</td></tr>
          <tr><td>Cash &amp; bank, beginning of period</td><td class="num">${fmtMoney(cashBegin)}</td></tr>
          <tr><td>Cash &amp; bank, end of period</td><td class="num">${fmtMoney(cashEnd)}</td></tr>
          <tr><td class="muted small">Check: actual cash + bank movement</td><td class="num small muted">${fmtMoney(actualChange)}</td></tr>
        </tbody></table>
      </div>
    `;
    wireDateRangeBar('cf', (f,t)=>{ cfState.from=f; cfState.to=t; paintCashFlow(); });
    qs('#cf-csv').addEventListener('click', ()=>{
      const rows = [['Net income','',is.netIncome], ...assetAdj.map(r=>['Operating',r.acc.name,r.effect]), ...liabAdj.map(r=>['Operating',r.acc.name,r.effect]),
        ['Operating total','',operating], ...investingAdj.map(r=>['Investing',r.acc.name,r.effect]), ['Investing total','',investing],
        ...financingAdj.map(r=>['Financing',r.acc.name,r.effect]), ['Financing total','',financing], ['Net change in cash','',netChange]];
      downloadFile('cash-flow-statement.csv', toCsv(['Section','Account','Amount'], rows), 'text/csv');
    });
  }

  /* ---------------- GENERAL LEDGER ---------------- */
  const glState = { accountId:null, from:null, to:null };
  function renderGL(){
    const accounts = Store.all('accounts').filter(a=>a.active).sort((a,b)=>a.code.localeCompare(b.code));
    if(!glState.accountId) glState.accountId = (accounts[0]||{}).id;
    if(!glState.from){ glState.from=''; glState.to=todayISO(); }
    paintGL(accounts);
  }
  function paintGL(accounts){
    const acc = Store.find('accounts', glState.accountId);
    const entries = acc ? Ledger.entriesForAccount(acc.id, glState.to||null, glState.from||null) : [];
    const opening = acc && glState.from ? Ledger.accountBalance(acc.id, (new Date(new Date(glState.from+'T00:00:00').getTime()-86400000)).toISOString().slice(0,10)) : 0;
    let running = opening;
    const natural = acc && ['ASSET','EXPENSE'].includes(acc.type) ? 'DEBIT' : 'CREDIT';
    qs('#rp-body').innerHTML = `
      <div class="card">
        <div class="card-head"><h2>General ledger</h2><div class="sub">Running balance per account</div></div>
        <div class="drange mb-16">
          <select id="gl-acct">${accounts.map(a=>`<option value="${a.id}" ${a.id===glState.accountId?'selected':''}>${esc(a.code)} — ${esc(a.name)}</option>`).join('')}</select>
          <span class="muted small">from</span><input type="date" id="gl-from" value="${glState.from||''}">
          <span class="muted small">to</span><input type="date" id="gl-to" value="${glState.to||''}">
          <button class="btn btn-sm" id="gl-apply">Apply</button>
          <button class="btn btn-sm" id="gl-csv">Export CSV</button>
        </div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Date</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
          <tbody>
          <tr><td colspan="4">Opening balance</td><td class="num">${fmtMoney(opening)}</td></tr>
          ${entries.length ? entries.map(({je,line})=>{
            running = natural==='DEBIT' ? Ledger.round2(running+line.debit-line.credit) : Ledger.round2(running+line.credit-line.debit);
            return `<tr><td>${fmtDate(je.date)}</td><td>${esc(je.description)}</td><td class="num">${line.debit?fmtMoney(line.debit):''}</td><td class="num">${line.credit?fmtMoney(line.credit):''}</td><td class="num">${fmtMoney(running)}</td></tr>`;
          }).join('') : `<tr><td colspan="5" class="table-empty">No activity in this range.</td></tr>`}
          </tbody>
        </table></div>
      </div>
    `;
    qs('#gl-acct').addEventListener('change', e=>{ glState.accountId = e.target.value; paintGL(accounts); });
    qs('#gl-apply').addEventListener('click', ()=>{ glState.from = qs('#gl-from').value||''; glState.to = qs('#gl-to').value||''; paintGL(accounts); });
    qs('#gl-csv').addEventListener('click', ()=>{
      let r = opening;
      const rows = entries.map(({je,line})=>{ r = natural==='DEBIT'?Ledger.round2(r+line.debit-line.credit):Ledger.round2(r+line.credit-line.debit); return [je.date, je.description, line.debit, line.credit, r]; });
      downloadFile('general-ledger-'+(acc?acc.code:'')+'.csv', toCsv(['Date','Description','Debit','Credit','Balance'], rows), 'text/csv');
    });
  }

  /* ---------------- AR / AP AGING ---------------- */
  function ageBucket(days){
    if(days<=0) return 'Current';
    if(days<=30) return '1-30';
    if(days<=60) return '31-60';
    if(days<=90) return '61-90';
    return '90+';
  }
  function arOpenItems(asOf){
    const out = [];
    Store.all('bookings').forEach(b=>{
      if(!b.invoiceTotal) return;
      const paid = Ledger.round2(Store.where('receipts', r=>r.bookingId===b.id && r.date<=asOf).reduce((s,r)=>s+r.amount,0));
      const open = Ledger.round2((b.invoiceTotal||0)-paid);
      if(open<=0.004) return;
      const date = (b.tripDateForInvoice || (b.createdAt||'').slice(0,10) || asOf);
      if(date>asOf) return;
      const cust = Store.find('customers', b.customerId);
      const days = Math.round((new Date(asOf+'T00:00:00') - new Date(date+'T00:00:00'))/86400000);
      out.push({ customer: cust, booking: b, date, open, bucket: ageBucket(days) });
    });
    return out;
  }
  function apOpenItems(asOf){
    const out = [];
    Store.all('bills').forEach(bl=>{
      const open = Ledger.round2((bl.totalAmount||0)-(bl.paidAmount||0));
      if(open<=0.004) return;
      if(bl.billDate>asOf) return;
      const vend = Store.find('vendors', bl.vendorId);
      const due = bl.dueDate || bl.billDate;
      const days = Math.round((new Date(asOf+'T00:00:00') - new Date(due+'T00:00:00'))/86400000);
      out.push({ vendor: vend, bill: bl, date: due, open, bucket: ageBucket(days) });
    });
    return out;
  }
  function agingSummaryTable(items, groupKey, groupLabel, totalLabel, detailRenderer, exportName){
    const groups = {};
    items.forEach(it=>{
      const gid = it[groupKey] ? it[groupKey].id : '—';
      const gname = it[groupKey] ? it[groupKey].name : 'Unknown';
      if(!groups[gid]) groups[gid] = { name:gname, buckets:{Current:0,'1-30':0,'31-60':0,'61-90':0,'90+':0}, total:0, items:[] };
      groups[gid].buckets[it.bucket] = Ledger.round2(groups[gid].buckets[it.bucket]+it.open);
      groups[gid].total = Ledger.round2(groups[gid].total+it.open);
      groups[gid].items.push(it);
    });
    const rows = Object.entries(groups).sort((a,b)=>b[1].total-a[1].total);
    const grandTotals = {Current:0,'1-30':0,'31-60':0,'61-90':0,'90+':0}; let grandTotal=0;
    rows.forEach(([,g])=>{ AGING_BUCKETS.forEach(b=>grandTotals[b]=Ledger.round2(grandTotals[b]+g.buckets[b])); grandTotal=Ledger.round2(grandTotal+g.total); });
    return `
      <div class="toolbar"><div class="spacer"></div><button class="btn btn-sm" data-aging-csv>Export CSV</button></div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>${esc(groupLabel)}</th>${AGING_BUCKETS.map(b=>`<th class="num">${b}</th>`).join('')}<th class="num">Total</th></tr></thead>
        <tbody>${rows.length ? rows.map(([gid,g])=>`<tr>
          <td>${esc(g.name)}</td>
          ${AGING_BUCKETS.map(b=>`<td class="num aging-cell ${b==='90+'&&g.buckets[b]>0.004?'over':''}">${g.buckets[b]?drillHtml('',g.buckets[b],'group:'+gid+':'+b):'—'}</td>`).join('')}
          <td class="num">${fmtMoney(g.total)}</td>
        </tr>`).join('') : `<tr><td colspan="7" class="table-empty">Nothing outstanding.</td></tr>`}
        <tr class="report-total"><td>${esc(totalLabel)}</td>${AGING_BUCKETS.map(b=>`<td class="num">${fmtMoney(grandTotals[b])}</td>`).join('')}<td class="num">${fmtMoney(grandTotal)}</td></tr>
        </tbody>
      </table></div>
    `;
  }
  function renderARAging(){
    const asOf = todayISO();
    const items = arOpenItems(asOf);
    qs('#rp-body').innerHTML = `<div class="card"><div class="card-head"><h2>Accounts receivable aging</h2><div class="sub">As of ${fmtDate(asOf)}</div></div>
      ${agingSummaryTable(items, 'customer', 'Customer', 'Total receivable', null, 'ar-aging.csv')}
    </div>`;
    wireAgingDrill(items, 'customer');
    qs('[data-aging-csv]').addEventListener('click', ()=>{
      downloadFile('ar-aging.csv', toCsv(['Customer','Booking','Date','Bucket','Open amount'], items.map(it=>[it.customer?it.customer.name:'—', it.booking.bookingNo, it.date, it.bucket, it.open])), 'text/csv');
    });
  }
  function renderAPAging(){
    const asOf = todayISO();
    const items = apOpenItems(asOf);
    qs('#rp-body').innerHTML = `<div class="card"><div class="card-head"><h2>Accounts payable aging</h2><div class="sub">As of ${fmtDate(asOf)}</div></div>
      ${agingSummaryTable(items, 'vendor', 'Vendor', 'Total payable', null, 'ap-aging.csv')}
    </div>`;
    wireAgingDrill(items, 'vendor');
    qs('[data-aging-csv]').addEventListener('click', ()=>{
      downloadFile('ap-aging.csv', toCsv(['Vendor','Bill','Due date','Bucket','Open amount'], items.map(it=>[it.vendor?it.vendor.name:'—', it.bill.billNo, it.date, it.bucket, it.open])), 'text/csv');
    });
  }
  function wireAgingDrill(items, groupKey){
    qsa('[data-drill^="group:"]').forEach(el=>el.addEventListener('click', ()=>{
      const [,gid,bucket] = el.dataset.drill.split(':');
      const rows = items.filter(it=> (it[groupKey]?it[groupKey].id:'—')===gid && it.bucket===bucket);
      openModal({
        title: `${bucket} — ${rows[0] && rows[0][groupKey] ? rows[0][groupKey].name : 'Unknown'}`,
        bodyHtml: `<div class="table-wrap"><table class="t"><thead><tr><th>Ref</th><th>Date</th><th class="num">Open amount</th></tr></thead>
          <tbody>${rows.map(r=>`<tr><td>${esc((r.booking||r.bill).bookingNo || (r.booking||r.bill).billNo || '—')}</td><td>${fmtDate(r.date)}</td><td class="num">${fmtMoney(r.open)}</td></tr>`).join('')}</tbody></table></div>`,
        footerHtml: `<button class="btn" data-close>Close</button>`
      });
    }));
  }

  /* ---------------- TRIP P&L ---------------- */
  function renderTripPnL(){
    const trips = Store.all('trips').slice().sort((a,b)=>b.tripDate.localeCompare(a.tripDate)).slice(0,200);
    const rows = trips.map(t=>{
      let revenue = 0;
      Store.all('bookings').forEach(b=>{
        (b.guestLines||[]).forEach(gl=>{
          if(gl.tripId!==t.id || ['CANCELLED','EXPIRED'].includes(gl.status)) return;
          revenue += (gl.unitPriceBase!=null?gl.unitPriceBase:gl.unitPrice)||0;
        });
      });
      const bills = Store.where('bills', b=>b.tripId===t.id);
      const billCost = bills.reduce((s,b)=>s+(b.totalAmount||0),0);
      const vouchers = Store.where('vouchers', v=>v.tripId===t.id && v.status==='PAID');
      const voucherCost = vouchers.reduce((s,v)=>s+(v.amount||0),0);
      const cost = Ledger.round2(billCost+voucherCost);
      return { t, revenue: Ledger.round2(revenue), cost, profit: Ledger.round2(revenue-cost) };
    }).filter(r=>r.revenue>0.004 || r.cost>0.004);

    qs('#rp-body').innerHTML = `
      <div class="card">
        <div class="card-head"><h2>Trip P&amp;L</h2></div>
        <div class="help-box mb-16">Revenue is each trip's guest-line prices (frozen at base-currency amount); cost is bills and paid vouchers tagged with that trip (rentals, freelance commissions, etc).</div>
        <div class="toolbar"><div class="spacer"></div><button class="btn btn-sm" id="trp-csv">Export CSV</button></div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Trip #</th><th>Date</th><th class="num">Revenue</th><th class="num">Cost</th><th class="num">Profit</th></tr></thead>
          <tbody>${rows.length ? rows.map(r=>`<tr><td>${esc(r.t.tripNo||'—')}</td><td>${fmtDate(r.t.tripDate)}</td>
            <td class="num">${fmtMoney(r.revenue)}</td><td class="num">${fmtMoney(r.cost)}</td><td class="num">${fmtMoney(r.profit)}</td></tr>`).join('')
            : `<tr><td colspan="5" class="table-empty">No trips with revenue or allocated costs yet.</td></tr>`}</tbody>
        </table></div>
      </div>
    `;
    qs('#trp-csv').addEventListener('click', ()=>{
      downloadFile('trip-pnl.csv', toCsv(['Trip #','Date','Revenue','Cost','Profit'], rows.map(r=>[r.t.tripNo||'', r.t.tripDate, r.revenue, r.cost, r.profit])), 'text/csv');
    });
  }

  /* ---------------- EQUIPMENT USAGE ---------------- */
  function renderEquipmentUsage(){
    const log = Store.all('equipmentUsageLog');
    const types = Store.all('equipmentTypes');
    const byType = types.map(t=>{
      const entries = log.filter(l=>l.typeId===t.id);
      const tripIds = new Set(entries.map(e=>e.tripId).filter(Boolean));
      return { type: t, uses: entries.length, trips: tripIds.size };
    }).sort((a,b)=>b.uses-a.uses);
    const byItem = {};
    log.forEach(l=>{ byItem[l.equipmentId] = (byItem[l.equipmentId]||0)+1; });
    const itemRows = Object.entries(byItem).map(([id,count])=>({ item: Store.find('equipment', id), count })).filter(r=>r.item).sort((a,b)=>b.count-a.count).slice(0,20);

    qs('#rp-body').innerHTML = `
      <div class="help-box mb-16">Counts every time a piece of gear was issued (to a guest or to staff) since this feature was added.</div>
      <div class="card">
        <div class="card-head"><h2>By gear type</h2></div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Type</th><th class="num">Times issued</th><th class="num">Distinct trips</th></tr></thead>
          <tbody>${byType.length ? byType.map(r=>`<tr><td>${esc(r.type.name)}</td><td class="num">${r.uses}</td><td class="num">${r.trips}</td></tr>`).join('')
            : `<tr><td colspan="3" class="table-empty">No usage recorded yet.</td></tr>`}</tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Most-used items</h2></div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Tag</th><th>Type</th><th class="num">Times issued</th></tr></thead>
          <tbody>${itemRows.length ? itemRows.map(r=>`<tr><td class="mono">${esc(r.item.tag)}</td><td>${esc((Store.find('equipmentTypes',r.item.equipmentTypeId)||{}).name||'')}</td><td class="num">${r.count}</td></tr>`).join('')
            : `<tr><td colspan="3" class="table-empty">No usage recorded yet.</td></tr>`}</tbody>
        </table></div>
      </div>
    `;
  }

  /* ---------------- CUSTOMERS ---------------- */
  // Shows a search/select to pick one customer, then that customer's
  // statement (opening balance + postings) filtered to a date range —
  // not a list of every customer's balance (that's covered by AR aging).
  const custState = { customerId:null, from:null, to:null };
  function renderCustomers(){
    if(!custState.from){ const [f,t] = presetRange('THIS_MONTH'); custState.from=f; custState.to=t; }
    const customers = Store.all('customers').slice()
      .sort((a,b)=> (a.type==='DIRECT'?-1:1) - (b.type==='DIRECT'?-1:1) || a.name.localeCompare(b.name));
    if(custState.customerId && !Store.find('customers', custState.customerId)) custState.customerId = null;

    qs('#rp-body').innerHTML = `
      <div class="card">
        <div class="card-head"><h2>Customer report</h2><div class="sub">Search or pick a customer to see their statement for a date range</div></div>
        <div class="toolbar">
          <input class="search-input" id="cx-filter" type="text" placeholder="Search customers…" autocomplete="off">
          <select id="cx-select" style="min-width:260px">
            <option value="">— Select a customer —</option>
            ${customers.map(c=>`<option value="${c.id}" data-name="${esc(c.name.toLowerCase())}" ${custState.customerId===c.id?'selected':''}>${esc(c.name)}${c.type==='DIRECT'?' (Direct)':''}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="cx-statement"></div>
    `;
    const filter = qs('#cx-filter'), sel = qs('#cx-select');
    filter.addEventListener('input', ()=>{
      const q = filter.value.trim().toLowerCase();
      qsa('option', sel).forEach(o=>{ if(!o.value){ o.hidden=false; return; } o.hidden = !!q && !(o.dataset.name||'').includes(q); });
    });
    sel.addEventListener('change', ()=>{ custState.customerId = sel.value || null; paintCustomerStatement(); });
    paintCustomerStatement();
  }

  function paintCustomerStatement(){
    const box = qs('#cx-statement');
    if(!box) return;
    if(!custState.customerId){
      box.innerHTML = `<div class="card"><p class="muted small">Pick a customer above to see their statement.</p></div>`;
      return;
    }
    const c = Store.find('customers', custState.customerId);
    if(!c){ box.innerHTML=''; return; }
    const { from, to } = custState;
    const dayBeforeFrom = new Date(from+'T00:00:00'); dayBeforeFrom.setDate(dayBeforeFrom.getDate()-1);
    const openingBalance = Ledger.partyBalance('customer', c.id, dayBeforeFrom.toISOString().slice(0,10));
    const allEntries = Ledger.partyEntries('customer', c.id);
    const entries = allEntries.filter(({je})=> je.date>=from && je.date<=to);
    const closingBalance = Ledger.partyBalance('customer', c.id, to);
    const bookings = Store.where('bookings', b=>b.customerId===c.id && b.createdAt.slice(0,10)>=from && b.createdAt.slice(0,10)<=to);
    const sold = Ledger.round2(bookings.reduce((s,b)=>s+(b.invoiceTotal||0),0));

    let running = openingBalance;
    const rowsHtml = entries.map(({je,line})=>{
      running = Ledger.round2(running + line.debit - line.credit);
      return `<tr><td>${fmtDate(je.date)}</td><td>${esc(je.description)}</td>
        <td class="num">${line.debit?fmtMoney(line.debit):''}</td><td class="num">${line.credit?fmtMoney(line.credit):''}</td>
        <td class="num">${fmtMoney(running)}</td></tr>`;
    }).join('');

    box.innerHTML = `
      <div class="grid grid-3 mb-16">
        <div class="stat"><div class="label">Type</div><div class="value" style="font-size:16px">${c.type==='DIRECT'?'Direct Booking':'Agent'}</div></div>
        <div class="stat"><div class="label">Bookings in range</div><div class="value">${bookings.length}</div><div class="sub">${fmtMoney(sold)} sold</div></div>
        <div class="stat"><div class="label">Closing balance</div><div class="value">${fmtMoney(closingBalance)}</div><div class="sub">as of ${fmtDate(to)}</div></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Statement — ${esc(c.name)}</h2>
          ${!c.locked ? `<a class="linkbtn" onclick="Router.navigate('customers/${c.id}')">Open customer record &rarr;</a>` : ''}
        </div>
        ${dateRangeBar('cx', from, to, `<button class="btn btn-sm" id="cx-export">Export CSV</button>`)}
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Date</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
          <tbody>
            <tr class="report-subtotal"><td colspan="4">Opening balance (as of ${fmtDate(from)})</td><td class="num">${fmtMoney(openingBalance)}</td></tr>
            ${rowsHtml || `<tr><td colspan="5" class="table-empty">No activity in this date range.</td></tr>`}
            <tr class="report-total"><td colspan="4">Closing balance</td><td class="num">${fmtMoney(closingBalance)}</td></tr>
          </tbody>
        </table></div>
      </div>
    `;
    wireDateRangeBar('cx', (f,t)=>{ custState.from=f; custState.to=t; paintCustomerStatement(); });
    qs('#cx-export').addEventListener('click', ()=>{
      const rows = [['Opening balance','', '', '', openingBalance]]
        .concat(entries.map(({je,line})=>{ return [fmtDate(je.date), je.description, line.debit||'', line.credit||'', '']; }));
      const csv = toCsv(['Date','Description','Debit','Credit','Note'], rows);
      downloadFile(`statement-${c.name.replace(/[^a-z0-9]+/gi,'-')}-${from}-to-${to}.csv`, csv, 'text/csv');
    });
  }

  /* ---------------- VENDORS ---------------- */
  function renderVendors(){
    const vendors = Store.all('vendors');
    const rows = vendors.map(v=>{
      const bills = Store.where('bills', b=>b.vendorId===v.id);
      const billed = Ledger.round2(bills.reduce((s,b)=>s+b.totalAmount,0));
      const paid = Ledger.round2(bills.reduce((s,b)=>s+(b.paidAmount||0),0));
      const owed = -Ledger.partyBalance('vendor', v.id);
      return { v, bills: bills.length, billed, paid, owed };
    }).sort((a,b)=>b.owed-a.owed);

    qs('#rp-body').innerHTML = `
      <div class="card">
        <div class="card-head"><h2>Vendor report</h2></div>
        <div class="toolbar"><div class="spacer"></div><button class="btn btn-sm" id="vx-export">Export CSV</button></div>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Vendor</th><th class="num">Bills</th><th class="num">Billed</th><th class="num">Paid</th><th class="num">Owed</th></tr></thead>
          <tbody>${rows.map(r=>`<tr style="cursor:pointer" onclick="Router.navigate('vendors/${r.v.id}')">
            <td>${esc(r.v.name)}</td><td class="num">${r.bills}</td><td class="num">${fmtMoney(r.billed)}</td><td class="num">${fmtMoney(r.paid)}</td><td class="num">${fmtMoney(r.owed)}</td>
          </tr>`).join('') || `<tr><td colspan="5" class="table-empty">No vendors yet.</td></tr>`}</tbody>
        </table></div>
      </div>
    `;
    qs('#vx-export').addEventListener('click', ()=>{
      const csv = toCsv(['Vendor','Bills','Billed','Paid','Owed'], rows.map(r=>[r.v.name,r.bills,r.billed,r.paid,r.owed]));
      downloadFile('vendor-report.csv', csv, 'text/csv');
    });
  }

  /* ---------------- TAX ---------------- */
  function renderTax(){
    const periods = Store.all('taxPeriods').slice().sort((a,b)=>b.toDate.localeCompare(a.toDate));
    const totalPayable = Ledger.round2(periods.reduce((s,p)=>s + (p.status!=='PAID'?p.netPayable:0),0));
    qs('#rp-body').innerHTML = `
      <div class="grid grid-2 mb-16">
        <div class="stat"><div class="label">Outstanding tax</div><div class="value">${fmtMoney(totalPayable)}</div></div>
        <div class="stat"><div class="label">Periods filed</div><div class="value">${periods.filter(p=>p.status!=='OPEN').length}</div></div>
      </div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Period</th><th>Range</th><th class="num">Output</th><th class="num">Input</th><th class="num">Net</th><th>Status</th></tr></thead>
        <tbody>${periods.length ? periods.map(p=>`<tr><td>${esc(p.periodLabel)}</td><td>${fmtDate(p.fromDate)} – ${fmtDate(p.toDate)}</td>
          <td class="num">${fmtMoney(p.outputTax)}</td><td class="num">${fmtMoney(p.inputTax)}</td><td class="num">${fmtMoney(p.netPayable)}</td><td>${esc(p.status)}</td></tr>`).join('')
          : `<tr><td colspan="6" class="table-empty">No tax periods yet — close one from the Tax page.</td></tr>`}</tbody>
      </table></div>
      <p class="linkbtn mt-12" onclick="Router.navigate('tax')">Manage tax periods &rarr;</p>
    `;
  }

  Router.on('/reports', render);
})();
