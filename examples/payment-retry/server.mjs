import http from 'node:http';
export function retry(outcomes, maxAttempts) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20)
    return { error: 'INVALID_ATTEMPTS' };
  if (
    !Array.isArray(outcomes) ||
    outcomes.some((x) => !['success', 'temporary', 'permanent'].includes(x))
  )
    return { error: 'INVALID_OUTCOMES' };
  for (let i = 0; i < maxAttempts; i++) {
    const outcome = outcomes[i] ?? 'temporary';
    if (outcome === 'success') return { status: 'success', attempts: i + 1 };
    if (outcome === 'permanent') return { status: 'failed', attempts: i + 1 };
  }
  return { status: 'failed', attempts: maxAttempts };
}
if (process.env.PORT)
  http
    .createServer(async (request, response) => {
      if (request.method !== 'POST' || request.url !== '/payments/retry') {
        response.writeHead(404).end();
        return;
      }
      let text = '';
      try {
        for await (const chunk of request) {
          text += chunk;
          if (text.length > 8192) {
            response.writeHead(413).end();
            return;
          }
        }
        const input = JSON.parse(text),
          result = retry(input.outcomes, input.maxAttempts);
        response
          .writeHead(result.error ? 400 : 200, {
            'content-type': 'application/json',
          })
          .end(JSON.stringify(result));
      } catch {
        response.writeHead(400).end('{}');
      }
    })
    .listen(Number(process.env.PORT), '0.0.0.0');
