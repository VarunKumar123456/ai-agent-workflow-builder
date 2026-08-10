-- Generic sink table for db_write steps. Kept intentionally generic (a JSONB
-- blob) since the assignment leaves field names to the builder and a
-- db_write step's shape is workflow-specific.

create table workflow_results (
  id           uuid primary key default gen_random_uuid(),
  step_run_id  uuid references step_runs(id) on delete cascade,
  org_id       uuid not null references organizations(id) on delete cascade,
  data         jsonb not null,
  created_at   timestamptz not null default now()
);

create index idx_workflow_results_org on workflow_results(org_id);

-- Layer 1 select permission (role: user): same org-scoping pattern as
-- everything else — {"org": {"members": {"user_id": {"_eq": "X-Hasura-User-Id"}}}}
-- No client insert permission: only the db_write executor (admin secret)
-- writes here, same reasoning as workflow_runs/step_runs.
