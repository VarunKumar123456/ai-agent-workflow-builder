// Scheduled function. Register in nhost's config (nhost/config.yaml or the
// nhost Dashboard → Run Services → Scheduled) as a cron job, one entry per
// active `scheduled` trigger's cron expression — OR run this single function
// on a tight fixed cron (e.g. every minute) and let it fan out to every due
// trigger, which is simpler to manage and what's implemented below.
//
// nhost config.yaml snippet:
//   functions:
//     schedules:
//       - schedule: "* * * * *"
//         request: "@/functions/scheduledTrigger.ts"

import { gql } from './lib/db';
import { runStepsFrom } from './triggerWorkflowRun';

// naive cron matcher for "*/N * * * *" and exact "M H * * *" style patterns
// (swap for a real cron library like `cron-parser` in production).
function isDue(cronExpr: string, now: Date): boolean {
  const [min] = cronExpr.split(' ');
  if (min === '*') return true;
  if (min.startsWith('*/')) {
    const n = parseInt(min.slice(2), 10);
    return now.getMinutes() % n === 0;
  }
  return parseInt(min, 10) === now.getMinutes();
}

export default async function handler(_req: any, res: any) {
  const now = new Date();

  const data = await gql<{
    workflow_triggers: { id: string; workflow_id: string; org_id: string; config: { cron: string } }[];
  }>(
    `query {
      workflow_triggers(where: { type: { _eq: "scheduled" }, is_active: { _eq: true } }) {
        id workflow_id org_id config
      }
    }`
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
        {
          object: {
            workflow_id: trigger.workflow_id,
            org_id: trigger.org_id,
            status: 'running',
            triggered_by: null,
            trigger_type: 'scheduled',
          },
        }
      );
      const runId = runData.insert_workflow_runs_one.id;
      await runStepsFrom(runId, trigger.workflow_id, trigger.org_id, 0);
      return { started: runId, trigger: trigger.id };
    })
  );

  return res.status(200).json({ checked: data.workflow_triggers.length, due: due.length, results });
}
