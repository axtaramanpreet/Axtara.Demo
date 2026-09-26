import { InfoTip } from './info-tip';

/** One headline figure, with what it means one tap away. */
export function Stat({ label, value, info }: { label: string; value: string; info: string }) {
  return (
    <div className="stat">
      <div className="stat-label">
        {label}
        <InfoTip label={label}>{info}</InfoTip>
      </div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
