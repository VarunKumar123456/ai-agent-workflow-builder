-- ============================================================================
-- AI Agent Workflow Builder — Core Schema
-- Design notes:
--   - Every child table carries (directly or via join) an org_id path so
--     Hasura row-level permissions can scope on org_members without joins
--     that Hasura permission expressions can't express well.
--   - workflow_steps/workflow_triggers denormalize org_id directly (instead
--     of forcing every permission check through a 3-way join) — this is the
--     single biggest lever for making Hasura permission expressions both
--     correct and fast.
--   - step_runs carries approved_by/approved_at for the approval_gate flow;
--     resuming a run is a mid-execution decision made in the Action handler,
--     not a Hasura permission, so it doesn't need extra guard columns beyond
--     these two + workflow_runs.status.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create table organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  quota_period_start date not null default date_trunc('month', now())::date,
  quota_allowed integer not null default 1000,   -- calls allowed per period
  quota_used    integer not null default 0,      -- calls used this period
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- org_members — links auth.users (nhost) to an organization with a role
-- ---------------------------------------------------------------------------
create type org_role as enum ('owner', 'editor', 'viewer');

create table org_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        org_role not null default 'viewer',
  created_at  timestamptz not null default now(),
  unique (org_id, user_id)
);

create index idx_org_members_user on org_members(user_id);
create index idx_org_members_org on org_members(org_id);

-- ---------------------------------------------------------------------------
-- workflows
-- ---------------------------------------------------------------------------
create table workflows (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  description text,
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_workflows_org on workflows(org_id);

-- ---------------------------------------------------------------------------
-- workflow_steps — ordered, typed, JSONB config
-- ---------------------------------------------------------------------------
create type step_type as enum (
  'llm_call', 'http_request', 'db_write', 'notify',
  'conditional_branch', 'approval_gate'
);

create table workflow_steps (
  id          uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade, -- denormalized for permission scoping
  step_order  integer not null,
  type        step_type not null,
  config      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (workflow_id, step_order)
);

create index idx_workflow_steps_workflow on workflow_steps(workflow_id);
create index idx_workflow_steps_org on workflow_steps(org_id);

-- ---------------------------------------------------------------------------
-- workflow_triggers
-- ---------------------------------------------------------------------------
create type trigger_type as enum ('manual', 'webhook', 'scheduled', 'db_event');

create table workflow_triggers (
  id           uuid primary key default gen_random_uuid(),
  workflow_id  uuid not null references workflows(id) on delete cascade,
  org_id       uuid not null references organizations(id) on delete cascade, -- denormalized
  type         trigger_type not null,
  -- webhook: {"secret": "..."}; scheduled: {"cron": "*/5 * * * *"};
  -- db_event: {"table": "leads", "on": "INSERT"}
  config       jsonb not null default '{}'::jsonb,
  webhook_token uuid default gen_random_uuid(), -- unique unguessable inbound token for webhook triggers
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create index idx_workflow_triggers_workflow on workflow_triggers(workflow_id);
create index idx_workflow_triggers_org on workflow_triggers(org_id);
create unique index idx_workflow_triggers_webhook_token on workflow_triggers(webhook_token) where type = 'webhook';

-- ---------------------------------------------------------------------------
-- workflow_runs — one per execution
-- ---------------------------------------------------------------------------
create type run_status as enum ('pending', 'running', 'paused', 'succeeded', 'failed', 'cancelled');

create table workflow_runs (
  id           uuid primary key default gen_random_uuid(),
  workflow_id  uuid not null references workflows(id) on delete cascade,
  org_id       uuid not null references organizations(id) on delete cascade, -- denormalized
  status       run_status not null default 'pending',
  triggered_by uuid references auth.users(id),        -- null for webhook/scheduled/db_event
  trigger_type trigger_type not null default 'manual',
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  error        text
);

create index idx_workflow_runs_workflow on workflow_runs(workflow_id);
create index idx_workflow_runs_org on workflow_runs(org_id);
create index idx_workflow_runs_status on workflow_runs(status);

-- ---------------------------------------------------------------------------
-- step_runs — one per step per run
-- ---------------------------------------------------------------------------
create type step_run_status as enum ('pending', 'running', 'succeeded', 'failed', 'awaiting_approval', 'skipped');

create table step_runs (
  id             uuid primary key default gen_random_uuid(),
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  workflow_step_id uuid not null references workflow_steps(id) on delete cascade,
  org_id         uuid not null references organizations(id) on delete cascade, -- denormalized
  status         step_run_status not null default 'pending',
  input          jsonb,
  output         jsonb,
  error          text,
  attempt_count  integer not null default 0,
  approved_by    uuid references auth.users(id),
  approved_at    timestamptz,
  started_at     timestamptz,
  finished_at    timestamptz
);

create index idx_step_runs_run on step_runs(workflow_run_id);
create index idx_step_runs_org on step_runs(org_id);

-- ---------------------------------------------------------------------------
-- Aggregation: org-level usage this month + avg run duration (Postgres view)
-- Exposed to Hasura as a view (tracked like a table); use for the
-- "aggregation" requirement without hand-rolled computed-field SQL functions.
-- ---------------------------------------------------------------------------
create view org_usage_stats as
select
  o.id as org_id,
  o.quota_allowed,
  o.quota_used,
  o.quota_allowed - o.quota_used as quota_remaining,
  count(wr.id) filter (
    where wr.started_at >= date_trunc('month', now())
  ) as runs_this_month,
  avg(extract(epoch from (wr.finished_at - wr.started_at)))
    filter (where wr.finished_at is not null) as avg_run_duration_seconds
from organizations o
left join workflow_runs wr on wr.org_id = o.id
group by o.id, o.quota_allowed, o.quota_used;

-- ---------------------------------------------------------------------------
-- updated_at trigger for workflows
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_workflows_updated_at
  before update on workflows
  for each row execute function set_updated_at();
