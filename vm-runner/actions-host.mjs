import { evaluateVM, imageIdentity } from './qemu-vm.mjs';
const image = {
  disk: process.env.VM_DISK,
  kernel: process.env.VM_KERNEL,
  initrd: process.env.VM_INITRD,
};
if (process.argv[2] === 'identity') {
  console.log(await imageIdentity(image));
  process.exit(0);
}
const origin = process.env.JUDGE_ORIGIN,
  id = process.env.JUDGE_JOB_ID;
if (
  !/^https:\/\/[A-Za-z0-9.-]+$/.test(origin ?? '') ||
  !/^[a-f0-9-]{36}$/.test(id ?? '')
)
  throw Error('INVALID_JOB');
// Fixed operator allowlist prevents workflow dispatch being used as an HTTP proxy.
if (origin !== process.env.ALLOWED_JUDGE_ORIGIN)
  throw Error('ORIGIN_NOT_ALLOWED');
async function oidc() {
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  url.searchParams.set('audience', origin);
  const response = await fetch(url, {
    headers: {
      authorization: 'Bearer ' + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error('OIDC_UNAVAILABLE');
  return (await response.json()).value;
}
async function broker(action, body) {
  const response = await fetch(`${origin}/api/runner/actions/${id}/${action}`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
    headers: {
      authorization: 'Bearer ' + (await oidc()),
      'content-type': 'application/json',
    },
    body,
  });
  if (!response.ok) throw Error('BROKER_HTTP_' + response.status);
  return response;
}
const response = await broker('claim');
const text = await response.text();
if (Buffer.byteLength(text) > 850000) throw Error('INPUT_LIMIT');
const result = await evaluateVM(JSON.parse(text), image);
await broker('result', JSON.stringify(result));
// No raw source/output/artifact uploads in a public runner repository.
console.log('Verified VM attempt delivered to judge.');
