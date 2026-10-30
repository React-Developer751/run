'use client';

import { useEffect, useState } from 'react';
import { Stars } from '@/components/FeedbackPrompt';
import { api } from '@/lib/api';
import type { Testimonial } from '@/lib/types';

/**
 * Real feedback that users allowed to be shown and an admin picked in Admin → Feedback.
 * Renders nothing until there is at least one, so the page never shows made-up reviews.
 */
export function Testimonials() {
  const [items, setItems] = useState<Testimonial[]>([]);

  useEffect(() => {
    api.testimonials().then((r) => setItems(r.testimonials)).catch(() => setItems([]));
  }, []);

  if (items.length === 0) return null;
  return (
    <section className="section" id="reviews" style={{ paddingTop: 0 }}>
      <div className="container">
        <div className="section-head">
          <span className="tag">From developers on HostX</span>
          <h2>What people say <span className="serif grad-text">after deploying</span></h2>
          <p>Ratings left in the dashboard right after an app went live, shared with permission.</p>
        </div>
        <div className="quotes">
          {items.map((t) => (
            <figure className="card quote" key={t.id}>
              <Stars value={t.rating} />
              <blockquote>{t.message}</blockquote>
              <figcaption>
                <span className="quote-avatar" aria-hidden>{t.name.charAt(0).toUpperCase()}</span>
                <span>
                  <b>{t.name}</b>
                  {t.kind && <small>Deployed a {t.kind === 'static' ? 'static site' : 'web service'}</small>}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
