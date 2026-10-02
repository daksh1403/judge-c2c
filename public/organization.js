(() => {
  const $ = (selector) => document.querySelector(selector);
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (char) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[char],
    );
  let timer = null;
  async function call(path, body) {
    const response = await fetch('/api/organization/' + path, {
      headers: body ? { 'content-type': 'application/json' } : {},
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'ORGANIZATION_UNAVAILABLE');
    return data;
  }
  function error(error) {
    $('#message').className = 'error';
    $('#message').textContent = error.message;
  }
  async function load() {
    clearTimeout(timer);
    $('#message').textContent = '';
    $('#login').hidden = true;
    $('#signout').hidden = true;
    $('#content').hidden = false;
    $('#breadcrumb').textContent = 'Workspace / GitHub organization';
    $('#mode-label').textContent = 'GITHUB APP';
    $('#demo-banner').hidden = true;
    try {
      const status = await call('status');
      if (!status.authenticated) {
        $('#content').innerHTML =
          `<section class="panel"><div class="panel-head"><h2>Connect ${esc(status.organization)}</h2></div><form class="review-form" id="organization-login"><p>Unlock the organization console with your organizer access code. App private keys stay on the server.</p><label for="organization-token">Organizer access code</label><input id="organization-token" type="password" autocomplete="off" required minlength="32"><button class="button primary">Unlock organization</button></form></section>`;
        $('#organization-login').addEventListener('submit', async (event) => {
          event.preventDefault();
          const token = $('#organization-token').value;
          $('#organization-token').value = '';
          try {
            await call('login', { token });
            await load();
          } catch (e) {
            error(e);
          }
        });
        return;
      }
      const app = status.app;
      $('#content').innerHTML =
        `<section class="panel"><div class="panel-head"><h2>${esc(status.organization)} · GitHub App</h2><button class="button" id="organization-lock">Lock organization</button></div><div class="inset"><p>${app ? `App <strong>${esc(app.slug)}</strong> · ${app.installationId ? 'Installation #' + app.installationId : 'Awaiting installation'}` : 'Create an organization-owned GitHub App. Contents and PRs: read. Issues and checks: write. No source modification permissions.'}</p>${!app ? '<button class="button primary" id="register-app">Register App on GitHub</button>' : !app.installationId ? `<a class="button primary" href="${esc(app.installUrl)}">Install on ${esc(status.organization)}</a>` : '<button class="button" id="sync-repositories">Sync installed repositories</button>'}<p class="subtle">Only repositories selected during installation are available. Functional behavior remains UNVERIFIED until isolated checks provide execution evidence.</p></div></section><section class="panel inset"><p><strong>Isolated execution: ${status.runner?.enabled ? 'configured' : 'disabled'}</strong> · AI requirement review: ${status.ai?.enabled ? 'configured' : 'disabled'}</p><p class="subtle">${esc(status.runner?.reason || 'Runtime availability has not been verified.')}</p><button class="button" id="test-runner">Test Docker runner</button><p id="runner-status" role="status"></p><button class="button" id="test-reviewer">Test AI reviewer</button><p id="reviewer-status" role="status"></p></section><div id="organization-workflow"></div><div id="organization-repositories"></div><div id="organization-runs"></div><div id="organization-detail"></div>`;
      $('#organization-lock').addEventListener('click', async () => {
        try {
          await call('logout', {});
          await load();
        } catch (e) {
          error(e);
        }
      });
      $('#test-runner')?.addEventListener('click', async () => {
        const button = $('#test-runner');
        button.disabled = true;
        $('#runner-status').textContent =
          'Checking the authenticated tunnel and isolated baseline/submission containers…';
        try {
          const result = await call('runner-check', {});
          $('#runner-status').textContent =
            result.status === 'COMPLETED'
              ? 'Docker runner verified: missing baseline FAIL → trusted canary PASS. Synthetic diagnostic, not a participant PR evaluation.'
              : 'Runner diagnostic: ' +
                result.status +
                '. No functional behavior has been verified.';
        } catch (e) {
          error(e);
          $('#runner-status').textContent =
            'Runner unavailable. Participant checks remain UNVERIFIED.';
        } finally {
          button.disabled = false;
        }
      });
      $('#test-reviewer')?.addEventListener('click', async () => {
        const button = $('#test-reviewer');
        button.disabled = true;
        $('#reviewer-status').textContent =
          'Checking provider and structured output validation…';
        try {
          const result = await call('reviewer-check', {});
          $('#reviewer-status').textContent =
            result.status === 'COMPLETED'
              ? 'AI reviewer returned a validated report. This is a synthetic diagnostic, not a PR evaluation.'
              : 'Reviewer diagnostic: ' +
                result.status +
                '. Objective evidence remains available.';
        } catch (e) {
          error(e);
        } finally {
          button.disabled = false;
        }
      });
      $('#register-app')?.addEventListener('click', async () => {
        try {
          const setup = await call('start', {});
          const target = new URL(setup.action);
          if (target.origin !== 'https://github.com')
            throw new Error('INVALID_REGISTRATION_TARGET');
          const form = document.createElement('form');
          form.action = target.href;
          form.method = 'POST';
          const field = document.createElement('input');
          field.type = 'hidden';
          field.name = 'manifest';
          field.value = JSON.stringify(setup.manifest);
          form.append(field);
          document.body.append(form);
          form.submit();
        } catch (e) {
          error(e);
        }
      });
      $('#sync-repositories')?.addEventListener('click', async () => {
        try {
          await call('sync', {});
          await load();
        } catch (e) {
          error(e);
        }
      });
      if (!app?.installationId) return;
      const [repos, overview] = await Promise.all([
        call('repositories'),
        call('overview'),
      ]);
      await window.JudgeCompetition.mount(
        $('#organization-workflow'),
        repos.repositories,
      );
      $('#organization-repositories').innerHTML =
        `<section class="panel"><div class="panel-head"><h2>Installed repositories</h2><span>${repos.repositories.filter((r) => r.accessible).length} available</span></div>${repos.repositories.map((r) => `<article class="repo-card"><h3>${esc(r.full_name)}</h3><p>${r.private ? 'Private' : 'Public'} · ${esc(r.default_branch)} · ${r.accessible ? 'Installation access confirmed' : 'Access removed'}</p>${r.accessible ? `<button class="button" data-configure="${r.id}">Configure issue and evaluation</button>` : ''}<div id="repository-${r.id}"></div></article>`).join('') || '<div class="empty">No repositories selected. Update the App installation on GitHub, then sync.</div>'}</section>`;
      document
        .querySelectorAll('[data-configure]')
        .forEach((button) =>
          button.addEventListener('click', () =>
            configure(Number(button.dataset.configure)),
          ),
        );
      $('#organization-runs').innerHTML =
        `<section class="panel"><div class="panel-head"><h2>Organization evaluations</h2><span>${overview.counts.active} active · ${overview.counts.attention} require attention</span></div>${overview.runs.map((run) => `<div class="inset"><button class="row-button" data-org-run="${esc(run.id)}"><strong>${esc(run.full_name)} · PR #${run.pr_number}</strong><small>${esc(run.state)} · ${esc(run.head_sha.slice(0, 12))}</small></button></div>`).join('') || '<div class="empty">Configure an assigned issue and team for a PR to start. Subsequent GitHub PR events evaluate new heads automatically.</div>'}</section>`;
      document
        .querySelectorAll('[data-org-run]')
        .forEach((button) =>
          button.addEventListener('click', () => detail(button.dataset.orgRun)),
        );
      const id = new URL(location.href).searchParams.get('evaluation');
      if (id) await detail(id);
    } catch (e) {
      error(e);
    }
  }
  async function configure(id) {
    try {
      const data = await call(`repositories/${id}/context`),
        container = $('#repository-' + id);
      if (!data.pulls.length || !data.issues.length) {
        container.innerHTML = `<p>Create an open issue and PR in <a href="https://github.com/${esc(data.repository.full_name)}">${esc(data.repository.full_name)}</a> to assign and evaluate work.</p>`;
        return;
      }
      container.innerHTML = `<form class="review-form" id="challenge-${id}"><label for="pr-${id}">Pull request</label><select id="pr-${id}" name="prNumber">${data.pulls.map((pr) => `<option value="${pr.number}">#${pr.number} · ${esc(pr.title)}</option>`).join('')}</select><label for="issue-${id}">Assigned issue</label><select id="issue-${id}" name="issueNumber">${data.issues.map((issue) => `<option value="${issue.number}">#${issue.number} · ${esc(issue.title)}</option>`).join('')}</select><label for="execution-${id}">Trusted execution profile</label><select id="execution-${id}" name="executionProfile"><option value="source-only">Source review only</option><option value="payment-retry-v1">Payment retry API v1 — four trusted acceptance cases</option></select><p class="subtle">The payment profile requires server.mjs serving POST /payments/retry on port 9000. It verifies transient retries, attempt limits, permanent failures and invalid limits. Select only if these are approved challenge requirements. With execution disabled, all four remain UNVERIFIED.</p><label for="team-${id}">Team name</label><input id="team-${id}" name="teamName" required maxlength="100"><label for="expected-${id}">Authoritative expected behavior and acceptance criteria</label><textarea id="expected-${id}" name="expectedBehavior" required minlength="10" maxlength="2000" rows="4"></textarea><label for="baseline-${id}">Freeze baseline commit</label><input id="baseline-${id}" name="baseline" value="${esc(data.baseline)}" pattern="[a-f0-9]{40}" required><p class="subtle">Defaults to the current default-branch commit. Confirm this is the intended starting state; it must be an ancestor of the PR head.</p><div class="form-grid"><div><label for="source-${id}">Source assertion path (optional)</label><input id="source-${id}" name="sourcePath"></div><div><label for="literal-${id}">Required literal text (optional)</label><input id="literal-${id}" name="sourceText" maxlength="1000"></div></div><label for="protected-${id}">Protected paths (one per line)</label><textarea id="protected-${id}" name="protectedPaths" rows="2"></textarea><p class="subtle">These expectations are stored outside the participant repository. Activating creates immutable evaluation inputs and publishes a Judge-C2C Check to the PR.</p><button class="button primary" type="submit">Activate challenge and evaluate PR</button><div id="challenge-status-${id}" role="status"></div></form>`;
      $('#challenge-' + id).addEventListener('submit', async (event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget),
          button = event.currentTarget.querySelector('button[type=submit]');
        const input = {
          repositoryId: id,
          prNumber: Number(values.get('prNumber')),
          issueNumber: Number(values.get('issueNumber')),
          teamName: values.get('teamName'),
          expectedBehavior: values.get('expectedBehavior'),
          baseline: values.get('baseline'),
          executionProfile: values.get('executionProfile'),
          protectedPaths: String(values.get('protectedPaths'))
            .split('\n')
            .map((value) => value.trim())
            .filter(Boolean),
        };
        if (values.get('sourcePath') || values.get('sourceText')) {
          if (!values.get('sourcePath') || !values.get('sourceText')) {
            error(new Error('Provide both source path and literal text.'));
            return;
          }
          input.sourceAssertion = {
            path: values.get('sourcePath'),
            text: values.get('sourceText'),
          };
        }
        button.disabled = true;
        try {
          const result = await call('challenges', input);
          $('#challenge-status-' + id).textContent =
            'Evaluation queued. Open the report below.';
          await load();
          if (result.runId) await detail(result.runId);
        } catch (e) {
          button.disabled = false;
          error(e);
        }
      });
    } catch (e) {
      error(e);
    }
  }
  async function detail(id) {
    try {
      clearTimeout(timer);
      const run = await call('evaluations/' + encodeURIComponent(id)),
        contract = JSON.parse(run.contract_snapshot),
        evidence = JSON.parse(run.evidence || '[]'),
        report = JSON.parse(run.report || 'null');
      history.replaceState(
        null,
        '',
        '/?organization=1&evaluation=' + encodeURIComponent(id),
      );
      $('#organization-detail').innerHTML =
        `<section class="panel"><div class="panel-head"><h2>${esc(run.full_name)} · PR #${run.pr_number}</h2><span class="badge">${esc(run.state)}</span></div><div class="inset"><p>Baseline <code>${esc(run.baseline_sha)}</code><br>Head <code>${esc(run.head_sha)}</code></p><p>Evaluation ${esc(contract.evaluationVersion)} · GitHub publication: ${esc(run.publication_status)}</p><p>${esc(report?.summary || run.failure_code || 'Evaluation in progress')}</p><p>Functional behavior is verified only by the listed trusted execution results. Missing checks remain UNVERIFIED; benchmarks and full security scans are not available.</p></div><div class="panel-head"><h3>Authoritative requirements</h3></div>${contract.requirements.flatMap((req) => req.criteria.map((criterion) => `<div class="criterion"><strong>${esc(criterion.id)} · ${esc(report?.assessments.find((a) => a.criterionId === criterion.id)?.status || 'UNVERIFIED')}</strong><p>${esc(criterion.description)}</p></div>`)).join('')}${window.JudgeApproach(report)}<div class="panel-head"><h3>Evidence ledger</h3></div>${evidence.map((item) => `<div class="evidence-item"><strong>${esc(item.status)} · ${esc(item.id)}</strong><p>${esc(item.claim)}</p>${item.path ? `<code>${esc(item.path)}</code>` : ''}${item.baselineStatus ? `<p>Baseline ${esc(item.baselineStatus)} → head ${esc(item.status)}</p>` : ''}</div>`).join('')}<div class="panel-head"><h3>Isolated execution</h3></div>${
          (run.execution || [])
            .map((row) => {
              const result = JSON.parse(row.result);
              return `<div class="inset"><strong>${esc(row.commit_sha === run.baseline_sha ? 'Baseline' : 'Submission')} · ${esc(row.commit_sha.slice(0, 12))}</strong><p>Image ${esc(result.image)} · ${esc(result.runtime)} · ${esc(result.version)}</p><p>Evidence SHA-256 <code>${esc(row.result_hash)}</code></p>${result.checks.map((check) => `<div class="evidence-item"><strong>${esc(check.status)} · ${esc(check.kind)} · ${esc(check.id)}</strong><p>${esc(check.detail)}</p><p>${check.durationMs} ms · exit ${esc(String(check.exitCode ?? 'N/A'))}</p>${check.stdout || check.stderr ? `<details><summary>Bounded output</summary><pre>${esc(check.stdout)}${esc(check.stderr)}</pre></details>` : ''}</div>`).join('')}</div>`;
            })
            .join('') ||
          '<div class="empty">No runtime results have been recorded. Isolated execution is disabled or unavailable.</div>'
        }<div class="panel-head"><h3>Evaluation history</h3></div><ol class="timeline">${run.timeline.map((item) => `<li><strong>${esc(item.state)}</strong> ${esc(item.detail)}<small>${esc(item.created_at)}</small></li>`).join('')}</ol></section>`;
      if (!['COMPLETED', 'FAILED', 'SUPERSEDED'].includes(run.state))
        timer = setTimeout(() => detail(id), 2500);
    } catch (e) {
      error(e);
    }
  }
  window.organizationWorkspace = { load, stop: () => clearTimeout(timer) };
})();
