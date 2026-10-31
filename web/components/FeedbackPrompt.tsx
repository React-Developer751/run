'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Feedback, Rating } from '@/lib/types';
import { useSiteName } from './BrandProvider';

const LATER_KEY = (projectId: string) => `hostx:feedback-later:${projectId}`;
const LATER_MS = 7 * 24 * 60 * 60 * 1000;
const LABELS = ['', 'Poor', 'Could be better', 'Good', 'Great', 'Excellent'];

export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="stars" aria-label={`${value} out of 5 stars`} style={{ fontSize: size }}>
      {[1, 2, 3, 4, 5].map((n) => <span key={n} className={n <= value ? 'on' : ''} aria-hidden>★</span>)}
    </span>
  );
}

/**
 * Asks for a rating once the project is live. Shown until the user answers or picks "Later" (asked again after a week).
 * Sending again updates the same entry.
 */
export function FeedbackPrompt({ projectId, projectName }: { projectId: string; projectName: string }) {
  const siteName = useSiteName();
  const [existing, setExisting] = useState<Feedback | null | undefined>(undefined);
  const [hidden, setHidden] = useState(true);
  const [rating, setRating] = useState<Rating | 0>(0);
  const [hover, setHover] = useState(0);
  const [message, setMessage] = useState('');
  const [allowPublic, setAllowPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let later = 0;
    try {
      later = Number(window.localStorage.getItem(LATER_KEY(projectId)) ?? 0);
    } catch {
      /* storage blocked: just ask */
    }
    setHidden(Date.now() - later < LATER_MS);
    api.feedback
      .mine()
      .then((r) => setExisting(r.feedback.find((f) => f.projectId === projectId) ?? null))
      .catch(() => setExisting(null));
  }, [projectId]);

  if (existing === undefined || (existing && !sent) || (hidden && !sent)) return null;

  const later = () => {
    try {
      window.localStorage.setItem(LATER_KEY(projectId), String(Date.now()));
    } catch {
      /* ignore */
    }
    setHidden(true);
  };

  if (sent) {
    return (
      <div className="card feedback-card" role="status">
        <b>Thank you for the feedback!</b>
        <p className="muted">It goes straight to the {siteName} team. Need help with something specific? Use <a href="/support">Support</a> and we will reply there.</p>
      </div>
    );
  }

  const submit = async () => {
    if (!rating) return;
    setBusy(true);
    setError('');
    try {
      await api.feedback.send({ rating, message: message.trim(), allowPublic, projectId });
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const shown = hover || rating;
  return (
    <div className="card feedback-card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <b>{projectName} is live 🎉 How was deploying it on {siteName}?</b>
          <p className="muted" style={{ marginTop: 4, fontSize: 14 }}>Takes 10 seconds and helps us improve.</p>
        </div>
        <button type="button" className="btn btn-sm" onClick={later}>Later</button>
      </div>
      <div className="rate-row" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`rate-star ${n <= shown ? 'on' : ''}`}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            aria-pressed={rating === n}
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(0)}
            onClick={() => setRating(n as Rating)}
          >
            ★
          </button>
        ))}
        {shown > 0 && <span className="muted" style={{ fontSize: 14 }}>{LABELS[shown]}</span>}
      </div>
      {rating > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          <textarea
            className="input"
            rows={3}
            maxLength={1000}
            placeholder={rating >= 4 ? 'What did you like? (optional)' : 'What should we fix? (optional)'}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <label className="check">
            <input type="checkbox" checked={allowPublic} onChange={(e) => setAllowPublic(e.target.checked)} />
            <span><b>{siteName} may show this on its website</b><small>With your first name and last initial only. Never your email or project.</small></span>
          </label>
          {error && <div className="error-box">{error}</div>}
          <div><button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? <span className="spinner" /> : 'Send feedback'}</button></div>
        </div>
      )}
    </div>
  );
}
