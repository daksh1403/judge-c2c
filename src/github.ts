import { importPKCS8, SignJWT } from 'jose';
import type { Contract } from './domain';
import { boundedBody } from './security';
import type { Env } from './env';
export type ChangedFile = {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
};
export class GitHub {
  constructor(private token?: string) {}
  static async installation(env: Env, contract: Contract) {
    if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY)
      throw new Error('GITHUB_APP_NOT_CONFIGURED');
    const key = await importPKCS8(
      env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n'),
      'RS256',
    );
    const now = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(env.GITHUB_APP_ID)
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 540)
      .sign(key);
    const client = new GitHub(jwt);
    const response = await client.api<{ token: string }>(
      `/app/installations/${contract.repository.installationId}/access_tokens`,
      {
        method: 'POST',
        body: JSON.stringify({
          repository_ids: [contract.repository.id],
          permissions: {
            contents: 'read',
            pull_requests: 'read',
            checks: 'write',
          },
        }),
      },
    );
    return new GitHub(response.token);
  }
  async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//'))
      throw new Error('Invalid GitHub path');
    const response = await fetch('https://api.github.com' + path, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000),
      headers: {
        accept: 'application/vnd.github+json',
        ...(this.token ? { authorization: 'Bearer ' + this.token } : {}),
        'user-agent': 'Judge-C2C',
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
      },
    });
    if (!response.ok) throw new Error(`GITHUB_HTTP_${response.status}`);
    const bytes = await boundedBody(
      new Request('https://internal/', {
        method: 'POST',
        body: response.body,
        duplex: 'half',
      } as RequestInit),
      2_000_000,
    );
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }
  async compare(contract: Contract, head: string) {
    const result = await this.api<{
      merge_base_commit: { sha: string };
      files?: ChangedFile[];
      status: string;
    }>(
      `/repos/${contract.repository.fullName}/compare/${contract.baseline}...${head}`,
    );
    if (result.merge_base_commit.sha !== contract.baseline)
      throw new Error('BASELINE_NOT_ANCESTOR');
    if (
      !result.files ||
      result.files.length >= 300 ||
      result.files.length > contract.execution.maxFiles
    )
      throw new Error('DIFF_LIMIT');
    return result.files;
  }
  async file(repo: string, commit: string, path: string, max: number) {
    const escaped = path.split('/').map(encodeURIComponent).join('/');
    try {
      const value = await this.api<{
        type: string;
        encoding?: string;
        content?: string;
        size: number;
      }>(`/repos/${repo}/contents/${escaped}?ref=${commit}`);
      if (
        value.type !== 'file' ||
        value.encoding !== 'base64' ||
        value.size > max ||
        !value.content
      )
        return null;
      const bytes = Uint8Array.from(
        atob(value.content.replace(/\s/g, '')),
        (c) => c.charCodeAt(0),
      );
      if (bytes.length > max) return null;
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
        bytes,
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'GITHUB_HTTP_404')
        return '';
      throw error;
    }
  }
}
