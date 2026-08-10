// Inbound webhook endpoint: POST /v1/functions/webhookTrigger/:token
// External systems call this to start a run WITHOUT a user session — so
// there's no session_variables to trust. Auth here is the unguessable
// per-trigger `webhook_token` (uuid) stored on workflow_triggers, not a role
// check (there's no user; role/org gating doesn't apply to inbound webhooks,
// only quota + trigger existence + is_active do).

import { gql } from './lib/db';
import { runStepsFrom } from './triggerWorkflowRun';

export default async function handler(req: { params: { token: string }; body: any }, res: any) {
  const { token } = req.params;

  try {
    const data = await gql<{
      workflow_triggers: { id: string; workflow_id: string; org_id: string; is_active: boolean }[];
    }>(
      `query($token: uuid!) {
        workflow_triggers(where: { webhook_token: { _eq: $token }, type: { _eq: "webhook" } }) {
          id workflow_id org_id is_active
        }
      }`,
      { token }
    );

    const trigger = data.workflow_triggers[0];
    if (!trigger || !trigger.is_active) {
      return res.status(404).json({ message: 'Unknown or inactive webhook' });
    }

    const orgData = await gql<{ organizations_by_pk: { quota_used: number; quota_allowed: number } }>(
      `query($id: uuid!) { organizations_by_pk(id: $id) { quota_used quota_allowed } }`,
      { id: trigger.org_id }
    );
    if (orgData.organizations_by_pk.quota_used >= orgData.organizations_by_pk.quota_allowed) {
      return res.status(429).json({ message: 'Org quota exhausted' });
    }

    const runData = await gql<{ insert_workflow_runs_one: { id: string } }>(
      `mutation($object: workflow_runs_insert_input!) { insert_workflow_runs_one(object: $object) { id } }`,
      {
        object: {
          workflow_id: trigger.workflow_id,
          org_id: trigger.org_id,
          status: 'running',
          triggered_by: null,
          trigger_type: 'webhook',
        },
      }
    );
    const runId = runData.insert_workflow_runs_one.id;

    // Don't block the inbound webhook response on full execution.
    runStepsFrom(runId, trigger.workflow_id, trigger.org_id, 0).catch((e) =>
      console.error('webhook-triggered run failed', e)
    );

    return res.status(202).json({ workflow_run_id: runId, status: 'accepted' });
  } catch (err: any) {
    console.error('webhookTrigger error', err);
    return res.status(500).json({ message: err.message ?? 'Internal error' });
  }
}
