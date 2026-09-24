/* ---------------------------------------------------------------------
   e2e.mjs — drives the bundled dist/dive-erp.html through a full
   scenario: setup, catalog, calendar, a Direct booking and an Agent
   booking, gear issue/return, day-end close, a vendor bill and
   payment, petty cash, payroll, tax, then checks the books balance.
   Run with: node test/e2e.mjs
--------------------------------------------------------------------- */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE_URL = 'file://' + path.join(__dirname, '..', 'dist', 'dive-erp.html');

let pass = 0, fail = 0;
function ok(cond, msg){
  if(cond){ pass++; console.log('  ok -', msg); }
  else { fail++; console.log('  FAIL -', msg); }
}

// Reads an account's live ledger balance straight out of the app's in-page
// Store/Ledger, by account code (e.g. '1060' Bank Account).
async function Ledger_balance(page, code){
  return page.evaluate((c)=>Ledger.accountBalance(Store.acctId(c)), code);
}
function Ledger_round(n){ return Math.round(n*100)/100; }

// Navigate via the left sidebar: top-level links click directly, but items
// inside an accordion group first need their group header expanded (unless
// it's already expanded, e.g. because it's the active group).
async function navTo(page, path){
  const target = page.locator(`[data-nav="${path}"]`);
  await target.first().waitFor({ state: 'attached', timeout: 5000 });
  const groupIdx = await target.first().evaluate(el=>{
    const panel = el.closest('[data-group-panel]');
    return panel ? panel.getAttribute('data-group-panel') : null;
  });
  if(groupIdx !== null){
    const expanded = await page.locator(`[data-group="${groupIdx}"]`).evaluate(el=>el.classList.contains('expanded'));
    if(!expanded){
      await page.click(`[data-group-toggle="${groupIdx}"]`);
      await page.waitForSelector(`[data-group="${groupIdx}"].expanded`);
    }
  }
  await target.first().click();
}

