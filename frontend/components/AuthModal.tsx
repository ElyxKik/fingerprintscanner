'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Fingerprint, LockKeyhole, X } from 'lucide-react';

type AuthMode = 'login' | 'register';

export default function AuthModal({
  mode: initialMode,
  scanId,
  initialEmail = '',
  onClose,
  onAuthenticated,
}: {
  mode: AuthMode;
  scanId?: string;
  initialEmail?: string;
  onClose: () => void;
  onAuthenticated: (token: string, userId: string, email: string) => void;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    const normalizedEmail = email.trim().toLowerCase();
    if (mode === 'register' && password !== confirmation) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/auth/${mode === 'register' ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'La demande n’a pas pu aboutir.');
      if (scanId) localStorage.setItem('fingerprintscanner_pending_scan', scanId);
      localStorage.setItem('fingerprintscanner_pending_email', normalizedEmail);
      if (result.access_token) {
        localStorage.setItem('fingerprintscanner_token', result.access_token);
        localStorage.setItem('fingerprintscanner_user', result.user_id);
        localStorage.setItem('fingerprintscanner_verified_email', normalizedEmail);
        onAuthenticated(result.access_token, result.user_id, normalizedEmail);
        onClose();
        return;
      }
      setMessage(result.delivery_mode === 'email'
        ? 'Compte créé. Consultez votre boîte mail pour confirmer votre adresse.'
        : 'Compte créé. Ouvrez le lien de confirmation affiché dans le terminal de l’API.');
      setMode('login');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Une erreur est survenue. Réessayez.');
    } finally {
      setLoading(false);
    }
  }

  return <AnimatePresence>
    <motion.div className="auth-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .98 }} transition={{ duration: .2 }}>
        <button type="button" className="auth-modal-close" onClick={onClose} aria-label="Fermer"><X size={19}/></button>
        <span className="auth-icon"><LockKeyhole size={20}/></span>
        <p className="auth-eyebrow">VOTRE ESPACE PERSONNEL</p>
        <h2 id="auth-modal-title">{mode === 'register' ? 'Créer un compte' : 'Bon retour'}</h2>
        <p className="auth-intro">{mode === 'register' ? 'Retrouvez vos analyses et suivez vos demandes de nettoyage.' : 'Connectez-vous pour retrouver vos analyses et vos choix de nettoyage.'}</p>
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="modal-auth-email">Adresse e-mail</label>
          <input id="modal-auth-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="vous@exemple.fr" />
          <label htmlFor="modal-auth-password">Mot de passe</label>
          <input id="modal-auth-password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} placeholder="8 caractères minimum" />
          {mode === 'register' && <><label htmlFor="modal-auth-confirmation">Confirmer le mot de passe</label><input id="modal-auth-confirmation" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder="Saisissez à nouveau le mot de passe" /></>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          {message && <p className="auth-message" role="status">{message}</p>}
          <button className="button button-primary auth-submit" disabled={loading} type="submit">{loading ? 'Veuillez patienter…' : mode === 'register' ? 'Créer mon compte' : 'Se connecter'} <ArrowRight size={16}/></button>
        </form>
        <p className="auth-switch">{mode === 'register' ? 'Vous avez déjà un compte ?' : 'Pas encore de compte ?'} <button type="button" onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); setMessage(''); }}>{mode === 'register' ? 'Se connecter' : 'Créer un compte'}</button></p>
        <p className="auth-privacy"><Fingerprint size={14}/> Vos données personnelles sont protégées. La confirmation de l’adresse est requise à l’inscription.</p>
      </motion.section>
    </motion.div>
  </AnimatePresence>;
}
