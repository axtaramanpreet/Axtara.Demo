/**
 * One investor's equalization statement, as a PDF.
 *
 * What a late investor owes at a later close, or what an earlier investor gets
 * back, laid out so it can be checked by hand: each earlier call and the
 * investor's share of it, the interest on each, and the catch-up fee period by
 * period. The same working the Closings screen shows, on paper.
 */

import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { daysBetween, fmt, fmtDate, pct, type EqualizationLine, type EqualizationResult, type Settlement } from '@/engine';
import { Line, Meta, PaymentBlock, safeFileName, styles } from './pdf-kit';

export interface StatementInput {
  fund: string;
  closingNo: number;
  line: EqualizationLine;
  result: EqualizationResult;
  finalised: boolean;
  /** Where to wire, for an investor who owes. */
  payment: { label: string; value: string }[] | null;
  /**
   * The date it is payable by, for a closing settled by statement. Absent on a
   * statement sent before it was recorded.
   */
  dueDate?: string | null;
  /**
   * How the closing is settled. On the next call, this statement asks for no
   * money: the amount is added to, or taken off, the investor's next call.
   */
  settlement: Settlement | null;
}

const amount = (n: number) => (n < 0 ? `(${fmt(-n)})` : fmt(n));

export function StatementDocument({ s }: { s: StatementInput }) {
  const { line, result } = s;
  const late = line.role !== 'earlier';
  const t = result.totals;
  const rate = t.interestRate;
  const interestTo = t.interestRunTo ?? result.closingDate;
  const feeInterest = line.feeInterest ?? 0;
  const feeFrom = line.feeSlices[0]?.from;
  // The last day the catch-up fee covers, when it was recorded.
  const feeTo = t.feeCoveredThrough && t.feeCoveredThrough >= (feeFrom ?? t.feeCoveredThrough) ? t.feeCoveredThrough : null;

  return (
    <Document title={`Equalization statement — ${line.name}`} author={s.fund}>
      <Page size="A4" style={styles.page}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fund}>{s.fund}</Text>
            <Text style={styles.careOf}>c/o the General Partner</Text>
          </View>
          <Text style={[styles.stamp, s.finalised ? styles.stampIssued : styles.stampDraft]}>
            {s.finalised ? 'FINAL' : 'DRAFT — FOR REVIEW ONLY'}
          </Text>
        </View>

        <Text style={styles.title}>Equalization statement</Text>

        <View style={styles.metaRow}>
          <Meta label="Closing" value={`No. ${s.closingNo}`} />
          <Meta label="Closing date" value={fmtDate(result.closingDate)} />
          <Meta label="Investor" value={line.name} />
          <Meta label="Investor ID" value={line.lpId} />
          <Meta label="Commitment" value={fmt(line.commitment)} />
          {s.dueDate && <Meta label={line.net >= 0 ? 'Payable by' : 'Paid to you by'} value={fmtDate(s.dueDate)} />}
          <Meta
            label="At this closing"
            value={line.role === 'late' ? 'Admitted' : line.role === 'both' ? 'Increased commitment' : 'Already invested'}
          />
        </View>

        <Text style={styles.paragraph}>
          {line.role === 'late'
            ? `You were admitted to the Fund at its closing on ${fmtDate(result.closingDate)}. So that you stand as if you had been an investor from the first close, you pay your commitment's share of each capital call made before you joined, interest for paying it late, and the management fee already billed to the other investors${feeTo ? ` (to ${fmtDate(feeTo)})` : ''}. Later fee periods are on your capital call notices, with everyone else.`
            : line.role === 'both'
              ? `Your commitment increased at the Fund's closing on ${fmtDate(result.closingDate)}. So that the increase stands as if it had been committed from the first close, you pay its share of each earlier capital call, interest for paying it late, and the management fee already billed on it${feeTo ? ` (to ${fmtDate(feeTo)})` : ''} — net of your share, on your earlier commitment, of what the closing returns to existing investors.`
              : `Investors admitted at the closing on ${fmtDate(result.closingDate)} have paid their share of the capital called before they joined. Your part of that is returned to you below, and restored to your unfunded commitment.`}
        </Text>

        <View style={styles.totalBand}>
          <Text style={styles.totalLabel}>{line.net >= 0 ? 'TOTAL DUE FROM YOU' : 'TOTAL DUE TO YOU'}</Text>
          <Text style={styles.totalAmount}>{fmt(Math.abs(line.net))}</Text>
        </View>

        <Text style={styles.heading}>A. {late ? 'Your share of earlier calls' : 'Returned from earlier calls'}</Text>
        {line.calls.map((c, i) => (
          <Line
            key={`c-${i}`}
            label={`Capital Call No. ${c.callNo}, due ${fmtDate(c.dueDate)}: ${fmt(c.called)} called, ${fmt(c.moved)} moved`}
            amount={amount(c.capital)}
          />
        ))}
        {line.calls.length === 0 && <Line label="No calls were made before this closing" amount="—" />}
        <Line label="Capital" amount={amount(line.capital)} strong />

        {line.calls.some((c) => c.interest !== 0) && (
          <>
            <Text style={styles.heading}>B. {late ? 'Interest for paying late' : 'Your share of the interest'}</Text>
            {line.calls
              .filter((c) => c.interest !== 0)
              .map((c, i) => (
                <Line
                  key={`i-${i}`}
                  label={
                    rate && c.capital > 0 && c.days > 0
                      ? t.interestBasis === 'compound'
                        ? `Call No. ${c.callNo}: ${fmt(c.capital)} × ((1 + ${pct(rate)})^(${c.days}/365) − 1)`
                        : `Call No. ${c.callNo}: ${fmt(c.capital)} × ${pct(rate)} × ${c.days}/365`
                      : `Call No. ${c.callNo}: your share of the interest late investors pay`
                  }
                  amount={amount(c.interest)}
                />
              ))}
            <Line label="Interest" amount={amount(line.interest)} strong />
          </>
        )}

        {line.catchUpFee !== 0 && (
          <>
            <Text style={styles.heading}>C. {late ? `Management fee since the first close${feeTo ? `, to ${fmtDate(feeTo)}` : ''}` : 'Your share of the catch-up fee'}</Text>
            {line.feeSlices
              .filter((f) => f.amount !== 0)
              .map((f, i) => (
                <Line
                  key={`f-${i}`}
                  label={`${fmtDate(f.from)} – ${fmtDate(f.to)}: ${fmt(f.basis)} × ${pct(f.rate)} × ${f.fractionWorking}`}
                  amount={fmt(f.amount)}
                />
              ))}
            <Line label="Catch-up management fee" amount={amount(line.catchUpFee)} strong />
          </>
        )}

        {feeInterest !== 0 && (
          <>
            <Text style={styles.heading}>D. {late ? 'Interest on the catch-up fee' : 'Your share of the interest on the catch-up fee'}</Text>
            {late && rate && t.catchUpFeeInterest === 'per_period'
              ? line.feeSlices
                  .filter((f) => f.amount !== 0)
                  .map((f, i) => (
                    <Line
                      key={`fi-${i}`}
                      label={`${fmt(f.amount)} × ${pct(rate)} × ${daysBetween(f.from, result.closingDate)}/365, ${fmtDate(f.from)} to ${fmtDate(result.closingDate)}`}
                      amount=""
                    />
                  ))
              : late && rate && feeFrom && (
                  <Line
                    label={`${fmt(line.catchUpFee)} × ${pct(rate)} × ${daysBetween(feeFrom, result.closingDate)}/365, ${fmtDate(feeFrom)} to ${fmtDate(result.closingDate)}`}
                    amount=""
                  />
                )}
            <Line label="Interest on the catch-up fee" amount={amount(feeInterest)} strong />
          </>
        )}

        <Line label={line.net >= 0 ? 'Total due from you' : 'Total due to you'} amount={fmt(Math.abs(line.net))} strong />

        {s.settlement === 'next_call' ? (
          <Text style={styles.paragraph}>
            {line.net >= 0
              ? 'Nothing is payable against this statement: the amount is added to your next capital call, and that notice says when and where to pay it.'
              : 'Nothing is paid out against this statement: the amount comes off your next capital call, and that notice shows it.'}
          </Text>
        ) : (
          late && line.net > 0 && <PaymentBlock lines={s.payment} />
        )}

        <View style={styles.notes}>
          <Text>
            Capital moved from each call is that call&apos;s capital × new commitments ÷ commitments after the closing
            ({fmt(t.commitmentsNew, 0)} ÷ {fmt(t.commitmentsBefore + t.commitmentsNew, 0)}). It is shared among late
            investors by commitment, and returned to earlier investors in proportion to what each holds of that call — what they paid, as moved by any earlier closing.
            {rate
              ? ` Interest is ${t.interestBasis}, at ${pct(rate)} a year, from each call's due date to ${
                  t.interestRunTo ? `${fmtDate(interestTo)}, when this statement is payable` : 'the closing date'
                }.${
                  s.settlement === 'next_call' && t.interestUntil === 'collection_due_date'
                    ? ' The capital call that collects it works the interest out again to its own due date.'
                    : ''
                } Interest is not a contribution: it does not count against commitment.`
              : ' No late-close interest applies.'}{' '}
            After this closing, every investor has paid in {pct(t.paidInPct)} of commitment.
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>{`${s.fund} — Closing No. ${s.closingNo}`}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export function renderStatementPdf(s: StatementInput): Promise<Buffer> {
  return renderToBuffer(<StatementDocument s={s} />);
}

/** `Closing 2_Eta Capital Partners.pdf` */
export function statementFileName(closingNo: number, investorName: string): string {
  return `Closing ${closingNo}_${safeFileName(investorName, 'Investor')}.pdf`;
}
