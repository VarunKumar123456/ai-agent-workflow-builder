import { NhostClient } from '@nhost/nhost-js';
import { NhostApolloProvider } from '@nhost/react-apollo';

export const nhost = new NhostClient({
  subdomain: process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN!,
  region: process.env.NEXT_PUBLIC_NHOST_REGION!,
});

// Wrap _app.tsx (or app/layout.tsx) with:
//   <NhostReactProvider nhost={nhost}>
//     <NhostApolloProvider nhost={nhost}>{children}</NhostApolloProvider>
//   </NhostReactProvider>
// NhostApolloProvider auto-attaches the JWT and switches to a websocket link
// for subscriptions — this is what makes GraphQL subscriptions "just work"
// against Hasura without hand-rolling a split link.
export { NhostApolloProvider };
