import type { NextApiRequest, NextApiResponse } from 'next';
import { getCallerRole, gql } from '../../lib/server/db';

const OWNER_ONLY_TRIGGER_TYPES = new Set(['webhook']);

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'POST only' });

  const { id, workflow_id, type, config } = req.body.input;
  const callerId = req.body.session_variables['x-hasura-user-id'];

  try {
    const minRole = OWNER_ONLY_TRIGGER_TYPES.has(type) ? 'owner' : 'editor';
    const orgId = await requireRole(callerId, workflow_id, minRole);

    const object: any = { workflow_id, org_id: orgId, type, config };
    if (id) object.id = id;

    const data = await gql<{ insert_workflow_triggers_one: any }>(
      `mutation($object: workflow_triggers_insert_input!) {
        insert_workflow_triggers_one(
          object: $object
          on_conflict: { constraint: workflow_triggers_pkey, update_columns: [type, config, is_active] }
        ) { id type config webhook_token }
      }`,
      { object }
    );
    return res.status(200).json(data.insert_workflow_triggers_one);
  } catch (err: any) {
    return res.status(err.status ?? 500).json({ message: err.message ?? 'Internal error' });
  }
}