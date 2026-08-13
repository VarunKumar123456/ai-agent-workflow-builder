// Simple retry wrapper: for llm_call / http_request steps, per the
// assignment's "at least one retry on failure" requirement.
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; delayMs?: number; onAttempt?: (attempt: number, err?: Error) => void } = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 2; // 1 initial try + 1 retry
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      opts.onAttempt?.(attempt);
      return await fn();
    } catch (err: any) {
      lastErr = err;
      opts.onAttempt?.(attempt, err);
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, (opts.delayMs ?? 500) * attempt)); // linear backoff
      }
    }
  }
  throw lastErr;
}
