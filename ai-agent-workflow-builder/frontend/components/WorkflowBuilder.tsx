'use client';

import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { UPSERT_WORKFLOW, UPSERT_WORKFLOW_STEP, UPSERT_WORKFLOW_TRIGGER } from '../lib/graphql/operations';

const STEP_TYPES = ['llm_call', 'http_request', 'db_write', 'notify', 'conditional_branch', 'approval_gate'];
const TRIGGER_TYPES = ['manual', 'webhook', 'scheduled', 'db_event'];
const OWNER_ONLY_STEPS = new Set(['db_write', 'notify']);
const OWNER_ONLY_TRIGGERS = new Set(['webhook']);

export default function WorkflowBuilder({
  orgId,
  workflowId,
  workflow,
  readOnly,
  role,
  onClose,
}: {
  orgId: string;
  workflowId: string | null;
  workflow: any;
  readOnly: boolean;
  role: 'owner' | 'editor' | 'viewer' | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(workflow?.name ?? '');
  const [steps, setSteps] = useState(workflow?.workflow_steps ?? []);
  const [triggers, setTriggers] = useState(workflow?.workflow_triggers ?? []);
  const [currentWorkflowId, setCurrentWorkflowId] = useState<string | null>(workflowId);

  const [upsertWorkflow] = useMutation(UPSERT_WORKFLOW);
  const [upsertStep] = useMutation(UPSERT_WORKFLOW_STEP);
  const [upsertTrigger] = useMutation(UPSERT_WORKFLOW_TRIGGER);

  const canAddStepType = (type: string) => role === 'owner' || (!OWNER_ONLY_STEPS.has(type) && role === 'editor');
  const canAddTriggerType = (type: string) => role === 'owner' || (!OWNER_ONLY_TRIGGERS.has(type) && role === 'editor');

  const saveWorkflowMeta = async () => {
    const res = await upsertWorkflow({ variables: { id: currentWorkflowId, org_id: orgId, name, description: '' } });
    const id = res.data.insert_workflows_one.id;
    setCurrentWorkflowId(id);
    return id;
  };

  const addStep = async (type: string) => {
    if (!canAddStepType(type)) {
      alert(`Only an owner can add a ${type} step.`);
      return;
    }
    const wfId = currentWorkflowId ?? (await saveWorkflowMeta());
    const res = await upsertStep({
      variables: { id: null, workflow_id: wfId, step_order: steps.length, type, config: {} },
    });
    setSteps([...steps, res.data.upsertWorkflowStep]);
  };

  const addTrigger = async (type: string) => {
    if (!canAddTriggerType(type)) {
      alert(`Only an owner can add a ${type} trigger.`);
      return;
    }
    const wfId = currentWorkflowId ?? (await saveWorkflowMeta());
    const res = await upsertTrigger({ variables: { id: null, workflow_id: wfId, type, config: {} } });
    setTriggers([...triggers, res.data.upsertWorkflowTrigger]);
  };

  const updateStepConfig = async (stepId: string, config: any) => {
    const step = steps.find((s: any) => s.id === stepId);
    await upsertStep({ variables: { id: stepId, workflow_id: currentWorkflowId, step_order: step.step_order, type: step.type, config } });
    setSteps(steps.map((s: any) => (s.id === stepId ? { ...s, config } : s)));
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
          {steps
            .slice()
            .sort((a: any, b: any) => a.step_order - b.step_order)
            .map((step: any) => (
              <li key={step.id} style={{ marginBottom: 8 }}>
                <strong>{step.type}</strong>{' '}
                <textarea
                  disabled={readOnly}
                  defaultValue={JSON.stringify(step.config, null, 0)}
                  style={{ width: '60%' }}
                  onBlur={(e) => {
                    try {
                      updateStepConfig(step.id, JSON.parse(e.target.value));
                    } catch {
                      alert('Invalid JSON config');
                    }
                  }}
                />
              </li>
            ))}
        </ol>

        {!readOnly && (
          <div style={{ marginBottom: 16 }}>
            {STEP_TYPES.map((t) => (
              <button key={t} onClick={() => addStep(t)} disabled={!canAddStepType(t)} title={!canAddStepType(t) ? 'Owner only' : ''}>
                + {t}
                {OWNER_ONLY_STEPS.has(t) ? ' 🔒' : ''}
              </button>
            ))}
          </div>
        )}

        <h4>Triggers</h4>
        <ul>
          {triggers.map((t: any) => (
            <li key={t.id}>
              {t.type}
              {t.type === 'webhook' && t.webhook_token && (
                <code style={{ marginLeft: 8 }}>/v1/functions/webhookTrigger/{t.webhook_token}</code>
              )}
            </li>
          ))}
        </ul>

        {!readOnly && (
          <div>
            {TRIGGER_TYPES.filter((t) => t !== 'manual').map((t) => (
              <button key={t} onClick={() => addTrigger(t)} disabled={!canAddTriggerType(t)} title={!canAddTriggerType(t) ? 'Owner only' : ''}>
                + {t}
                {OWNER_ONLY_TRIGGERS.has(t) ? ' 🔒' : ''}
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

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const panelStyle: React.CSSProperties = {
  background: 'white', padding: 24, borderRadius: 8, width: 640, maxHeight: '85vh', overflowY: 'auto',
};
