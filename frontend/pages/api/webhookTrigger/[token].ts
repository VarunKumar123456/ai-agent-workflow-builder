// URL: https://<your-app>.vercel.app/api/webhookTrigger/<token>
import type { NextApiRequest, NextApiResponse } from 'next';
import { gql } from '../../../lib/server/db';
import { runStepsFrom } from '../../../lib/server/runner';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = req.query.token as string;

  try {
    const data = await gql<{ workflow_triggers: { id: string; workflow_id: string; org_id: string; is_active: boolean }[] }>(
      `query($token: uuid!) {
        workflow_triggers(where: { webhook_token: { _eq: $token }, type: { _eq: "webhook" } }) { id workflow_id org_id is_active }
      }`,
      { token }
    );
    const trigger = data.workflow_triggers[0];
    if (!trigger || !trigger.is_active) return res.status(404).json({ message: 'Unknown or inactive webhook' });

    const orgData = await gql<{ organizations_by_pk: { quota_used: number; quota_allowed: number } }>(
      `query($id: uuid!) { organizations_by_pk(id: $id) { quota_used quota_allowed } }`,
      { id: trigger.org_id }
    );
    if (orgData.organizations_by_pk.quota_used >= orgData.organizations_by_pk.quota_allowed) {
      return res.status(429).json({ message: 'Org quota exhausted' });
    }

    const runData = await gql<{ insert_workflow_runs_one: { id: string } }>(
      `mutation($object: workflow_runs_insert_input!) { insert_workflow_runs_one(object: $object) { id } }`,
      { object: { workflow_id: trigger.workflow_id, org_id: trigger.org_id, status: 'running', triggered_by: null, trigger_type: 'webhook' } }
    );
    const runId = runData.insert_workflow_runs_one.id;

    runStepsFrom(runId, trigger.workflow_id, trigger.org_id, 0).catch((e) => console.error('webhook-triggered run failed', e));

    return res.status(202).json({ workflow_run_id: runId, status: 'accepted' });
  } catch (err: any) {
    console.error('webhookTrigger error', err);
    return res.status(500).json({ message: err.message ?? 'Internal error' });
  }
}
