/**
 * Host half of the Worklog bundle.
 *
 * Two jobs:
 *
 * 1. The habit the panel depends on — plan first, update at each step
 *    boundary, close with changes + verification + commit — as one small
 *    system-prompt section (`guidance: false` disables it).
 * 2. A read-only git bridge for the Changes view: the working tree, the recent
 *    commits, one commit's file list, and per-file hunks. Everything runs
 *    through `git` with argv arrays (never a shell), inside the authenticated
 *    same-origin fetch fence, and only under a directory the browser names.
 */
import { execFile } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve as resolvePath, isAbsolute } from 'node:path';

export const name = 'worklog';

/** The prompt registry and the authenticated fetch fence. */
export const inject = ['systemPrompt', 'connection'];

/** Order after the first-party guidance (10000/10100) and before the persona suffix (10200). */
const SECTION_ORDER = 10150;

/** The contribution text. Kept short: it repeats on every request. */
const GUIDANCE = [
  '## Work reporting',
  '',
  'For any multi-step task, first record a short plan with `todo_write` — one todo per concrete step — and mark the first step `in_progress`.',
  'Treat that list as live state: when a step finishes, update the list in the same turn (mark it `completed`, mark the next step `in_progress`) rather than batching updates at the end.',
  'When the work is done, verify it, then answer in this order: what changed (files and why), the verification you ran, and the commit you made (hash, branch, subject) — or that none was made.',
].join('\n');

/** Routes served behind the browser-trust fence. */
const OVERVIEW_PATH = '/api/worklog.overview';
const COMMIT_PATH = '/api/worklog.commit';
const DIFF_PATH = '/api/worklog.diff';
const GRAPH_PATH = '/api/worklog.graph';

/** Byte cap for one git command's output. */
const MAX_BUFFER = 8 * 1024 * 1024;

/** Line cap for one rendered file comparison. */
const MAX_DIFF_LINES = 1200;

/** Line cap for the synthetic comparison of an untracked file. */
const UNTRACKED_MAX_LINES = 400;

/** Commits offered in the picker. */
const COMMIT_LIMIT = 30;

/** Field separator for `--format` output (never appears in a subject). */
const UNIT = '\u001f';

/**
 * Run one git command with argv (no shell) in a working directory.
 * @param cwd - repository working directory.
 * @param args - argv after `git`.
 * @returns `{ ok, stdout, stderr, code }`; never throws.
 */
function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', ['--no-pager', '-c', 'core.quotepath=false', ...args], {
      cwd,
      timeout: 15000,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      encoding: 'utf8',
    }, (error, stdout, stderr) => {
      resolve({
        ok: error === null,
        stdout: typeof stdout === 'string' ? stdout : '',
        stderr: typeof stderr === 'string' ? stderr : '',
        code: error === null ? 0 : (error.code ?? 1),
      });
    });
  });
}

/**
 * Validate the browser-supplied working directory.
 * @param raw - `cwd` query parameter.
 * @returns the absolute directory, or undefined when it is not one.
 */
function resolveCwd(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.includes('\0') || !isAbsolute(raw)) return undefined;
  const candidate = resolvePath(raw);
  try {
    return statSync(candidate).isDirectory() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/**
 * JSON response with no caching.
 * @param body - serializable payload.
 * @param status - HTTP status.
 * @returns the response.
 */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * Display status for one porcelain / name-status code.
 * @param index - index-side letter.
 * @param worktree - worktree-side letter.
 * @returns `A`, `D`, `R`, or `M`.
 */
function statusLetter(index, worktree) {
  const code = `${index}${worktree}`;
  if (code.includes('?') || code.includes('A')) return 'A';
  if (code.includes('D')) return 'D';
  if (code.includes('R')) return 'R';
  return 'M';
}

/**
 * Parse `git status --porcelain=v1 -z`.
 * @param raw - NUL-separated output.
 * @returns `{ path, index, worktree }` entries.
 */
function parsePorcelain(raw) {
  const parts = raw.split('\0');
  const files = [];
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index];
    if (entry.length < 4) continue;
    const x = entry[0];
    const y = entry[1];
    const filePath = entry.slice(3);
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') index += 1;
    files.push({ path: filePath, index: x, worktree: y });
  }
  return files;
}

