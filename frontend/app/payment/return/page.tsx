import Link from 'next/link';
import { ArrowRight, Clock3, ShieldCheck } from 'lucide-react';

export default function PaymentReturnPage() {
  return <main className="payment-return-page">
    <section className="payment-return-card">
      <span className="payment-return-icon"><Clock3 size={25}/></span>
      <p className="section-label">RETOUR DE PAIEMENT</p>
      <h1>Nous vérifions votre paiement.</h1>
      <p>Chariow nous confirmera le statut de la transaction de manière sécurisée. Votre commande apparaîtra dans votre espace personnel dès que la confirmation sera reçue.</p>
      <div className="payment-return-note"><ShieldCheck size={16}/> Ne relancez pas le paiement si Chariow vous a déjà confirmé la transaction.</div>
      <Link href="/#dashboard" className="button button-primary">Retourner sur FingerprintScanner <ArrowRight size={16}/></Link>
    </section>
  </main>;
}
