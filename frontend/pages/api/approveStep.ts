import type { NextApiRequest, NextApiResponse } from 'next';
import { gql, getCallerRole } from '../../lib/server/db';
import { runStepsFrom } from '../../lib/server/runner';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'POST only' });

  const { step_run_id } = req.body.input;
  const callerId = req.body.session_variables['x-hasura-user-id'];

  try {
    const data = await gql<{
      step_runs_by_pk: {
        id: string; status: string; org_id: string; workflow_run_id: string;
        workflow_step: { step_order: number; workflow_id: string };
      } | null;
    }>(
      `query($id: uuid!) {
        step_runs_by_pk(id: $id) {
          id status org_id workflow_run_id
          workflow_step { step_order workflow_id }
        }
      }`,
      { id: step_run_id }
    );

    const stepRun = data.step_runs_by_pk;
    if (!stepRun) return res.status(404).json({ message: 'step_run not found' });
    if (stepRun.status !== 'awaiting_approval') {
      return res.status(409).json({ message: `step_run is not awaiting approval (status: ${stepRun.status})` });
    }

    const role = await getCallerRole(callerId, stepRun.org_id);
    if (!role || !['owner', 'editor'].includes(role)) {
      return res.status(403).json({ message: 'Only an owner/editor in this org can approve this step' });
    }

    await gql(
      `mutation($id: uuid!, $approver: uuid!) {
        update_step_runs_by_pk(pk_columns: { id: $id }, _set: { status: "succeeded", approved_by: $approver, approved_at: "now()" }) { id }
      }`,
      { id: step_run_id, approver: callerId }
    );
    await gql(
      `mutation($id: uuid!) { update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: { status: "running" }) { id } }`,
      { id: stepRun.workflow_run_id }
    );

    await runStepsFrom(stepRun.workflow_run_id, stepRun.workflow_step.workflow_id, stepRun.org_id, stepRun.workflow_step.step_order + 1);

    return res.status(200).json({ workflow_run_id: stepRun.workflow_run_id, status: 'running' });
  } catch (err: any) {
    console.error('approveStep error', err);
    return res.status(500).json({ message: err.message ?? 'Internal error' });
  }
}
