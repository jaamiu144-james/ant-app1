/* ---------------------------------------------------------------------
   accounts.js — chart of accounts, journal entries and ledgers.
   The starter chart is a sensible default so the app can post from day
   one; every account here stays fully editable and you can add more.
--------------------------------------------------------------------- */

(function(){

  const GROUP_LABEL = {
    ASSET:'Assets', LIABILITY:'Liabilities', EQUITY:'Equity', REVENUE:'Income', EXPENSE:'Cost of goods sold & expenses'
  };
  const collapsedGroups = {};

  function renderAccounts(params){
    setPageTitle('Chart of accounts', 'Accounting');
    renderNav();
    const accounts = Store.all('accounts').slice().sort((a,b)=>a.code.localeCompare(b.code));
    const groups = ['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'];
    const vo = Auth.isViewOnly();
    qs('#content').innerHTML = `
      <div class="toolbar"><div class="spacer"></div>${vo?'':`<button class="btn btn-primary" id="ac-add">+ Add account</button>`}</div>
      ${groups.map(g=>{
        const rows = accounts.filter(a=>a.type===g);
        if(!rows.length) return '';
        const roots = rows.filter(a=>!a.parentAccountId || !rows.find(p=>p.id===a.parentAccountId));
        const collapsed = !!collapsedGroups[g];
        return `<div class="acct-tree mb-16">
          <div class="acct-group-head ${collapsed?'collapsed':''}" data-toggle-group="${g}"><span class="chev">&#9660;</span> ${esc(GROUP_LABEL[g]||g)} <span style="font-weight:400;text-transform:none;letter-spacing:0;opacity:.75">(${rows.length})</span></div>
          <div class="acct-group-body ${collapsed?'collapsed':''}" data-group-body="${g}">
          ${roots.map(a=>acctRowHtml(a, rows, 0, vo)).join('')}
          </div>
        </div>`;
      }).join('')}
    `;
    if(qs('#ac-add')) qs('#ac-add').addEventListener('click', ()=>openForm());
    if(!vo) qsa('[data-row]').forEach(r=>r.addEventListener('click', ()=>openForm(Store.find('accounts', r.dataset.row))));
    qsa('[data-recon]').forEach(b=>b.addEventListener('click', e=>{ e.stopPropagation(); Router.navigate('reconcile?account='+b.dataset.recon); }));
    qsa('[data-toggle-group]').forEach(h=>h.addEventListener('click', ()=>{
      const g = h.dataset.toggleGroup;
      collapsedGroups[g] = !collapsedGroups[g];
      renderAccounts(params);
    }));
  }

  function acctRowHtml(a, allRows, depth, vo){
    const children = allRows.filter(c=>c.parentAccountId===a.id);
    const isParent = children.length>0;
    const canReconcile = a.type==='ASSET' && ['Bank','Other Current Asset','Accounts Receivable'].includes(a.accountType);
    const row = `<div class="acct-row ${isParent?'parent':''}" data-row="${a.id}" style="cursor:pointer">
      <span class="acct-child-indent" style="width:${8+depth*22}px"></span>
      <span class="acct-code">${esc(a.code)}</span>
      <span class="acct-name">${esc(a.name)}${a.accountType?` <span class="badge badge-gray">${esc(a.accountType)}</span>`:''}${a.active===false?' <span class="badge badge-gray">Inactive</span>':''}</span>
      <span class="acct-bal">${fmtMoney(Ledger.accountBalance(a.id))}</span>
      <span class="row-actions">
        <a onclick="event.stopPropagation();Router.navigate('ledgers?account=${a.id}')">Ledger</a>
        ${canReconcile?`<button class="btn btn-sm" data-recon="${a.id}" onclick="event.stopPropagation()">Reconcile</button>`:''}
      </span>
    </div>`;
    return row + children.sort((x,y)=>x.code.localeCompare(y.code)).map(c=>acctRowHtml(c, allRows, depth+1, vo)).join('');
  }

  const ACCOUNT_TYPES = ['Bank','Accounts Receivable','Other Current Asset','Fixed Asset','Accounts Payable','Other Current Liability','Long Term Liability','Equity','Income','Cost of Goods Sold','Expense','Other Income','Other Expense'];

  function openForm(existing){
    const others = Store.all('accounts').filter(a=>!existing || a.id!==existing.id).sort((a,b)=>a.code.localeCompare(b.code));
    openModal({
      title: existing?'Edit account':'Add account',
      bodyHtml: `
        <div class="form-row">
          <div class="field"><label>Code</label><input id="af-code" type="text" value="${esc(existing?existing.code:'')}"></div>
          <div class="field"><label>Type</label>
            <select id="af-type" ${existing&&existing.system?'disabled':''}>
              ${['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'].map(t=>`<option value="${t}" ${existing&&existing.type===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field"><label>Name</label><input id="af-name" type="text" value="${esc(existing?existing.name:'')}"></div>
        <div class="form-row">
          <div class="field"><label>Account type</label>
            <select id="af-acct-type">
              <option value="">—</option>
              ${ACCOUNT_TYPES.map(t=>`<option value="${t}" ${existing&&existing.accountType===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Parent account <span class="hint">(optional)</span></label>
            <select id="af-parent">
              <option value="">— No parent —</option>
              ${others.map(a=>`<option value="${a.id}" ${existing&&existing.parentAccountId===a.id?'selected':''}>${esc(a.code)} — ${esc(a.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        ${existing&&existing.system?`<p class="hint">This is one of the starter accounts. You can rename it or re-group it, but its type is fixed since other postings depend on it.</p>`:''}
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="af-save">Save</button>`,
      onMount(modal){
        qs('#af-save', modal).addEventListener('click', ()=>{
          const code = qs('#af-code', modal).value.trim(), name = qs('#af-name', modal).value.trim();
          if(!code || !name){ toast('Enter a code and name.', 'err'); return; }
          const data = { code, name, type: qs('#af-type', modal).value, active:true,
            accountType: qs('#af-acct-type', modal).value || null, parentAccountId: qs('#af-parent', modal).value || null };
          if(existing) Store.update('accounts', existing.id, data);
          else Store.insert('accounts', data);
          closeModal(); toast('Account saved', 'ok'); renderAccounts({});
        });
      }
    });
  }

  function renderJournal(params){
    setPageTitle('Journal entries', 'Accounting');
    renderNav();
    const rows = Store.all('journalEntries').slice().sort((a,b)=> b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0,300);
    qs('#content').innerHTML = `
      <div class="help-box mb-16">Every posting shown here came from a booking, receipt, bill, voucher, payroll run or day-end close — nothing is entered directly.</div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Date</th><th>Ref</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>
        ${rows.length ? rows.map(je=>`<tr style="cursor:pointer" data-je="${je.id}">
          <td>${fmtDate(je.date)}</td><td class="mono">${esc(je.ref)}</td><td>${esc(je.description)}</td>
          <td class="num">${fmtMoney(je.lines.reduce((s,l)=>s+l.debit,0))}</td><td class="num">${fmtMoney(je.lines.reduce((s,l)=>s+l.credit,0))}</td>
        </tr>`).join('') : `<tr><td colspan="5" class="table-empty">No postings yet.</td></tr>`}
        </tbody>
      </table></div>
    `;
    qsa('[data-je]').forEach(r=>r.addEventListener('click', ()=>openJeDetail(r.dataset.je)));
  }

  function openJeDetail(id){
    const je = Store.find('journalEntries', id);
    if(!je) return;
    openModal({
      title: `Journal — ${je.ref}`,
      bodyHtml: `
        <p class="small muted mb-12">${fmtDate(je.date)} · ${esc(je.description)}</p>
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
          <tbody>${je.lines.map(l=>{ const acc = Store.find('accounts', l.accountId); return `<tr><td>${esc(acc?acc.code+' — '+acc.name:'—')}</td><td class="num">${l.debit?fmtMoney(l.debit):''}</td><td class="num">${l.credit?fmtMoney(l.credit):''}</td></tr>`; }).join('')}</tbody>
        </table></div>
      `,
      footerHtml: `<button class="btn" data-close>Close</button>`
    });
  }

  function renderLedgers(params){
    setPageTitle('Ledgers', 'Accounting');
    renderNav();
    const accounts = Store.all('accounts').filter(a=>a.active).sort((a,b)=>a.code.localeCompare(b.code));
    const accId = params.account || (accounts[0]||{}).id;
    const acc = Store.find('accounts', accId);
    const entries = acc ? Ledger.entriesForAccount(acc.id) : [];
    let running = 0;
    const natural = acc && ['ASSET','EXPENSE'].includes(acc.type) ? 'DEBIT' : 'CREDIT';
    qs('#content').innerHTML = `
      <div class="toolbar">
        <select id="lg-acct">${accounts.map(a=>`<option value="${a.id}" ${a.id===accId?'selected':''}>${esc(a.code)} — ${esc(a.name)}</option>`).join('')}</select>
        <div class="spacer"></div>
        <div class="stat" style="padding:8px 14px"><div class="value" style="font-size:16px">${fmtMoney(acc?Ledger.accountBalance(acc.id):0)}</div><div class="label" style="font-size:10px">Balance</div></div>
      </div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Date</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
        <tbody>
        ${entries.length ? entries.map(({je,line})=>{
          running = natural==='DEBIT' ? Ledger.round2(running+line.debit-line.credit) : Ledger.round2(running+line.credit-line.debit);
          return `<tr><td>${fmtDate(je.date)}</td><td>${esc(je.description)}</td><td class="num">${line.debit?fmtMoney(line.debit):''}</td><td class="num">${line.credit?fmtMoney(line.credit):''}</td><td class="num">${fmtMoney(running)}</td></tr>`;
        }).join('') : `<tr><td colspan="5" class="table-empty">No activity on this account yet.</td></tr>`}
        </tbody>
      </table></div>
    `;
    qs('#lg-acct').addEventListener('change', e=>Router.navigate('ledgers?account='+e.target.value));
  }

  Router.on('/accounts', renderAccounts);
  Router.on('/journal', renderJournal);
  Router.on('/ledgers', renderLedgers);
})();
