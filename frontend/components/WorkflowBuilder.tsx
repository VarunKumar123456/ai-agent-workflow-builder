'use client';

import { useState } from 'react';
import { gqlRequest } from '../lib/gql';

const STEP_TYPES = ['llm_call', 'http_request', 'db_write', 'notify', 'conditional_branch', 'approval_gate'];
const TRIGGER_TYPES = ['webhook', 'scheduled', 'db_event'];
const OWNER_ONLY_STEPS = new Set(['db_write', 'notify']);
const OWNER_ONLY_TRIGGERS = new Set(['webhook']);

const UPSERT_WORKFLOW = `
  mutation UpsertWorkflow($id: uuid, $org_id: uuid!, $name: String!, $description: String) {
    insert_workflows_one(
      object: { id: $id, org_id: $org_id, name: $name, description: $description }
      on_conflict: { constraint: workflows_pkey, update_columns: [name, description] }
    ) { id name }
  }
`;
const UPSERT_STEP = `
  mutation UpsertWorkflowStep($id: uuid, $workflow_id: uuid!, $step_order: Int!, $type: String!, $config: json!) {
    upsertWorkflowStep(id: $id, workflow_id: $workflow_id, step_order: $step_order, type: $type, config: $config) {
      id step_order type config
    }
  }
`;
const UPSERT_TRIGGER = `
  mutation UpsertWorkflowTrigger($id: uuid, $workflow_id: uuid!, $type: String!, $config: json!) {
    upsertWorkflowTrigger(id: $id, workflow_id: $workflow_id, type: $type, config: $config) {
      id type config webhook_token
    }
  }
`;

export default function WorkflowBuilder({
  orgId, workflowId, workflow, readOnly, role, onClose,
}: {
  orgId: string; workflowId: string | null; workflow: any;
  readOnly: boolean; role: 'owner' | 'editor' | 'viewer' | null; onClose: () => void;
}) {
  const [name, setName] = useState(workflow?.name ?? '');
  const [steps, setSteps] = useState<any[]>(workflow?.workflow_steps ?? []);
  const [triggers, setTriggers] = useState<any[]>(workflow?.workflow_triggers ?? []);
  const [currentWorkflowId, setCurrentWorkflowId] = useState<string | null>(workflowId);

  const canAddStepType = (type: string) => role === 'owner' || (!OWNER_ONLY_STEPS.has(type) && role === 'editor');
  const canAddTriggerType = (type: string) => role === 'owner' || (!OWNER_ONLY_TRIGGERS.has(type) && role === 'editor');

  const saveWorkflowMeta = async () => {
    const res: any = await gqlRequest(UPSERT_WORKFLOW, { id: currentWorkflowId, org_id: orgId, name, description: '' });
    const id = res.insert_workflows_one.id;
    setCurrentWorkflowId(id);
    return id;
  };

  const addStep = async (type: string) => {
    if (!canAddStepType(type)) return alert(`Only an owner can add a ${type} step.`);
    try {
      const wfId = currentWorkflowId ?? (await saveWorkflowMeta());
      const res: any = await gqlRequest(UPSERT_STEP, { id: null, workflow_id: wfId, step_order: steps.length, type, config: {} });
      setSteps([...steps, res.upsertWorkflowStep]);
    } catch (e: any) {
      alert('Failed: ' + e.message);
    }
  };

  const addTrigger = async (type: string) => {
    if (!canAddTriggerType(type)) return alert(`Only an owner can add a ${type} trigger.`);
    try {
      const wfId = currentWorkflowId ?? (await saveWorkflowMeta());
      const res: any = await gqlRequest(UPSERT_TRIGGER, { id: null, workflow_id: wfId, type, config: {} });
      setTriggers([...triggers, res.upsertWorkflowTrigger]);
    } catch (e: any) {
      alert('Failed: ' + e.message);
    }
  };

  const updateStepConfig = async (stepId: string, config: any) => {
    const step = steps.find((s: any) => s.id === stepId);
    try {
      await gqlRequest(UPSERT_STEP, { id: stepId, workflow_id: currentWorkflowId, step_order: step.step_order, type: step.type, config });
      setSteps(steps.map((s: any) => (s.id === stepId ? { ...s, config } : s)));
    } catch (e: any) {
      alert('Failed: ' + e.message);
    }
  };

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        <h2>{readOnly ? 'View workflow' : currentWorkflowId ? 'Edit workflow' : 'New workflow'}</h2>

        <input
          disabled={readOnly}
          placeholder="Workflow name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveWorkflowMeta}
          style={{ width: '100%', marginBottom: 12 }}
        />

        <h4>Steps (in order)</h4>
        <ol>
          {steps.slice().sort((a, b) => a.step_order - b.step_order).map((step: any) => (
            <li key={step.id} style={{ marginBottom: 8 }}>
              <strong>{step.type}</strong>{' '}
              <textarea
                disabled={readOnly}
                defaultValue={JSON.stringify(step.config, null, 0)}
                style={{ width: '60%' }}
                onBlur={(e) => {
                  try { updateStepConfig(step.id, JSON.parse(e.target.value)); }
                  catch { alert('Invalid JSON config'); }
                }}
              />
            </li>
          ))}
        </ol>

        {!readOnly && (
          <div style={{ marginBottom: 16 }}>
            {STEP_TYPES.map((t) => (
              <button key={t} onClick={() => addStep(t)} disabled={!canAddStepType(t)} title={!canAddStepType(t) ? 'Owner only' : ''}>
                + {t}{OWNER_ONLY_STEPS.has(t) ? ' 🔒' : ''}
              </button>
            ))}
          </div>
        )}

        <h4>Triggers</h4>
        <p style={{ fontSize: 12, color: '#666' }}>Manual trigger is implicit (the Run ▶ button). Add extra triggers below.</p>
        <ul>
          {triggers.map((t: any) => (
            <li key={t.id}>
              {t.type}
              {t.type === 'webhook' && t.webhook_token && (
                <code style={{ marginLeft: 8, fontSize: 12 }}>/api/webhookTrigger/{t.webhook_token}</code>
              )}
            </li>
          ))}
        </ul>

        {!readOnly && (
          <div>
            {TRIGGER_TYPES.map((t) => (
              <button key={t} onClick={() => addTrigger(t)} disabled={!canAddTriggerType(t)} title={!canAddTriggerType(t) ? 'Owner only' : ''}>
                + {t}{OWNER_ONLY_TRIGGERS.has(t) ? ' 🔒' : ''}
              </button>
            ))}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const panelStyle: React.CSSProperties = { background: 'white', padding: 24, borderRadius: 8, width: 640, maxHeight: '85vh', overflowY: 'auto' };
