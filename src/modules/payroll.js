/* ---------------------------------------------------------------------
   payroll.js — salary calculation from each staff member's structured
   salary package (basic + allowances + bonuses + deductions), plus
   completed-trip commission and a local-staff pension (7%/7% of basic
   by default, set in Settings). Freelancers never appear on a payroll
   run — they're paid per-trip via a bill or voucher instead.
--------------------------------------------------------------------- */

(function(){

  function render(params){
    setPageTitle('Salary', 'Finance');
    renderNav();
    const tab = params.sub || 'runs';
    qs('#content').innerHTML = `
      <div class="tabs">
        <div class="tab ${tab==='runs'?'active':''}" data-tab="runs">Payroll runs</div>
        <div class="tab ${tab==='advances'?'active':''}" data-tab="advances">Advances</div>
      </div>
      <div id="pr-body"></div>
    `;
    qsa('[data-tab]').forEach(t=>t.addEventListener('click', ()=>Router.navigate('payroll/x/'+t.dataset.tab)));
    if(tab==='advances') renderAdvances(); else renderRuns();
  }

  function renderRuns(){
    const vo = Auth.isViewOnly();
    const runs = Store.all('payrollRuns').slice().sort((a,b)=>b.period.localeCompare(a.period));
    qs('#pr-body').innerHTML = `
      <div class="toolbar"><div class="spacer"></div>${vo?'':`<button class="btn btn-primary" id="pr-new">+ New payroll run</button>`}</div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Period</th><th>Staff</th><th class="num">Gross</th><th class="num">Pension</th><th class="num">Deductions</th><th class="num">Net</th><th>Status</th><th></th></tr></thead>
        <tbody>
        ${runs.length ? runs.map(r=>`<tr>
          <td><strong>${esc(r.period)}</strong></td><td>${(r.staffLines||[]).length}</td>
          <td class="num">${fmtMoney(r.grossTotal||0)}</td><td class="num">${fmtMoney((r.staffPensionTotal||0)+(r.companyPensionTotal||0))}</td>
          <td class="num">${fmtMoney(r.deductionTotal||0)}</td><td class="num">${fmtMoney(r.netTotal||0)}</td>
          <td>${r.status==='POSTED'?'<span class="badge badge-teal">Posted</span>':'<span class="badge badge-gray">Draft</span>'}</td>
          <td class="row-actions">
            ${r.status==='DRAFT' && !vo ?`<button class="btn btn-sm" data-edit="${r.id}">Edit</button>`:''}
            ${r.status==='POSTED' && !r.paid && !vo ? `<button class="btn btn-sm btn-primary" data-pay="${r.id}">Pay run</button>`:''}
            ${r.paid ? `<span class="badge badge-green">Paid</span>`:''}
          </td>
        </tr>`).join('') : `<tr><td colspan="8" class="table-empty">No payroll runs yet.</td></tr>`}
        </tbody>
      </table></div>
    `;
    if(qs('#pr-new')) qs('#pr-new').addEventListener('click', ()=>openRunForm());
    qsa('[data-edit]').forEach(b=>b.addEventListener('click', ()=>openRunForm(Store.find('payrollRuns', b.dataset.edit))));
    qsa('[data-pay]').forEach(b=>b.addEventListener('click', ()=>payRun(Store.find('payrollRuns', b.dataset.pay))));
  }

  function completedDivesInPeriod(staffId, period){
    const [y,m] = period.split('-').map(Number);
    let count = 0;
    Store.all('trips').forEach(trip=>{
      if(!(trip.staffIds||[]).includes(staffId)) return;
      const d = new Date(trip.tripDate+'T00:00:00');
      if(d.getFullYear()!==y || (d.getMonth()+1)!==m) return;
      Store.all('bookings').forEach(b=>{
        (b.guestLines||[]).forEach(gl=>{ if(gl.tripId===trip.id && gl.status==='COMPLETED') count++; });
      });
    });
    return count;
  }

  function advanceBalance(staffId){
    return Ledger.partyBalance('staff', staffId); // debit-natural asset balance = amount still owed by staff
  }

  function pensionEligible(s){
    const cfg = Store.settings.pension || {};
    if(cfg.enabled===false) return false;
    return s.employmentType!=='FREELANCER' && s.localStatus!=='FOREIGN';
  }

  function openRunForm(existing){
    const staff = Store.all('staff').filter(s=>s.active!==false && s.employmentType!=='FREELANCER');
    const defaultPeriod = todayISO().slice(0,7);
    let period = existing ? existing.period : defaultPeriod;
    let staffLines = existing ? JSON.parse(JSON.stringify(existing.staffLines)) : buildDraftLines(staff, period);

    function buildDraftLines(staff, period){
      const pensionCfg = Store.settings.pension || { companyPct:7, staffPct:7 };
      return staff.map(s=>{
        const pkg = s.salaryPackage || { basic: s.baseSalary||0, allowances:[], bonuses:[], deductions:[] };
        const basic = pkg.basic||0;
        const allowTotal = (pkg.allowances||[]).reduce((sum,a)=>sum+(a.amount||0),0);
        const bonusTotal = (pkg.bonuses||[]).reduce((sum,a)=>sum+(a.amount||0),0);
        const otherDeductions = (pkg.deductions||[]).reduce((sum,a)=>sum+(a.amount||0),0);
        const dives = completedDivesInPeriod(s.id, period);
        const commission = Ledger.round2(dives * (s.commissionPerDive||0));
        const gross = Ledger.round2(basic+allowTotal+bonusTotal+commission);
        const bal = advanceBalance(s.id);
        const eligible = pensionEligible(s);
        const staffPension = eligible ? Ledger.round2(basic * (pensionCfg.staffPct||7)/100) : 0;
        const companyPension = eligible ? Ledger.round2(basic * (pensionCfg.companyPct||7)/100) : 0;
        const advanceDeduction = Math.min(bal, Math.max(0, gross-staffPension-otherDeductions));
        return { staffId: s.id, basic, allowTotal, bonusTotal, diveCount: dives, commission, grossPay: gross,
          otherDeductions, pensionEligible: eligible, staffPension, companyPension,
          advanceDeduction, netPay: 0 };
      }).map(l=>({ ...l, netPay: Ledger.round2(l.grossPay-l.advanceDeduction-l.staffPension-l.otherDeductions) }));
    }

    openModal({
      title: existing ? `Payroll — ${existing.period}` : 'New payroll run', size:'lg',
      bodyHtml: `
        <div class="field" style="max-width:200px"><label>Period</label><input id="pf-period" type="month" value="${period}" ${existing?'disabled':''}></div>
        <div id="pf-lines"></div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn" id="pf-save-draft">Save draft</button><button class="btn btn-primary" id="pf-post">Post run</button>`,
      onMount(modal){
        function renderLines(){
          qs('#pf-lines', modal).innerHTML = `
            <div class="table-wrap"><table class="t">
              <thead><tr><th>Staff</th><th class="num">Basic</th><th class="num">Allow.+Bonus</th><th class="num">Dives</th><th class="num">Commission</th><th class="num">Gross</th><th class="num">Pension (staff/co.)</th><th class="num">Other ded.</th><th class="num">Advance ded.</th><th class="num">Net</th></tr></thead>
              <tbody>
              ${staffLines.map((l,i)=>{
                const s = Store.find('staff', l.staffId);
                return `<tr><td>${esc(s?s.name:'—')}</td><td class="num">${fmtMoney(l.basic)}</td><td class="num">${fmtMoney(l.allowTotal+l.bonusTotal)}</td><td class="num">${l.diveCount}</td>
                  <td class="num">${fmtMoney(l.commission)}</td><td class="num">${fmtMoney(l.grossPay)}</td>
                  <td class="num">${l.pensionEligible?`${fmtMoney(l.staffPension)} / ${fmtMoney(l.companyPension)}`:'<span class="muted">n/a</span>'}</td>
                  <td class="num">${fmtMoney(l.otherDeductions)}</td>
                  <td class="num"><input type="number" min="0" step="0.01" style="width:90px;text-align:right" data-ded="${i}" value="${l.advanceDeduction}"></td>
                  <td class="num">${fmtMoney(l.netPay)}</td></tr>`;
              }).join('')}
              </tbody>
            </table></div>
          `;
          qsa('[data-ded]', modal).forEach(inp=>inp.addEventListener('input', e=>{
            const i = +e.target.dataset.ded;
            staffLines[i].advanceDeduction = Ledger.round2(parseFloat(e.target.value)||0);
            staffLines[i].netPay = Ledger.round2(staffLines[i].grossPay - staffLines[i].advanceDeduction - staffLines[i].staffPension - staffLines[i].otherDeductions);
            renderLines();
          }));
        }
        renderLines();
        qs('#pf-period', modal).addEventListener('change', e=>{
          period = e.target.value;
          staffLines = buildDraftLines(staff, period);
          renderLines();
        });
        qs('#pf-save-draft', modal).addEventListener('click', ()=>{
          const data = { period, staffLines, status:'DRAFT' };
          if(existing) Store.update('payrollRuns', existing.id, data); else Store.insert('payrollRuns', data);
          closeModal(); toast('Payroll draft saved', 'ok'); renderRuns();
        });
        qs('#pf-post', modal).addEventListener('click', ()=>{
          if(!Auth.can('POST_PAYROLL')){ toast('Only an accountant or admin can post payroll.', 'err'); return; }
          const run = existing ? Store.update('payrollRuns', existing.id, { period, staffLines }) : Store.insert('payrollRuns', { period, staffLines, status:'DRAFT' });
          try{
            Posting.postPayrollRun(run);
            closeModal(); toast('Payroll posted', 'ok'); renderRuns();
          }catch(e){ toast(e.message, 'err'); }
        });
      }
    });
  }

  function payRun(run){
    if(!run) return;
    if(!Auth.can('APPROVE_VOUCHER')){ toast('Only an accountant or admin can pay this.', 'err'); return; }
    openModal({
      title:`Pay payroll — ${run.period}`,
      bodyHtml: `<p>Net payable: <strong>${fmtMoney(run.netTotal)}</strong></p><div class="field"><label>Pay from</label><select id="pp-method"><option value="BANK">Bank</option><option value="CASH">Till (cash)</option></select></div>`,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="pp-save">Pay</button>`,
      onMount(modal){
        qs('#pp-save', modal).addEventListener('click', ()=>{
          try{
            VouchersModule.quickCreate('BANK_CASH', { payee:'Staff payroll', method: qs('#pp-method', modal).value, memo:'Payroll '+run.period,
              lines:[{ kind:'GL', accountId: Store.acctId('2200'), description:'Payroll '+run.period, amount: run.netTotal }] }, true);
            Store.update('payrollRuns', run.id, { paid:true });
            closeModal(); toast('Payroll paid', 'ok'); renderRuns();
          }catch(e){ toast(e.message, 'err'); }
        });
      }
    });
  }

  function renderAdvances(){
    const vo = Auth.isViewOnly();
    const rows = Store.all('advances').slice().sort((a,b)=>b.date.localeCompare(a.date));
    qs('#pr-body').innerHTML = `
      <div class="toolbar"><div class="spacer"></div>${vo?'':`<button class="btn btn-primary" id="ad-add">+ Give advance</button>`}</div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Staff</th><th>Date</th><th class="num">Amount</th><th class="num">Outstanding</th></tr></thead>
        <tbody>
        ${rows.length ? rows.map(a=>{
          const s = Store.find('staff', a.staffId);
          return `<tr><td>${esc(s?s.name:'—')}</td><td>${fmtDate(a.date)}</td><td class="num">${fmtMoney(a.amount)}</td><td class="num">${fmtMoney(advanceBalance(a.staffId))}</td></tr>`;
        }).join('') : `<tr><td colspan="4" class="table-empty">No advances yet.</td></tr>`}
        </tbody>
      </table></div>
    `;
    if(qs('#ad-add')) qs('#ad-add').addEventListener('click', ()=>openAdvanceForm());
  }

  function openAdvanceForm(){
    const staff = Store.all('staff').filter(s=>s.active!==false);
    openModal({
      title:'Give staff advance',
      bodyHtml: `
        <div class="field"><label>Staff</label><select id="af-staff">${staff.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
        <div class="form-row">
          <div class="field"><label>Amount</label><input id="af-amt" type="number" min="0" step="0.01"></div>
          <div class="field"><label>Method</label><select id="af-method"><option value="CASH">Cash</option><option value="BANK">Bank</option></select></div>
        </div>
        <div class="field"><label>Date</label><input id="af-date" type="date" value="${todayISO()}"></div>
      `,
      footerHtml: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="af-save">Give advance</button>`,
      onMount(modal){
        qs('#af-save', modal).addEventListener('click', ()=>{
          const amount = parseFloat(qs('#af-amt', modal).value);
          if(!amount || amount<=0){ toast('Enter an amount.', 'err'); return; }
          const adv = Store.insert('advances', { staffId: qs('#af-staff', modal).value, amount, method: qs('#af-method', modal).value, date: qs('#af-date', modal).value||todayISO() });
          try{ Posting.postAdvance(adv); closeModal(); toast('Advance recorded', 'ok'); renderAdvances(); }
          catch(e){ toast(e.message, 'err'); }
        });
      }
    });
  }

  Router.on('/payroll', render);
})();
