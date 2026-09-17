import { DATALISTS } from '@/adapters/workbook/template-layout';

/**
 * Suggestion lists for the enum columns.
 *
 * `<datalist>` suggests without constraining, which is the behaviour this
 * product wants: a firm using "Withdrawn" as an investor status should be able
 * to type it, and the engine will report what it makes of it. A `<select>`
 * would make that impossible and quietly reshape the accountant's data.
 */
export function Datalists() {
  return (
    <>
      {Object.entries(DATALISTS).map(([id, options]) => (
        <datalist key={id} id={id}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      ))}
    </>
  );
}
