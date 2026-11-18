import { useEffect, useMemo, useRef, useState } from 'react';
import { clock, deriveRun, formatDuration, planHint, shortenPath } from './run.js';
import { fetchCommit, fetchDiff, fetchGraph, fetchOverview, relativeAge } from './git.js';

/**
 * Re-render on a fixed cadence while work is running, so elapsed times and the
 * "running for" line stay honest without any Host round-trip.
 * @param active - whether the clock should tick.
 * @returns the current timestamp.
 */
function useTick(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      setNow(Date.now());
      return undefined;
    }
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [active]);
  return now;
}

/** Read the session's working directory label, when the list knows it. */
function useWorkspaceLabel(useSessions, sessionId) {
  return useSessions((sessions) => {
    const row = sessions?.byId?.[sessionId];
    const cwd = typeof row?.cwd === 'string' ? row.cwd : '';
    return cwd.length === 0 ? '' : cwd.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
  });
}

/** Read the session's working directory path. */
function useWorkingDirectory(useSessions, sessionId) {
  return useSessions((sessions) => {
    const cwd = sessions?.byId?.[sessionId]?.cwd;
    return typeof cwd === 'string' ? cwd : '';
  });
}

/**
 * Keep the last real plan after the Host projection resets.
 *
 * The `todos` projection is cleared at every `turn/start`, so a session that
 * planned its work would otherwise show no plan at all from the second turn on
 * — the exact "still stuck / suddenly empty" behaviour this panel exists to
 * fix. A non-empty snapshot is remembered for the session and shown again when
 * the projection goes null; an explicit empty list still clears it.
 * @param useProjection - the framework projection hook.
 * @returns the plan to render and when it was last confirmed by the agent.
 */
function usePlan(useProjection) {
  const projection = useProjection('todos');
  const cache = useRef({ list: null, at: 0 });
  if (Array.isArray(projection)) {
    if (projection.length === 0) cache.current = { list: null, at: 0 };
    else if (cache.current.list !== projection) cache.current = { list: projection, at: Date.now() };
  }
  const live = Array.isArray(projection) && projection.length > 0 ? projection : null;
  return { todos: live ?? cache.current.list, updatedAt: cache.current.at };
}

/** Three dots that make an otherwise empty "thinking" card read as alive. */
function ThinkingDots() {
  return (
    <span className="wl-thinking" aria-hidden="true">
      <i /><i /><i />
    </span>
  );
}

