'use client';

import { useEffect, useRef, useState } from 'react';
import type { ScanFolder } from '@/lib/types';
import { Icon } from './Icon';

const labelOf = (f: ScanFolder) => (f.path === '.' ? 'Root folder (.)' : `${f.path}/`);
const kindOf = (f: ScanFolder) => `${f.framework} · ${f.kind === 'static' ? 'static site' : 'web service'}`;

export function FolderSelect({
  folders,
  value,
  onChange,
}: {
  folders: ScanFolder[];
  value: string;
  onChange: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = folders.find((f) => f.path === value) ?? folders[0];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!selected) return null;

  return (
    <div className={`select ${open ? 'open' : ''}`} ref={ref}>
      <button type="button" className="select-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="folder-ico"><Icon name="folder" /></span>
        <span className="opt-main">
          <b>{labelOf(selected)}</b>
          <small>{kindOf(selected)}</small>
        </span>
        <Icon name="chevron" />
      </button>

      {open && (
        <div className="select-menu" role="listbox">
          {folders.map((f) => (
            <button
              type="button"
              key={f.path}
              role="option"
              aria-selected={f.path === selected.path}
              className={`select-opt ${f.path === selected.path ? 'sel' : ''}`}
              onClick={() => {
                onChange(f.path);
                setOpen(false);
              }}
            >
              <span className="folder-ico"><Icon name="folder" /></span>
              <span className="opt-main">
                <b>{labelOf(f)}</b>
                <small>{f.packageName ? `${f.packageName} · ` : ''}{kindOf(f)}</small>
              </span>
              {f.path === selected.path && <Icon name="check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
