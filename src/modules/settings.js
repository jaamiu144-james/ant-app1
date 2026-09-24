/* ---------------------------------------------------------------------
   settings.js — company info, currency & tax defaults, certification
   levels, users & roles, backup/restore.
--------------------------------------------------------------------- */

(function(){

  function render(params){
    setPageTitle('Settings', '');
    renderNav();
    const tab = params.sub || 'general';
    qs('#content').innerHTML = `
      <div class="tabs">
        <div class="tab ${tab==='general'?'active':''}" data-tab="general">General</div>
        <div class="tab ${tab==='currency'?'active':''}" data-tab="currency">Currency &amp; tax</div>
        <div class="tab ${tab==='methods'?'active':''}" data-tab="methods">Payment methods</div>
        <div class="tab ${tab==='invoice'?'active':''}" data-tab="invoice">Invoice template</div>
        <div class="tab ${tab==='users'?'active':''}" data-tab="users">Users</div>
        <div class="tab ${tab==='roles'?'active':''}" data-tab="roles">Roles</div>
        <div class="tab ${tab==='data'?'active':''}" data-tab="data">Backup &amp; data</div>
      </div>
      <div id="st-body"></div>
    `;
    qsa('[data-tab]').forEach(t=>t.addEventListener('click', ()=>Router.navigate('settings/x/'+t.dataset.tab)));
    if(tab==='users') renderUsers();
    else if(tab==='roles') renderRoles();
    else if(tab==='currency') renderCurrency();
    else if(tab==='methods') renderMethods();
    else if(tab==='invoice') renderInvoiceTemplate();
    else if(tab==='data') renderData();
    else renderGeneral();
  }

  function renderGeneral(){
    const s = Store.settings;
    const levels = s.certLevels || [];
    const vo = Auth.isViewOnly();
    if(vo){
      qs('#st-body').innerHTML = `<div class="card" style="max-width:560px"><div class="card-head"><h2>Company</h2></div>
        <dl class="kv"><dt>Name</dt><dd>${esc(s.companyName)}</dd>${s.companyAddress?`<dt>Address</dt><dd>${esc(s.companyAddress)}</dd>`:''}<dt>Currency</dt><dd>${esc(s.currency)} (${esc(s.currencySymbol)})</dd></dl>
      </div>`;
      return;
    }
    qs('#st-body').innerHTML = `
      <div class="card" style="max-width:560px">
        <div class="card-head"><h2>Company</h2></div>
        <div class="field"><label>Company / dive centre name</label><input id="sg-name" type="text" value="${esc(s.companyName)}"></div>
        <div class="field"><label>Address <span class="hint">(shown above the sidebar and on printed invoices)</span></label><textarea id="sg-address" rows="2" placeholder="e.g. Jetty 4, Hulhumale, Maldives">${esc(s.companyAddress||'')}</textarea></div>
        <div class="field"><label>Display currency symbol <span class="hint">(what amounts are shown with — see Currency &amp; tax for the ledger's base currency)</span></label>
          <div class="form-row"><input id="sg-cur" type="text" value="${esc(s.currency)}" maxlength="3"><input id="sg-sym" type="text" value="${esc(s.currencySymbol)}" maxlength="3"></div>
        </div>
        <div class="field"><label>Booking hold expiry (minutes)</label><input id="sg-hold" type="number" min="1" value="${s.holdExpiryMinutes}"></div>
        <div class="field"><label>Company logo</label>
          ${s.logoDataUrl?`<img src="${s.logoDataUrl}" style="max-height:60px;display:block;margin-bottom:8px;border:1px solid var(--line);border-radius:6px;padding:4px">`:''}
          <input type="file" id="sg-logo" accept="image/*">
          ${s.logoDataUrl?`<button class="btn btn-sm btn-ghost mt-8" id="sg-logo-clear" type="button">Remove logo</button>`:''}
        </div>
        <button class="btn btn-primary" id="sg-save">Save</button>
      </div>

      <div class="card" style="max-width:560px">
        <div class="card-head"><h2>Certification levels</h2></div>
        <p class="small muted mb-8">Optional. Add your agency's levels in order from least to most qualified, so packages can require a minimum and guests can be checked against it. Leave empty to skip this check.</p>
        <div class="inline-list mb-12" id="sg-levels">
          ${levels.map((l,i)=>`<div class="inline-item"><span class="grow">${i+1}. ${esc(l)}</span><button class="btn btn-icon btn-ghost" data-del-level="${i}" type="button">&times;</button></div>`).join('') || '<p class="muted small">No levels added.</p>'}
        </div>
        <div class="flex-gap"><input id="sg-newlevel" type="text" placeholder="e.g. Open Water" style="max-width:220px"><button class="btn btn-sm" id="sg-addlevel">Add</button></div>
      </div>
    `;
    let pendingLogo = null;
    const logoInp = qs('#sg-logo');
    if(logoInp) logoInp.addEventListener('change', ()=>{
      const f = logoInp.files[0]; if(!f) return;
      const reader = new FileReader();
      reader.onload = ()=>{ pendingLogo = reader.result; };
      reader.readAsDataURL(f);
    });
    if(qs('#sg-logo-clear')) qs('#sg-logo-clear').addEventListener('click', ()=>{ pendingLogo=''; Store.settings.logoDataUrl=''; Store.persist(); toast('Logo removed'); renderShell(); Router.render(); });
    qs('#sg-save').addEventListener('click', ()=>{
      Object.assign(Store.settings, {
        companyName: qs('#sg-name').value.trim()||'Dive Squad',
        companyAddress: qs('#sg-address').value.trim(),
        currency: qs('#sg-cur').value.trim().toUpperCase()||'USD',
        currencySymbol: qs('#sg-sym').value.trim()||'$',
        holdExpiryMinutes: parseInt(qs('#sg-hold').value)||120
      });
      if(pendingLogo!==null) Store.settings.logoDataUrl = pendingLogo;
      Store.persist(); toast('Settings saved', 'ok'); renderShell(); Router.render();
    });
    qs('#sg-addlevel').addEventListener('click', ()=>{
      const v = qs('#sg-newlevel').value.trim();
      if(!v) return;
      Store.settings.certLevels = [...(Store.settings.certLevels||[]), v];
      Store.persist(); renderGeneral();
    });
    qsa('[data-del-level]').forEach(b=>b.addEventListener('click', ()=>{
      Store.settings.certLevels.splice(+b.dataset.delLevel, 1);
      Store.persist(); renderGeneral();
    }));
  }

  function renderCurrency(){
    const s = Store.settings;
    const rates = (s.exchangeRates||[]).slice().sort((a,b)=>b.date.localeCompare(a.date));
    const pension = s.pension || { enabled:false, companyPct:7, staffPct:7 };
    if(Auth.isViewOnly()){
      qs('#st-body').innerHTML = `<div class="card" style="max-width:560px"><div class="card-head"><h2>Currency &amp; tax</h2></div>
        <dl class="kv"><dt>Base currency</dt><dd>${esc(s.baseCurrency||'MVR')}</dd><dt>Default tax rate</dt><dd>${s.defaultTaxRate||0}%</dd>
        <dt>Tax period</dt><dd>${s.taxPeriodFrequency||'MONTHLY'}</dd><dt>Taxable activity name</dt><dd>${esc(s.taxableActivityName||s.companyName||'—')}</dd></dl></div>`;
      return;
    }
    qs('#st-body').innerHTML = `
      <div class="card" style="max-width:640px">
        <div class="card-head"><h2>Base currency &amp; tax</h2></div>
        <p class="small muted mb-8">The ledger always posts in the base currency. Package prices can also be quoted in USD/EUR — the rate in effect on the day is frozen onto the booking when it's posted, so a later rate change never touches old postings.</p>
        <div class="form-row">
          <div class="field"><label>Base currency (ledger)</label><input id="sc-base" type="text" value="${esc(s.baseCurrency||'MVR')}" maxlength="3" style="text-transform:uppercase"></div>
          <div class="field"><label>Default tax rate (%)</label><input id="sc-tax" type="number" min="0" step="0.01" value="${s.defaultTaxRate||0}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Tax period frequency</label>
            <select id="sc-freq"><option value="MONTHLY" ${(s.taxPeriodFrequency||'MONTHLY')==='MONTHLY'?'selected':''}>Monthly</option><option value="QUARTERLY" ${s.taxPeriodFrequency==='QUARTERLY'?'selected':''}>Quarterly</option></select>
          </div>
          <div class="field"><label>Fiscal year starts (month)</label><input id="sc-fy" type="number" min="1" max="12" value="${s.taxYearStartMonth||1}"></div>
        </div>
        <div class="field"><label>Taxable activity name <span class="hint">(as registered with MIRA — used on the Input/Output Tax Statement exports)</span></label><input id="sc-activity" type="text" value="${esc(s.taxableActivityName||'')}" placeholder="${esc(s.companyName||'')}"></div>
        <button class="btn btn-primary" id="sc-save">Save</button>
      </div>

      <div class="card" style="max-width:640px">
        <div class="card-head"><h2>Exchange rates</h2><div class="sub">To base currency (${esc(s.baseCurrency||'MVR')})</div></div>
        <div class="table-wrap mb-12"><table class="t">
          <thead><tr><th>Effective date</th><th class="num">1 USD =</th><th class="num">1 EUR =</th><th></th></tr></thead>
          <tbody>${rates.length ? rates.map((r,i)=>`<tr><td>${fmtDate(r.date)}</td><td class="num">${r.usdToMvr}</td><td class="num">${r.eurToMvr}</td>
            <td class="row-actions"><button class="btn btn-sm btn-ghost" data-del-rate="${r.id}">Remove</button></td></tr>`).join('')
            : `<tr><td colspan="4" class="table-empty">No rates set — 1:1 is assumed until you add one.</td></tr>`}</tbody>
        </table></div>
        <div class="form-row">
          <div class="field"><label>Effective from</label><input id="sr-date" type="date" value="${todayISO()}"></div>
          <div class="field"><label>1 USD =</label><input id="sr-usd" type="number" min="0" step="0.0001" value="1"></div>
          <div class="field"><label>1 EUR =</label><input id="sr-eur" type="number" min="0" step="0.0001" value="1"></div>
          <div class="field" style="justify-content:flex-end"><button class="btn" id="sr-add">+ Add rate</button></div>
        </div>
      </div>

      <div class="card" style="max-width:640px">
        <div class="card-head"><h2>Pension</h2></div>
        <p class="small muted mb-8">Applies only to local staff on the payroll (not freelancers, not foreign staff) — set per staff member under Boats &amp; staff.</p>
        <label class="checkline mb-8"><input type="checkbox" id="sp-enabled" ${pension.enabled?'checked':''}> Enable pension</label>
        <div class="form-row">
          <div class="field"><label>Company contribution %</label><input id="sp-co" type="number" min="0" step="0.1" value="${pension.companyPct||7}"></div>
          <div class="field"><label>Staff contribution %</label><input id="sp-staff" type="number" min="0" step="0.1" value="${pension.staffPct||7}"></div>
        </div>
        <button class="btn btn-primary" id="sp-save">Save pension settings</button>
      </div>
    `;
    qs('#sc-save').addEventListener('click', ()=>{
      Object.assign(Store.settings, {
        baseCurrency: qs('#sc-base').value.trim().toUpperCase()||'MVR',
        defaultTaxRate: parseFloat(qs('#sc-tax').value)||0,
        taxPeriodFrequency: qs('#sc-freq').value,
        taxYearStartMonth: parseInt(qs('#sc-fy').value)||1,
        taxableActivityName: qs('#sc-activity').value.trim()
      });
      Store.persist(); toast('Saved', 'ok'); renderCurrency();
    });
    qs('#sr-add').addEventListener('click', ()=>{
      const date = qs('#sr-date').value||todayISO();
      const usdToMvr = parseFloat(qs('#sr-usd').value)||1;
      const eurToMvr = parseFloat(qs('#sr-eur').value)||1;
      Store.settings.exchangeRates = [...(Store.settings.exchangeRates||[]), { id: Store.uid('fx'), date, usdToMvr, eurToMvr }];
      Store.persist(); toast('Rate added', 'ok'); renderCurrency();
    });
    qsa('[data-del-rate]').forEach(b=>b.addEventListener('click', ()=>{
      Store.settings.exchangeRates = (Store.settings.exchangeRates||[]).filter(r=>r.id!==b.dataset.delRate);
      Store.persist(); renderCurrency();
    }));
    qs('#sp-save').addEventListener('click', ()=>{
      Store.settings.pension = { enabled: qs('#sp-enabled').checked, companyPct: parseFloat(qs('#sp-co').value)||0, staffPct: parseFloat(qs('#sp-staff').value)||0 };
      Store.persist(); toast('Pension settings saved', 'ok');
    });
  }

  function renderMethods(){
    const methods = Store.settings.paymentMethods||[];
    const vo = Auth.isViewOnly();
    function accountLabel(m){
      if(m.kind==='CASH') return 'Cash on Hand — MVR/USD/EUR (per-currency control accounts)';
      if(m.kind==='FOB') return 'Complimentary / Promotional Expense (no cash/bank)';
      const acct = m.accountId ? Store.find('accounts', m.accountId) : (m.accountCode ? Store.acctByCode(m.accountCode) : null);
      return acct ? `${acct.code} — ${acct.name}` : '—';
    }
    function currencyLabel(m){
      if(m.kind==='CASH') return 'MVR / USD / EUR';
      if(m.kind==='FOB') return '—';
      return m.currency ? m.currency : 'Any (base + foreign)';
    }
    qs('#st-body').innerHTML = `
      <div class="help-box mb-16">Cash is the only method with a running float carried day to day — every other method (including your own) starts each day-end close at zero, reflecting only that day's collections. FOB records a comped/complimentary sale: no cash or bank is touched. A method you tie to one currency (e.g. a USD card terminal) only shows up when settling a booking in that same currency, and always settles to the clearing account you picked for it — so a USD card terminal's takings never mix with your MVR card takings.</div>
      <div class="toolbar"><div class="spacer"></div>${vo?'':`<button class="btn btn-primary" id="pm-add">+ Add payment method</button>`}</div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Method</th><th>Currency</th><th>Cash-type (denomination count)</th><th>Settles to</th><th></th></tr></thead>
        <tbody>
        ${methods.map(m=>`<tr>
          <td><strong>${esc(m.label)}</strong>${m.system?' <span class="badge badge-gray">Built-in</span>':''}</td>
          <td>${esc(currencyLabel(m))}</td>
          <td>${m.kind==='CASH' ? 'Yes (per currency)' : (m.cashType?'Yes':'No')}</td>
          <td>${esc(accountLabel(m))}</td>
          <td class="row-actions">${(!vo && !m.system)?`<button class="btn btn-sm" data-edit="${m.id}">Edit</button><button class="btn btn-sm btn-ghost" data-del="${m.id}">Delete</button>`:''}</td>
        </tr>`).join('')}
        </tbody>
      </table></div>
    `;
    if(qs('#pm-add')) qs('#pm-add').addEventListener('click', ()=>openMethodForm());
    qsa('[data-edit]').forEach(b=>b.addEventListener('click', ()=>openMethodForm(methods.find(m=>m.id===b.dataset.edit))));
    qsa('[data-del]').forEach(b=>b.addEventListener('click', ()=>{
      Store.settings.paymentMethods = methods.filter(m=>m.id!==b.dataset.del);
      Store.persist(); toast('Payment method removed', 'ok'); renderMethods();
    }));
  }

  function openMethodForm(existing){
    const CURRENCIES = ['MVR','USD','EUR'];
    // Accounts whose name already hints at the chosen currency (e.g. "Card
    // Clearing — USD") are floated to the top of the list once a currency is
    // picked below, so the natural match is easy to find — but every active
    // asset account stays selectable, since nothing here creates accounts
    // for you: set up a dedicated clearing account per currency in the
    // Chart of accounts first, the same way the built-in Cash method's
    // MVR/USD/EUR control accounts were set up.
    const allAccounts = Store.all('accounts').filter(a=>a.active && a.type==='ASSET');
    function accountOptions(currency){
      const accts = allAccounts.slice().sort((a,b)=>{
        const am = currency && a.name.toUpperCase().includes(currency) ? 0 : 1;
        const bm = currency && b.name.toUpperCase().includes(currency) ? 0 : 1;
        return am-bm || a.code.localeCompare(b.code);
      });
      return accts.map(a=>`<option value="${a.id}" ${existing&&existing.accountId===a.id?'selected':''}>${esc(a.code)} — ${esc(a.name)}</option>`).join('');
    }
    openModal({
      title: existing?'Edit payment method':'Add payment method',
      bodyHtml: `
        <div class="field"><label>Name</label><input id="pmf-label" type="text" value="${esc(existing?existing.label:'')}" placeholder="e.g. USD Card, QR Pay, House account"></div>
        <div class="field"><label>Currency</label>
          <select id="pmf-currency">
            <option value="">Any currency — one account for MVR/USD/EUR alike</option>
            ${CURRENCIES.map(c=>`<option value="${c}" ${existing&&existing.currency===c?'selected':''}>${c} only</option>`).join('')}
          </select>
          <div class="hint">Tie this method to one currency (e.g. a USD card terminal) and it will only be offered when settling a booking in that currency, and always settle to the account below — a dedicated clearing account, e.g. "Card Clearing — USD", so it never mixes with your other currencies' takings.</div>
        </div>
        <label class="checkline mb-8"><input type="checkbox" id="pmf-cash" ${existing&&existing.cashType?'checked':''}> Cash-type (counted by denomination at day-end close)</label>
        <div class="field"><label>Settlement account</label><select id="pmf-acct">${accountOptions(existing&&existing.currency)}</select></div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="pmf-save">Save</button>`,
      onMount(modal){
        qs('#pmf-currency', modal).addEventListener('change', ()=>{
          const cur = qs('#pmf-currency', modal).value;
          const acctSel = qs('#pmf-acct', modal);
          const kept = acctSel.value;
          acctSel.innerHTML = accountOptions(cur);
          if([...acctSel.options].some(o=>o.value===kept)) acctSel.value = kept;
        });
        qs('#pmf-save', modal).addEventListener('click', ()=>{
          const label = qs('#pmf-label', modal).value.trim();
          if(!label){ toast('Enter a name.', 'err'); return; }
          const data = { label, kind:'STD', currency: qs('#pmf-currency', modal).value || null,
            cashType: qs('#pmf-cash', modal).checked, accountId: qs('#pmf-acct', modal).value, system:false };
          const methods = Store.settings.paymentMethods||[];
          if(existing) Object.assign(existing, data);
          else methods.push(Object.assign({ id: 'PM_'+Store.uid('').toUpperCase() }, data));
          Store.settings.paymentMethods = methods;
          Store.persist(); closeModal(); toast('Payment method saved', 'ok'); renderMethods();
        });
      }
    });
  }

  // Sales-invoice template: lets the shop customize the printed/on-screen
  // layout without touching code — the title, an accent color, which
  // optional lines show (address / bill-to / booking link), and a footer
  // note. Applied live in invoices.js.
  function renderInvoiceTemplate(){
    const tpl = Store.settings.invoiceTemplate || {};
    const vo = Auth.isViewOnly();
    if(vo){
      qs('#st-body').innerHTML = `<div class="card" style="max-width:560px"><div class="card-head"><h2>Invoice template</h2></div>
        <dl class="kv"><dt>Title</dt><dd>${esc(tpl.title||'Sales Invoice')}</dd></dl>
      </div>`;
      return;
    }
    qs('#st-body').innerHTML = `
      <div class="grid grid-2" style="align-items:start;gap:16px">
        <div class="card">
          <div class="card-head"><h2>Invoice template</h2></div>
          <p class="small muted mb-12">Controls how every sales invoice looks — on screen and when printed.</p>
          <div class="field"><label>Document title</label><input id="it-title" type="text" value="${esc(tpl.title||'Sales Invoice')}" placeholder="e.g. Sales Invoice, Tax Invoice"></div>
          <div class="field"><label>Accent color</label><input id="it-color" type="color" value="${esc(tpl.accentColor||'#0b5d56')}" style="height:38px;width:80px;padding:2px"></div>
          <label class="checkline mb-8"><input type="checkbox" id="it-logo" ${tpl.showLogo!==false?'checked':''}> Show company logo</label>
          <label class="checkline mb-8"><input type="checkbox" id="it-address" ${tpl.showAddress!==false?'checked':''}> Show company address</label>
          <label class="checkline mb-8"><input type="checkbox" id="it-billto" ${tpl.showBillTo!==false?'checked':''}> Show a "Bill to" line <span class="hint">(editable per invoice — for when it differs from the customer/account name)</span></label>
          <label class="checkline mb-12"><input type="checkbox" id="it-booking" ${tpl.showBookingLink!==false?'checked':''}> Show the linked booking #</label>
          <div class="field"><label>Footer note <span class="hint">(printed at the bottom of every invoice)</span></label><textarea id="it-footer" rows="2" placeholder="e.g. Thank you for diving with us!">${esc(tpl.footerNote||'')}</textarea></div>
          <button class="btn btn-primary" id="it-save">Save template</button>
        </div>
        <div class="card">
          <div class="card-head"><h2>Preview</h2></div>
          <div id="it-preview"></div>
        </div>
      </div>
    `;
    function renderPreview(){
      const s = Store.settings;
      const title = qs('#it-title').value.trim()||'Sales Invoice';
      const color = qs('#it-color').value;
      const showLogo = qs('#it-logo').checked, showAddress = qs('#it-address').checked, showBillTo = qs('#it-billto').checked, showBooking = qs('#it-booking').checked;
      const footer = qs('#it-footer').value.trim();
      qs('#it-preview').innerHTML = `
        <div class="card" style="border-top:3px solid ${esc(color)};box-shadow:none;border-width:1px 1px 1px 1px;border-style:solid;border-color:var(--line)">
          <div class="flex-between mb-12">
            <div>
              ${showLogo && s.logoDataUrl?`<img src="${s.logoDataUrl}" style="max-height:40px;max-width:150px;display:block;margin-bottom:6px">`:''}
              <div style="font-weight:700">${esc(s.companyName||'')}</div>
              ${showAddress && s.companyAddress?`<div class="small muted">${esc(s.companyAddress)}</div>`:''}
            </div>
            <div style="text-align:right">
              <div style="font-weight:700;color:${esc(color)}">${esc(title)}</div>
              <div class="small muted">INV-00001</div>
              <div class="small muted">Currency: ${esc(s.baseCurrency||'MVR')}</div>
            </div>
          </div>
          <dl class="kv small mb-0">
            <dt>Customer</dt><dd>Example Agent</dd>
            ${showBillTo?`<dt>Bill to</dt><dd>Jane at Example Agent</dd>`:''}
            ${showBooking?`<dt>Booking</dt><dd>BK-00001</dd>`:''}
          </dl>
          ${footer?`<div class="small muted mt-12" style="text-align:center">${esc(footer)}</div>`:''}
        </div>
      `;
    }
    ['it-title','it-color','it-logo','it-address','it-billto','it-booking','it-footer'].forEach(id=>{
      qs('#'+id).addEventListener('input', renderPreview);
    });
    renderPreview();
    qs('#it-save').addEventListener('click', ()=>{
      Store.settings.invoiceTemplate = {
        title: qs('#it-title').value.trim()||'Sales Invoice',
        accentColor: qs('#it-color').value||'#0b5d56',
        showLogo: qs('#it-logo').checked,
        showAddress: qs('#it-address').checked,
        showBillTo: qs('#it-billto').checked,
        showBookingLink: qs('#it-booking').checked,
        footerNote: qs('#it-footer').value.trim()
      };
      Store.persist(); toast('Invoice template saved', 'ok'); renderInvoiceTemplate();
    });
  }

  function renderUsers(){
    const users = Store.all('users');
    const vo = Auth.isViewOnly();
    qs('#st-body').innerHTML = `
      <div class="toolbar"><div class="spacer"></div>${vo?'':`<button class="btn btn-primary" id="us-add">+ Add user</button>`}</div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>${users.map(u=>`<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(Auth.roleLabel(u.role))}</td>
          <td>${u.active!==false?'<span class="badge badge-green">Active</span>':'<span class="badge badge-gray">Inactive</span>'}</td>
          <td class="row-actions">${vo?'':`<button class="btn btn-sm" data-edit="${u.id}">Edit</button>`}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="help-box mt-16">This is role separation for accountability, not secure login — anyone using this computer can switch users from the top bar.</div>
    `;
    if(qs('#us-add')) qs('#us-add').addEventListener('click', ()=>openUserForm());
    qsa('[data-edit]').forEach(b=>b.addEventListener('click', ()=>openUserForm(Store.find('users', b.dataset.edit))));
  }

  function renderRoles(){
    const roles = Auth.roles();
    const actions = ['DAY_END_CLOSE','APPROVE_VOUCHER','APPROVE_BILL','POST_PAYROLL','CLOSE_TAX_PERIOD','POST_DEPOSIT'];
    const actionLabel = { DAY_END_CLOSE:'Close the day', APPROVE_VOUCHER:'Approve & pay vouchers', APPROVE_BILL:'Approve bills',
      POST_PAYROLL:'Post payroll', CLOSE_TAX_PERIOD:'Close tax periods', POST_DEPOSIT:'Post deposits' };
    qs('#st-body').innerHTML = `
      <div class="help-box mb-16">ADMIN, ACCOUNTANT, FRONT_DESK and OWNER are seeded by default and can be edited but not removed. OWNER is view-only everywhere in the app regardless of the permissions below — it can never create, edit, delete, approve or pay anything.</div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Role</th><th>View only</th>${actions.map(a=>`<th>${esc(actionLabel[a])}</th>`).join('')}</tr></thead>
        <tbody>
        ${roles.map(r=>`<tr data-role="${r.id}">
          <td><strong>${esc(r.label)}</strong>${r.full?' <span class="badge badge-teal">Full access</span>':''}${r.kioskOnly?' <span class="badge badge-amber">Kiosk only — no other screens</span>':''}</td>
          <td>${r.system?'<label class="checkline"><input type="checkbox" data-vo disabled '+(r.viewOnly?'checked':'')+'></label>':`<label class="checkline"><input type="checkbox" data-vo ${r.viewOnly?'checked':''}></label>`}</td>
          ${actions.map(a=>`<td>${r.full?'<span class="muted small">always</span>':r.kioskOnly?'<span class="muted small">n/a</span>':`<label class="checkline"><input type="checkbox" data-perm="${a}" ${(r.permissions||[]).includes(a)?'checked':''}></label>`}</td>`).join('')}
        </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="toolbar mt-16">
        <input id="rl-newname" type="text" placeholder="New role name" style="max-width:200px">
        <button class="btn" id="rl-add">+ Add role</button>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="rl-save">Save roles</button>
      </div>
    `;
    qs('#rl-add').addEventListener('click', ()=>{
      const name = qs('#rl-newname').value.trim();
      if(!name) return;
      Store.settings.roles.push({ id: 'ROLE_'+Store.uid('').toUpperCase(), label:name, system:false, full:false, viewOnly:false, permissions:[] });
      Store.persist(); toast('Role added', 'ok'); renderRoles();
    });
    qs('#rl-save').addEventListener('click', ()=>{
      qsa('tr[data-role]').forEach(tr=>{
        const id = tr.dataset.role;
        const role = Store.settings.roles.find(r=>r.id===id);
        if(!role) return;
        const voInp = qs('[data-vo]', tr);
        if(voInp && !voInp.disabled) role.viewOnly = voInp.checked;
        if(!role.full) role.permissions = qsa('[data-perm]', tr).filter(i=>i.checked).map(i=>i.dataset.perm);
      });
      Store.persist(); toast('Roles saved', 'ok'); renderShell(); Router.render();
    });
  }

  function openUserForm(existing){
    openModal({
      title: existing?'Edit user':'Add user',
      bodyHtml: `
        <div class="field"><label>Name</label><input id="uf-name" type="text" value="${esc(existing?existing.name:'')}"></div>
        <div class="field"><label>Role</label>
          <select id="uf-role">${Auth.ROLES.map(r=>`<option value="${r}" ${existing&&existing.role===r?'selected':''}>${Auth.ROLE_LABEL[r]}</option>`).join('')}</select>
        </div>
        <label class="checkline"><input type="checkbox" id="uf-active" ${!existing||existing.active!==false?'checked':''}> Active</label>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="uf-save">Save</button>`,
      onMount(modal){
        qs('#uf-save', modal).addEventListener('click', ()=>{
          const name = qs('#uf-name', modal).value.trim();
          if(!name){ toast('Enter a name.', 'err'); return; }
          const data = { name, role: qs('#uf-role', modal).value, active: qs('#uf-active', modal).checked };
          if(existing) Store.update('users', existing.id, data); else Store.insert('users', data);
          closeModal(); toast('User saved', 'ok'); renderShell(); Router.render();
        });
      }
    });
  }

  function renderData(){
    const vo = Auth.isViewOnly();
    qs('#st-body').innerHTML = `
      <div class="card" style="max-width:560px">
        <div class="card-head"><h2>Backup</h2></div>
        <p class="small muted mb-12">All of your data lives in this browser only. Export a backup regularly, and keep it somewhere safe.</p>
        <button class="btn btn-primary" id="dt-export">Download backup (JSON)</button>
      </div>
      ${vo?'':`
      <div class="card" style="max-width:560px">
        <div class="card-head"><h2>Restore</h2></div>
        <p class="small muted mb-12">Restoring replaces everything currently in this app with the contents of the backup file.</p>
        <input type="file" id="dt-file" accept="application/json">
        <button class="btn btn-danger mt-12" id="dt-import" disabled>Restore from file</button>
      </div>
      <div class="card" style="max-width:560px">
        <div class="card-head"><h2>Start over</h2></div>
        <p class="small muted mb-12">Erases everything and returns the app to a blank state. This cannot be undone — export a backup first.</p>
        <button class="btn btn-danger" id="dt-reset">Erase all data</button>
      </div>`}
    `;
    qs('#dt-export').addEventListener('click', ()=>{
      downloadFile(`dive-erp-backup-${todayISO()}.json`, Store.exportJson(), 'application/json');
      toast('Backup downloaded', 'ok');
    });
    if(vo) return;
    const fileInp = qs('#dt-file'), importBtn = qs('#dt-import');
    let fileContent = null;
    fileInp.addEventListener('change', ()=>{
      const f = fileInp.files[0];
      if(!f){ importBtn.disabled = true; return; }
      const reader = new FileReader();
      reader.onload = ()=>{ fileContent = reader.result; importBtn.disabled = false; };
      reader.readAsText(f);
    });
    importBtn.addEventListener('click', ()=>{
      confirmDialog('This replaces all current data with the backup file. Continue?', ()=>{
        try{ Store.importJson(fileContent); toast('Backup restored', 'ok'); boot(); }
        catch(e){ toast('Could not read that file: '+e.message, 'err'); }
      }, {danger:true, yesLabel:'Restore'});
    });
    qs('#dt-reset').addEventListener('click', ()=>{
      confirmDialog('This erases everything in this app. This cannot be undone. Continue?', ()=>{
        Store.resetAll(); toast('All data erased'); location.hash = ''; boot();
      }, {danger:true, yesLabel:'Erase everything'});
    });
  }

  Router.on('/settings', render);
})();
