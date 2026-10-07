import assert from 'node:assert/strict';
import { evaluateVM, imageIdentity } from './qemu-vm.mjs';
const image = {
  disk: process.env.VM_DISK,
  kernel: process.env.VM_KERNEL,
  initrd: process.env.VM_INITRD,
};
const identity = await imageIdentity(image);
const policy = {
  version: 'node-http-v1',
  image: identity,
  entrypoint: 'server.mjs',
  commands: [
    { id: 'syntax', kind: 'build', argv: ['node', '--check', 'server.mjs'] },
  ],
  cases: [
    {
      id: 'ready',
      path: '/ready',
      method: 'GET',
      expectedStatus: 200,
      expectedBody: { ready: true },
    },
  ],
};
const base = {
  runId: 'a'.repeat(64),
  commit: 'b'.repeat(40),
  contractHash: 'c'.repeat(64),
  policy,
  timeoutSeconds: 120,
  memoryMiB: 256,
};
const absent = await evaluateVM({ ...base, files: [] }, image, true);
assert.equal(absent.checks.find((c) => c.id === 'ready').status, 'FAIL');
const source =
  "import {createServer} from 'node:http';createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({ready:true}));}).listen(9000,'0.0.0.0');";
const present = await evaluateVM(
  { ...base, files: [{ path: 'server.mjs', text: source }] },
  image,
  true,
);
assert.equal(present.checks.find((c) => c.id === 'ready').status, 'PASS');
assert.equal(present.checks.find((c) => c.id === 'syntax').status, 'PASS');
const security = `import {readFileSync,writeFileSync} from 'node:fs';import {createServer} from 'node:http';let rootReadOnly=false,secretAbsent=false,networkBlocked=false;try{writeFileSync('/opt/judge/escape','bad')}catch{rootReadOnly=true}secretAbsent=!process.env.GITHUB_TOKEN&&!process.env.GEMINI_API_KEY&&!process.env.GROQ_API_KEY;try{await fetch('http://169.254.169.254/',{signal:AbortSignal.timeout(500)})}catch{networkBlocked=true}createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({rootReadOnly,secretAbsent,networkBlocked,uid:process.getuid()}));}).listen(9000,'0.0.0.0');`;
const hardened = await evaluateVM(
  {
    ...base,
    files: [{ path: 'server.mjs', text: security }],
    policy: {
      ...policy,
      commands: [],
      cases: [
        {
          ...policy.cases[0],
          expectedBody: {
            rootReadOnly: true,
            secretAbsent: true,
            networkBlocked: true,
            uid: 65534,
          },
        },
      ],
    },
  },
  image,
  true,
);
assert.equal(hardened.checks[0].status, 'PASS');
console.log(
  JSON.stringify({
    synthetic: true,
    identity,
    absent: 'FAIL',
    reference: 'PASS',
    nonrootReadOnlySecretMetadata: 'PASS',
    scope:
      'Bounded canary; not full adversarial or 80-team capacity certification.',
  }),
);
