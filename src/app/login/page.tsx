'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserSupabase } from '@/adapters/storage/supabase-client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BrandMark, Wordmark } from '@/components/ui/wordmark';

/**
 * `useSearchParams` opts a component out of static prerendering, so the form
 * sits behind a Suspense boundary and the shell around it can still be
 * prerendered. Without this the build fails outright.
 */
export default function LoginPage() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <Card style={{ width: 'min(100%, 380px)' }} bodyPadding="24px">
        {/* The one screen with no sidebar and no top bar, so the only place the
            brand can introduce itself. The lockup is the site's: the mark, then
            the wordmark. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
          <BrandMark />
          <Wordmark height={17} />
        </div>
        <h1 style={{ fontSize: 20 }}>Sign in</h1>
        <Suspense fallback={<p className="text-muted">Loading…</p>}>
          <LoginForm />
        </Suspense>
      </Card>
    </main>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createBrowserSupabase();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }

    // Refresh so the middleware and server components see the new session
    // cookie; a client-side push alone would render as a signed-out user.
    router.replace(params.get('next') || '/');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12, marginTop: 20 }}>
      <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="username"
          style={inputStyle}
        />
      </label>

      <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          style={inputStyle}
        />
      </label>

      {error && (
        <p role="alert" style={{ color: 'var(--destructive)', fontSize: 13, margin: 0 }}>
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={busy} style={{ marginTop: 4 }}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}

const inputStyle = {
  font: 'inherit',
  fontSize: 13,
  padding: '9px 10px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  background: 'var(--background)',
  color: 'var(--foreground)',
} as const;
