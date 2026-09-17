/**
 * The capital call calculation.
 *
 * `compute` is pure: same model in, same numbers out, no I/O and no clock. That
 * is what makes it safe to re-run on every keystroke in the setup screens, and
 * what makes the Expected_Output fixture a meaningful regression test.
 *
 * The order of operations matters and follows the LPA logic:
 *   1. Apply transfers      — settle who is in the fund and with what balances
 *   2. Allocate components  — split each deal/expense pro-rata to its basis
 *   3. Compute the fee      — per-LP rate, then offsets against it
 *   4. Roll forward         — per-LP totals and closing balances
 *   5. Tie out              — checks, including against Expected_Output
 */

import { allocate, type AllocationPart } from './allocate';
import { fmt, ids, num, round, serialToISO, yes } from './format';
import { applyTransfers } from './transfers';
import type {
  AllocationBasis,
  CallModel,
  Check,
  CheckLevel,
  ComputedComponent,
  ComputedRow,
  ComputeResult,
  GoldenDiff,
  LPRow,
} from './types';

/** Tolerance for "these two money figures are the same". Half a cent. */
const CENT_TOLERANCE = 0.005;

/** Tolerance for internal tie-out sums, well below a cent. */
const TIE_TOLERANCE = 1e-6;

/** Expected_Output column -> the computed field it should equal. */
const GOLDEN_FIELD_MAP = {
  Fee_Gross: 'feeGross',
  Fee_Offset: 'feeOffset',
  Fee_Net: 'feeNet',
  Total_Call: 'total',
  Reduces_Unfunded_Amt: 'reduces',
  Closing_UCC: 'closingUCC',
  Closing_Paid_In: 'closingPaid',
} as const;

/** Expected_Output columns that are inputs echoed back, not results to check. */
const GOLDEN_ECHOED_COLUMNS = [
  'LP_ID',
  'LP_Name',
  'Commitment',
  'Opening_UCC',
  'Opening_Paid_In',
  'Fee_Rate',
];

