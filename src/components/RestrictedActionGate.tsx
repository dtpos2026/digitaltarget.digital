// ============================================================
// useRestrictedAction — one-liner guard for money-touching actions.
//
//   const { guard, dialog } = useRestrictedAction();
//   <Button onClick={() => guard('payment', { orderId, orderNumber, tableLabel }, run)} />
//   ...  {dialog}
//
// Allowed roles run instantly (still audited). Order Takers / Riders get
// a Manager PIN prompt; the approving manager's name lands in the log.
// ============================================================
import { useCallback, useRef, useState, type ReactElement } from 'react';
import ManagerAuthDialog from '@/components/ManagerAuthDialog';
import { toast } from 'sonner';
import { canRunDirectly, GUARDED_ACTION_TITLES, GUARDED_AUDIT, type GuardedAction } from '@/lib/actionGuard';
import { logStaffAction } from '@/lib/staffAudit';

export interface GuardContext {
  orderId?: string;
  orderNumber?: number;
  tableLabel?: string;
  amount?: number;
  reason?: string;
  meta?: Record<string, unknown>;
}

export function useRestrictedAction() {
  const [pending, setPending] = useState<{ action: GuardedAction; ctx: GuardContext } | null>(null);
  const runRef = useRef<((approvedBy?: string) => void) | null>(null);

  const guard = useCallback((action: GuardedAction, ctx: GuardContext, run: () => void) => {
    if (canRunDirectly(action)) {
      logStaffAction(GUARDED_AUDIT[action], { ...ctx });
      run();
      return;
    }
    logStaffAction('RESTRICTED_BLOCKED', { ...ctx, reason: `${GUARDED_ACTION_TITLES[action]} needs manager approval` });
    runRef.current = (approvedBy?: string) => {
      logStaffAction(GUARDED_AUDIT[action], { ...ctx, approvedBy });
      run();
    };
    setPending({ action, ctx });
  }, []);

  const dialog: ReactElement = (
    <ManagerAuthDialog
      open={!!pending}
      reason={pending
        ? `"${GUARDED_ACTION_TITLES[pending.action]}" is restricted for your role. A Manager PIN / password is required.`
        : undefined}
      onAuthorized={(byName) => {
        const act = pending?.action;
        const ctx = pending?.ctx || {};
        setPending(null);
        logStaffAction('MANAGER_APPROVAL', { ...ctx, approvedBy: byName, reason: act ? GUARDED_ACTION_TITLES[act] : undefined });
        const fn = runRef.current;
        runRef.current = null;
        fn?.(byName);
        toast.success(`Approved by ${byName}`);
      }}
      onCancel={() => { runRef.current = null; setPending(null); }}
    />
  );

  return { guard, dialog };
}
