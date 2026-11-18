/**
 * Pure derivation for the Work panel.
 *
 * Every value the panel shows is computed from data the browser already holds:
 * the session lifecycle snapshot, the Chat target snapshot (finalized nodes,
 * the in-flight assistant step, running tool calls, turn timeline), and the
 * host-computed `todos` projection. Nothing here talks to the Host, and nothing
 * reads private state: the panel only makes the existing activity legible.
 *
 * The point of this module is the *live* part. A todo list only moves when the
 * agent rewrites it, so a step can look stuck while work is plainly happening.
 * `deriveRun` therefore pairs the list with the evidence around it — which call
 * is running right now, how long the current step has been open, what was just
 * read or written — and marks the step the activity actually belongs to.
 */

/** Display labels for the tool names the harness ships. */
const TOOL_LABELS = {
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  str_replace_editor: 'Edit',
  grep: 'Search',
  glob: 'Find',
  pwsh: 'Shell',
  powershell: 'Shell',
  bash: 'Shell',
  shell: 'Shell',
  terminal: 'Terminal',
  todo_write: 'Plan',
  web_search: 'Web search',
  web_fetch: 'Fetch',
  skill: 'Skill',
  subagent: 'Subagent',
  subagent_control: 'Subagent',
  subagent_report: 'Subagent',
  workflow: 'Workflow',
  present: 'Present',
  ask_user_question: 'Question',
  jobs: 'Job',
  job_output: 'Job',
  job_kill: 'Job',
  load_workspace_dependencies: 'Workspace',
  create_goal: 'Goal',
  get_goal: 'Goal',
  update_goal: 'Goal',
  schedule_create: 'Schedule',
  schedule_list: 'Schedule',
  schedule_update: 'Schedule',
  schedule_delete: 'Schedule',
  read_image: 'Image',
};

/** Tools whose call mutates one file on disk. */
const FILE_WRITE_TOOLS = new Set(['write', 'edit', 'str_replace_editor']);

/** Names a shell call can carry. */
const SHELL_TOOLS = new Set(['pwsh', 'powershell', 'bash', 'shell', 'terminal']);

/**
 * Parse one tool call's raw argument JSON without throwing.
 * @param raw - `arguments` string from the call head.
 * @returns the parsed object, or an empty object for absent/invalid JSON.
 */
