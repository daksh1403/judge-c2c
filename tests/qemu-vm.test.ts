import { expect, it } from 'vitest';
import { vmArguments, guestInput } from '../src/qemu-vm';
import { paymentRetryPolicy } from '../src/runner-policy';
it('boots a read-only bounded guest without host mounts, external network or credentials', () => {
  const args = vmArguments(
    {
      disk: '/trusted/root.raw',
      kernel: '/trusted/kernel',
      initrd: '/trusted/initrd',
    },
    '/tmp/job.json',
    19000,
    false,
  );
  expect(args).toContain('256');
  expect(args.join(' ')).toContain('net.ifnames=0 biosdevname=0');
  expect(args).toContain(
    'file=/trusted/root.raw,format=raw,if=virtio,readonly=on',
  );
  expect(args).toContain(
    'user,model=virtio-net-pci,restrict=on,hostfwd=tcp:127.0.0.1:19000-:9000',
  );
  expect(args.join(' ')).not.toMatch(/virtfs|9p|docker|secret|token/i);
});
it('passes only bounded source and execution operation to the guest, never authoritative assertions', () => {
  const input = guestInput(
    {
      files: [{ path: 'server.mjs', text: 'source' }],
      policy: paymentRetryPolicy,
    },
    ['node', '--check', 'server.mjs'],
  );
  expect(input).toEqual({
    files: [{ path: 'server.mjs', text: 'source' }],
    argv: ['node', '--check', 'server.mjs'],
    mode: 'command',
  });
  expect(JSON.stringify(input)).not.toContain('expectedBody');
  expect(() =>
    guestInput(
      { files: [{ path: '../escape', text: '' }], policy: paymentRetryPolicy },
      ['node'],
    ),
  ).toThrow();
});
