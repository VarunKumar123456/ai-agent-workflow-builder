# Layer 2 — step-level gating

Layer 1 (above) answers "can this user touch this org's data at all."
Layer 2 answers a sharper question: "can this user do *this specific
sensitive thing*." Two of its three rules are decisions made **inside code**,
not inside a declarative Hasura permission, because they depend on either
the shape of JSON config or on a mid-execution runtime state:

## Rule A — only an owner can add a `db_write`, `webhook` trigger, or `notify` step

Hasura table permissions can't branch on "if `config.type` equals X, apply a
stricter role check than the table-level insert permission." So step/trigger
creation goes through a thin **Hasura Action** (`upsertWorkflowStep`,
`upsertWorkflowTrigger`) instead of the raw GraphQL table mutation:

```
upsertWorkflowStep(workflow_id, type, config, step_order) → workflow_steps
```

Handler logic (`functions/upsertWorkflowStep.ts`):
1. Look up caller's `org_members.role` for the workflow's org.
2. If `type` is `db_write`, or the trigger `type` is `webhook`, or step
   `type` is `notify` → require `role === 'owner'`. Otherwise require
   `role in ('owner', 'editor')`.
3. If it passes, perform the insert/update using the admin secret.

The raw `workflow_steps`/`workflow_triggers` tables keep their Hasura
insert/update permissions restricted to owner/editor (Layer 1's baseline) —
but the frontend and any well-behaved client call the Action, not the raw
mutation, for step/trigger creation, and the stricter owner-only check for
the three sensitive types lives entirely in the Action's code, not in a
GraphQL permission expression. This is called out explicitly because it's
the one place "Layer 1 vs Layer 2" isn't a clean single mechanism — it's
Hasura row permission (baseline) + Action-level branch (sensitive-type
override).

## Rule B — resuming an `approval_gate` requires role check at resume time

This **cannot** be a database permission at all, because approving isn't a
row read or write in isolation — it's "check the approver's role right now,
then mutate two tables (`step_runs`, `workflow_runs`) and continue executing
subsequent steps." That's inherently procedural. Enforced entirely in the
`approveStep` Action handler:

```
approveStep(step_run_id) → { workflow_run_id, status }
```

1. Load the `step_runs` row (admin secret) and confirm `status = 'awaiting_approval'`.
2. Look up caller's `org_members.role` for that step's org.
3. Require `role in ('owner', 'editor')` — reject with a 403-style GraphQL
   error otherwise (viewers can never approve, matching Layer 1's
   "viewer = read-only" rule, but re-checked here because the approval
   itself isn't a plain table mutation viewers could even reach).
4. Set `approved_by`, `approved_at`, `step_runs.status = 'succeeded'`.
5. Set `workflow_runs.status = 'running'` and resume execution of the
   remaining steps in-process (see `functions/triggerWorkflowRun.ts` —
   `approveStep` calls the same `runStepsFrom()` helper that
   `triggerWorkflowRun` uses, starting right after the approved step).

## Why split it this way instead of "just use Hasura permissions for everything"

Hasura's permission system is declarative and row-scoped — excellent for
"can this user see/insert/update this row," bad at "run this multi-step
side-effecting decision and then keep going." Anything that needs (a) a
runtime role check plus (b) a resulting sequence of external calls has to be
an Action. Anything that's a pure row-level read/write stays a declarative
permission. This assignment's two step-level rules are both squarely in the
first bucket, which is why both live in code, not YAML.