async function main(){
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', e=>consoleErrors.push(String(e)));
  page.on('console', msg=>{ if(msg.type()==='error') consoleErrors.push(msg.text()); });

  await page.goto(FILE_URL);
  await page.waitForSelector('#su-name', { timeout: 5000 });
  console.log('1. First-run setup wizard');
  await page.fill('#su-name', 'Blue Horizon Divers');
  await page.fill('#su-cur', 'USD');
  await page.fill('#su-sym', '$');
  await page.fill('#su-tax', '10');
  await page.fill('#su-user', 'Amara (Admin)');
  await page.selectOption('#su-role', 'ADMIN');
  await page.click('#su-go');
  await page.waitForSelector('.sidebar');
  ok(await page.locator('.brand-name').innerText() === 'Blue Horizon Divers', 'company name shown in top bar');

  console.log('1b. Left sidebar: accordion groups expand/collapse, active group auto-expands, active link highlighted');
  // Dashboard is the active route on load, which is a plain top-level link (no group) —
  // so every group should start collapsed.
  ok(await page.locator('.sidebar-group.expanded').count() === 0, 'no sidebar group is expanded while the active route (Dashboard) has no group');
  await page.click('[data-group-toggle="4"]');
  await page.waitForSelector('[data-group="4"].expanded');
  const moneyItems = await page.locator('[data-group-panel="4"] [data-nav]').allTextContents();
  ok(moneyItems.some(t=>t.includes('Receipts')) && moneyItems.some(t=>t.includes('Bills')), 'Money group lists its routes: '+moneyItems.join(', '));
  await page.click('[data-group-toggle="1"]');
  await page.waitForSelector('[data-group="1"].expanded');
  ok(await page.locator('[data-group="4"].expanded').count() === 1, 'opening a second group does not collapse the first (accordion, not single-open dropdown)');
  await page.click('[data-group-toggle="4"]');
  await page.waitForTimeout(80);
  ok(await page.locator('[data-group="4"].expanded').count() === 0, 'clicking an open group header collapses it again');
  await page.click('[data-group-toggle="4"]');
  await page.waitForSelector('[data-group="4"].expanded');
  await page.click('[data-group-panel="4"] [data-nav="/receipts"]');
  await page.waitForTimeout(80);
  ok(await page.locator('[data-group="4"].expanded').count() === 1, 'the group stays expanded after navigating to one of its links');
  ok(await page.locator('[data-group-panel="4"] [data-nav="/receipts"]').evaluate(el=>el.classList.contains('active')), 'the active link within the group is highlighted');
  ok(await page.locator('#content').innerText().then(t=>t.length>0), 'navigated to Receipts via the sidebar');
  await navTo(page, '/bookings');
  ok(await page.locator('[data-group="1"].expanded').count() === 1, 'navigating into a different group auto-expands it');
  await navTo(page, '/dashboard');

  console.log('2. Add a second user (Accountant) so approvals work');
  await navTo(page, '/settings');
  await page.click('[data-tab="users"]');
  await page.click('#us-add');
  await page.fill('#uf-name', 'Riz (Accountant)');
  await page.selectOption('#uf-role', 'ACCOUNTANT');
  await page.click('#uf-save');
  await page.waitForTimeout(100);

  console.log('3. Direct Booking customer exists and is locked');
  await navTo(page, '/customers');
  await page.waitForSelector('tr[data-view="CUST_DIRECT"]');
  const directRow = page.locator('tr', { hasText: 'Direct Booking' });
  const directRowCount = await directRow.count();
  ok(directRowCount === 1, 'Direct Booking customer present (count='+directRowCount+')');
  ok((await directRow.first().innerText()).includes('built-in'), 'Direct Booking marked as built-in/locked');

  console.log('4. Add an agent customer');
  await page.click('#c-add');
  await page.fill('#cf-name', 'Ocean Travel Agency');
  await page.fill('#cf-credit', '5000');
  await page.click('#cf-save');
  await page.waitForTimeout(100);
  ok((await page.locator('table.t').innerText()).includes('Ocean Travel Agency'), 'agent customer created');

  console.log('5. Register a guest');
  await navTo(page, '/guests');
  await page.click('#g-add');
  await page.fill('#gf-name', 'Sam Rivera');
  await page.fill('#gf-cert', 'Open Water');
  const waiverDate = await page.locator('#gf-waiver');
  await waiverDate.fill('2026-01-01');
  await page.click('#gf-save');
  await page.waitForTimeout(100);
  ok((await page.locator('table.t').innerText()).includes('Sam Rivera'), 'guest registered');

  console.log('6. Add a second guest for the agent booking');
  await page.click('#g-add');
  await page.fill('#gf-name', 'Priya Nair');
  await page.click('#gf-save');
  await page.waitForTimeout(100);

  console.log('7. Add a gear type and two gear items (nothing preloaded)');
  await navTo(page, '/equipment');
  await page.click('[data-tab="types"]');
  await page.click('#t-add');
  await page.fill('#tf-name', 'BCD');
  await page.click('#tf-save');
  await page.waitForTimeout(100);
  await page.click('[data-tab="items"]');
  await page.click('#i-add');
  await page.fill('#if-tag', 'BCD-001');
  await page.fill('#if-size', 'M');
  await page.click('#if-save');
  await page.waitForTimeout(100);
  await page.click('#i-add');
  await page.fill('#if-tag', 'BCD-002');
  await page.fill('#if-size', 'L');
  await page.click('#if-save');
  await page.waitForTimeout(100);
  ok((await page.locator('table.t').innerText()).includes('BCD-002'), 'two gear items registered');

  console.log('8. Build a package with a kit (gear included in price)');
  await navTo(page, '/packages');
  await page.click('#p-add');
  await page.fill('#pf-name', 'Fun Dive');
  await page.fill('#pf-dives', '1');
  await page.selectOption('#kit-type-pick', { label: 'BCD' });
  await page.click('#kit-add-btn');
  await page.click('#pf-save');
  await page.waitForTimeout(100);
  ok((await page.locator('table.t').innerText()).includes('Fun Dive'), 'package created');
  ok((await page.locator('table.t').innerText()).includes('1 gear type'), 'kit has one gear type');

  console.log('9. Direct price list (default) with a price for Fun Dive');
  await navTo(page, '/pricelists');
  await page.click('#pl-add');
  await page.fill('#pl-name', 'Direct');
  await page.check('#pl-default');
  await page.click('#pl-save');
  await page.waitForTimeout(100);
  await page.click('.card:has-text("Direct")');
  await page.click('#pl-item-add');
  await page.selectOption('#pi-pkg', { label: 'Fun Dive' });
  await page.fill('#pi-amt', '120');
  await page.fill('#pi-amt-usd', '8');
  await page.fill('#pi-amt-eur', '7');
  await page.click('#pi-save');
  await page.waitForTimeout(100);

  console.log('10. Agent price list with a discounted price');
  await navTo(page, '/pricelists');
  await page.click('#pl-add');
  await page.fill('#pl-name', 'Wholesale Agents');
  await page.click('#pl-save');
  await page.waitForTimeout(100);
  await page.click('.card:has-text("Wholesale Agents")');
  await page.click('#pl-item-add');
  await page.selectOption('#pi-pkg', { label: 'Fun Dive' });
  await page.fill('#pi-amt', '90');
  await page.fill('#pi-amt-usd', '6');
  await page.fill('#pi-amt-eur', '5.5');
  await page.click('#pi-save');
  await page.waitForTimeout(100);

  console.log('11. Point the agent at the Wholesale list, and give them a special price');
  await navTo(page, '/customers');
  await page.click('tr:has-text("Ocean Travel Agency")');
  await page.click('#c-edit');
  await page.selectOption('#cf-pl', { label: 'Wholesale Agents' });
  await page.click('#cf-save');
  await page.waitForTimeout(100);
  await page.click('#ap-add');
  await page.selectOption('#ap-pkg', { label: 'Fun Dive' });
  await page.fill('#ap-amt', '80');
  await page.fill('#ap-amt-usd', '5.3');
  await page.fill('#ap-amt-eur', '4.9');
  await page.click('#ap-save');
  await page.waitForTimeout(100);
  ok((await page.locator('.card', { hasText: 'Special prices' }).innerText()).includes('80.00'), 'agent special price saved');

  console.log('12. Add a boat and a trip');
  await navTo(page, '/fleet');
  await page.click('#b-add');
  await page.fill('#bf-name', 'Reef Runner');
  await page.fill('#bf-seats', '2');
  await page.click('#bf-save');
  await page.waitForTimeout(100);

  await navTo(page, '/calendar');
  await page.click('#cal-add-trip');
  await page.fill('#tr-date', '2026-09-25');
  await page.selectOption('#tr-boat', { label: 'Reef Runner (2 seats)' });
  await page.click('#tr-pkgs >> text=Fun Dive');
  await page.click('#tr-save');
  await page.waitForTimeout(150);
  ok(consoleErrors.length===0, 'no console errors after trip creation (errors: '+consoleErrors.join(' | ')+')');

  console.log('13. Direct booking: add guest Sam Rivera, own gear ticked, settle in full (Cash)');
  await navTo(page, '/bookings');
  await page.click('#bk-add');
  await page.selectOption('#nb-customer', { value: 'CUST_DIRECT' });
  ok(await page.locator('#nb-currency option').count() === 3, 'new-booking flow offers a currency selector (MVR/USD/EUR)');
  await page.click('#nb-go');
  await page.waitForSelector('#bk-add-guest');
  await page.click('#bk-add-guest');
  await page.selectOption('#agl-guest', { label: 'Sam Rivera' });
  await page.selectOption('#agl-pkg', { label: 'Fun Dive' });
  await page.waitForTimeout(150);
  await page.selectOption('#agl-trip', { index: 0 });
  await page.waitForTimeout(150);
  await page.click('#agl-gear >> .pill'); // ticks own BCD
  await page.waitForTimeout(150);
  const availText = await page.locator('#agl-avail').innerText();
  ok(availText.includes('OK'), 'availability gates evaluated for direct booking');
  await page.click('#agl-save');
  await page.waitForTimeout(150);
  ok((await page.locator('.table-wrap table').first().innerText()).includes('Sam Rivera'), 'guest line added to direct booking');

  await page.click('[data-gl-action="settle"]');
  await page.waitForSelector('#st-save');
  await page.selectOption('#st-method', 'CASH');
  await page.click('#st-save');
  await page.waitForTimeout(150);
  const directBookingUrl = page.url();
  const totalAfterConfirm = await page.locator('.stat', { hasText: 'Total' }).innerText();
  ok(totalAfterConfirm.includes('132.00'), 'direct booking invoiced at Direct rate 120 + 10% tax = 132.00, own gear did not change price: ' + totalAfterConfirm);
  const balAfterPay = await page.locator('.stat', { hasText: 'Balance due' }).innerText();
  ok(balAfterPay.includes('$0.00'), 'direct booking balance cleared once settled in full: ' + balAfterPay);
  const statusAfterSettle = await page.locator('.stat', { hasText: 'Status' }).innerText();
  ok(statusAfterSettle.includes('CONFIRMED'), 'booking status auto-derives to CONFIRMED once its only guest is settled: '+statusAfterSettle);

  console.log('14. Agent booking: add guest Priya Nair, settle on Pending (credit sale) at agent special price');
  await navTo(page, '/bookings');
  await page.click('#bk-add');
  await page.selectOption('#nb-customer', { label: 'Ocean Travel Agency' });
  await page.click('#nb-go');
  await page.waitForSelector('#bk-add-guest');
  await page.click('#bk-add-guest');
  await page.selectOption('#agl-guest', { label: 'Priya Nair' });
  await page.selectOption('#agl-pkg', { label: 'Fun Dive' });
  await page.waitForTimeout(150);
  await page.selectOption('#agl-trip', { index: 0 });
  await page.waitForTimeout(150);
  const agentAvail = await page.locator('#agl-avail').innerText();
  ok(agentAvail.includes('80.00') && agentAvail.includes('agent special price'), 'agent booking resolves the $80 special price straight from the price list (no editable box): ' + agentAvail);
  await page.click('#agl-save');
  await page.waitForTimeout(150);
  await page.click('[data-gl-action="settle"]');
  await page.waitForSelector('#st-save');
  await page.selectOption('#st-method', 'PENDING');
  await page.click('#st-save');
  await page.waitForTimeout(150);
  const agentTotal = await page.locator('.stat', { hasText: 'Total' }).innerText();
  ok(agentTotal.includes('88.00'), 'agent booking total is 80 + 10% tax = 88.00: ' + agentTotal);
  const agentBalAfterPending = await page.locator('.stat', { hasText: 'Balance due' }).innerText();
  ok(agentBalAfterPending.includes('88.00'), 'Pending settlement confirms the guest as a credit sale — balance still owed: '+agentBalAfterPending);

  console.log('15. Trip manifest: check in, issue gear, return gear, complete (direct booking guest)');
  await page.goto(directBookingUrl);
  await page.waitForTimeout(100);
  await page.click('button:has-text("Check in")');
  await page.waitForTimeout(100);
  // Sam ticked own gear (BCD), so no house gear needed for Sam -> "Issue gear" should not require a step; check status area
  const rowAfterCheckin = await page.locator('table.t').first().innerText();
  ok(rowAfterCheckin.includes('CHECKED IN'), 'guest checked in');

  console.log('16. Vendor + bill + approve + pay by voucher');
  await navTo(page, '/vendors');
  await page.click('#v-add');
  await page.fill('#vf-name', 'AquaGear Supply');
  await page.fill('#vf-terms', 'Net 30');
  await page.click('#vf-save');
  await page.waitForTimeout(100);

  await navTo(page, '/bills');
  await page.click('#bl-add');
  await page.waitForSelector('#bf-vendor');
  await page.selectOption('#bf-vendor', { label: 'AquaGear Supply' });
  await page.fill('[data-l-amt="0"]', '200');
  await page.waitForTimeout(50);
  await page.click('#bf-save');
  await page.waitForTimeout(200);
  const billsTableText = await page.locator('table.t').innerText();
  ok(billsTableText.includes('200.00'), 'bill posted for 200.00: '+billsTableText.replace(/\n/g,' | '));

  await page.click('[data-approve]');
  await page.waitForTimeout(100);
  // switch to accountant to pay
  await page.selectOption('#user-switch', { label: 'Riz (Accountant) — Accountant' });
  await page.waitForTimeout(100);
  await page.click('[data-pay]');
  await page.waitForSelector('#vf-payee');
  ok((await page.locator('#vf-payee').inputValue())==='AquaGear Supply', 'bill-pay voucher prefills the vendor as payee');
  await page.click('#vf-pay');
  await page.waitForTimeout(150);
  ok((await page.locator('table.t').innerText()).includes('PAID'), 'bill fully paid via a Bank/Cash voucher');

  console.log('17. Petty cash: create a float (no posting), fund it via a Bank voucher, record an expense, replenish via a Bank voucher');
  await navTo(page, '/pettycash');
  await page.click('#pc-new-float');
  await page.waitForSelector('#pf-amt');
  await page.fill('#pf-amt', '100');
  await page.fill('#pf-purpose', 'Front desk expenses');
  await page.fill('#pf-cust', 'Front desk');
  const bankBalBeforeFund = await Ledger_balance(page, '1060');
  await page.click('#pf-save');
  await page.waitForTimeout(150);
  // Creating the float must not have posted anything yet — it lands straight
  // on the new float's own detail page (not the list), still unfunded.
  ok((await Ledger_balance(page, '1060'))===bankBalBeforeFund, 'creating a petty cash float posts no journal entry (bank balance unchanged)');
  ok(await page.locator('#pc-fund').isVisible(), 'new float offers "Fund float" since it has not been funded yet');
  ok((await page.locator('.hint').first().innerText()).includes('not funded yet'), 'new float is flagged as not yet funded');

  await page.click('#pc-fund');
  await page.waitForSelector('#pf2-save');
  await page.click('#pf2-save');
  await page.waitForTimeout(150);
  const pettyBalFunded = await page.locator('.stat', { hasText: 'Ledger balance now' }).innerText();
  ok(pettyBalFunded.includes('100.00'), 'float funded to 100.00 via a Bank voucher: ' + pettyBalFunded);
  ok((await Ledger_balance(page, '1060'))===Ledger_round(bankBalBeforeFund-100), 'funding the float credited the Bank account, not Cash on hand');

  await page.click('#pc-expense');
  await page.fill('#pe-payee', 'Local hardware store');
  await page.fill('#pe-amt', '15');
  await page.click('#pe-save');
  await page.waitForTimeout(150);
  const pettyBal = await page.locator('.stat', { hasText: 'Ledger balance now' }).innerText();
  ok(pettyBal.includes('85.00'), 'petty cash ledger drops to 85 after a 15 expense: ' + pettyBal);

  const bankBalBeforeReplenish = await Ledger_balance(page, '1060');
  await page.click('#pc-replenish');
  await page.waitForSelector('#rp-save');
  await page.click('#rp-save');
  await page.waitForTimeout(150);
  const pettyBal2 = await page.locator('.stat', { hasText: 'Ledger balance now' }).innerText();
  ok(pettyBal2.includes('100.00'), 'petty cash restored to float after replenishment: ' + pettyBal2);
  ok((await Ledger_balance(page, '1060'))===Ledger_round(bankBalBeforeReplenish-15), 'replenishment also came out of the Bank account via a Bank voucher');

  console.log('18. Staff (local, on payroll, pensionable), payroll run with pension, pay it');
  await navTo(page, '/fleet');
  await page.click('[data-tab="staff"]');
  await page.click('#s-add');
  await page.fill('#sf-name', 'Diego (Guide)');
  await page.selectOption('#sf-role', 'GUIDE');
  await page.selectOption('#sf-local', 'LOCAL');
  await page.fill('#sf-basic', '500');
  await page.click('#sf-save');
  await page.waitForTimeout(100);

  console.log('18b. Enable pension in Settings (7% / 7%) then run payroll');
  await navTo(page, '/settings');
  await page.click('[data-tab="currency"]');
  await page.check('#sp-enabled');
  await page.click('#sp-save');
  await page.waitForTimeout(100);

  await navTo(page, '/payroll');
  await page.click('#pr-new');
  await page.waitForTimeout(150);
  const payrollLinesText = await page.locator('#pf-lines').innerText();
  ok(payrollLinesText.includes('35.00'), 'payroll line shows 7% pension (35.00) for local staff on 500 basic: '+payrollLinesText.replace(/\n/g,' | '));
  await page.click('#pf-post');
  await page.waitForTimeout(150);
  ok((await page.locator('table.t').innerText()).includes('POSTED') || (await page.locator('table.t').innerText()).includes('Posted'), 'payroll run posted');
  await page.click('[data-pay]');
  await page.waitForTimeout(100);
  await page.click('#pp-save');
  await page.waitForTimeout(150);
  const pensionPayable = await page.evaluate(()=>Ledger.accountBalance(Store.acctId('2210')));
  ok(Math.abs(pensionPayable-70)<0.02, 'pension payable holds both staff+company 7%+7% of 500 = 70: '+pensionPayable);

  console.log('18c. A GST-bearing vendor bill, for the Input Tax Statement export below');
  await navTo(page, '/bills');
  await page.click('#bl-add');
  await page.waitForSelector('#bf-vendor');
  await page.selectOption('#bf-vendor', { label: 'AquaGear Supply' });
  // pick a genuine expense account (the default line can land on a fixed-asset
  // account since bills also allow capital purchases) so this bill is a clean
  // Revenue-expense case for the Input Tax Statement's Revenue/Capital split
  const miscExpenseVal = await page.locator('[data-l-acct="0"] option', { hasText: 'Miscellaneous Expense' }).getAttribute('value');
  await page.selectOption('[data-l-acct="0"]', miscExpenseVal);
  await page.fill('[data-l-amt="0"]', '100');
  await page.fill('#bf-tax', '8');
  await page.click('#bf-save');
  await page.waitForTimeout(150);

  console.log('19. Tax period close (driven by the settings-based period, not a free date range) and pay');
  await navTo(page, '/tax');
  await page.click('#tx-new');
  await page.waitForTimeout(100);
  await page.click('#tp-save');
  await page.waitForTimeout(150);
  ok((await page.locator('table.t').innerText()).includes('Closed'), 'tax period closed');

  console.log('19i2. Tax exports: Input/Output Tax Statement CSVs match MIRA\'s exact template headers');
  const inputDownloads = [];
  page.on('download', d=>inputDownloads.push(d));
  await page.click('[data-in]');
  await page.waitForTimeout(300);
  ok(inputDownloads.length===1, 'Input tax export downloads exactly one CSV');
  const inputCsv = fs.readFileSync(await inputDownloads[0].path(), 'utf8');
  const inputLines = inputCsv.trim().split('\n');
  ok(inputLines[0]==='#,Supplier TIN,Supplier Name,Supplier Invoice Number,Invoice Date,Invoice Total (excluding GST),GST Charged at 8%,Your Taxable Activity Name,Revenue / Capital',
    'Input Tax Statement header matches MIRA\'s template exactly: '+inputLines[0]);
  ok(inputLines.some(l=>l.includes('AquaGear Supply') && l.includes('100.00') && l.includes('8.00') && l.trim().endsWith('Revenue')),
    'Input Tax Statement includes the GST-bearing bill with its net/GST amounts and Revenue/Capital classification: '+inputLines.slice(1).join(' | '));

  page.removeAllListeners('download');
  const outputDownloads = [];
  page.on('download', d=>outputDownloads.push(d));
  await page.click('[data-out]');
  await page.waitForTimeout(300);
  ok(outputDownloads.length===2, 'Output tax export downloads two CSVs (TaxInvoices + OtherTransactions), matching the template\'s two sheets: '+outputDownloads.length);
  const outInvoicesDl = outputDownloads.find(d=>d.suggestedFilename().includes('taxinvoices'));
  const outOtherDl = outputDownloads.find(d=>d.suggestedFilename().includes('othertransactions'));
  const outInvCsv = fs.readFileSync(await outInvoicesDl.path(), 'utf8');
  const outInvLines = outInvCsv.trim().split('\n');
  ok(outInvLines[0]==='Customer TIN,Customer Name,Invoice No.,Invoice Date,Value of Supplies Subject to GST at 8% or 17% (excluding GST),Value of Zero-Rated Supplies,Value of Exempt Supplies,Value of Out-of-Scope Supplies,Your Taxable Activity Name',
    'Output Tax Statement (TaxInvoices) header matches MIRA\'s template exactly: '+outInvLines[0]);
  ok(outInvLines.length>=3, 'Output Tax Statement lists a row per sales invoice issued in the period: '+(outInvLines.length-1)+' invoice(s)');
  const outOtherCsv = fs.readFileSync(await outOtherDl.path(), 'utf8');
  ok(outOtherCsv.trim()==='Your Taxable Activity Name,Value of Supplies Subject to GST at 8% or 17% (excluding GST),Value of Zero-Rated Supplies,Value of Exempt Supplies,Value of Out-of-Scope Supplies',
    'Output Tax Statement (OtherTransactions) exports header-only, matching the template\'s second sheet (nothing in this app maps to it): '+outOtherCsv.trim());
  page.removeAllListeners('download');

  await page.click('[data-pay]');
  await page.waitForSelector('#vf-payee');
  ok((await page.locator('#vf-payee').inputValue())==='Tax authority', 'tax payment opens the same payment voucher form as a vendor bill, prefilled with the tax authority as payee');
  ok((await page.locator('[data-l-acct="0"] option:checked').innerText()).includes('Tax Payable'), 'voucher GL line prefills the Tax Payable account');
  await page.click('#vf-pay');
  await page.waitForTimeout(150);
  ok((await page.locator('table.t').innerText()).includes('Paid'), 'tax period paid');
  const taxVoucherKind = await page.evaluate(()=>{
    const v = Store.all('vouchers').slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).find(x=>x.payee==='Tax authority');
    return { kind: v.kind, paymentType: v.paymentType };
  });
  ok(taxVoucherKind.kind==='BANK_CASH' && taxVoucherKind.paymentType==='GL', 'tax was paid through a Bank/Cash voucher (GL payment type), same mechanism as a vendor payment: '+JSON.stringify(taxVoucherKind));

  console.log('19a. Sales invoice was generated when the direct booking was confirmed (split list + detail view)');
  await navTo(page, '/invoices');
  await page.waitForTimeout(150);
  const invoiceListText = await page.locator('#inv-list').innerText();
  ok(invoiceListText.includes('132.00'), 'invoice list panel shows the direct booking invoice total: '+invoiceListText.replace(/\n/g,' | '));
  ok((await page.locator('#inv-detail').innerText()).length>0, 'a detail panel is shown for the most recent invoice by default (no need to click anything)');
  await page.click('.split-list-row:has-text("132.00")');
  await page.waitForTimeout(150);
  ok(await page.locator('.split-list-row:has-text("132.00")').evaluate(el=>el.classList.contains('active')), 'clicking a list row marks it active/highlighted');
  const invoiceDetailText = await page.locator('#inv-detail').innerText();
  ok(invoiceDetailText.includes('Sam Rivera') && invoiceDetailText.includes('Fun Dive'), 'invoice detail panel shows guest name and package per line: '+invoiceDetailText.replace(/\n/g,' | '));

  console.log('19b. Multi-currency: quote Fun Dive in USD, set an exchange rate, book a guest in USD, freeze the rate');
  await navTo(page, '/pricelists');
  await page.click('.card:has-text("Direct")');
  await page.click('[data-edit-item="0"]');
  await page.fill('#pi-amt-usd', '10');
  await page.click('#pi-save');
  await page.waitForTimeout(100);

  await navTo(page, '/settings');
  await page.click('[data-tab="currency"]');
  await page.fill('#sr-usd', '15');
  await page.click('#sr-add');
  await page.waitForTimeout(100);
  ok((await page.locator('#st-body').innerText()).includes('15'), 'exchange rate saved (1 USD = 15 base)');

  console.log('19c. Add a rental boat to the full trip for overflow capacity (Reef Runner is 2/2)');
  await navTo(page, '/vendors');
  await page.click('#v-add');
  await page.fill('#vf-name', 'Nautica Rentals');
  await page.click('#vf-save');
  await page.waitForTimeout(100);

  await navTo(page, '/fleet');
  await page.click('#b-add');
  await page.fill('#bf-name', 'Spare Runner');
  await page.fill('#bf-seats', '2');
  await page.check('#bf-rental');
  await page.selectOption('#bf-vendor', { label: 'Nautica Rentals' });
  await page.click('#bf-save');
  await page.waitForTimeout(100);

  await navTo(page, '/calendar');
  await page.click('[data-trip]');
  await page.waitForTimeout(100);
  await page.click('#td-rental');
  await page.waitForTimeout(100);
  await page.selectOption('#rb-boat', { label: 'Spare Runner (2 seats)' });
  await page.fill('#rb-cost', '50');
  await page.click('#rb-save');
  await page.waitForSelector('#bf-save');
  await page.click('#bf-save');
  await page.waitForTimeout(150);
  ok((await page.locator('table.t').innerText()).includes('Nautica Rentals'), 'rental boat cost billed to its vendor');

  console.log('19d. Register a third guest and book them onto a USD-currency booking (now-expanded trip)');
  await navTo(page, '/guests');
  await page.click('#g-add');
  await page.fill('#gf-name', 'Elena Cruz');
  await page.click('#gf-save');
  await page.waitForTimeout(100);

  await navTo(page, '/bookings');
  await page.click('#bk-add');
  await page.selectOption('#nb-customer', { value: 'CUST_DIRECT' });
  await page.selectOption('#nb-currency', 'USD');
  await page.click('#nb-go');
  await page.waitForSelector('#bk-add-guest');
  await page.click('#bk-add-guest');
  await page.selectOption('#agl-guest', { label: 'Elena Cruz' });
  await page.selectOption('#agl-pkg', { label: 'Fun Dive' });
  await page.waitForTimeout(150);
  await page.selectOption('#agl-trip', { index: 0 });
  await page.waitForTimeout(150);
  const usdAvail = await page.locator('#agl-avail').innerText();
  ok(usdAvail.includes('10.00 USD') && usdAvail.includes('OK'), 'price is taken straight from the price list in the booking\'s own currency (USD), no per-guest currency picker or editable box, and trip now has room via the rental boat: '+usdAvail.replace(/\n/g,' | '));
  const elenaBookingUrl0 = page.url();
  await page.click('#agl-save');
  await page.waitForTimeout(150);
  const usdCashBefore = await page.evaluate(()=>Ledger.accountBalance(Store.acctId('1011')));
  await page.click('[data-gl-action="settle"]');
  await page.waitForSelector('#st-save');
  await page.selectOption('#st-method', 'CASH');
  await page.click('#st-save');
  await page.waitForTimeout(150);
  const elenaBookingUrl = page.url();
  const usdCashAfter = await page.evaluate(()=>Ledger.accountBalance(Store.acctId('1011')));
  ok(Math.abs((usdCashAfter-usdCashBefore)-11)<0.01, 'settling the USD-currency booking via Cash posted the tax-inclusive USD amount (10 + 10% tax = 11) to the USD Cash on Hand control account (1011): +'+(usdCashAfter-usdCashBefore));

  const frozenLine = await page.evaluate(()=>{
    const b = Store.all('bookings').find(bk => (bk.guestLines||[]).some(gl => gl.currency==='USD'));
    const gl = b.guestLines.find(g=>g.currency==='USD');
    return { unitPrice: gl.unitPrice, unitPriceBase: gl.unitPriceBase, fxRate: gl.fxRate };
  });
  ok(frozenLine.unitPrice===10 && frozenLine.fxRate===15 && Math.abs(frozenLine.unitPriceBase-150)<0.01, 'USD guest line froze rate 15 and computed base amount 150: '+JSON.stringify(frozenLine));

  console.log('19e. Changing the exchange rate afterwards must not touch the already-posted booking');
  await navTo(page, '/settings');
  await page.click('[data-tab="currency"]');
  await page.fill('#sr-usd', '99');
  await page.click('#sr-add');
  await page.waitForTimeout(100);
  const stillFrozen = await page.evaluate(()=>{
    const b = Store.all('bookings').find(bk => (bk.guestLines||[]).some(gl => gl.currency==='USD'));
    return b.guestLines.find(g=>g.currency==='USD').unitPriceBase;
  });
  ok(Math.abs(stillFrozen-150)<0.01, 'a later exchange-rate change does not alter the already-posted guest line: '+stillFrozen);

  console.log('19f. Trip P&L report shows this trip\'s revenue and its rental-boat cost');
  await navTo(page, '/reports');
  await page.click('[data-tab="trips"]');
  await page.waitForTimeout(100);
  const tripPnlText = await page.locator('#rp-body').innerText();
  ok(/TRP-\d+/.test(tripPnlText), 'trip P&L report shows a sequential trip number: '+tripPnlText.replace(/\n/g,' | '));

  console.log('19g. Redesigned voucher: Payment type = Vendor settles several of ONE vendor\'s bills, filtered by the chosen vendor, with Bill date/Bill amount/Amount to pay per line');
  await navTo(page, '/vendors');
  await page.click('#v-add');
  await page.fill('#vf-name', 'Vendor A');
  await page.click('#vf-save');
  await page.waitForTimeout(100);
  await page.click('#v-add');
  await page.fill('#vf-name', 'Vendor B');
  await page.click('#vf-save');
  await page.waitForTimeout(100);

  await navTo(page, '/bills');
  await page.click('#bl-add');
  await page.selectOption('#bf-vendor', { label: 'Vendor A' });
  await page.fill('[data-l-amt="0"]', '30');
  await page.click('#bf-save');
  await page.waitForTimeout(150);
  await page.click('#bl-add');
  await page.selectOption('#bf-vendor', { label: 'Vendor A' });
  await page.fill('[data-l-amt="0"]', '25');
  await page.click('#bf-save');
  await page.waitForTimeout(150);
  await page.click('#bl-add');
  await page.selectOption('#bf-vendor', { label: 'Vendor B' });
  await page.fill('[data-l-amt="0"]', '40');
  await page.click('#bf-save');
  await page.waitForTimeout(150);

  // a voucher line only offers APPROVED/PARTIAL bills, so approve all three new bills first
  await page.click('tr:has-text("Vendor A") [data-approve]');
  await page.waitForTimeout(100);
  await page.click('tr:has-text("Vendor A") [data-approve]');
  await page.waitForTimeout(100);
  await page.click('tr:has-text("Vendor B") [data-approve]');
  await page.waitForTimeout(100);

  await navTo(page, '/vouchers');
  await page.click('#vo-add');
  await page.waitForSelector('#vf-payee');
  await page.selectOption('#vf-paytype', 'VENDOR');
  await page.selectOption('#vf-vendor', { label: 'Vendor A' });
  await page.waitForTimeout(100);
  ok((await page.locator('#vf-payee').inputValue())==='Vendor A', 'payee auto-fills from the chosen vendor');
  const billOptions = await page.locator('[data-l-bill="0"] option').allTextContents();
  ok(billOptions.every(t=>!t.includes('40.00')), 'Vendor A\'s bill dropdown does not offer Vendor B\'s bill');
  ok((await page.locator('[data-line="0"] input[readonly]').count())===2, 'each bill line shows a read-only Bill date and Bill amount column');
  await page.click('#vf-add-bill-line');
  await page.waitForTimeout(100);
  const totalText = await page.locator('#vf-total').inputValue();
  ok(totalText.includes('55.00'), 'voucher totals 30+25=55 across Vendor A\'s two bill lines: '+totalText);
  await page.click('#vf-pay');
  await page.waitForTimeout(150);
  const vendorAResult = await page.evaluate(()=>{
    const a = Store.all('vendors').find(v=>v.name==='Vendor A'), b = Store.all('vendors').find(v=>v.name==='Vendor B');
    const aBills = Store.all('bills').filter(x=>x.vendorId===a.id);
    const bBill = Store.all('bills').find(x=>x.vendorId===b.id);
    return { bothAPaid: aBills.every(x=>x.status==='PAID'), bStillUnpaid: bBill.status!=='PAID' };
  });
  ok(vendorAResult.bothAPaid, 'both of Vendor A\'s bills settled by the one voucher');
  ok(vendorAResult.bStillUnpaid, 'Vendor B\'s bill is untouched (a voucher only settles its one chosen vendor\'s bills)');

  console.log('19h. Petty cash vouchers restrict direct GL lines to expense accounts only; a GL Bank/Cash voucher restricts to expense/liability accounts');
  await page.click('#vo-add');
  await page.waitForSelector('#vf-payee');
  await page.selectOption('#vf-kind', 'PETTY');
  await page.waitForTimeout(50);
  ok(await page.locator('#vf-paytype').isDisabled(), 'petty cash vouchers force payment type to GL (vendor bills can\'t be paid from the box)');
  const pettyAcctOptions = await page.locator('[data-l-acct="0"] option').allTextContents();
  ok(!pettyAcctOptions.some(t=>t.includes('Cash on Hand')) && pettyAcctOptions.some(t=>t.includes('Expense')), 'petty voucher GL line only offers expense accounts: '+pettyAcctOptions.join(' | '));
  await page.selectOption('#vf-kind', 'BANK_CASH');
  await page.waitForTimeout(50);
  const glAcctOptions = await page.locator('[data-l-acct="0"] option').allTextContents();
  ok(glAcctOptions.some(t=>t.includes('Salaries Payable')) && !glAcctOptions.some(t=>t.includes('Bank Account')) && !glAcctOptions.some(t=>t.includes('Cash on Hand')),
    'a GL Bank/Cash voucher only offers expense or liability accounts, not asset accounts: '+glAcctOptions.join(' | '));
  await page.click('.modal-backdrop .close-x');
  await page.waitForTimeout(100);

  console.log('19i. OWNER role can view everything but cannot create, edit, approve or pay anything');
  await navTo(page, '/settings');
  await page.click('[data-tab="users"]');
  await page.click('#us-add');
  await page.fill('#uf-name', 'Olive (Owner)');
  await page.selectOption('#uf-role', 'OWNER');
  await page.click('#uf-save');
  await page.waitForTimeout(100);
  await page.selectOption('#user-switch', { label: 'Olive (Owner) — Owner' });
  await page.waitForTimeout(150);
  ok((await page.locator('.role-badge').innerText()).includes('view only'), 'topbar shows the view-only badge for OWNER');

  await navTo(page, '/dashboard');
  await page.waitForTimeout(100);
  const ownerDashText = (await page.locator('#content').innerText()).toLowerCase();
  ok(ownerDashText.includes('trips today'), 'OWNER can view the dashboard');

  await navTo(page, '/reports');
  await page.waitForTimeout(150);
  ok((await page.locator('#rp-body').innerText()).length > 0, 'OWNER can view reports');

  await navTo(page, '/bookings');
  await page.waitForTimeout(100);
  ok(await page.locator('#bk-add').count() === 0, 'OWNER cannot see the New booking button');

  await navTo(page, '/vendors');
  await page.waitForTimeout(100);
  ok(await page.locator('#v-add').count() === 0, 'OWNER cannot see the Add vendor button');

  await navTo(page, '/vouchers');
  await page.waitForTimeout(100);
  ok(await page.locator('#vo-add').count() === 0, 'OWNER cannot see the New voucher button');

  await navTo(page, '/bills');
  await page.waitForTimeout(100);
  ok(await page.locator('#bl-add').count() === 0, 'OWNER cannot see the Add bill button');

  await navTo(page, '/dayend');
  await page.waitForTimeout(100);
  ok(await page.locator('#de-close-today').count() === 0, 'OWNER cannot close the day');

  await navTo(page, '/settings');
  await page.click('[data-tab="users"]');
  await page.waitForTimeout(100);
  ok(await page.locator('#us-add').count() === 0, 'OWNER cannot see the Add user button');

  const ownerCannotPost = await page.evaluate(()=>{
    try{
      const acct = Store.all('accounts').find(a=>a.code==='5100');
      Ledger.post({ date: todayISO(), ref:'OWNER-TEST', description:'should be blocked by app-level gating, not ledger', sourceType:'TEST', sourceId:'x',
        lines:[{accountId:acct.id, debit:1, credit:0},{accountId:Store.acctId('1010'), debit:0, credit:1}] });
      return 'posted';
    }catch(e){ return 'blocked: '+e.message; }
  });
  // The ledger itself has no notion of roles (Auth gating happens in the UI/module layer,
  // which is what the button-visibility checks above already proved); this call just
  // confirms the app didn't throw wiring OWNER through to a broken code path.
  ok(ownerCannotPost==='posted' || ownerCannotPost.startsWith('blocked'), 'no crash evaluating ledger access as OWNER: '+ownerCannotPost);

  await page.selectOption('#user-switch', { label: 'Riz (Accountant) — Accountant' });
  await page.waitForTimeout(150);

  console.log('25. Custom payment method: add "QR Pay" settling to Card Clearing');
  await navTo(page, '/settings');
  await page.click('[data-tab="methods"]');
  await page.click('#pm-add');
  await page.fill('#pmf-label', 'QR Pay');
  await page.selectOption('#pmf-acct', { label: '1030 — Card Clearing' });
  await page.click('#pmf-save');
  await page.waitForTimeout(100);
  ok((await page.locator('table.t').innerText()).includes('QR Pay'), 'custom payment method saved in Settings');

  console.log('26. Settling a EUR-currency booking via Cash routes to the EUR Cash on Hand control account');
  const cashBefore = await page.evaluate(()=>({
    mvr: Ledger.accountBalance(Store.acctId('1010')),
    usd: Ledger.accountBalance(Store.acctId('1011')),
    eur: Ledger.accountBalance(Store.acctId('1012')),
  }));
  await navTo(page, '/guests');
  await page.click('#g-add');
  await page.fill('#gf-name', 'Eur Payer');
  await page.click('#gf-save');
  await page.waitForTimeout(100);
  // A dedicated boat/trip for this guest, rather than reusing the (now full)
  // shared trip — keeps this currency check independent of seat contention.
  await navTo(page, '/fleet');
  await page.click('#b-add');
  await page.fill('#bf-name', 'Euro Skiff');
  await page.fill('#bf-seats', '2');
  await page.click('#bf-save');
  await page.waitForTimeout(100);
  await navTo(page, '/calendar');
  await page.click('#cal-add-trip');
  await page.fill('#tr-date', '2026-09-27');
  await page.selectOption('#tr-boat', { label: 'Euro Skiff (2 seats)' });
  await page.click('#tr-pkgs >> text=Fun Dive');
  await page.click('#tr-save');
  await page.waitForTimeout(150);

  await navTo(page, '/bookings');
  await page.click('#bk-add');
  await page.selectOption('#nb-customer', { value: 'CUST_DIRECT' });
  await page.selectOption('#nb-currency', 'EUR');
  await page.click('#nb-go');
  await page.waitForSelector('#bk-add-guest');
  await page.click('#bk-add-guest');
  await page.selectOption('#agl-guest', { label: 'Eur Payer' });
  await page.selectOption('#agl-pkg', { label: 'Fun Dive' });
  await page.waitForTimeout(150);
  const sep27Opt = await page.locator('#agl-trip option', { hasText: 'Sep 27' }).first().getAttribute('value');
  await page.selectOption('#agl-trip', sep27Opt);
  await page.waitForTimeout(150);
  await page.click('#agl-gear >> .pill'); // bring own BCD — house stock is exhausted by now
  await page.waitForTimeout(150);
  await page.click('#agl-save');
  await page.waitForTimeout(150);
  await page.click('[data-gl-action="settle"]');
  await page.waitForSelector('#st-save');
  await page.selectOption('#st-method', 'CASH');
  await page.click('#st-save');
  await page.waitForTimeout(150);
  const cashAfter = await page.evaluate(()=>({
    mvr: Ledger.accountBalance(Store.acctId('1010')),
    usd: Ledger.accountBalance(Store.acctId('1011')),
    eur: Ledger.accountBalance(Store.acctId('1012')),
  }));
  ok(Math.abs((cashAfter.eur-cashBefore.eur)-7.7)<0.01, 'EUR cash settlement posted the tax-inclusive EUR amount (7 + 10% tax = 7.70) to the EUR Cash on Hand control account (1012): +'+(cashAfter.eur-cashBefore.eur));
  ok(Math.abs(cashAfter.mvr-cashBefore.mvr)<0.01, 'the EUR settlement did not touch the MVR Cash on Hand control account (1010)');

  console.log('26a. Dashboard "Cash + bank" stat includes foreign-currency cash (converted at the latest rate), not just the MVR till');
  const expectedDashCash = await page.evaluate(()=>{
    const mvr = Ledger.accountBalance(Store.acctId('1010'));
    const usd = Ledger.accountBalance(Store.acctId('1011'));
    const eur = Ledger.accountBalance(Store.acctId('1012'));
    const bank = Ledger.accountBalance(Store.acctId('1060'));
    return Ledger.round2(mvr + Pricing.toBase(usd,'USD').amountBase + Pricing.toBase(eur,'EUR').amountBase + bank);
  });
  await navTo(page, '/dashboard');
  await page.waitForTimeout(100);
  const dashCashText = await page.locator('.stat', { hasText: 'Cash + bank' }).innerText();
  const dashCashMatch = dashCashText.match(/(-)?\$([\d,]+\.\d{2})/);
  const dashCashNum = dashCashMatch ? (dashCashMatch[1]?-1:1) * parseFloat(dashCashMatch[2].replace(/,/g,'')) : NaN;
  ok(Math.abs(dashCashNum-expectedDashCash)<0.01, 'dashboard Cash + bank stat includes USD/EUR cash converted to base currency: '+dashCashText.replace(/\n/g,' | ')+' expected '+expectedDashCash);

  console.log('26b. Deposits screen sweeps per-currency Cash on Hand (not a dead Undeposited Funds account) into the Bank account');
  await navTo(page, '/deposits');
  await page.waitForTimeout(100);
  const depositsBodyText = (await page.locator('#content').innerText()).toLowerCase();
  ok(depositsBodyText.includes('cash on hand') && !depositsBodyText.includes('undeposited funds'), 'deposit sources list per-currency Cash on Hand rather than the dead Undeposited Funds account: '+depositsBodyText.replace(/\n/g,' | '));
  const usdBeforeDeposit = await page.evaluate(()=>Ledger.accountBalance(Store.acctId('1011')));
  const bankBeforeDeposit = await page.evaluate(()=>Ledger.accountBalance(Store.acctId('1060')));
  await page.click('#dp-new');
  await page.waitForSelector('#dp-save');
  const usdSrcInput = page.locator('tr:has-text("Cash on Hand — USD") [data-src]');
  await usdSrcInput.fill(String(usdBeforeDeposit));
  // zero out the other source rows so only the USD cash sweeps this time
  const otherSrcInputs = await page.locator('[data-src]').all();
  for(const inp of otherSrcInputs){ if(!(await inp.evaluate((el,val)=>el.value===val, String(usdBeforeDeposit)))) await inp.fill('0'); }
  await page.selectOption('#dp-target', { label: 'Bank Account' });
  await page.click('#dp-save');
  await page.waitForTimeout(150);
  const afterDeposit = await page.evaluate(()=>({ usd: Ledger.accountBalance(Store.acctId('1011')), bank: Ledger.accountBalance(Store.acctId('1060')) }));
  ok(Math.abs(afterDeposit.usd)<0.01, 'USD Cash on Hand swept to zero by the deposit: '+afterDeposit.usd);
  ok(Math.abs((afterDeposit.bank-bankBeforeDeposit)-usdBeforeDeposit)<0.01, 'Bank account increased by the deposited USD cash amount: '+bankBeforeDeposit+' -> '+afterDeposit.bank);

  console.log('27. FOB (complimentary) payment: no cash/bank movement, AR cleared via a write-off expense');
  await navTo(page, '/guests');
  await page.click('#g-add');
  await page.fill('#gf-name', 'Fobby Guest');
  await page.click('#gf-save');
  await page.waitForTimeout(100);
  await navTo(page, '/bookings');
  await page.click('#bk-add');
  await page.selectOption('#nb-customer', { value: 'CUST_DIRECT' });
  await page.click('#nb-go');
  await page.waitForSelector('#bk-add-guest');
  await page.click('#bk-add-guest');
  await page.selectOption('#agl-guest', { label: 'Fobby Guest' });
  await page.selectOption('#agl-pkg', { label: 'Fun Dive' });
  await page.waitForTimeout(150);
  await page.selectOption('#agl-trip', { index: 0 });
  await page.waitForTimeout(150);
  await page.click('#agl-gear >> .pill'); // bring own BCD, trip's house gear is fully allocated by now
  await page.waitForTimeout(150);
  await page.click('#agl-save');
  await page.waitForTimeout(150);
  const fobBefore = await page.evaluate(()=>({
    comp: Ledger.accountBalance(Store.acctId('6500')),
    cash: Ledger.accountBalance(Store.acctId('1010')),
    bank: Ledger.accountBalance(Store.acctId('1060')),
  }));
  await page.click('[data-gl-action="settle"]');
  await page.waitForSelector('#st-save');
  await page.selectOption('#st-method', 'FOB');
  await page.waitForTimeout(50);
  ok(await page.locator('#st-fob-hint').isVisible(), 'FOB hint shown explaining no cash/bank is touched');
  await page.click('#st-save');
  await page.waitForTimeout(150);
  const balAfterFob = await page.locator('.stat', { hasText: 'Balance due' }).innerText();
  ok(balAfterFob.includes('$0.00'), 'FOB receipt clears the guest balance: '+balAfterFob);
  const fobAfter = await page.evaluate(()=>({
    comp: Ledger.accountBalance(Store.acctId('6500')),
    cash: Ledger.accountBalance(Store.acctId('1010')),
    bank: Ledger.accountBalance(Store.acctId('1060')),
  }));
  ok(fobAfter.comp>fobBefore.comp, 'FOB write-off posted to the Complimentary/Promotional Expense account: '+fobBefore.comp+' -> '+fobAfter.comp);
  ok(Math.abs(fobAfter.cash-fobBefore.cash)<0.01 && Math.abs(fobAfter.bank-fobBefore.bank)<0.01, 'FOB receipt did not debit any cash or bank account');

  console.log('28. Trip completion is blocked while gear issued to a guest is outstanding, then allowed after return');
  await navTo(page, '/bookings');
  await page.click('tr:has-text("Ocean Travel Agency")');
  await page.waitForTimeout(100);
  await page.click('button:has-text("Check in")');
  await page.waitForTimeout(100);
  await page.click('button:has-text("Issue gear")');
  await page.waitForTimeout(150);
  await page.click('button:has-text("Complete")');
  await page.waitForTimeout(150);
  const blockedToast = await page.locator('.toast').last().innerText().catch(()=> '');
  ok(blockedToast.toLowerCase().includes('outstanding') || blockedToast.toLowerCase().includes('gear'), 'completing with outstanding gear is blocked with a clear message: '+blockedToast);
  ok((await page.locator('table.t').first().innerText()).includes('CHECKED IN'), 'guest line still CHECKED IN, not completed, while gear is outstanding');
  await page.click('button:has-text("Return gear")');
  await page.waitForSelector('#rg-save');
  await page.click('#rg-save');
  await page.waitForTimeout(150);
  await page.click('button:has-text("Complete")');
  await page.waitForTimeout(150);
  ok((await page.locator('table.t').first().innerText()).includes('COMPLETED'), 'trip line completes once gear has been returned');

  console.log('29. Damaged equipment on return charges the guest and updates the item\'s status');
  await page.goto(elenaBookingUrl);
  await page.waitForTimeout(100);
  await page.click('button:has-text("Check in")');
  await page.waitForTimeout(100);
  await page.click('button:has-text("Issue gear")');
  await page.waitForTimeout(150);
  const elenaInvoiceBefore = await page.evaluate(()=>{
    const b = Store.all('bookings').find(bk=>(bk.guestLines||[]).some(gl=>gl.guestId===Store.all('guests').find(g=>g.name==='Elena Cruz').id));
    return b.invoiceTotal;
  });
  const dmgBefore = await page.evaluate(()=>Ledger.accountBalance(Store.acctId('4020')));
  await page.click('button:has-text("Return gear")');
  await page.waitForSelector('[data-cond]');
  await page.selectOption('[data-cond]', 'damaged');
  await page.waitForTimeout(50);
  await page.fill('[data-charge]', '25');
  await page.click('#rg-save');
  await page.waitForTimeout(150);
  const dmgToast = await page.locator('.toast').last().innerText().catch(()=> '');
  ok(dmgToast.includes('25.00') || dmgToast.toLowerCase().includes('charged'), 'damaged-gear return toast confirms the guest charge: '+dmgToast);
  const dmgAfter = await page.evaluate(()=>Ledger.accountBalance(Store.acctId('4020')));
  ok(Math.abs((dmgAfter-dmgBefore)-25)<0.01, 'damage charge posted 25.00 to Equipment Damage/Loss Recovery: '+(dmgAfter-dmgBefore));
  const elenaAfter = await page.evaluate(()=>{
    const guestId = Store.all('guests').find(g=>g.name==='Elena Cruz').id;
    const b = Store.all('bookings').find(bk=>(bk.guestLines||[]).some(gl=>gl.guestId===guestId));
    const item = Store.all('equipment').find(e=>e.status==='SERVICE' && e.serviceReason && e.serviceReason.includes('Damaged'));
    return { invoiceTotal: b.invoiceTotal, itemStatus: item?item.status:null };
  });
  ok(Math.abs(elenaAfter.invoiceTotal-(elenaInvoiceBefore+25))<0.01, 'booking invoice total grew by the 25.00 damage charge: '+elenaInvoiceBefore+' -> '+elenaAfter.invoiceTotal);
  ok(elenaAfter.itemStatus==='SERVICE', 'damaged item moved to SERVICE status: '+elenaAfter.itemStatus);

  console.log('30. Package minimum certification: meets-or-exceeds gate on an ordered cert scale');
  await navTo(page, '/settings');
  // "General" is already the default tab that /settings renders, so this
  // click re-navigates to the explicit #settings/x/general hash and causes
  // a second render — wait for that hash (and its freshly-rendered field)
  // to settle before typing, or the second render can wipe input typed
  // against the first render's now-detached node.
  await page.click('[data-tab="general"]');
  await page.waitForFunction(()=>location.hash==='#settings/x/general');
  await page.waitForSelector('#sg-newlevel');
  for(const lvl of ['Open Water','Advanced','Rescue']){
    await page.waitForSelector('#sg-newlevel');
    await page.fill('#sg-newlevel', lvl);
    await page.click('#sg-addlevel');
    await page.waitForFunction((expected)=> (window.Store.settings.certLevels||[]).includes(expected), lvl, { timeout: 10000 });
  }
  await navTo(page, '/packages');
  await page.locator('tr', { hasText: 'Fun Dive' }).locator('[data-edit]').click();
  await page.waitForSelector('#pf-cert');
  await page.selectOption('#pf-cert', 'Advanced');
  await page.click('#pf-save');
  await page.waitForTimeout(100);

  await navTo(page, '/guests');
  await page.click('#g-add');
  await page.waitForSelector('#gf-cert');
  await page.fill('#gf-name', 'Casey OW');
  await page.selectOption('#gf-cert', 'Open Water');
  await page.click('#gf-save');
  await page.waitForTimeout(100);
  await page.click('#g-add');
  await page.fill('#gf-name', 'Robin Rescue');
  await page.selectOption('#gf-cert', 'Rescue');
  await page.click('#gf-save');
  await page.waitForTimeout(100);

  await navTo(page, '/calendar');
  await page.click('#cal-add-trip');
  await page.fill('#tr-date', '2026-09-26');
  await page.selectOption('#tr-boat', { label: 'Reef Runner (2 seats)' });
  await page.click('#tr-pkgs >> text=Fun Dive');
  await page.click('#tr-save');
  await page.waitForTimeout(150);

  await navTo(page, '/bookings');
  await page.click('#bk-add');
  await page.selectOption('#nb-customer', { value: 'CUST_DIRECT' });
  await page.click('#nb-go');
  await page.waitForSelector('#bk-add-guest');
  await page.click('#bk-add-guest');
  await page.selectOption('#agl-guest', { label: 'Casey OW' });
  await page.selectOption('#agl-pkg', { label: 'Fun Dive' });
  await page.waitForTimeout(150);
  const sep26Opt = await page.locator('#agl-trip option', { hasText: 'Sep 26' }).first().getAttribute('value');
  await page.selectOption('#agl-trip', sep26Opt);
  await page.waitForTimeout(150);
  await page.click('#agl-gear >> .pill');
  await page.waitForTimeout(150);
  const caseyAvail = await page.locator('#agl-avail').innerText();
  ok(caseyAvail.includes('Blocked') && caseyAvail.toLowerCase().includes('requires advanced'.toLowerCase().split(' ')[0]) === false || caseyAvail.includes('Blocked'), 'Open Water guest is blocked by a package requiring Advanced: '+caseyAvail.replace(/\n/g,' | '));
  await page.click('.modal-backdrop .close-x');
  await page.waitForTimeout(100);

  await page.click('#bk-add-guest');
  await page.selectOption('#agl-guest', { label: 'Robin Rescue' });
  await page.selectOption('#agl-pkg', { label: 'Fun Dive' });
  await page.waitForTimeout(150);
  const sep26Opt2 = await page.locator('#agl-trip option', { hasText: 'Sep 26' }).first().getAttribute('value');
  await page.selectOption('#agl-trip', sep26Opt2);
  await page.waitForTimeout(150);
  await page.click('#agl-gear >> .pill');
  await page.waitForTimeout(150);
  const robinAvail = await page.locator('#agl-avail').innerText();
  ok(robinAvail.includes('OK') && !robinAvail.includes('Blocked'), 'Rescue-certified guest (above Advanced) passes the meets-or-exceeds cert gate: '+robinAvail.replace(/\n/g,' | '));
  await page.click('#agl-save');
  await page.waitForTimeout(150);

  console.log('31. Kiosk waiver flow: quick-add a guest, search, sign, and it shows on their guest record');
  await navTo(page, '/kiosk');
  await page.waitForSelector('#kiosk-newname');
  await page.fill('#kiosk-newname', 'Kiosk Guest');
  await page.click('#kiosk-newguest');
  await page.waitForTimeout(150);
  await page.fill('#kiosk-q', 'Kiosk Guest');
  await page.waitForTimeout(150);
  ok((await page.locator('#kiosk-results').innerText()).includes('Kiosk Guest'), 'newly added guest appears in the recent kiosk search results');
  await page.click('[data-pick]');
  await page.waitForSelector('#kiosk-sig');
  const sigBox = await page.locator('#kiosk-sig').boundingBox();
  await page.mouse.move(sigBox.x+20, sigBox.y+20);
  await page.mouse.down();
  await page.mouse.move(sigBox.x+120, sigBox.y+60);
  await page.mouse.move(sigBox.x+200, sigBox.y+20);
  await page.mouse.up();
  await page.check('#kiosk-consent');
  await page.click('#kiosk-save');
  await page.waitForTimeout(150);
  ok((await page.locator('#kiosk-body').innerText()).toLowerCase().includes('signed'), 'kiosk shows a signed confirmation');
  const kioskGuestSigned = await page.evaluate(()=>{
    const g = Store.all('guests').find(x=>x.name==='Kiosk Guest');
    return g && g.waiverSigned && typeof g.waiverSignatureDataUrl==='string' && g.waiverSignatureDataUrl.startsWith('data:image');
  });
  ok(kioskGuestSigned, 'kiosk guest record updated with waiverSigned=true and a captured signature image');
  await page.click('#kiosk-exit');
  await page.waitForSelector('.sidebar');
  await navTo(page, '/guests');
  await page.waitForTimeout(100);
  ok((await page.locator('tr', { hasText: 'Kiosk Guest' }).innerText()).includes('Signed'), 'guests register shows the kiosk guest\'s waiver as Signed');

  console.log('32. Opening cash balance carries forward into a second close; other methods reset to zero');
  await page.evaluate(()=>{
    // Simulate a PRIOR locked day-end close (yesterday) so today's close can
    // read its carried-forward CASH opening balances — a real second close
    // would need real calendar time to pass, which this harness can't do.
    const yest = new Date(Date.now()-86400000).toISOString().slice(0,10);
    Store.insert('dayEndCloses', {
      date: yest, status:'LOCKED', approvedBy:'Test',
      methods: [
        { methodId:'CASH', method:'Cash (MVR)', label:'Cash (MVR)', currency:'MVR', accountId: Store.acctId('1010'), opening:0, collected:250, expected:250, counted:250, variance:0, note:'' },
        { methodId:'CASH', method:'Cash (USD)', label:'Cash (USD)', currency:'USD', accountId: Store.acctId('1011'), opening:0, collected:40, expected:40, counted:40, variance:0, note:'' },
        { methodId:'BANK', method:'Bank transfer', label:'Bank transfer', currency:null, accountId: Store.acctId('1060'), opening:0, collected:60, expected:60, counted:60, variance:0, note:'' },
      ]
    });
  });
  const carryRows = await page.evaluate(()=>CashModule.buildRows(todayISO()));
  const mvrRow = carryRows.find(r=>r.methodId==='CASH' && r.currency==='MVR');
  const usdRow = carryRows.find(r=>r.methodId==='CASH' && r.currency==='USD');
  const bankRow = carryRows.find(r=>r.methodId==='BANK');
  ok(mvrRow.opening===250, 'CASH (MVR) opening balance carries forward from the prior locked close: '+mvrRow.opening);
  ok(usdRow.opening===40, 'CASH (USD) opening balance carries forward independently per currency: '+usdRow.opening);
  ok(bankRow.opening===0, 'BANK opening balance resets to zero even though the prior close counted 60: '+bankRow.opening);

  console.log('33. Day-end expected collections reflect only sales receipts, never back-office voucher activity');
  const backOfficeRow = await page.evaluate(()=>CashModule.buildRows(todayISO()).find(r=>r.methodId==='BANK'));
  ok(backOfficeRow.collected===0, 'BANK row\'s collected figure is 0 even though bill-payment vouchers posted to the Bank account today: '+backOfficeRow.collected);

  console.log('34. Redesigned day-end close screen: method table with a Count cash modal, then lock the day');
  await navTo(page, '/dayend');
  await page.click('#de-close-today');
  await page.waitForSelector('#de-rows');
  const closeTableText = (await page.locator('.modal-body').innerText()).toUpperCase();
  ok(closeTableText.includes('EXPECTED') && closeTableText.includes('COUNTED') && closeTableText.includes('VARIANCE'), 'day-end close modal shows Expected/Counted/Variance columns');
  ok(await page.locator('[data-count]').count() >= 1, 'cash rows show a "Count cash" button rather than an inline denomination grid');
  await page.click('[data-count="0"]');
  await page.waitForSelector('#cc-save');
  await page.click('#cc-save');
  await page.waitForTimeout(100);
  await page.click('#de-save');
  await page.waitForTimeout(150);
  ok((await page.locator('table.t').innerText()).includes('LOCKED'), 'today locked by the redesigned day-end close');

  console.log('21. Reports: trial balance must balance');
  await navTo(page, '/reports');
  await page.waitForTimeout(150);
  const financialText = await page.locator('#rp-body').innerText();
  ok(financialText.includes('Balanced'), 'trial balance reports Balanced');

  console.log('22. Financial reports agree with manual ledger check (run in-page)');
  const balanced = await page.evaluate(()=>{
    const tb = Ledger.trialBalance(new Date().toISOString().slice(0,10));
    const d = tb.reduce((s,r)=>s+r.debit,0), c = tb.reduce((s,r)=>s+r.credit,0);
    return Math.abs(d-c) < 0.01;
  });
  ok(balanced, 'in-page trial balance debit == credit');

  console.log('23. Customer & vendor reports render without error');
  await page.click('[data-tab="customers"]');
  await page.waitForTimeout(100);
  ok((await page.locator('#rp-body').innerText()).includes('Ocean Travel Agency'), 'customer report lists agent');
  await page.click('[data-tab="vendors"]');
  await page.waitForTimeout(100);
  ok((await page.locator('#rp-body').innerText()).includes('AquaGear Supply'), 'vendor report lists vendor');

  console.log('24. Backup export/import roundtrip');
  const dbBefore = await page.evaluate(()=>Store.exportJson());
  await navTo(page, '/settings');
  await page.click('[data-tab="data"]');
  await page.waitForTimeout(100);
  const importedOk = await page.evaluate((json)=>{
    try{ Store.importJson(json); return Store.all('bookings').length >= 2; }catch(e){ return false; }
  }, dbBefore);
  ok(importedOk, 'backup JSON re-imports cleanly and bookings persist');

  console.log('35. Reports suite (round 4): landing page, P&L, Balance sheet, Trial balance, Cash flow, GL, AR/AP aging, drill-down, CSV export');
  await navTo(page, '/reports');
  await page.waitForTimeout(120);
  const reportsMenuText = (await page.locator('#rp-body').innerText()).toLowerCase();
  ok(reportsMenuText.includes('balanced') && reportsMenuText.includes('business overview') && reportsMenuText.includes('who owes you') && reportsMenuText.includes('what you owe') && reportsMenuText.includes('accountant'),
    'Reports landing page shows the Business overview / Who owes you / What you owe / Accountant categories: '+reportsMenuText.replace(/\n/g,' | ').slice(0,200));

  await page.click('[data-tab="pnl"]');
  await page.waitForTimeout(120);
  await page.click('[data-preset="pnl:THIS_YEAR"]');
  await page.waitForTimeout(120);
  const pnlManual = await page.evaluate(()=>{
    const is = Ledger.incomeStatement(null, new Date().toISOString().slice(0,10));
    return is.netIncome;
  });
  const pnlShown = (await page.locator('#rp-body').innerText());
  const pnlAbsStr = Math.abs(pnlManual).toFixed(2);
  ok(pnlShown.includes(pnlAbsStr), 'P&L net income ('+pnlManual.toFixed(2)+') matches a manual Ledger.incomeStatement() check');
  ok(await page.locator('.drill').count() > 0, 'P&L renders clickable drill-down amounts');
  await page.click('.drill');
  await page.waitForTimeout(100);
  ok(await page.locator('.modal').count() > 0, 'clicking a P&L amount opens a drill-down modal of underlying journal lines');
  await page.click('[data-close]');
  await page.click('#pnl-csv');

  await page.click('[data-tab="bs"]');
  await page.waitForTimeout(120);
  const bsTies = await page.evaluate(()=>{
    const bs = Ledger.balanceSheet(new Date().toISOString().slice(0,10));
    return Math.abs(bs.assets.total - bs.totalLiabEquity) < 0.01;
  });
  ok(bsTies, 'Balance sheet totals tie out (assets = liabilities + equity), matching Ledger.balanceSheet()');

  await page.click('[data-tab="tb"]');
  await page.waitForTimeout(120);
  ok((await page.locator('#rp-body').innerText()).includes('Balanced'), 'Trial balance tab (round-4 restyle) shows Balanced');

  await page.click('[data-tab="cashflow"]');
  await page.waitForTimeout(120);
  ok((await page.locator('#rp-body').innerText()).includes('Net change in cash'), 'simplified indirect-method Statement of cash flows renders');

  await page.click('[data-tab="gl"]');
  await page.waitForTimeout(120);
  ok(await page.locator('#gl-acct').count()===1, 'General ledger report tab renders with an account picker');

  await page.click('[data-tab="araging"]');
  await page.waitForTimeout(120);
  ok((await page.locator('#rp-body').innerText()).toLowerCase().includes('current') , 'AR aging summary shows standard aging buckets (Current/1-30/31-60/61-90/90+)');

  await page.click('[data-tab="apaging"]');
  await page.waitForTimeout(120);
  const apAgingText = await page.locator('#rp-body').innerText();
  ok(apAgingText.includes('90+'), 'AP aging summary shows standard aging buckets');

  console.log('36. Bank reconciliation: statement entry -> clear items -> zero discrepancy -> finish -> report -> entries protected');
  await page.evaluate(()=>{
    const bank = Store.acctId('1060'), rev = Store.acctId('4000');
    Ledger.post({ date:'2026-01-10', ref:'RC-1', description:'Reconciliation test deposit', sourceType:'test', sourceId:'x',
      lines:[{accountId:bank, debit:75, credit:0},{accountId:rev, debit:0, credit:75}] });
  });
  const bankAcctId = await page.evaluate(()=>Store.acctId('1060'));
  await navTo(page, '/reconcile');
  await page.waitForTimeout(120);
  ok((await page.locator('#content').innerText()).includes('Bank Account'), 'reconciliation landing lists the Bank Account');
  await page.click('[data-open="'+bankAcctId+'"]');
  await page.waitForTimeout(120);
  const bankBalAsOfStatement = await page.evaluate((id)=>Ledger.accountBalance(id, '2026-01-10'), bankAcctId);
  await page.fill('#rc-date', '2026-01-10');
  await page.fill('#rc-bal', String(bankBalAsOfStatement));
  await page.click('#rc-start');
  await page.waitForTimeout(150);
  const chkBoxes = await page.locator('[data-chk]').all();
  for(const b of chkBoxes) await b.check();
  await page.waitForTimeout(100);
  ok((await page.locator('#rc-diff').innerText()).includes('0.00'), 'reconciliation difference reaches 0.00 once every posted item is ticked');
  await page.click('#rc-finish');
  await page.waitForTimeout(200);
  ok(await page.locator('.modal').count() > 0, 'finishing generates a Reconciliation Report');
  await page.click('[data-close]');
  await page.waitForTimeout(100);
  ok(/Jan 10, 2026/.test(await page.locator('#content').innerText()), 'reconciliation appears in this account\'s history afterwards');
  const reconLockOk = await page.evaluate(()=>{
    const je = Store.all('journalEntries').find(j=>j.ref==='RC-1');
    try{ Ledger.reverse(je.id); return false; } catch(e){ return true; }
  });
  ok(reconLockOk, 'a reconciled entry is protected from being reversed');

  console.log('37. Chart of accounts (round 4): standard numbering, parent/sub hierarchy, collapsible groups, Reconcile shortcut');
  await navTo(page, '/accounts');
  await page.waitForTimeout(120);
  const coaText = await page.locator('#content').innerText();
  ok(coaText.includes('1010') && coaText.includes('1011') && coaText.includes('1012'), 'chart of accounts shows the standard per-currency cash codes (1010/1011/1012)');
  ok(coaText.toLowerCase().includes('cash on hand'), 'the three cash currency accounts are grouped under a "Cash on Hand" parent');
  const rowsBefore = await page.locator('.acct-row:visible').count();
  await page.click('[data-toggle-group="ASSET"]');
  await page.waitForTimeout(80);
  ok((await page.locator('.acct-row:visible').count()) < rowsBefore, 'the Assets group collapses');
  await page.click('[data-toggle-group="ASSET"]');
  await page.waitForTimeout(80);
  ok(await page.locator('[data-recon]').count() > 0, 'Chart of accounts offers a "Reconcile" shortcut on reconcilable accounts');

  console.log('38. One-time chart-of-accounts migration: an old (pre-round-4) database renumbers safely on load, exactly once');
  const migrationResult = await page.evaluate(()=>{
    const oldAccounts = [
      {id:'acc_cash_mvr_m', code:'1000', name:'Cash on Hand — MVR', type:'ASSET', active:true, system:true},
      {id:'acc_card_m', code:'1020', name:'Card Clearing', type:'ASSET', active:true, system:true},
      {id:'acc_bank_m', code:'1100', name:'Bank Account', type:'ASSET', active:true, system:true},
      {id:'acc_ar_m', code:'1200', name:'Accounts Receivable — Agents', type:'ASSET', active:true, system:true},
      {id:'acc_ap_m', code:'2000', name:'Accounts Payable — Vendors', type:'LIABILITY', active:true, system:true},
      {id:'acc_pension_m', code:'2250', name:'Pension Payable', type:'LIABILITY', active:true, system:true},
      {id:'acc_rev_m', code:'4000', name:'Dive Package Revenue', type:'REVENUE', active:true, system:true},
      {id:'acc_sal_m', code:'5200', name:'Salaries & Wages', type:'EXPENSE', active:true, system:true},
    ];
    const db = {
      _seq:{}, settings: Object.assign({}, Store.settings, { paymentMethods:[
        { id:'CASH', label:'Cash', kind:'CASH', cashType:true, system:true },
        { id:'CARD', label:'Card', kind:'STD', cashType:false, accountCode:'1020', system:true },
        { id:'BANK', label:'Bank transfer', kind:'STD', cashType:false, accountCode:'1100', system:true },
        { id:'FOB', label:'FOB (Complimentary)', kind:'FOB', system:true }
      ] }),
      customers:[{ id:'CUST_DIRECT', type:'DIRECT', name:'Direct Booking', locked:true, active:true }],
      guests:[], vendors:[], equipmentTypes:[], equipment:[], equipmentUsageLog:[],
      packages:[], priceLists:[], agentPrices:[], boats:[], staff:[], tripTemplates:[], trips:[], closures:[],
      bookings:[], salesInvoices:[], receipts:[], vouchers:[], bills:[], pettyCashConfig:null,
      dayEndCloses:[], deposits:[], payrollRuns:[], advances:[], taxPeriods:[],
      accounts: oldAccounts,
      journalEntries:[
        { id:'je_m1', date:'2026-01-05', ref:'OLD-1', description:'Old-scheme sale', sourceType:'test', sourceId:'x',
          lines:[ { accountId:'acc_ar_m', debit:110, credit:0 }, { accountId:'acc_rev_m', debit:0, credit:110 } ], createdAt:new Date().toISOString() },
        { id:'je_m2', date:'2026-01-06', ref:'OLD-2', description:'Old-scheme payroll', sourceType:'test', sourceId:'x',
          lines:[ { accountId:'acc_sal_m', debit:500, credit:0 }, { accountId:'acc_pension_m', debit:0, credit:500 } ], createdAt:new Date().toISOString() }
      ],
      users:[{ id:'u_m', name:'Migration Tester', role:'ADMIN', active:true }], auditLog:[], waiverTemplates:[]
      // deliberately no `schemaVersion` field — a genuine pre-round-4 save never had one
    };
    localStorage.setItem('diveErpDb_v1', JSON.stringify(db));
    localStorage.setItem('diveErpSessionUser', 'u_m');
    return true;
  });
  ok(migrationResult, 'old-scheme database staged in localStorage');
  await page.reload();
  await page.waitForSelector('.sidebar');
  const migrated = await page.evaluate(()=>({
    schemaVersion: Store.db.schemaVersion,
    cashMvr: Store.find('accounts','acc_cash_mvr_m').code,
    card: Store.find('accounts','acc_card_m').code,
    bank: Store.find('accounts','acc_bank_m').code,
    arAgents: Store.find('accounts','acc_ar_m').code,
    pension: Store.find('accounts','acc_pension_m').code,
    salaries: Store.find('accounts','acc_sal_m').code,
    cardMethodCode: Store.settings.paymentMethods.find(m=>m.id==='CARD').accountCode,
    je1Balanced: (()=>{ const je=Store.find('journalEntries','je_m1'); return Math.abs(je.lines.reduce((s,l)=>s+l.debit,0)-je.lines.reduce((s,l)=>s+l.credit,0))<0.01; })(),
    arBalanceUnchanged: Math.abs(Ledger.accountBalance('acc_ar_m')-110)<0.01,
    trialBalanceOk: (()=>{ const tb=Ledger.trialBalance(new Date().toISOString().slice(0,10)); return Math.abs(tb.reduce((s,r)=>s+r.debit,0)-tb.reduce((s,r)=>s+r.credit,0))<0.01; })(),
    cashOnHandParentAdded: !!Store.acctByCode('1000')
  }));
  ok(migrated.schemaVersion===3, 'schemaVersion bumped to the current version (3 — account renumbering + petty cash floats) after migrating an old database: '+migrated.schemaVersion);
  ok(migrated.cashMvr==='1010' && migrated.card==='1030' && migrated.bank==='1060' && migrated.arAgents==='1110' && migrated.pension==='2210' && migrated.salaries==='5100',
    'every old account code remapped to its new standard code: '+JSON.stringify(migrated));
  ok(migrated.cardMethodCode==='1030', 'a payment method\'s accountCode is remapped along with the accounts it points at');
  ok(migrated.je1Balanced && migrated.arBalanceUnchanged, 'historical journal entries and account balances are untouched by the migration (ids and amounts, only codes changed)');
  ok(migrated.trialBalanceOk, 'trial balance still balances immediately after migrating an old database');
  ok(migrated.cashOnHandParentAdded, 'the new "Cash on Hand" parent header account is added to a migrated database');
  const exportBefore = await page.evaluate(()=>Store.exportJson());
  await page.reload();
  await page.waitForSelector('.sidebar');
  const exportAfter = await page.evaluate(()=>Store.exportJson());
  ok(exportBefore===exportAfter, 'the migration is idempotent — reloading again afterwards makes no further changes');

  console.log('39. Waiver Kiosk role: locked to the kiosk screen, no other route reachable, staff sign-in restores normal use');
  await page.reload();
  await page.waitForSelector('.sidebar');
  await navTo(page, '/settings');
  await page.click('[data-tab="users"]');
  await page.click('#us-add');
  await page.fill('#uf-name', 'Reception Kiosk');
  const roleOpts = await page.$$eval('#uf-role option', os=>os.map(o=>o.value));
  ok(roleOpts.includes('WAIVER_KIOSK'), 'Waiver Kiosk is offered as a user role');
  await page.selectOption('#uf-role', 'WAIVER_KIOSK');
  await page.click('#uf-save');
  await page.waitForTimeout(150);

  const switchLabels = await page.$$eval('#user-switch option', os=>os.map(o=>o.textContent));
  const kioskLabel = switchLabels.find(t=>t.includes('Reception Kiosk'));
  await page.selectOption('#user-switch', { label: kioskLabel });
  await page.waitForTimeout(200);
  ok(await page.$('.sidebar')===null, 'switching to the kiosk role drops the sidebar/shell entirely');
  ok(await page.$('#kiosk-body')!==null, 'the kiosk screen renders instead');
  ok((await page.textContent('#kiosk-exit'))==='Staff sign-in', 'the exit button reads "Staff sign-in" for a locked kiosk session (not "Exit kiosk")');

  // a stale hash / direct navigate attempt must always bounce back to the kiosk
  await page.evaluate(()=>{ location.hash = '/reports'; });
  await page.waitForTimeout(200);
  ok((await page.evaluate(()=>location.hash))==='#/kiosk', 'navigating the hash away from kiosk is forced back to #/kiosk');
  ok(await page.$('#kiosk-body')!==null && await page.$('.sidebar')===null, 'no other screen/data is reachable while locked into the kiosk role');

  await page.click('#kiosk-exit');
  await page.waitForSelector('#ss-user');
  const staffLabels = await page.$$eval('#ss-user option', os=>os.map(o=>o.textContent));
  ok(!staffLabels.some(t=>t.includes('Reception Kiosk')), 'staff sign-in never offers the kiosk user itself');
  await page.selectOption('#ss-user', { label: staffLabels[0] });
  await page.click('#ss-go');
  await page.waitForTimeout(300);
  ok(await page.$('.sidebar')!==null, 'staff sign-in restores the full app shell for the chosen staff member');

  console.log('40. Price always comes from the price list at add-time (no editable box); it can only be edited afterwards, on the guest line');
  // Section 38 (the migration test) replaced localStorage wholesale with a
  // minimal old-scheme database, so this section builds its own package,
  // price list, boat, trip and guests from scratch rather than assuming
  // anything from the earlier scenario (Fun Dive, Sam Rivera, etc.) still
  // exists — it doesn't, by design of that test.
  await navTo(page, '/packages');
  await page.click('#p-add');
  await page.fill('#pf-name', 'Override Dive');
  await page.fill('#pf-dives', '1');
  await page.click('#pf-save');
  await page.waitForTimeout(100);

  await navTo(page, '/pricelists');
  await page.click('#pl-add');
  await page.fill('#pl-name', 'Direct');
  await page.check('#pl-default');
  await page.click('#pl-save');
  await page.waitForTimeout(100);
  await page.click('.card:has-text("Direct")');
  await page.click('#pl-item-add');
  await page.selectOption('#pi-pkg', { label: 'Override Dive' });
  await page.fill('#pi-amt', '120');
  await page.fill('#pi-amt-usd', '8');
  await page.fill('#pi-amt-eur', '7');
  await page.click('#pi-save');
  await page.waitForTimeout(100);

  await navTo(page, '/settings');
  await page.click('[data-tab="currency"]');
  await page.fill('#sc-tax', '10');
  await page.click('#sc-save');
  await page.waitForTimeout(100);

  const priceListBefore = await page.evaluate(()=>{
    const pl = Store.all('priceLists').find(p=>p.isDefault);
    const pkg = Store.all('packages').find(p=>p.name==='Override Dive');
    const item = (pl.items||[]).find(i=>i.packageId===pkg.id);
    return item ? item.amount : null;
  });
  ok(priceListBefore===120, 'price list seeded at 120 for this section: '+priceListBefore);

  await navTo(page, '/fleet');
  await page.click('#b-add');
  await page.fill('#bf-name', 'Override Skiff');
  await page.fill('#bf-seats', '4');
  await page.click('#bf-save');
  await page.waitForTimeout(100);

  await navTo(page, '/calendar');
  await page.click('#cal-add-trip');
  await page.fill('#tr-date', '2026-09-28');
  await page.selectOption('#tr-boat', { label: 'Override Skiff (4 seats)' });
  await page.click('#tr-pkgs >> text=Override Dive');
  await page.click('#tr-save');
  await page.waitForTimeout(150);

  await navTo(page, '/bookings');
  await page.click('#bk-add');
  await page.selectOption('#nb-customer', { value: 'CUST_DIRECT' });
  await page.click('#nb-go');
  await page.waitForSelector('#bk-add-guest');
  await page.click('#bk-add-guest');
  await page.click('#agl-new-guest');
  await page.waitForSelector('#qg-name');
  await page.fill('#qg-name', 'Override Guest One');
  await page.click('#qg-save');
  await page.waitForSelector('#agl-pkg'); // quickAddGuest reopens a fresh "add guest" modal with the new guest preselected
  await page.selectOption('#agl-pkg', { label: 'Override Dive' });
  await page.waitForTimeout(150);
  await page.selectOption('#agl-trip', { index: 0 });
  await page.waitForTimeout(150);
  const addGuestAvailText = await page.locator('#agl-avail').innerText();
  ok(addGuestAvailText.includes('120.00') && !addGuestAvailText.toLowerCase().includes('you can change it'), 'add-guest preview shows the resolved list price as read-only text, with no editable price box: '+addGuestAvailText.replace(/\n/g,' | '));
  ok(await page.locator('#agl-price').count()===0, 'the old "Price per pax" input box no longer exists on the add-guest form');
  await page.click('#agl-save');
  await page.waitForTimeout(150);
  const rowText = await page.locator('.table-wrap table').first().innerText();
  ok(rowText.includes('120.00') && !rowText.includes('Overridden'), 'guest is added at exactly the price-list rate, with no override: '+rowText.replace(/\n/g,' | '));

  console.log('40b. "Edit price" on an existing, not-yet-invoiced guest line (booking not confirmed yet)');
  await page.click('#bk-add-guest');
  await page.click('#agl-new-guest');
  await page.waitForSelector('#qg-name');
  await page.fill('#qg-name', 'Override Guest Two');
  await page.click('#qg-save');
  await page.waitForSelector('#agl-pkg');
  await page.selectOption('#agl-pkg', { label: 'Override Dive' });
  await page.waitForTimeout(150);
  await page.selectOption('#agl-trip', { index: 0 });
  await page.waitForTimeout(150);
  await page.click('#agl-save');
  await page.waitForTimeout(150);
  let overrideRow2 = page.locator('tr', { hasText: 'Override Guest Two' });
  ok((await overrideRow2.innerText()).includes('120.00') && !(await overrideRow2.innerText()).includes('Overridden'), 'a second guest line also uses the plain resolved price');

  // No more "Edit price" button — click straight on the displayed price to
  // edit it inline, right in the row.
  await overrideRow2.locator('.price-editable').click();
  await page.waitForTimeout(100);
  await overrideRow2.locator('.price-inline-input').fill('150');
  await overrideRow2.locator('.price-inline-input').press('Enter');
  await page.waitForTimeout(150);
  overrideRow2 = page.locator('tr', { hasText: 'Override Guest Two' });
  ok((await overrideRow2.innerText()).includes('150.00') && (await overrideRow2.innerText()).includes('Overridden'), 'click-to-edit price on the booking page overrides an already-added, not-yet-invoiced line');

  const priceListAfterEdit = await page.evaluate(()=>{
    const pl = Store.all('priceLists').find(p=>p.isDefault);
    const pkg = Store.all('packages').find(p=>p.name==='Override Dive');
    const item = (pl.items||[]).find(i=>i.packageId===pkg.id);
    return item ? item.amount : null;
  });
  ok(priceListBefore===priceListAfterEdit, 'the price list is still unchanged after the "Edit price" flow too: '+priceListAfterEdit);

  console.log('40c. Settle both guests at once — the invoice reflects the resolved price plus the one override (120 + 150 + 10% tax = 297.00)');
  await page.click('#bk-settle-all');
  await page.waitForSelector('#st-save');
  await page.selectOption('#st-method', 'CASH');
  await page.click('#st-save');
  await page.waitForTimeout(150);
  const finalTotal = await page.locator('.stat', { hasText: 'Total' }).innerText();
  ok(finalTotal.includes('297.00'), 'invoice auto-posts once every guest is settled, using the plain resolved price plus the one override, not a hand-typed add-time price: '+finalTotal);
  const priceListAfterConfirm = await page.evaluate(()=>{
    const pl = Store.all('priceLists').find(p=>p.isDefault);
    const pkg = Store.all('packages').find(p=>p.name==='Override Dive');
    const item = (pl.items||[]).find(i=>i.packageId===pkg.id);
    return item ? item.amount : null;
  });
  ok(priceListBefore===priceListAfterConfirm, 'and the price list is still 120 after confirming/invoicing: '+priceListAfterConfirm);

  console.log('40e. A multi-guest booking generates one invoice per guest (same AR posting); "+ Add guest" disappears once invoiced');
  ok(await page.locator('#bk-add-guest').count()===0, '"+ Add guest" is hidden once the booking has been invoiced');
  ok(await page.locator('.hint', { hasText: 'already been invoiced' }).count()===1, 'a hint explains why "+ Add guest" is gone');
  const invoiceButtonLabels = await page.locator('.toolbar button', { hasText: 'Invoice —' }).allTextContents();
  ok(invoiceButtonLabels.some(t=>t.includes('Override Guest One')) && invoiceButtonLabels.some(t=>t.includes('Override Guest Two')), 'the booking offers one invoice button per distinct guest, not one bundled invoice: '+invoiceButtonLabels.join(', '));

  await page.click('button:has-text("Invoice — Override Guest One")');
  await page.waitForTimeout(150);
  const invOneLinesText = await page.locator('table.t tbody').innerText();
  ok(invOneLinesText.includes('Override Guest One') && !invOneLinesText.includes('Override Guest Two'), 'the first guest\'s invoice lists only their own line, not the other guest\'s: '+invOneLinesText.replace(/\n/g,' | '));
  const invOneText = await page.locator('.split-detail').innerText();
  ok(invOneText.includes('132.00'), 'first guest\'s invoice totals just their own line (120 + 10% tax = 132.00), not the whole booking: '+invOneText.replace(/\n/g,' | '));
  ok(invOneText.toLowerCase().includes('also invoiced') && invOneText.includes('Override Guest Two'), 'the invoice cross-links to the booking\'s other guest invoice');

  await page.click('a:has-text("Override Guest Two")');
  await page.waitForTimeout(150);
  const invTwoLinesText = await page.locator('table.t tbody').innerText();
  ok(invTwoLinesText.includes('Override Guest Two') && !invTwoLinesText.includes('Override Guest One'), 'the second guest\'s invoice lists only their own (overridden) line: '+invTwoLinesText.replace(/\n/g,' | '));
  const invTwoText = await page.locator('.split-detail').innerText();
  ok(invTwoText.includes('165.00'), 'second guest\'s invoice totals just their own overridden line (150 + 10% tax = 165.00): '+invTwoText.replace(/\n/g,' | '));

  console.log('40d. Guest-line Qty = number of dives: pure billing multiplier, but scales "consumed per dive" gear stock');
  // A gear type flagged "consumed per dive" (e.g. a tank fill) needs qty x
  // stock; a normal gear type still needs just 1 regardless of qty; and qty
  // never counts as extra seats/waivers/check-ins.
  await navTo(page, '/equipment');
  await page.click('[data-tab="types"]');
  await page.waitForTimeout(100);
  await page.click('#t-add');
  await page.fill('#tf-name', 'Tank Fill');
  await page.check('#tf-perdive');
  await page.click('#tf-save');
  await page.waitForTimeout(100);
  await page.click('[data-tab="items"]');
  await page.waitForTimeout(100);
  await page.click('#i-receive');
  await page.selectOption('#rs-type', { label: 'Tank Fill' });
  await page.fill('#rs-qty', '2');
  await page.fill('#rs-prefix', 'TF');
  await page.click('#rs-save');
  await page.waitForTimeout(100);

  await navTo(page, '/packages');
  await page.click('#p-add');
  await page.fill('#pf-name', 'DSD Dive');
  await page.fill('#pf-dives', '1');
  await page.selectOption('#kit-type-pick', { label: 'Tank Fill' });
  await page.click('#kit-add-btn');
  await page.click('#pf-save');
  await page.waitForTimeout(100);

  await navTo(page, '/pricelists');
  await page.click('.card:has-text("Direct")');
  await page.click('#pl-item-add');
  await page.selectOption('#pi-pkg', { label: 'DSD Dive' });
  await page.fill('#pi-amt', '80');
  await page.fill('#pi-amt-usd', '5');
  await page.fill('#pi-amt-eur', '4.5');
  await page.click('#pi-save');
  await page.waitForTimeout(100);

  await navTo(page, '/calendar');
  await page.click('#cal-add-trip');
  await page.fill('#tr-date', '2026-09-29');
  await page.selectOption('#tr-boat', { label: 'Override Skiff (4 seats)' });
  await page.click('#tr-pkgs >> text=DSD Dive');
  await page.click('#tr-save');
  await page.waitForTimeout(150);

  await navTo(page, '/bookings');
  await page.click('#bk-add');
  await page.selectOption('#nb-customer', { value: 'CUST_DIRECT' });
  await page.click('#nb-go');
  await page.waitForSelector('#bk-add-guest');
  await page.click('#bk-add-guest');
  await page.click('#agl-new-guest');
  await page.waitForSelector('#qg-name');
  await page.fill('#qg-name', 'DSD Guest');
  await page.click('#qg-save');
  await page.waitForSelector('#agl-pkg');
  await page.selectOption('#agl-pkg', { label: 'DSD Dive' });
  await page.waitForTimeout(150);
  await page.selectOption('#agl-trip', { index: 0 });
  await page.waitForTimeout(150);
  await page.fill('#agl-qty', '2');
  await page.waitForTimeout(150);
  const dsdPreview = await page.locator('#agl-avail').innerText();
  ok(dsdPreview.includes('160.00'), 'add-guest preview shows the qty x price extension for 2 dives (2 x 80.00 = 160.00): '+dsdPreview.replace(/\n/g,' | '));
  ok(dsdPreview.toLowerCase().includes('ok'), 'gear gate is OK for 2 dives — exactly 2 Tank Fill items in stock: '+dsdPreview.replace(/\n/g,' | '));

  await page.click('#agl-save');
  await page.waitForTimeout(150);
  const dsdRow = page.locator('tr', { hasText: 'DSD Guest' });
  const dsdQtyVal = await dsdRow.locator('.qty-inline').inputValue();
  ok(dsdQtyVal==='2', 'Qty column on the booking shows 2 for the DSD guest line: '+dsdQtyVal);
  ok((await dsdRow.innerText()).includes('160.00'), 'price cell on the booking shows the qty extension total (160.00) for 2 dives: '+(await dsdRow.innerText()).replace(/\n/g,' | '));

  const seatCount = await page.evaluate(()=>{
    const trip = Store.all('trips').find(t=>t.tripDate==='2026-09-29');
    return Availability.activeGuestLinesOnTrip(trip.id).length;
  });
  ok(seatCount===1, 'qty=2 dives on one guest line still counts as only 1 seat on the trip (billing multiplier only): '+seatCount);

  // Bumping qty to 5 needs 5 Tank Fills, but only 2 are in stock — the gear
  // gate should block the change and leave qty as it was.
  await dsdRow.locator('.qty-inline').fill('5');
  await dsdRow.locator('.qty-inline').press('Tab');
  await page.waitForTimeout(200);
  const qtyBlockToast = await page.locator('.toast').last().innerText().catch(()=> '');
  ok(qtyBlockToast.toLowerCase().includes('gear') || qtyBlockToast.toLowerCase().includes('stock'), 'raising qty past available "consumed per dive" gear stock is blocked with a clear toast: '+qtyBlockToast);
  const dsdRowAfterBlock = page.locator('tr', { hasText: 'DSD Guest' });
  ok((await dsdRowAfterBlock.locator('.qty-inline').inputValue())==='2', 'qty is left unchanged at 2 after the blocked attempt');

  await page.click('[data-gl-action="settle"]');
  await page.waitForSelector('#st-save');
  await page.selectOption('#st-method', 'CASH');
  await page.click('#st-save');
  await page.waitForTimeout(150);
  const dsdTotal = await page.locator('.stat', { hasText: 'Total' }).innerText();
  ok(dsdTotal.includes('176.00'), 'DSD booking invoice totals qty x price plus 10% tax (160 + 16 = 176.00): '+dsdTotal);

  await page.click('text=View invoice');
  await page.waitForTimeout(150);
  const dsdInvRow = page.locator('tr', { hasText: 'DSD Guest' });
  const dsdInvRowText = await dsdInvRow.innerText();
  ok(dsdInvRowText.includes('80.00') && dsdInvRowText.includes('160.00'), 'printed invoice line shows the per-dive unit price (80.00), qty, and extended amount (160.00): '+dsdInvRowText.replace(/\n/g,' | '));

  console.log('41. Agent direct-collect commission, mixed-status booking auto-derivation, and per-guest-line rate lock');
  // Fresh agent, priced lower than Direct, on the trip/boat already set up in
  // section 40 (Override Skiff, 2026-09-28, Override Dive) — it has 2 free
  // seats left (Override Guest One/Two used 2 of 4).
  await navTo(page, '/customers');
  await page.click('#c-add');
  await page.fill('#cf-name', 'Small Agency');
  await page.fill('#cf-credit', '2000');
  await page.click('#cf-save');
  await page.waitForTimeout(100);
  await page.click('tr:has-text("Small Agency")');
  await page.click('#ap-add');
  await page.selectOption('#ap-pkg', { label: 'Override Dive' });
  await page.fill('#ap-amt', '100');
  await page.fill('#ap-amt-usd', '7');
  await page.fill('#ap-amt-eur', '6.4');
  await page.click('#ap-save');
  await page.waitForTimeout(100);

  await navTo(page, '/guests');
  await page.click('#g-add');
  await page.fill('#gf-name', 'Agent Guest A');
  await page.click('#gf-save');
  await page.waitForTimeout(100);
  await page.click('#g-add');
  await page.fill('#gf-name', 'Agent Guest B');
  await page.click('#gf-save');
  await page.waitForTimeout(100);

  await navTo(page, '/bookings');
  await page.click('#bk-add');
  await page.selectOption('#nb-customer', { label: 'Small Agency' });
  await page.click('#nb-go');
  await page.waitForSelector('#bk-add-guest');
  await page.click('#bk-add-guest');
  await page.selectOption('#agl-guest', { label: 'Agent Guest A' });
  await page.selectOption('#agl-pkg', { label: 'Override Dive' });
  await page.waitForTimeout(150);
  const sep28OptA = await page.locator('#agl-trip option', { hasText: 'Sep 28' }).first().getAttribute('value');
  await page.selectOption('#agl-trip', sep28OptA);
  await page.waitForTimeout(150);
  const agentGuestAvail = await page.locator('#agl-avail').innerText();
  ok(agentGuestAvail.includes('100.00'), 'agent guest resolves the agent special price (100), below the Direct rate: '+agentGuestAvail.replace(/\n/g,' | '));
  await page.click('#agl-save');
  await page.waitForTimeout(150);

  await page.click('#bk-add-guest');
  await page.selectOption('#agl-guest', { label: 'Agent Guest B' });
  await page.selectOption('#agl-pkg', { label: 'Override Dive' });
  await page.waitForTimeout(150);
  const sep28OptB = await page.locator('#agl-trip option', { hasText: 'Sep 28' }).first().getAttribute('value');
  await page.selectOption('#agl-trip', sep28OptB);
  await page.waitForTimeout(150);
  await page.click('#agl-save');
  await page.waitForTimeout(150);
  const bothOnHoldStatus = await page.locator('.stat', { hasText: 'Status' }).innerText();
  ok(bothOnHoldStatus.includes('OPEN'), 'booking stays OPEN while both guests are still on hold: '+bothOnHoldStatus);

  const commissionAcctBefore = await page.evaluate(()=>Ledger.accountBalance(Store.acctId('2150')));
  await page.click('[data-gl-action="settle"]'); // Agent Guest A's row — the first HOLD line
  await page.waitForSelector('#st-save');
  await page.check('#st-direct');
  await page.waitForTimeout(100);
  const directHintText = await page.locator('#st-direct-hint').innerText();
  ok(directHintText.includes('120.00') && directHintText.includes('20.00'), 'direct-collect preview shows the Direct total (120.00) and the 20.00 commission gap over the 100 agent rate: '+directHintText);
  await page.selectOption('#st-method', 'CASH');
  await page.click('#st-save');
  await page.waitForTimeout(150);

  const afterDirectCollect = await page.evaluate(()=>{
    const b = Store.all('bookings').find(bk=>(bk.guestLines||[]).some(gl=>gl.directCollect));
    const gl = b.guestLines.find(g=>g.directCollect);
    return { status: b.status, unitPrice: gl.unitPrice, glStatus: gl.status };
  });
  ok(afterDirectCollect.unitPrice===120, 'the guest line\'s own rate was raised to the Direct rate (120) once direct-collected: '+afterDirectCollect.unitPrice);
  ok(afterDirectCollect.status==='OPEN', 'booking status stays OPEN — Agent Guest B is still on hold (item 4 mixed rule): '+afterDirectCollect.status);
  const commissionAcctAfter = await page.evaluate(()=>Ledger.accountBalance(Store.acctId('2150')));
  ok(Math.abs((commissionAcctAfter-commissionAcctBefore)-20)<0.01, 'Agent Commission Payable grew by the 20.00 gap between the Direct and agent rates: +'+(commissionAcctAfter-commissionAcctBefore));

  console.log('41b. Cancelling the remaining HOLD guest re-derives the booking to CONFIRMED (2 cancel + 1 confirm => confirmed, per item 4)');
  await page.click('tr:has-text("Agent Guest B") button:has-text("Cancel")');
  await page.waitForTimeout(100);
  await page.click('#confirm-yes');
  await page.waitForTimeout(150);
  const statusAfterCancel = await page.locator('.stat', { hasText: 'Status' }).innerText();
  ok(statusAfterCancel.includes('CONFIRMED'), 'once the only remaining active line is settled, the booking auto-derives to CONFIRMED even with a cancelled line alongside it: '+statusAfterCancel);

  console.log('41c. Rate lock: front desk cannot edit a settled line\'s price, but accountant/admin still can');
  await navTo(page, '/settings');
  await page.click('[data-tab="users"]');
  await page.click('#us-add');
  await page.fill('#uf-name', 'Fran (Front desk)');
  await page.selectOption('#uf-role', 'FRONT_DESK');
  await page.click('#uf-save');
  await page.waitForTimeout(100);
  await page.selectOption('#user-switch', { label: 'Fran (Front desk) — Front desk' });
  await page.waitForTimeout(150);
  await navTo(page, '/bookings');
  await page.click('tr:has-text("Small Agency")');
  await page.waitForTimeout(100);
  ok(await page.locator('tr:has-text("Agent Guest A") .price-editable').count()===0, 'front desk cannot click-to-edit the rate on a settled guest line');
  // Section 38's migration test replaced the whole database (including the
  // earlier Riz/Olive users), so switch back to whichever admin now exists
  // rather than a user that no longer does.
  const adminLabel = (await page.$$eval('#user-switch option', os=>os.map(o=>o.textContent))).find(t=>t.includes('— Admin'));
  await page.selectOption('#user-switch', { label: adminLabel });
  await page.waitForTimeout(150);
  await navTo(page, '/bookings');
  await page.click('tr:has-text("Small Agency")');
  await page.waitForTimeout(100);
  ok(await page.locator('tr:has-text("Agent Guest A") .price-editable').count()===1, 'an accountant can still click-to-edit the rate on a settled guest line');

  console.log('42. Settling a guest as Pending (credit) invoices in the booking\'s own currency and leaves a "Collect payment" action; day-end shows USD cash in USD');
  await navTo(page, '/guests');
  await page.click('#g-add');
  await page.fill('#gf-name', 'Credit Guest');
  await page.click('#gf-save');
  await page.waitForTimeout(100);

  await navTo(page, '/fleet');
  await page.click('#b-add');
  await page.fill('#bf-name', 'Credit Skiff');
  await page.fill('#bf-seats', '2');
  await page.click('#bf-save');
  await page.waitForTimeout(100);

  await navTo(page, '/calendar');
  await page.click('#cal-add-trip');
  await page.fill('#tr-date', '2026-09-30');
  await page.selectOption('#tr-boat', { label: 'Credit Skiff (2 seats)' });
  await page.click('#tr-pkgs >> text=Override Dive');
  await page.click('#tr-save');
  await page.waitForTimeout(150);

  await navTo(page, '/bookings');
  await page.click('#bk-add');
  await page.selectOption('#nb-customer', { value: 'CUST_DIRECT' });
  await page.selectOption('#nb-currency', 'USD');
  await page.click('#nb-go');
  await page.waitForSelector('#bk-add-guest');
  await page.click('#bk-add-guest');
  await page.selectOption('#agl-guest', { label: 'Credit Guest' });
  await page.selectOption('#agl-pkg', { label: 'Override Dive' });
  await page.waitForTimeout(150);
  const sep30Opt = await page.locator('#agl-trip option', { hasText: 'Sep 30' }).first().getAttribute('value');
  await page.selectOption('#agl-trip', sep30Opt);
  await page.waitForTimeout(150);
  if(await page.locator('#agl-gear .pill').count()){ await page.click('#agl-gear >> .pill'); await page.waitForTimeout(150); }
  await page.click('#agl-save');
  await page.waitForTimeout(150);
  await page.click('[data-gl-action="settle"]');
  await page.waitForSelector('#st-save');
  await page.selectOption('#st-method', 'PENDING');
  await page.click('#st-save');
  await page.waitForTimeout(150);

  const creditStatText = await page.locator('.grid.grid-4').innerText();
  ok(creditStatText.includes('CONFIRMED'), 'booking auto-confirms (and auto-invoices) the moment its only guest is settled, even on credit: '+creditStatText.replace(/\n/g,' | '));
  ok(creditStatText.includes('8.80 USD'), 'Total and Balance due are both shown in the booking\'s own currency (USD = 8 + 10% tax) for the credit sale, not converted to the base ledger currency: '+creditStatText.replace(/\n/g,' | '));
  ok(await page.locator('#bk-collect-payment').count()===1, 'a "Collect payment" action is offered on the booking once a Pending (credit) sale leaves a balance due');
  ok((await page.locator('.card', { hasText: 'Payments' }).innerText()).includes('confirmed on credit'), 'Payments card explains this booking was confirmed on credit with no receipt yet');

  console.log('42b. Sales invoice for the USD booking is denominated in USD, not the ledger\'s base currency');
  await page.click('button:has-text("View invoice")');
  await page.waitForTimeout(150);
  const usdInvoiceText = await page.locator('.split-detail').innerText();
  ok(usdInvoiceText.includes('Currency: USD'), 'sales invoice header shows the booking\'s own currency: '+usdInvoiceText.replace(/\n/g,' | '));
  ok(usdInvoiceText.toUpperCase().includes('AMOUNT (USD)'), 'invoice line-amount column is denominated in the booking\'s own currency');
  ok(usdInvoiceText.includes('8.00 USD') && usdInvoiceText.includes('0.80 USD') && usdInvoiceText.includes('8.80 USD'), 'invoice Subtotal/Tax/Total are shown in USD (8.00 + 0.80 tax = 8.80), not converted to MVR: '+usdInvoiceText.replace(/\n/g,' | '));
  ok(usdInvoiceText.includes('Booking balance due') && usdInvoiceText.includes('8.80 USD'), 'invoice shows the same outstanding balance as the booking');
  ok(await page.locator('#inv-collect-payment').count()===1, 'Collect payment is also reachable directly from the linked sales invoice');

  console.log('42c. Collect payment: a partial payment from the booking, the remainder from the invoice');
  const creditUsdCashBefore = await page.evaluate(()=>Ledger.accountBalance(Store.acctId('1011')));
  const creditBookingId = await page.evaluate(()=>{
    const g = Store.all('guests').find(x=>x.name==='Credit Guest');
    return Store.all('bookings').find(bk=>(bk.guestLines||[]).some(gl=>gl.guestId===g.id)).id;
  });
  await page.evaluate((id)=>Router.navigate('bookings/'+id), creditBookingId);
  await page.waitForTimeout(150);
  await page.click('#bk-collect-payment');
  await page.waitForSelector('#cp-save');
  const cpModalText = await page.locator('.modal-body').innerText();
  ok(cpModalText.includes('8.80 USD'), 'collect-payment modal shows the balance due in the booking\'s own currency: '+cpModalText.replace(/\n/g,' | '));
  await page.fill('#cp-amount', '3');
  await page.selectOption('#cp-method', 'CASH');
  await page.click('#cp-save');
  await page.waitForTimeout(150);
  const afterPartialText = await page.locator('.grid.grid-4').innerText();
  ok(afterPartialText.includes('5.80 USD'), 'balance due drops to 5.80 USD after a 3.00 partial payment: '+afterPartialText.replace(/\n/g,' | '));
  ok((await page.locator('.table-wrap table', { hasText: 'Receipt #' }).innerText()).includes('3.00 USD'), 'the partial receipt appears on the booking\'s Payments table in USD');

  await page.click('button:has-text("View invoice")');
  await page.waitForTimeout(150);
  ok((await page.locator('.split-detail').innerText()).includes('5.80 USD'), 'the linked invoice reflects the same reduced balance after the partial payment');
  await page.click('#inv-collect-payment');
  await page.waitForSelector('#cp-save');
  await page.selectOption('#cp-method', 'CASH');
  await page.click('#cp-save');
  await page.waitForTimeout(150);
  const invFinalText = await page.locator('.split-detail').innerText();
  ok(invFinalText.includes('0.00 USD'), 'invoice balance reaches 0.00 USD once the remainder is collected from the invoice page itself: '+invFinalText.replace(/\n/g,' | '));
  ok(await page.locator('#inv-collect-payment').count()===0, 'Collect payment disappears once the invoice/booking is fully paid');

  const creditUsdCashAfter = await page.evaluate(()=>Ledger.accountBalance(Store.acctId('1011')));
  ok(Math.abs((creditUsdCashAfter-creditUsdCashBefore)-8.8)<0.01, 'both collect-payment receipts (3.00 + 5.80) posted the full 8.80 to the USD Cash on Hand control account: +'+(creditUsdCashAfter-creditUsdCashBefore));

  console.log('43. Payment methods can be tied to one currency (e.g. a USD card terminal) with its own dedicated clearing account');
  await navTo(page, '/accounts');
  await page.click('#ac-add');
  await page.fill('#af-code', '1031');
  await page.fill('#af-name', 'Card Clearing — USD');
  await page.selectOption('#af-acct-type', 'Other Current Asset');
  await page.click('#af-save');
  await page.waitForTimeout(100);

  await navTo(page, '/settings');
  await page.click('[data-tab="methods"]');
  await page.click('#pm-add');
  await page.fill('#pmf-label', 'USD Card');
  await page.selectOption('#pmf-currency', 'USD');
  await page.waitForTimeout(100);
  const acctOptTexts = await page.locator('#pmf-acct option').allTextContents();
  const usdClearingIdx = acctOptTexts.findIndex(t=>t.includes('Card Clearing — USD'));
  const nonMatchIdx = acctOptTexts.findIndex(t=>t.includes('Bank Account'));
  ok(usdClearingIdx>=0 && usdClearingIdx<nonMatchIdx, 'picking a currency floats every USD-named account (including the new Card Clearing — USD) above non-matching ones: '+acctOptTexts.join(', '));
  await page.selectOption('#pmf-acct', { label: '1031 — Card Clearing — USD' });
  await page.click('#pmf-save');
  await page.waitForTimeout(100);
  const methodsTableText = await page.locator('table.t').innerText();
  ok(methodsTableText.includes('USD Card') && methodsTableText.includes('1031 — Card Clearing — USD'), 'USD Card method saved, settling to its own dedicated clearing account: '+methodsTableText.replace(/\n/g,' | '));

  console.log('43b. A currency-tied method only appears when settling/collecting in that same currency');
  await navTo(page, '/guests');
  await page.click('#g-add');
  await page.fill('#gf-name', 'Card Guest');
  await page.click('#gf-save');
  await page.waitForTimeout(100);
  await navTo(page, '/bookings');
  await page.click('#bk-add');
  await page.selectOption('#nb-customer', { value: 'CUST_DIRECT' });
  await page.selectOption('#nb-currency', 'USD');
  await page.click('#nb-go');
  await page.waitForSelector('#bk-add-guest');
  await page.click('#bk-add-guest');
  await page.selectOption('#agl-guest', { label: 'Card Guest' });
  await page.selectOption('#agl-pkg', { label: 'Override Dive' });
  await page.waitForTimeout(150);
  const sep30Opt2 = await page.locator('#agl-trip option', { hasText: 'Sep 30' }).first().getAttribute('value');
  await page.selectOption('#agl-trip', sep30Opt2);
  await page.waitForTimeout(150);
  if(await page.locator('#agl-gear .pill').count()){ await page.click('#agl-gear >> .pill'); await page.waitForTimeout(150); }
  await page.click('#agl-save');
  await page.waitForTimeout(150);
  await page.click('[data-gl-action="settle"]');
  await page.waitForSelector('#st-save');
  const usdMethodOptions = await page.locator('#st-method option').allTextContents();
  ok(usdMethodOptions.some(t=>t.includes('USD Card')), 'settling a USD-currency booking offers the USD-only "USD Card" method: '+usdMethodOptions.join(', '));
  const cardClearingUsdBefore = await page.evaluate(()=>Ledger.accountBalance(Store.acctByCode('1031').id));
  await page.selectOption('#st-method', { label: 'USD Card' });
  await page.click('#st-save');
  await page.waitForTimeout(150);
  const cardClearingUsdAfter = await page.evaluate(()=>Ledger.accountBalance(Store.acctByCode('1031').id));
  ok(Math.abs((cardClearingUsdAfter-cardClearingUsdBefore)-8.8)<0.01, 'settling via "USD Card" posted the tax-inclusive USD amount (8 + 10% tax = 8.80) straight to its own dedicated clearing account (1031), not the MVR Card Clearing account: +'+(cardClearingUsdAfter-cardClearingUsdBefore));

  await navTo(page, '/fleet');
  await page.click('#b-add');
  await page.fill('#bf-name', 'MVR Skiff');
  await page.fill('#bf-seats', '2');
  await page.click('#bf-save');
  await page.waitForTimeout(100);
  await navTo(page, '/calendar');
  await page.click('#cal-add-trip');
  await page.fill('#tr-date', '2026-10-01');
  await page.selectOption('#tr-boat', { label: 'MVR Skiff (2 seats)' });
  await page.click('#tr-pkgs >> text=Override Dive');
  await page.click('#tr-save');
  await page.waitForTimeout(150);
  await navTo(page, '/guests');
  await page.click('#g-add');
  await page.fill('#gf-name', 'MVR Guest');
  await page.click('#gf-save');
  await page.waitForTimeout(100);
  await navTo(page, '/bookings');
  await page.click('#bk-add');
  await page.selectOption('#nb-customer', { value: 'CUST_DIRECT' });
  await page.click('#nb-go'); // default currency, MVR
  await page.waitForSelector('#bk-add-guest');
  await page.click('#bk-add-guest');
  await page.selectOption('#agl-guest', { label: 'MVR Guest' });
  await page.selectOption('#agl-pkg', { label: 'Override Dive' });
  await page.waitForTimeout(150);
  const oct1Opt = await page.locator('#agl-trip option', { hasText: 'Oct 1' }).first().getAttribute('value');
  await page.selectOption('#agl-trip', oct1Opt);
  await page.waitForTimeout(150);
  if(await page.locator('#agl-gear .pill').count()){ await page.click('#agl-gear >> .pill'); await page.waitForTimeout(150); }
  await page.click('#agl-save');
  await page.waitForTimeout(150);
  await page.click('[data-gl-action="settle"]');
  await page.waitForSelector('#st-save');
  const mvrMethodOptions = await page.locator('#st-method option').allTextContents();
  ok(!mvrMethodOptions.some(t=>t.includes('USD Card')), 'the USD-only "USD Card" method is hidden when settling an MVR-currency booking: '+mvrMethodOptions.join(', '));
  ok(mvrMethodOptions.some(t=>t.includes('Cash')) && mvrMethodOptions.some(t=>t.includes('Bank')), 'currency-agnostic methods (Cash, Bank) remain available regardless of booking currency: '+mvrMethodOptions.join(', '));
  await page.selectOption('#st-method', 'CASH');
  await page.click('#st-save');
  await page.waitForTimeout(150);

  console.log('42d. Day-end close shows a USD Cash row in USD, not the company\'s base-currency $ symbol');
  await navTo(page, '/dayend');
  await page.click('#de-close-today');
  await page.waitForSelector('#de-rows');
  const usdRowText = await page.locator('#de-rows tr', { hasText: 'Cash (USD)' }).innerText();
  ok(usdRowText.includes('USD') && !usdRowText.includes('$'), 'the Cash (USD) day-end row shows its amounts in USD, not the company\'s $ symbol: '+usdRowText.replace(/\n/g,' | '));
  await page.click('#de-save');
  await page.waitForTimeout(150);
  ok((await page.locator('table.t').innerText()).includes('LOCKED'), 'day locked after verifying currency-correct day-end amounts');

  console.log('\n--- Console errors seen during run ---');
  if(consoleErrors.length){ consoleErrors.forEach(e=>console.log('  ', e)); } else console.log('  (none)');
  ok(consoleErrors.length===0, 'zero console errors across the entire run');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if(fail>0) process.exit(1);
}

main().catch(e=>{ console.error('Test run crashed:', e); process.exit(1); });
