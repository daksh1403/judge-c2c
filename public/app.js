let credential = '',
  page = 'overview',
  currentRun = null,
  overview = null;
const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const badge = (s) =>
  `<span class="badge ${esc(String(s).toLowerCase())}">${esc(s)}</span>`;
const parse = (s) => (s ? JSON.parse(s) : null);
async function get(path) {
  const r = await fetch(path, {
    headers: credential ? { authorization: 'Bearer ' + credential } : {},
  });
  if (r.status === 401) {
    $('#login').hidden = false;
    $('#content').hidden = true;
    throw new Error('Enter an organizer credential to continue.');
  }
  if (!r.ok) throw new Error('The workspace is unavailable. Refresh to retry.');
  return r.json();
}
function message(text) {
  $('#message').className = text ? 'error' : '';
  $('#message').textContent = text;
}
async function load() {
  message('');
  try {
    if (currentRun) {
      await detail(currentRun);
      return;
    }
    if (page === 'repositories') {
      await repositories();
      return;
    }
    overview = await get('/api/overview');
    $('#login').hidden = true;
    $('#content').hidden = false;
    $('#signout').hidden = overview.demo;
    $('#demo-banner').hidden = !overview.demo;
    $('#mode-label').textContent = overview.demo
      ? 'SYNTHETIC REVIEW'
      : 'JUDGE WORKSPACE';
    renderOverview();
  } catch (e) {
    message(e.message);
  }
}
function renderOverview() {
  const c = overview.counts;
  $('#breadcrumb').innerHTML =
    'Workspace <span class="slash">/</span> Submissions';
  $('#content').innerHTML =
    `<section class="stats" aria-label="Evaluation summary">${[
      [
        'Open submissions',
        c.openSubmissions,
        `${c.repositories} repositories · ${c.teams} teams`,
      ],
      ['Evaluating now', c.active, 'Current asynchronous evaluations'],
      ['Completed', c.completed, 'Evidence reports available'],
      ['Needs attention', c.attention, `${c.failed} failed evaluations`],
    ]
      .map(
        ([l, v, f], i) =>
          `<div class="stat ${i === 3 ? 'attention' : ''}"><div class="stat-label">${l}</div><div class="stat-value">${v}</div><div class="stat-foot">${f}</div></div>`,
      )
      .join(
        '',
      )}</section><section class="panel"><div class="panel-head"><h2>Submission activity</h2><div class="filters"><input id="search" type="search" placeholder="Search repository, team or PR" aria-label="Search submissions"><select id="filter" aria-label="Filter evaluation state"><option value="">All evaluations</option><option>COMPLETED</option><option>FAILED</option><option>QUEUED</option><option>SUPERSEDED</option></select></div></div><div class="table-wrap"><table><thead><tr><th>SUBMISSION</th><th>TEAM</th><th>STATE</th><th>EVIDENCE</th><th>REVIEW</th></tr></thead><tbody id="rows"></tbody></table></div><div class="panel-foot"><span id="row-count"></span><span>Latest 100 evaluations · immutable history</span></div></section><section class="principle"><h3>A verdict you can inspect.</h3><p>Requirements come from the frozen contract. Deterministic evidence comes first. Contextual reasoning cites that evidence, and behavior without verification remains explicitly unverified.</p></section>`;
  $('#search').addEventListener('input', renderRows);
  $('#filter').addEventListener('change', renderRows);
  renderRows();
}
function renderRows() {
  const q = $('#search').value.toLowerCase(),
    f = $('#filter').value;
  const rows = overview.runs.filter((r) => {
    const a = parse(r.assignment_snapshot);
    return (
      (!f || r.state === f) &&
      `${r.full_name} ${r.pr_number} ${a.team_name}`.toLowerCase().includes(q)
    );
  });
  $('#rows').innerHTML =
    rows
      .map((r) => {
        const a = parse(r.assignment_snapshot),
          e = parse(r.evidence) || [];
        const uncertain = e.some((x) => x.status === 'UNVERIFIED');
        return `<tr><td><button class="row-button" data-run="${esc(r.id)}"><strong>${esc(r.full_name)}</strong><small>PR #${r.pr_number} · ${esc(r.head_sha.slice(0, 7))}</small></button></td><td>${esc(a.team_name)}<small>${esc(a.team_id)}</small></td><td>${badge(r.state)}</td><td><strong>${e.filter((x) => x.status === 'PASS').length} verified checks</strong><small>${e.filter((x) => x.status === 'FAIL').length} failed · ${e.filter((x) => x.status === 'UNVERIFIED').length} unverified</small></td><td>${uncertain ? badge('UNVERIFIED') : '<span class="subtle">Inspect report</span>'}</td></tr>`;
      })
      .join('') ||
    '<tr><td colspan="5" class="empty">No submissions match. Register a repository contract and PR assignment to begin live evaluation.</td></tr>';
  $('#row-count').textContent = `${rows.length} evaluations`;
  document
    .querySelectorAll('[data-run]')
    .forEach((b) => b.addEventListener('click', () => openRun(b.dataset.run)));
}
async function openRun(id) {
  currentRun = id;
  history.replaceState(null, '', '/?run=' + encodeURIComponent(id));
  await load();
}
async function detail(id) {
  const r = await get('/api/evaluations/' + encodeURIComponent(id));
  $('#content').hidden = false;
  $('#login').hidden = true;
  const c = parse(r.contract_snapshot),
    a = parse(r.assignment_snapshot),
    e = parse(r.evidence) || [],
    report = parse(r.report);
  $('#breadcrumb').innerHTML =
    'Workspace <span class="slash">/</span> Submission detail';
  $('#content').innerHTML =
    `<button class="back" id="back">← All submissions</button><div class="detail-title"><div><div class="eyebrow">${esc(c.department)} / ${esc(c.category)} / PR #${r.pr_number}</div><h2>${esc(c.repository.fullName)}</h2><span class="subtle">${esc(a.team_name)} · Issue ${esc(c.issueNumbers.map((n) => '#' + n).join(', '))}</span></div>${badge(r.state)}</div><section class="panel"><div class="commit-grid">${[
      ['BASELINE', r.baseline_sha],
      ['PARTICIPANT HEAD', r.head_sha],
      ['EVALUATION VERSION', c.evaluationVersion],
      ['CONTRACT HASH', r.contract_hash],
    ]
      .map(
        ([l, v]) =>
          `<div><div class="meta-label">${l}</div><div class="meta-value" title="${esc(v)}">${esc(v.length > 20 ? v.slice(0, 12) + '…' : v)}</div></div>`,
      )
      .join(
        '',
      )}</div></section><div class="detail-grid"><div><section class="panel"><div class="panel-head"><h2>Assigned requirements</h2><span class="subtle">${c.requirements.length} requirements</span></div>${c.requirements
      .map(
        (req) =>
          `<div class="inset"><strong>${esc(req.title)}</strong> <span class="subtle">${req.mandatory ? 'Mandatory' : 'Optional'}</span></div>${req.criteria
            .map((cr) => {
              const result = report?.assessments.find(
                (x) => x.criterionId === cr.id,
              );
              return `<div class="criterion"><div class="criterion-head"><strong>${esc(cr.id)}</strong>${badge(result?.status || 'UNVERIFIED')}</div><p class="description">${esc(cr.description)}</p><p>${esc(result?.explanation || 'No evidence assessment available yet.')}</p>${(result?.evidenceIds || []).map((id) => `<button class="evidence-link" data-evidence="${esc(id)}">↗ ${esc(id)}</button>`).join('')}</div>`;
            })
            .join('')}`,
      )
      .join(
        '',
      )}</section><section class="panel"><div class="panel-head"><h2>Evidence ledger</h2><span class="subtle">${e.length} records</span></div>${e.map((x) => `<article class="evidence-item" id="e-${esc(x.id)}"><div>${badge(x.status)}<code>${esc(x.id)}</code></div><p>${esc(x.claim)}</p>${x.path ? `<code>${esc(x.path)}</code>` : ''}${x.baselineStatus ? `<p>Baseline ${badge(x.baselineStatus)} → submission ${badge(x.status)}</p>` : ''}</article>`).join('') || '<div class="empty">Evidence has not been recorded yet.</div>'}</section><section class="panel"><div class="panel-head"><h2>Findings & additional contributions</h2></div><div class="inset">${report?.findings.length ? report.findings.map((f) => `<p><strong>${esc(f.severity)} · ${esc(f.category)}</strong><br>${esc(f.claim)}<br><span class="subtle">Contextual inference · ${esc(f.evidenceIds.join(', '))}</span></p>`).join('') : '<p>No additional contribution credit or confirmed security findings have been established by this evaluation.</p>'}</div></section></div><aside><section class="panel"><div class="panel-head"><h2>Judge attention</h2></div><div class="inset"><p>${esc(report?.summary || r.failure_code || 'Evaluation is in progress.')}</p><p><strong>Build, tests & benchmarks</strong><br>Isolated execution is not configured. Runtime behavior remains unverified.</p><p><strong>AI review</strong><br>${esc(r.ai_status || 'Pending')}</p><p><strong>GitHub publication</strong><br>${esc(r.publication_status)}</p></div></section><section class="panel"><div class="panel-head"><h2>Constraints</h2></div><div class="inset">${c.constraints.map((s) => `<p>${esc(s)}</p>`).join('')}</div></section><section class="panel"><div class="panel-head"><h2>Evaluation timeline</h2></div><ol class="timeline">${r.timeline.map((t) => `<li><strong>${esc(t.state)}</strong><br>${esc(t.detail)}<small>${esc(t.created_at)} UTC</small></li>`).join('')}</ol></section><section class="panel"><div class="panel-head"><h2>Artifacts</h2></div><div class="inset">${r.artifacts.length ? r.artifacts.map((x) => `<p><button class="evidence-link" data-artifact="${esc(x.key)}">Download evidence</button><br><code>${esc(x.sha256.slice(0, 12))}…</code></p>`).join('') : '<p>No large artifacts stored for this evaluation.</p>'}</div></section></aside></div>`;
  $('#back').addEventListener('click', back);
  document.querySelectorAll('[data-evidence]').forEach((b) =>
    b.addEventListener('click', () =>
      document.getElementById('e-' + b.dataset.evidence)?.scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      }),
    ),
  );
  document.querySelectorAll('[data-artifact]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        const res = await fetch(
          '/api/artifact?key=' + encodeURIComponent(b.dataset.artifact),
          {
            headers: { authorization: 'Bearer ' + credential },
          },
        );
        if (!res.ok) throw new Error('Artifact download failed.');
        const blob = await res.blob(),
          url = URL.createObjectURL(blob),
          a = document.createElement('a');
        a.href = url;
        a.download = 'evidence.json';
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        message(e.message);
      }
    }),
  );
}
function back() {
  currentRun = null;
  history.replaceState(null, '', '/');
  load();
}
async function repositories() {
  const d = await get('/api/repositories');
  $('#content').hidden = false;
  $('#breadcrumb').innerHTML =
    'Workspace <span class="slash">/</span> Repositories';
  $('#content').innerHTML =
    `<section class="panel"><div class="panel-head"><h2>Registered challenge repositories</h2><span class="subtle">Authoritative, versioned contracts</span></div>${
      d.repositories
        .map((r) => {
          const c = parse(r.document);
          return `<article class="repo-card"><h2>${esc(r.full_name)}</h2><p>${esc(c.department)} · ${esc(c.category)} · ${esc(c.evaluationVersion)}</p><p>${c.requirements.length} requirements · Issues ${esc(c.issueNumbers.join(', '))}</p><code>Frozen baseline ${esc(c.baseline)}</code></article>`;
        })
        .join('') ||
      '<div class="empty">No repositories registered. Use the protected contract API to register a frozen challenge.</div>'
    }</section>`;
}
$('#refresh').addEventListener('click', load);
$('#nav-overview').addEventListener('click', () => {
  page = 'overview';
  $('#nav-overview').classList.add('active');
  $('#nav-repos').classList.remove('active');
  back();
});
$('#nav-repos').addEventListener('click', () => {
  page = 'repositories';
  currentRun = null;
  history.replaceState(null, '', '/');
  $('#nav-repos').classList.add('active');
  $('#nav-overview').classList.remove('active');
  load();
});
$('#login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  credential = $('#token').value;
  $('#token').value = '';
  load();
});
$('#signout').addEventListener('click', () => {
  credential = '';
  currentRun = null;
  page = 'overview';
  $('#content').innerHTML = '';
  $('#content').hidden = true;
  $('#signout').hidden = true;
  load();
});
async function init() {
  const id = new URL(location.href).searchParams.get('run');
  await load();
  if (id && overview) await openRun(id);
}
init();
