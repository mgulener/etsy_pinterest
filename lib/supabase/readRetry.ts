export function createReadRetryFetch(
  request: typeof fetch = fetch,
  sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
): typeof fetch {
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "GET" && method !== "HEAD") return request(input, init);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await request(input, init);
      } catch (error) {
        if (attempt >= 2 || signal?.aborted || !(error instanceof TypeError)) throw error;
        await sleep(500 * (attempt + 1));
        continue;
      }
      if (attempt >= 2 || signal?.aborted) return response;
      let retry = [502, 503, 504].includes(response.status);
      if (response.status === 401) {
        const body = await response.clone().text();
        retry = /JWT issued at future/i.test(body);
      }
      if (!retry) return response;
      await response.body?.cancel();
      await sleep(500 * (attempt + 1));
    }
  };
}
