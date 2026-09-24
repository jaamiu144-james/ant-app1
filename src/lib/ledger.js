/* ---------------------------------------------------------------------
   ledger.js — double-entry posting engine.
   Every business event (sale, receipt, bill, payment, payroll, tax,
   day-end close) becomes one balanced JournalEntry. Reports read only
   from journalEntries + accounts, never from the operational records
   directly, so the books are always internally consistent.
--------------------------------------------------------------------- */

const Ledger = (function(){

  function isDayLocked(dateStr){
    const d = (dateStr||'').slice(0,10);
    return Store.where('dayEndCloses', c=>c.date===d && c.status==='LOCKED').length>0;
  }

  // lines: [{accountId, debit, credit, partyType, partyId, memo}]
  function post({ date, ref, description, sourceType, sourceId, lines, allowLocked }){
    const debit = round2(lines.reduce((s,l)=>s+(l.debit||0),0));
    const credit = round2(lines.reduce((s,l)=>s+(l.credit||0),0));
    if(Math.abs(debit-credit) > 0.01){
      throw new Error(`Journal entry does not balance (debit ${debit}, credit ${credit}): ${description}`);
    }
    if(!allowLocked && isDayLocked(date || todayISO())){
      throw new Error(`${fmtDateSafe(date)} is locked by a day-end close. This can't be posted or changed on that date.`);
    }
    const je = {
      id: Store.uid('je'),
      date: date || todayISO(),
      ref: ref || '',
      description: description || '',
      sourceType: sourceType || '',
      sourceId: sourceId || '',
      lines: lines.map(l=>({
        accountId: l.accountId,
        debit: round2(l.debit||0),
        credit: round2(l.credit||0),
        partyType: l.partyType||null,
        partyId: l.partyId||null,
        memo: l.memo||''
      })),
      createdAt: new Date().toISOString()
    };
    Store.insert('journalEntries', je);
    return je;
  }

  function reverse(journalEntryId, reason){
    const je = Store.find('journalEntries', journalEntryId);
    if(!je) return null;
    if((je.lines||[]).some(l=>l.reconciled)){
      throw new Error('This entry has a reconciled line and is locked — it can\'t be reversed. Undo the reconciliation it belongs to first.');
    }
    return post({
      date: todayISO(),
      ref: 'REV-'+je.ref,
      description: 'Reversal: '+je.description+(reason?` (${reason})`:''),
      sourceType: je.sourceType, sourceId: je.sourceId,
      lines: je.lines.map(l=>({ accountId:l.accountId, debit:l.credit, credit:l.debit, partyType:l.partyType, partyId:l.partyId, memo:l.memo }))
    });
  }

  function accountBalance(accountId, upToDate){
    const acc = Store.find('accounts', accountId);
    if(!acc) return 0;
    let debit=0, credit=0;
    entriesForAccount(accountId, upToDate).forEach(({line})=>{ debit+=line.debit; credit+=line.credit; });
    const natural = ['ASSET','EXPENSE'].includes(acc.type) ? 'DEBIT' : 'CREDIT';
    return natural==='DEBIT' ? round2(debit-credit) : round2(credit-debit);
  }

  function entriesForAccount(accountId, upToDate, fromDate){
    const out = [];
    Store.all('journalEntries').forEach(je=>{
      if(upToDate && je.date > upToDate) return;
      if(fromDate && je.date < fromDate) return;
      je.lines.forEach(line=>{
        if(line.accountId===accountId) out.push({ je, line });
      });
    });
    return out.sort((a,b)=> a.je.date.localeCompare(b.je.date) || a.je.createdAt.localeCompare(b.je.createdAt));
  }

  function partyBalance(partyType, partyId, upToDate){
    let debit=0, credit=0;
    Store.all('journalEntries').forEach(je=>{
      if(upToDate && je.date>upToDate) return;
      je.lines.forEach(line=>{
        if(line.partyType===partyType && line.partyId===partyId){ debit+=line.debit; credit+=line.credit; }
      });
    });
    return round2(debit-credit); // positive = they owe us (AR) or we owe them, sign convention resolved by caller
  }

  function partyEntries(partyType, partyId){
    const out = [];
    Store.all('journalEntries').forEach(je=>{
      je.lines.forEach(line=>{
        if(line.partyType===partyType && line.partyId===partyId) out.push({je, line});
      });
    });
    return out.sort((a,b)=> a.je.date.localeCompare(b.je.date) || a.je.createdAt.localeCompare(b.je.createdAt));
  }

  function trialBalance(upToDate){
    return Store.all('accounts').filter(a=>a.active).map(acc=>{
      const bal = accountBalance(acc.id, upToDate);
      const natural = ['ASSET','EXPENSE'].includes(acc.type) ? 'DEBIT' : 'CREDIT';
      return {
        account: acc,
        debit: natural==='DEBIT' ? Math.max(bal,0) : Math.max(-bal,0),
        credit: natural==='CREDIT' ? Math.max(bal,0) : Math.max(-bal,0),
        balance: bal
      };
    }).filter(r=> r.debit!==0 || r.credit!==0 || true);
  }

  function incomeStatement(fromDate, toDate){
    const rev = Store.where('accounts', a=>a.type==='REVENUE' && a.active);
    const exp = Store.where('accounts', a=>a.type==='EXPENSE' && a.active);
    const line = (acc)=>{
      let debit=0, credit=0;
      entriesForAccount(acc.id, toDate, fromDate).forEach(({line})=>{ debit+=line.debit; credit+=line.credit; });
      const natural = acc.type==='REVENUE' ? 'CREDIT' : 'DEBIT';
      const amt = natural==='CREDIT' ? round2(credit-debit) : round2(debit-credit);
      return { account: acc, amount: amt };
    };
    const revenueLines = rev.map(line);
    const expenseLines = exp.map(line);
    const totalRevenue = round2(revenueLines.reduce((s,l)=>s+l.amount,0));
    const totalExpense = round2(expenseLines.reduce((s,l)=>s+l.amount,0));
    return { revenueLines, expenseLines, totalRevenue, totalExpense, netIncome: round2(totalRevenue-totalExpense) };
  }

  function balanceSheet(asOfDate){
    const netIncomeToDate = incomeStatement(null, asOfDate).netIncome;
    const secs = ['ASSET','LIABILITY','EQUITY'].map(type=>{
      const accs = Store.where('accounts', a=>a.type===type && a.active);
      const lines = accs.map(acc=>({ account: acc, amount: accountBalance(acc.id, asOfDate) }))
                         .filter(l=>Math.abs(l.amount)>0.004 || true);
      return { type, lines, total: round2(lines.reduce((s,l)=>s+l.amount,0)) };
    });
    const assets = secs.find(s=>s.type==='ASSET');
    const liab = secs.find(s=>s.type==='LIABILITY');
    const eq = secs.find(s=>s.type==='EQUITY');
    const equityTotalWithNI = round2(eq.total + netIncomeToDate);
    return { assets, liabilities: liab, equity: eq, netIncomeToDate, equityTotalWithNI,
             totalLiabEquity: round2(liab.total + equityTotalWithNI) };
  }

  /* ---- Bank / cash reconciliation ----
     Reconciliation never posts a journal entry — it only marks already-posted
     lines on a balance-sheet account as cleared/reconciled. A reconciled line
     becomes protected: Ledger.reverse() refuses to touch its journal entry. */

  // Lines on `accountId`, on or before `uptoDate`, not yet reconciled — the
  // candidate list a reconciliation screen offers to check off.
  function unreconciledEntriesForAccount(accountId, uptoDate){
    return entriesForAccount(accountId, uptoDate).filter(({line})=>!line.reconciled);
  }

  // The natural-signed running balance of every already-reconciled line on
  // this account as of `uptoDate` — i.e. what a reconciliation starting after
  // that date should treat as its opening/beginning balance.
  function reconciledBalanceAsOf(accountId, uptoDate){
    const acc = Store.find('accounts', accountId);
    if(!acc) return 0;
    const natural = ['ASSET','EXPENSE'].includes(acc.type) ? 'DEBIT' : 'CREDIT';
    let debit=0, credit=0;
    entriesForAccount(accountId, uptoDate).forEach(({line})=>{ if(line.reconciled){ debit+=line.debit; credit+=line.credit; } });
    return natural==='DEBIT' ? round2(debit-credit) : round2(credit-debit);
  }

  // Marks the given {journalEntryId, lineIndex} refs as reconciled, tagged
  // with the reconciliation record's id. Mutates only `reconciled` /
  // `reconciledInId` on those lines — never touches debit/credit/accountId,
  // so this can never change a historical balance.
  function markLinesReconciled(entryRefs, reconciliationId){
    const byJe = {};
    entryRefs.forEach(r=>{ (byJe[r.journalEntryId] = byJe[r.journalEntryId]||[]).push(r.lineIndex); });
    Object.entries(byJe).forEach(([jeId, idxs])=>{
      const je = Store.find('journalEntries', jeId);
      if(!je) return;
      const lines = je.lines.map((l,i)=> idxs.includes(i) ? Object.assign({}, l, { reconciled:true, reconciledInId: reconciliationId }) : l);
      Store.update('journalEntries', jeId, { lines });
    });
  }

  function round2(n){ return Math.round((n+Number.EPSILON)*100)/100; }
  function todayISO(){ return new Date().toISOString().slice(0,10); }
  function fmtDateSafe(d){ return d || todayISO(); }

  return { post, reverse, accountBalance, entriesForAccount, partyBalance, partyEntries,
           trialBalance, incomeStatement, balanceSheet, isDayLocked, round2, todayISO,
           unreconciledEntriesForAccount, reconciledBalanceAsOf, markLinesReconciled };
})();

window.Ledger = Ledger;
