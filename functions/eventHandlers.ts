// Targets for two Hasura EVENT TRIGGERS (configure in console/metadata,
// pointing at these two function URLs):
//
// 1. `db_event_watch` — on whichever table(s) your db_event triggers
//    reference (e.g. INSERT on `leads`). Hasura Event Triggers are
//    per-table, so in practice: for each table a workflow_trigger names in
//    its config ({"table": "leads", "on": "INSERT"}), add a Hasura Event
//    Trigger on that table pointing at `onDbEvent` below. The handler looks
//    up which workflow_triggers care about this table+op and starts a run
//    for each.
//
// 2. `notify_dispatch` — on step_runs, filtered (via the event trigger's
//    own WHERE-like column-update filter, or checked here) to UPDATE where
//    the row's step type is `notify` and status became `succeeded`. Hasura
//    Event Triggers don't support arbitrary WHERE, so this handler checks
//    the step type itself and no-ops otherwise. This satisfies "notify
//    implemented as an Event Trigger" — the actual Slack/email send is
//    decoupled from the synchronous step-execution loop.

import { gql } from './lib/db';
import { runStepsFrom } from './triggerWorkflowRun';
import { executeNotify } from './lib/executors';

export async function onDbEvent(req: { body: { table: { name: string }; event: { op: string; data: { new: any } } } }, res: any) {
  const { table, event } = req.body;

  const data = await gql<{
    workflow_triggers: { id: string; workflow_id: string; org_id: string }[];
  }>(
    `query($tableName: String!, $op: String!) {
      workflow_triggers(
        where: {
          type: { _eq: "db_event" }
          is_active: { _eq: true }
          config: { _contains: { table: $tableName, on: $op } }
        }
      ) { id workflow_id org_id }
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
        {
          object: {
            workflow_id: trigger.workflow_id,
            org_id: trigger.org_id,
            status: 'running',
            triggered_by: null,
            trigger_type: 'db_event',
          },
        }
      );
      return runStepsFrom(runData.insert_workflow_runs_one.id, trigger.workflow_id, trigger.org_id, 0);
    })
  );

  return res.status(200).json({ ok: true, matched: data.workflow_triggers.length });
}

export async function notifyDispatch(req: { body: { event: { data: { new: any } } } }, res: any) {
  const stepRunId = req.body.event.data.new.id;

  const data = await gql<{
    step_runs_by_pk: { status: string; workflow_step: { type: string; config: any } } | null;
  }>(
    `query($id: uuid!) {
      step_runs_by_pk(id: $id) { status workflow_step { type config } }
    }`,
    { id: stepRunId }
  );

  const stepRun = data.step_runs_by_pk;
  if (!stepRun || stepRun.workflow_step.type !== 'notify' || stepRun.status !== 'succeeded') {
    return res.status(200).json({ skipped: true });
  }

  const result = await executeNotify(stepRun.workflow_step.config, null);
  return res.status(200).json(result);
}
