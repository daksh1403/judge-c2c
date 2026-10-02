(() => {
  const esc = (v) =>
    String(v ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  window.JudgeApproach = (report) => {
    const approach = report?.solution_approach;
    if (!approach)
      return '<section class="panel"><div class="panel-head"><h3>Solution approach review</h3></div><p class="inset">Not available for this historical evaluation.</p></section>';
    const keys = [
      'problem_understanding',
      'approach_summary',
      'solution_design',
      'strengths',
      'weaknesses',
      'tradeoffs',
      'correctness',
      'maintainability',
      'architecture_fit',
      'unverified_assumptions',
    ];
    return (
      '<section class="panel"><div class="panel-head"><h3>Observable solution approach</h3></div><p class="inset">AI-assisted interpretation of submitted artifacts. Citations identify inputs, but do not prove every narrative claim. Verify statements against source and trusted checks before judging. Private reasoning is unknown.</p>' +
      keys
        .map(
          (key) =>
            '<div class="inset"><h4>' +
            esc(key.replaceAll('_', ' ')) +
            '</h4>' +
            (Array.isArray(approach[key]) ? approach[key] : [approach[key]])
              .map(
                (item) =>
                  '<p><strong>' +
                  esc(item.verification) +
                  '</strong> · ' +
                  esc(item.text) +
                  '<br><small>Evidence: ' +
                  esc(item.evidenceIds.join(', ') || 'Insufficient') +
                  '</small></p>',
              )
              .join('') +
            '</div>',
        )
        .join('') +
      '<p class="inset">Evidence ledger IDs: ' +
      esc(approach.evidence.join(', ') || 'None established') +
      '</p></section>'
    );
  };
  let listGeneration = 0,
    detailGeneration = 0;
  let root,
    repositories = [],
    tab = 'teams';
  async function api(path, body, method = body ? 'POST' : 'GET') {
    const response = await fetch('/api/organization/manage/' + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'WORKFLOW_UNAVAILABLE');
    return value;
  }
  const options = () =>
    repositories
      .filter((r) => r.accessible)
      .map((r) => `<option value="${r.id}">${esc(r.full_name)}</option>`)
      .join('');
  const field = (name, label, type = 'text') =>
    `<label>${esc(label)}<input name="${name}" type="${type}" required></label>`;
  const select = (name, label, values) =>
    `<label>${esc(label)}<select name="${name}">${values.map((v) => `<option>${esc(v)}</option>`).join('')}</select></label>`;
  function message(text, bad = false) {
    const node = root.querySelector('[role=status]');
    node.textContent = text;
    node.className = bad ? 'error' : 'subtle';
  }
  async function action(fn) {
    try {
      await fn();
    } catch (e) {
      message(e.message, true);
    }
  }
  function form(id, handler) {
    root.querySelector('#' + id)?.addEventListener('submit', (e) => {
      e.preventDefault();
      action(() => handler(Object.fromEntries(new FormData(e.target))));
    });
  }
  const row = (label, meta, detail) =>
    `<article class="inset"><button class="row-button" data-detail="${esc(detail)}"><strong>${esc(label)}</strong><small>${esc(meta)}</small></button></article>`;
  async function list() {
    const generation = ++listGeneration,
      selectedTab = tab,
      currentRoot = root;
    const query = root.querySelector('#workflow-search')?.value || '';
    const filter = root.querySelector('#workflow-filter')?.value || '';
    const extra = new URLSearchParams();
    for (const control of root.querySelectorAll('[data-query]'))
      if (control.value) extra.set(control.dataset.query, control.value);
    let result = await api(
      selectedTab +
        '?q=' +
        encodeURIComponent(query) +
        (filter ? '&status=' + encodeURIComponent(filter) : '') +
        '&' +
        extra.toString(),
    );
    if (
      generation !== listGeneration ||
      selectedTab !== tab ||
      currentRoot !== root ||
      !root.isConnected
    )
      return;
    const panel = root.querySelector('#workflow-list');
    if (tab === 'teams')
      panel.innerHTML =
        result.teams
          .map((t) =>
            row(
              t.name,
              `${t.status} · ${t.github_members || 'No active members'} · ${t.submission_count ? t.submission_count + ' submissions' : 'NOT SUBMITTED'}`,
              'teams/' + t.id,
            ),
          )
          .join('') ||
        '<p>No matching teams. Create or import teams below.</p>';
    if (tab === 'issues')
      panel.innerHTML =
        result.issues
          .map((i) =>
            row(
              `${i.full_name} #${i.number} · ${i.title}`,
              `${i.source} · ${i.review_status}${i.workflow_status ? ' / ' + i.workflow_status : ''} · ${i.official ? 'Official challenge' : 'Not scored'}`,
              `issues/${i.repository_id}/${i.number}`,
            ),
          )
          .join('') ||
        '<p>No issues yet. Synchronize an installed repository.</p>';
    if (tab === 'submissions')
      panel.innerHTML =
        (result.submissions || result.teams || [])
          .map((s) =>
            row(
              s.team_name || s.name || 'Needs team mapping',
              `${s.full_name || ''} ${s.pr_number ? 'PR #' + s.pr_number : 'NOT SUBMITTED'} · ${s.status || ''} · ${s.evaluation_state || 'No evaluation'} · ${(s.head_sha || '').slice(0, 12)}`,
              s.pr_number
                ? `submissions/${s.repository_id}/${s.pr_number}`
                : 'teams/' + s.id,
            ),
          )
          .join('') || '<p>No matching submissions.</p>';
    panel
      .querySelectorAll('[data-detail]')
      .forEach(
        (b) => (b.onclick = () => action(() => detail(b.dataset.detail))),
      );
  }
  async function view(which, preset = {}) {
    ++detailGeneration;
    tab = which;
    const filters =
      tab === 'teams'
        ? ['', 'PENDING', 'ACTIVE', 'WITHDRAWN', 'DISQUALIFIED', 'COMPLETED']
        : tab === 'issues'
          ? [
              '',
              'NEEDS_TRIAGE',
              'NEEDS_INFORMATION',
              'APPROVED',
              'REJECTED',
              'DUPLICATE',
              'RECOGNIZED',
            ]
          : [
              '',
              'VALID',
              'NEEDS_TEAM_MAPPING',
              'NEEDS_ISSUE_MAPPING',
              'WRONG_REPOSITORY',
              'ISSUE_LINK_CONFLICT',
              'DRAFT',
              'CLOSED',
              'NOT_SUBMITTED',
            ];
    root.querySelector('#workflow-body').innerHTML =
      `<form id="workflow-query" class="review-form"><label>Search ${tab}<input id="workflow-search" type="search"></label><label for="workflow-filter">Status</label><select id="workflow-filter">${filters.map((f) => `<option value="${f}">${f || 'All states'}</option>`).join('')}</select>${tab !== 'teams' ? `<label>Repository filter<select data-query="repository"><option value="">All repositories</option>${options()}</select></label>` : ''}${tab === 'issues' ? `<label>Source filter<select data-query="source"><option value="">All sources</option><option>PARTICIPANT</option><option>ORGANIZER</option><option>UNKNOWN</option></select></label><label>Type filter<input data-query="type" placeholder="bug, reliability, security…"></label><label>Assigned or reporting team<input data-query="team"></label><label>Label filter<input data-query="label" placeholder="judge:status:security-review"></label><label>Work progress<select data-query="workflow"><option value="">All progress</option>${['available', 'assigned', 'in-progress', 'evaluating', 'completed', 'closed', 'blocked'].map((v) => `<option>${v}</option>`).join('')}</select></label><label>Priority filter<select data-query="priority"><option value="">All priorities</option>${['critical', 'high', 'medium', 'low'].map((v) => `<option>${v}</option>`).join('')}</select></label><label>Difficulty filter<select data-query="difficulty"><option value="">All difficulties</option>${['easy', 'medium', 'hard', 'expert'].map((v) => `<option>${v}</option>`).join('')}</select></label><label>Official challenges<select data-query="official"><option value="">All issues</option><option value="1">Official only</option><option value="0">Other issues</option></select></label>` : ''}${tab === 'submissions' ? `<label>Team ID filter<input data-query="team"></label><label>Issue number filter<input data-query="issue" type="number" min="1"></label><label>Evaluation state<select data-query="evaluationState"><option value="">All evaluations</option>${['QUEUED', 'FETCHING', 'CHECKING', 'REVIEWING', 'SYNTHESIZING', 'COMPLETED', 'FAILED', 'SUPERSEDED'].map((v) => `<option>${v}</option>`).join('')}</select></label><label>Attention filter<select data-query="attention"><option value="">All submissions</option><option value="1">Needs attention</option></select></label><label>Security filter<select data-query="security"><option value="">All findings</option><option value="1">Security or dependency concerns</option></select></label><label>Regression filter<select data-query="regression"><option value="">All results</option><option value="1">New failures against passing baseline</option></select></label>` : ''}<button class="button">Search</button></form><div id="workflow-list"></div><div id="workflow-detail"></div>` +
      (tab === 'teams'
        ? `<details><summary>Create a team</summary><form id="create-team" class="review-form">${field('name', 'Team name')}${field('displayName', 'First member name')}${field('githubLogin', 'GitHub username')}${select('status', 'Team state', ['PENDING', 'ACTIVE'])}<label>Repositories<select name="repositories" multiple>${options()}</select></label><button class="button primary">Create team</button></form></details><details><summary>Import teams</summary><form id="import-teams" class="review-form"><p>CSV columns: team_name, participant_name, github_username, optional email, external_id, repository, issue_number, team_status. Identity conflicts reject the entire import.</p><label>CSV<textarea name="csv" required rows="8"></textarea></label><label><input type="checkbox" name="commit"> Commit validated import</label><button class="button">Validate / import</button><pre id="import-result"></pre></form></details>`
        : '') +
      (tab === 'issues'
        ? `<details><summary>Publish an official challenge</summary><form id="publish-challenge" class="review-form"><p>Publishing creates a frozen evaluation version. Existing assignments keep their previous version. GitHub labels alone never approve a challenge.</p><label>Repository<select name="repositoryId">${options()}</select></label>${field('issueNumber', 'Issue number', 'number')}${select('ownership', 'Ownership', ['EXCLUSIVE', 'SHARED'])}${field('capacity', 'Maximum teams', 'number')}<label><input name="claimable" type="checkbox"> Allow claiming (also requires event claiming policy)</label><label>Authoritative evaluation contract JSON<textarea name="contract" rows="10" required></textarea></label><button class="button primary">Publish frozen challenge</button></form></details>`
        : '');
    form('workflow-query', list);
    form('create-team', async (data) => {
      await api('teams', {
        name: data.name,
        status: data.status,
        members: [
          { displayName: data.displayName, githubLogin: data.githubLogin },
        ],
        repositoryIds: [
          ...root.querySelector('#create-team select[multiple]')
            .selectedOptions,
        ].map((o) => Number(o.value)),
      });
      await list();
      message('Team created with verified GitHub identity.');
    });
    form('import-teams', async (data) => {
      const r = await api('teams/import', {
        csv: data.csv,
        commit: data.commit === 'on',
      });
      root.querySelector('#import-result').textContent = JSON.stringify(
        r,
        null,
        2,
      );
      await list();
    });
    form('publish-challenge', async (data) => {
      await api('challenges', {
        repositoryId: Number(data.repositoryId),
        issueNumber: Number(data.issueNumber),
        contract: JSON.parse(data.contract),
        ownership: data.ownership,
        capacity: Number(data.capacity),
        claimable: data.claimable === 'on',
      });
      await list();
      message(
        'Challenge version published. Assign it to an eligible active team.',
      );
    });
    for (const [key, value] of Object.entries(preset)) {
      const control =
        key === 'status'
          ? root.querySelector('#workflow-filter')
          : root.querySelector(`[data-query="${key}"]`);
      if (control) control.value = value;
    }
    await list();
  }
  async function detail(path) {
    const requestedTab = path.split('/')[0];
    if (requestedTab !== tab) await view(requestedTab);
    if (requestedTab !== tab) return;
    const generation = ++detailGeneration,
      currentRoot = root,
      selectedTab = tab;
    const d = await api(path);
    if (
      generation !== detailGeneration ||
      currentRoot !== root ||
      selectedTab !== tab ||
      !root.isConnected
    )
      return;
    const target = root.querySelector('#workflow-detail');
    if (d.team) {
      const t = d.team;
      target.innerHTML = `<h3>${esc(t.name)} · ${esc(t.id)}</h3><form id="edit-team" class="review-form"><label>Name<input name="name" value="${esc(t.name)}" required></label>${select('status', 'Team status', ['PENDING', 'ACTIVE', 'WITHDRAWN', 'DISQUALIFIED', 'COMPLETED'])}<button class="button">Save team</button></form><h4>Members</h4>${d.members.map((m) => `<p>${esc(m.display_name)} · @${esc(m.github_login)} · GitHub ID ${m.github_id} · ${m.active ? 'Active' : 'Historical'} ${m.active ? `<button class="button" data-remove-member="${esc(m.id)}">Remove</button>` : ''}</p>`).join('')}<form id="add-member" class="review-form">${field('displayName', 'Member name')}${field('githubLogin', 'GitHub username')}<button class="button">Add verified member</button></form><h4>Repository assignments</h4>${d.repositories.map((r) => `<p>${esc(r.full_name)} · ${r.active ? 'Assigned' : 'Revoked'} ${r.active ? `<button class="button" data-revoke-repo="${r.repository_id}">Revoke</button>` : ''}</p>`).join('')}<form id="assign-repository" class="review-form"><label>Repository<select name="repositoryId">${options()}</select></label><button class="button">Assign repository</button></form><h4>Issues and immutable versions</h4>${d.assignments.map((a) => `<p>#${a.issue_number} ${esc(a.title)} · ${esc(a.status)} / ${esc(a.progress)}<br><code>${esc(a.contract_hash)}</code></p>`).join('') || '<p>No issue assignments.</p>'}<h4>Submissions</h4>${d.submissions.map((s) => row('PR #' + s.pr_number, `${s.status} · ${s.head_sha.slice(0, 12)}`, `submissions/${s.repository_id}/${s.pr_number}`)).join('') || '<p>NOT SUBMITTED</p>'}<h4>Participant-raised issues</h4>${d.raisedIssues.map((i) => `<p>#${i.number} ${esc(i.title)} · ${esc(i.review_status)}</p>`).join('')}<h4>Evaluation history</h4>${d.evaluations.map((e) => `<p>${e.current ? 'CURRENT' : 'Historical'} · ${esc(e.state)} · <code>${esc(e.head_sha)}</code></p>`).join('')}`;
      target.querySelector('[name=status]').value = t.status;
      form('edit-team', async (v) => {
        await api(path, v, 'PATCH');
        await detail(path);
        await list();
      });
      form('add-member', async (v) => {
        await api(path + '/members', v);
        await detail(path);
      });
      form('assign-repository', async (v) => {
        await api(path + '/repositories/' + v.repositoryId, {});
        await detail(path);
      });
      target.querySelectorAll('[data-remove-member]').forEach(
        (b) =>
          (b.onclick = () =>
            action(async () => {
              await api(
                path + '/members/' + b.dataset.removeMember,
                undefined,
                'DELETE',
              );
              await detail(path);
            })),
      );
      target.querySelectorAll('[data-revoke-repo]').forEach(
        (b) =>
          (b.onclick = () =>
            action(async () => {
              await api(
                path + '/repositories/' + b.dataset.revokeRepo,
                undefined,
                'DELETE',
              );
              await detail(path);
            })),
      );
    } else if (d.issue) {
      const i = d.issue,
        teams = (await api('teams?status=ACTIVE')).teams;
      if (
        generation !== detailGeneration ||
        currentRoot !== root ||
        selectedTab !== tab ||
        !root.isConnected
      )
        return;
      target.innerHTML = `<h3>#${i.number} ${esc(i.title)}</h3><p>${esc(i.source)} · reporter @${esc(i.author_login)} · team ${esc(i.reporter_team_id || 'Unknown')} · GitHub ${esc(i.github_state)} / judging ${esc(i.review_status)}</p><p>${i.classification?.flags?.includes('security-review') ? 'Security review required. Do not reproduce exploit details publicly. Use GitHub private vulnerability reporting where enabled.' : ''}</p><pre>${esc(i.body)}</pre><p>Classification: ${esc(JSON.stringify(i.classification))}</p><form id="review-issue" class="review-form">${select('reviewStatus', 'Organizer decision', ['NEEDS_TRIAGE', 'APPROVED', 'REJECTED', 'DUPLICATE', 'NEEDS_INFORMATION', 'RECOGNIZED'])}${field('reason', 'Decision reason')}<label>Canonical duplicate issue<input name="canonicalNumber" type="number"></label><label>Type override<input name="type" placeholder="bug, security, documentation…"></label>${select('priority', 'Priority override', ['', 'critical', 'high', 'medium', 'low'])}${select('difficulty', 'Difficulty override', ['', 'easy', 'medium', 'hard', 'expert'])}${select('severity', 'Technical severity override', ['', 'critical', 'high', 'medium', 'low', 'info'])}<label>Recognition rationale<textarea name="recognition"></textarea></label><button class="button">Record review</button></form>${d.definition ? `<form id="assign-issue" class="review-form"><label>Eligible team<select name="teamId">${teams.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></label><label><input name="reservation" type="checkbox"> Reserve</label><button class="button">Assign frozen challenge</button></form>` : '<p>Not an official challenge. Publish authoritative requirements to enable assignment.</p>'}<h4>Assignments</h4>${d.assignments.map((a) => `<p>${esc(a.team_name)} · ${esc(a.status)} / ${esc(a.progress)} · <code>${esc(a.id)}</code></p>`).join('')}<form id="assignment-decision" class="review-form">${field('assignmentId', 'Assignment ID')}${select('decision', 'Completion decision', ['CHANGES_REQUESTED', 'ACCEPTED', 'REOPENED'])}<label>Current evaluation run ID<input name="runId"></label>${field('reason', 'Evidence-backed decision reason')}<button class="button">Record completion decision</button></form><h4>Version history</h4>${d.versions.map((v) => `<p><code>${esc(v.contract_hash)}</code> · ${esc(v.created_at)}</p>`).join('')}<h4>Completion history</h4><pre>${esc(JSON.stringify(d.decisions, null, 2))}</pre>`;
      form('review-issue', async (v) => {
        if (!v.canonicalNumber) delete v.canonicalNumber;
        else v.canonicalNumber = Number(v.canonicalNumber);
        for (const field of [
          'type',
          'priority',
          'difficulty',
          'severity',
          'recognition',
        ])
          if (!v[field]) delete v[field];
        await api(path + '/review', v);
        await detail(path);
        await list();
      });
      form('assign-issue', async (v) => {
        await api('assignments', {
          teamId: v.teamId,
          repositoryId: i.repository_id,
          issueNumber: i.number,
          reservation: v.reservation === 'on',
        });
        await detail(path);
      });
      form('assignment-decision', async (v) => {
        const id = v.assignmentId;
        delete v.assignmentId;
        if (!v.runId) delete v.runId;
        await api('assignments/' + id + '/completion', v);
        await detail(path);
      });
    } else if (d.submission) {
      const s = d.submission;
      target.innerHTML = `<h3>PR #${s.pr_number} · ${esc(s.status)}</h3><p>${esc(s.mapping_reason)}<br>Team ${esc(s.team_id || 'UNMAPPED')} · author @${esc(s.author_login)}</p><p>Issues ${esc(s.issue_numbers.join(', '))}<br>Head <code>${esc(s.head_sha)}</code></p><button class="button" id="resolve-latest">Resolve latest GitHub state</button><h4>Evaluation history</h4>${d.evaluations.map((e) => `<p>${e.id === s.latest_run_id ? 'CURRENT' : 'Historical'} · ${esc(e.state)} · <code>${esc(e.head_sha)}</code><br><a href="?organization=1&evaluation=${esc(e.id)}">Inspect requirements, approach and evidence</a></p>`).join('') || '<p>Evaluation blocked until mapping is valid.</p>'}<details><summary>Audited organizer mapping override</summary><form id="resolve-submission" class="review-form">${field('teamId', 'Stable team ID')}${field('assignmentIds', 'Active assignment IDs, comma separated')}${field('reason', 'Reason for overriding mapping')}<button class="button">Resolve mapping</button></form></details>`;
      target.querySelector('#resolve-latest').onclick = () =>
        action(async () => {
          await api(path + '/sync', {});
          await detail(path);
          await list();
        });
      form('resolve-submission', async (v) => {
        v.assignmentIds = v.assignmentIds
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        await api(path + '/resolve', v);
        await detail(path);
        await list();
      });
    }
    target
      .querySelectorAll('[data-detail]')
      .forEach(
        (b) => (b.onclick = () => action(() => detail(b.dataset.detail))),
      );
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  window.JudgeCompetition = {
    async mount(node, repos) {
      root = node;
      repositories = repos;
      root.innerHTML = `<section class="panel"><div class="panel-head"><h2>Hackathon workflow</h2></div><div class="inset"><div id="judge-summary" class="stats judge-summary" aria-label="Judging overview"></div><nav id="judge-shortcuts" class="judge-shortcuts" aria-label="Review queues"><button class="button" data-queue="attention" disabled>Needs attention</button><button class="button" data-queue="failed" disabled>Failed evaluations</button><button class="button" data-queue="mapping" disabled>Missing team mapping</button><button class="button" data-queue="no-submission" disabled>Not submitted</button><button class="button" data-queue="triage" disabled>Issue triage</button></nav><details><summary>All event counts</summary><p id="workflow-counts"></p></details><details><summary>GitHub integration status</summary><p id="workflow-capabilities"></p></details><nav aria-label="Hackathon management"><button class="button" data-tab="teams" disabled>Teams</button> <button class="button" data-tab="issues" disabled>Issues</button> <button class="button" data-tab="submissions" disabled>Submissions</button></nav><p role="status"></p><form id="reconcile-repository" class="review-form"><label>Synchronize GitHub issues and PRs<select name="repositoryId">${options()}</select></label><button class="button">Reconcile repository</button></form><button class="button" id="retry-labels">Retry blocked label synchronization</button><details><summary>Event policy and label taxonomy</summary><form id="event-policy" class="review-form"><label>Versioned event policy JSON<textarea name="document" rows="10" required></textarea></label><button class="button">Save organizer policy</button></form></details><div id="workflow-body"></div></div></section>`;
      const [overview, settings] = await Promise.all([
        api('overview'),
        api('settings'),
      ]);
      if (root !== node || !node.isConnected) return;
      root.querySelector('#workflow-counts').textContent = Object.entries(
        overview.counts,
      )
        .map(([k, v]) => `${k.replace(/([a-z])([A-Z])/g, '$1 $2')}: ${v}`)
        .join(' · ');
      root.querySelector('#judge-summary').innerHTML = [
        ['Needs attention', 'needsAttention'],
        ['Active teams', 'activeTeams'],
        ['Not submitted', 'notSubmitted'],
        ['Running evaluations', 'runningRuns'],
        ['Queued evaluations', 'queuedRuns'],
        ['Current completed', 'currentCompleted'],
      ]
        .map(
          ([label, key]) =>
            `<article class="stat ${key === 'needsAttention' ? 'attention' : ''}"><div class="stat-label">${label}</div><div class="stat-value">${esc(overview.counts[key] ?? 'Unavailable')}</div></article>`,
        )
        .join('');
      root.querySelector('#workflow-capabilities').textContent =
        settings.capabilities?.issuesWrite &&
        ['issues', 'issue_comment'].every((e) =>
          settings.capabilities.events.includes(e),
        )
          ? 'GitHub issue synchronization permissions and subscriptions confirmed.'
          : 'Owner setup needed: in GitHub App settings enable Issues read and write, subscribe to Issues and Issue comment events, then approve updated installation permissions. PR evaluation access remains available.';
      root.querySelector('#workflow-capabilities').parentElement.open =
        !settings.capabilities?.issuesWrite ||
        !['issues', 'issue_comment'].every((e) =>
          settings.capabilities?.events?.includes(e),
        );
      if (settings.capabilities?.app) {
        const app = settings.capabilities.app;
        const panel = root.querySelector('#workflow-capabilities');
        panel.append(
          document.createTextNode(` App: ${app.name} · owner: ${app.owner}. `),
        );
        for (const [label, url] of [
          ['Open App settings', app.settingsUrl],
          ['Open installation', app.installationUrl],
        ]) {
          if (!url.startsWith('https://github.com/')) continue;
          const link = document.createElement('a');
          link.href = url;
          link.textContent = label;
          panel.append(link, document.createTextNode(' '));
        }
      }

      const config = settings.settings;
      root.querySelector('#event-policy textarea').value = JSON.stringify(
        {
          name: config.name,
          status: config.status,
          policy: config.policy,
          taxonomy: config.taxonomy,
        },
        null,
        2,
      );
      form('event-policy', async (v) => {
        await api('settings', JSON.parse(v.document));
        message(
          'Policy updated and audited. Existing assigned contract versions are unchanged.',
        );
      });
      form('reconcile-repository', async (v) => {
        let page = 1;
        for (let i = 0; i < 20; i++) {
          const r = await api('reconcile', {
            repositoryId: Number(v.repositoryId),
            page,
          });
          if (!r.nextPage) break;
          page = r.nextPage;
        }
        message(
          'GitHub reconciliation queued. Refresh to inspect processed relationships.',
        );
        await list();
      });
      root.querySelector('#retry-labels').onclick = () =>
        action(async () => {
          await api('retry-sync', {});
          message(
            'Label synchronization retry requested; permission failures remain visible.',
          );
        });
      await view('teams');
      if (root !== node || !node.isConnected) return;
      const queues = {
        attention: ['submissions', { attention: '1' }],
        failed: ['submissions', { evaluationState: 'FAILED' }],
        mapping: ['submissions', { status: 'NEEDS_TEAM_MAPPING' }],
        'no-submission': ['submissions', { status: 'NOT_SUBMITTED' }],
        triage: ['issues', { status: 'NEEDS_TRIAGE' }],
      };
      root.querySelectorAll('[data-queue]').forEach((b) => {
        b.onclick = () => action(() => view(...queues[b.dataset.queue]));
        b.disabled = false;
      });
      root.querySelectorAll('[data-tab]').forEach((b) => {
        b.onclick = () => action(() => view(b.dataset.tab));
        b.disabled = false;
      });
    },
  };
})();
