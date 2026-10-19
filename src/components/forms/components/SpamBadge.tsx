import { ShieldAlert, ShieldCheck, Shield } from 'lucide-react';
import '../forms.css';

interface SpamBadgeProps {
  /** 0..100 placeholder spam score. */
  spamScore?: number;
}

function band(score: number): 'low' | 'mid' | 'high' {
  if (score >= 60) return 'high';
  if (score >= 30) return 'mid';
  return 'low';
}

export function SpamBadge({ spamScore }: SpamBadgeProps) {
  const score = typeof spamScore === 'number' ? spamScore : 0;
  const b = band(score);
  const Icon = b === 'high' ? ShieldAlert : b === 'mid' ? Shield : ShieldCheck;
  const label = b === 'high' ? `Spam (${score})` : b === 'mid' ? `Risk (${score})` : `Clean (${score})`;
  return (
    <span className={`forms-spam-badge forms-spam-badge--${b}`}>
      <Icon />
      {label}
    </span>
  );
}
