// URL: https://<your-app>.vercel.app/api/eventHandlers/notifyDispatch
// Point a Hasura Event Trigger on step_runs (operation: UPDATE) here.
import type { NextApiRequest, NextApiResponse } from 'next';
import { gql } from '../../../lib/server/db';
import { executeNotify } from '../../../lib/server/executors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const stepRunId = req.body.event.data.new.id;

  const data = await gql<{ step_runs_by_pk: { status: string; workflow_step: { type: string; config: any } } | null }>(
    `query($id: uuid!) { step_runs_by_pk(id: $id) { status workflow_step { type config } } }`,
    { id: stepRunId }
  );

  const stepRun = data.step_runs_by_pk;
  if (!stepRun || stepRun.workflow_step.type !== 'notify' || stepRun.status !== 'succeeded') {
    return res.status(200).json({ skipped: true });
  }

  const result = await executeNotify(stepRun.workflow_step.config, null);
  return res.status(200).json(result);
}
