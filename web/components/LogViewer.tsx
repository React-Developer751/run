'use client';

import { useEffect, useRef, type ReactNode } from 'react';

function lineClass(line: string): string | undefined {
  if (line.startsWith('[hostx]')) return /fail/i.test(line) ? 'err' : /Live at/.test(line) ? 'okl' : 'sys';
  if (/\b(error|ERR!|fatal)\b/i.test(line)) return 'err';
  if (/\bwarn/i.test(line)) return 'wrn';
  return undefined;
}

export function LogViewer({
  title,
  lines,
  footer,
  empty = 'Waiting for output...',
}: {
  title: string;
  lines: string[];
  footer?: ReactNode;
  empty?: string;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="logbox">
      <div className="logbox-bar">
        <span>{title}</span>
        {footer}
      </div>
      <pre
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {lines.length === 0
          ? empty
          : lines.map((line, i) => (
              <div key={i} className={lineClass(line)}>
                {line}
              </div>
            ))}
      </pre>
    </div>
  );
}
