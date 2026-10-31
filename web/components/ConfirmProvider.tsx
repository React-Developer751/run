'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red styling for destructive actions (delete, sign out everywhere, reject...). */
  danger?: boolean;
}

type Ask = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask>(async () => false);

/**
 * Confirmation as a toast in the site's theme (same place and motion as the other toasts), instead of the browser's
 * plain confirm(). `const confirm = useConfirm(); if (await confirm({ title: 'Delete app?', danger: true })) ...`
 * Esc or a click outside cancels; the page behind is dimmed so the choice cannot be missed.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  const ask = useCallback<Ask>((options) => {
    resolver.current?.(false);
    setOpen(options);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpen(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    // Destructive: focus the safe choice. Otherwise the confirm button, so Enter confirms.
    (open.danger ? cancelButton : confirmButton).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, finish]);

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {open && (
        <div className="confirm-layer" onMouseDown={(e) => e.target === e.currentTarget && finish(false)}>
          <div className={`confirm-toast ${open.danger ? 'danger' : ''}`} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby={open.message ? 'confirm-message' : undefined}>
            <span className="confirm-icon" aria-hidden="true"><Icon name={open.danger ? 'shield' : 'bell'} /></span>
            <div className="confirm-body">
              <b id="confirm-title">{open.title}</b>
              {open.message && <div id="confirm-message" className="confirm-message">{open.message}</div>}
              <div className="confirm-actions">
                <button ref={cancelButton} type="button" className="btn btn-sm" onClick={() => finish(false)}>{open.cancelLabel ?? 'Cancel'}</button>
                <button ref={confirmButton} type="button" className={`btn btn-sm ${open.danger ? 'btn-danger-solid' : 'btn-primary'}`} onClick={() => finish(true)}>
                  {open.confirmLabel ?? 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
