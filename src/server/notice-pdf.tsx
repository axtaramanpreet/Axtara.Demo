/**
 * One investor's notice, as a PDF.
 *
 * Rendered with @react-pdf/renderer rather than by screenshotting the page, so
 * the text stays selectable and searchable — an investor's finance team has to
 * be able to copy the amount out of it, and a scanned-looking image of a
 * capital call is not a document anyone should be wiring against.
 *
 * It reads the same `NoticeData` the on-screen sheet reads, which is the thing
 * that keeps the two honest: every figure here has already been computed and
 * formatted by the engine, and nothing is recalculated on the way in.
 *
 * The layout is written separately from `notice-sheet.tsx`, so the two can
 * drift apart in appearance. `notice-pdf.test.ts` asserts that every figure in
 * `NoticeData` reaches the PDF, which is the part that would actually matter.
 */

import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { amountOf, Line, Meta, PaymentBlock, safeFileName, styles } from './pdf-kit';
import type { NoticeData } from '@/engine';

export type NoticeStatus = 'draft' | 'approved' | 'sent';

export function NoticeDocument({
  notice,
  status,
  issuedOn,
}: {
  notice: NoticeData;
  status: NoticeStatus;
  issuedOn?: string | null;
}) {
  const isDraft = status !== 'sent';
  const callNo = String(notice.callNo);

  return (
    <Document
      title={`Capital Call No. ${callNo} — ${notice.name}`}
      author={notice.fund}
      subject={`Capital call notice for ${notice.name}`}
    >
      <Page size="A4" style={styles.page}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fund}>{notice.fund}</Text>
            <Text style={styles.careOf}>c/o the General Partner</Text>
          </View>
          <Text style={[styles.stamp, isDraft ? styles.stampDraft : styles.stampIssued]}>
            {isDraft
              ? 'DRAFT — FOR REVIEW ONLY'
              : `ISSUED ${issuedOn ? new Date(issuedOn).toLocaleDateString('en-GB') : ''}`.trim()}
          </Text>
        </View>

        <Text style={styles.title}>Capital Call Notice</Text>

        <View style={styles.metaRow}>
          <Meta label="Notice No." value={callNo} />
          <Meta label="Notice date" value={notice.callDate} />
          <Meta label="Payment due" value={notice.dueDate} />
          <Meta label="Investor" value={notice.name} />
          <Meta label="Investor ID" value={notice.id} />
          <Meta label="Currency" value={notice.cur} />
        </View>

        <Text style={[styles.paragraph, styles.bold]}>{notice.subject}</Text>

        <Text style={styles.paragraph}>{notice.salutation}</Text>

        {/* The wording comes from the engine, so this cannot say something
            different from the page it was reviewed on. */}
        {notice.intro.map((paragraph, i) => (
          <Text key={`intro-${i}`} style={styles.paragraph}>
            {paragraph}
          </Text>
        ))}

        <View style={styles.totalBand}>
          <Text style={styles.totalLabel}>{notice.payableToYou ? 'AMOUNT PAYABLE TO YOU' : 'TOTAL AMOUNT DUE'}</Text>
          <Text style={styles.totalAmount}>{`${notice.cur} ${notice.total}`}</Text>
        </View>

        <Text style={styles.heading}>A. Purpose of this Capital Call</Text>
        {notice.inside.map((line, i) => (
          <Line key={`in-${i}`} label={line.label} mark={line.mark} amount={amountOf(line)} />
        ))}
        <Line
          label="Subtotal — called against capital commitment"
          amount={notice.subtotalInside}
          strong
        />
        {notice.outside.map((line, i) => (
          <Line key={`out-${i}`} label={line.label} mark={line.mark} amount={amountOf(line)} />
        ))}
        <Line label="Total Amount Called" amount={notice.called ?? notice.total} strong />
        {notice.equalization?.map((eq, i) => (
          <View key={`eq-${i}`}>
            <Line label={eq.label} mark={eq.mark} amount="" strong />
            {eq.parts.map((p) => (
              <Line key={p.label} label={`    ${p.label}`} amount={p.amt} />
            ))}
            <Line label="    Equalization total" amount={eq.total} />
          </View>
        ))}
        {notice.equalization && (
          <Line label={notice.payableToYou ? 'Amount Payable to You' : 'Total Amount Due'} amount={notice.total} strong />
        )}

        <Text style={styles.heading}>B. Your Capital Account Summary</Text>
        {notice.account.map((line, i) => (
          <Line key={`acct-${i}`} label={line.label} amount={line.amt} strong={line.strong} />
        ))}

        <View style={styles.notes}>
          {notice.notes.map((note) => (
            <View key={note.n} style={styles.note}>
              <Text style={styles.noteMark}>{`${note.n}.`}</Text>
              <Text style={{ flex: 1 }}>{note.text}</Text>
            </View>
          ))}
        </View>

        <PaymentBlock lines={notice.payment} />

        {notice.closing.map((paragraph, i) => (
          <Text key={`closing-${i}`} style={styles.paragraph}>
            {paragraph}
          </Text>
        ))}

        <View style={styles.signature} wrap={false}>
          {notice.signOff.map((line, i) => (
            <Text key={`sign-${i}`} style={i === 0 ? undefined : styles.bold}>
              {line}
            </Text>
          ))}
        </View>

        <View style={styles.footer} fixed>
          <Text>{`${notice.fund} — Capital Call No. ${callNo}`}</Text>
          <Text
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

/** Render one notice to a PDF buffer. */
export function renderNoticePdf(
  notice: NoticeData,
  status: NoticeStatus,
  issuedOn?: string | null,
): Promise<Buffer> {
  return renderToBuffer(
    <NoticeDocument notice={notice} status={status} issuedOn={issuedOn} />,
  );
}

/**
 * `Capital Call #2_Alpha Pension Trust.pdf`.
 *
 * Investor names carry commas and full stops — "Illustrative Fund II, L.P." —
 * and those are fine in a filename. Path separators, colons and control
 * characters are not, and a zip entry containing one is a directory traversal
 * rather than a file, so they go.
 */
export function noticeFileName(callNo: string | number, investorName: string): string {
  return `Capital Call #${callNo}_${safeFileName(investorName, 'Investor')}.pdf`;
}
