'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, CreditCard, LockKeyhole, X } from 'lucide-react';

export type CheckoutDetails = { first_name: string; last_name: string; phone: { number: string; country_code: string } };

export default function CheckoutModal({
  plan,
  email,
  onClose,
  onSubmit,
}: {
  plan: 'guided' | 'complete';
  email: string;
  onClose: () => void;
  onSubmit: (details: CheckoutDetails) => Promise<void>;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('CD');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', onKeyDown); };
  }, [busy, onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSubmit({ first_name: firstName.trim(), last_name: lastName.trim(), phone: { number: phone.replace(/\D/g, ''), country_code: countryCode } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Le paiement n’a pas pu être préparé.');
    } finally {
      setBusy(false);
    }
  }

  const price = plan === 'guided' ? 199 : 299;
  return <AnimatePresence>
    <motion.div className="auth-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="auth-modal checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-modal-title" initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .98 }} transition={{ duration: .2 }}>
        <button type="button" className="auth-modal-close" onClick={onClose} aria-label="Fermer" disabled={busy}><X size={19}/></button>
        <span className="auth-icon"><CreditCard size={20}/></span>
        <p className="auth-eyebrow">PAIEMENT SÉCURISÉ PAR CHARIOW</p>
        <h2 id="checkout-modal-title">Préparer le paiement</h2>
        <p className="auth-intro">Offre {plan === 'guided' ? 'accompagnée' : 'complète'} · {price} $ / an. Votre licence est valable un an. Le règlement se fait sur la page sécurisée de Chariow.</p>
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="checkout-email">Adresse e-mail du compte</label>
          <input id="checkout-email" type="email" value={email} readOnly required />
          <div className="checkout-name-fields">
            <div><label htmlFor="checkout-first-name">Prénom</label><input id="checkout-first-name" autoComplete="given-name" maxLength={50} required value={firstName} onChange={event => setFirstName(event.target.value)} /></div>
            <div><label htmlFor="checkout-last-name">Nom</label><input id="checkout-last-name" autoComplete="family-name" maxLength={50} required value={lastName} onChange={event => setLastName(event.target.value)} /></div>
          </div>
          <label htmlFor="checkout-country">Pays du numéro</label>
          <select id="checkout-country" value={countryCode} onChange={event => setCountryCode(event.target.value)}>
            <option value="CD">République démocratique du Congo (CD)</option>
            <option value="CG">République du Congo (CG)</option>
            <option value="CI">Côte d’Ivoire (CI)</option>
            <option value="SN">Sénégal (SN)</option>
            <option value="FR">France (FR)</option>
            <option value="BE">Belgique (BE)</option>
            <option value="CA">Canada (CA)</option>
            <option value="US">États-Unis (US)</option>
          </select>
          <label htmlFor="checkout-phone">Téléphone</label>
          <input id="checkout-phone" type="tel" inputMode="tel" autoComplete="tel-national" required minLength={6} maxLength={24} value={phone} onChange={event => setPhone(event.target.value)} placeholder="Numéro sans indicatif pays" />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="button button-primary auth-submit" disabled={busy} type="submit">{busy ? 'Connexion à Chariow…' : `Continuer vers le paiement · ${price} $ / an`} <ArrowRight size={16}/></button>
        </form>
        <p className="auth-privacy"><LockKeyhole size={14}/> Le scan reste gratuit. Le paiement est traité sur Chariow ; vos coordonnées de carte ne transitent pas par FingerprintScanner.</p>
      </motion.section>
    </motion.div>
  </AnimatePresence>;
}