/** Small stroke icon: a checklist. */
function IconList(props) {
  return (
    <svg viewBox="0 0 16 16" width={props.size ?? 14} height={props.size ?? 14} fill="none" aria-hidden="true">
      <path d="M2.5 4.5l1.2 1.2L6 3.4M2.5 10.5l1.2 1.2L6 9.4M8.5 4.5h5M8.5 10.5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Small stroke icon: an arrow into a panel. */
function IconOpen(props) {
  return (
    <svg viewBox="0 0 16 16" width={props.size ?? 12} height={props.size ?? 12} fill="none" aria-hidden="true">
      <path d="M6 3.5H3.5v9h9V10M9 3.5h3.5V7M12.5 3.5L7 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Small stroke icon: refresh. */
function IconRefresh(props) {
  return (
    <svg viewBox="0 0 16 16" width={props.size ?? 12} height={props.size ?? 12} fill="none" aria-hidden="true">
      <path d="M13 8a5 5 0 1 1-1.7-3.8M13 3v3.2h-3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Small stroke icon: chevron. */
function IconChevron(props) {
  return (
    <svg viewBox="0 0 16 16" width={props.size ?? 12} height={props.size ?? 12} fill="none" aria-hidden="true" className="wl-chevron" data-open={props.open || undefined}>
      <path d="M4.5 6.5L8 10l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Status copy and tone for the run view. */
function statusView(run) {
  if (run.running) return { tone: 'working', label: 'Working' };
  if (run.status === 'done') return { tone: 'done', label: 'Complete' };
  if (run.plan.total > 0) return { tone: 'paused', label: 'Paused' };
  return { tone: 'idle', label: 'Idle' };
}

/** One plan row. */
function PlanRow({ item, active, next }) {
  return (
    <li className="wl-step" data-status={item.status} data-next={next || undefined}>
      <span className="wl-step-mark" aria-hidden="true"><i /></span>
      <div className="wl-step-text">
        <div className="wl-step-title">{item.content}</div>
        {active ? <span className="wl-step-state">in progress</span> : next ? <span className="wl-step-state">next</span> : null}
      </div>
    </li>
  );
}

/** Split `+added −deleted` with the two signs tinted, or the refusal kinds. */
function FileCounts({ file }) {
  if (file.binary) return <span className="wl-file-count">binary</span>;
  if (file.untracked) return <span className="wl-file-count">new</span>;
  if ((file.added ?? 0) + (file.deleted ?? 0) === 0) return null;
  return (
    <span className="wl-file-count">
      <span className="wl-add">{`+${file.added ?? 0}`}</span>
      {'  '}
      <span className="wl-del">{`−${file.deleted ?? 0}`}</span>
    </span>
  );
}

/**
 * One changed file inside the tree: the row toggles its comparison open.
 * @param props - file record, display name, depth, expansion state, handler, and comparison payload.
 */
function FileRow({ file, name, depth, open, onToggle, diff }) {
  return (
    <li className="wl-file" data-open={open || undefined}>
      <button
        type="button"
        className="wl-file-row"
        style={{ paddingLeft: 6 + depth * 10 }}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="wl-badge" data-s={file.status} aria-hidden="true">{file.status}</span>
        <span className="wl-file-path" title={file.path}>{name ?? shortenPath(file.path, 46)}</span>
        <FileCounts file={file} />
        <IconChevron open={open} />
      </button>
      {open ? (
        <div className="wl-diff-wrap" style={{ marginLeft: depth * 10 }}>
          <DiffBlock diff={diff} />
        </div>
      ) : null}
    </li>
  );
}

/**
 * The line-level comparison for one file.
 * @param props - `{ diff }`, where undefined means still loading.
 */
function DiffBlock({ diff }) {
  if (diff === undefined) return <div className="wl-diff wl-diff-note">Loading comparison…</div>;
  if (diff.kind === 'binary') return <div className="wl-diff wl-diff-note">Binary file — no line comparison.</div>;
  if (diff.kind === 'none') return <div className="wl-diff wl-diff-note">No textual change.</div>;
  if (diff.kind === 'error' || diff.kind === 'invalid') return <div className="wl-diff wl-diff-note">This comparison is unavailable.</div>;
  const hunks = Array.isArray(diff.hunks) ? diff.hunks : [];
  if (hunks.length === 0) return <div className="wl-diff wl-diff-note">Nothing to show.</div>;
  return (
    <div className="wl-diff">
      {hunks.map((hunk, hunkIndex) => (
        <div className="wl-hunk" key={`${hunk.header}:${hunkIndex}`}>
          <div className="wl-hunk-head">{hunk.header}</div>
          {hunk.lines.map((line, lineIndex) => (
            <div
              key={lineIndex}
              className={`wl-line${line[0] === '+' ? ' wl-line-add' : line[0] === '-' ? ' wl-line-del' : ''}`}
            >{line}</div>
          ))}
        </div>
      ))}
      {diff.truncated ? <div className="wl-diff-note">Comparison truncated.</div> : null}
    </div>
  );
}

/** Files this session wrote, used when no git repository is available. */
function SessionFiles({ changes }) {
  if (changes === undefined || changes.total === 0) {
    return <div className="wl-empty">No files written in this session yet.</div>;
  }
  return (
    <ul className="wl-files">
      {changes.files.map((file) => (
        <li className="wl-file" key={file.path}>
          <div className="wl-file-row wl-file-static">
            <span className="wl-badge" data-s={file.status} aria-hidden="true">{file.status}</span>
            <span className="wl-file-path" title={file.path}>{shortenPath(file.path, 46)}</span>
            <span className="wl-file-count">{file.edits > 1 ? `${file.edits}×` : ''}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Group changed files into a directory tree.
 * @param files - changed-file records.
 * @returns the root node `{ name, path, dirs, files }`.
 */
function buildTree(files) {
  const root = { name: '', path: '', dirs: new Map(), files: [] };
  for (const file of files) {
    const parts = String(file.path).replace(/\\/g, '/').split('/').filter((part) => part.length > 0);
    let node = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const segment = parts[index];
      let child = node.dirs.get(segment);
      if (child === undefined) {
        child = { name: segment, path: parts.slice(0, index + 1).join('/'), dirs: new Map(), files: [] };
        node.dirs.set(segment, child);
      }
      node = child;
    }
    node.files.push({ ...file, name: parts[parts.length - 1] ?? String(file.path) });
  }
  return root;
}

/**
 * The changed-file tree: collapsible directories, expandable files.
 * @param props - files, closed-directory set, toggle handlers, and expansion state.
 */
function FileTree({ files, closed, onToggleFolder, expanded, keyFor, onToggle, diffs }) {
  const root = useMemo(() => buildTree(files), [files]);

  const renderNode = (node, depth) => {
    const dirs = [...node.dirs.values()].sort((left, right) => left.name.localeCompare(right.name));
    const leaves = [...node.files].sort((left, right) => left.name.localeCompare(right.name));
    return (
      <>
        {dirs.map((child) => {
          const isClosed = closed.has(child.path);
          return (
            <li key={`dir:${child.path}`}>
              <button
                type="button"
                className="wl-folder"
                style={{ paddingLeft: 6 + depth * 10 }}
                aria-expanded={!isClosed}
                onClick={() => onToggleFolder(child.path)}
              >
                <IconChevron open={!isClosed} />
                <span className="wl-folder-name">{`${child.name}/`}</span>
              </button>
              {isClosed ? null : <ul className="wl-tree">{renderNode(child, depth + 1)}</ul>}
            </li>
          );
        })}
        {leaves.map((file) => {
          const key = keyFor(file);
          return (
            <li key={`file:${file.path}`}>
              <FileRow
                file={file}
                name={file.name}
                depth={depth}
                open={expanded === key}
                onToggle={() => onToggle(file)}
                diff={diffs[key]}
              />
            </li>
          );
        })}
      </>
    );
  };

  return <ul className="wl-tree">{renderNode(root, 0)}</ul>;
}

/**
 * Parse `%D` decoration into short ref badges (`HEAD -> main` → `main`).
 * @param refs - raw decoration string.
 * @returns at most two badges plus a `+N` marker.
 */
function refBadges(refs) {
  const parts = String(refs).split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  const clean = parts.map((part) => part.replace(/^HEAD -> /, '').replace(/^tag: /, ''));
  const unique = [...new Set(clean)];
  const shown = unique.slice(0, 1);
  const extra = unique.length - shown.length;
  return { shown, extra };
}

/**
 * Git's lane art, with commit markers picked out from the connector strokes.
 * @param props - `{ art }` as printed by `git log --graph`.
 */
function GraphArt({ art }) {
  const parts = [];
  let buffer = '';
  for (const char of String(art)) {
    if (char !== '*') {
      buffer += char;
      continue;
    }
    if (buffer !== '') {
      parts.push(<span className="wl-lane" key={`lane:${parts.length}`}>{buffer}</span>);
      buffer = '';
    }
    parts.push(<span className="wl-lane-mark" key={`mark:${parts.length}`}>*</span>);
  }
  if (buffer !== '') parts.push(<span className="wl-lane" key={`lane:${parts.length}`}>{buffer}</span>);
  return <span className="wl-graph-art">{parts}</span>;
}

/**
 * The commit graph: git's own lane art, one selectable row per commit.
 * Connector-only rows (`|\`, `|/`) keep the lanes continuous between commits.
 * @param props - graph rows, the selected hash, and the selection handler.
 */
function CommitGraph({ rows, value, onPick }) {
  return (
    <ul className="wl-graph" role="listbox" aria-label="Commit graph">
      {rows.map((row, index) => {
        if (row.hash === undefined) {
          return (
            <li key={`lane:${index}`} className="wl-graph-lane" aria-hidden="true">
              <GraphArt art={row.art} />
            </li>
          );
        }
        const { shown, extra } = refBadges(row.refs);
        return (
          <li key={row.hash} role="option" aria-selected={row.hash === value}>
            <button
              type="button"
              className="wl-graph-row"
              data-active={row.hash === value || undefined}
              title={`${row.short} · ${row.author} · ${row.subject}`}
              onClick={() => onPick(row.hash)}
            >
              <GraphArt art={row.art} />
              <span className="wl-graph-hash">{row.short}</span>
              <span className="wl-graph-subject">{row.subject}</span>
              {shown.length > 0 ? (
                <span className="wl-graph-refs">
                  {shown.map((ref) => <span className="wl-ref" key={ref}>{ref}</span>)}
                  {extra > 0 ? <span className="wl-ref" title={row.refs}>{`+${extra}`}</span> : null}
                </span>
              ) : null}
              <span className="wl-graph-age">{relativeAge(row.time)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Working-tree and committed changes, with the commit graph and per-file diffs.
 * @param props - session working directory, running state, and the session-derived fallback.
 */
function ChangesPanel({ cwd, running, fallback }) {
  const [tab, setTab] = useState('uncommitted');
  const [overview, setOverview] = useState(null);
  const [failure, setFailure] = useState('');
  const [nonce, setNonce] = useState(0);
  const [hash, setHash] = useState('');
  const [commit, setCommit] = useState(null);
  const [commitFailure, setCommitFailure] = useState('');
  const [expanded, setExpanded] = useState('');
  const [diffs, setDiffs] = useState({});

  useEffect(() => {
    if (cwd === '') return undefined;
    const controller = new AbortController();
    let alive = true;
    const load = async () => {
      try {
        const data = await fetchOverview(cwd, controller.signal);
        if (!alive) return;
        setOverview(data);
        setFailure('');
      } catch (error) {
        if (!alive || error?.name === 'AbortError') return;
        setFailure(error instanceof Error ? error.message : String(error));
      }
    };
    load();
    const handle = setInterval(load, running ? 4000 : 20000);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(handle);
    };
  }, [cwd, running, nonce]);

  const commits = overview?.git === true && Array.isArray(overview.commits) ? overview.commits : [];
  const [graph, setGraph] = useState([]);
  const [graphFailure, setGraphFailure] = useState('');

  useEffect(() => {
    if (cwd === '' || overview?.git !== true) return undefined;
    const controller = new AbortController();
    let alive = true;
    fetchGraph(cwd, 40, controller.signal)
      .then((data) => {
        if (!alive) return;
        setGraph(Array.isArray(data?.rows) ? data.rows : []);
        setGraphFailure('');
      })
      .catch((error) => {
        if (alive && error?.name !== 'AbortError') setGraphFailure(error instanceof Error ? error.message : String(error));
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [cwd, overview?.git, nonce, running]);

  // Until the Host half is reloaded, the graph route may be absent; the flat
  // commit list from the overview still gives a usable picker.
  const fallbackRows = commits.map((entry) => ({
    art: '* ',
    hash: entry.hash,
    short: entry.short,
    author: entry.author,
    time: entry.time,
    refs: '',
    subject: entry.subject,
  }));
  const graphRows = graph.length > 0 ? graph : fallbackRows;
  const firstCommit = graphRows.find((row) => typeof row.hash === 'string')?.hash;

  useEffect(() => {
    if (tab !== 'committed' || hash !== '') return;
    if (typeof firstCommit === 'string' && firstCommit.length > 0) setHash(firstCommit);
  }, [tab, hash, firstCommit]);

  useEffect(() => {
    if (hash === '' || overview?.git !== true) return undefined;
    const controller = new AbortController();
    let alive = true;
    setCommit(null);
    setCommitFailure('');
    fetchCommit(cwd, hash, controller.signal)
      .then((data) => { if (alive) setCommit(data); })
      .catch((error) => {
        if (alive && error?.name !== 'AbortError') setCommitFailure(error instanceof Error ? error.message : String(error));
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [cwd, hash, overview?.git, nonce]);

  useEffect(() => {
    if (expanded === '' || cwd === '' || diffs[expanded] !== undefined) return undefined;
    let request;
    try {
      request = JSON.parse(expanded);
    } catch {
      return undefined;
    }
    const controller = new AbortController();
    let alive = true;
    fetchDiff(cwd, request, controller.signal)
      .then((data) => { if (alive) setDiffs((previous) => ({ ...previous, [expanded]: data })); })
      .catch(() => { if (alive) setDiffs((previous) => ({ ...previous, [expanded]: { kind: 'error' } })); });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [expanded, cwd, diffs]);

  const git = overview?.git === true;
  const uncommitted = git ? overview.files : [];
  const branch = typeof overview?.branch === 'string' ? overview.branch : '';
  const ahead = Number(overview?.ahead) || 0;
  const behind = Number(overview?.behind) || 0;

  const keyFor = (file) => JSON.stringify({
    scope: tab === 'committed' ? 'commit' : 'worktree',
    hash: tab === 'committed' ? hash : '',
    path: file.path,
  });

  const toggle = (file) => {
    const key = keyFor(file);
    setExpanded((current) => (current === key ? '' : key));
  };

  const [closed, setClosed] = useState(() => new Set());
  const toggleFolder = (path) => {
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const files = tab === 'committed' ? (commit?.files ?? []) : uncommitted;
  const added = files.reduce((total, file) => total + (file.added ?? 0), 0);
  const deleted = files.reduce((total, file) => total + (file.deleted ?? 0), 0);

  return (
    <section className="wl-section">
      <div className="wl-section-head">
        <span className="wl-section-title">Changes</span>
        <span className="wl-section-meta">
          {git
            ? `${branch !== '' ? branch : 'detached'}${ahead > 0 ? ` ↑${ahead}` : ''}${behind > 0 ? ` ↓${behind}` : ''}`
            : 'no repo'}
        </span>
        <button type="button" className="wl-refresh" aria-label="Refresh changes" title="Refresh changes" onClick={() => setNonce((value) => value + 1)}>
          <IconRefresh />
        </button>
      </div>

      <div className="wl-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'uncommitted'} data-active={tab === 'uncommitted' || undefined} onClick={() => setTab('uncommitted')}>
          Uncommitted
          {git && uncommitted.length > 0 ? <span className="wl-tab-count">{uncommitted.length}</span> : null}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'committed'} data-active={tab === 'committed' || undefined} onClick={() => setTab('committed')}>
          Committed
          {Number(overview?.commitCount) > 0 ? <span className="wl-tab-count">{overview.commitCount}</span> : null}
        </button>
      </div>

      {failure !== '' ? (
        <>
          <div className="wl-empty">
            The git bridge did not answer ({failure}). Restart DeepSeek Harness to load the host routes, then reopen this tab.
          </div>
          <SessionFiles changes={fallback} />
        </>
      ) : cwd === '' ? (
        <>
          <div className="wl-empty">This session has no working directory.</div>
          <SessionFiles changes={fallback} />
        </>
      ) : overview === null ? (
        <div className="wl-empty">Reading the working tree…</div>
      ) : !git ? (
        <>
          <div className="wl-empty">
            {overview?.reason === 'git-unavailable'
              ? 'Git is not available here — showing files this session wrote.'
              : 'This directory is not a git repository — showing files this session wrote.'}
          </div>
          <SessionFiles changes={fallback} />
        </>
      ) : tab === 'uncommitted' ? (
        uncommitted.length === 0 ? (
          <div className="wl-empty">Working tree is clean.</div>
        ) : (
          <>
            <FileTree
              files={uncommitted}
              closed={closed}
              onToggleFolder={toggleFolder}
              expanded={expanded}
              keyFor={keyFor}
              onToggle={toggle}
              diffs={diffs}
            />
            <div className="wl-diff-total">
              {`${uncommitted.length} ${uncommitted.length === 1 ? 'file' : 'files'}${added + deleted > 0 ? ` · +${added} −${deleted}` : ''}`}
            </div>
          </>
        )
      ) : graphRows.length === 0 ? (
        <div className="wl-empty">
          {graphFailure !== '' ? `The commit graph could not be read (${graphFailure}).` : 'No commits in this repository yet.'}
        </div>
      ) : (
        <>
          <CommitGraph
            rows={graphRows}
            value={hash}
            onPick={(next) => {
              setHash(next);
              setExpanded('');
            }}
          />
          {commitFailure !== '' ? <div className="wl-empty">This commit could not be read ({commitFailure}).</div> : null}
          {commit !== null ? (
            <>
              <div className="wl-commit-meta">
                <span>{commit.author}</span>
                <span>·</span>
                <span>{relativeAge(commit.time)}</span>
                <span>·</span>
                <span>{`${commit.files.length} ${commit.files.length === 1 ? 'file' : 'files'}`}</span>
                {added + deleted > 0 ? <span className="wl-add">{`+${added}`}</span> : null}
                {added + deleted > 0 ? <span className="wl-del">{`−${deleted}`}</span> : null}
              </div>
              <FileTree
                files={commit.files}
                closed={closed}
                onToggleFolder={toggleFolder}
                expanded={expanded}
                keyFor={keyFor}
                onToggle={toggle}
                diffs={diffs}
              />
            </>
          ) : (
            <div className="wl-empty">Reading the commit…</div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The full Work panel, mounted as a right-Sidebar tab.
 * @param props - framework standard props.
 */
export function WorkPanel({ useChat, useSession, useProjection, useSessions, sessionId }) {
  const session = useSession((value) => value);
  const chat = useChat((value) => value);
  const { todos, updatedAt } = usePlan(useProjection);
  const workspace = useWorkspaceLabel(useSessions, sessionId);
  const cwd = useWorkingDirectory(useSessions, sessionId);
  const now = useTick(session?.running === true);
  const run = useMemo(() => deriveRun({ session, chat, todos, planUpdatedAt: updatedAt, now }), [session, chat, todos, updatedAt, now]);
  const status = statusView(run);
  const hint = planHint(run);
  const nowBody = run.now.detail !== '' ? run.now.detail : run.reasoning;

  return (
    <div className="wl-root">
      <div className="wl-scroll">
        <div className="wl-head">
          <span className="wl-status" data-tone={status.tone}>
            <i className="wl-dot" data-live={run.running || undefined} />
            {status.label}
          </span>
          <span className="wl-head-meta">
            <span>Turn {run.turn}</span>
            {run.elapsedMs > 0 ? <span>·</span> : null}
            {run.elapsedMs > 0 ? <span>{formatDuration(run.elapsedMs)}</span> : null}
            {run.calls > 0 ? <span>·</span> : null}
            {run.calls > 0 ? <span>{run.calls} calls</span> : null}
          </span>
        </div>

        <div className="wl-workspace">
          <span className="wl-workspace-name">{workspace !== '' ? workspace : 'This session'}</span>
          <span className="wl-workspace-sub">{run.plan.total > 0 ? `${run.plan.doneCount}/${run.plan.total} steps` : 'no plan yet'}</span>
        </div>

        {run.plan.total > 0 ? (
          <div className="wl-progress"><i style={{ width: `${run.plan.pct}%` }} /></div>
        ) : null}

        <section className="wl-section" style={{ marginTop: 20 }}>
          <div className="wl-now" data-kind={run.now.kind}>
            <div className="wl-now-row">
              <i className="wl-now-glyph" data-live={run.running || undefined} />
              <span className="wl-now-tool">{run.now.label}</span>
              <span className="wl-now-target" title={run.now.target}>{run.now.target}</span>
              {run.running && run.now.since ? <span className="wl-now-time">{formatDuration(now - run.now.since)}</span> : null}
            </div>
            {nowBody !== '' ? <div className="wl-now-body">{nowBody}</div> : run.now.kind === 'thinking' ? <ThinkingDots /> : null}
          </div>
        </section>

        {run.plan.total > 0 ? (
          <section className="wl-section">
            <div className="wl-section-head">
              <span className="wl-section-title">Plan</span>
              <span className="wl-section-meta">
                <b>{run.plan.doneCount}</b>/{run.plan.total}
                {run.plan.updatedAt > 0 ? ` · ${clock(run.plan.updatedAt)}` : ''}
              </span>
            </div>
            <ul className="wl-plan">
              {run.plan.items.map((item) => (
                <PlanRow
                  key={`${item.index}:${item.content}`}
                  item={item}
                  active={item.index === run.plan.located}
                  next={item.index === run.plan.nextIndex}
                />
              ))}
            </ul>
            <div className="wl-bar"><i style={{ width: `${run.plan.pct}%` }} /></div>
            {hint !== '' ? <div className="wl-hint">{hint}</div> : null}
          </section>
        ) : null}

        <ChangesPanel cwd={cwd} running={run.running} fallback={run.changes} />

        <div className="wl-foot">
          <i className="wl-dot" data-live={run.running || undefined} />
          {run.running ? 'Following this turn live' : 'Waiting for the next turn'}
        </div>
      </div>
    </div>
  );
}

/**
 * Compact strip above the composer. Replaces the shipped todo dock: it shows
 * the step the agent is actually on, keeps the counter and progress visible,
 * and opens the full panel in one click.
 * @param props - framework standard props plus the injected `openWork`.
 */
export function WorkDock({ useChat, useSession, useProjection, openWork }) {
  const session = useSession((value) => value);
  const chat = useChat((value) => value);
  const { todos, updatedAt } = usePlan(useProjection);
  const now = useTick(session?.running === true);
  const run = useMemo(() => deriveRun({ session, chat, todos, planUpdatedAt: updatedAt, now }), [session, chat, todos, updatedAt, now]);
  if (run.plan.total === 0 && !run.running) return null;
  const status = statusView(run);
  const current = run.plan.items[run.plan.located];
  const detail = run.now.kind === 'tool'
    ? `${run.now.label}${run.now.target ? ` · ${run.now.target}` : ''}`
    : run.now.label;

  return (
    <div className="wl-root wl-inline">
      <div className="wl-dock" data-status={status.tone}>
        <span className="wl-dock-status">
          <i className="wl-dot" data-live={run.running || undefined} />
          {status.label}
        </span>
        <span className="wl-dock-current" title={current?.content ?? detail}>
          {current ? <b>{current.content}</b> : detail}
          {run.running && current ? <span style={{ color: 'var(--wl-3)' }}>{` — ${detail}`}</span> : null}
        </span>
        {run.plan.total > 0 ? (
          <span className="wl-dock-progress">
            <span className="wl-dock-bar"><i style={{ width: `${run.plan.pct}%` }} /></span>
            <span className="wl-dock-count">{run.plan.doneCount}/{run.plan.total}</span>
          </span>
        ) : null}
        <button type="button" className="wl-dock-open" onClick={openWork} title="Open the Work panel">
          <IconList size={12} />
          Work
          <IconOpen size={11} />
        </button>
      </div>
    </div>
  );
}

/**
 * Header action that opens (and expands) the Work panel.
 * @param props - the injected `openWork`.
 */
export function WorkButton({ openWork }) {
  return (
    <button type="button" className="wl-hbtn" onClick={openWork} title="Open the Work panel">
      <IconList size={13} />
      Work
    </button>
  );
}
