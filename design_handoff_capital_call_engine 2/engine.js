// Capital call calculation engine — pure functions, no UI.
export const num = v => { if (v === '' || v == null) return 0; const n = Number(String(v).replace(/[,\s%$]/g, '')); return isNaN(n) ? 0 : n; };
export const round = (x, d) => { const f = Math.pow(10, d); return Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9) / f; };
const yes = v => String(v || '').trim().toUpperCase() === 'Y';
const ids = s => String(s || '').split(/[,;]/).map(x => x.trim()).filter(Boolean);

export function serialToISO(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const d = new Date(v); return isNaN(d) ? String(v) : d.toISOString().slice(0, 10);
}
export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z'); if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
export const fmt = (n, d = 2) => {
  if (n == null || n === '') return '';
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return n < 0 ? `(${s})` : s;
};
export const pct = r => (num(r) * 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';

// Pro-rata allocation with deterministic rounding plug.
export function allocate(total, parts, plugId, d) {
  const out = {}; const sumB = parts.reduce((s, p) => s + p.basis, 0);
  if (!parts.length || sumB <= 0) { parts.forEach(p => out[p.id] = 0); return { out, plugId: null, ok: false }; }
  parts.forEach(p => out[p.id] = round(total * p.basis / sumB, d));
  let plug = parts.find(p => p.id === plugId) || parts.reduce((a, b) => b.basis > a.basis ? b : a);
  const others = parts.filter(p => p.id !== plug.id).reduce((s, p) => s + out[p.id], 0);
  out[plug.id] = round(total - others, d);
  return { out, plugId: plug.id, ok: true };
}

export function applyTransfers(lps, transfers, callDate, d) {
  const roster = lps.map(l => ({ ...l }));
  const applied = [], skipped = [];
  for (const t of transfers) {
    const eff = serialToISO(t.Effective_Date);
    const from = roster.find(l => l.LP_ID === t.From_LP_ID);
    if (!t.From_LP_ID || !t.To_LP_ID) continue;
    if (!from) { skipped.push({ t, why: `From_LP_ID ${t.From_LP_ID} not in register` }); continue; }
    if (eff && callDate && eff > callDate) { skipped.push({ t, why: `effective ${fmtDate(eff)}, after call date` }); continue; }
    const full = String(t.Transfer_Type || '').toLowerCase() === 'full';
    const p = full ? 1 : num(t.Transfer_Pct);
    if (p <= 0 || p > 1) { skipped.push({ t, why: 'Transfer_Pct must be between 0 and 1' }); continue; }
    let to = roster.find(l => l.LP_ID === t.To_LP_ID);
    if (!to) { to = { LP_ID: t.To_LP_ID, LP_Name: t.To_LP_Name_if_new || t.To_LP_ID, LP_Type: from.LP_Type, Commitment: 0, Opening_Paid_In: 0, Opening_UCC: 0, Opening_Invested_Capital: 0, Mgmt_Fee_Rate_Override: '', Fee_Exempt: 'N', Status: 'Active', Side_Letter_Ref: '', Notes: `Transferee of ${from.LP_ID} (${t.Transfer_ID})` }; roster.push(to); }
    const move = k => { const m = round(num(from[k]) * p, d); from[k] = round(num(from[k]) - m, d); to[k] = round(num(to[k]) + m, d); return m; };
    const moved = {};
    if (yes(t.Transfers_Commitment)) { moved.Commitment = move('Commitment'); moved.Opening_Invested_Capital = move('Opening_Invested_Capital'); }
    if (yes(t.Transfers_Paid_In)) moved.Opening_Paid_In = move('Opening_Paid_In');
    if (yes(t.Transfers_UCC)) moved.Opening_UCC = move('Opening_UCC');
    if (full) from.Status = 'Transferred';
    applied.push({ t, moved, pct: p });
  }
  return { roster, applied, skipped };
}

export function compute(model) {
  const { setup, lps, components, fee, transfers, golden } = model;
  const d = Math.max(0, Math.round(num(setup.Rounding_Decimals) || 2));
  const callDate = serialToISO(setup.Call_Date);
  const checks = [];
  const add = (level, text) => checks.push({ level, text });

  // 1. Roster as at call date
  const tr = applyTransfers(lps, transfers, callDate, d);
  tr.applied.forEach(a => add('ok', `Transfer ${a.t.Transfer_ID}: ${a.t.From_LP_ID} → ${a.t.To_LP_ID} (${Math.round(a.pct * 100)}%) applied before allocation.`));
  tr.skipped.forEach(s => add('info', `Transfer ${s.t.Transfer_ID} not applied — ${s.why}.`));
  const roster = tr.roster;
  const active = roster.filter(l => String(l.Status || 'Active') === 'Active' && l.LP_ID);
  const byId = Object.fromEntries(roster.map(l => [l.LP_ID, l]));
  const plugId = setup.Rounding_Plug_LP_ID;
  if (plugId && active.length && !byId[plugId]) add('warn', `Rounding_Plug_LP_ID "${plugId}" is not in the register — residual goes to the largest participant instead.`);
  const basisOf = (l, basis) => basis === 'UCC' ? num(l.Opening_UCC) : basis === 'Invested_Capital' ? num(l.Opening_Invested_Capital) : num(l.Commitment);

  // 2–3. Components
  const compAlloc = {}; // compId -> {lpId: amt}
  const excusedOf = {}; // lpId -> [component names]
  components.forEach(c => {
    if (!c.Component_ID) return;
    const ex = ids(c.Excused_LP_IDs);
    ex.filter(id => !byId[id]).forEach(id => add('warn', `${c.Component_Name}: excused LP "${id}" is not in the register.`));
    const basis = ['Commitment', 'UCC', 'Invested_Capital'].includes(c.Allocation_Basis) ? c.Allocation_Basis : 'Commitment';
    if (basis !== c.Allocation_Basis) add('warn', `${c.Component_Name}: unknown Allocation_Basis "${c.Allocation_Basis}", defaulted to Commitment.`);
    const parts = active.filter(l => !ex.includes(l.LP_ID)).map(l => ({ id: l.LP_ID, basis: basisOf(l, basis) }));
    ex.forEach(id => { (excusedOf[id] = excusedOf[id] || []).push(c.Component_Name); });
    const r = allocate(num(c.Total_Amount), parts, plugId, d);
    if (!r.ok) add('fail', `${c.Component_Name}: participants' ${basis} basis sums to zero — nothing allocated.`);
    compAlloc[c.Component_ID] = r.out;
    const tot = Object.values(r.out).reduce((s, x) => s + x, 0);
    add(Math.abs(tot - num(c.Total_Amount)) < 1e-6 ? 'ok' : 'fail', `${c.Component_Name} ties: allocated ${fmt(tot)} vs called ${fmt(num(c.Total_Amount))}${r.plugId ? ` (residual to ${r.plugId})` : ''}.`);
  });

  // 4. Management fee
  const feeBasisRaw = fee.Fee_Basis || setup.Default_Mgmt_Fee_Basis || 'Commitment';
  let feeBasis = feeBasisRaw;
  if (feeBasis === 'NAV') { feeBasis = 'Commitment'; add('warn', 'Fee_Basis = NAV but the register carries no NAV column — fee computed on Commitment.'); }
  if (!['Commitment', 'Invested_Capital'].includes(feeBasis)) { feeBasis = 'Commitment'; add('warn', `Unknown Fee_Basis "${feeBasisRaw}", defaulted to Commitment.`); }
  const defRate = fee.Default_Fee_Rate_Annual !== '' && fee.Default_Fee_Rate_Annual != null ? num(fee.Default_Fee_Rate_Annual) : num(setup.Default_Mgmt_Fee_Rate_Annual);
  const period = fee.Fee_Period_Fraction !== '' && fee.Fee_Period_Fraction != null ? num(fee.Fee_Period_Fraction) : num(setup.Mgmt_Fee_Period_Fraction);
  const exemptIds = ids(fee.Fee_Exempt_LP_IDs);
  const feeRate = {}, feeGross = {};
  active.forEach(l => {
    const exempt = yes(l.Fee_Exempt) || exemptIds.includes(l.LP_ID);
    const rate = exempt ? 0 : (num(l.Mgmt_Fee_Rate_Override) > 0 ? num(l.Mgmt_Fee_Rate_Override) : defRate);
    feeRate[l.LP_ID] = rate;
    feeGross[l.LP_ID] = round(basisOf(l, feeBasis) * rate * period, d);
  });
  const grossTotal = Object.values(feeGross).reduce((s, x) => s + x, 0);
  const feeOffset = {}; active.forEach(l => feeOffset[l.LP_ID] = 0);
  const offsets = (fee.offsets || []).filter(o => num(o.Amount) !== 0);
  offsets.forEach(o => {
    const m = String(o.Allocation_Method || 'Pro-rata to gross fee');
    const payers = active.filter(l => feeGross[l.LP_ID] > 0);
    const parts = payers.map(l => ({ id: l.LP_ID, basis: /commitment/i.test(m) ? num(l.Commitment) : /invested/i.test(m) ? num(l.Opening_Invested_Capital) : feeGross[l.LP_ID] }));
    const r = allocate(num(o.Amount), parts, plugId, d);
    Object.entries(r.out).forEach(([id, a]) => feeOffset[id] += a);
    const tot = Object.values(r.out).reduce((s, x) => s + x, 0);
    add(Math.abs(tot - num(o.Amount)) < 1e-6 ? 'ok' : 'fail', `Offset ${o.Offset_ID} (${m}) ties: ${fmt(tot)} vs ${fmt(num(o.Amount))}.`);
  });
  const offsetTotal = Object.values(feeOffset).reduce((s, x) => s + x, 0);
  if (offsetTotal > grossTotal + 1e-6) add('warn', `Offsets (${fmt(offsetTotal)}) exceed gross fee (${fmt(grossTotal)}) — net fee goes negative.`);
  const feeReduces = yes(fee.Reduces_Unfunded);

  // 5–7. Per-LP rollup
  const rows = roster.map(l => {
    const id = l.LP_ID; const isActive = active.includes(l);
    const comps = components.filter(c => c.Component_ID).map(c => ({ id: c.Component_ID, name: c.Component_Name, category: c.Category, basis: c.Allocation_Basis, reduces: yes(c.Reduces_Unfunded), amt: isActive ? (compAlloc[c.Component_ID][id] ?? 0) : 0, excused: ids(c.Excused_LP_IDs).includes(id) }));
    const gross = isActive ? feeGross[id] : 0, off = isActive ? feeOffset[id] : 0, net = round(gross - off, d);
    const compSum = comps.reduce((s, c) => s + c.amt, 0);
    const total = round(compSum + net, d);
    const reduces = round(comps.filter(c => c.reduces).reduce((s, c) => s + c.amt, 0) + (feeReduces ? net : 0), d);
    const outside = round(total - reduces, d);
    const openUCC = num(l.Opening_UCC), openPaid = num(l.Opening_Paid_In);
    return { ...l, isActive, comps, feeRate: isActive ? feeRate[id] : 0, feeGross: gross, feeOffset: off, feeNet: net, total, reduces, outside, openUCC, openPaid, closingUCC: round(openUCC - reduces, d), closingPaid: round(openPaid + total, d), excusedFrom: excusedOf[id] || [] };
  });
  rows.filter(r => r.isActive && r.reduces > r.openUCC + 1e-6).forEach(r => add('warn', `${r.LP_ID} ${r.LP_Name}: call against commitment (${fmt(r.reduces)}) exceeds unfunded commitment (${fmt(r.openUCC)}).`));
  const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const totals = { Commitment: rows.reduce((s, r) => s + num(r.Commitment), 0), openUCC: sum('openUCC'), openPaid: sum('openPaid'), comps: components.filter(c => c.Component_ID).map(c => rows.reduce((s, r) => s + (r.comps.find(x => x.id === c.Component_ID)?.amt || 0), 0)), feeGross: sum('feeGross'), feeOffset: sum('feeOffset'), feeNet: sum('feeNet'), total: sum('total'), reduces: sum('reduces'), closingUCC: sum('closingUCC'), closingPaid: sum('closingPaid') };
  add(Math.abs(totals.closingUCC - (totals.openUCC - totals.reduces)) < 1e-6 ? 'ok' : 'fail', `Unfunded roll-forward ties: ${fmt(totals.openUCC)} − ${fmt(totals.reduces)} = ${fmt(totals.closingUCC)}.`);
  add(Math.abs(totals.closingPaid - (totals.openPaid + totals.total)) < 1e-6 ? 'ok' : 'fail', `Paid-in roll-forward ties: ${fmt(totals.openPaid)} + ${fmt(totals.total)} = ${fmt(totals.closingPaid)}.`);
  const orgTotal = components.filter(c => /organi[sz]ational/i.test(c.Category || '')).reduce((s, c) => s + num(c.Total_Amount), 0);
  const cap = num(setup.Org_Expense_Cap);
  if (cap > 0) add(orgTotal <= cap + 1e-6 ? 'ok' : 'warn', `Organizational expense ${fmt(orgTotal)} vs cap ${fmt(cap)}${orgTotal > cap ? ' — excess treated per LPA' : ''}.`);

  // Golden fixture comparison
  const goldenDiffs = [];
  if (golden && golden.length) {
    const map = { Fee_Gross: 'feeGross', Fee_Offset: 'feeOffset', Fee_Net: 'feeNet', Total_Call: 'total', Reduces_Unfunded_Amt: 'reduces', Closing_UCC: 'closingUCC', Closing_Paid_In: 'closingPaid' };
    golden.forEach(g => {
      const r = rows.find(x => x.LP_ID === g.LP_ID); if (!r) { goldenDiffs.push({ lp: g.LP_ID, field: 'LP', expected: 'present', actual: 'missing' }); return; }
      Object.entries(map).forEach(([gk, rk]) => { if (g[gk] !== '' && g[gk] != null && Math.abs(num(g[gk]) - r[rk]) > 0.005) goldenDiffs.push({ lp: g.LP_ID, field: gk, expected: fmt(num(g[gk])), actual: fmt(r[rk]) }); });
      Object.keys(g).forEach(gk => {
        if (gk in map || ['LP_ID', 'LP_Name', 'Commitment', 'Opening_UCC', 'Opening_Paid_In', 'Fee_Rate'].includes(gk)) return;
        const norm = gk.toLowerCase().replace(/_/g, ' ');
        const c = r.comps.find(x => { const n = String(x.name || '').toLowerCase(); return n === norm || n.startsWith(norm) || norm.startsWith(n); });
        if (c && Math.abs(num(g[gk]) - c.amt) > 0.005) goldenDiffs.push({ lp: g.LP_ID, field: gk, expected: fmt(num(g[gk])), actual: fmt(c.amt) });
      });
    });
    add(goldenDiffs.length ? 'fail' : 'ok', goldenDiffs.length ? `Expected_Output fixture: ${goldenDiffs.length} difference(s).` : 'Expected_Output fixture: every figure matches to the cent.');
  }
  return { rows, totals, checks, goldenDiffs, roster, transfers: tr, fee: { basis: feeBasis, defRate, period, grossTotal, offsetTotal, reduces: feeReduces, offsets }, d, callDate };
}

// Build the data for one LP's notice.
export function buildNotice(model, result, row) {
  const { setup } = model; const cur = setup.Reporting_Currency || 'USD';
  const notes = []; const noteIdx = {};
  const noteFor = (key, text) => { if (!(key in noteIdx)) { notes.push(text); noteIdx[key] = notes.length; } return noteIdx[key]; };
  const sup = n => ['¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'][n - 1] || `(${n})`;
  const basisText = { Commitment: 'pro-rata to committed capital', UCC: 'pro-rata to unfunded capital commitment as at the notice date', Invested_Capital: 'pro-rata to invested capital' };
  const groups = {};
  row.comps.filter(c => !c.excused).forEach(c => { (groups[c.basis] = groups[c.basis] || []).push(c.name); });
  const joinNames = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0];
  const inside = [], outside = [];
  row.comps.forEach(c => {
    if (c.excused) return;
    const n = noteFor('basis:' + c.basis, `${joinNames(groups[c.basis])} ${groups[c.basis].length > 1 ? 'are' : 'is'} allocated ${basisText[c.basis] || basisText.Commitment}.`);
    const label = (c.category === 'Deal' ? 'Investment — ' : '') + c.name;
    (c.reduces ? inside : outside).push({ label, mark: sup(n), amt: fmt(c.amt), neg: false });
  });
  const feeLines = [];
  if (row.feeGross || row.feeOffset) {
    const fn = noteFor('fee', `The management fee is charged at ${pct(row.feeRate)} per annum on ${result.fee.basis === 'Invested_Capital' ? 'invested capital' : 'committed capital'} for the current period${row.feeOffset ? ` and is shown net of your pro-rata share of an aggregate ${cur} ${fmt(result.fee.offsetTotal)} management fee offset; your net management fee for this period is ${cur} ${fmt(row.feeNet)}` : ''}.`);
    feeLines.push({ label: `Management Fee (${pct(row.feeRate)} p.a., current period)`, mark: sup(fn), amt: fmt(row.feeGross), neg: false });
    if (row.feeOffset) feeLines.push({ label: 'Less: Management Fee Offset', mark: sup(fn), amt: fmt(-row.feeOffset), neg: true });
    (result.fee.reduces ? inside : outside).push(...feeLines);
  }
  if (outside.length) { const on = noteFor('outside', `${joinNames(outside.map(o => o.label))} ${outside.length > 1 ? 'are' : 'is'} called outside your capital commitment; ${outside.length > 1 ? 'they are' : 'it is'} payable in addition to, and ${outside.length > 1 ? 'do' : 'does'} not reduce, your unfunded commitment.`); outside.forEach(o => { o.label += ' (outside commitment)'; o.mark = sup(on); }); }
  if (row.excusedFrom.length) noteFor('excused', `You are excused from ${joinNames(row.excusedFrom)} under the Partnership Agreement; no amount is called from you in respect of ${row.excusedFrom.length > 1 ? 'those items' : 'that item'} and it has been allocated among the remaining partners.`);
  notes.push(`Amounts are rounded to ${result.d} decimal places.`);
  return {
    id: row.LP_ID, name: row.LP_Name, cur, fund: setup.Fund_Name, callNo: setup.Call_Number, callDate: fmtDate(serialToISO(setup.Call_Date)), dueDate: fmtDate(serialToISO(setup.Payment_Due_Date)),
    total: fmt(row.total), inside, outside, hasOutside: outside.length > 0, subtotalInside: fmt(row.reduces),
    account: [
      { label: 'Total Capital Commitment', amt: fmt(num(row.Commitment)) },
      { label: 'Contributions prior to this call', amt: fmt(row.openPaid) },
      { label: 'Contributions called — this notice (against commitment)', amt: fmt(row.reduces) },
      ...(outside.length ? [{ label: 'Contributions called — this notice (outside commitment)', amt: fmt(row.outside) }] : []),
      { label: 'Total Contributions to Date', amt: fmt(row.closingPaid), strong: true },
      { label: 'Unfunded Commitment — before this call', amt: fmt(row.openUCC) },
      { label: 'Less: applied against commitment this call', amt: fmt(-row.reduces) },
      { label: 'Unfunded Commitment — after this call', amt: fmt(row.closingUCC), strong: true },
    ],
    notes: notes.map((t, i) => ({ n: i + 1, text: t })),
  };
}
