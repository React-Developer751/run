'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CATEGORY_LABEL, SupportThread, TicketStatusBadge } from '@/components/SupportThread';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { usePoll, useToast } from '@/lib/hooks';
import type { AdminTicket, TicketStatus } from '@/lib/types';
import { useSiteName } from '@/components/BrandProvider';
import { useConfirm } from '@/components/ConfirmProvider';

type Filter = 'active' | TicketStatus | 'emergency' | 'all';
const FILTERS: Array<[Filter, string]> = [['active', 'Needs reply'], ['answered', 'Answered'], ['closed', 'Closed'], ['emergency', 'Emergency'], ['all', 'All']];

export default function AdminSupport() {
  const confirm = useConfirm();
  const siteName = useSiteName();
  const { data, error, reload } = usePoll(() => api.admin.tickets(), 15_000);
  const [filter, setFilter] = useState<Filter>('active');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [ticket, setTicket] = useState<AdminTicket | null>(null);
  const [threadError, setThreadError] = useState('');
  const { toast, flash } = useToast();

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (id) {
      setOpenId(id);
      setFilter('all');
    }
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.tickets ?? [])
      .filter((t) =>
        filter === 'all' ? true : filter === 'active' ? t.status === 'open' : filter === 'emergency' ? t.category === 'emergency' && t.status !== 'closed' : t.status === filter,
      )
      .filter((t) => !q || `${t.subject} ${t.userEmail} ${t.userName} ${t.projectName ?? ''}`.toLowerCase().includes(q))
      // Emergencies first among requests that still need a reply.
      .sort((a, b) => Number(b.category === 'emergency' && b.status === 'open') - Number(a.category === 'emergency' && a.status === 'open') || b.updatedAt.localeCompare(a.updatedAt));
  }, [data, filter, query]);

  const load = useCallback(async (id: string) => {
    try {
      setTicket((await api.admin.ticket(id)).ticket);
      setThreadError('');
    } catch (e) {
      setThreadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!openId) {
      setTicket(null);
      return;
    }
    void load(openId).then(() => {
      void reload();
      window.dispatchEvent(new Event('hostx:admin-notifications'));
    });
    const t = setInterval(() => void load(openId), 15_000);
    return () => clearInterval(t);
  }, [openId, load, reload]);

  const open = (id: string) => {
    setOpenId(id);
    window.history.replaceState(null, '', `/admin/support?id=${id}`);
  };

  const setStatus = async (status: 'open' | 'closed') => {
    if (!ticket) return;
    try {
      await api.admin.setTicketStatus(ticket.id, status);
      await load(ticket.id);
      await reload();
      flash(status === 'closed' ? 'Request closed' : 'Request reopened');
    } catch (e) {
      flash((e as Error).message);
    }
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>Support</h1>
          <p>Requests and complaints from users. Your reply appears in the user&apos;s Support page and they get an email. Replies are signed “{siteName} Support”.</p>
        </div>
      </div>
      {error && <div className="error-box">{error}</div>}

      <div className="list-toolbar" style={{ marginBottom: 0 }}>
        <div className="seg-filter" role="tablist" aria-label="Filter requests">
          {FILTERS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={filter === id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
              {label}
              {id === 'active' && data?.open ? <span className="seg-count">{data.open}</span> : null}
            </button>
          ))}
        </div>
        <input className="input input-sm" type="search" placeholder="Search subject or email" aria-label="Search requests" value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 260 }} />
      </div>

      <div className="support-layout">
        <aside className="card support-list" aria-label="Requests">
          {rows.map((t) => (
            <button key={t.id} type="button" className={`support-item ${openId === t.id ? 'on' : ''}`} onClick={() => open(t.id)}>
              <span className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <b className="ellipsis">{t.unread && <span className="unread-dot" aria-label="Unread" />}{t.subject}</b>
                <small className="dim">{timeAgo(t.updatedAt)}</small>
              </span>
              <small className="dim ellipsis">{t.userName} · {t.userEmail}</small>
              <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <TicketStatusBadge status={t.status} />
                {t.category === 'emergency' && <span className="badge badge-bad">Emergency</span>}
              </span>
            </button>
          ))}
          {data && rows.length === 0 && <p className="muted" style={{ padding: 16, fontSize: 14 }}>Nothing here{filter === 'active' ? ': every request has an answer.' : '.'}</p>}
        </aside>

        <section className="support-main">
          {ticket && ticket.id === openId ? (
            <div className="card stack">
              {threadError && <div className="error-box">{threadError}</div>}
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <h2 style={{ fontSize: 19 }}>{ticket.subject}</h2>
                  <p className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>
                    {CATEGORY_LABEL[ticket.category]} · opened {timeAgo(ticket.createdAt)}
                  </p>
                  <p style={{ fontSize: 13.5, marginTop: 6 }}>
                    <b>{ticket.userName}</b> <span className="dim">{ticket.userEmail}</span>
                    {ticket.userPlan && <span className="tag" style={{ marginLeft: 8 }}>{ticket.userPlan}</span>}
                    {' · '}<Link href={`/admin/users?q=${encodeURIComponent(ticket.userEmail)}`}>User</Link>
                    {ticket.projectName && <>{' · '}<Link href={`/admin/projects?q=${encodeURIComponent(ticket.projectName)}`}>Project: {ticket.projectName}</Link></>}
                  </p>
                </div>
                <TicketStatusBadge status={ticket.status} />
              </div>
              <SupportThread
                thread={ticket.thread}
                side="admin"
                closed={ticket.status === 'closed'}
                placeholder={`Reply to ${ticket.userName.split(' ')[0]}…`}
                onSend={async (text, close) => {
                  try {
                    await api.admin.replyTicket(ticket.id, text, close);
                    await load(ticket.id);
                    await reload();
                    flash(close ? 'Reply sent and request closed' : 'Reply sent');
                    return true;
                  } catch (e) {
                    setThreadError((e as Error).message);
                    return false;
                  }
                }}
                extraActions={
                  ticket.status === 'closed'
                    ? <button className="btn" onClick={() => void setStatus('open')}>Reopen</button>
                    : (
                      <button
                        className="btn"
                        onClick={async () => {
                          if (await confirm({ title: 'Close without replying?', message: 'The request is marked closed; the user is not emailed. They can reopen it by writing again.', confirmLabel: 'Close request' })) void setStatus('closed');
                        }}
                      >
                        Close without reply
                      </button>
                    )
                }
              />
            </div>
          ) : openId && !threadError ? (
            <div className="card center-screen" style={{ minHeight: 200 }}><span className="spinner" /></div>
          ) : (
            <div className="card empty" style={{ margin: 0 }}>
              {threadError ? <div className="error-box">{threadError}</div> : <><h3>Select a request</h3><p>Open a request on the left to read it and reply.</p></>}
            </div>
          )}
        </section>
      </div>
      {toast}
    </div>
  );
}
