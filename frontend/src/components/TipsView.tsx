import { useEffect, useMemo, useRef, useState } from 'react';
import { VULN_TIPS } from '../vulnerabilityTips';
import { CommandTemplate } from './Terminal';

export function TipsView({ focusId }: { focusId?: string | null }) {
  const [filter, setFilter] = useState('');
  const [openId, setOpenId] = useState<string | null>(focusId ?? null);
  const focusedRef = useRef<HTMLDetailsElement | null>(null);
  const focusedTip = focusId ? VULN_TIPS.find((t) => t.id === focusId) : undefined;

  const tips = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return VULN_TIPS;
    return VULN_TIPS.filter((t) =>
      [t.id, t.title, t.cwe, t.plain, t.why, t.notice, t.fix, t.try]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [filter]);

  useEffect(() => {
    if (!focusId) return;
    setFilter('');
    setOpenId(focusId);
  }, [focusId]);

  useEffect(() => {
    if (focusId) focusedRef.current?.scrollIntoView({ block: 'center' });
  }, [focusId, openId]);

  return (
    <div className="stack">
      <div className="intro">
        <h2>Training tips</h2>
        <p className="muted small">
          Plain-language hints for every intentional vulnerability in this local lab. Open one to see
          what is happening, how to prove it, and how the real fix would look.
        </p>
        {focusedTip && (
          <p className="accent-text small">
            Showing the hint for this objective: #{focusedTip.id} {focusedTip.title}. Use the Tips tab
            to browse all hints.
          </p>
        )}
      </div>

      <input
        className="tip-search"
        placeholder="Filter by number, name, CWE or keyword..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Filter training tips"
      />

      {tips.length === 0 && <p className="muted center">No tips match that search.</p>}

      <div className="list">
        {tips.map((tip) => (
          <details
            key={tip.id}
            ref={tip.id === focusId ? focusedRef : undefined}
            className="tip-card"
            open={openId === tip.id}
          >
            <summary
              onClick={(e) => {
                e.preventDefault();
                setOpenId((current) => (current === tip.id ? null : tip.id));
              }}
            >
              <span className="tip-id">#{tip.id}</span>
              <strong>{tip.title}</strong>
              <span className="muted small">{tip.cwe}</span>
            </summary>
            <div className="tip-body">
              <p>{tip.plain}</p>
              <p>
                <strong>Why it works:</strong> {tip.why}
              </p>
              <p>
                <strong>What to notice:</strong> {tip.notice}
              </p>
              <p className="accent-text small">
                <strong>Try:</strong> <code>{tip.try}</code>
              </p>
              <p className="success-text small">
                <strong>Fix:</strong> {tip.fix}
              </p>
              {tip.curl && (
                <CommandTemplate
                  title={`curl · ${tip.title}`}
                  command={tip.curl}
                  description={tip.curlDescription}
                  flags={tip.curlFlags}
                />
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
