import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { THEME_INIT_SCRIPT } from '@/components/theme';
import './globals.css';

// Geist and Geist Mono are the specified faces: mono carries every figure in
// the product, with tabular numerals so columns of money line up.
const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

/**
 * What a shared link looks like before anyone opens it.
 *
 * The title is the brand line from axtara.ai, not the module name: a link to
 * this lands in a chat window where "Capital calls" reads as a to-do rather
 * than a product. The description says what is actually behind it.
 *
 * `openGraph` is set explicitly rather than left to fall back on the title and
 * description, so the card is the same everywhere it is pasted — and
 * `metadataBase` is what lets a relative image URL resolve if one is added.
 */
const TITLE = 'Axtara — AI-native fund administration';
const DESCRIPTION = 'Capital call allocation, tie-out checks and investor notices.';

export const metadata: Metadata = {
  metadataBase: new URL('https://fund.axtara.ai'),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: 'Axtara',
    url: 'https://fund.axtara.ai',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is scoped to this one element on purpose: the
    // theme script below adds `dark` to <html> before React hydrates, so the
    // server markup and the live DOM legitimately disagree about this class and
    // nothing else. Without it React reports a mismatch on every page load.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Applies the stored theme before first paint, so a dark-mode user
            never sees a white flash on navigation. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
