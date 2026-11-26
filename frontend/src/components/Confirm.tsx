import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (e.g. skip/give up). */
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * In-app confirmation dialog styled like the rest of the app (no blocking window.confirm/alert).
 * Usage: const confirm = useConfirm(); if (await confirm({ title, message })) { ... }
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback<ConfirmFn>((opts) => {
    // If one is already open, resolve it as cancelled before opening the new one.
    resolver.current?.(false);
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  useEffect(() => {
    if (!options) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(false);
      else if (e.key === 'Enter') settle(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [options, settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <div className="modal-overlay" onClick={() => settle(false)}>
          <div
            className="modal-panel"
            role="alertdialog"
            aria-modal="true"
            aria-label={options.title}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="modal-title">{options.title}</h3>
            <p className="modal-message">{options.message}</p>
            <div className="modal-actions">
              <button className={options.danger ? 'primary danger' : 'primary'} onClick={() => settle(true)} autoFocus>
                {options.confirmLabel ?? 'OK'}
              </button>
              <button className="link" onClick={() => settle(false)}>
                {options.cancelLabel ?? 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
}
