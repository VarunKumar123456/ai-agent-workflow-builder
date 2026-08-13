// URL: https://<your-app>.vercel.app/api/scheduledTrigger
// Vercel Cron Jobs calls this on a schedule (configured in vercel.json).
import type { NextApiRequest, NextApiResponse } from 'next';
import { gql } from '../../lib/server/db';
import { runStepsFrom } from '../../lib/server/runner';

function isDue(cronExpr: string, now: Date): boolean {
  const [min] = cronExpr.split(' ');
  if (min === '*') return true;
  if (min.startsWith('*/')) return now.getMinutes() % parseInt(min.slice(2), 10) === 0;
  return parseInt(min, 10) === now.getMinutes();
}

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const now = new Date();

  const data = await gql<{ workflow_triggers: { id: string; workflow_id: string; org_id: string; config: { cron: string } }[] }>(
    `query { workflow_triggers(where: { type: { _eq: "scheduled" }, is_active: { _eq: true } }) { id workflow_id org_id config } }`
  );
  const due = data.workflow_triggers.filter((t) => isDue(t.config.cron, now));

  const results = await Promise.allSettled(
    due.map(async (trigger) => {
      const orgData = await gql<{ organizations_by_pk: { quota_used: number; quota_allowed: number } }>(
        `query($id: uuid!) { organizations_by_pk(id: $id) { quota_used quota_allowed } }`,
        { id: trigger.org_id }
      );
      if (orgData.organizations_by_pk.quota_used >= orgData.organizations_by_pk.quota_allowed) {
        return { skipped: 'quota_exhausted', trigger: trigger.id };
      }
      const runData = await gql<{ insert_workflow_runs_one: { id: string } }>(
        `mutation($object: workflow_runs_insert_input!) { insert_workflow_runs_one(object: $object) { id } }`,
        { object: { workflow_id: trigger.workflow_id, org_id: trigger.org_id, status: 'running', triggered_by: null, trigger_type: 'scheduled' } }
      );
      const runId = runData.insert_workflow_runs_one.id;
      await runStepsFrom(runId, trigger.workflow_id, trigger.org_id, 0);
      return { started: runId, trigger: trigger.id };
    })
  );

  return res.status(200).json({ checked: data.workflow_triggers.length, due: due.length, results });
}