export function compute(model: CallModel): ComputeResult {
  const { setup, lps, components, fee, transfers, golden } = model;

  const d = Math.max(0, Math.round(num(setup.Rounding_Decimals) || 2));
  const callDate = serialToISO(setup.Call_Date);

  const checks: Check[] = [];
  const add = (level: CheckLevel, text: string) => checks.push({ level, text });

  // -------------------------------------------------------------------------
  // 1. The register as at the call date
  // -------------------------------------------------------------------------
  const tr = applyTransfers(lps, transfers, callDate, d);
  tr.applied.forEach((a) =>
    add(
      'ok',
      `Transfer ${a.t.Transfer_ID}: ${a.t.From_LP_ID} → ${a.t.To_LP_ID} (${Math.round(a.pct * 100)}%) applied before allocation.`,
    ),
  );
  tr.skipped.forEach((s) => add('info', `Transfer ${s.t.Transfer_ID} not applied — ${s.why}.`));

  const roster = tr.roster;
  const active = roster.filter((l) => String(l.Status || 'Active') === 'Active' && l.LP_ID);
  const byId = Object.fromEntries(roster.map((l) => [l.LP_ID, l]));

  const plugId = setup.Rounding_Plug_LP_ID;
  if (plugId && active.length && !byId[plugId]) {
    add(
      'warn',
      `Rounding_Plug_LP_ID "${plugId}" is not in the register — residual goes to the largest participant instead.`,
    );
  }

  /** The figure an LP's share is measured against, for a given basis. */
  const basisOf = (l: LPRow, basis: string): number =>
    basis === 'UCC'
      ? num(l.Opening_UCC)
      : basis === 'Invested_Capital'
        ? num(l.Opening_Invested_Capital)
        : num(l.Commitment);

  // -------------------------------------------------------------------------
  // 2. Components — each allocated pro-rata to its own basis
  // -------------------------------------------------------------------------
  /** Component_ID -> { LP_ID -> amount } */
  const compAlloc: Record<string, Record<string, number>> = {};
  /** LP_ID -> names of components they are excused from */
  const excusedOf: Record<string, string[]> = {};

  components.forEach((c) => {
    if (!c.Component_ID) return;

    const excused = ids(c.Excused_LP_IDs);
    excused
      .filter((id) => !byId[id])
      .forEach((id) =>
        add('warn', `${c.Component_Name}: excused LP "${id}" is not in the register.`),
      );

    // An unrecognised basis falls back to Commitment rather than failing, but
    // says so loudly — a silent fallback here would misallocate real money.
    const basis = (
      ['Commitment', 'UCC', 'Invested_Capital'].includes(c.Allocation_Basis)
        ? c.Allocation_Basis
        : 'Commitment'
    ) as AllocationBasis;
    if (basis !== c.Allocation_Basis) {
      add(
        'warn',
        `${c.Component_Name}: unknown Allocation_Basis "${c.Allocation_Basis}", defaulted to Commitment.`,
      );
    }

    const parts: AllocationPart[] = active
      .filter((l) => !excused.includes(l.LP_ID))
      .map((l) => ({ id: l.LP_ID, basis: basisOf(l, basis) }));

    excused.forEach((id) => {
      (excusedOf[id] = excusedOf[id] || []).push(c.Component_Name);
    });

    const r = allocate(num(c.Total_Amount), parts, plugId, d);
    if (!r.ok) {
      add(
        'fail',
        `${c.Component_Name}: participants' ${basis} basis sums to zero — nothing allocated.`,
      );
    }
    compAlloc[c.Component_ID] = r.out;

    const allocated = Object.values(r.out).reduce((s, x) => s + x, 0);
    add(
      Math.abs(allocated - num(c.Total_Amount)) < TIE_TOLERANCE ? 'ok' : 'fail',
      `${c.Component_Name} ties: allocated ${fmt(allocated)} vs called ${fmt(num(c.Total_Amount))}${
        r.plugId ? ` (residual to ${r.plugId})` : ''
      }.`,
    );
  });

  // -------------------------------------------------------------------------
  // 3. Management fee, then offsets against it
  // -------------------------------------------------------------------------
  const feeBasisRaw = fee.Fee_Basis || setup.Default_Mgmt_Fee_Basis || 'Commitment';
  let feeBasis = feeBasisRaw;
  if (feeBasis === 'NAV') {
    feeBasis = 'Commitment';
    add('warn', 'Fee_Basis = NAV but the register carries no NAV column — fee computed on Commitment.');
  }
  if (!['Commitment', 'Invested_Capital'].includes(feeBasis)) {
    feeBasis = 'Commitment';
    add('warn', `Unknown Fee_Basis "${feeBasisRaw}", defaulted to Commitment.`);
  }

  // The Management_Fee tab overrides Fund_Setup when it carries a value.
  const defRate =
    fee.Default_Fee_Rate_Annual !== '' && fee.Default_Fee_Rate_Annual != null
      ? num(fee.Default_Fee_Rate_Annual)
      : num(setup.Default_Mgmt_Fee_Rate_Annual);
  const period =
    fee.Fee_Period_Fraction !== '' && fee.Fee_Period_Fraction != null
      ? num(fee.Fee_Period_Fraction)
      : num(setup.Mgmt_Fee_Period_Fraction);

  const exemptIds = ids(fee.Fee_Exempt_LP_IDs);
  const feeRate: Record<string, number> = {};
  const feeGross: Record<string, number> = {};

  active.forEach((l) => {
    // Exemption wins over any override; a side-letter override wins over the
    // fund default. A zero or blank override means "no override", not "0%".
    const exempt = yes(l.Fee_Exempt) || exemptIds.includes(l.LP_ID);
    const rate = exempt
      ? 0
      : num(l.Mgmt_Fee_Rate_Override) > 0
        ? num(l.Mgmt_Fee_Rate_Override)
        : defRate;
    feeRate[l.LP_ID] = rate;
    feeGross[l.LP_ID] = round(basisOf(l, feeBasis) * rate * period, d);
  });

  const grossTotal = Object.values(feeGross).reduce((s, x) => s + x, 0);

  const feeOffset: Record<string, number> = {};
  active.forEach((l) => (feeOffset[l.LP_ID] = 0));

  const offsets = (fee.offsets || []).filter((o) => num(o.Amount) !== 0);
  offsets.forEach((o) => {
    const method = String(o.Allocation_Method || 'Pro-rata to gross fee');
    // Only fee payers share an offset — it would be meaningless to allocate a
    // fee rebate to an LP that pays no fee.
    const payers = active.filter((l) => feeGross[l.LP_ID] > 0);
    const parts: AllocationPart[] = payers.map((l) => ({
      id: l.LP_ID,
      basis: /commitment/i.test(method)
        ? num(l.Commitment)
        : /invested/i.test(method)
          ? num(l.Opening_Invested_Capital)
          : feeGross[l.LP_ID],
    }));

    const r = allocate(num(o.Amount), parts, plugId, d);
    Object.entries(r.out).forEach(([id, a]) => (feeOffset[id] += a));

    const allocated = Object.values(r.out).reduce((s, x) => s + x, 0);
    add(
      Math.abs(allocated - num(o.Amount)) < TIE_TOLERANCE ? 'ok' : 'fail',
      `Offset ${o.Offset_ID} (${method}) ties: ${fmt(allocated)} vs ${fmt(num(o.Amount))}.`,
    );
  });

  const offsetTotal = Object.values(feeOffset).reduce((s, x) => s + x, 0);
  if (offsetTotal > grossTotal + TIE_TOLERANCE) {
    add(
      'warn',
      `Offsets (${fmt(offsetTotal)}) exceed gross fee (${fmt(grossTotal)}) — net fee goes negative.`,
    );
  }

  const feeReduces = yes(fee.Reduces_Unfunded);

  // -------------------------------------------------------------------------
  // 4. Per-LP roll-up and closing balances
  // -------------------------------------------------------------------------
  const rows: ComputedRow[] = roster.map((l) => {
    const id = l.LP_ID;
    const isActive = active.includes(l);

    const comps: ComputedComponent[] = components
      .filter((c) => c.Component_ID)
      .map((c) => ({
        id: c.Component_ID,
        name: c.Component_Name,
        category: c.Category,
        basis: c.Allocation_Basis,
        reduces: yes(c.Reduces_Unfunded),
        amt: isActive ? (compAlloc[c.Component_ID][id] ?? 0) : 0,
        excused: ids(c.Excused_LP_IDs).includes(id),
      }));

    const gross = isActive ? feeGross[id] : 0;
    const off = isActive ? feeOffset[id] : 0;
    const net = round(gross - off, d);

    const compSum = comps.reduce((s, c) => s + c.amt, 0);
    const total = round(compSum + net, d);

    // Only components flagged Reduces_Unfunded (and the fee, if it is flagged)
    // draw down unfunded commitment. Everything else is called on top of it.
    const reduces = round(
      comps.filter((c) => c.reduces).reduce((s, c) => s + c.amt, 0) + (feeReduces ? net : 0),
      d,
    );
    const outside = round(total - reduces, d);

    const openUCC = num(l.Opening_UCC);
    const openPaid = num(l.Opening_Paid_In);

    return {
      ...l,
      isActive,
      comps,
      feeRate: isActive ? feeRate[id] : 0,
      feeGross: gross,
      feeOffset: off,
      feeNet: net,
      total,
      reduces,
      outside,
      openUCC,
      openPaid,
      closingUCC: round(openUCC - reduces, d),
      closingPaid: round(openPaid + total, d),
      excusedFrom: excusedOf[id] || [],
    };
  });

  // An LP being called more against commitment than they have left unfunded is
  // a warning, not a failure — it can be legitimate (recycling, defaults).
  rows
    .filter((r) => r.isActive && r.reduces > r.openUCC + TIE_TOLERANCE)
    .forEach((r) =>
      add(
        'warn',
        `${r.LP_ID} ${r.LP_Name}: call against commitment (${fmt(r.reduces)}) exceeds unfunded commitment (${fmt(r.openUCC)}).`,
      ),
    );

  // -------------------------------------------------------------------------
  // 5. Fund totals and tie-outs
  // -------------------------------------------------------------------------
  const sum = (k: keyof ComputedRow) => rows.reduce((s, r) => s + ((r[k] as number) || 0), 0);

  const totals = {
    Commitment: rows.reduce((s, r) => s + num(r.Commitment), 0),
    openUCC: sum('openUCC'),
    openPaid: sum('openPaid'),
    comps: components
      .filter((c) => c.Component_ID)
      .map((c) => rows.reduce((s, r) => s + (r.comps.find((x) => x.id === c.Component_ID)?.amt || 0), 0)),
    feeGross: sum('feeGross'),
    feeOffset: sum('feeOffset'),
    feeNet: sum('feeNet'),
    total: sum('total'),
    reduces: sum('reduces'),
    closingUCC: sum('closingUCC'),
    closingPaid: sum('closingPaid'),
  };

  add(
    Math.abs(totals.closingUCC - (totals.openUCC - totals.reduces)) < TIE_TOLERANCE ? 'ok' : 'fail',
    `Unfunded roll-forward ties: ${fmt(totals.openUCC)} − ${fmt(totals.reduces)} = ${fmt(totals.closingUCC)}.`,
  );
  add(
    Math.abs(totals.closingPaid - (totals.openPaid + totals.total)) < TIE_TOLERANCE ? 'ok' : 'fail',
    `Paid-in roll-forward ties: ${fmt(totals.openPaid)} + ${fmt(totals.total)} = ${fmt(totals.closingPaid)}.`,
  );

  const orgTotal = components
    .filter((c) => /organi[sz]ational/i.test(c.Category || ''))
    .reduce((s, c) => s + num(c.Total_Amount), 0);
  const cap = num(setup.Org_Expense_Cap);
  if (cap > 0) {
    add(
      orgTotal <= cap + TIE_TOLERANCE ? 'ok' : 'warn',
      `Organizational expense ${fmt(orgTotal)} vs cap ${fmt(cap)}${orgTotal > cap ? ' — excess treated per LPA' : ''}.`,
    );
  }

  // -------------------------------------------------------------------------
  // 6. Regression against the accountant's Expected_Output tab
  // -------------------------------------------------------------------------
  const goldenDiffs = golden && golden.length ? diffAgainstGolden(golden, rows) : [];
  if (golden && golden.length) {
    add(
      goldenDiffs.length ? 'fail' : 'ok',
      goldenDiffs.length
        ? `Expected_Output fixture: ${goldenDiffs.length} difference(s).`
        : 'Expected_Output fixture: every figure matches to the cent.',
    );
  }

  return {
    rows,
    totals,
    checks,
    goldenDiffs,
    roster,
    transfers: tr,
    fee: { basis: feeBasis, defRate, period, grossTotal, offsetTotal, reduces: feeReduces, offsets },
    d,
    callDate,
  };
}

