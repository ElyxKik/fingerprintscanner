'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleHelp, Fingerprint, Globe2, LockKeyhole, Menu, ScanSearch, Shield, ShieldCheck, Sparkles, X } from 'lucide-react';
import WorldScanAnimation from '../components/WorldScanAnimation';
import AuthModal from '../components/AuthModal';
import CheckoutModal, { type CheckoutDetails } from '../components/CheckoutModal';

type Stage = 'idle' | 'scanning' | 'done' | 'error';
type ScanResult = { site: string; url: string; type: string; risk: string; color: string; id?: string; score?: number; keywords?: string[]; kind?: string; removalUrl?: string };
type ApiFinding = { id: string; source_name: string; url: string; title: string; risk: string; risk_score: number; risk_keywords: string[]; result_kind: string; removal_url?: string };
async function buildDisplayResults(findings: ApiFinding[] = [], includeLiveFindings = false): Promise<ScanResult[]> {
  const live = includeLiveFindings ? findings.filter(item => item.result_kind === 'live').map(item => ({
    site: item.source_name,
    url: new URL(item.url).hostname,
    type: item.title || 'Résultat public',
    risk: item.risk,
    color: item.risk === 'critical' || item.risk === 'high' ? 'red' : item.risk === 'medium' ? 'orange' : 'green',
    id: item.id,
    score: item.risk_score,
    keywords: item.risk_keywords || [],
    kind: item.result_kind,
    removalUrl: item.removal_url,
  })) : [];

  let catalog: ScanResult[] = [];
  try {
    const response = await fetch(`${'/api'}/catalog`);
    if (response.ok) {
      const entries: ApiFinding[] = await response.json();
      catalog = entries.map(item => ({
        site: item.source_name,
        url: new URL(item.url).hostname,
        type: item.title.replace(' · Catalog source', ' · Source du catalogue'),
        risk: item.risk,
        color: item.risk === 'critical' || item.risk === 'high' ? 'red' : item.risk === 'medium' ? 'orange' : 'green',
        score: item.risk_score,
        keywords: item.risk_keywords || [],
        kind: 'catalog',
        removalUrl: item.removal_url,
      }));
    }
  } catch { /* The sample rows remain visible if the catalog service is unavailable. */ }

  // Prefer a live match over the informational catalog entry for the same host.
  const liveHosts = new Set(live.map(item => item.url.replace(/^www\./, '').toLowerCase()));
  const combined = [...live, ...catalog.filter(item => !liveHosts.has(item.url.replace(/^www\./, '').toLowerCase()))];
  return combined.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.site.localeCompare(b.site));
}

function Brand() {
  return <a href="#top" className="brand brand-image-link" aria-label="Accueil FingerprintScanner"><Image src="/fingerprintscanner-logo.png" alt="FingerprintScanner" width={239} height={40} priority /></a>;
}

function orderStatusLabel(status: string) {
  const labels: Record<string, string> = {
    checkout_pending: 'Préparation du paiement',
    pending_payment: 'Paiement en attente',
    paid: 'Payée',
    payment_failed: 'Paiement échoué',
    abandoned: 'Paiement abandonné',
    checkout_failed: 'Paiement indisponible',
    already_purchased: 'Déjà acheté sur Chariow',
    active: 'Active',
    subscription_active: 'Abonnement actif',
  };
  return labels[status] || status;
}

function orderAmountLabel(order: { currency?: string; amount_usd?: number; amount_eur?: number }) {
  return order.currency === 'USD' ? `${order.amount_usd ?? 0} $` : `${order.amount_eur ?? 0} €`;
}

