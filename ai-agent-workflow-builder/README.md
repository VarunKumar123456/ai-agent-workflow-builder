# AI Agent Workflow Builder

A mini n8n for chaining AI agent steps, built on nhost + Hasura + Postgres +
Next.js. See `WRITEUP.md` for the schema/permissions/approval-gate reasoning,
`hasura/metadata/permissions.md` and `LAYER2.md` for the full permission
design.

## Repo layout

```
db/migrations/001_init_schema.sql   → full schema, run this first
hasura/metadata/                    → permission design docs + Action type defs
functions/                          → Action handlers + event trigger targets (deploy to nhost Functions)
frontend/                           → Next.js app (deploy to Vercel)
```

## 1. Provision nhost (Postgres + Hasura + Auth in one)

```
npm install -g nhost
nhost login
nhost init          # inside a new project folder, or use the nhost Dashboard directly
```

Or just create a project at https://app.nhost.io — takes ~2 minutes, gives
you Postgres + Hasura + Auth + a subdomain immediately.

## 2. Run the schema

```
psql "<your nhost Postgres connection string>" -f db/migrations/001_init_schema.sql
```

(Or paste the file into Hasura Console → Data → SQL.)

Then in Hasura Console → Data: **track** all new tables and the
`org_usage_stats` view, and **track the foreign-key relationships** it
suggests automatically (org→members, workflow→steps, workflow→triggers,
workflow→runs, run→step_runs). This is required before permissions below
will have relationships to reference.

## 3. Apply permissions (Layer 1)

Follow `hasura/metadata/permissions.md` table-by-table in Hasura Console →
Data → [table] → Permissions, using Hasura role `user` throughout (nhost's
default authenticated role). This is the tedious-but-mechanical part —
budget ~30–40 minutes to click through every table/operation.

## 4. Deploy the functions (Actions + event trigger targets + webhook/cron)

```
cd functions
npm install
nhost functions deploy   # or: git push if your nhost project auto-deploys functions/ from the repo
```

Then in Hasura Console → Actions, create the four Actions using the type
defs in `hasura/metadata/actions.graphql`, pointing each Handler URL at your
deployed function. Restrict each Action's permissions to role `user`.

Wire the two Event Triggers (Hasura Console → Events):
- On whichever table(s) your `db_event` triggers watch → target
  `.../functions/eventHandlers/onDbEvent`
- On `step_runs`, operation `UPDATE` → target `.../functions/eventHandlers/notifyDispatch`

Register the scheduled function per the comment at the top of
`functions/scheduledTrigger.ts` (nhost Dashboard → Run Services → add a
Scheduled Function, or a `config.yaml` `functions.schedules` entry).

Set env vars from `.env.example` in the nhost Functions environment
settings. **If you don't have an LLM key, set `LLM_STUB_MODE=true`** — the
`llm_call` step will still run, with a disclosed 800ms artificial delay and
a response labeled `"stubbed": true`, per the assignment's stated fallback.

## 5. Run the frontend

```
cd frontend
npm install
cp ../.env.example .env.local   # fill in NEXT_PUBLIC_* values
npm run dev
```

Deploy: `vercel` (or connect the repo in the Vercel dashboard, root
directory = `frontend/`, set the two `NEXT_PUBLIC_*` env vars).

## 6. Seed two orgs + users for the Final Task demo

1. Sign up two users via the app's sign-up screen (or `nhost auth` API):
   `owner-a@test.com`, `owner-b@test.com` (add a couple more for editor/viewer
   roles if you want the full role matrix demonstrated).
2. In Hasura Console → Data → SQL, run:

```sql
insert into organizations (name) values ('Org A'), ('Org B');

-- grab the ids
select id, name from organizations;
select id, email from auth.users;

-- then, using those ids:
insert into org_members (org_id, user_id, role) values
  ('<org-a-id>', '<owner-a-user-id>', 'owner'),
  ('<org-b-id>', '<owner-b-user-id>', 'owner');
```

3. Log in as `owner-a`, build a workflow per the Final Task scenario below.

## Final Task — demo script

1. **Two orgs, two users** — already seeded above.
2. **Org A workflow, 3+ step types** — as `owner-a`, open the dashboard,
   click "+ New workflow," add steps in order:
   - `llm_call` — config: `{"prompt": "Say HIGH or LOW about the number 42"}`
   - `conditional_branch` — config:
     `{"field": "text", "op": "contains", "value": "HIGH", "jumpToOrderIfFalse": 3}`
   - `http_request` (only reached if branch was true) — config:
     `{"url": "https://httpbin.org/get", "method": "GET"}`
   - `approval_gate` at order 3
3. **Two ways to start it** — click **Run ▶** for manual. For the second
   way, add a `webhook` trigger (owner-only, per Layer 2) and `curl -X POST
   .../v1/functions/webhookTrigger/<token>` from a terminal to prove an
   external system can start it without a login.
4. **Approval gate** — watch the run hit `paused`; approve it from the Run
   Status panel (only owner/editor can, per Layer 2 Rule B).
5. **Live status** — the whole thing streams via the `step_runs`
   subscription, no refresh, including the `paused` state rendering
   distinctly.
6. **Cross-org isolation** — log out, log in as `owner-b`. Confirm Org A's
   workflow doesn't appear in the list. Then, in browser devtools, replay
   the `GetOrgWorkflows` query with Org A's `orgId` manually, or query
   `workflow_runs_by_pk(id: "<org-a-run-id>")` directly by ID — both return
   nothing, because every Layer 1 filter re-checks `org_members` per row
   regardless of which ID was guessed.

Record this whole flow — it's the single deliverable the assignment weighs
above everything else.

## What's stubbed / what needs your own keys

- `llm_call` uses Groq's free tier by default; set `LLM_STUB_MODE=true` in
  functions env vars if you don't want to sign up for a key — the stub is
  disclosed in its own output (`"stubbed": true`) rather than silently faked.
- `notify`'s Slack delivery needs a Slack Incoming Webhook URL in that
  step's `config.slackWebhookUrl`; without one it no-ops and reports
  `{"skipped": true}` rather than failing the whole run.
- `db_write` writes into a generic `workflow_results` table — add that
  table via a second migration if you want to exercise this step type
  (not included in `001_init_schema.sql` since its shape is
  workflow-specific; the assignment says field names are the builder's
  call).
