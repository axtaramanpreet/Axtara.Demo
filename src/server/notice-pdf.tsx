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

import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import type { NoticeData } from '@/engine';

/** Points. @react-pdf works in these, and A4 is 595 x 842. */
const styles = StyleSheet.create({
  page: {
    paddingTop: 54,
    paddingBottom: 60,
    paddingHorizontal: 56,
    fontSize: 9.5,
    lineHeight: 1.5,
    color: '#111111',
    fontFamily: 'Helvetica',
  },

  fund: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  careOf: { fontSize: 8, color: '#6b6b6b', marginTop: 2 },

  stamp: { fontSize: 7.5, letterSpacing: 1.1, textAlign: 'right' },
  stampDraft: { color: '#b00020' },
  stampIssued: { color: '#6b6b6b' },

  title: { fontSize: 19, fontFamily: 'Helvetica-Bold', marginTop: 26 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 18 },
  metaCell: { width: '33.33%', marginBottom: 12, paddingRight: 10 },
  metaLabel: { fontSize: 7, letterSpacing: 0.7, color: '#6b6b6b' },
  metaValue: { fontSize: 10, marginTop: 2 },

  paragraph: { marginTop: 12 },
  bold: { fontFamily: 'Helvetica-Bold' },

  totalBand: {
    marginTop: 22,
    marginBottom: 6,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: 1.6,
    borderTopColor: '#111111',
    borderBottomWidth: 0.6,
    borderBottomColor: '#cfcfcf',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  totalLabel: { fontSize: 7.5, letterSpacing: 1.1 },
  totalAmount: { fontSize: 16, fontFamily: 'Helvetica-Bold' },

  heading: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', marginTop: 22, marginBottom: 6 },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3.5,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e6e6e6',
  },
  rowStrong: { borderBottomColor: '#111111', borderBottomWidth: 0.8 },
  rowLabel: { flex: 1, paddingRight: 16 },
  rowAmount: { textAlign: 'right' },

  notes: { marginTop: 22, fontSize: 7.5, color: '#6b6b6b' },
  note: { flexDirection: 'row', marginBottom: 3 },
  noteMark: { width: 14 },

  signature: { marginTop: 36 },

  footer: {
    position: 'absolute',
    bottom: 28,
    left: 56,
    right: 56,
    fontSize: 7,
    color: '#8a8a8a',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});

export type NoticeStatus = 'draft' | 'approved' | 'sent';

/** A negative amount reads as (1,234.56), the way an accountant expects. */
function amountOf(line: { amt: string; neg?: boolean }): string {
  return line.neg ? `(${line.amt.replace(/[()]/g, '')})` : line.amt;
}

function Line({
  label,
  amount,
  strong,
}: {
  label: string;
  amount: string;
  strong?: boolean;
}) {
  const text = strong ? styles.bold : undefined;
  return (
    <View style={strong ? [styles.row, styles.rowStrong] : styles.row}>
      <Text style={[styles.rowLabel, ...(text ? [text] : [])]}>{label}</Text>
      <Text style={[styles.rowAmount, ...(text ? [text] : [])]}>{amount}</Text>
    </View>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaCell}>
      <Text style={styles.metaLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

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
          <Text style={styles.totalLabel}>TOTAL AMOUNT DUE</Text>
          <Text style={styles.totalAmount}>{`${notice.cur} ${notice.total}`}</Text>
        </View>

        <Text style={styles.heading}>A. Purpose of this Capital Call</Text>
        {notice.inside.map((line, i) => (
          <Line key={`in-${i}`} label={`${line.label} ${line.mark}`} amount={amountOf(line)} />
        ))}
        <Line
          label="Subtotal — called against capital commitment"
          amount={notice.subtotalInside}
          strong
        />
        {notice.outside.map((line, i) => (
          <Line key={`out-${i}`} label={`${line.label} ${line.mark}`} amount={amountOf(line)} />
        ))}
        <Line label="Total Amount Called" amount={notice.total} strong />

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
  const safe = String(investorName)
    .replace(/[/\\:*?"<>| -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `Capital Call #${callNo}_${safe || 'Investor'}.pdf`;
}
