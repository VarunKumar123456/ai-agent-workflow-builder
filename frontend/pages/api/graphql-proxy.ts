// Proxies browser GraphQL requests to Hasura server-side.
// The browser calls THIS same-origin endpoint (no CORS possible), and this
// serverless function forwards to Hasura server-to-server (CORS doesn't
// apply to server-to-server fetch at all).
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'POST only' });

  const authHeader = req.headers['authorization'] as string | undefined;

  try {
    const hasuraRes = await fetch(process.env.HASURA_GRAPHQL_URL!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify(req.body),
    });
    const data = await hasuraRes.json();
    return res.status(hasuraRes.status).json(data);
  } catch (err: any) {
    console.error('graphql-proxy error', err);
    return res.status(500).json({ errors: [{ message: err.message ?? 'Proxy error' }] });
  }
}
