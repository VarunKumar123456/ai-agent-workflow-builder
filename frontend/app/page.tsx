'use client';

import { useState } from 'react';
import { useAuthenticationStatus, useSignInEmailPassword, useSignUpEmailPassword } from '@nhost/react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const { signInEmailPassword, isLoading: signingIn, error: signInError } = useSignInEmailPassword();
  const { signUpEmailPassword, isLoading: signingUp, error: signUpError } = useSignUpEmailPassword();
  const router = useRouter();

  if (isLoading) return <p>Loading…</p>;
  if (isAuthenticated) {
    router.push('/dashboard');
    return null;
  }

  const submit = async () => {
    if (mode === 'signin') await signInEmailPassword(email, password);
    else await signUpEmailPassword(email, password);
    router.push('/dashboard');
  };

  return (
    <div style={{ maxWidth: 360, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <h1>AI Agent Workflow Builder</h1>
      <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
      <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
      <button onClick={submit} disabled={signingIn || signingUp}>
        {mode === 'signin' ? 'Sign in' : 'Sign up'}
      </button>
      <button onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')} style={{ marginLeft: 8 }}>
        Switch to {mode === 'signin' ? 'sign up' : 'sign in'}
      </button>
      {(signInError || signUpError) && <p style={{ color: 'red' }}>{signInError?.message || signUpError?.message}</p>}
      <p style={{ fontSize: 12, color: '#666', marginTop: 16 }}>
        After signing up, an owner needs to add you to an organization via the <code>org_members</code> table.
      </p>
    </div>
  );
}
