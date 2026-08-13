// Vercel Serverless Function — Next.js Pages Router API route.
// Deployed URL: https://<your-app>.vercel.app/api/triggerWorkflowRun
// Point Hasura's triggerWorkflowRun Action Handler at this exact URL.

import type { NextApiRequest, NextApiResponse } from 'next';
import { gql, getCallerRole } from '../../lib/server/db';
import { runStepsFrom } from '../../lib/server/runner';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'POST only' });

  const { workflow_id } = req.body.input;
  const callerId = req.body.session_variables['x-hasura-user-id'];

  try {
    const wfData = await gql<{ workflows_by_pk: { org_id: string } | null }>(
      `query($id: uuid!) { workflows_by_pk(id: $id) { org_id } }`,
      { id: workflow_id }
    );
    const workflow = wfData.workflows_by_pk;
    if (!workflow) return res.status(404).json({ message: 'Workflow not found' });

    const role = await getCallerRole(callerId, workflow.org_id);
    if (!role || !['owner', 'editor'].includes(role)) {
      return res.status(403).json({ message: 'Only owners/editors can trigger a run in this org' });
    }

    const orgData = await gql<{ organizations_by_pk: { quota_used: number; quota_allowed: number } }>(
      `query($id: uuid!) { organizations_by_pk(id: $id) { quota_used quota_allowed } }`,
      { id: workflow.org_id }
    );
    if (orgData.organizations_by_pk.quota_used >= orgData.organizations_by_pk.quota_allowed) {
      return res.status(429).json({ message: 'Org usage quota exhausted for this period' });
    }

    const runData = await gql<{ insert_workflow_runs_one: { id: string } }>(
      `mutation($object: workflow_runs_insert_input!) { insert_workflow_runs_one(object: $object) { id } }`,
      {
        object: {
          workflow_id,
          org_id: workflow.org_id,
          status: 'running',
          triggered_by: callerId,
          trigger_type: 'manual',
        },
      }
    );
    const runId = runData.insert_workflow_runs_one.id;

    await runStepsFrom(runId, workflow_id, workflow.org_id, 0);

    return res.status(200).json({ id: runId });
  } catch (err: any) {
    console.error('triggerWorkflowRun error', err);
    return res.status(500).json({ message: err.message ?? 'Internal error' });
  }
}