/**
 * Parse `--numstat -z` output into per-path counts.
 * @param raw - NUL-separated output.
 * @returns map of path to `{ added, deleted, binary }`.
 */
function parseNumstat(raw) {
  const parts = raw.split('\0');
  const counts = new Map();
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index];
    if (entry.length === 0) continue;
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(entry);
    if (match === null) continue;
    let filePath = match[3];
    if (filePath === '') {
      index += 2;
      filePath = parts[index] ?? '';
    }
    if (filePath.length === 0) continue;
    counts.set(filePath, {
      added: match[1] === '-' ? 0 : Number(match[1]),
      deleted: match[2] === '-' ? 0 : Number(match[2]),
      binary: match[1] === '-',
    });
  }
  return counts;
}

/**
 * Parse a `%H<sep>%h<sep>%an<sep>%at<sep>%s` log line.
 * @param line - one formatted line.
 * @returns the commit summary, or undefined.
 */
function parseCommitLine(line) {
  const fields = line.split(UNIT);
  if (fields.length < 5) return undefined;
  const time = Number(fields[3]) * 1000;
  return {
    hash: fields[0],
    short: fields[1],
    author: fields[2],
    time: Number.isFinite(time) ? time : 0,
    subject: fields.slice(4).join(UNIT),
  };
}

/**
 * Parse a unified diff into hunks of renderable lines.
 * @param text - `git diff` output.
 * @returns `{ hunks, truncated }`.
 */
function parseHunks(text) {
  const hunks = [];
  let current;
  let total = 0;
  let truncated = false;
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('@@')) {
      current = { header: line, lines: [] };
      hunks.push(current);
      continue;
    }
    if (current === undefined) continue;
    if (line.startsWith('diff --git') || line.startsWith('index ')) break;
    if (line.startsWith('\\')) continue;
    if (line.length === 0) continue;
    if (total >= MAX_DIFF_LINES) {
      truncated = true;
      break;
    }
    current.lines.push(line);
    total += 1;
  }
  return { hunks, truncated };
}

/**
 * Build one synthetic hunk for a file git does not track yet.
 * @param absolute - absolute file path.
 * @returns `{ hunks, truncated, binary }`.
 */
function untrackedHunks(absolute) {
  try {
    const stat = statSync(absolute);
    if (stat.size > 1024 * 1024) return { hunks: [], truncated: true, binary: false };
    const text = readFileSync(absolute, 'utf8');
    if (text.includes('\0')) return { hunks: [], truncated: false, binary: true };
    const lines = text.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    const limited = lines.slice(0, UNTRACKED_MAX_LINES);
    return {
      hunks: [{
        header: `@@ -0,0 +1,${limited.length} @@`,
        lines: limited.map((line) => `+${line}`),
      }],
      truncated: lines.length > limited.length,
      binary: false,
    };
  } catch {
    return { hunks: [], truncated: false, binary: false };
  }
}

/**
 * Read the working tree, branch state, and recent commits.
 * @param cwd - directory the browser named.
 * @returns the overview payload.
 */
