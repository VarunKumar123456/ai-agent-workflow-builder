// Thin GraphQL client for server-side Action handlers.
// Uses the Hasura admin secret — these handlers are the ONLY place that
// secret is used, and it never reaches the client. Every handler re-derives
// permissions from org_members itself instead of trusting the caller.

const HASURA_URL = process.env.HASURA_GRAPHQL_URL!; // e.g. https://<subdomain>.hasura.<region>.nhost.run/v1/graphql
const ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET!;

export async function gql<T = any>(query: string, variables: Record<string, any> = {}): Promise<T> {
  const res = await fetch(HASURA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// Resolve a caller's role in a given org. Returns null if not a member.
export async function getCallerRole(userId: string, orgId: string): Promise<'owner' | 'editor' | 'viewer' | null> {
  const data = await gql<{ org_members: { role: string }[] }>(
    `query($userId: uuid!, $orgId: uuid!) {
      org_members(where: { user_id: { _eq: $userId }, org_id: { _eq: $orgId } }) {
        role
      }
    }`,
    { userId, orgId }
  );
  return (data.org_members[0]?.role as any) ?? null;
}
