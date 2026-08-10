// Shared step-execution engine. Extracted into its own file (rather than
// living inside triggerWorkflowRun.ts) so approveStep.ts can import
// runStepsFrom() without importing a Next.js API route module (which
// Next.js doesn't like being imported as a plain function elsewhere).

import { gql } from './db';
import { withRetry } from './retry';
import {
  executeLlmCall,
  executeHttpRequest,
  executeDbWrite,
  evaluateConditionalBranch,
} from './executors';

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
  let skipUntilOrder: number | null = null;

  for (const step of steps) {
    if (skipUntilOrder !== null && step.step_order < skipUntilOrder) continue;
    skipUntilOrder = null;

    const stepRun = await createStepRun(runId, step.id, orgId, priorOutput);

    try {
      if (step.type === 'approval_gate') {
        await updateStepRun(stepRun.id, { status: 'awaiting_approval' });
        await updateWorkflowRun(runId, { status: 'paused' });
        return;
      }

      let output: any;
      let attempts = 0;

      if (step.type === 'llm_call') {
        output = await withRetry(() => executeLlmCall(step.config, priorOutput), { onAttempt: (a) => (attempts = a) });
        await incrementQuota(orgId);
      } else if (step.type === 'http_request') {
        output = await withRetry(() => executeHttpRequest(step.config, priorOutput), { onAttempt: (a) => (attempts = a) });
        await incrementQuota(orgId);
      } else if (step.type === 'db_write') {
        output = await executeDbWrite(step.config, priorOutput, orgId, stepRun.id, gql);
        attempts = 1;
      } else if (step.type === 'notify') {
        output = { queued: true }; // actual send happens via notifyDispatch event handler
        attempts = 1;
      } else if (step.type === 'conditional_branch') {
        const branch = evaluateConditionalBranch(step.config, priorOutput);
        output = { branch };
        attempts = 1;
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
      await updateStepRun(stepRun.id, { status: 'failed', error: String(err.message ?? err), finished_at: new Date().toISOString() });
      await updateWorkflowRun(runId, {
        status: 'failed',
        error: `Step ${step.step_order} (${step.type}) failed: ${err.message}`,
        finished_at: new Date().toISOString(),
      });
      return;
    }
  }

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
  await gql(`mutation($id: uuid!, $set: step_runs_set_input!) { update_step_runs_by_pk(pk_columns: { id: $id }, _set: $set) { id } }`, { id, set });
}
async function updateWorkflowRun(id: string, set: Record<string, any>) {
  await gql(`mutation($id: uuid!, $set: workflow_runs_set_input!) { update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: $set) { id } }`, { id, set });
}
async function incrementQuota(orgId: string) {
  await gql(`mutation($id: uuid!) { update_organizations_by_pk(pk_columns: { id: $id }, _inc: { quota_used: 1 }) { id } }`, { id: orgId });
}
