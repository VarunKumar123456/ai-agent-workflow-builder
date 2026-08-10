// URL: https://<your-app>.vercel.app/api/eventHandlers/onDbEvent
// Point a Hasura Event Trigger (on whichever table your db_event triggers watch) here.
import type { NextApiRequest, NextApiResponse } from 'next';
import { gql } from '../../../lib/server/db';
import { runStepsFrom } from '../../../lib/server/runner';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { table, event } = req.body;

  const data = await gql<{ workflow_triggers: { id: string; workflow_id: string; org_id: string }[] }>(
    `query($tableName: String!, $op: String!) {
      workflow_triggers(where: { type: { _eq: "db_event" }, is_active: { _eq: true }, config: { _contains: { table: $tableName, on: $op } } }) {
        id workflow_id org_id
      }
    }`,
    { tableName: table.name, op: event.op }
  );

  await Promise.allSettled(
    data.workflow_triggers.map(async (trigger) => {
      const orgData = await gql<{ organizations_by_pk: { quota_used: number; quota_allowed: number } }>(
        `query($id: uuid!) { organizations_by_pk(id: $id) { quota_used quota_allowed } }`,
        { id: trigger.org_id }
      );
      if (orgData.organizations_by_pk.quota_used >= orgData.organizations_by_pk.quota_allowed) return;

      const runData = await gql<{ insert_workflow_runs_one: { id: string } }>(
        `mutation($object: workflow_runs_insert_input!) { insert_workflow_runs_one(object: $object) { id } }`,
        { object: { workflow_id: trigger.workflow_id, org_id: trigger.org_id, status: 'running', triggered_by: null, trigger_type: 'db_event' } }
      );
      return runStepsFrom(runData.insert_workflow_runs_one.id, trigger.workflow_id, trigger.org_id, 0);
    })
  );

  return res.status(200).json({ ok: true, matched: data.workflow_triggers.length });
}
