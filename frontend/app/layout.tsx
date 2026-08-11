'use client';

import { NhostReactProvider } from '@nhost/react';
import { nhost } from '../lib/nhost';
import { OrgProvider } from '../components/OrgContext';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NhostReactProvider nhost={nhost}>
          <OrgProvider>{children}</OrgProvider>
        </NhostReactProvider>
      </body>
    </html>
  );
}
