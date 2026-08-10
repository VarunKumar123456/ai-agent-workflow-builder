'use client';

import { useSubscription, useMutation } from '@apollo/client';
import { STEP_RUNS_SUBSCRIPTION, APPROVE_STEP } from '../lib/graphql/operations';

const STATUS_COLOR: Record<string, string> = {
  pending: '#999',
  running: '#2563eb',
  succeeded: '#16a34a',
  failed: '#dc2626',
  awaiting_approval: '#d97706',
  skipped: '#9ca3af',
};

export default function RunView({
  runId,
  role,
  onClose,
}: {
  runId: string;
  role: 'owner' | 'editor' | 'viewer' | null;
  onClose: () => void;
}) {
  const { data, loading } = useSubscription(STEP_RUNS_SUBSCRIPTION, { variables: { workflow_run_id: runId } });
  const [approveStep, { loading: approving }] = useMutation(APPROVE_STEP);

  const run = data?.workflow_runs_by_pk;
  const stepRuns = data?.step_runs ?? [];
  const canApprove = role === 'owner' || role === 'editor';

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        <h2>Run status {run ? <span style={{ color: STATUS_COLOR[run.status] }}>({run.status})</span> : null}</h2>
        {loading && <p>Connecting…</p>}
        {run?.status === 'paused' && (
          <p style={{ color: STATUS_COLOR.awaiting_approval }}>
            ⏸ Paused — awaiting approval on a step below.
          </p>
        )}
        {run?.error && <p style={{ color: 'red' }}>{run.error}</p>}

        <ol>
          {stepRuns.map((sr: any) => (
            <li key={sr.id} style={{ marginBottom: 10, borderLeft: `4px solid ${STATUS_COLOR[sr.status]}`, paddingLeft: 8 }}>
              <div>
                <strong>Step {sr.workflow_step.step_order}</strong> — {sr.workflow_step.type}{' '}
                <span style={{ color: STATUS_COLOR[sr.status] }}>[{sr.status}]</span>
                {sr.attempt_count > 1 && <em> ({sr.attempt_count} attempts)</em>}
              </div>
              {sr.output && <pre style={preStyle}>{JSON.stringify(sr.output, null, 2)}</pre>}
              {sr.error && <div style={{ color: 'red' }}>{sr.error}</div>}

              {sr.status === 'awaiting_approval' && (
                <div style={{ marginTop: 6 }}>
                  {canApprove ? (
                    <button disabled={approving} onClick={() => approveStep({ variables: { step_run_id: sr.id } })}>
                      ✅ Approve & resume
                    </button>
                  ) : (
                    <em>Waiting for an owner/editor to approve…</em>
                  )}
                </div>
              )}
              {sr.approved_by && (
                <div style={{ fontSize: 12, color: '#666' }}>Approved at {sr.approved_at}</div>
              )}
            </li>
          ))}
        </ol>

        <button onClick={onClose}>Close</button>
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
const preStyle: React.CSSProperties = { background: '#f3f4f6', padding: 8, fontSize: 12, overflowX: 'auto' };
