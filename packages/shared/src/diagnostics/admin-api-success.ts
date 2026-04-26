/**
 * BUG-504-RC1 — admin frontend success-response reader.
 *
 * The pre-existing helper called `await res.json()` on every 2xx
 * response unconditionally. This crashes on:
 *
 *   • 204 No Content   — body is empty by spec; JSON.parse('') throws
 *                        SyntaxError "Unexpected end of JSON input".
 *   • Empty 200/201    — Worker / proxy may legally return an empty
 *                        body with a JSON content-type for cache
 *                        revalidation hits. Same crash.
 *
 * `parseAdminSuccessResponse` reads the body as text first and only
 * invokes JSON.parse when the body is non-empty. Empty bodies resolve
 * to `undefined` so `request<void>(...)` and any caller that doesn't
 * expect a payload simply ignores the return.
 *
 * Contract:
 *   • Caller MUST verify `res.ok` before invoking. The 4xx/5xx path
 *     stays in `parseAdminErrorResponse`.
 *   • This function never throws on a malformed body. A non-empty
 *     body that fails JSON.parse falls back to `undefined` (the
 *     caller already proved `res.ok`, so the data is not useful).
 */

export async function parseAdminSuccessResponse(res: Response): Promise<unknown> {
  // 204 by spec has no body. Even reading text() on some runtimes
  // resolves to '' — handle uniformly via the empty-body branch.
  if (res.status === 204) {
    return undefined;
  }

  const raw = await safeReadText(res);
  if (raw.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(raw);
  } catch {
    // Non-empty but non-JSON success body — extremely rare; caller
    // already proved res.ok, so swallow and return undefined rather
    // than crashing the admin UI.
    return undefined;
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
