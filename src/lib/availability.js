/* ---------------------------------------------------------------------
   availability.js — the four-gate check run whenever a guest line is
   placed on a trip: boat seats, guide ratio, gear stock, certification.
   Returns { ok, gates:[{key,label,ok,detail}], gearNeeded:[{typeId,qty}] }
--------------------------------------------------------------------- */

const Availability = (function(){

  function isLineActive(gl){
    if(['CANCELLED','NO_SHOW','EXPIRED'].includes(gl.status)) return false;
    if(gl.status==='HOLD' && gl.holdExpiresAt && gl.holdExpiresAt < new Date().toISOString()) return false;
    return true;
  }

  function activeGuestLinesOnTrip(tripId, excludeGuestLineId){
    const out = [];
    Store.all('bookings').forEach(b=>{
      (b.guestLines||[]).forEach(gl=>{
        if(gl.tripId===tripId && isLineActive(gl) && gl.id!==excludeGuestLineId){
          out.push({ booking:b, guestLine:gl });
        }
      });
    });
    return out;
  }

  function sweepExpiredHolds(){
    let count = 0;
    Store.all('bookings').forEach(b=>{
      let changed = false;
      (b.guestLines||[]).forEach(gl=>{
        if(gl.status==='HOLD' && gl.holdExpiresAt && gl.holdExpiresAt < new Date().toISOString()){
          gl.status = 'EXPIRED'; changed = true; count++;
        }
      });
      if(changed) Store.update('bookings', b.id, { guestLines: b.guestLines });
    });
    return count;
  }

  // lineQty is the guest line's quantity — the number of dives this guest is
  // doing on this one line (e.g. 2 DSD dives on the same trip). It only
  // multiplies the need for gear types flagged "consumed per dive" (tank
  // fills, disposable items) — gear that's issued once for the whole trip
  // (BCD, fins, wetsuit) still needs just 1 regardless of dive count.
  function gearNeededForLine(packageId, ownGearTypeIds, lineQty){
    const pkg = Store.find('packages', packageId);
    if(!pkg || !pkg.kit) return [];
    const own = new Set(ownGearTypeIds||[]);
    const qty = lineQty && lineQty>1 ? lineQty : 1;
    return pkg.kit.filter(k=>!own.has(k.equipmentTypeId)).map(k=>{
      const type = Store.find('equipmentTypes', k.equipmentTypeId);
      const perGuest = k.qtyPerGuest||1;
      return { typeId:k.equipmentTypeId, qty: (type && type.consumedPerDive) ? perGuest*qty : perGuest };
    });
  }

  function stockCountByType(equipmentTypeId){
    return Store.where('equipment', e=>e.equipmentTypeId===equipmentTypeId && e.status!=='RETIRED').length;
  }

  // Seat capacity for a trip including any tagged rental boat (overflow capacity).
  function effectiveSeatLimit(trip){
    let limit = trip.seatLimit || (Store.find('boats', trip.boatId)||{}).seats || 0;
    if(trip.rentalBoatId){
      const rb = Store.find('boats', trip.rentalBoatId);
      if(rb) limit += (rb.seats||0);
    }
    return limit;
  }

  // Extra rental gear stock added to a specific trip (overflow), keyed by equipment type.
  function rentalGearExtraForTrip(tripId, equipmentTypeId){
    const trip = Store.find('trips', tripId);
    if(!trip || !trip.rentalGearExtra) return 0;
    const row = trip.rentalGearExtra.find(r=>r.typeId===equipmentTypeId);
    return row ? (row.qty||0) : 0;
  }

  // gear already reserved/issued for the SAME date across all trips that day (simplified:
  // we reserve at the trip level since gear is dated by trip, and a piece of equipment can only
  // serve one trip per day)
  function gearReservedForDate(tripDate, equipmentTypeId, excludeGuestLineId){
    let count = 0;
    Store.all('trips').forEach(trip=>{
      if(trip.tripDate!==tripDate) return;
      if(['CANCELLED'].includes(trip.status)) return;
      activeGuestLinesOnTrip(trip.id, excludeGuestLineId).forEach(({guestLine})=>{
        gearNeededForLine(guestLine.packageId, guestLine.ownGearTypeIds, guestLine.qty||1).forEach(g=>{
          if(g.typeId===equipmentTypeId) count += g.qty;
        });
      });
    });
    // gear issued straight to staff (cameras, drones, etc.) for a trip that day
    // also ties up stock, even though it isn't part of any guest's package kit.
    count += Store.where('equipment', e=>e.equipmentTypeId===equipmentTypeId && e.status==='ISSUED' && e.issuedToType==='STAFF' && e.issuedTripDate===tripDate).length;
    return count;
  }

  function checkTrip({ tripId, packageId, ownGearTypeIds, guestId, excludeGuestLineId, qty }){
    const gates = [];
    const trip = Store.find('trips', tripId);
    if(!trip){
      return { ok:false, gates:[{key:'trip',label:'Trip exists',ok:false,detail:'Trip not found.'}], gearNeeded:[] };
    }

    // 1. Boat seats (including any rental boat tagged onto this trip for overflow)
    const seatLimit = effectiveSeatLimit(trip);
    const takenSeats = activeGuestLinesOnTrip(tripId, excludeGuestLineId).length;
    const seatOk = takenSeats < seatLimit;
    gates.push({ key:'seats', label:'Boat seat free', ok: seatOk,
      detail: `${takenSeats} of ${seatLimit} seats taken` });

    // 2. Guide ratio — sum of each guide's max_guests across assigned trip staff must exceed guests
    const guideStaff = (trip.staffIds||[]).map(id=>Store.find('staff', id)).filter(Boolean);
    const guideCapacity = guideStaff.reduce((s,g)=> s + (g.maxGuests||0), 0);
    const ratioOk = guideStaff.length===0 ? true : (takenSeats < guideCapacity);
    gates.push({ key:'ratio', label:'Guide ratio ok', ok: ratioOk,
      detail: guideStaff.length ? `${takenSeats} of ${guideCapacity} guide capacity used` : 'No guide ratio limit set on this trip' });

    // 3. Gear — gear types flagged "consumed per dive" scale with qty (the
    // number of dives this guest line covers); other gear needs just 1.
    const gearNeeded = gearNeededForLine(packageId, ownGearTypeIds, qty||1);
    let gearOk = true; const gearDetails = [];
    gearNeeded.forEach(g=>{
      const type = Store.find('equipmentTypes', g.typeId);
      const rentalExtra = rentalGearExtraForTrip(tripId, g.typeId);
      const stock = stockCountByType(g.typeId) + rentalExtra;
      const reserved = gearReservedForDate(trip.tripDate, g.typeId, excludeGuestLineId);
      const free = stock - reserved;
      const ok = free >= g.qty;
      if(!ok) gearOk = false;
      gearDetails.push(`${type?type.name:'Gear'}: ${free} of ${stock} free${rentalExtra?` (incl. ${rentalExtra} rental)`:''}`);
    });
    gates.push({ key:'gear', label:'Gear available', ok: gearOk,
      detail: gearDetails.length ? gearDetails.join(', ') : 'No house gear required for this line' });

    // 4. Certification
    const pkg = Store.find('packages', packageId);
    const guest = Store.find('guests', guestId);
    let certOk = true, certDetail = 'No minimum certification set on this package';
    if(pkg && pkg.minCert){
      const levels = Store.settings.certLevels || [];
      const guestLevel = guest ? guest.certLevel : '';
      if(levels.length && levels.includes(pkg.minCert)){
        const need = levels.indexOf(pkg.minCert);
        const have = levels.indexOf(guestLevel);
        certOk = have >= need;
        certDetail = certOk ? `${guestLevel||'—'} meets ${pkg.minCert}` : `Guest is ${guestLevel||'uncertified'}; package requires ${pkg.minCert}`;
      } else {
        certOk = guestLevel === pkg.minCert;
        certDetail = certOk ? `Meets ${pkg.minCert}` : `Package requires ${pkg.minCert}; guest is ${guestLevel||'not set'}`;
      }
    }
    gates.push({ key:'cert', label:'Certification ok', ok: certOk, detail: certDetail });

    const ok = gates.every(g=>g.ok);
    return { ok, gates, gearNeeded, trip };
  }

  function suggestAlternativeTrips(packageId, fromDate){
    const pkg = Store.find('packages', packageId);
    if(!pkg) return [];
    return Store.all('trips')
      .filter(t=> t.tripDate>=fromDate && t.status==='OPEN' && (t.packageIds||[]).includes(packageId))
      .sort((a,b)=>a.tripDate.localeCompare(b.tripDate))
      .slice(0,5);
  }

  return { checkTrip, gearNeededForLine, stockCountByType, gearReservedForDate, activeGuestLinesOnTrip, suggestAlternativeTrips,
           sweepExpiredHolds, isLineActive, effectiveSeatLimit, rentalGearExtraForTrip };
})();

window.Availability = Availability;