/**
 * Compare computed rows against the accountant's Expected_Output fixture.
 *
 * Two kinds of column are checked: the fixed result columns in
 * `GOLDEN_FIELD_MAP`, and per-component columns whose names vary by fund
 * (`Deal_X`, `Org_Exp`, …) and are matched to component names by loose
 * prefix match, since the workbook abbreviates them.
 */
function diffAgainstGolden(
  golden: NonNullable<CallModel['golden']>,
  rows: ComputedRow[],
): GoldenDiff[] {
  const diffs: GoldenDiff[] = [];

  golden.forEach((g) => {
    const r = rows.find((x) => x.LP_ID === g.LP_ID);
    if (!r) {
      diffs.push({ lp: g.LP_ID, field: 'LP', expected: 'present', actual: 'missing' });
      return;
    }

    // Fixed result columns.
    (Object.entries(GOLDEN_FIELD_MAP) as [string, keyof ComputedRow][]).forEach(([gk, rk]) => {
      if (g[gk] !== '' && g[gk] != null && Math.abs(num(g[gk]) - (r[rk] as number)) > CENT_TOLERANCE) {
        diffs.push({
          lp: g.LP_ID,
          field: gk,
          expected: fmt(num(g[gk])),
          actual: fmt(r[rk] as number),
        });
      }
    });

    // Per-component columns.
    Object.keys(g).forEach((gk) => {
      if (gk in GOLDEN_FIELD_MAP || GOLDEN_ECHOED_COLUMNS.includes(gk)) return;

      const norm = gk.toLowerCase().replace(/_/g, ' ');
      const c = r.comps.find((x) => {
        const n = String(x.name || '').toLowerCase();
        return n === norm || n.startsWith(norm) || norm.startsWith(n);
      });

      if (c && Math.abs(num(g[gk]) - c.amt) > CENT_TOLERANCE) {
        diffs.push({ lp: g.LP_ID, field: gk, expected: fmt(num(g[gk])), actual: fmt(c.amt) });
      }
    });
  });

  return diffs;
}
