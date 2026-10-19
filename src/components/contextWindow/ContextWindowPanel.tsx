import { useTranslation } from 'react-i18next';
import { Cpu } from 'lucide-react';
import { formatContextNumber, useContextWindowData } from './useContextWindowData';
import './contextWindow.css';

interface BreakdownSegment {
  key: 'user' | 'assistant' | 'toolCalls' | 'other';
  label: string;
  tokens: number;
}

export function ContextWindowPanel() {
  const { t } = useTranslation();
  const { activeThread, activeModel, contextLimit, provider, stats, usagePercent } = useContextWindowData();

  const segments = ([
    {
      key: 'user',
      label: t('contextWindow.userBreakdown', 'User'),
      tokens: stats.userTokens,
    },
    {
      key: 'assistant',
      label: t('contextWindow.assistantBreakdown', 'Assistant'),
      tokens: stats.assistantTokens,
    },
    {
      key: 'toolCalls',
      label: t('contextWindow.toolCallsBreakdown', 'Tool Calls'),
      tokens: stats.toolCallsTokens,
    },
    {
      key: 'other',
      label: t('contextWindow.otherBreakdown', 'Other'),
      tokens: stats.otherTokens,
    },
  ] satisfies BreakdownSegment[]).filter((segment) => segment.tokens > 0);

  const breakdownTotal =
    stats.userTokens + stats.assistantTokens + stats.toolCallsTokens + stats.otherTokens;

  const statRow = (label: string, value: React.ReactNode) => (
    <div className="context-window-stat">
      <span className="context-window-stat-label">{label}</span>
      <span className="context-window-stat-value">{value}</span>
    </div>
  );

  if (!activeThread) {
    return (
      <div className="context-window-popover-card">
        <div className="context-window-popover-header">
          <div className="context-window-popover-heading">
            <Cpu  className="ui-icon context-window-header-icon" />
            <span className="context-window-popover-title">
              {t('contextWindow.title', 'Context Window')}
            </span>
          </div>
        </div>
        <div className="context-window-empty">
          <p className="subtle">{t('contextWindow.noThread', 'Open a chat to see context usage.')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="context-window-popover-card">
      <div className="context-window-popover-header">
        <div className="context-window-popover-heading">
          <Cpu  className="ui-icon context-window-header-icon" />
          <div className="context-window-popover-heading-copy">
            <span className="context-window-popover-title">
              {t('contextWindow.title', 'Context Window')}
            </span>
            <span className="context-window-popover-subtitle trunc">{activeThread.title}</span>
          </div>
        </div>
        <span className="context-window-usage-chip">
          {usagePercent !== null ? `${usagePercent}%` : t('contextWindow.unknown', 'Unknown')}
        </span>
      </div>

      <div className="context-window-body ai-scroll">
        <div className="context-window-grid">
          {statRow(
            t('contextWindow.totalTokens', 'Total Tokens'),
            formatContextNumber(stats.totalTokens),
          )}
          {statRow(
            t('contextWindow.contextLimit', 'Context Limit'),
            contextLimit ? formatContextNumber(contextLimit) : t('contextWindow.unknown', 'Unknown'),
          )}
          {statRow(
            t('contextWindow.provider', 'Provider'),
            provider?.name ?? t('contextWindow.unknown', 'Unknown'),
          )}
          {statRow(
            t('contextWindow.model', 'Model'),
            activeModel?.name ?? provider?.selectedModel ?? t('contextWindow.unknown', 'Unknown'),
          )}
          {statRow(
            t('contextWindow.messages', 'Messages'),
            formatContextNumber(stats.totalMessages),
          )}
          {statRow(
            t('contextWindow.usage', 'Usage'),
            usagePercent !== null ? `${usagePercent}%` : t('contextWindow.unknown', 'Unknown'),
          )}
          {statRow(
            t('contextWindow.inputTokens', 'Input Tokens'),
            formatContextNumber(stats.promptTokens),
          )}
          {statRow(
            t('contextWindow.outputTokens', 'Output Tokens'),
            formatContextNumber(stats.completionTokens),
          )}
        </div>

        {(stats.reasoningTokens > 0 || stats.cacheReadTokens > 0 || stats.cacheWriteTokens > 0) && (
          <div className="context-window-secondary-grid">
            {stats.reasoningTokens > 0 &&
              statRow(
                t('contextWindow.reasoningTokens', 'Reasoning Tokens'),
                formatContextNumber(stats.reasoningTokens),
              )}
            {(stats.cacheReadTokens > 0 || stats.cacheWriteTokens > 0) &&
              statRow(
                t('contextWindow.cacheTokens', 'Cache Tokens (read/write)'),
                `${formatContextNumber(stats.cacheReadTokens)} / ${formatContextNumber(stats.cacheWriteTokens)}`,
              )}
          </div>
        )}

        <div className="context-window-section">
          <span className="context-window-section-title">
            {t('contextWindow.contextBreakdown', 'Context Breakdown')}
          </span>
          {segments.length === 0 ? (
            <p className="subtle context-window-empty-text">
              {t('contextWindow.noData', 'No context data yet.')}
            </p>
          ) : (
            <>
              <svg
                className="context-window-bar"
                viewBox={`0 0 ${breakdownTotal} 8`}
                preserveAspectRatio="none"
                role="img"
                aria-label={t('contextWindow.contextBreakdown', 'Context Breakdown')}
              >
                {segments.reduce<React.ReactNode[]>((acc, segment, index) => {
                  const x = segments
                    .slice(0, index)
                    .reduce((sum, currentSegment) => sum + currentSegment.tokens, 0);
                  acc.push(
                    <rect
                      key={segment.key}
                      className={`context-window-bar-segment context-window-bar-segment--${segment.key}`}
                      x={x}
                      y={0}
                      width={segment.tokens}
                      height={8}
                    >
                      <title>{`${segment.label}: ${formatContextNumber(segment.tokens)} tokens`}</title>
                    </rect>,
                  );
                  return acc;
                }, [])}
              </svg>
              <div className="context-window-legend">
                {segments.map((segment) => {
                  const percent =
                    breakdownTotal > 0
                      ? ((segment.tokens / breakdownTotal) * 100).toFixed(1)
                      : '0.0';
                  return (
                    <div key={segment.key} className="context-window-legend-item">
                      <span
                        className={`context-window-legend-dot context-window-legend-dot--${segment.key}`}
                      />
                      <span className="context-window-legend-label">
                        {segment.label} {percent}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
