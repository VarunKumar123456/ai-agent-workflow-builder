// Hasura Actions:
//   upsertWorkflowStep(workflow_id, step_order, type, config, id: uuid) → workflow_steps
//   upsertWorkflowTrigger(workflow_id, type, config, id: uuid) → workflow_triggers
//
// Enforces Layer 2, Rule A: db_write steps, notify steps, and webhook
// triggers require the caller to be an OWNER (not just editor) in the
// workflow's org — stricter than the baseline editor/owner Hasura permission
// on the raw tables. See hasura/metadata/LAYER2.md.

import { gql, getCallerRole } from './lib/db';

const OWNER_ONLY_STEP_TYPES = new Set(['db_write', 'notify']);
const OWNER_ONLY_TRIGGER_TYPES = new Set(['webhook']);

interface StepInput {
  input: { id?: string; workflow_id: string; step_order: number; type: string; config: any };
  session_variables: { 'x-hasura-user-id': string };
}
interface TriggerInput {
  input: { id?: string; workflow_id: string; type: string; config: any };
  session_variables: { 'x-hasura-user-id': string };
}

async function requireRole(callerId: string, workflowId: string, minRole: 'owner' | 'editor') {
  const wfData = await gql<{ workflows_by_pk: { org_id: string } | null }>(
    `query($id: uuid!) { workflows_by_pk(id: $id) { org_id } }`,
    { id: workflowId }
  );
  if (!wfData.workflows_by_pk) throw { status: 404, message: 'Workflow not found' };

  const role = await getCallerRole(callerId, wfData.workflows_by_pk.org_id);
  const allowed = minRole === 'owner' ? role === 'owner' : role === 'owner' || role === 'editor';
  if (!allowed) throw { status: 403, message: `Requires ${minRole} role in this org` };
  return wfData.workflows_by_pk.org_id;
}

export async function upsertWorkflowStep(req: { body: StepInput }, res: any) {
  const { id, workflow_id, step_order, type, config } = req.body.input;
  const callerId = req.body.session_variables['x-hasura-user-id'];

  try {
    const minRole = OWNER_ONLY_STEP_TYPES.has(type) ? 'owner' : 'editor';
    const orgId = await requireRole(callerId, workflow_id, minRole);

    const data = await gql<{ insert_workflow_steps_one: any }>(
      `mutation($object: workflow_steps_insert_input!) {
        insert_workflow_steps_one(
          object: $object
          on_conflict: { constraint: workflow_steps_pkey, update_columns: [step_order, type, config] }
        ) { id step_order type config }
      }`,
      { object: { id, workflow_id, org_id: orgId, step_order, type, config } }
    );
    return res.status(200).json(data.insert_workflow_steps_one);
  } catch (err: any) {
    return res.status(err.status ?? 500).json({ message: err.message ?? 'Internal error' });
  }
}

export async function upsertWorkflowTrigger(req: { body: TriggerInput }, res: any) {
  const { id, workflow_id, type, config } = req.body.input;
  const callerId = req.body.session_variables['x-hasura-user-id'];

  try {
    const minRole = OWNER_ONLY_TRIGGER_TYPES.has(type) ? 'owner' : 'editor';
    const orgId = await requireRole(callerId, workflow_id, minRole);

    const data = await gql<{ insert_workflow_triggers_one: any }>(
      `mutation($object: workflow_triggers_insert_input!) {
        insert_workflow_triggers_one(
          object: $object
          on_conflict: { constraint: workflow_triggers_pkey, update_columns: [type, config, is_active] }
        ) { id type config webhook_token }
      }`,
      { object: { id, workflow_id, org_id: orgId, type, config } }
    );
    return res.status(200).json(data.insert_workflow_triggers_one);
  } catch (err: any) {
    return res.status(err.status ?? 500).json({ message: err.message ?? 'Internal error' });
  }
}
