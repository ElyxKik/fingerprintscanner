import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FingerprintScanner — Reprenez le contrôle de votre vie privée',
  description: 'Découvrez votre empreinte numérique. Reprenez le contrôle de votre vie privée.',
  icons: { icon: '/icon.svg', shortcut: '/icon.svg' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>;
}
