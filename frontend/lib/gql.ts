import { nhost } from './nhost';

export async function gqlRequest<T = any>(query: string, variables: Record<string, any> = {}): Promise<T> {
  await nhost.auth.isAuthenticatedAsync();
  const token = nhost.auth.getAccessToken();

  if (!token) {
    throw new Error('Not authenticated yet — no access token available. Try refreshing the page after logging in.');
  }

  const res = await fetch('/api/graphql-proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (json.errors) {
    console.error('GraphQL errors:', json.errors);
    throw new Error(json.errors.map((e: any) => e.message).join('; '));
  }
  return json.data;
}