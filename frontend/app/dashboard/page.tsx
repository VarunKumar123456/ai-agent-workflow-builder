'use client';

import { useEffect, useState } from 'react';
import { useOrg } from '../../components/OrgContext';
import RunView from '../../components/RunView';
import WorkflowBuilder from '../../components/WorkflowBuilder';
import { gqlRequest } from '../../lib/gql';

const GET_ORG_WORKFLOWS = `
  query GetOrgWorkflows($orgId: uuid!) {
    workflows(where: { org_id: { _eq: $orgId } }, order_by: { created_at: desc }) {
      id
      name
      description
      created_at
      workflow_steps(order_by: { step_order: asc }) { id step_order type config }
      workflow_triggers { id type config is_active webhook_token }
      workflow_runs(order_by: { started_at: desc }, limit: 1) { id status started_at finished_at }
    }
    org_usage_stats(where: { org_id: { _eq: $orgId } }) {
      quota_allowed quota_used quota_remaining runs_this_month avg_run_duration_seconds
    }
  }
`;

const TRIGGER_WORKFLOW_RUN = `
  mutation TriggerWorkflowRun($workflow_id: uuid!) {
    triggerWorkflowRun(workflow_id: $workflow_id) { id }
  }
`;

export default function Dashboard() {
  const [mounted, setMounted] = useState(false);
  const { activeOrgId, activeRole, memberships, setActiveOrgId, loading: orgsLoading, error: orgsError } = useOrg();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | 'new' | null>(null);
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  const refetch = () => {
    if (!activeOrgId) return;
    setLoading(true);
    setWorkflowsError(null);
    gqlRequest(GET_ORG_WORKFLOWS, { orgId: activeOrgId })
      .then((d) => setData(d))
      .catch((e) => { console.error(e); setWorkflowsError(String(e.message ?? e)); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (activeOrgId) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  if (!mounted) return null;

  if (orgsError) {
    return (
      <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
        <h2 style={{ color: 'red' }}>Error loading organizations</h2>
        <pre style={{ background: '#fee', padding: 12, whiteSpace: 'pre-wrap' }}>{orgsError}</pre>
      </div>
    );
  }
  if (orgsLoading) return <p style={{ padding: 24 }}>Loading orgs...</p>;
  if (memberships.length === 0) {
    return <p style={{ padding: 24 }}>You're not a member of any organization yet. Ask an owner to add you via <code>org_members</code>.</p>;
  }
  if (!activeOrgId) return <p style={{ padding: 24 }}>Loading orgs...</p>;

  const usage = data?.org_usage_stats?.[0];

  const handleRun = async (workflowId: string) => {
    try {
      const res: any = await gqlRequest(TRIGGER_WORKFLOW_RUN, { workflow_id: workflowId });
      const runId = res?.triggerWorkflowRun?.id;
      if (runId) setViewingRunId(runId);
      refetch();
    } catch (e: any) {
      alert('Failed to trigger run: ' + e.message);
    }
  };

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <select value={activeOrgId} onChange={(e) => setActiveOrgId(e.target.value)}>
            {memberships.map((m) => (
              <option key={m.organization.id} value={m.organization.id}>
                {m.organization.name} ({m.role})
              </option>
            ))}
          </select>
        </div>

        {usage && (
          <div style={{ fontSize: 14 }}>
            <strong>Quota:</strong> {usage.quota_used} / {usage.quota_allowed} used
            {' - '}
            {usage.runs_this_month} runs this month
          </div>
        )}

        {activeRole !== 'viewer' && <button onClick={() => setEditingWorkflowId('new')}>+ New workflow</button>}
      </header>

      {loading && <p>Loading workflows...</p>}
      {workflowsError && <pre style={{ background: '#fee', padding: 12, whiteSpace: 'pre-wrap' }}>{workflowsError}</pre>}

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {data?.workflows?.map((wf: any) => {
          const lastRun = wf.workflow_runs[0];
          return (
            <li key={wf.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <strong>{wf.name}</strong> - {wf.workflow_steps.length} steps, {wf.workflow_triggers.length} triggers
                  {lastRun && <div style={{ fontSize: 12, color: '#666' }}>Last run: {lastRun.status}</div>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setEditingWorkflowId(wf.id)}>{activeRole === 'viewer' ? 'View' : 'Edit'}</button>
                  {activeRole !== 'viewer' && <button onClick={() => handleRun(wf.id)}>Run</button>}
                  {lastRun && <button onClick={() => setViewingRunId(lastRun.id)}>Live status</button>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {editingWorkflowId && (
        <WorkflowBuilder
          orgId={activeOrgId}
          workflowId={editingWorkflowId === 'new' ? null : editingWorkflowId}
          workflow={data?.workflows?.find((w: any) => w.id === editingWorkflowId)}
          readOnly={activeRole === 'viewer'}
          role={activeRole}
          onClose={() => {
            setEditingWorkflowId(null);
            refetch();
          }}
        />
      )}

      {viewingRunId && <RunView runId={viewingRunId} role={activeRole} onClose={() => setViewingRunId(null)} />}
    </div>
  );
}