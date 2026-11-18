/**
 * Fixture checks for the pure derivation. Run with `node scripts/test-run.mjs`.
 * No browser, no React: this is the part of the panel that must be right.
 */
import assert from 'node:assert/strict';
import { deriveRun, formatDuration, shortenPath, targetOf } from '../src/run.js';

const now = 1_760_000_000_000;

const todos = [
  { content: 'Read the purchase actions', status: 'completed' },
  { content: 'Add edit button to the row', status: 'completed' },
  { content: 'Wire the edit dialog', status: 'in_progress' },
  { content: 'Update the tests', status: 'pending' },
  { content: 'Deploy', status: 'pending' },
];

const chat = {
  legacy: {
    nodes: [
      { kind: 'user', seq: 1, time: now - 300_000, content: [] },
      {
        kind: 'assistant',
        seq: 2,
        time: now - 290_000,
        turn: 1,
        step: 1,
        blocks: [{ kind: 'reasoning', text: 'I should read the purchase page first.\n\nThen add the button.' }],
      },
      {
        kind: 'tool-result',
        seq: 3,
        time: now - 280_000,
        callTime: now - 281_000,
        callId: 'c1',
        isError: false,
        call: { name: 'read', argsRaw: JSON.stringify({ file_path: 'apps/web/src/features/purchases/actions.ts' }) },
        content: [{ type: 'text', text: 'ok' }],
      },
      {
        kind: 'tool-result',
        seq: 4,
        time: now - 200_000,
        callTime: now - 201_500,
        callId: 'c2',
        isError: false,
        call: { name: 'edit', argsRaw: JSON.stringify({ file_path: 'apps/web/src/features/purchases/actions.ts' }) },
        content: [{ type: 'text', text: 'ok' }],
      },
      {
        kind: 'tool-result',
        seq: 5,
        time: now - 190_000,
        callId: 'c3',
        isError: false,
        call: { name: 'write', argsRaw: JSON.stringify({ file_path: 'apps/web/src/features/purchases/ExpenseFields.tsx' }) },
        content: [{ type: 'text', text: 'ok' }],
      },
      {
        kind: 'tool-result',
        seq: 6,
        time: now - 120_000,
        callId: 'c4',
        isError: false,
        call: {
          name: 'pwsh',
          argsRaw: JSON.stringify({ command: 'git status --porcelain\ngit log --oneline -1' }),
        },
        content: [{
          type: 'text',
          text: ' M apps/web/src/features/purchases/page.tsx\n?? apps/web/src/features/purchases/ExpenseFields.tsx\n[main 2c8edac] Add edit button to purchases and expenses',
        }],
      },
    ],
    partial: {
      turn: 2,
      step: 3,
      blocks: [
        { kind: 'reasoning', text: 'The dialog needs the same fields as the create form, so I will reuse ExpenseFields.' },
        { kind: 'text', text: 'Wiring the dialog now' },
      ],
    },
    runningCalls: [{
      callId: 'c9',
      name: 'pwsh',
      argsRaw: JSON.stringify({ command: 'npm run test --workspace web' }),
      turn: 2,
      step: 3,
      time: now - 12_000,
    }],
  },
  timeline: {
    turnOrder: [1, 2],
    turns: new Map([
      [1, { turn: 1, start: { time: now - 320_000 }, end: { time: now - 60_000 } }],
      [2, { turn: 2, start: { time: now - 60_000 } }],
    ]),
  },
};

const run = deriveRun({ session: { running: true }, chat, todos, now });

assert.equal(run.status, 'working');
assert.equal(run.turn, 2);
assert.equal(run.step, 3);
assert.equal(run.plan.activeIndex, 2);
assert.equal(run.plan.doneCount, 2);
assert.equal(run.plan.pct, 40);
assert.equal(run.now.kind, 'tool');
assert.equal(run.now.label, 'Shell');
assert.equal(run.now.target, 'npm run test --workspace web');
assert.match(run.reasoning, /reuse ExpenseFields/);
assert.equal(run.activity[0].state, 'running');
assert.equal(run.changes.total, 3, `expected 3 changed files, got ${JSON.stringify(run.changes.files)}`);
assert.deepEqual(run.changes.files.map((file) => file.status).sort(), ['A', 'M', 'M']);
assert.equal(run.commit.hash, '2c8edac');
assert.equal(run.commit.branch, 'main');
assert.equal(run.commit.subject, 'Add edit button to purchases and expenses');
assert.equal(run.commit.pushed, false);
assert.equal(formatDuration(run.elapsedMs), '1m 00s');

assert.equal(shortenPath('apps/web/src/features/purchases/ExpenseFields.tsx', 30).includes('ExpenseFields.tsx'), true);
assert.equal(targetOf('grep', { pattern: 'edit', path: 'apps' }), 'edit');
assert.equal(targetOf('todo_write', { todos: [1, 2, 3] }), '3 items');

// Idle session with a finished plan.
const idle = deriveRun({
  session: { running: false },
  chat: { legacy: { nodes: [], partial: null, runningCalls: [] }, timeline: { turnOrder: [], turns: new Map() } },
  todos: todos.map((todo) => ({ ...todo, status: 'completed' })),
  now,
});
assert.equal(idle.status, 'done');
assert.equal(idle.plan.pct, 100);

// No plan at all: the dock hides, the panel still renders.
const empty = deriveRun({ session: { running: false }, chat: undefined, todos: null, now });
assert.equal(empty.plan.total, 0);
assert.equal(empty.now.kind, 'idle');

// Personal access token style commit line.
const logRun = deriveRun({
  session: { running: false },
  chat: {
    legacy: {
      nodes: [{
        kind: 'tool-result',
        seq: 9,
        time: now,
        callId: 'x',
        call: { name: 'bash', argsRaw: JSON.stringify({ command: 'git log -1 --format="%H %s"' }) },
        content: [{ type: 'text', text: 'abcdef1234567890 Add the tests' }],
      }],
      partial: null,
      runningCalls: [],
    },
    timeline: { turnOrder: [], turns: new Map() },
  },
  todos: [],
  now,
});
assert.equal(logRun.commit.hash, 'abcdef1234567890');
assert.equal(logRun.commit.subject, 'Add the tests');

console.log('run.js: all assertions passed');
