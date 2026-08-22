import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Lock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Where the emailed reset link lands.
 *
 * Supabase puts a recovery session in the URL fragment and the SDK picks it up
 * automatically, so by the time this renders the user is already authenticated
 * for the single purpose of changing their password. There is nothing to type
 * but the new password itself — asking for the old one here would be
 * impossible, since not knowing it is why they are on this page.
 */
export default function ResetPasswordPage() {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { sb, isSupabaseConfigured } = await import('@/lib/supabase');
        if (!isSupabaseConfigured()) { setReady(false); return; }
        const { data } = await sb().auth.getSession();
        // No session means the link was already used, has expired, or was
        // opened in a different browser than the one that requested it.
        setReady(!!data.session);
      } catch { setReady(false); }
    })();
  }, []);

  const submit = async () => {
    if (pw.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    if (pw !== confirm) { toast.error('The two passwords do not match'); return; }
    setBusy(true);
    try {
      const { completePasswordReset } = await import('@/lib/authProvider');
      await completePasswordReset(pw);
      setDone(true);
      toast.success('Password changed. You can sign in with it now.');
    } catch (e: any) {
      toast.error(e?.message || 'Could not change the password');
    } finally {
      setBusy(false);
    }
  };

  const goToLogin = () => { window.location.hash = '#/'; window.location.reload(); };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <Card className="w-full max-w-md p-8 bg-white/5 border-white/10 backdrop-blur">
        {done ? (
          <div className="text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto" />
            <h1 className="text-xl font-bold text-white">Password changed</h1>
            <p className="text-sm text-white/70">
              Sign in with your new password.
            </p>
            <Button onClick={goToLogin} className="w-full h-11">Go to sign in</Button>
          </div>
        ) : ready === false ? (
          <div className="text-center space-y-4">
            <AlertTriangle className="h-12 w-12 text-amber-400 mx-auto" />
            <h1 className="text-xl font-bold text-white">This link is no longer valid</h1>
            <p className="text-sm text-white/70">
              Reset links expire and can only be used once, and they must be
              opened in the same browser that requested them. Request a fresh
              one from the sign-in screen.
            </p>
            <Button onClick={goToLogin} variant="outline" className="w-full h-11">
              Back to sign in
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="text-center">
              <h1 className="text-xl font-bold text-white">Set a new password</h1>
              <p className="text-xs text-white/60 mt-1">At least 6 characters.</p>
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-widest text-white/70 font-bold mb-1.5 block">
                New password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60" />
                <Input
                  type="password"
                  value={pw}
                  onChange={e => setPw(e.target.value)}
                  placeholder="New password"
                  className="pl-9 h-12 bg-white/5 border-white/15 text-white placeholder:text-white/40"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-widest text-white/70 font-bold mb-1.5 block">
                Confirm password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60" />
                <Input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat the password"
                  className="pl-9 h-12 bg-white/5 border-white/15 text-white placeholder:text-white/40"
                  onKeyDown={e => e.key === 'Enter' && submit()}
                />
              </div>
            </div>

            <Button onClick={submit} disabled={busy} className="w-full h-12 font-bold">
              {busy ? 'Saving…' : 'Change password'}
            </Button>

            <button
              type="button"
              onClick={goToLogin}
              className="w-full text-xs text-white/60 hover:text-white/90"
            >
              Cancel and go back
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
