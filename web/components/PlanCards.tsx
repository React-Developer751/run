import type { Plan, PlanId } from '@/lib/types';

const memoryLabel = (m: string) => m.replace(/m$/i, ' MB').replace(/g$/i, ' GB');

function features(p: Plan): string[] {
  return [
    `${p.projects} project${p.projects === 1 ? '' : 's'} (sites + services)`,
    `${memoryLabel(p.memory)} RAM · ${p.cpus} CPU per app`,
    `${p.databases} MongoDB database${p.databases === 1 ? '' : 's'} · ${p.databaseMb >= 1024 ? `${p.databaseMb / 1024} GB` : `${p.databaseMb} MB`} each`,
    `${p.customDomains} custom domain${p.customDomains === 1 ? '' : 's'} with free SSL`,
    'Always on — apps never sleep',
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
