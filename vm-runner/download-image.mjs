import { mkdir, open } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { imageIdentity } from './qemu-vm.mjs';
const release = process.env.VM_RELEASE,
  repo = process.env.VM_REPOSITORY;
if (
  !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(release ?? '') ||
  !/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') ||
  !/^qemu-vm@sha256:[a-f0-9]{64}$/.test(process.env.VM_IMAGE ?? '')
)
  throw Error('PREPARED_VM_NOT_CONFIGURED');
await mkdir('vm-runner/images', { recursive: true });
for (const file of ['root.raw', 'kernel', 'initrd']) {
  const response = await fetch(
    `https://github.com/${repo}/releases/download/${release}/${file === 'root.raw' ? 'root.raw.gz' : file}`,
    { signal: AbortSignal.timeout(180000) },
  );
  if (!response.ok || !response.body) throw Error('PREPARED_VM_UNAVAILABLE');
  const handle = await open('vm-runner/images/' + file, 'w', 0o600);
  let bytes = 0;
  try {
    const stream = Readable.from(
      (async function* () {
        for await (const chunk of response.body) {
          bytes += chunk.byteLength;
          if (bytes > 536870912) throw Error('VM_IMAGE_SIZE_LIMIT');
          yield chunk;
        }
      })(),
    );
    let unpacked = 0;
    const bound = new Transform({
      transform(chunk, _encoding, callback) {
        unpacked += chunk.length;
        callback(
          unpacked > (file === 'root.raw' ? 2147483648 : 268435456)
            ? Error('VM_IMAGE_SIZE_LIMIT')
            : null,
          chunk,
        );
      },
    });
    if (file === 'root.raw')
      await pipeline(stream, createGunzip(), bound, handle.createWriteStream());
    else await pipeline(stream, bound, handle.createWriteStream());
  } finally {
    await handle.close();
  }
}
const actual = await imageIdentity({
  disk: 'vm-runner/images/root.raw',
  kernel: 'vm-runner/images/kernel',
  initrd: 'vm-runner/images/initrd',
});
if (actual !== process.env.VM_IMAGE) throw Error('PREPARED_VM_DIGEST_MISMATCH');
