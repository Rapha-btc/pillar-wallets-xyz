// _chunked-submit.js - the stxer SDK posts every step of a simulation in ONE
// request and the origin runs them before answering; past ~250 steps (or a few
// 100 KB deploys) Cloudflare gives up at 100 s with a 504 and the SDK throws
// without the session id. A session accepts steps in several posts, so this
// wraps global fetch: a submit to /devtools/v2/simulations/<id> whose body
// carries more than `chunk` steps is sent as consecutive posts of `chunk`
// steps each (same session, same order); the SDK sees the last answer.
// A 5xx on a chunk (the origin busy) is not retried blindly: the session is
// read back, the steps it already holds are counted, and the post resumes
// from the first one missing (up to `retries` times, `waitMs` apart).
export function installChunkedSubmit(chunk = 60, { retries = 6, waitMs = 30_000 } = {}) {
  const real = globalThis.fetch;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (init?.method === "POST" && /\/devtools\/v2\/simulations\/[0-9a-f]+$/.test(u) && typeof init.body === "string") {
      let body; try { body = JSON.parse(init.body); } catch { return real(url, init); }
      const steps = body?.steps;
      if (!Array.isArray(steps) || steps.length <= chunk) return real(url, init);
      let last, i = 0, left = retries;
      while (i < steps.length) {
        const part = steps.slice(i, i + chunk);
        process.stdout.write(`  submit steps ${i + 1}-${i + part.length} of ${steps.length}... `);
        const t0 = Date.now();
        try { last = await real(url, { ...init, body: JSON.stringify({ ...body, steps: part }) }); } catch (e) { last = { ok: false, status: 0, text: async () => String(e) }; }
        console.log(`${last.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        if (last.ok) { i += part.length; continue; }
        if (last.status < 500 || left-- <= 0) return last;
        await sleep(waitMs);
        const got = await real(u, { headers: { Accept: "application/json" } });
        const have = got.ok ? ((await got.json()).steps || []).length : i;
        console.log(`  origin busy (${last.status}); session holds ${have} steps, resuming`);
        i = have;
      }
      return last;
    }
    return real(url, init);
  };
}