export default function Home() {
  const scanOnly = usePathname() === '/scan';
  const autoScanStarted = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState('');
  const [results, setResults] = useState<ScanResult[]>([]);
  const [selectedFindingIds, setSelectedFindingIds] = useState<string[]>([]);
  const [scanNotice, setScanNotice] = useState('');
  const [scanId, setScanId] = useState('');
  const [userId, setUserId] = useState('');
  const [cleanupDrafts, setCleanupDrafts] = useState<{id:string; finding_id:string; status:string; request_text:string}[]>([]);
  const [authToken, setAuthToken] = useState('');
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register' | null>(null);
  const [checkoutPlan, setCheckoutPlan] = useState<'guided' | 'complete' | null>(null);
  const [pendingCheckoutPlan, setPendingCheckoutPlan] = useState<'guided' | 'complete' | null>(null);
  const [checkoutFromPricing, setCheckoutFromPricing] = useState(false);
  const [checkoutEmail, setCheckoutEmail] = useState('');
  const [authReady, setAuthReady] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [dashboard, setDashboard] = useState<{scans:{id:string;status:string;created_at:string}[];orders:{id:string;plan:string;amount_eur:number;amount_usd:number;currency:string;status:string;selected_findings?:{source_name:string;url:string}[]}[]}|null>(null);
  const [pendingScanId, setPendingScanId] = useState('');

  function setSelectedIds(ids: string[]) {
    const unique = Array.from(new Set(ids));
    setSelectedFindingIds(unique);
    localStorage.setItem('fingerprintscanner_selected_findings', JSON.stringify(unique));
  }

  async function displayScanResults(findings: ApiFinding[] = [], includeLive = false) {
    const displayed = await buildDisplayResults(findings, includeLive);
    setResults(displayed);
    const availableIds = displayed.filter(item => item.kind === 'live' && item.id).map(item => item.id!);
    const savedSelection = localStorage.getItem('fingerprintscanner_selected_findings');
    let selectedIds = availableIds;
    if (savedSelection !== null) {
      try {
        const parsed = JSON.parse(savedSelection) as string[];
        selectedIds = availableIds.filter(id => parsed.includes(id));
      } catch { selectedIds = availableIds; }
    }
    setSelectedIds(selectedIds);
  }

  function toggleFindingSelection(id: string, checked: boolean) {
    setSelectedIds(checked ? [...selectedFindingIds, id] : selectedFindingIds.filter(item => item !== id));
  }

  useEffect(() => {
    const token = localStorage.getItem('fingerprintscanner_token') || '';
    const user = localStorage.getItem('fingerprintscanner_user') || '';
    const savedScanId = localStorage.getItem('fingerprintscanner_pending_scan') || '';
    const savedCheckoutPlan = localStorage.getItem('fingerprintscanner_pending_checkout_plan');
    setAuthToken(token); setUserId(user); setPendingScanId(savedScanId); setAuthReady(true);
    setCheckoutEmail(localStorage.getItem('fingerprintscanner_verified_email') || '');
    if (token && user && (savedCheckoutPlan === 'guided' || savedCheckoutPlan === 'complete')) {
      setCheckoutPlan(savedCheckoutPlan);
      setCheckoutFromPricing(true);
      localStorage.removeItem('fingerprintscanner_pending_checkout_plan');
    }
    if (!token || !user) return;
    const apiBase = '/api';
    fetch(`${apiBase}/users/${user}/dashboard`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async response => { if (!response.ok) throw new Error('Dashboard unavailable'); return response.json(); })
      .then(async data => {
        setDashboard(data);
        if (!savedScanId || !data.scans.some((scan: { id: string }) => scan.id === savedScanId)) return;
        const response = await fetch(`${apiBase}/scans/${savedScanId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) return;
        const scan = await response.json();
        setScanId(savedScanId);
        await displayScanResults(scan.findings || [], true);
        setScanNotice('Private findings are unlocked for your verified account.');
        setStage('done');
      })
      .catch(() => undefined);
  }, []);

  function launchScan(address: string) {
    setEmail(address);
    setError('');
    setStage('scanning'); setScanNotice(''); setResults([]); setSelectedFindingIds([]); localStorage.removeItem('fingerprintscanner_selected_findings'); setError(''); setScanId(''); setPendingScanId(''); setDashboard(null); setCleanupDrafts([]);
    const apiBase = '/api';
    const verifiedEmail = localStorage.getItem('fingerprintscanner_verified_email');
    const hasMatchingVerifiedSession = Boolean(authToken && verifiedEmail?.toLowerCase() === address.toLowerCase());
    fetch(`${apiBase}/scans`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(hasMatchingVerifiedSession ? { Authorization: `Bearer ${authToken}` } : {}) }, body: JSON.stringify({ email: address, ownership_confirmed: true }) })
      .then(async response => { if (!response.ok) throw new Error('Le service d’analyse est indisponible'); return response.json(); })
      .then(async scan => {
        const scanId = scan.id as string;
        setScanId(scanId);
        setPendingScanId(scanId);
        if (hasMatchingVerifiedSession) { setUserId(localStorage.getItem('fingerprintscanner_user') || ''); }
        if (scan.status === 'completed') {
          const response = await fetch(`${apiBase}/scans/${scanId}`, { headers: hasMatchingVerifiedSession ? { Authorization: `Bearer ${authToken}` } : {} });
          const completed = response.ok ? await response.json() : scan;
          await displayScanResults(completed.findings || [], hasMatchingVerifiedSession);
          setScanNotice('Les sources du catalogue sont indicatives et ne confirment pas la présence de votre adresse.'); setStage('done'); if (hasMatchingVerifiedSession) void loadDashboard(); return;
        }
        for (let attempt = 0; attempt < 30; attempt++) {
          await new Promise(resolve => window.setTimeout(resolve, 1500));
          const response = await fetch(`${apiBase}/scans/${scanId}`, { headers: hasMatchingVerifiedSession ? { Authorization: `Bearer ${authToken}` } : {} });
          if (!response.ok) throw new Error('Impossible de charger les résultats de l’analyse');
          const current = await response.json();
          if (current.status === 'completed') {
            setPendingScanId(scanId);
            await displayScanResults(current.findings || [], hasMatchingVerifiedSession);
            setScanNotice((current.findings || []).some((item: ApiFinding) => item.result_kind === 'live') && hasMatchingVerifiedSession
              ? 'Les correspondances publiques trouvées sont classées par niveau de risque. Les sources du catalogue restent indicatives.'
              : 'Les sources du catalogue sont indicatives et ne confirment pas la présence de votre adresse.');
            setStage('done'); if (hasMatchingVerifiedSession) void loadDashboard(); return;
          }
          if (current.status === 'failed') throw new Error('Le fournisseur de recherche n’a pas pu terminer cette analyse');
        }
        throw new Error('L’analyse prend plus de temps que prévu');
      })
      .catch((cause: Error) => { setError(`${cause.message}. Vérifiez la configuration de la base de données et du fournisseur de recherche.`); setStage('error'); });
  }

  function startScan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim();
    if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { setError('Saisissez une adresse e-mail valide pour continuer.'); return; }
    if (!consent) { setError('Veuillez confirmer que cette adresse e-mail vous appartient.'); return; }
    launchScan(address);
  }

  useEffect(() => {
    if (autoScanStarted.current) return;
    const requestedEmail = new URLSearchParams(window.location.search).get('email')?.trim() || '';
    if (!requestedEmail) return;
    if (!scanOnly && window.location.pathname === '/') {
      autoScanStarted.current = true;
      window.location.replace(`/scan?email=${encodeURIComponent(requestedEmail)}`);
      return;
    }
    if (!scanOnly) return;
    autoScanStarted.current = true;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedEmail)) {
      setEmail(requestedEmail);
      setError('Le lien contient une adresse e-mail invalide. Corrigez-la puis relancez l’analyse.');
      return;
    }
    setEmail(requestedEmail);
    setConsent(true);
    launchScan(requestedEmail);
  }, [scanOnly]);

  async function createCleanupDraft(findingId: string) {
    if (!authToken) { setError('Connectez-vous avec l’adresse analysée avant de préparer une demande de suppression.'); return; }
    try {
      const base = '/api';
      const response = await fetch(`${base}/scans/${scanId}/cleanup-drafts`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ finding_id: findingId }) });
      if (!response.ok) throw new Error('Impossible de préparer la demande de suppression');
      const draft = await response.json();
      setCleanupDrafts(items => [draft, ...items]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de préparer la demande de suppression'); }
  }

  async function createOrder(plan: 'guided' | 'complete', fromPricing = false) {
    if (!authToken || !userId) {
      if (fromPricing) { localStorage.setItem('fingerprintscanner_pending_checkout_plan', plan); setPendingCheckoutPlan(plan); setCheckoutFromPricing(true); setAuthModalMode('login'); setError(''); }
      else setError('Connectez-vous avant de créer une commande de nettoyage.');
      return;
    }
    if (selectedFindingIds.length === 0 && !fromPricing) { setError('Sélectionnez au moins un résultat réel à nettoyer.'); return; }
    if (plan === 'guided' && !fromPricing && selectedFindingIds.length > 1) { setError('L’offre à 199 $ concerne un seul lien. Sélectionnez un seul résultat ou choisissez l’offre à 299 $.'); return; }
    if (plan === 'complete' && !fromPricing && selectedFindingIds.length > 5) { setError('L’offre à 299 $ / an permet de sélectionner jusqu’à cinq liens.'); return; }
    const verifiedEmail = localStorage.getItem('fingerprintscanner_verified_email') || '';
    if (!verifiedEmail) { setError('Reconnectez-vous pour confirmer l’adresse e-mail de votre compte avant le paiement.'); return; }
    setCheckoutEmail(verifiedEmail);
    setCheckoutFromPricing(fromPricing);
    setError('');
    setCheckoutPlan(plan);
  }

  async function submitCheckout(details: CheckoutDetails) {
    if (!authToken || !userId || !checkoutPlan) throw new Error('Reconnectez-vous avant de continuer.');
    try {
      const response = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ user_id: userId, plan: checkoutPlan, selected_finding_ids: checkoutFromPricing ? [] : selectedFindingIds, ...details }) });
      const order = await response.json();
      if (!response.ok) throw new Error(order.detail || 'Impossible de démarrer le paiement.');
      localStorage.removeItem('fingerprintscanner_pending_checkout_plan');
      setCheckoutPlan(null);
      await loadDashboard();
      if (order.checkout_url) window.location.assign(order.checkout_url);
      else setScanNotice('La commande a été transmise. Son statut sera actualisé après confirmation de Chariow.');
    } catch (cause) { throw cause instanceof Error ? cause : new Error('Impossible de démarrer le paiement.'); }
  }

  async function loadDashboard(tokenOverride?: string, userOverride?: string) {
    const activeToken = tokenOverride || authToken;
    const activeUserId = userOverride || userId;
    if (!activeUserId || !activeToken) return;
    setDashboardError('');
    try {
      const response = await fetch(`${'/api'}/users/${activeUserId}/dashboard`, { headers: { Authorization: `Bearer ${activeToken}` } });
      if (response.status === 401) {
        localStorage.removeItem('fingerprintscanner_token');
        localStorage.removeItem('fingerprintscanner_user');
        localStorage.removeItem('fingerprintscanner_verified_email');
        setAuthToken(''); setUserId(''); setDashboard(null);
        setDashboardError('Votre session a expiré. Connectez-vous à nouveau.');
        return;
      }
      if (!response.ok) throw new Error('Le service du compte est momentanément indisponible.');
      const data = await response.json();
      setDashboard(data);
      if(pendingScanId && data.scans.some((scan:{id:string})=>scan.id===pendingScanId)) {
        const scanResponse=await fetch(`${'/api'}/scans/${pendingScanId}`, {headers:{Authorization:`Bearer ${activeToken}`}});
        if(scanResponse.ok) { const scan=await scanResponse.json(); await displayScanResults(scan.findings || [], true); setScanNotice('Les résultats de votre compte sont chargés.'); setStage('done'); setTimeout(()=>document.querySelector('#scan')?.scrollIntoView({behavior:'smooth'}),0); }
      }
    } catch (cause) {
      setDashboardError(cause instanceof Error ? cause.message : 'Impossible de charger votre compte.');
    }
  }

  function logout() {
    localStorage.removeItem('fingerprintscanner_token');
    localStorage.removeItem('fingerprintscanner_user');
    localStorage.removeItem('fingerprintscanner_verified_email');
    localStorage.removeItem('fingerprintscanner_pending_scan');
    setAuthToken(''); setUserId(''); setDashboard(null); setDashboardError('');
  }

  async function approveDraft(draftId: string) {
    try {
      const response = await fetch(`${'/api'}/cleanup-drafts/${draftId}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` } });
      if (!response.ok) throw new Error('Impossible de valider ce brouillon');
      const updated = await response.json();
      setCleanupDrafts(items => items.map(item => item.id === draftId ? { ...item, status: updated.status } : item));
      await loadDashboard();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de valider ce brouillon'); }
  }

  const cleanableResults = results.filter(result => result.kind === 'live' && result.id);
  const allRealResultsSelected = cleanableResults.length > 0 && cleanableResults.every(result => selectedFindingIds.includes(result.id!));
  const selectedCount = cleanableResults.filter(result => selectedFindingIds.includes(result.id!)).length;
  const hasPaidAccess = Boolean(dashboard?.orders.some(order => ['paid', 'active', 'subscription_active'].includes(order.status)));
  const hasFullResultsAccess = Boolean(authToken || hasPaidAccess);
  const lockedResultsCount = Math.max(0, results.length - 5);

  if (scanOnly) return (
    <main className="dedicated-scan-page" id="top">
      <header className="nav-wrap"><nav className="nav container"><Brand /><a href="/" className="text-link"><ArrowDown size={14} /> Retour à l’accueil</a></nav></header>
      <section className="dedicated-scan-shell"><div className="container">
        <div className="dedicated-scan-top">
          <div><div className="eyebrow"><span className="live-dot" /> TOUJOURS GRATUIT · CONFIDENTIALITÉ D’ABORD</div><h1>{stage === 'scanning' ? <>Analyse du<br /><em>Web public.</em></> : stage === 'done' ? <>Votre analyse.<br /><em>La suite, à vous.</em></> : <>Découvrez ce qui<br /><em>circule en ligne.</em></>}</h1><p>Nous recherchons votre adresse e-mail dans les sources publiques et classons les résultats selon le niveau d’exposition. Analyse toujours gratuite.</p></div>
          <div className="scan-globe-wrap"><WorldScanAnimation active={stage === 'scanning'} /></div>
        </div>
        <div className="dedicated-scan-content">
          <div className="dedicated-scan-explainer"><span className="section-label"><span>01</span> VOTRE E-MAIL, VOTRE CHOIX</span><h2>{stage === 'done' ? 'Vos résultats sont prêts.' : 'Lancez votre analyse gratuite.'}</h2><p>{stage === 'done' ? 'L’analyse est gratuite. Connectez-vous avec l’adresse analysée pour consulter vos résultats privés et choisir les éléments à nettoyer.' : 'Saisissez votre adresse e-mail. Nous consultons uniquement les sources accessibles au public, sans accéder à des comptes privés.'}</p><div className="scan-assurances"><span><Check size={13} /> Analyse 100 % gratuite</span><span><Check size={13} /> Résultats classés par risque</span><span><Check size={13} /> Aucune suppression automatique</span></div>{authToken ? <div className="scan-signin-form"><label>Compte connecté</label><p>{checkoutEmail || 'Votre session est active.'}</p><small>{dashboard ? `${dashboard.scans.length} analyse(s) · ${dashboard.orders.length} commande(s)` : dashboardError || 'Chargement de votre espace…'}</small><button type="button" className="button button-outline" onClick={() => void loadDashboard()}>Actualiser mon compte</button><button type="button" className="text-link" onClick={logout}>Se déconnecter</button></div> : <div className="scan-signin-form"><label>Vous avez déjà lancé une analyse ? Connectez-vous pour retrouver vos résultats</label><button type="button" className="button button-outline" onClick={() => setAuthModalMode('login')}>Se connecter <ArrowRight size={14} /></button><button type="button" className="text-link" onClick={() => setAuthModalMode('register')}>Créer un compte</button>{dashboardError && <p className="form-error" role="alert">{dashboardError}</p>}</div>}</div>
          <div className="dedicated-scan-panel">
            {stage === 'idle' || stage === 'error' ? (
              <form onSubmit={startScan}><div className="panel-head"><div><span className="panel-kicker">RECHERCHE SUR LE WEB PUBLIC</span><h3>Vérifiez votre empreinte</h3></div><span className="panel-illustration"><ScanSearch size={19} /></span></div><label htmlFor="scan-email">Adresse e-mail</label><div className="input-wrap"><span>@</span><input id="scan-email" type="email" placeholder="vous@exemple.fr" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required /></div><label className="consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span className="custom-check"><Check size={12} /></span><span>Je confirme que cette adresse e-mail m’appartient et j’autorise sa recherche sur le Web public.</span></label>{error && <p className="form-error">{error}</p>}<button className="button button-primary scan-submit" type="submit">Lancer mon analyse gratuite <ArrowRight size={16} /></button><div className="panel-foot"><ShieldCheck size={14} /> Analyse et résultats : 0 €</div></form>
            ) : stage === 'scanning' ? (
              <div className="scan-progress-card"><div className="scan-progress-icon"><ScanSearch size={22} /></div><h3>Recherche dans les sources publiques</h3><p>Consultation des résultats du Web et classement du niveau d’exposition…</p><div className="progress-track"><motion.span initial={{ width: '7%' }} animate={{ width: '88%' }} transition={{ duration: 12, ease: 'linear' }} /></div><div className="scan-progress-meta"><span><i /> Analyse en cours</span><span>{email}</span></div></div>
            ) : (
              <div className="scan-result-summary">{(email || checkoutEmail) && <div className="scan-target-email"><span>ADRESSE ANALYSÉE</span><strong>{email || checkoutEmail}</strong></div>}<div className="results-top"><span className="result-check"><Check size={18} /></span><div><h3>Votre analyse gratuite est terminée</h3><p>{results.length ? hasFullResultsAccess ? `${results.length} résultats affichés : ${results.filter(r => r.kind === 'live').length} correspondances publiques et ${results.filter(r => r.kind === 'catalog').length} sources indicatives du catalogue.` : `Aperçu gratuit : 5 résultats affichés sur ${results.length}. Connectez-vous ou choisissez une offre pour voir le reste.` : 'Aucune source n’a été renvoyée pour cette analyse.'}</p></div><button className="reset-button" onClick={() => { setStage('idle'); setResults([]); setSelectedIds([]); setScanNotice(''); }}>Nouvelle analyse</button></div><div className="scan-offer-actions"><p className="scan-offer-intro">Forfaits annuels de nettoyage · choisissez l’accompagnement adapté à vos liens.</p><article className="scan-plan-card"><div><span className="scan-plan-kicker">1 LIEN · 199 $ / AN</span><h4>Nettoyage accompagné</h4><p>Une demande personnalisée pour un lien prioritaire.</p></div><button type="button" className="button button-outline" onClick={() => createOrder('guided', true)}>Choisir ce forfait <ArrowRight size={15} /></button><small>Avantage : centralisez votre demande et suivez son avancement depuis votre compte.</small></article><article className="scan-plan-card scan-plan-card-featured"><div><span className="scan-plan-kicker">JUSQU’À 5 LIENS · 299 $ / AN</span><h4>Nettoyage complet</h4><p>Un accompagnement pour plusieurs liens prioritaires.</p></div><button type="button" className="button button-primary" onClick={() => createOrder('complete', true)}>Choisir ce forfait <ArrowRight size={15} /></button><small>Avantage : gérez plusieurs demandes au même endroit et retrouvez leur suivi dans votre espace.</small></article><a href="/#pricing" className="text-link scan-pricing-link">Consulter le détail des offres <ArrowRight size={16} /></a></div>{hasFullResultsAccess && <div className="scan-selection-bar"><label><input type="checkbox" checked={allRealResultsSelected} disabled={!cleanableResults.length} onChange={event => setSelectedIds(event.target.checked ? cleanableResults.map(result => result.id!) : [])} /><span>Sélectionner tous les résultats réels</span></label><span>{selectedCount} sélectionné(s) sur {cleanableResults.length} lien(s) nettoyable(s)</span><small>Les sites du catalogue sont indicatifs et ne sont pas sélectionnables.</small></div>}<div className="results-list">{results.map((r, i) => { const isLocked = !hasFullResultsAccess && i >= 5; return <Fragment key={`${r.site}-${i}`}>{i === 5 && !hasFullResultsAccess && lockedResultsCount > 0 && <div className="results-lock-card"><span className="lock-icon"><LockKeyhole size={18}/></span><div><b>{lockedResultsCount} autres sites sont masqués</b><p>Connectez-vous ou consultez les offres pour débloquer tous les résultats.</p></div><button type="button" className="button button-outline" onClick={() => setAuthModalMode('login')}>Se connecter</button><a href="/#pricing" className="button button-primary">Voir les offres</a></div>}<div className={`result-row ${isLocked ? 'result-row-locked' : ''}`}><label className="result-select" aria-label={`Sélectionner ${r.site}`}><input type="checkbox" checked={Boolean(r.id && selectedFindingIds.includes(r.id))} disabled={isLocked || r.kind !== 'live' || !r.id} onChange={event => r.id && toggleFindingSelection(r.id, event.target.checked)} /><span /></label><span className="result-bullet">{i + 1}</span><span className="result-details"><b>{r.site}</b><small>{r.url} · {r.type}</small></span><span className={`risk risk-${r.color}`}>{({critical:'Critique',high:'Élevé',medium:'Modéré',low:'Faible'} as Record<string,string>)[r.risk] || r.risk} · {r.score ?? 0}</span>{r.kind === 'catalog' && <span className="catalog-tag">Catalogue · présence non confirmée</span>}{r.keywords?.length ? <small className="matched-keywords">Mots-clés détectés : {r.keywords.join(', ')}</small> : null}{r.removalUrl && <a className="result-action" href={r.removalUrl} target="_blank" rel="noreferrer">Infos de suppression</a>}{r.id && r.kind === 'live' && <button className="result-action" onClick={() => createCleanupDraft(r.id!)}>Préparer une demande</button>}</div></Fragment>})}</div>{cleanupDrafts.map(d => <div className="draft-panel" key={d.id}><b>Brouillon de demande de suppression · {d.status}</b><textarea value={d.request_text} onChange={e => setCleanupDrafts(items => items.map(item => item.id === d.id ? { ...item, request_text: e.target.value } : item))} /><button className="button button-outline" onClick={() => navigator.clipboard.writeText(d.request_text)}>Copier le brouillon</button><button className="button button-primary" onClick={() => approveDraft(d.id)}>Je valide ce brouillon</button></div>)}{scanNotice && <div className="demo-notice">{scanNotice}</div>}<p className="results-disclaimer">Les sources du catalogue sont indicatives : elles ne confirment pas la présence de votre adresse. Les résultats issus de la recherche publique peuvent nécessiter une vérification manuelle.</p>{error && <p className="form-error">{error}</p>}{hasFullResultsAccess && <div className="selection-cleanup-actions"><p>{selectedCount ? `${selectedCount} lien(s) réel(s) sélectionné(s). Décochez ceux que vous ne souhaitez pas nettoyer.` : 'Cochez un ou plusieurs résultats réels pour choisir les liens à nettoyer.'}</p><button className="button button-outline" disabled={selectedCount !== 1} onClick={() => createOrder('guided')}>Nettoyer 1 lien · 199 $ / an</button><button className="button button-primary" disabled={selectedCount < 1 || selectedCount > 5} onClick={() => createOrder('complete')}>Nettoyer la sélection · 299 $ / an</button></div>}</div>
            )}
          </div>
        </div>
      </div></section>
      <footer className="footer"><div className="container footer-bottom"><span>© 2026 FingerprintScanner</span><a href="/privacy">Privacy</a><a href="/terms">Conditions d’utilisation</a></div></footer>
      {authModalMode && <AuthModal mode={authModalMode} scanId={pendingScanId} initialEmail={email} onClose={() => { setAuthModalMode(null); if (!authToken) { localStorage.removeItem('fingerprintscanner_pending_checkout_plan'); setPendingCheckoutPlan(null); } }} onAuthenticated={(token, id, authenticatedEmail) => { setAuthToken(token); setUserId(id); setCheckoutEmail(authenticatedEmail); const savedPlan = localStorage.getItem('fingerprintscanner_pending_checkout_plan'); const plan = pendingCheckoutPlan || (savedPlan === 'guided' || savedPlan === 'complete' ? savedPlan : null); if (plan) { setCheckoutPlan(plan); setCheckoutFromPricing(true); setPendingCheckoutPlan(null); localStorage.removeItem('fingerprintscanner_pending_checkout_plan'); } void loadDashboard(token, id); }} />}
      {checkoutPlan && <CheckoutModal plan={checkoutPlan} email={checkoutEmail} onClose={() => { setCheckoutPlan(null); localStorage.removeItem('fingerprintscanner_pending_checkout_plan'); }} onSubmit={submitCheckout} />}
    </main>
  );

  return <main id="top">
    <header className="nav-wrap"><nav className="nav container"><Brand /><div className={`nav-links ${menuOpen ? 'nav-links-open' : ''}`}><a href="#how">Comment ça marche</a><a href="#features">Pourquoi Fingerprint</a><a href="#pricing">Tarifs</a><a href="#faq">Questions fréquentes</a><a href="/scan" className="button button-nav">Lancer une analyse <ArrowRight size={15} /></a></div><button className="menu-button" aria-label="Ouvrir ou fermer le menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={20}/> : <Menu size={20}/>}</button></nav></header>

    <section className="hero container">
      <div className="hero-copy"><motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{duration:.45}} className="eyebrow"><span className="live-dot"/> VOTRE VIE PRIVÉE, EN TOUTE CLARTÉ</motion.div>
        <motion.h1 initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{duration:.55,delay:.08}}>Votre empreinte numérique.<br/><span>Reprenez-en le contrôle.</span></motion.h1>
        <p className="hero-lede">Découvrez où vos informations personnelles apparaissent en ligne et comment reprendre le contrôle.</p>
        <div className="hero-actions"><a href="/scan" className="button button-primary">Analyser mon empreinte <ArrowRight size={16}/></a><a href="#how" className="text-link">Comment ça marche <ArrowDown size={15}/></a></div>
        <div className="hero-proof"><div className="proof-icons"><span><ShieldCheck size={14}/></span><span><LockKeyhole size={13}/></span><span><Globe2 size={13}/></span></div><span>La confidentialité avant tout</span><i/><span>Aucun spam. Aucune surprise.</span></div>
      </div>
      <motion.div className="hero-visual" initial={{opacity:0,scale:.97}} animate={{opacity:1,scale:1}} transition={{duration:.6,delay:.15}}>
        <div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="scan-core"><div className="scan-core-inner"><Fingerprint size={43} strokeWidth={1.3}/></div><span className="scan-ping"/></div>
        <div className="float-card card-top"><span className="mini-icon mini-blue"><Globe2 size={15}/></span><span><b>Profil public détecté</b><small>Réseau professionnel</small></span><span className="status-dot"/></div>
        <div className="float-card card-side"><span className="mini-icon mini-orange"><Shield size={15}/></span><span><b>Exposition détectée</b><small>Fiche de courtier en données</small></span><span className="tiny-risk">À vérifier</span></div>
        <div className="float-card card-bottom"><span className="mini-check"><Check size={13}/></span><span><b>Votre analyse reste privée</b><small>Vous seul voyez les résultats</small></span></div>
        <div className="visual-caption"><span className="caption-line"/> analyse du Web public</div>
      </motion.div>
      <div className="hero-bottom"><span>VOS DONNÉES VOUS APPARTIENNENT</span><span className="hero-bottom-line"/><span>SACHEZ OÙ ELLES SE TROUVENT</span></div>
    </section>

    <section className="scan-section"><div className="container scan-teaser"><div className="teaser-globe"><WorldScanAnimation /></div><div><div className="section-label"><span>01</span> VOTRE ANALYSE PRIVÉE DU WEB</div><h2>Visualisez votre empreinte<br/><em>en toute clarté.</em></h2><p>Recherchez votre adresse dans les sources publiques, examinez les résultats, puis choisissez si vous souhaitez de l’aide pour les supprimer. L’analyse est gratuite.</p><div className="teaser-actions"><a href="/scan" className="button button-primary">Accéder à l’analyse <ArrowRight size={16}/></a><span><LockKeyhole size={14}/> Gratuit, privé, sans carte bancaire</span></div></div></div></section>

    <section className="account-section"><div className="container account-inner"><div><span className="section-label">VOTRE ESPACE PERSONNEL</span><h2>{authToken ? 'Votre compte est connecté.' : 'Vous avez déjà lancé une analyse ? Connectez-vous.'}</h2><p>{authToken ? `Connecté en tant que ${checkoutEmail || 'utilisateur'}. Vos analyses et commandes sont enregistrées dans votre espace.` : dashboardError || 'Connectez-vous ou créez un compte pour retrouver vos analyses.'}</p></div>{authToken ? <button className="button button-outline" onClick={logout}>Se déconnecter</button> : <div className="account-form"><button type="button" className="button button-primary" onClick={() => setAuthModalMode('login')}>Se connecter <ArrowRight size={14}/></button><button type="button" className="button button-outline" onClick={() => setAuthModalMode('register')}>Créer un compte</button></div>}</div></section>

    <section className="how-section section-pad" id="how"><div className="container"><div className="section-label"><span>02</span> SIMPLE, TOUT SIMPLEMENT</div><div className="section-heading-row"><div><h2>De la recherche à <em>la tranquillité.</em></h2><p>Trois étapes simples. Vous gardez le contrôle à chacune d’elles.</p></div><a className="text-link desktop-link" href="#scan">Lancer l’analyse <ArrowUpRight size={15}/></a></div><div className="steps-grid"><article className="step-card"><div className="step-top"><span>01</span><div className="step-icon"><ScanSearch size={20}/></div></div><h3>Découvrez ce qui circule</h3><p>Nous recherchons votre adresse dans les sources publiques et réunissons les résultats dans un espace privé.</p><a href="#scan" className="step-arrow" aria-label="Lancer une analyse"><ArrowUpRight size={17}/></a></article><article className="step-card"><div className="step-top"><span>02</span><div className="step-icon"><Sparkles size={19}/></div></div><h3>Comprenez votre exposition</h3><p>Comprenez chaque résultat, son niveau de risque et les mesures que vous pouvez prendre.</p><a href="#features" className="step-arrow" aria-label="En savoir plus sur les résultats"><ArrowUpRight size={17}/></a></article><article className="step-card"><div className="step-top"><span>03</span><div className="step-icon"><ShieldCheck size={19}/></div></div><h3>Choisissez la suite</h3><p>Suivez un plan de suppression adapté ou demandez de l’aide. Vérifiez chaque action avant son envoi.</p><a href="#pricing" className="step-arrow" aria-label="Voir les offres de nettoyage"><ArrowUpRight size={17}/></a></article></div></div></section>

    <section className="insight-section section-pad" id="features"><div className="container insight-grid"><div className="insight-copy"><div className="section-label"><span>03</span> BIEN PLUS QU’UNE LISTE</div><h2>Des informations utiles<br/>pour savoir quoi faire <em>clairement.</em></h2><p>Un résultat n’est utile que si vous en comprenez le sens. FingerprintScanner vous aide à évaluer votre exposition, prioriser les risques et agir en confiance.</p><div className="insight-points"><div><span><Check size={14}/></span><div><b>Comprendre les risques</b><small>Découvrez simplement pourquoi un résultat est important.</small></div></div><div><span><Check size={14}/></span><div><b>Connaître vos options</b><small>Obtenez des conseils pratiques pour chaque publication.</small></div></div><div><span><Check size={14}/></span><div><b>Garder le contrôle</b><small>Choisissez les actions à entreprendre et suivez leur avancement au même endroit.</small></div></div></div><a href="#scan" className="button button-dark">Voir mon bilan de confidentialité <ArrowRight size={16}/></a></div><div className="insight-visual"><div className="report-card"><div className="report-heading"><div><span className="report-kicker">VOTRE BILAN DE CONFIDENTIALITÉ</span><b>Aperçu de l’exposition</b></div><span className="report-date">À L’INSTANT</span></div><div className="score-row"><div className="score-ring"><div><b>68</b><small>/ 100</small></div></div><div className="score-description"><span className="moderate-tag"><i/> EXPOSITION MODÉRÉE</span><b>Quelques éléments à vérifier</b><small>Certains éléments de votre présence publique méritent votre attention.</small></div></div><div className="report-divider"/><div className="category-list"><div><span className="category-icon"><Globe2 size={15}/></span><span><b>Profils publics</b><small>3 résultats trouvés</small></span><span className="category-count">03</span></div><div><span className="category-icon category-warn"><CircleHelp size={15}/></span><span><b>Sites de recherche de personnes</b><small>1 résultat à vérifier</small></span><span className="category-count category-count-warn">01</span></div><div><span className="category-icon category-muted"><LockKeyhole size={15}/></span><span><b>Identifiants exposés</b><small>Aucune correspondance publique</small></span><span className="category-count category-count-ok"><Check size={13}/></span></div></div><div className="report-footer"><Sparkles size={14}/> Votre plan d’action personnalisé est prêt <ArrowRight size={14}/></div></div><div className="visual-stamp"><ShieldCheck size={17}/><span><b>VOS DONNÉES</b><small>C’EST VOUS QUI DÉCIDEZ</small></span></div></div></div></section>

    <section className="pricing-section section-pad" id="pricing"><div className="container"><div className="section-label"><span>04</span> UNE AIDE ADAPTÉE À VOS BESOINS</div><div className="pricing-heading"><h2>Passez à l’étape suivante<br/>à <em>votre rythme.</em></h2><p>L’analyse complète reste gratuite. Choisissez ensuite une licence annuelle et passez au paiement sécurisé Chariow.</p></div><div className="pricing-grid"><article className="price-card"><div className="price-top"><span className="price-icon"><ScanSearch size={17}/></span><span className="price-tag">POUR DÉCOUVRIR VOTRE EXPOSITION</span></div><h3>Bilan de confidentialité</h3><p className="price-desc">Un aperçu privé de votre empreinte numérique publique.</p><div className="price-amount">0 $<span> / toujours</span></div><div className="price-rule"/><ul><li><Check size={14}/> Analyse des sources publiques</li><li><Check size={14}/> Résultats clairs et organisés</li><li><Check size={14}/> Aperçu des risques et prochaines étapes</li><li><Check size={14}/> Analyse complète et résultats gratuits</li></ul><a href="/scan" className="button button-outline">Lancer mon analyse gratuite <ArrowRight size={15}/></a></article><article className="price-card featured-price"><div className="popular-pill">LE PLUS POPULAIRE</div><div className="price-top"><span className="price-icon price-icon-blue"><ShieldCheck size={17}/></span><span className="price-tag">LICENCE ANNUELLE</span></div><h3>Nettoyage accompagné</h3><p className="price-desc">Un accompagnement pour une demande de suppression ciblée.</p><div className="price-amount">199 $<span> / an</span></div><div className="price-rule"/><ul><li><Check size={14}/> Licence valable un an</li><li><Check size={14}/> Une demande de suppression personnalisée</li><li><Check size={14}/> Suivi de votre demande</li><li><Check size={14}/> Vous validez avant l’envoi</li></ul><button onClick={()=>createOrder('guided',true)} className="button button-primary">Choisir · 199 $ / an <ArrowRight size={15}/></button></article><article className="price-card"><div className="price-top"><span className="price-icon"><Sparkles size={17}/></span><span className="price-tag">POUR UN SUIVI PLUS COMPLET</span></div><h3>Nettoyage complet</h3><p className="price-desc">Un accompagnement renforcé pour votre empreinte numérique.</p><div className="price-amount">299 $<span> / an</span></div><div className="price-rule"/><ul><li><Check size={14}/> Licence valable un an</li><li><Check size={14}/> Jusqu’à cinq demandes de suppression</li><li><Check size={14}/> Suivi prioritaire</li><li><Check size={14}/> Vérification de suivi sous 30 jours</li></ul><button onClick={()=>createOrder('complete',true)} className="button button-outline">Choisir · 299 $ / an <ArrowRight size={15}/></button></article></div><p className="pricing-note"><LockKeyhole size={13}/> Le scan coûte toujours 0 $. Les licences sont valables un an ; leur renouvellement se fait par un nouvel achat. Le paiement s’effectue sur Chariow.</p></div></section>


    {authReady && userId && authToken && <section className="dashboard-section section-pad" id="dashboard"><div className="container"><div className="section-label"><span>06</span> VOTRE ESPACE PERSONNEL</div><div className="section-heading-row"><div><h2>Votre <em>espace de suivi.</em></h2><p>Suivez vos analyses et vos demandes de nettoyage au même endroit.</p></div><button className="button button-outline" onClick={() => void loadDashboard()}>Actualiser le suivi <ArrowRight size={14}/></button></div>{dashboardError && <p className="form-error" role="alert">{dashboardError}</p>}<div className="dashboard-grid"><article className="dashboard-card"><h3>Analyses récentes</h3>{dashboard ? dashboard.scans.length ? dashboard.scans.map(scan=><div className="dashboard-row" key={scan.id}><ScanSearch size={15}/><span>Scan · {new Date(scan.created_at).toLocaleDateString()}</span><b>{scan.status}</b></div>) : <p>Aucune analyse pour ce compte.</p> : <p>{dashboardError || 'Chargement de vos analyses…'}</p>}</article><article className="dashboard-card"><h3>Commandes de nettoyage</h3>{dashboard ? dashboard.orders.length ? dashboard.orders.map(order=><div className="dashboard-row" key={order.id}><ShieldCheck size={15}/><span>{order.plan === 'guided' ? 'Nettoyage accompagné' : 'Nettoyage complet'} · {orderAmountLabel(order)}{order.selected_findings?.length ? ` · ${order.selected_findings.map(item => item.source_name).join(', ')}` : ''}</span><b>{orderStatusLabel(order.status)}</b></div>) : <p>Aucune commande de nettoyage pour le moment.</p> : <p>{dashboardError || 'Chargement de vos commandes…'}</p>}{cleanupDrafts.map(d=><div className="dashboard-row" key={d.id}><Sparkles size={15}/><span>Brouillon de demande de suppression</span><b>{d.status}</b></div>)}</article></div></div></section>}

    <section className="faq-section section-pad" id="faq"><div className="container faq-grid"><div><div className="section-label"><span>05</span> BON À SAVOIR</div><h2>Quelques réponses<br/>à vos <em>questions.</em></h2><p>La confidentialité doit être claire dès le départ. Voici quelques réponses utiles.</p><a href="mailto:hello@fingerprintscanner.example" className="text-link">Une question ? <ArrowUpRight size={15}/></a></div><div className="faq-list">{[
      ['Que recherche l’analyse gratuite ?', 'Elle recherche votre adresse dans les pages accessibles au public et les sources configurées. Vos résultats restent privés. Nous ne tentons pas d’accéder à des comptes ni à des bases de données restreintes.'],
      ['Garantissez-vous la suppression de mes informations ?', 'Aucun service ne peut garantir le retrait d’informations de sites tiers. Nous vous aidons à trouver la bonne procédure, préparer les demandes et suivre les réponses. Chaque site prend sa propre décision.'],
      ['Envoyez-vous des demandes de suppression sans mon accord ?', 'Non. Vous examinez et approuvez chaque demande avant son envoi. Nous ne contactons jamais un site et n’agissons jamais en votre nom sans votre accord.'],
      ['Comment protégez-vous mon adresse e-mail ?', 'Votre adresse e-mail sert uniquement à lancer l’analyse demandée et à gérer votre compte. Elle est chiffrée lors du stockage, son accès est limité et elle n’est conservée que le temps nécessaire.'],
      ['Puis-je analyser l’adresse e-mail d’une autre personne ?', 'FingerprintScanner est destiné au titulaire de l’adresse. Vous devez confirmer qu’elle vous appartient avant de lancer une analyse.'],
    ].map(([q,a])=><details className="faq-item" key={q}><summary>{q}<ChevronDown size={17}/></summary><p>{a}</p></details>)}</div></div></section>

    <section className="cta-section"><div className="container cta-inner"><div className="cta-icon"><Fingerprint size={23}/></div><div><span className="cta-kicker">VOTRE PROCHAINE ÉTAPE COMMENCE ICI</span><h2>Votre empreinte vous appartient.<br/><em>Découvrez-la en détail.</em></h2><p>Commencez par une analyse privée. Décidez de la suite quand vous le souhaitez.</p></div><a href="/scan" className="button button-white">Lancer mon analyse gratuite <ArrowRight size={16}/></a><div className="cta-orbit cta-orbit-a"/><div className="cta-orbit cta-orbit-b"/></div></section>

    <footer className="footer"><div className="container"><div className="footer-top"><div><Brand/><p>Découvrez votre empreinte numérique.<br/>Reprenez le contrôle de votre vie privée.</p></div><div className="footer-links"><a href="#how">Comment ça marche</a><a href="#pricing">Tarifs</a><a href="#faq">Questions fréquentes</a><a href="/privacy">Politique de confidentialité</a><a href="/terms">Conditions d’utilisation</a></div><a className="back-top" href="#top">Retour en haut <ArrowUpRight size={14}/></a></div><div className="footer-bottom"><span>© 2026 FingerprintScanner. Pour un Internet plus respectueux de votre vie privée.</span><span><i/> La confidentialité avant tout.</span></div></div></footer>
    {authModalMode && <AuthModal mode={authModalMode} initialEmail={email} onClose={() => { setAuthModalMode(null); if (!authToken) { localStorage.removeItem('fingerprintscanner_pending_checkout_plan'); setPendingCheckoutPlan(null); } }} onAuthenticated={(token, id, authenticatedEmail) => { setAuthToken(token); setUserId(id); setCheckoutEmail(authenticatedEmail); const savedPlan = localStorage.getItem('fingerprintscanner_pending_checkout_plan'); const plan = pendingCheckoutPlan || (savedPlan === 'guided' || savedPlan === 'complete' ? savedPlan : null); if (plan) { setCheckoutPlan(plan); setCheckoutFromPricing(true); setPendingCheckoutPlan(null); localStorage.removeItem('fingerprintscanner_pending_checkout_plan'); } void loadDashboard(token, id); }} />}
    {checkoutPlan && <CheckoutModal plan={checkoutPlan} email={checkoutEmail} onClose={() => { setCheckoutPlan(null); localStorage.removeItem('fingerprintscanner_pending_checkout_plan'); }} onSubmit={submitCheckout} />}
  </main>;
}