async function readOverview(cwd) {
  const probe = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!probe.ok || probe.stdout.trim() !== 'true') {
    return { git: false, cwd, reason: probe.ok ? 'not-a-repository' : 'git-unavailable' };
  }
  const [rootResult, branchResult, headResult, statusResult, numstatResult, logResult, upstreamResult, countResult] = await Promise.all([
    git(cwd, ['rev-parse', '--show-toplevel']),
    git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(cwd, ['log', '-1', `--format=%H${UNIT}%h${UNIT}%an${UNIT}%at${UNIT}%s`]),
    git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    git(cwd, ['diff', 'HEAD', '--numstat', '-z']),
    git(cwd, ['log', `-n${COMMIT_LIMIT}`, `--format=%H${UNIT}%h${UNIT}%an${UNIT}%at${UNIT}%s`]),
    git(cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']),
    git(cwd, ['rev-list', '--count', 'HEAD']),
  ]);

  const root = rootResult.ok ? rootResult.stdout.trim() : cwd;
  const files = parsePorcelain(statusResult.ok ? statusResult.stdout : '');
  const counts = parseNumstat(numstatResult.ok ? numstatResult.stdout : '');
  const head = headResult.ok ? parseCommitLine(headResult.stdout.trim()) : undefined;

  let ahead = 0;
  let behind = 0;
  if (upstreamResult.ok) {
    const [behindText, aheadText] = upstreamResult.stdout.trim().split(/\s+/);
    ahead = Number(aheadText) || 0;
    behind = Number(behindText) || 0;
  }

  const changed = files.map((file) => {
    const count = counts.get(file.path) ?? { added: 0, deleted: 0, binary: false };
    return {
      path: file.path,
      status: statusLetter(file.index, file.worktree),
      staged: file.index !== ' ' && file.index !== '?',
      added: count.added,
      deleted: count.deleted,
      binary: count.binary,
      untracked: file.index === '?',
    };
  }).sort((left, right) => left.path.localeCompare(right.path));

  const commits = (logResult.ok ? logResult.stdout.split('\n') : [])
    .map((line) => parseCommitLine(line.trim()))
    .filter((commit) => commit !== undefined);

  return {
    git: true,
    cwd,
    root,
    branch: branchResult.ok ? branchResult.stdout.trim() : '',
    head,
    ahead,
    behind,
    commitCount: countResult.ok ? Number(countResult.stdout.trim()) || 0 : commits.length,
    files: changed,
    commits,
  };
}

/**
 * Read one commit's metadata and file list.
 * @param cwd - directory the browser named.
 * @param hash - selected commit.
 * @returns the commit payload, or undefined when the hash is not a commit.
 */
async function readCommit(cwd, hash) {
  if (!/^[0-9a-f]{4,40}$/i.test(hash)) return undefined;
  const show = await git(cwd, ['show', '-m', '--first-parent', '--numstat', '-z', '--format=' + `%H${UNIT}%h${UNIT}%an${UNIT}%at${UNIT}%s`, hash]);
  if (!show.ok) return undefined;
  const newline = show.stdout.indexOf('\n');
  const header = newline === -1 ? '' : show.stdout.slice(0, newline);
  const commit = parseCommitLine(header);
  if (commit === undefined) return undefined;
  const body = newline === -1 ? '' : show.stdout.slice(newline + 1);
  const counts = parseNumstat(body);
  const files = [];
  for (const [filePath, count] of counts) {
    const status = count.binary ? 'M' : count.deleted === 0 && count.added > 0 ? 'A' : count.added === 0 && count.deleted > 0 ? 'D' : 'M';
    files.push({ path: filePath, status, added: count.added, deleted: count.deleted, binary: count.binary });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { ...commit, files };
}

/**
 * Read one file comparison: the working tree against HEAD, or one commit's change.
 * @param cwd - directory the browser named.
 * @param input - `{ scope, hash, path }`.
 * @returns the diff payload.
 */
async function readDiff(cwd, input) {
  const relative = input.path.replace(/\\/g, '/');
  if (relative.length === 0 || relative.includes('\0') || relative.startsWith('/') || /^[A-Za-z]:/.test(relative) || relative.split('/').includes('..')) {
    return { path: input.path, kind: 'invalid' };
  }
  if (input.scope === 'commit') {
    if (!/^[0-9a-f]{4,40}$/i.test(input.hash)) return { path: relative, kind: 'invalid' };
    const result = await git(cwd, ['show', '-m', '--first-parent', '-U3', '--format=', input.hash, '--', relative]);
    if (!result.ok) return { path: relative, kind: 'error' };
    if (/^Binary files /m.test(result.stdout)) return { path: relative, kind: 'binary' };
    const parsed = parseHunks(result.stdout);
    return { path: relative, kind: 'text', ...parsed };
  }
  const status = parsePorcelain((await git(cwd, ['status', '--porcelain=v1', '-z', '--', relative])).stdout);
  const entry = status.find((file) => file.path === relative);
  if (entry !== undefined && entry.index === '?') {
    const parsed = untrackedHunks(resolvePath(cwd, relative));
    return { path: relative, kind: parsed.binary ? 'binary' : 'text', hunks: parsed.hunks, truncated: parsed.truncated };
  }
  const result = await git(cwd, ['diff', 'HEAD', '-U3', '--', relative]);
  if (!result.ok) return { path: relative, kind: 'error' };
  if (/^Binary files /m.test(result.stdout)) return { path: relative, kind: 'binary' };
  if (result.stdout.trim().length === 0) return { path: relative, kind: 'none' };
  const parsed = parseHunks(result.stdout);
  return { path: relative, kind: 'text', ...parsed };
}

/**
 * Read the commit graph: git's own lane art plus one row per commit.
 *
 * `--graph` interleaves connector-only lines (`|\`, `|/`) with commit lines.
 * The format starts each commit line with a NUL, so the art is everything
 * before it and the fields follow; connector lines carry no NUL at all.
 * @param cwd - directory the browser named.
 * @param limit - commits to load.
 * @returns `{ rows }` where a row is `{ art }` or `{ art, hash, ... }`.
 */
async function readGraph(cwd, limit) {
  const result = await git(cwd, [
    'log',
    `-n${limit}`,
    '--graph',
    '--decorate=short',
    `--format=%x00%H%x00%h%x00%an%x00%at%x00%D%x00%s`,
  ]);
  if (!result.ok) return { rows: [] };
  const rows = [];
  for (const rawLine of result.stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim().length === 0) continue;
    const cut = line.indexOf('\0');
    if (cut === -1) {
      rows.push({ art: line });
      continue;
    }
    const fields = line.slice(cut + 1).split('\0');
    if (fields.length < 6) continue;
    const time = Number(fields[3]) * 1000;
    rows.push({
      art: line.slice(0, cut),
      hash: fields[0],
      short: fields[1],
      author: fields[2],
      time: Number.isFinite(time) ? time : 0,
      refs: fields[4],
      subject: fields.slice(5).join('\0'),
    });
  }
  return { rows };
}