export function parseArgs(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return {};
  try {
    const value = JSON.parse(raw);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/**
 * Pick a file path out of one tool call's arguments.
 * @param args - parsed arguments.
 * @returns the path the call names, when it names one.
 */
export function pathOf(args) {
  for (const key of ['file_path', 'filePath', 'path', 'target_file', 'notebook_path']) {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Short human target for one tool call: a path, a command, a query, a host.
 * @param name - tool name.
 * @param args - parsed arguments.
 * @returns one display line, or an empty string when the call has no target.
 */
export function targetOf(name, args) {
  if (Object.hasOwn(args, 'todos') && Array.isArray(args.todos)) {
    return `${args.todos.length} ${args.todos.length === 1 ? 'item' : 'items'}`;
  }
  if (SHELL_TOOLS.has(name)) {
    const command = typeof args.command === 'string' ? args.command : typeof args.cmd === 'string' ? args.cmd : '';
    return firstLine(command);
  }
  if (name === 'grep' || name === 'glob') {
    const pattern = typeof args.pattern === 'string' ? args.pattern : typeof args.query === 'string' ? args.query : '';
    if (pattern.trim().length > 0) return firstLine(pattern);
  }
  if (name === 'web_search' && typeof args.query === 'string') return firstLine(args.query);
  if (name === 'web_fetch' && typeof args.url === 'string') return args.url;
  const path = pathOf(args);
  if (path !== undefined) return path;
  for (const key of ['pattern', 'query', 'url', 'description', 'prompt', 'goal', 'content']) {
    const value = args[key];
    if (typeof value === 'string' && value.trim().length > 0) return firstLine(value);
  }
  return '';
}

/**
 * First non-empty line of a multi-line value, trimmed to a readable length.
 * @param text - raw value.
 * @param max - character budget.
 * @returns the display line.
 */
export function firstLine(text, max = 140) {
  const line = String(text).split(/\r?\n/).map((part) => part.trim()).find((part) => part.length > 0) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Friendly label for one tool name.
 * @param name - tool name.
 * @returns display label.
 */
export function toolLabel(name) {
  return TOOL_LABELS[name] ?? String(name).replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Concatenate the text blocks of one settled tool result or assistant message.
 * @param node - legacy Chat node carrying `content` blocks.
 * @returns the joined text.
 */
export function textOf(node) {
  const blocks = Array.isArray(node?.content) ? node.content : [];
  const parts = [];
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n');
}

/**
 * Latest reasoning excerpt from the in-flight assistant step, falling back to
 * the last settled assistant message.
 * @param chat - Chat target snapshot.
 * @returns the excerpt, or an empty string.
 */
export function reasoningExcerpt(chat) {
  const partial = chat?.legacy?.partial ?? null;
  const blocks = Array.isArray(partial?.blocks) ? partial.blocks : [];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.kind === 'reasoning' && typeof block.text === 'string' && block.text.trim().length > 0) {
      return tail(block.text);
    }
  }
  const nodes = chat?.legacy?.nodes ?? [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.kind !== 'assistant') continue;
    const assistantBlocks = Array.isArray(node.blocks) ? node.blocks : [];
    for (let inner = assistantBlocks.length - 1; inner >= 0; inner -= 1) {
      const block = assistantBlocks[inner];
      if (block?.kind === 'reasoning' && typeof block.text === 'string' && block.text.trim().length > 0) {
        return tail(block.text);
      }
    }
  }
  return '';
}

/**
 * The live assistant prose of the in-flight step.
 * @param chat - Chat target snapshot.
 * @returns the last text block, or an empty string.
 */
export function partialText(chat) {
  const blocks = chat?.legacy?.partial?.blocks ?? [];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.kind === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
      return tail(block.text);
    }
  }
  return '';
}

/**
 * Last paragraph of a longer text, collapsed to one readable line.
 * @param text - raw text.
 * @param max - character budget.
 * @returns the excerpt.
 */
function tail(text, max = 240) {
  const paragraphs = String(text).trim().split(/\n{2,}/);
  const last = paragraphs[paragraphs.length - 1] ?? '';
  const flat = last.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(flat.length - max);
  const boundary = cut.indexOf(' ');
  return `…${boundary > 0 ? cut.slice(boundary + 1) : cut}`;
}

/**
 * Duration between two clock values, formatted for the panel.
 * @param ms - milliseconds.
 * @returns e.g. `4m 12s`.
 */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/**
 * Clock label for a stored event time.
 * @param time - epoch milliseconds.
 * @returns `HH:mm`.
 */
export function clock(time) {
  if (!Number.isFinite(time)) return '';
  const date = new Date(time);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Shorten a path from the middle so the file name stays visible.
 * @param path - display path.
 * @param max - character budget.
 * @returns the shortened path.
 */
export function shortenPath(path, max = 42) {
  const value = String(path).replace(/\\/g, '/');
  if (value.length <= max) return value;
  const parts = value.split('/').filter((part) => part.length > 0);
  const name = parts[parts.length - 1] ?? value;
  const parent = parts[parts.length - 2] ?? '';
  const tail = parent.length > 0 ? `${parent}/${name}` : name;
  if (tail.length + 2 <= max) return `…/${tail}`;
  return `…${name.slice(-(max - 1))}`;
}

/**
 * File name of a path.
 * @param path - path.
 * @returns the last segment.
 */
export function baseName(path) {
  const parts = String(path).replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || String(path);
}

/**
 * Derive the complete work view for one session.
 * @param input - session lifecycle snapshot, Chat target snapshot, todo projection.
 * @returns the render-ready work view.
 */
export function deriveRun(input) {
  const now = input.now ?? Date.now();
  const session = input.session ?? undefined;
  const chat = input.chat ?? undefined;
  const todos = Array.isArray(input.todos) ? input.todos : [];
  const running = session?.running === true;
  const nodes = chat?.legacy?.nodes ?? [];
  const runningCalls = chat?.legacy?.runningCalls ?? [];
  const partial = chat?.legacy?.partial ?? null;
  const timeline = chat?.timeline;
  const activeCall = runningCalls.length > 0 ? runningCalls[runningCalls.length - 1] : undefined;
  const turn = partial?.turn ?? activeCall?.turn ?? lastTurn(timeline) ?? 1;
  const step = partial?.step ?? activeCall?.step ?? 0;

  const items = todos.map((item, index) => ({
    index,
    content: typeof item?.content === 'string' ? item.content : String(item?.content ?? ''),
    status: item?.status === 'completed' || item?.status === 'in_progress' ? item.status : 'pending',
  }));
  const doneCount = items.filter((item) => item.status === 'completed').length;
  const activeIndex = items.findIndex((item) => item.status === 'in_progress');
  const nextIndex = activeIndex === -1 ? items.findIndex((item) => item.status === 'pending') : -1;
  const located = activeIndex !== -1 ? activeIndex : nextIndex;

  const turnStart = timeline?.turns?.get?.(turn)?.start?.time;
  const turnEnd = timeline?.turns?.get?.(turn)?.end?.time;
  const elapsedMs = turnStart === undefined ? 0 : Math.max(0, (turnEnd ?? (running ? now : turnStart)) - turnStart);

  const activity = recentActivity(nodes, runningCalls, now);
  const changes = collectChanges(nodes);
  const commit = collectCommit(nodes);
  const lastEvent = nodes.length > 0 ? nodes[nodes.length - 1].time : undefined;

  const current = describeNow({ running, activeCall, partial, chat, activity, startedAt: turnStart ?? lastEvent, now });
  const reasoning = reasoningExcerpt(chat);

  return {
    running,
    status: running ? 'working' : items.length > 0 && doneCount === items.length ? 'done' : items.length > 0 ? 'paused' : 'idle',
    turn,
    step,
    turnCount: timeline?.turnOrder?.length ?? 0,
    startedAt: turnStart,
    elapsedMs,
    plan: {
      items,
      activeIndex,
      nextIndex,
      located,
      doneCount,
      total: items.length,
      pct: items.length === 0 ? 0 : Math.round((doneCount / items.length) * 100),
      updatedAt: input.planUpdatedAt ?? 0,
    },
    now: current,
    reasoning,
    activity,
    calls: nodes.filter((node) => node.kind === 'tool-result').length + runningCalls.length,
    changes,
    commit,
  };
}

/**
 * Highest loaded turn number, from the Chat timeline.
 * @param timeline - Chat timeline snapshot.
 * @returns the turn number, when one is loaded.
 */
function lastTurn(timeline) {
  const order = timeline?.turnOrder;
  if (!Array.isArray(order) || order.length === 0) return undefined;
  return order[order.length - 1];
}

/**
 * The single line describing what the agent is doing at this instant.
 * @param input - the live pieces of the view.
 * @returns `{ kind, label, target, detail, since }`.
 */
function describeNow({ running, activeCall, partial, chat, activity, startedAt, now }) {
  if (!running) {
    const last = activity.find((entry) => entry.state !== 'running');
    if (last !== undefined) {
      return { kind: 'idle', label: 'Idle', target: '', detail: `Last ${last.label.toLowerCase()} at ${clock(last.at)}`, since: last.at };
    }
    return { kind: 'idle', label: 'Idle', target: '', detail: '', since: startedAt ?? now };
  }
  if (activeCall !== undefined) {
    const args = parseArgs(activeCall.argsRaw);
    return {
      kind: 'tool',
      label: toolLabel(activeCall.name),
      target: targetOf(activeCall.name, args),
      detail: '',
      since: activeCall.time,
    };
  }
  const prose = partialText(chat);
  if (prose.length > 0) {
    return { kind: 'writing', label: 'Writing', target: '', detail: prose, since: startedAt ?? now };
  }
  if (partial !== null) {
    return { kind: 'thinking', label: 'Thinking', target: '', detail: '', since: startedAt ?? now };
  }
  return { kind: 'waiting', label: 'Waiting for the model', target: '', detail: '', since: startedAt ?? now };
}

/**
 * Recent tool activity, newest first: in-flight calls plus settled results.
 * @param nodes - finalized Chat nodes.
 * @param runningCalls - in-flight calls.
 * @param now - current clock.
 * @returns up to six activity rows.
 */
function recentActivity(nodes, runningCalls, now) {
  const rows = [];
  for (const call of runningCalls) {
    const args = parseArgs(call.argsRaw);
    rows.push({
      key: `run:${call.callId}`,
      callId: call.callId,
      name: call.name,
      label: toolLabel(call.name),
      target: targetOf(call.name, args),
      state: 'running',
      at: call.time,
      ms: Math.max(0, now - (call.time ?? now)),
    });
  }
  const settled = nodes.filter((node) => node.kind === 'tool-result').slice(-8).reverse();
  for (const node of settled) {
    const name = node.call?.name ?? 'tool';
    const args = parseArgs(node.call?.argsRaw ?? '');
    rows.push({
      key: `done:${node.seq}:${node.callId}`,
      callId: node.callId,
      name,
      label: toolLabel(name),
      target: targetOf(name, args),
      state: node.isError === true ? 'error' : 'ok',
      at: node.time,
      ms: typeof node.callTime === 'number' && typeof node.time === 'number' ? Math.max(0, node.time - node.callTime) : undefined,
    });
    if (rows.length >= 8) break;
  }
  return rows.slice(0, 6);
}

/**
 * Files the session touched, from file-tool calls and the newest `git status`.
 * @param nodes - finalized Chat nodes.
 * @returns `{ files, total, added, deleted, source }`.
 */
function collectChanges(nodes) {
  const files = new Map();
  let source = 'tools';
  for (const node of nodes) {
    if (node.kind !== 'tool-result') continue;
    const name = node.call?.name;
    if (!FILE_WRITE_TOOLS.has(name)) continue;
    const args = parseArgs(node.call?.argsRaw ?? '');
    const path = pathOf(args);
    if (path === undefined) continue;
    const previous = files.get(path);
    if (previous === undefined) {
      files.set(path, { path, status: name === 'write' ? 'A' : 'M', edits: 1 });
    } else {
      previous.edits += 1;
      if (previous.status === 'A' && name !== 'write') previous.status = 'M';
    }
  }
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.kind !== 'tool-result' || !SHELL_TOOLS.has(node.call?.name ?? '')) continue;
    const args = parseArgs(node.call?.argsRaw ?? '');
    const command = typeof args.command === 'string' ? args.command : '';
    if (!/\bgit\s+(status|diff|show)\b/.test(command)) continue;
    const parsed = parsePorcelain(textOf(node));
    if (parsed.length === 0) continue;
    source = 'git';
    for (const entry of parsed) {
      const previous = files.get(entry.path);
      files.set(entry.path, { path: entry.path, status: entry.status, edits: previous?.edits ?? 1 });
    }
    break;
  }
  const list = [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
  return {
    files: list,
    total: list.length,
    added: list.filter((file) => file.status === 'A').length,
    deleted: list.filter((file) => file.status === 'D').length,
    source,
  };
}

/**
 * Parse `git status --porcelain` output into path/status pairs.
 * @param text - command output.
 * @returns parsed entries (work paths only).
 */
function parsePorcelain(text) {
  const entries = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const match = /^([ MADRCU?!]{1,2})\s+(.+)$/.exec(raw);
    if (match === null) continue;
    const code = match[1].trim();
    let path = match[2].trim();
    if (path.includes(' -> ')) path = path.split(' -> ').pop() ?? path;
    path = path.replace(/^"|"$/g, '');
    if (path.length === 0 || path.startsWith('no changes')) continue;
    const status = code.includes('?') ? 'A' : code.includes('D') ? 'D' : code.includes('A') ? 'A' : code === 'M' || code === 'MM' ? 'M' : 'M';
    entries.push({ path, status });
  }
  return entries;
}

