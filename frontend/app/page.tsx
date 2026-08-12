'use client';

import { useAuthenticationStatus, useSignInEmailPassword, useSignUpEmailPassword, useUserData } from '@nhost/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function Home() {
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const user = useUserData();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const { signInEmailPassword, isLoading: signingIn, error: signInError } = useSignInEmailPassword();
  const { signUpEmailPassword, isLoading: signingUp, error: signUpError } = useSignUpEmailPassword();
  const router = useRouter();

  if (isLoading) return <p>Loading...</p>;

  const submit = async () => {
    const result = mode === 'signin'
      ? await signInEmailPassword(email, password)
      : await signUpEmailPassword(email, password);
    console.log('AUTH RESULT:', result);
  };

  return (
    <div style={{ maxWidth: 500, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <h1>AI Agent Workflow Builder</h1>
      <div style={{ background: '#eef', padding: 12, marginBottom: 12, fontSize: 13 }}>
        <strong>Debug:</strong><br/>
        isAuthenticated: {String(isAuthenticated)}<br/>
        user: {user ? user.email : 'null'}
      </div>
      <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
      <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
      <button onClick={submit} disabled={signingIn || signingUp}>
        {mode === 'signin' ? 'Sign in' : 'Sign up'}
      </button>
      <button onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')} style={{ marginLeft: 8 }}>
        Switch to {mode === 'signin' ? 'sign up' : 'sign in'}
      </button>
      {(signInError || signUpError) && <p style={{ color: 'red' }}>{signInError?.message || signUpError?.message}</p>}
      {isAuthenticated && (
        <button onClick={() => router.push('/dashboard')} style={{ marginTop: 12, display: 'block' }}>
          Go to dashboard →
        </button>
      )}
    </div>
  );
}