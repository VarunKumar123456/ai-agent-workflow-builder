'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { GET_ORG_WORKFLOWS, TRIGGER_WORKFLOW_RUN } from '../../lib/graphql/operations';
import { useOrg } from '../../components/OrgContext';
import WorkflowBuilder from '../../components/WorkflowBuilder';
import RunView from '../../components/RunView';

export default function Dashboard() {
  const { activeOrgId, activeRole, memberships, setActiveOrgId } = useOrg();
  const { data, loading, refetch } = useQuery(GET_ORG_WORKFLOWS, {
    variables: { orgId: activeOrgId },
    skip: !activeOrgId,
    pollInterval: 0, // list itself doesn't need polling — RunView subscribes for live status
  });
  const [triggerRun] = useMutation(TRIGGER_WORKFLOW_RUN);
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | 'new' | null>(null);
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);

  if (!activeOrgId) return <p>Loading orgs…</p>;

  const usage = data?.org_usage_stats?.[0];

  const handleRun = async (workflowId: string) => {
    const res = await triggerRun({ variables: { workflow_id: workflowId } });
    const runId = res.data?.triggerWorkflowRun?.id;
    if (runId) setViewingRunId(runId);
    refetch();
  };

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
            <strong>Quota:</strong> {usage.quota_used} / {usage.quota_allowed} used this period
            {' · '}
            {usage.runs_this_month} runs this month
            {' · '}
            avg duration {usage.avg_run_duration_seconds ? `${Math.round(usage.avg_run_duration_seconds)}s` : '—'}
          </div>
        )}

        {activeRole !== 'viewer' && (
          <button onClick={() => setEditingWorkflowId('new')}>+ New workflow</button>
        )}
      </header>

      {loading && <p>Loading workflows…</p>}

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {data?.workflows.map((wf: any) => {
          const lastRun = wf.workflow_runs[0];
          return (
            <li key={wf.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <strong>{wf.name}</strong> — {wf.workflow_steps.length} steps, {wf.workflow_triggers.length} triggers
                  {lastRun && <div style={{ fontSize: 12, color: '#666' }}>Last run: {lastRun.status}</div>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setEditingWorkflowId(wf.id)}>
                    {activeRole === 'viewer' ? 'View' : 'Edit'}
                  </button>
                  {activeRole !== 'viewer' && <button onClick={() => handleRun(wf.id)}>Run ▶</button>}
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
          workflow={data?.workflows.find((w: any) => w.id === editingWorkflowId)}
          readOnly={activeRole === 'viewer'}
          role={activeRole}
          onClose={() => {
            setEditingWorkflowId(null);
            refetch();
          }}
        />
      )}

      {viewingRunId && (
        <RunView runId={viewingRunId} role={activeRole} onClose={() => setViewingRunId(null)} />
      )}
    </div>
  );
}