/**
 * Register the prompt section (unless disabled) and the git routes.
 * @param ctx - host context carrying the prompt registry and the fetch fence.
 * @param config - `{ guidance?: boolean }`.
 */
export function apply(ctx, config = {}) {
  if (config.guidance !== false) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: 'worklog:report',
      order: SECTION_ORDER,
      text: GUIDANCE,
    }), 'worklog: prompt guidance');
  }

  ctx.effect(() => {
    const disposers = [
      ctx.connection.fetch.register({
        path: OVERVIEW_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const cwd = resolveCwd(new URL(request.url).searchParams.get('cwd'));
          if (cwd === undefined) return json({ git: false, reason: 'no-cwd' }, 200);
          return json(await readOverview(cwd));
        },
      }),
      ctx.connection.fetch.register({
        path: COMMIT_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const url = new URL(request.url);
          const cwd = resolveCwd(url.searchParams.get('cwd'));
          const hash = url.searchParams.get('hash') ?? '';
          if (cwd === undefined) return json({ error: 'no-cwd' }, 400);
          const commit = await readCommit(cwd, hash);
          return commit === undefined ? json({ error: 'not-found' }, 404) : json(commit);
        },
      }),
      ctx.connection.fetch.register({
        path: DIFF_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const url = new URL(request.url);
          const cwd = resolveCwd(url.searchParams.get('cwd'));
          const scope = url.searchParams.get('scope') === 'commit' ? 'commit' : 'worktree';
          if (cwd === undefined) return json({ error: 'no-cwd' }, 400);
          return json(await readDiff(cwd, {
            scope,
            hash: url.searchParams.get('hash') ?? '',
            path: url.searchParams.get('path') ?? '',
          }));
        },
      }),
      ctx.connection.fetch.register({
        path: GRAPH_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const url = new URL(request.url);
          const cwd = resolveCwd(url.searchParams.get('cwd'));
          const requested = Number(url.searchParams.get('limit'));
          const limit = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 120) : 40;
          if (cwd === undefined) return json({ rows: [] }, 200);
          return json(await readGraph(cwd, limit));
        },
      }),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, 'worklog: git routes');
}
