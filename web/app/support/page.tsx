'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { Nav } from '@/components/Nav';
import { CATEGORY_LABEL, SupportThread, TicketStatusBadge } from '@/components/SupportThread';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { timeAgo } from '@/lib/format';
import { usePoll } from '@/lib/hooks';
import type { Project, Ticket, TicketCategory } from '@/lib/types';
import { useSiteName } from '@/components/BrandProvider';

const CATEGORIES = Object.keys(CATEGORY_LABEL) as TicketCategory[];

/** ?id=<ticket> opens that request (links from emails), ?new=1 the form. */
function readUrl(): { id: string | null; isNew: boolean } {
  const q = new URLSearchParams(window.location.search);
  return { id: q.get('id'), isNew: q.get('new') === '1' };
}

function NewRequest({ projects, onCreated, onCancel }: { projects: Project[]; onCreated: (t: Ticket) => void; onCancel?: () => void }) {
  const siteName = useSiteName();
  const [category, setCategory] = useState<TicketCategory>('deploy');
  const [projectId, setProjectId] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.support.open({ subject: subject.trim(), category, message: message.trim(), projectId: projectId || null });
      onCreated(r.ticket);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <div>
        <h2 style={{ fontSize: 18 }}>Contact support</h2>
        <p className="muted" style={{ marginTop: 6, fontSize: 14 }}>
          Report a problem, a complaint or a question. The {siteName} team gets it right away and replies here (you also get an email).
        </p>
      </div>
      <div className="grid-form">
        <div className="field">
          <label className="label" htmlFor="sp-cat">Category</label>
          <select id="sp-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="sp-proj">Project (optional)</label>
          <select id="sp-proj" className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Not about a specific project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      {category === 'emergency' && (
        <div className="notice-box">
          Emergency requests alert every administrator immediately. Use it when your live app is down or data is at risk.
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="sp-subj">Subject</label>
        <input id="sp-subj" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} minLength={4} maxLength={120} required placeholder="e.g. Deploy fails at npm install since this morning" />
      </div>
      <div className="field">
        <label className="label" htmlFor="sp-msg">What happened?</label>
        <textarea id="sp-msg" className="input" rows={6} value={message} onChange={(e) => setMessage(e.target.value)} minLength={10} maxLength={5000} required placeholder="What you did, what you expected, what happened instead. Error messages from the build log help a lot. Never paste passwords or secret keys." />
      </div>
      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>{busy ? <span className="spinner" /> : 'Send request'}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
    </form>
  );
}

export default function SupportPage() {
  const siteName = useSiteName();
  const user = useRequireAuth();
  const { data, error, reload } = usePoll(() => api.support.tickets(), 20_000, Boolean(user));
  const [projects, setProjects] = useState<Project[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [threadError, setThreadError] = useState('');

  useEffect(() => {
    const { id, isNew } = readUrl();
    setOpenId(id);
    setCreating(isNew);
  }, []);

  useEffect(() => {
    if (user) api.projects().then((r) => setProjects(r.projects)).catch(() => undefined);
  }, [user]);

  const go = (id: string | null, isNew = false) => {
    setOpenId(id);
    setCreating(isNew);
    setThreadError('');
    window.history.replaceState(null, '', id ? `/support?id=${id}` : isNew ? '/support?new=1' : '/support');
  };

  const loadTicket = useCallback(async (id: string) => {
    try {
      const r = await api.support.ticket(id);
      setTicket(r.ticket);
      setThreadError('');
    } catch (e) {
      setThreadError((e as Error).message);
    }
  }, []);

  // Open request: refresh it every 15 s so an admin reply shows up without reloading.
  useEffect(() => {
    if (!openId || !user) {
      setTicket(null);
      return;
    }
    void loadTicket(openId).then(() => reload());
    const t = setInterval(() => void loadTicket(openId), 15_000);
    return () => clearInterval(t);
  }, [openId, user, loadTicket, reload]);

  if (!user) return <><Nav variant="app" /><div className="center-screen"><span className="spinner" /></div></>;

  const tickets = data?.tickets ?? [];
  const showForm = creating || (data !== null && data !== undefined && tickets.length === 0 && !openId);

  return (
    <>
      <Nav variant="app" />
      <main className="container page">
        <div className="page-head">
          <div>
            <h1>Support</h1>
            <p>Problems, complaints or questions: talk to the {siteName} team. Replies show up here.</p>
          </div>
          {!showForm && <button className="btn btn-primary" onClick={() => go(null, true)}><Icon name="plus" /> New request</button>}
        </div>
        {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}

        <div className="support-layout">
          <aside className="card support-list" aria-label="Your requests">
            <div className="support-list-head">Your requests</div>
            {tickets.map((t) => (
              <button key={t.id} type="button" className={`support-item ${openId === t.id ? 'on' : ''}`} onClick={() => go(t.id)}>
                <span className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <b className="ellipsis">{t.unread && <span className="unread-dot" aria-label="New reply" />}{t.subject}</b>
                  <small className="dim">{timeAgo(t.updatedAt)}</small>
                </span>
                <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <TicketStatusBadge status={t.status} />
                  {t.category === 'emergency' && <span className="badge badge-bad">Emergency</span>}
                </span>
                {t.lastMessage && <small className="dim ellipsis">{t.lastMessage.from === 'admin' ? 'Support: ' : 'You: '}{t.lastMessage.preview}</small>}
              </button>
            ))}
            {data && tickets.length === 0 && <p className="muted" style={{ padding: 16, fontSize: 14 }}>No requests yet.</p>}
          </aside>

          <section className="support-main">
            {showForm ? (
              <NewRequest
                projects={projects}
                onCancel={tickets.length ? () => go(null) : undefined}
                onCreated={(t) => {
                  setTicket(t);
                  go(t.id);
                  void reload();
                }}
              />
            ) : openId ? (
              <div className="card stack">
                {threadError && <div className="error-box">{threadError}</div>}
                {ticket && ticket.id === openId ? (
                  <>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                      <div>
                        <h2 style={{ fontSize: 19 }}>{ticket.subject}</h2>
                        <p className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>
                          {CATEGORY_LABEL[ticket.category]}{ticket.projectName ? ` · ${ticket.projectName}` : ''} · opened {timeAgo(ticket.createdAt)}
                        </p>
                      </div>
                      <TicketStatusBadge status={ticket.status} />
                    </div>
                    <SupportThread
                      thread={ticket.thread}
                      side="user"
                      closed={ticket.status === 'closed'}
                      placeholder="Add details or answer the support team…"
                      onSend={async (text) => {
                        try {
                          const r = await api.support.reply(ticket.id, text);
                          setTicket(r.ticket);
                          void reload();
                          return true;
                        } catch (e) {
                          setThreadError((e as Error).message);
                          return false;
                        }
                      }}
                      extraActions={
                        ticket.status !== 'closed' ? (
                          <button
                            className="btn"
                            onClick={async () => {
                              try {
                                setTicket((await api.support.close(ticket.id)).ticket);
                                void reload();
                              } catch (e) {
                                setThreadError((e as Error).message);
                              }
                            }}
                          >
                            Mark as solved
                          </button>
                        ) : null
                      }
                    />
                  </>
                ) : (
                  !threadError && <div className="center-screen" style={{ minHeight: 200 }}><span className="spinner" /></div>
                )}
              </div>
            ) : (
              <div className="card empty" style={{ margin: 0 }}>
                <Icon name="message" className="icon" />
                <h3>Pick a request</h3>
                <p>Open one on the left to read replies, or start a new one.</p>
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
