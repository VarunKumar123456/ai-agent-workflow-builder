# Hasura Permissions — Layer 1 (org + role scoping)

## Key design decision

Do **not** try to make `owner`/`editor`/`viewer` into three separate Hasura
roles. A single user can be `owner` in Org A and `viewer` in Org B
simultaneously — Hasura's static role system can't express "role varies per
row." Instead:

- Every authenticated request uses **one Hasura role: `user`**
  (nhost's default authenticated role via `X-Hasura-Role: user`).
- Every permission filter re-derives the caller's org + role **per row**, by
  joining to `org_members` on `X-Hasura-User-Id`. This is what makes it
  impossible for an editor in Org A to touch Org B's data even with the same
  role — the filter checks *this specific row's* org against *this specific
  user's* membership, not a static claim.

Relationships needed (tracked in Hasura console / metadata):
- `workflows.org` → `organizations` (object rel, `org_id`)
- `organizations.members` → `org_members` (array rel)
- `workflow_steps.org` → `organizations`, `workflow_triggers.org` → `organizations`,
  `workflow_runs.org` → `organizations`, `step_runs.org` → `organizations`
  (all object rels via denormalized `org_id`, same pattern)

## organizations

| op | role | filter | columns |
|---|---|---|---|
| select | user | `{"members": {"user_id": {"_eq": "X-Hasura-User-Id"}}}` | all |
| update | user | `{"members": {"_and": [{"user_id": {"_eq": "X-Hasura-User-Id"}}, {"role": {"_eq": "owner"}}]}}` | name, quota_allowed |

`quota_used` is intentionally **not** in the update-allowed columns for any
role — it is only ever incremented server-side by the Action handler using
the admin secret, never directly by clients. This is the guard against a
client forging quota usage.

## org_members

| op | role | filter | columns / notes |
|---|---|---|---|
| select | user | `{"org": {"members": {"user_id": {"_eq": "X-Hasura-User-Id"}}}}` | any member of the org can see the member list |
| insert | user | check: `{"org": {"members": {"_and": [{"user_id": {"_eq": "X-Hasura-User-Id"}}, {"role": {"_eq": "owner"}}]}}}` | only owners add members |
| update | user | same as insert | role column only |
| delete | user | same as insert | owners remove members |

## workflows

| op | role | filter | notes |
|---|---|---|---|
| select | user | `{"org": {"members": {"user_id": {"_eq": "X-Hasura-User-Id"}}}}` | any org member (incl. viewer) can see |
| insert | user | check: `{"org": {"members": {"_and": [{"user_id":{"_eq":"X-Hasura-User-Id"}},{"role":{"_in":["owner","editor"]}}]}}}` | owner/editor only |
| update | user | same filter as insert | owner/editor only |
| delete | user | `{"org": {"members": {"_and": [{"user_id":{"_eq":"X-Hasura-User-Id"}},{"role":{"_eq":"owner"}}]}}}` | owner only |

## workflow_steps / workflow_triggers

Same shape as `workflows`, filtered on the row's own `org_id` (denormalized
column, so the filter is a direct join to `org_members` — no need to hop
through `workflows` first):

- select: any org member
- insert/update/delete: owner/editor **except** — this is Layer 2, see below —
  `db_write` steps, `webhook` triggers, and `notify` steps additionally
  require `role = owner`. Hasura permission expressions can't do
  "if config.type == X then owner else editor," so this half of Layer 2 is
  split: the *baseline* editor/owner check stays a Hasura permission, and a
  **Postgres check constraint + a pre-insert trigger** enforces the
  stricter owner-only rule for those three sensitive step/trigger types by
  reading `X-Hasura-Role`/`X-Hasura-User-Id` is not available inside a raw
  SQL trigger — so in practice this half of Layer 2 is enforced in a thin
  Hasura Action (`upsertWorkflowStep`) instead of a raw table permission.
  See `LAYER2.md`.

## workflow_runs

| op | role | filter |
|---|---|---|
| select | user | `{"org": {"members": {"user_id": {"_eq": "X-Hasura-User-Id"}}}}` |
| insert | **none** | rows are only ever created by the `triggerWorkflowRun` Action, using the admin secret — no direct client insert permission exists at all |
| update | **none** | same — only the Action (admin secret) updates status |

This is deliberate: allowing direct client insert/update on `workflow_runs`
would let any editor bypass quota checks and retry logic by writing rows
directly. The **only** door in is the Action.

## step_runs

| op | role | filter |
|---|---|---|
| select | user | `{"org": {"members": {"user_id": {"_eq": "X-Hasura-User-Id"}}}}` |
| insert/update | **none** | same reasoning as workflow_runs — Action-only, admin secret |

This also means `approved_by`/`approved_at` can never be set by a client
directly forging an approval — only the `approveStep` Action can write them,
and it re-checks the approver's role server-side (Layer 2) before doing so.

## Why this satisfies "can't touch Org B even by guessing an ID"

Every select/update/delete filter above re-derives org membership from
`org_members` on every single row, keyed off `X-Hasura-User-Id` from the
verified JWT. Guessing a `workflow_id` or `workflow_run_id` UUID from Org B
does nothing — the row-level filter still requires a matching `org_members`
row for the caller, which doesn't exist. Hasura returns an empty result, not
a 403 (so it also doesn't leak existence of the row).
