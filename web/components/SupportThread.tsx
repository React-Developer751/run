'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { shortDate } from '@/lib/format';
import type { TicketCategory, TicketMessage, TicketStatus } from '@/lib/types';

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  emergency: 'Emergency — site down',
  deploy: 'Deploys & builds',
  billing: 'Billing & payments',
  account: 'Account & login',
  other: 'Something else',
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const cls = status === 'open' ? 'badge-busy' : status === 'answered' ? 'badge-live' : 'badge-idle';
  const label = status === 'open' ? 'Waiting for support' : status === 'answered' ? 'Answered' : 'Closed';
  return <span className={`badge ${cls}`}>{label}</span>;
}

/** The conversation of one support request, oldest first, with a reply box. `side` is who is looking at it. */
export function SupportThread({
  thread,
  side,
  onSend,
  closed,
  extraActions,
  placeholder,
}: {
  thread: TicketMessage[];
  side: 'user' | 'admin';
  onSend: (text: string, close?: boolean) => Promise<boolean>;
  closed: boolean;
  extraActions?: ReactNode;
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [thread.length]);

  const send = async (close = false) => {
    if (!text.trim()) return;
    setBusy(true);
    if (await onSend(text.trim(), close)) setText('');
    setBusy(false);
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="thread" aria-live="polite">
        {thread.map((m) => {
          const mine = m.from === side;
          return (
            <div key={m.id} className={`bubble ${mine ? 'mine' : ''} ${m.from === 'admin' ? 'staff' : ''}`}>
              <div className="bubble-head">
                <b>{mine ? 'You' : m.authorName}</b>
                <small>{shortDate(m.at)}</small>
              </div>
              <p>{m.text}</p>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {closed && <div className="notice-box">This request is closed. {side === 'user' ? 'Writing a new message opens it again.' : 'Replying or reopening makes it active again.'}</div>}
      <div className="stack" style={{ gap: 10 }}>
        <textarea
          className="input"
          rows={4}
          maxLength={5000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder ?? 'Write a message…'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
          }}
        />
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void send()}>{busy ? <span className="spinner" /> : side === 'admin' ? 'Send reply' : 'Send'}</button>
          {side === 'admin' && <button className="btn" disabled={busy || !text.trim()} onClick={() => void send(true)}>Reply &amp; close</button>}
          {extraActions}
          <small className="dim" style={{ alignSelf: 'center' }}>Ctrl/⌘ + Enter to send</small>
        </div>
      </div>
    </div>
  );
}
