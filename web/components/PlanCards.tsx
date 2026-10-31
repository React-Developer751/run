import type { Plan, PlanId } from '@/lib/types';

export const memoryLabel = (m: string) => m.replace(/m$/i, ' MB').replace(/g$/i, ' GB');

function features(p: Plan): string[] {
  return [
    `${p.webServices} Web Services (Node / Express APIs)`,
    `${p.staticSites} Static Sites (React / Vite)`,
    `${memoryLabel(p.memory)} RAM · ${p.cpus} CPU per app`,
    'Works with MongoDB Atlas (free tier)',
    `${p.customDomains} custom domain${p.customDomains === 1 ? '' : 's'} with free SSL`,
    p.pauseAfterDays === null ? 'Always on — never paused' : `Static sites always on; web services paused after ${p.pauseAfterDays} days with no visits (one-click resume)`,
    `Rollback to the last ${p.rollbackImages} version${p.rollbackImages === 1 ? '' : 's'}`,
    'Auto-deploy from GitHub, private repos',
    'Free HTTPS subdomain',
  ];
}

/**
 * Plan comparison. `current` highlights the user's plan; `action` renders the button of each card
 * (pricing page: sign-up link, billing page: upgrade/switch button).
 */
export function PlanCards({ plans, current, action }: { plans: Plan[]; current?: PlanId; action: (plan: Plan) => React.ReactNode }) {
  return (
    <div className="plan-grid">
      {plans.map((p) => (
        <div key={p.id} className={`card stack plan-card ${p.id === 'starter' ? 'plan-featured' : ''} ${current === p.id ? 'plan-current' : ''}`}>
          <div>
            <h3 style={{ fontSize: 20 }}>{p.name}</h3>
            <div className="plan-price">
              {p.priceInr === 0 ? 'Free' : <>₹{p.priceInr.toLocaleString('en-IN')}<small>/month</small></>}
            </div>
          </div>
          <ul className="plan-features">
            {features(p).map((f) => <li key={f}>{f}</li>)}
          </ul>
          <div style={{ marginTop: 'auto' }}>{action(p)}</div>
        </div>
      ))}
    </div>
  );
}
