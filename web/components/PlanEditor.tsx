'use client';

import { useEffect, useState } from 'react';
import type { AdminPlan, EditablePlan, PlanId, SettingsPatch } from '@/lib/types';
import { useConfirm } from './ConfirmProvider';

type Form = Record<keyof EditablePlan, string>;

const toForm = (p: EditablePlan): Form => ({
  name: p.name,
  priceInr: String(p.priceInr),
  webServices: String(p.webServices),
  staticSites: String(p.staticSites),
  customDomains: String(p.customDomains),
  memory: p.memory,
  cpus: p.cpus,
  pauseAfterDays: p.pauseAfterDays === null ? '' : String(p.pauseAfterDays),
  archiveAfterDays: p.archiveAfterDays === null ? '' : String(p.archiveAfterDays),
  rollbackImages: String(p.rollbackImages),
  razorpayPlanId: p.razorpayPlanId,
});

/** Only the fields that differ from the plan as saved, converted back to their types. */
function changes(form: Form, plan: AdminPlan): Partial<EditablePlan> {
  const out: Record<string, unknown> = {};
  const current = toForm(plan);
  for (const key of Object.keys(form) as Array<keyof Form>) {
    if (form[key].trim() === current[key]) continue;
    const v = form[key].trim();
    if (key === 'name' || key === 'memory' || key === 'cpus' || key === 'razorpayPlanId') out[key] = v;
    else if (key === 'pauseAfterDays' || key === 'archiveAfterDays') out[key] = v === '' ? null : Number(v);
    else out[key] = Number(v);
  }
  return out as Partial<EditablePlan>;
}

const FIELDS: Array<{ key: keyof EditablePlan; label: string; hint?: string; free?: boolean }> = [
  { key: 'name', label: 'Name' },
  { key: 'priceInr', label: 'Price shown (₹ / month)', hint: 'Display only: Razorpay charges what its plan says.' },
  { key: 'webServices', label: 'Web Services' },
  { key: 'staticSites', label: 'Static Sites' },
  { key: 'customDomains', label: 'Custom domains (total)' },
  { key: 'memory', label: 'RAM per app', hint: 'e.g. 512m or 1g. Running apps are resized right away.' },
  { key: 'cpus', label: 'CPU per app', hint: 'e.g. 0.5 or 1' },
  { key: 'pauseAfterDays', label: 'Pause after (days without visits)', hint: 'Empty = never pause.' },
  { key: 'archiveAfterDays', label: 'Archive after (days without visits)', hint: 'Empty = never archive. At least 8 days after pause.' },
  { key: 'rollbackImages', label: 'Rollback versions kept' },
  { key: 'razorpayPlanId', label: 'Razorpay plan id', hint: 'To change the real price: create a new plan in Razorpay, paste its id here.' },
];

/** Admin → Settings: edit the limits and prices of every plan without touching the server. */
export function PlanEditor({ plans, busy, onSave }: { plans: AdminPlan[]; busy: boolean; onSave: (patch: SettingsPatch, done: string) => Promise<boolean> }) {
  const confirm = useConfirm();
  const [active, setActive] = useState<PlanId>('free');
  const plan = plans.find((p) => p.id === active) ?? plans[0];
  const [form, setForm] = useState<Form | null>(null);
  // Reset the form only when another plan is picked or the saved values change, not on every settings reload.
  const savedKey = plan ? `${plan.id}:${JSON.stringify(toForm(plan))}` : '';

  useEffect(() => {
    if (plan) setForm(toForm(plan));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  if (!plan || !form) return null;
  const diff = changes(form, plan);
  const dirty = Object.keys(diff).length > 0;
  const invalid = FIELDS.find((f) => !f.key.endsWith('Days') && f.key !== 'razorpayPlanId' && !(plan.id === 'free' && f.key === 'priceInr') && form[f.key].trim() === '');
  const pick = async (id: PlanId) => {
    if (id === active) return;
    if (dirty && !(await confirm({ title: 'Discard unsaved changes?', message: `Your changes to ${plan.name} are not saved yet.`, confirmLabel: 'Discard', danger: true }))) return;
    setActive(id);
  };
  const lowered = (['webServices', 'staticSites', 'customDomains'] as const).some((k) => diff[k] !== undefined && Number(diff[k]) < plan[k]);

  return (
    <div className="card stack">
      <div>
        <h3 className="card-title">Plans &amp; limits</h3>
        <p className="muted" style={{ marginTop: 6, fontSize: 14 }}>
          Applies immediately to everyone on the plan, the Pricing page and the Billing page. Lowering a limit never deletes anything: users above it
          just cannot create more. Admins are never limited.
        </p>
      </div>

      <div className="seg-filter" role="tablist" aria-label="Plan">
        {plans.map((p) => (
          <button key={p.id} type="button" role="tab" aria-selected={p.id === active} className={p.id === active ? 'on' : ''} onClick={() => pick(p.id)}>
            {p.name} <small style={{ opacity: 0.7 }}>({p.users})</small>
          </button>
        ))}
      </div>

      <div className="plan-form">
        {FIELDS.filter((f) => !(plan.id === 'free' && (f.key === 'razorpayPlanId' || f.key === 'priceInr'))).map((f) => {
          const changed = plan.customized.includes(f.key);
          return (
            <div className="field" key={f.key}>
              <label className="label" htmlFor={`plan-${f.key}`}>
                {f.label} {changed && <span className="badge badge-busy" title={`Default: ${String(plan.defaults[f.key] ?? '—')}`}>changed</span>}
              </label>
              <input
                id={`plan-${f.key}`}
                className="input input-sm mono"
                value={form[f.key]}
                inputMode={['name', 'memory', 'razorpayPlanId', 'cpus'].includes(f.key) ? 'text' : 'numeric'}
                placeholder={f.key.endsWith('Days') ? 'never' : ''}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                spellCheck={false}
              />
              {f.hint && <span className="hint">{f.hint}</span>}
            </div>
          );
        })}
      </div>

      {invalid && <div className="error-box">{invalid.label} cannot be empty.</div>}
      {lowered && <div className="notice-box">You are lowering a limit. {plan.users} user{plan.users === 1 ? '' : 's'} on {plan.name} keep what they already have but cannot add more until they are below it.</div>}

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          disabled={busy || !dirty || Boolean(invalid)}
          onClick={() => void onSave({ plans: { [plan.id]: diff } }, `${plan.name} plan saved`)}
        >
          Save {plan.name}
        </button>
        <button className="btn" disabled={busy || !dirty} onClick={() => setForm(toForm(plan))}>Undo changes</button>
        {plan.customized.length > 0 && (
          <button
            className="btn"
            disabled={busy}
            onClick={async () => (await confirm({ title: `Reset ${plan.name} to the defaults?`, message: 'Every value you changed for this plan goes back to the server defaults. Running apps are resized if RAM/CPU change.', confirmLabel: 'Reset plan', danger: true })) && void onSave({ resetPlan: plan.id }, `${plan.name} reset to defaults`)}
          >
            Reset to defaults
          </button>
        )}
      </div>
    </div>
  );
}
