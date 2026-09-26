/**
 * The pieces every Axtara PDF is made of: the house style, a labelled amount,
 * a label over a value, and the payment instructions block.
 *
 * Shared, so a notice and an equalization statement from the same fund look
 * like they came from the same fund.
 */

import { StyleSheet, Text, View } from '@react-pdf/renderer';

/** Points. @react-pdf works in these, and A4 is 595 x 842. */
export const styles = StyleSheet.create({
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
  // A footnote number, raised and smaller, drawn from plain digits.
  mark: { fontSize: 6, verticalAlign: 'super' },
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

/** A negative amount reads as (1,234.56), the way an accountant expects. */
export function amountOf(line: { amt: string; neg?: boolean }): string {
  return line.neg ? `(${line.amt.replace(/[()]/g, '')})` : line.amt;
}

/**
 * A footnote mark as the digits it stands for: `⁴` -> `4`, `(10)` -> `10`.
 *
 * The notice carries its marks as superscript characters, which the page shows
 * as they are. The PDF cannot: its built-in Helvetica encodes only ¹ ² ³, and
 * anything past that is written as the low byte of its code point — ⁴ (U+2074)
 * came out as "t". So the PDF prints the number and raises it itself, which
 * works for every footnote, in any font, and for notices already sent whose
 * frozen payload still holds the old characters.
 */
export function markDigits(mark: string): string {
  const at = '¹²³⁴⁵⁶⁷⁸⁹'.indexOf(mark);
  if (at >= 0) return String(at + 1);
  return mark.replace(/[()]/g, '');
}

export function Line({
  label,
  mark,
  amount,
  strong,
}: {
  label: string;
  /** Footnote mark, as the notice carries it. */
  mark?: string;
  amount: string;
  strong?: boolean;
}) {
  const text = strong ? styles.bold : undefined;
  return (
    <View style={strong ? [styles.row, styles.rowStrong] : styles.row}>
      <Text style={[styles.rowLabel, ...(text ? [text] : [])]}>
        {mark ? `${label} ` : label}
        {mark ? <Text style={styles.mark}>{markDigits(mark)}</Text> : null}
      </Text>
      <Text style={[styles.rowAmount, ...(text ? [text] : [])]}>{amount}</Text>
    </View>
  );
}

export function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaCell}>
      <Text style={styles.metaLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

/**
 * Where to wire the money, from the fund's terms, with this investor's
 * reference filled in. Nothing prints until the fund has a bank and an account
 * number: a half-filled block is worse than none on a request for money.
 */
export function PaymentBlock({ lines }: { lines: { label: string; value: string }[] | null | undefined }) {
  if (!lines?.length) return null;
  return (
    <View wrap={false}>
      <Text style={styles.heading}>Payment instructions</Text>
      {lines.map((l) => (
        <View key={l.label} style={styles.row}>
          <Text style={styles.rowLabel}>{l.label}</Text>
          <Text style={[styles.rowAmount, styles.bold]}>{l.value}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * A name made safe for a file, and a zip entry: separators, colons and control
 * characters go, since in a zip a "/" is a directory, not a character.
 */
export function safeFileName(name: string, fallback: string): string {
  return (
    String(name)
      .replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || fallback
  );
}
