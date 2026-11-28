// Local operator helper. Uses the existing Git credential manager; never prints or stores tokens.
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
const repo = '/repos/StephanieNiccoleCalawod/ccms-citizens-charter-compliance-monitoring';
const credential = await new Promise((resolve, reject) => {
  const child = execFile('git', ['credential', 'fill'], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' }, timeout: 15000, encoding: 'utf8' },
    (error, stdout) => error ? reject(new Error('GitHub sign-in is unavailable')) : resolve(stdout));
  child.stdin.end('protocol=https\nhost=github.com\n\n');
});
const fields = Object.fromEntries(credential.trim().split('\n').map((line) => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.github.com${repo}${path}`, { method,
    headers: { Authorization: `Bearer ${fields.password}`, 'User-Agent': 'CCMS-migration-release', Accept: 'application/vnd.github+json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok && response.status !== 404) throw new Error(`GitHub ${method} ${path} failed (${response.status}): ${data.message ?? 'request rejected'}`);
  return { status: response.status, data };
}
const mode = process.argv[2];
if (mode === 'inspect') {
  const [branch, protection, prs] = await Promise.all([api('/branches/codebase-for-deployment'), api('/branches/codebase-for-deployment/protection'), api('/pulls?state=open&head=StephanieNiccoleCalawod:codex/tt1-numbered-migrations')]);
  console.log(JSON.stringify({ branch: branch.data.commit?.sha, protected: branch.data.protected, protectionStatus: protection.status,
    protection: protection.status === 200 ? protection.data : null, pullRequests: prs.data.map((pr) => ({ number: pr.number, url: pr.html_url, sha: pr.head.sha })) }, null, 2));
} else if (mode === 'create-pr') {
  const body = await readFile(process.argv[3], 'utf8');
  const result = await api('/pulls', 'POST', { title: process.env.CCMS_PR_TITLE ?? 'Use verified numbered migrations for hosted database updates', head: process.env.CCMS_PR_HEAD ?? 'codex/tt1-numbered-migrations', base: 'codebase-for-deployment', body });
  console.log(JSON.stringify({ number: result.data.number, url: result.data.html_url, sha: result.data.head?.sha, nodeId: result.data.node_id }));
} else if (mode === 'status') {
  const pr = (await api(`/pulls/${Number(process.argv[3])}`)).data;
  const [checks, statuses, reviews] = await Promise.all([api(`/commits/${pr.head.sha}/check-runs?per_page=100`), api(`/commits/${pr.head.sha}/status`), api(`/pulls/${pr.number}/reviews`)]);
  console.log(JSON.stringify({ number: pr.number, state: pr.state, merged: pr.merged, mergeable: pr.mergeable, mergeableState: pr.mergeable_state, sha: pr.head.sha,
    baseSha: pr.base.sha,
    checks: checks.data.check_runs?.map((c) => ({ id: c.id, name: c.name, status: c.status, conclusion: c.conclusion, url: c.html_url, detailsUrl: c.details_url })),
    statuses: statuses.data.statuses?.map((s) => ({ context: s.context, state: s.state, description: s.description, url: s.target_url })),
    reviews: reviews.data.map((r) => ({ state: r.state, user: r.user.login })) }, null, 2));
} else if (mode === 'commit-status') {
  const sha = process.argv[3];
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Exact commit required');
  const checks = (await api(`/commits/${sha}/check-runs?per_page=100`)).data;
  console.log(JSON.stringify({ sha, checks: checks.check_runs.map((c) => ({ id: c.id, name: c.name, status: c.status, conclusion: c.conclusion, url: c.html_url })) }, null, 2));
} else if (mode === 'update-pr') {
  const body = await readFile(process.argv[4], 'utf8');
  const result = await api(`/pulls/${Number(process.argv[3])}`, 'PATCH', { body });
  console.log(JSON.stringify({ number: result.data.number, url: result.data.html_url, updatedAt: result.data.updated_at }));
} else if (mode === 'merge') {
  const number = Number(process.argv[3]); const sha = process.argv[4];
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Exact reviewed commit SHA required');
  const result = await api(`/pulls/${number}/merge`, 'PUT', { sha, merge_method: 'merge', commit_title: process.env.CCMS_PR_TITLE ?? 'Adopt verified numbered database migrations (TT1)' });
  console.log(JSON.stringify(result.data));
} else if (mode === 'job') {
  const job = (await api(`/actions/jobs/${Number(process.argv[3])}`)).data;
  console.log(JSON.stringify({name:job.name,status:job.status,conclusion:job.conclusion,
    steps:job.steps?.map((s)=>({name:s.name,status:s.status,conclusion:s.conclusion,number:s.number}))},null,2));
} else if (mode === 'job-log') {
  const response = await fetch(`https://api.github.com${repo}/actions/jobs/${Number(process.argv[3])}/logs`, {
    headers: {Authorization:`Bearer ${fields.password}`,'User-Agent':'CCMS-migration-release',Accept:'application/vnd.github+json'} });
  if (!response.ok) throw new Error(`Job log unavailable (${response.status})`);
  const content = await response.text();
  await writeFile(new URL(`../../tt1-ci-job-${Number(process.argv[3])}.log`, import.meta.url), content);
  const lines = content.split('\n');
  const indexes = lines.map((line,i)=>/not ok \d|✖|ERR_ASSERTION|AssertionError|# fail|ℹ fail|npm error/i.test(line)?i:-1).filter(i=>i>=0);
  const selected = new Set(indexes.flatMap(i=>Array.from({length:12},(_,offset)=>i+offset).filter(j=>j<lines.length)));
  console.log([...selected].sort((a,b)=>a-b).map(i=>lines[i]).slice(0,150).join('\n'));
} else throw new Error('Use inspect, create-pr, status or merge');
