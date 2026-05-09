import type { Metadata } from 'next';
import { AdminErrorBoundary } from '../components/admin-error-boundary';

export const metadata: Metadata = {
  title: 'IPL 2026 Auction — Admin Console',
  description: 'Operator control panel for the IPL 2026 multi-agent auction',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AdminErrorBoundary>{children}</AdminErrorBoundary>
      </body>
    </html>
  );
}
