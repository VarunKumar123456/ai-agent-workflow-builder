# Write-up

## Schema reasoning

The core relationship chain is `organizations → org_members → workflows →
(workflow_steps | workflow_triggers) → workflow_runs → step_runs`. The one
deliberate deviation from a "clean" normalized design is that `org_id` is
**denormalized directly onto** `workflow_steps`, `workflow_triggers`,
`workflow_runs`, and `step_runs`, instead of only living on `workflows` and
requiring a join through it. This exists purely to make Hasura permission
filters both correct and cheap: every row-level permission check is "does
this row's `org_id` have an `org_members` row for the caller," a single hop,
rather than a multi-table join Hasura would otherwise have to re-derive on
every query. It costs a small amount of write-time consistency risk (an
`org_id` could theoretically drift from its parent workflow's) which I accept
as the right trade for permission-system simplicity at this scale — a
Postgres trigger to keep it in sync would be the natural next step past this
assignment's scope.

`step_runs.approved_by`/`approved_at` live directly on the row rather than
in a separate approvals table, since a step is approved at most once and the
extra table would add a join for no real benefit.

`org_usage_stats` is a plain SQL view rather than a materialized one or a
Hasura computed field function — the assignment's data volume doesn't
justify materialization, and a view tracked as a Hasura table gives the
aggregation requirement (quota usage + avg run duration) for free through
normal GraphQL queries.

## The two permission layers, and why they're enforced differently

**Layer 1 (org + role scoping)** is declarative and lives entirely in Hasura
table permissions, using a single Hasura role (`user`) for every
authenticated request. The role-per-org lookup happens inside the
permission filter itself — a relationship join to `org_members` keyed on
`X-Hasura-User-Id` — rather than as a static Hasura role, because a single
person can be `owner` in one org and `viewer` in another simultaneously,
which a static role can't express. This is what makes cross-org isolation
airtight against ID-guessing: the filter re-derives membership per row,
every query, so a guessed UUID from another org simply matches zero rows —
no separate "is this the right org" check to forget to add.

**Layer 2 (step-level gating)** is procedural and lives in code (Hasura
Actions), not table permissions, for two different reasons per rule.
Restricting `db_write`/`notify` steps and `webhook` triggers to owners can't
be expressed as a single Hasura permission because the required role
*depends on the value of the `type` column being inserted* — Hasura
permissions can't branch a role requirement on a sibling column's value in
the row being written. So creation goes through a thin Action
(`upsertWorkflowStep`/`upsertWorkflowTrigger`) that looks up the caller's
role and branches in plain code. Approving an `approval_gate` step can't be
a table permission at all, full stop — it's not a row read or write in
isolation, it's "check the approver's role right now, then mutate two
tables and resume executing a sequence of further external calls." That's
inherently a procedure, so `approveStep` re-checks the caller's current
`org_members` role at the moment of approval (not at run-start time,
deliberately — membership can change mid-run) before doing anything.

`workflow_runs` and `step_runs` have **no client insert/update permission
at all** — every write to them goes through the admin-secret Action
handlers. This closes the obvious hole where an editor could otherwise
write a `succeeded` row directly and skip quota/retry logic entirely.

## Approval-gate pause/resume

`triggerWorkflowRun` executes `workflow_steps` in order inside a shared
helper, `runStepsFrom(runId, workflowId, orgId, fromOrder)`. On hitting an
`approval_gate` step, it sets that step's `step_runs.status =
'awaiting_approval'`, sets `workflow_runs.status = 'paused'`, and **returns**
— execution genuinely stops, nothing is polling or blocked waiting. The
`step_runs` subscription is what lets the frontend show `paused` live.
`approveStep` does the role check, marks the step approved, flips the run
back to `running`, and calls the exact same `runStepsFrom` helper starting
at `fromOrder = approvedStep.step_order + 1` — so resuming a paused run and
starting a fresh one share one code path rather than two independently
maintained ones, which is also what guarantees retry/quota logic still
applies identically to steps that run after a resume.
