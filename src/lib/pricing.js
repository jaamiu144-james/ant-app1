/* ---------------------------------------------------------------------
   pricing.js — resolves the price for a package on a booking line.
   Order: agent-specific override -> customer's price list -> Direct
   list. Direct Booking guests always resolve against the Direct list
   (they never have an agentPrice and never point at an agent list).

   Multi-currency: every price-list item and agent special price can
   carry an amount in the base currency (MVR) plus optional USD/EUR
   amounts. resolvePrice() returns amounts for whichever currencies are
   set; the caller (the booking guest-line form) picks a currency and
   Posting freezes the exchange rate used at that moment.
--------------------------------------------------------------------- */

const Pricing = (function(){

  function directPriceList(){
    return Store.all('priceLists').find(pl=>pl.isDefault) || null;
  }

  function baseCurrency(){ return (Store.settings && Store.settings.baseCurrency) || 'MVR'; }

  // Latest exchange rate effective on or before `date` (falls back to 1:1 if none set,
  // so the app keeps working exactly as before for shops that never touch this table).
  function rateOnDate(date){
    const d = date || todayISO();
    const rates = (Store.settings.exchangeRates||[]).filter(r=>r.date<=d).sort((a,b)=>b.date.localeCompare(a.date));
    const r = rates[0];
    return { usdToMvr: r ? (r.usdToMvr||1) : 1, eurToMvr: r ? (r.eurToMvr||1) : 1, date: r ? r.date : null };
  }

  // Converts an amount already in `currency` into the base currency (MVR), using the
  // rate effective on `date`. Returns {amountBase, rate, currency}.
  function toBase(amount, currency, date){
    const rate = rateOnDate(date);
    let factor = 1;
    if(currency==='USD') factor = rate.usdToMvr;
    else if(currency==='EUR') factor = rate.eurToMvr;
    return { amountBase: round2((amount||0)*factor), rate: factor, currency: currency||baseCurrency() };
  }
  function round2(n){ return Math.round((n+Number.EPSILON)*100)/100; }

  function itemAmounts(it){
    return { MVR: it.amount, USD: it.amountUSD, EUR: it.amountEUR };
  }

  function listPriceFor(priceListId, packageId, onDate){
    const pl = Store.find('priceLists', priceListId);
    if(!pl) return null;
    const d = onDate || todayISO();
    const candidates = (pl.items||[]).filter(it=>it.packageId===packageId &&
      (!it.validFrom || it.validFrom<=d) && (!it.validTo || it.validTo>=d));
    if(!candidates.length) return null;
    // prefer the most specific (narrowest date range / most recent validFrom)
    candidates.sort((a,b)=> (b.validFrom||'').localeCompare(a.validFrom||''));
    return candidates[0];
  }

  // Returns { amount, amounts:{MVR,USD,EUR}, source: 'AGENT_SPECIAL'|'PRICE_LIST'|'DIRECT'|'NONE', priceListName }
  // `amount` stays the base-currency (MVR) figure for backward compatibility with callers
  // that don't care about multi-currency.
  function resolvePrice(customerId, packageId, onDate){
    const customer = Store.find('customers', customerId);
    if(!customer) return { amount: 0, amounts:{}, source: 'NONE' };

    if(customer.type === 'AGENT'){
      const special = Store.all('agentPrices').find(ap=>ap.customerId===customerId && ap.packageId===packageId);
      if(special) return { amount: special.amount, amounts: itemAmounts(special), source: 'AGENT_SPECIAL' };

      if(customer.priceListId){
        const it = listPriceFor(customer.priceListId, packageId, onDate);
        if(it){
          const pl = Store.find('priceLists', customer.priceListId);
          return { amount: it.amount, amounts: itemAmounts(it), source: 'PRICE_LIST', priceListName: pl && pl.name };
        }
      }
    }

    // Direct Booking, or an agent with no override/list match: fall back to Direct list
    const direct = directPriceList();
    if(direct){
      const it = listPriceFor(direct.id, packageId, onDate);
      if(it) return { amount: it.amount, amounts: itemAmounts(it), source: 'DIRECT', priceListName: direct.name };
    }
    return { amount: 0, amounts:{}, source: 'NONE' };
  }

  return { resolvePrice, listPriceFor, directPriceList, baseCurrency, rateOnDate, toBase };
})();

window.Pricing = Pricing;