/**
 * Find the newest commit the session created or inspected.
 * @param nodes - finalized Chat nodes.
 * @returns `{ hash, subject, branch, pushed, at }`, or null.
 */
function collectCommit(nodes) {
  let commit;
  let pushed = false;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.kind !== 'tool-result' || !SHELL_TOOLS.has(node.call?.name ?? '')) continue;
    const args = parseArgs(node.call?.argsRaw ?? '');
    const command = typeof args.command === 'string' ? args.command : '';
    const text = textOf(node);
    if (!/\bgit\b/.test(command)) continue;
    if (commit === undefined) commit = parseCommit(text, node.time);
    if (/\bgit\s+push\b/.test(command) && /->|Everything up-to-date|To (?:github|gitlab|ssh|https)/.test(text)) pushed = true;
    if (commit !== undefined && /\bgit\s+push\b/.test(command)) break;
  }
  if (commit === undefined) return null;
  return { ...commit, pushed };
}

/**
 * Extract one commit line from git output.
 * @param text - command output.
 * @param at - event time.
 * @returns `{ hash, subject, branch, at }`, or undefined.
 */
function parseCommit(text, at) {
  const value = String(text);
  let match = /^\s*\[([^\]\s]+)\s+([0-9a-f]{7,40})\]\s+(.+)$/m.exec(value);
  if (match !== null) return { hash: match[2], subject: match[3].trim(), branch: match[1].replace(/^\(|\)$/g, ''), at };
  match = /^commit ([0-9a-f]{40})$/m.exec(value);
  if (match !== null) {
    const after = value.slice(match.index + match[0].length).split(/\r?\n/).map((line) => line.trim());
    const subject = after.find((line) => line.length > 0 && !/^Author:|^Date:|^Merge:/.test(line));
    return { hash: match[1], subject: subject ?? '', branch: '', at };
  }
  match = /^([0-9a-f]{7,40})\s+(.+)$/m.exec(value);
  if (match !== null) return { hash: match[1], subject: match[2].trim(), branch: '', at };
  match = /HEAD is now at ([0-9a-f]{7,40})\s*(.*)$/m.exec(value);
  if (match !== null) return { hash: match[1], subject: match[2].trim(), branch: '', at };
  return undefined;
}

/**
 * One-line explanation of the current gap between the todo list and reality.
 * The list is only rewritten when the agent says so, so the panel tells the
 * truth about *when* the active row was last confirmed by the model.
 * @param run - derived view.
 * @returns a short hint, or an empty string.
 */
export function planHint(run) {
  if (run.plan.total === 0) return '';
  if (run.running && run.plan.activeIndex === -1 && run.plan.nextIndex !== -1) {
    return 'The agent has not marked a step in progress yet — the first open step is shown.';
  }
  if (!run.running && run.status === 'done') return 'All steps are complete.';
  return '';
}
