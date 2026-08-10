// Hasura Action handler for: triggerWorkflowRun(workflow_id: uuid!) → workflow_run
//
// Wire this up in Hasura as an Action with handler = this function's deployed
// URL (nhost Serverless Functions: functions/triggerWorkflowRun.ts is
// auto-routed to /v1/functions/triggerWorkflowRun by nhost's convention —
// adjust export shape per nhost's function signature if it differs from
// plain Express-style (req, res)).
//
// This same runStepsFrom() is reused by approveStep.ts to resume a paused run.

import { gql, getCallerRole } from './lib/db';
import { withRetry } from './lib/retry';
import {
  executeLlmCall,
  executeHttpRequest,
  executeDbWrite,
  executeNotify,
  evaluateConditionalBranch,
} from './lib/executors';

interface HasuraActionRequest {
  input: { workflow_id: string };
  session_variables: { 'x-hasura-user-id': string };
}

export default async function handler(req: { body: HasuraActionRequest }, res: any) {
  const { workflow_id } = req.body.input;
  const callerId = req.body.session_variables['x-hasura-user-id'];

  try {
    // 1. Load workflow + org
    const wfData = await gql<{ workflows_by_pk: { org_id: string } | null }>(
      `query($id: uuid!) { workflows_by_pk(id: $id) { org_id } }`,
      { id: workflow_id }
    );
    const workflow = wfData.workflows_by_pk;
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    // 2. Verify caller is owner/editor in the workflow's org (Layer 1, re-checked
    //    here because Action handlers bypass table permissions via admin secret —
    //    this is the one place that check MUST be re-done in code)
    const role = await getCallerRole(callerId, workflow.org_id);
    if (!role || !['owner', 'editor'].includes(role)) {
      return res.status(403).json({ message: 'Only owners/editors can trigger a run in this org' });
    }

    // 3. Quota check
    const orgData = await gql<{ organizations_by_pk: { quota_used: number; quota_allowed: number } }>(
      `query($id: uuid!) { organizations_by_pk(id: $id) { quota_used quota_allowed } }`,
      { id: workflow.org_id }
    );
    const org = orgData.organizations_by_pk;
    if (org.quota_used >= org.quota_allowed) {
      return res.status(429).json({ message: 'Org usage quota exhausted for this period' });
    }

    // 4. Create the workflow_run
    const runData = await gql<{ insert_workflow_runs_one: { id: string } }>(
      `mutation($object: workflow_runs_insert_input!) {
        insert_workflow_runs_one(object: $object) { id }
      }`,
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

    // 5. Execute steps in order (fire-and-continue in background is fine for
    //    a Hasura Action in most nhost function runtimes; for simplicity here
    //    we await it synchronously — the subscription is what gives the
    //    frontend live progress regardless of whether this call blocks).
    await runStepsFrom(runId, workflow_id, workflow.org_id, 0);

    return res.status(200).json({ id: runId });
  } catch (err: any) {
    console.error('triggerWorkflowRun error', err);
    return res.status(500).json({ message: err.message ?? 'Internal error' });
  }
}

// ---------------------------------------------------------------------------
// Shared executor: runs workflow_steps in order starting at `fromOrder`.
// Called fresh by triggerWorkflowRun (fromOrder=0) and by approveStep
// (fromOrder = approved step's order + 1).
// ---------------------------------------------------------------------------
export async function runStepsFrom(runId: string, workflowId: string, orgId: string, fromOrder: number) {
  const stepsData = await gql<{ workflow_steps: any[] }>(
    `query($wid: uuid!, $from: Int!) {
      workflow_steps(where: { workflow_id: { _eq: $wid }, step_order: { _gte: $from } }, order_by: { step_order: asc }) {
        id step_order type config
      }
    }`,
    { wid: workflowId, from: fromOrder }
  );
  const steps = stepsData.workflow_steps;

  let priorOutput: any = null;
  let skipUntilOrder: number | null = null; // used by conditional_branch to skip a branch's steps

  for (const step of steps) {
    if (skipUntilOrder !== null && step.step_order < skipUntilOrder) continue;
    skipUntilOrder = null;

    const stepRun = await createStepRun(runId, step.id, orgId, priorOutput);

    try {
      if (step.type === 'approval_gate') {
        await updateStepRun(stepRun.id, { status: 'awaiting_approval' });
        await updateWorkflowRun(runId, { status: 'paused' });
        return; // STOP — approveStep.ts resumes execution later
      }

      let output: any;
      let attempts = 0;

      if (step.type === 'llm_call') {
        output = await withRetry(() => executeLlmCall(step.config, priorOutput), {
          onAttempt: (a) => (attempts = a),
        });
        await incrementQuota(orgId);
      } else if (step.type === 'http_request') {
        output = await withRetry(() => executeHttpRequest(step.config, priorOutput), {
          onAttempt: (a) => (attempts = a),
        });
        await incrementQuota(orgId);
      } else if (step.type === 'db_write') {
        output = await executeDbWrite(step.config, priorOutput, orgId, stepRun.id, gql);
        attempts = 1;
      } else if (step.type === 'notify') {
        // Actual delivery happens via a Hasura Event Trigger watching this
        // step_runs row (type=notify, status=succeeded) → notifyWebhookHandler.
        output = { queued: true };
        attempts = 1;
      } else if (step.type === 'conditional_branch') {
        const branch = evaluateConditionalBranch(step.config, priorOutput);
        output = { branch };
        attempts = 1;
        // config.skipStepsIfFalse: step_order to jump to when branch === 'false'
        if (branch === 'false' && typeof step.config.jumpToOrderIfFalse === 'number') {
          skipUntilOrder = step.config.jumpToOrderIfFalse;
        }
      } else {
        output = null;
        attempts = 1;
      }

      await updateStepRun(stepRun.id, {
        status: 'succeeded',
        output,
        attempt_count: attempts,
        finished_at: new Date().toISOString(),
      });
      priorOutput = output;
    } catch (err: any) {
      await updateStepRun(stepRun.id, {
        status: 'failed',
        error: String(err.message ?? err),
        finished_at: new Date().toISOString(),
      });
      await updateWorkflowRun(runId, {
        status: 'failed',
        error: `Step ${step.step_order} (${step.type}) failed: ${err.message}`,
        finished_at: new Date().toISOString(),
      });
      return;
    }
  }

  // All steps completed
  await updateWorkflowRun(runId, { status: 'succeeded', finished_at: new Date().toISOString() });
}

async function createStepRun(runId: string, stepId: string, orgId: string, input: any) {
  const data = await gql<{ insert_step_runs_one: { id: string } }>(
    `mutation($object: step_runs_insert_input!) { insert_step_runs_one(object: $object) { id } }`,
    { object: { workflow_run_id: runId, workflow_step_id: stepId, org_id: orgId, status: 'running', input, started_at: new Date().toISOString() } }
  );
  return data.insert_step_runs_one;
}

async function updateStepRun(id: string, set: Record<string, any>) {
  await gql(
    `mutation($id: uuid!, $set: step_runs_set_input!) { update_step_runs_by_pk(pk_columns: { id: $id }, _set: $set) { id } }`,
    { id, set }
  );
}

async function updateWorkflowRun(id: string, set: Record<string, any>) {
  await gql(
    `mutation($id: uuid!, $set: workflow_runs_set_input!) { update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: $set) { id } }`,
    { id, set }
  );
}

async function incrementQuota(orgId: string) {
  await gql(
    `mutation($id: uuid!) {
      update_organizations_by_pk(pk_columns: { id: $id }, _inc: { quota_used: 1 }) { id }
    }`,
    { id: orgId }
  );
}
