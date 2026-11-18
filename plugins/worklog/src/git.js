/**
 * Browser side of the Worklog git bridge.
 *
 * Routes are document-relative (the app may be served under a base path) and
 * sit behind the same authenticated fetch fence as the rest of `/api`.
 */

const BASE = 'api/worklog';

/**
 * One authenticated JSON read.
 * @param route - `overview` | `commit` | `diff`.
 * @param params - query parameters.
 * @param signal - caller cancellation.
 * @returns the decoded payload.
 */
async function read(route, params, signal) {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${BASE}.${route}?${query}`, {
    signal,
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * Working tree, branch state, and the recent commit list.
 * @param cwd - session working directory.
 * @param signal - caller cancellation.
 * @returns the overview payload.
 */
export function fetchOverview(cwd, signal) {
  return read('overview', { cwd }, signal);
}

/**
 * One commit's metadata and file list.
 * @param cwd - session working directory.
 * @param hash - selected commit hash.
 * @param signal - caller cancellation.
 * @returns the commit payload.
 */
export function fetchCommit(cwd, hash, signal) {
  return read('commit', { cwd, hash }, signal);
}

/**
 * One file comparison.
 * @param cwd - session working directory.
 * @param input - `{ scope: 'worktree' | 'commit', hash?, path }`.
 * @param signal - caller cancellation.
 * @returns the diff payload.
 */
export function fetchDiff(cwd, input, signal) {
  return read('diff', {
    cwd,
    scope: input.scope,
    hash: input.scope === 'commit' ? input.hash ?? '' : '',
    path: input.path,
  }, signal);
}

/**
 * The commit graph: git's lane art interleaved with one row per commit.
 * @param cwd - session working directory.
 * @param limit - commits to load.
 * @param signal - caller cancellation.
 * @returns `{ rows }`.
 */
export function fetchGraph(cwd, limit, signal) {
  return read('graph', { cwd, limit: String(limit) }, signal);
}

/**
 * Compact relative age for a commit time.
 * @param time - epoch milliseconds.
 * @returns e.g. `2h ago`.
 */
export function relativeAge(time) {
  if (!Number.isFinite(time) || time <= 0) return '';
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.round(months / 12)}y ago`;
}
