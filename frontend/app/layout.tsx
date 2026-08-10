'use client';

import { NhostReactProvider } from '@nhost/react';
import { nhost, NhostApolloProvider } from '../lib/nhost';
import { OrgProvider } from '../components/OrgContext';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NhostReactProvider nhost={nhost}>
          <NhostApolloProvider nhost={nhost}>
            <OrgProvider>{children}</OrgProvider>
          </NhostApolloProvider>
        </NhostReactProvider>
      </body>
    </html>
  );
}
