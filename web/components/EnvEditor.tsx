'use client';

import { useRef, useState, type ClipboardEvent } from 'react';
import { Icon } from './Icon';

export interface EnvRow {
  key: string;
  value: string;
}

export const rowsFromEnv = (env: Record<string, string>): EnvRow[] =>
  Object.entries(env).map(([key, value]) => ({ key, value }));

export const envFromRows = (rows: EnvRow[]): Record<string, string> =>
  Object.fromEntries(rows.filter((r) => r.key.trim() !== '').map((r) => [r.key.trim(), r.value]));

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Parses .env text (KEY=value, `export KEY=value`, quotes, # comments). Invalid lines are counted, not thrown. */
export function parseEnv(text: string): { rows: EnvRow[]; skipped: number } {
  const rows: EnvRow[] = [];
  let skipped = 0;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/.exec(line);
    if (!match || !KEY_RE.test(match[1] as string)) {
      skipped++;
      continue;
    }
    let value = (match[2] ?? '').trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, ' ').replace(/\\"/g, '"');
    } else {
      value = value.replace(/\s+#.*$/, ''); // inline comment on unquoted values
    }
    rows.push({ key: match[1] as string, value });
  }
  return { rows, skipped };
}

/** Looks like pasted .env content rather than a normal key name. */
const looksLikeEnv = (text: string) => /\n/.test(text.trim()) || /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(text.trim());

export function EnvEditor({ rows, onChange }: { rows: EnvRow[]; onChange: (rows: EnvRow[]) => void }) {
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState('');
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const update = (i: number, patch: Partial<EnvRow>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  /** Adds parsed rows; existing keys are updated in place, blank rows are dropped. */
  const merge = (text: string): boolean => {
    const { rows: parsed, skipped } = parseEnv(text);
    if (parsed.length === 0) {
      setNote(skipped ? `No valid KEY=value lines found (${skipped} skipped).` : 'Nothing to add.');
      return false;
    }
    const next = rows.filter((r) => r.key.trim() !== '' || r.value !== '');
    let updated = 0;
    for (const p of parsed) {
      const idx = next.findIndex((r) => r.key === p.key);
      if (idx >= 0) {
        next[idx] = p;
        updated++;
      } else next.push(p);
    }
    onChange(next);
    setNote(`${parsed.length} variable${parsed.length > 1 ? 's' : ''} added${updated ? ` (${updated} updated)` : ''}${skipped ? `, ${skipped} line${skipped > 1 ? 's' : ''} skipped` : ''}.`);
    return true;
  };

  const onKeyPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (looksLikeEnv(text) && text.includes('=')) {
      e.preventDefault();
      merge(text);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 256 * 1024) return setNote('That file is too large for an .env file.');
    if (merge(await file.text())) setBulkOpen(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      {rows.map((row, i) => (
        <div className="env-row" key={i}>
          <input
            className="input input-sm mono"
            placeholder="KEY"
            aria-label="Variable name"
            value={row.key}
            spellCheck={false}
            autoCapitalize="characters"
            onPaste={onKeyPaste}
            onChange={(e) => update(i, { key: e.target.value.replace(/\s/g, '_') })}
          />
          <input
            className="input input-sm mono"
            placeholder="value"
            aria-label="Variable value"
            value={row.value}
            spellCheck={false}
            onChange={(e) => update(i, { value: e.target.value })}
          />
          <button type="button" className="icon-btn" aria-label="Remove variable" onClick={() => onChange(rows.filter((_, idx) => idx !== i))}>
            <Icon name="x" />
          </button>
        </div>
      ))}

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-sm" onClick={() => onChange([...rows, { key: '', value: '' }])}>
          <Icon name="plus" /> Add variable
        </button>
        <button type="button" className="btn btn-sm" aria-expanded={bulkOpen} onClick={() => { setBulkOpen((o) => !o); setNote(''); }}>
          <Icon name="key" /> Add from .env
        </button>
        <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
          <Icon name="copy" /> Upload .env file
        </button>
        <input ref={fileRef} type="file" hidden accept=".env,.txt,text/plain,*/*" onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>

      {bulkOpen && (
        <div className="bulk-box">
          <textarea
            className="input mono"
            rows={6}
            autoFocus
            value={bulk}
            spellCheck={false}
            placeholder={'MONGO_URI=mongodb+srv://...\nJWT_SECRET=supersecret\nVITE_API_URL=https://api.example.com'}
            onChange={(e) => setBulk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && merge(bulk)) {
                setBulk('');
                setBulkOpen(false);
              }
            }}
          />
          <div className="row" style={{ alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={!bulk.trim()}
              onClick={() => {
                if (merge(bulk)) {
                  setBulk('');
                  setBulkOpen(false);
                }
              }}
            >
              Add variables
            </button>
            <span className="hint">Paste your whole .env — each line becomes an editable row. ⌘/Ctrl + Enter also works.</span>
          </div>
        </div>
      )}

      {note && <span className="hint" role="status">{note}</span>}
    </div>
  );
}
