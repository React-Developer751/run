'use client';

import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import type { Plan, UpiDetails } from '@/lib/types';
import { useSiteName } from './BrandProvider';
import { Icon } from './Icon';
import { Modal } from './Modal';

/** upi://pay link understood by every UPI app (GPay, PhonePe, Paytm, BHIM): payee, exact amount, a note to match it. */
function upiLink(upi: UpiDetails, amount: number, note: string): string {
  // encodeURIComponent (spaces as %20): some UPI apps show a "+" from form-style encoding literally.
  const params: Array<[string, string]> = [['pa', upi.vpa], ['pn', upi.payeeName], ['am', amount.toFixed(2)], ['cu', 'INR'], ['tn', note.slice(0, 50)]];
  return `upi://pay?${params.map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%40/g, '@')}`).join('&')}`;
}

/**
 * Direct UPI payment: scan the QR (or open the UPI app on a phone), pay the exact amount, then type the 12-digit UTR.
 * An admin checks the bank statement and activates the plan; the user is emailed either way.
 */
export function UpiPayModal({ plan, upi, periodDays, reference, onClose, onDone }: { plan: Plan; upi: UpiDetails; periodDays: number; reference: string; onClose: () => void; onDone: () => void }) {
  const siteName = useSiteName();
  const note = `${siteName} ${plan.name} ${reference}`;
  const link = upiLink(upi, plan.priceInr, note);
  const [qr, setQr] = useState('');
  const [utr, setUtr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 240, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''));
  }, [link]);

  const clean = utr.replace(/\s+/g, '');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.billing.payByUpi(plan.id, clean);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={`Pay ₹${plan.priceInr.toLocaleString('en-IN')} by UPI`} onClose={onClose}>
      <div className="stack">
        <ol className="upi-steps">
          <li>Scan the QR with any UPI app (GPay, PhonePe, Paytm, BHIM) and pay <b>exactly ₹{plan.priceInr.toLocaleString('en-IN')}</b>.</li>
          <li>Copy the 12-digit <b>UPI reference number (UTR)</b> from the payment receipt.</li>
          <li>Enter it below. We verify it and activate <b>{plan.name}</b> for {periodDays} days, usually within a few hours.</li>
        </ol>
        <div className="upi-pay">
          {qr ? <img src={qr} alt={`UPI QR code: pay ₹${plan.priceInr} to ${upi.vpa}`} width={200} height={200} /> : <div className="upi-qr-empty"><span className="spinner" /></div>}
          <div className="stack" style={{ gap: 8 }}>
            <div><small className="dim">Pay to</small><div><b>{upi.payeeName}</b></div></div>
            <div>
              <small className="dim">UPI ID</small>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="mono">{upi.vpa}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Copy UPI ID"
                  onClick={() => {
                    void navigator.clipboard?.writeText(upi.vpa);
                    setCopied(true);
                  }}
                >
                  <Icon name={copied ? 'check' : 'copy'} />
                </button>
              </div>
            </div>
            <div><small className="dim">Amount</small><div><b>₹{plan.priceInr.toLocaleString('en-IN')}</b></div></div>
            <a className="btn btn-sm upi-app-btn" href={link}>Open UPI app</a>
          </div>
        </div>
        {upi.note && <div className="notice-box">{upi.note}</div>}
        <form className="stack" onSubmit={submit}>
          <div className="field">
            <label className="label" htmlFor="upi-utr">UPI reference number (UTR)</label>
            <input
              id="upi-utr"
              className="input mono"
              inputMode="numeric"
              autoComplete="off"
              placeholder="12 digits, e.g. 412345678901"
              value={utr}
              onChange={(e) => setUtr(e.target.value.replace(/[^\d\s]/g, '').slice(0, 15))}
              required
            />
            <span className="hint">Only after paying. A wrong or reused number is rejected after verification.</span>
          </div>
          {error && <div className="error-box" role="alert">{error}</div>}
          <div className="row">
            <button className="btn btn-primary" disabled={busy || !/^\d{12}$/.test(clean)}>{busy ? <span className="spinner" /> : 'I have paid, submit UTR'}</button>
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
