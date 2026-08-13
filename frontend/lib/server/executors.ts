// Step executors. Each returns { output } on success or throws on failure —
// retry.ts wraps these with the retry policy so this file stays pure.

const LLM_STUB_MODE = process.env.LLM_STUB_MODE === 'true';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

export async function executeLlmCall(config: any, priorOutput: any): Promise<any> {
  const prompt = interpolate(config.prompt ?? '', priorOutput);

  if (LLM_STUB_MODE || !GROQ_API_KEY) {
    // Disclosed artificial delay, per assignment's fallback allowance.
    await new Promise((r) => setTimeout(r, 800));
    return {
      stubbed: true,
      note: 'LLM_STUB_MODE=true or no GROQ_API_KEY set — this is a stubbed response with an artificial delay, not a real model call.',
      prompt,
      text: `[stub] Simulated LLM response for prompt: "${prompt.slice(0, 80)}"`,
    };
  }

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: config.model ?? 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`LLM call failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return { text: data.choices?.[0]?.message?.content, raw: data };
}

export async function executeHttpRequest(config: any, priorOutput: any): Promise<any> {
  const url = interpolate(config.url ?? '', priorOutput);
  const res = await fetch(url, {
    method: config.method ?? 'GET',
    headers: config.headers ?? {},
    body: config.body ? JSON.stringify(interpolateObj(config.body, priorOutput)) : undefined,
  });
  if (!res.ok) {
    throw new Error(`http_request failed: ${res.status} ${await res.text()}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  return contentType.includes('application/json') ? await res.json() : await res.text();
}

export async function executeDbWrite(
  config: any,
  priorOutput: any,
  orgId: string,
  stepRunId: string,
  gqlFn: (q: string, v?: any) => Promise<any>
): Promise<any> {
  // Generic sink: writes priorOutput (or a mapped subset) into
  // workflow_results. Kept generic deliberately — a "save this run's
  // result somewhere" step, not tied to any one downstream schema.
  const record = config.map ? mapFields(config.map, priorOutput) : priorOutput;
  const data = await gqlFn(
    `mutation($object: workflow_results_insert_input!) {
      insert_workflow_results_one(object: $object) { id }
    }`,
    { object: { org_id: orgId, step_run_id: stepRunId, data: record } }
  );
  return data;
}

export async function executeNotify(config: any, priorOutput: any): Promise<any> {
  // Implemented as an Event Trigger target: this function is what a Hasura
  // Event Trigger (watching step_runs for type=notify + status=succeeded)
  // calls. Here it just performs the actual Slack/email call.
  const webhookUrl = config.slackWebhookUrl;
  const message = interpolate(config.message ?? 'Workflow notification', priorOutput);
  if (!webhookUrl) {
    return { skipped: true, reason: 'no slackWebhookUrl configured', message };
  }
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
  });
  return { delivered: res.ok, status: res.status };
}

export function evaluateConditionalBranch(config: any, priorOutput: any): 'true' | 'false' {
  // config.field: dot-path into priorOutput; config.op: eq|contains|gt|lt; config.value
  const value = getPath(priorOutput, config.field);
  switch (config.op) {
    case 'eq': return value === config.value ? 'true' : 'false';
    case 'contains': return String(value ?? '').includes(config.value) ? 'true' : 'false';
    case 'gt': return Number(value) > Number(config.value) ? 'true' : 'false';
    case 'lt': return Number(value) < Number(config.value) ? 'true' : 'false';
    default: return 'false';
  }
}

// ---- helpers ----
function interpolate(template: string, ctx: any): string {
  return template.replace(/\{\{(.*?)\}\}/g, (_, path) => String(getPath(ctx, path.trim()) ?? ''));
}
function interpolateObj(obj: any, ctx: any): any {
  if (typeof obj === 'string') return interpolate(obj, ctx);
  if (Array.isArray(obj)) return obj.map((v) => interpolateObj(v, ctx));
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, interpolateObj(v, ctx)]));
  }
  return obj;
}
function getPath(obj: any, path: string): any {
  return path?.split('.').reduce((acc: any, key: string) => acc?.[key], obj);
}
function mapFields(map: Record<string, string>, ctx: any): any {
  return Object.fromEntries(Object.entries(map).map(([k, path]) => [k, getPath(ctx, path)]));
}
