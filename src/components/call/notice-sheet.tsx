import type { NoticeData } from '@/engine';

/**
 * One investor's Capital Call Notice, as it prints.
 *
 * Laid out as a document rather than a screen: fixed width, generous margins,
 * and `[data-notice]` so the print stylesheet gives each one its own page.
 *
 * The letter refers to wiring instructions "provided with this notice", and
 * there are none. The wording was supplied that way and is being used as given,
 * but until the bank details exist an investor is told to follow instructions
 * that are not there — which is worse than the notice saying nothing at all.
 */
export function NoticeSheet({
  notice,
  status,
  issuedOn,
  draftWatermark = true,
}: {
  notice: NoticeData;
  status: 'draft' | 'approved' | 'sent';
  /** Timestamp shown once the notice has gone out. */
  issuedOn?: string | null;
  draftWatermark?: boolean;
}) {
  const isDraft = status !== 'sent';

  return (
    <article
      data-notice="1"
      className="card"
      style={{
        maxWidth: 820,
        padding: '56px 64px',
        fontSize: 14,
        lineHeight: 1.5,
        margin: '0 auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{notice.fund}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            c/o the General Partner
          </div>
        </div>
        {isDraft && draftWatermark ? (
          <div
            style={{
              color: 'var(--destructive)',
              fontSize: 11,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              textAlign: 'right',
            }}
          >
            Draft — for review only
          </div>
        ) : (
          !isDraft && (
            <div
              className="text-muted"
              style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}
            >
              Issued {issuedOn ? new Date(issuedOn).toLocaleDateString('en-GB') : ''}
            </div>
          )
        )}
      </div>

      <h3 style={{ fontSize: 26, marginTop: 34 }}>Capital Call Notice</h3>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 16,
          marginTop: 24,
        }}
      >
        <Meta label="Notice No." value={String(notice.callNo)} />
        <Meta label="Notice date" value={notice.callDate} />
        <Meta label="Payment due" value={notice.dueDate} />
        <Meta label="Investor" value={notice.name} />
        <Meta label="Investor ID" value={notice.id} mono />
        <Meta label="Currency" value={notice.cur} />
      </div>

      <p style={{ marginTop: 28, fontWeight: 600 }}>
        Capital Call #{String(notice.callNo)} – {notice.fund}
      </p>

      <p>{notice.salutation}</p>

      {/* The wording comes from the engine so the PDF cannot say something
          different from the page. */}
      {notice.intro.map((paragraph, i) => (
        <p key={`intro-${i}`}>{paragraph}</p>
      ))}

      <div
        style={{
          borderTop: '2px solid var(--foreground)',
          borderBottom: '1px solid var(--border)',
          margin: '28px 0',
          padding: '14px 0',
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 20,
        }}
      >
        <span style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          Total amount due
        </span>
        <span className="mono" style={{ fontSize: 22 }}>
          {notice.cur} {notice.total}
        </span>
      </div>

      <h4 style={{ marginTop: 28 }}>A. Purpose of this Capital Call</h4>
      <table className="table" style={{ marginTop: 10 }}>
        <tbody>
          {notice.inside.map((line, i) => (
            <tr key={`in-${i}`}>
              <td style={{ paddingLeft: 0 }}>
                {line.label}
                <sup>{line.mark}</sup>
              </td>
              <td className="num" style={{ paddingRight: 0 }}>
                {line.neg ? `(${line.amt.replace(/[()]/g, '')})` : line.amt}
              </td>
            </tr>
          ))}
          <tr style={{ fontWeight: 600 }}>
            <td style={{ paddingLeft: 0 }}>Subtotal — called against capital commitment</td>
            <td className="num" style={{ paddingRight: 0 }}>
              {notice.subtotalInside}
            </td>
          </tr>
          {notice.outside.map((line, i) => (
            <tr key={`out-${i}`}>
              <td style={{ paddingLeft: 0 }}>
                {line.label}
                <sup>{line.mark}</sup>
              </td>
              <td className="num" style={{ paddingRight: 0 }}>
                {line.neg ? `(${line.amt.replace(/[()]/g, '')})` : line.amt}
              </td>
            </tr>
          ))}
          <tr style={{ fontWeight: 600, borderTop: '1px solid var(--foreground)' }}>
            <td style={{ paddingLeft: 0 }}>Total Amount Called</td>
            <td className="num" style={{ paddingRight: 0 }}>
              {notice.total}
            </td>
          </tr>
        </tbody>
      </table>

      <h4 style={{ marginTop: 28 }}>B. Your Capital Account Summary</h4>
      <table className="table" style={{ marginTop: 10 }}>
        <tbody>
          {notice.account.map((line, i) => (
            <tr key={i} style={line.strong ? { fontWeight: 600 } : undefined}>
              <td style={{ paddingLeft: 0 }}>{line.label}</td>
              <td className="num" style={{ paddingRight: 0 }}>
                {line.amt}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ol style={{ marginTop: 28, paddingLeft: 18, fontSize: 12, color: 'var(--muted-foreground)' }}>
        {notice.notes.map((note) => (
          <li key={note.n} style={{ marginBottom: 6 }}>
            {note.text}
          </li>
        ))}
      </ol>

      {notice.closing.map((paragraph, i) => (
        <p key={`closing-${i}`} style={i === 0 ? { marginTop: 26 } : undefined}>
          {paragraph}
        </p>
      ))}

      <div style={{ marginTop: 40 }}>
        {notice.signOff.map((line, i) => (
          <p key={`sign-${i}`} style={{ margin: 0, fontWeight: i === 0 ? 400 : 500 }}>
            {line}
          </p>
        ))}
      </div>

    </article>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div
        className="text-muted"
        style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}
      >
        {label}
      </div>
      <div className={mono ? 'mono' : undefined} style={{ marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}
