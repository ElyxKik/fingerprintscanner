'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function VerifyContent() {
  const params = useSearchParams();
  const [message, setMessage] = useState('Vérification de votre adresse e-mail…');
  useEffect(() => {
    const token = params.get('token');
    if (!token) { setMessage('Ce lien de confirmation ne contient pas de jeton.'); return; }
    fetch(`${'/api'}/auth/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      .then(async response => { if (!response.ok) throw new Error('Ce lien de confirmation est invalide ou expiré.'); return response.json(); })
      .then(session => { localStorage.setItem('fingerprintscanner_token', session.access_token); localStorage.setItem('fingerprintscanner_user', session.user_id); if(session.scan_id) localStorage.setItem('fingerprintscanner_pending_scan', session.scan_id); const email=localStorage.getItem('fingerprintscanner_pending_email'); if(email) localStorage.setItem('fingerprintscanner_verified_email',email); window.location.replace('/scan'); })
      .catch(error => setMessage(error.message));
  }, [params]);
  return <main className="legal-page"><div className="container"><a href="/" className="legal-back">← FingerprintScanner</a><h1>Connexion</h1><p>{message}</p></div></main>;
}

export default function VerifyPage() {
  return <Suspense fallback={<main className="legal-page"><div className="container"><h1>Vérification de votre lien…</h1></div></main>}><VerifyContent /></Suspense>;
}
