import { gql } from '@apollo/client';

// Org's workflows with steps, triggers, and most recent run status
export const GET_ORG_WORKFLOWS = gql`
  query GetOrgWorkflows($orgId: uuid!) {
    workflows(where: { org_id: { _eq: $orgId } }, order_by: { created_at: desc }) {
      id
      name
      description
      created_at
      workflow_steps(order_by: { step_order: asc }) {
        id
        step_order
        type
        config
      }
      workflow_triggers {
        id
        type
        config
        is_active
        webhook_token
      }
      workflow_runs(order_by: { started_at: desc }, limit: 1) {
        id
        status
        started_at
        finished_at
      }
    }
    org_usage_stats(where: { org_id: { _eq: $orgId } }) {
      quota_allowed
      quota_used
      quota_remaining
      runs_this_month
      avg_run_duration_seconds
    }
  }
`;

// Create/edit a workflow (base row — steps/triggers go through the Actions below)
export const UPSERT_WORKFLOW = gql`
  mutation UpsertWorkflow($id: uuid, $org_id: uuid!, $name: String!, $description: String) {
    insert_workflows_one(
      object: { id: $id, org_id: $org_id, name: $name, description: $description }
      on_conflict: { constraint: workflows_pkey, update_columns: [name, description] }
    ) {
      id
      name
    }
  }
`;

export const UPSERT_WORKFLOW_STEP = gql`
  mutation UpsertWorkflowStep($id: uuid, $workflow_id: uuid!, $step_order: Int!, $type: String!, $config: json!) {
    upsertWorkflowStep(id: $id, workflow_id: $workflow_id, step_order: $step_order, type: $type, config: $config) {
      id
      step_order
      type
      config
    }
  }
`;

export const UPSERT_WORKFLOW_TRIGGER = gql`
  mutation UpsertWorkflowTrigger($id: uuid, $workflow_id: uuid!, $type: String!, $config: json!) {
    upsertWorkflowTrigger(id: $id, workflow_id: $workflow_id, type: $type, config: $config) {
      id
      type
      config
      webhook_token
    }
  }
`;

export const TRIGGER_WORKFLOW_RUN = gql`
  mutation TriggerWorkflowRun($workflow_id: uuid!) {
    triggerWorkflowRun(workflow_id: $workflow_id) {
      id
    }
  }
`;

export const APPROVE_STEP = gql`
  mutation ApproveStep($step_run_id: uuid!) {
    approveStep(step_run_id: $step_run_id) {
      workflow_run_id
      status
    }
  }
`;

// Live step-by-step progress for a run, including the paused/awaiting_approval state
export const STEP_RUNS_SUBSCRIPTION = gql`
  subscription StepRunsForRun($workflow_run_id: uuid!) {
    step_runs(where: { workflow_run_id: { _eq: $workflow_run_id } }, order_by: { started_at: asc }) {
      id
      status
      input
      output
      error
      attempt_count
      approved_by
      approved_at
      started_at
      finished_at
      workflow_step {
        step_order
        type
      }
    }
    workflow_runs_by_pk(id: $workflow_run_id) {
      status
      error
      finished_at
    }
  }
`;

export const GET_MY_ORGS = gql`
  query GetMyOrgs {
    org_members {
      role
      organization {
        id
        name
      }
    }
  }
`;
