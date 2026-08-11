// Minimal GraphQL client — replaces Apollo Client entirely.
// Apollo was silently failing due to a version conflict; this has zero
// dependency risk since it's just fetch(). Subscriptions become polling
// (see RunView.tsx) instead of real websockets — a deliberate trade-off
// under time pressure, still gives visibly "live" updates every 1.5s.

import { nhost } from './nhost';

export async function gqlRequest<T = any>(query: string, variables: Record<string, any> = {}): Promise<T> {
  const session = nhost.auth.getSession();
  const token = session?.accessToken;

  const res = await fetch(
    `https://${process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN}.graphql.${process.env.NEXT_PUBLIC_NHOST_REGION}.nhost.run/v1`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  const json = await res.json();
  if (json.errors) {
    console.error('GraphQL errors:', json.errors);
    throw new Error(json.errors.map((e: any) => e.message).join('; '));
  }
  return json.data;
}
