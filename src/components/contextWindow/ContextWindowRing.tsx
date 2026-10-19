import { useContextWindowData } from './useContextWindowData';

/**
 * Small circular progress ring that shows the live context-window usage
 * percentage. Replaces the static CPU icon in the AI sidebar header.
 */
export function ContextWindowRing({ size = 18 }: { size?: number }) {
  const { usagePercent } = useContextWindowData();

  const pct = usagePercent ?? 0;
  const hasData = usagePercent !== null;

  const stroke = 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (pct / 100) * circumference;

  const tier = !hasData
    ? 'unknown'
    : pct >= 90
      ? 'danger'
      : pct >= 70
        ? 'warn'
        : 'ok';

  return (
    <span
      className={`ctx-ring ctx-ring--${tier}`}
      role="img"
      aria-label={hasData ? `Context window ${pct}% used` : 'Context window usage unknown'}
    >
      <svg className="ui-icon" viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="ctx-ring-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className="ctx-ring-progress"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ctx-ring-label">{hasData ? pct : '–'}</span>
    </span>
  );
}
