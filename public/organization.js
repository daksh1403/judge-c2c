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
  let timer = null,
    roleObserver = null,
    authenticatedRole = null;
  async function call(path, body) {
    const response = await fetch('/api/organization/' + path, {
      headers: body ? { 'content-type': 'application/json' } : {},
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) {
      const failure = new Error(data.error || 'ORGANIZATION_UNAVAILABLE');
      failure.status = response.status;
      throw failure;
    }
    return data;
  }
  function error(error) {
    $('#message').className = 'error';
    $('#message').textContent = error.message;
  }
  function dateLabel(value) {
    if (value === null || value === undefined || value === '')
      return 'Unavailable';
    const normalized =
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
        ? `${value.replace(' ', 'T')}Z`
        : value;
    const date = new Date(normalized);
    return Number.isNaN(date.valueOf()) ? 'Unavailable' : date.toISOString();
  }
  function evidenceLinks(ids, available) {
    return (
      (ids || [])
        .filter((id) => available.has(String(id)))
        .map(
          (id) =>
            `<a class="evidence-link" href="#evidence-${encodeURIComponent(String(id))}">${esc(id)}</a>`,
        )
        .join('') || '<span class="subtle">No linked evidence recorded.</span>'
    );
  }
  function requirementStatus(value) {
    return ['PASS', 'PARTIAL', 'FAIL', 'UNVERIFIED'].includes(value)
      ? value
      : 'UNVERIFIED';
  }
  function escapedList(values, emptyLabel = 'None recorded.') {
    if (!Array.isArray(values)) return '<span>Not available</span>';
    if (values.length === 0) return `<span>${esc(emptyLabel)}</span>`;
    return `<ul>${values.map((value) => `<li>${esc(value)}</li>`).join('')}</ul>`;
  }
  function checkComparison(execution, baselineSha, headSha) {
    const rows = execution || [],
      baselineResults = rows.filter((row) => row.commit_sha === baselineSha),
      headResults = rows.filter((row) => row.commit_sha === headSha);
    if (baselineSha === headSha)
      return '<p class="subtle">Baseline/head comparison unavailable: both frozen inputs refer to the same commit.</p>';
    if (baselineResults.length > 1 || headResults.length > 1)
      return '<p class="subtle">Baseline/head comparison unavailable: multiple exact-commit executions exist, so retry history is ambiguous.</p>';
    const baseline = baselineResults[0],
      head = headResults[0];
    if (!baseline || !head)
      return '<p class="subtle">Baseline/head comparison unavailable: a trusted result for both exact commits is not recorded.</p>';
    const parse = (row) => {
        try {
          return JSON.parse(row.result).checks || [];
        } catch {
          return [];
        }
      },
      baselineChecks = parse(baseline),
      headChecks = parse(head),
      keyed = new Map(
        baselineChecks.map((check) => [`${check.kind}:${check.id}`, check]),
      );
    return (
      headChecks
        .map((check) => {
          const prior = keyed.get(`${check.kind}:${check.id}`),
            explanation = !prior
              ? 'No matching baseline check; comparison unavailable.'
              : prior.status === 'FAIL' && check.status === 'FAIL'
                ? 'Failed on baseline and head; pre-existing failure, not a demonstrated regression.'
                : prior.status === 'PASS' && check.status === 'FAIL'
                  ? 'Passed on baseline and failed on head; regression observed.'
                  : prior.status === 'FAIL' && check.status === 'PASS'
                    ? 'Baseline failure passes on head.'
                    : prior.status === check.status
                      ? 'Same status on baseline and head.'
                      : `Baseline ${prior.status}; head ${check.status}.`;
          return `<div class="evidence-item"><strong>${esc(check.kind)} · ${esc(check.id)}: ${esc(prior?.status || 'Unavailable')} → ${esc(check.status)}</strong><p>${esc(explanation)}</p></div>`;
        })
        .join('') ||
      '<p class="subtle">No head checks are available for comparison.</p>'
    );
  }
  async function load() {
    clearTimeout(timer);
    roleObserver?.disconnect();
    roleObserver = null;
    authenticatedRole = null;
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
      authenticatedRole = status.role;
      const app = status.app;
      if (status.role === 'judge') {
        const disableAdmin = () => {
          for (const form of document.querySelectorAll(
            '#content form:not(#workflow-query)',
          ))
            for (const control of form.querySelectorAll(
              'input,select,textarea,button',
            ))
              if (!control.disabled) control.disabled = true;
          for (const control of document.querySelectorAll(
            '#sync-repositories,#register-app,#test-runner,#test-reviewer,#retry-labels,#retry-evaluation,[data-configure]',
          ))
            if (!control.disabled) control.disabled = true;
        };
        roleObserver = new MutationObserver(disableAdmin);
        roleObserver.observe($('#content'), { childList: true, subtree: true });
        disableAdmin();
        $('#mode-label').textContent = 'JUDGE · READ ONLY';
      }
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
        `<section class="panel"><div class="panel-head"><h2>Organization evaluations</h2><span>${overview.counts.active} active · ${overview.counts.attention} require attention</span></div>${overview.runs.map((run) => `<div class="inset"><button class="row-button" data-org-run="${esc(run.id)}"><strong>${esc(run.full_name ?? contract.repository.fullName)} · PR #${run.pr_number}</strong><small>${esc(run.state)} · ${esc(run.head_sha.slice(0, 12))}</small></button></div>`).join('') || '<div class="empty">Configure an assigned issue and team for a PR to start. Subsequent GitHub PR events evaluate new heads automatically.</div>'}</section>`;
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
  async function detail(
    id,
    artifactCaptureResult = null,
    contributionNotice = null,
  ) {
    try {
      clearTimeout(timer);
      const run = await call('evaluations/' + encodeURIComponent(id)),
        contract = JSON.parse(run.contract_snapshot),
        evidence = JSON.parse(run.evidence || '[]'),
        report = JSON.parse(run.report || 'null');
      const current = run.currentSubmission,
        freshness = !current
          ? '<p class="freshness unknown" role="status">Current submission status is unavailable; freshness cannot be confirmed.</p>'
          : current.closed
            ? '<p class="freshness historical" role="status">Submission is closed. This evaluation is historical.</p>'
            : current.latestRunId === run.id && current.headSha === run.head_sha
              ? '<p class="freshness current" role="status">Current evaluation for the open submission head.</p>'
              : `<p class="freshness historical" role="status">Historical evaluation. Current open submission head: ${esc(current.headSha)} · latest run ${esc(current.latestRunId)}.</p>`,
        evidenceById = new Map(evidence.map((item) => [String(item.id), item]));
      history.replaceState(
        null,
        '',
        '/?organization=1&evaluation=' + encodeURIComponent(id),
      );
      const executions = run.execution || [],
        artifacts = run.artifacts || [],
        additionalContributions = Array.isArray(run.additionalContributions)
          ? run.additionalContributions
          : [],
        requirementResults = Array.isArray(run.requirementResults)
          ? run.requirementResults
          : [],
        requirementResultById = new Map(
          requirementResults.map((result) => [result.requirementId, result]),
        ),
        contributionCategories = Array.isArray(contract.additionalCategories)
          ? contract.additionalCategories.slice(0, 20)
          : [],
        runContext = (() => {
          try {
            return typeof run.context === 'string'
              ? JSON.parse(run.context)
              : run.context || {};
          } catch {
            return {};
          }
        })(),
        changedPaths = [
          ...new Set(
            (Array.isArray(runContext.files) ? runContext.files : [])
              .map((file) => file?.filename || file?.path)
              .filter((path) => typeof path === 'string' && path.length > 0),
          ),
        ].slice(0, 100),
        eligibleCriterionIds = (contract.requirements || []).flatMap(
          (requirement) => {
            const projection = requirementResultById.get(requirement.id),
              projectionCriteria = Array.isArray(projection?.criteria)
                ? projection.criteria
                : [],
              statusById = new Map(
                projectionCriteria.map((criterion) => [
                  criterion.criterionId,
                  requirementStatus(criterion.status),
                ]),
              );
            return (requirement.criteria || [])
              .filter(
                (criterion) =>
                  requirement.mandatory === false &&
                  statusById.get(criterion.id) === 'PASS',
              )
              .map((criterion) => criterion.id);
          },
        ),
        currentOpenRun =
          run.state === 'COMPLETED' &&
          run.currentSubmission &&
          !run.currentSubmission.closed &&
          run.currentSubmission.latestRunId === run.id &&
          run.currentSubmission.headSha === run.head_sha,
        terminal = ['COMPLETED', 'FAILED', 'SUPERSEDED'].includes(run.state),
        recapturableArtifacts = artifacts.some((artifact) => {
          const expires =
            artifact.expires_at == null ? null : Number(artifact.expires_at);
          return (
            ['PENDING', 'FAILED'].includes(artifact.status) &&
            expires !== null &&
            Number.isFinite(expires) &&
            expires > Date.now()
          );
        }),
        requirementsHtml = (contract.requirements || [])
          .map((requirement) => {
            const result = requirementResultById.get(requirement.id),
              mandatory =
                typeof result?.mandatory === 'boolean'
                  ? result.mandatory
                  : typeof requirement.mandatory === 'boolean'
                    ? requirement.mandatory
                    : null,
              requirementCriteria = Array.isArray(result?.criteria)
                ? result.criteria
                : [],
              criterionResultById = new Map(
                requirementCriteria.map((item) => [item.criterionId, item]),
              ),
              obligation =
                mandatory === true
                  ? 'Mandatory'
                  : mandatory === false
                    ? 'Optional'
                    : 'Requirement type unavailable',
              attention =
                result?.needsAttention === true
                  ? 'Needs attention'
                  : result?.needsAttention === false
                    ? 'No attention flag'
                    : 'Attention status unavailable',
              criteria = (requirement.criteria || [])
                .map((criterion) => {
                  const objective = criterionResultById.get(criterion.id),
                    status = requirementStatus(objective?.status),
                    reason =
                      objective?.reason ||
                      (result
                        ? 'No deterministic criterion result is available.'
                        : 'No deterministic requirement result is available.');
                  return `<div class="criterion"><strong>${esc(criterion.id)} · ${esc(status)}</strong><p class="description">${esc(criterion.description)}</p><p>${esc(reason)}</p><div class="criterion-evidence" aria-label="Evidence for ${esc(criterion.id)}">${evidenceLinks(objective?.evidenceIds, evidenceById)}</div></div>`;
                })
                .join('');
            return `<section class="requirement-group" data-requirement-id="${esc(requirement.id)}"><div class="panel-head"><h4>${esc(requirement.title || requirement.id)}</h4><span>${esc(obligation)}</span><strong class="badge">${esc(requirementStatus(result?.status))}</strong></div><p>${esc(attention)}</p>${criteria}</section>`;
          })
          .join(''),
        executionHtml = executions
          .map((row) => {
            const result = JSON.parse(row.result),
              cacheStatus = row.cache_status || 'Unavailable',
              request =
                typeof row.request === 'string'
                  ? (() => {
                      try {
                        return JSON.parse(row.request);
                      } catch {
                        return null;
                      }
                    })()
                  : row.request;
            return `<div class="inset"><strong>${esc(row.commit_sha === run.baseline_sha ? 'Baseline' : row.commit_sha === run.head_sha ? 'Submission head' : 'Execution')} · ${esc((row.commit_sha || '').slice(0, 12))}</strong><p>Image ${esc(result.image)} · ${esc(result.runtime)} · ${esc(result.version)}</p><p>Evidence SHA-256 <code>${esc(row.result_hash)}</code></p><div class="provenance"><strong>Execution provenance</strong><p>Cache: ${esc(cacheStatus)} · original execution: ${esc(dateLabel(result.startedAt))} – ${esc(dateLabel(result.finishedAt))}</p><p>Recorded in detail: ${esc(dateLabel(row.created_at))}</p><p>Original request hash: <code>${esc(row.request_hash || 'Unavailable')}</code> · origin run: ${esc(row.origin_run_id || 'Unavailable')} · origin execution: ${esc(row.origin_execution_id || 'Unavailable')}</p><p>Cache key: <code>${esc(row.cache_key || 'Unavailable')}</code></p>${request ? `<details><summary>Safe request summary</summary><p>Original run ${esc(request.runId || 'Unavailable')} · commit ${esc(request.commit || 'Unavailable')} · policy ${esc(request.policyHash || 'Unavailable')}</p><ul>${(request.files || []).map((file) => `<li><code>${esc(file.path)}</code> · ${esc(file.sha256)} · ${esc(String(file.bytes))} bytes</li>`).join('')}</ul></details>` : '<p>Safe request summary unavailable.</p>'}</div>${result.checks.map((check) => `<div class="evidence-item"><strong>${esc(check.status)} · ${esc(check.kind)} · ${esc(check.id)}</strong><p>${esc(check.detail)}</p><p>${check.durationMs} ms · exit ${esc(String(check.exitCode ?? 'N/A'))}</p>${check.stdout || check.stderr ? `<details><summary>Bounded output</summary><pre>${esc(check.stdout)}${esc(check.stderr)}</pre></details>` : ''}</div>`).join('')}</div>`;
          })
          .join(''),
        artifactHtml =
          artifacts
            .map((artifact) => {
              const expires =
                  artifact.expires_at == null
                    ? null
                    : Number(artifact.expires_at),
                expired =
                  expires !== null &&
                  (!Number.isFinite(expires) || expires <= Date.now()),
                downloadable =
                  artifact.status === 'STORED' && expires !== null && !expired,
                download = `/api/organization/artifact?key=${encodeURIComponent(artifact.key)}`;
              return `<div class="evidence-item artifact"><strong>${esc(artifact.kind || 'Artifact')} · ${esc(artifact.status || 'Unavailable')}</strong><p>${esc(String(artifact.bytes ?? 'Unavailable'))} bytes · SHA-256 <code>${esc(artifact.sha256 || 'Unavailable')}</code></p><p>Created ${esc(dateLabel(artifact.created_at))} · expires ${artifact.expires_at == null ? 'Unavailable' : esc(dateLabel(expires))}</p>${artifact.error_code ? `<p>Safe failure reason: ${esc(artifact.error_code)}</p>` : ''}${downloadable ? `<a class="button" href="${download}">Download protected artifact</a>` : `<span class="button disabled" aria-disabled="true">${expired ? 'Download expired' : 'Download unavailable'}</span>`}</div>`;
            })
            .join('') ||
          '<p class="subtle">No artifact metadata is available.</p>';
      const contributionsHtml = additionalContributions.length
          ? additionalContributions
              .map((contribution) => {
                const decision = contribution.latestDecision,
                  verificationStatus =
                    contribution.verificationStatus === 'VERIFIED' ||
                    contribution.verificationStatus === 'UNVERIFIED'
                      ? contribution.verificationStatus
                      : 'Not available',
                  verificationLabel =
                    verificationStatus === 'VERIFIED'
                      ? 'Criterion improvement verified'
                      : verificationStatus,
                  verificationExplanation =
                    verificationStatus === 'VERIFIED'
                      ? 'Configured criterion improvement verified; claimed design and file attribution require organizer review.'
                      : verificationStatus === 'UNVERIFIED'
                        ? 'No configured criterion improvement is verified.'
                        : 'Verification status is not available.',
                  mayRecognize =
                    authenticatedRole === 'organizer' &&
                    currentOpenRun &&
                    verificationStatus === 'VERIFIED',
                  id = esc(contribution.id || 'Not available');
                return `<article class="inset contribution-card" data-contribution-id="${id}"><div class="panel-head"><h4>${esc(contribution.title || 'Not available')}</h4><span>${esc(contribution.category || 'Not available')}</span><span class="badge">${esc(verificationLabel)}</span></div><p>${esc(verificationExplanation)}</p><p>${esc(contribution.description || 'Not available')}</p><p>Contribution ${id} · run ${esc(contribution.runId || 'Not available')} · submitted by ${esc(contribution.actor || 'Not available')} · ${esc(dateLabel(contribution.createdAt))}</p><p>Changed paths ${escapedList(contribution.paths)}</p><p>Criteria ${escapedList(contribution.criterionIds)}</p><div class="contribution-evidence"><strong>Evidence</strong>${evidenceLinks(contribution.evidenceIds, evidenceById)}</div>${decision ? `<div class="inset"><strong>Latest decision ${esc(decision.decision || 'Not available')} · sequence ${esc(String(decision.sequence ?? 'Not available'))}</strong><p>Decision ${esc(decision.id || 'Not available')} · candidate ${esc(decision.candidateId || 'Not available')} · run ${esc(decision.runId || 'Not available')}</p><p>${esc(decision.reason || 'Not available')}</p><p>${esc(decision.actor || 'Not available')} · ${esc(dateLabel(decision.createdAt))}</p></div>` : '<p>No decision recorded.</p>'}${authenticatedRole === 'organizer' ? `<label for="contribution-reason-${encodeURIComponent(String(contribution.id || 'unknown'))}">Decision reason</label><textarea id="contribution-reason-${encodeURIComponent(String(contribution.id || 'unknown'))}" data-contribution-reason rows="2" minlength="20" maxlength="2000"></textarea><div class="contribution-actions"><button class="button" aria-label="Recognize criterion improvement" data-contribution-decision="RECOGNIZED" ${mayRecognize ? '' : 'disabled'}>Recognize criterion improvement</button><button class="button" data-contribution-decision="REJECTED">Reject</button></div><p data-contribution-status role="status"></p>` : ''}</article>`;
              })
              .join('')
          : '<p class="empty">No additional contributions have been recorded.</p>',
        contributionPathsHtml = changedPaths.length
          ? changedPaths
              .map(
                (path) =>
                  `<label><input type="checkbox" name="paths" value="${esc(path)}"> <code>${esc(path)}</code></label>`,
              )
              .join('')
          : '<p>No changed paths are available for selection.</p>',
        contributionEvidenceHtml = evidence.length
          ? evidence
              .map(
                (item) =>
                  `<label><input type="checkbox" name="evidenceIds" value="${esc(item.id)}"> ${esc(item.id)} · ${esc(item.status)}</label>`,
              )
              .join('')
          : '<p>No known evidence is available for selection.</p>',
        contributionCriteriaHtml = eligibleCriterionIds.length
          ? eligibleCriterionIds
              .map(
                (criterionId) =>
                  `<label><input type="checkbox" name="criterionIds" value="${esc(criterionId)}"> ${esc(criterionId)}</label>`,
              )
              .join('')
          : '<p>No verified criteria are available to associate.</p>',
        contributionFormHtml =
          authenticatedRole === 'organizer' &&
          run.state === 'COMPLETED' &&
          contributionCategories.length > 0 &&
          changedPaths.length > 0 &&
          evidence.length > 0
            ? `<form id="add-contribution-form" class="review-form"><label for="contribution-category">Category</label><select id="contribution-category" name="category" required>${contributionCategories.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join('')}</select><label for="contribution-title">Title</label><input id="contribution-title" name="title" required maxlength="120"><label for="contribution-description">Description</label><textarea id="contribution-description" name="description" required minlength="20" maxlength="2000" rows="3"></textarea><fieldset><legend>Changed paths</legend>${contributionPathsHtml}</fieldset><fieldset><legend>Known evidence</legend>${contributionEvidenceHtml}</fieldset><fieldset><legend>Optional criterion checks (passing checks do not alone prove baseline improvement)</legend>${contributionCriteriaHtml}</fieldset><button class="button" type="submit">Add contribution</button><p id="contribution-form-status" role="status"></p></form>`
            : authenticatedRole === 'organizer'
              ? run.state !== 'COMPLETED'
                ? '<p>Additional contributions can be added to completed evaluations only.</p>'
                : !contributionCategories.length
                  ? '<p>No additional contribution categories are configured.</p>'
                  : '<p>Contribution entry requires available changed paths and known evidence.</p>'
              : '',
        contributionNoticeHtml = contributionNotice
          ? `<p class="${contributionNotice.type === 'warning' ? 'error' : 'artifact-capture-notice'}" role="status">${esc(contributionNotice.message)}</p>`
          : '';
      const artifactCaptureHtml =
          authenticatedRole === 'organizer' && terminal && recapturableArtifacts
            ? '<div class="artifact-capture"><button class="button" id="retry-artifact-capture">Retry artifact capture</button><p id="artifact-retry-status" role="status"></p></div>'
            : '',
        artifactCaptureNotice = artifactCaptureResult
          ? `<p class="artifact-capture-notice" role="status">Artifact capture ${esc(artifactCaptureResult.status)}.${(artifactCaptureResult.failures || []).map((failure) => ` ${esc(failure.kind)}: ${esc(failure.code)}.`).join('')}</p>`
          : '';
      $('#organization-detail').innerHTML =
        `<section class="panel"><div class="panel-head"><h2>${esc(run.full_name ?? contract.repository.fullName)} · PR #${run.pr_number}</h2><span class="badge">${esc(run.state)}</span></div><div class="inset">${freshness}<p>Frozen baseline <code>${esc(run.baseline_sha)}</code><br>Evaluated head <code>${esc(run.head_sha)}</code></p><p>Evaluation ${esc(contract.evaluationVersion)} · GitHub publication: ${esc(run.publication_status)} · AI review: ${esc(run.ai_status || 'pending')}</p>${report?.aiTrace?.failureCode ? `<p class="error">AI review rejected: ${esc(report.aiTrace.failureCode)}. Objective evidence remains available.</p>` : ''}${run.state === 'FAILED' || (run.state === 'COMPLETED' && run.ai_status === 'FAILED') ? `<button class="button" id="retry-evaluation">Retry as a new evaluation attempt</button>` : ''}<p>${esc(report?.summary || run.failure_code || 'Evaluation in progress')}</p><p class="ai-notice">AI interpretation is advisory inference. It does not replace authoritative requirements or execution evidence, and it cannot mark unexecuted behavior as verified.</p><p>Functional behavior is verified only by the listed trusted execution results. Only configured checks are shown; unperformed checks remain UNVERIFIED. Source patterns and advisory matches do not establish exploitability.</p></div><p><a class="button" href="/api/organization/evaluations/${encodeURIComponent(id)}/bundle">Download reproducibility bundle</a></p><div class="panel-head"><h3>Authoritative requirements</h3></div>${requirementsHtml}${window.JudgeApproach(report)}<div class="panel-head"><h3>Evidence ledger</h3></div>${evidence.map((item) => `<div class="evidence-item" id="evidence-${encodeURIComponent(String(item.id))}"><strong>${esc(item.status)} · ${esc(item.id)}</strong><p>${esc(item.claim)}</p>${item.path ? `<code>${esc(item.path)}</code>` : ''}${item.baselineStatus ? `<p>Baseline ${esc(item.baselineStatus)} → head ${esc(item.status)}</p>` : ''}</div>`).join('')}<div class="panel-head"><h3>Additional contributions</h3></div><p>Contribution records and decisions do not change evaluation results automatically.</p>${contributionsHtml}${contributionFormHtml}${contributionNoticeHtml}<div class="panel-head"><h3>Baseline and head check comparison</h3></div>${checkComparison(executions, run.baseline_sha, run.head_sha)}<div class="panel-head"><h3>Isolated execution</h3></div>${
          executionHtml ||
          '<div class="empty">No runtime results have been recorded. Isolated execution is disabled or unavailable.</div>'
        }<div class="panel-head"><h3>Protected artifacts</h3></div>${artifactHtml}${artifactCaptureHtml}${artifactCaptureNotice}<div class="panel-head"><h3>Evaluation history</h3></div><ol class="timeline">${(run.timeline || []).map((item) => `<li><strong>${esc(item.state)}</strong> ${esc(item.detail)}<small>${esc(item.created_at)}</small></li>`).join('')}</ol></section>`;
      $('#add-contribution-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget,
          status = $('#contribution-form-status'),
          formData = new FormData(form),
          payload = {
            category: String(formData.get('category') || ''),
            title: String(formData.get('title') || ''),
            description: String(formData.get('description') || ''),
            paths: [...new Set(formData.getAll('paths').map(String))].filter(
              (path) => changedPaths.includes(path),
            ),
            evidenceIds: [
              ...new Set(formData.getAll('evidenceIds').map(String)),
            ].filter((evidenceId) => evidenceById.has(evidenceId)),
            criterionIds: [
              ...new Set(formData.getAll('criterionIds').map(String)),
            ].filter((criterionId) =>
              eligibleCriterionIds.includes(criterionId),
            ),
          };
        status.textContent = 'Saving contribution…';
        try {
          await call(
            'evaluations/' + encodeURIComponent(id) + '/contributions',
            payload,
          );
          await detail(id, null, {
            type: 'success',
            message: 'Contribution saved; records refreshed.',
          });
        } catch (failure) {
          const message =
            failure.status === 409
              ? 'Contribution could not be saved because evaluation state changed; refreshing records.'
              : failure.status === 403
                ? 'Organizer authorization is required to add a contribution.'
                : `Contribution could not be saved${failure.status ? ` (HTTP ${failure.status})` : ''}.`;
          await detail(id, null, { type: 'warning', message });
        }
      });
      for (const action of document.querySelectorAll(
        '[data-contribution-decision]',
      )) {
        action.addEventListener('click', async () => {
          const card = action.closest('[data-contribution-id]'),
            contribution = additionalContributions.find(
              (item) => String(item.id) === card?.dataset.contributionId,
            ),
            status = card?.querySelector('[data-contribution-status]'),
            reason = card
              ?.querySelector('[data-contribution-reason]')
              ?.value.trim(),
            decision = action.dataset.contributionDecision;
          if (
            !contribution ||
            !status ||
            !['RECOGNIZED', 'REJECTED'].includes(decision)
          )
            return;
          if (!reason || reason.length < 20) {
            status.textContent =
              'Enter a decision reason of at least 20 characters.';
            return;
          }
          if (
            decision === 'RECOGNIZED' &&
            (!currentOpenRun || contribution.verificationStatus !== 'VERIFIED')
          ) {
            status.textContent =
              'Recognition requires a verified contribution on the current open completed run.';
            return;
          }
          action.disabled = true;
          status.textContent = 'Saving decision…';
          try {
            await call(
              'contributions/' +
                encodeURIComponent(contribution.id) +
                '/decisions',
              {
                decision,
                reason,
                requestId: crypto.randomUUID(),
                expectedPreviousSequence:
                  contribution.latestDecision?.sequence ?? null,
              },
            );
            await detail(id, null, {
              type: 'success',
              message: 'Decision saved; contribution records refreshed.',
            });
          } catch (failure) {
            const message =
              failure.status === 409
                ? 'Decision state or eligibility changed; refreshing contribution records.'
                : failure.status === 403
                  ? 'Organizer authorization is required to record a decision.'
                  : `Decision could not be saved${failure.status ? ` (HTTP ${failure.status})` : ''}.`;
            await detail(id, null, { type: 'warning', message });
          }
        });
      }
      $('#retry-artifact-capture')?.addEventListener('click', async (event) => {
        const button = event.currentTarget,
          status = $('#artifact-retry-status'),
          stillEligible = (run.artifacts || []).some((artifact) => {
            const expires =
              artifact.expires_at == null ? null : Number(artifact.expires_at);
            return (
              ['PENDING', 'FAILED'].includes(artifact.status) &&
              expires !== null &&
              Number.isFinite(expires) &&
              expires > Date.now()
            );
          });
        if (!stillEligible) {
          status.textContent =
            'Artifact capture is unavailable because its retention window has expired.';
          button.remove();
          return;
        }
        button.disabled = true;
        status.textContent = 'Retrying artifact capture…';
        try {
          const result = await call(
            'evaluations/' + encodeURIComponent(id) + '/artifacts/retry',
            {},
          );
          if (!['CAPTURED', 'PARTIAL'].includes(result.status))
            throw new Error('CAPTURE_RESPONSE_INVALID');
          await detail(id, result);
        } catch (failure) {
          status.textContent =
            failure.status === 409
              ? 'Artifact capture retry is only available for terminal evaluations.'
              : failure.status === 503
                ? 'Artifact storage is unavailable. Existing evidence metadata is unchanged.'
                : failure.status
                  ? `Artifact capture retry failed (HTTP ${failure.status}).`
                  : 'Artifact capture retry could not reach the service.';
          button.disabled = false;
        }
      });
      $('#retry-evaluation')?.addEventListener('click', async () => {
        try {
          const next = await call(
            'evaluations/' + encodeURIComponent(id) + '/retry',
            {},
          );
          await detail(next.runId);
        } catch (e) {
          error(e);
        }
      });
      if (!['COMPLETED', 'FAILED', 'SUPERSEDED'].includes(run.state))
        timer = setTimeout(() => detail(id), 2500);
    } catch (e) {
      error(e);
    }
  }
  window.organizationWorkspace = { load, stop: () => clearTimeout(timer) };
})();
