import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Reveals `text` character by character, like a terminal typing it out. Honours
 * prefers-reduced-motion (shows the full text at once) and cleans up on unmount.
 */
export function TypingText({
  text,
  speed = 18,
  className,
  caret = true,
}: {
  text: string;
  speed?: number;
  className?: string;
  caret?: boolean;
}) {
  const [count, setCount] = useState(() => (prefersReducedMotion() ? text.length : 0));
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setCount(text.length);
      return;
    }
    setCount(0);
    timer.current = window.setInterval(() => {
      setCount((c) => {
        if (c >= text.length) {
          if (timer.current !== null) window.clearInterval(timer.current);
          return c;
        }
        return c + 1;
      });
    }, speed);
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, [text, speed]);

  const done = count >= text.length;
  return (
    <span className={className}>
      {text.slice(0, count)}
      {caret && !done && <span className="typing-caret" aria-hidden="true">▋</span>}
    </span>
  );
}
