'use client';

import { FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Fingerprint, LockKeyhole } from 'lucide-react';

function LoginContent() {
  const params = useSearchParams();
  const nextParam = params.get('next') || '/scan';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/scan';
  const scanId = params.get('scan') || '';
  const [mode, setMode] = useState<'login' | 'register'>(params.get('mode') === 'register' ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = mode === 'register' ? 'register' : 'login';
      const response = await fetch(`${'/api'}/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'La demande n’a pas pu aboutir.');

      if (result.access_token) {
        localStorage.setItem('fingerprintscanner_token', result.access_token);
        localStorage.setItem('fingerprintscanner_user', result.user_id);
        localStorage.setItem('fingerprintscanner_verified_email', email.trim().toLowerCase());
        localStorage.setItem('fingerprintscanner_pending_email', email.trim().toLowerCase());
        window.location.replace(next);
        return;
      }

      if (scanId) localStorage.setItem('fingerprintscanner_pending_scan', scanId);
      localStorage.setItem('fingerprintscanner_pending_email', email.trim().toLowerCase());
      throw new Error('La session n’a pas pu être ouverte. Réessayez.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Une erreur est survenue. Réessayez.');
    } finally {
      setLoading(false);
    }
  }

  return <main className="auth-page">
    <header className="auth-nav"><a href="/" className="brand"><span className="brand-mark"><Fingerprint size={19}/></span><span>fingerprint<span className="brand-light">scanner</span></span></a><a href="/scan" className="text-link"><ArrowLeft size={15}/> Retour au scan</a></header>
    <section className="auth-card">
      <span className="auth-icon"><LockKeyhole size={20}/></span>
      <p className="auth-eyebrow">VOTRE ESPACE PERSONNEL</p>
      <h1>{mode === 'register' ? 'Créer un compte' : 'Bon retour'}</h1>
      <p className="auth-intro">{mode === 'register' ? 'Inscrivez-vous pour retrouver vos analyses et gérer vos demandes de nettoyage.' : 'Connectez-vous pour retrouver vos analyses et vos choix de nettoyage.'}</p>
      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="auth-email">Adresse e-mail</label>
        <input id="auth-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="vous@exemple.fr" />
        <label htmlFor="auth-password">Mot de passe</label>
        <input id="auth-password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} placeholder="8 caractères minimum" />
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button button-primary auth-submit" disabled={loading} type="submit">{loading ? 'Veuillez patienter…' : mode === 'register' ? 'Créer mon compte' : 'Se connecter'} <ArrowRight size={16}/></button>
      </form>
      <p className="auth-switch">{mode === 'register' ? 'Vous avez déjà un compte ?' : 'Pas encore de compte ?'} <button onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); }}>{mode === 'register' ? 'Se connecter' : 'Créer un compte'}</button></p>
      <p className="auth-privacy">Votre mot de passe est protégé. Vous serez connecté dès la création de votre compte.</p>
    </section>
  </main>;
}

export default function LoginPage() {
  return <Suspense fallback={<main className="auth-page"/>}><LoginContent/></Suspense>;
}
