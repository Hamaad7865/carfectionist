import { installStyles } from './css.js';
import { WorkButton, WorkDock, WorkPanel } from './ui.jsx';

/** This implementation's identity in the right-Sidebar tab system. */
const TAB_ID = '@local/worklog';

/** The page kind the tab type owns. */
const TAB_KIND = 'worklog';

/**
 * Open the Work tab in the right Sidebar, expanding the column first when it
 * is collapsed. The column mints each Session's surface only once its seat is
 * mounted, so the first open retries for a short window instead of assuming
 * the controller can already place a tab.
 * @param ctx - the plugin's client context.
 * @param sessionId - session whose Sidebar should show the panel.
 */
function openWork(ctx, sessionId) {
  const control = ctx.sidebarRight;
  const has = () => {
    try {
      return control.tabsIn(sessionId).some((tab) => tab.kind === TAB_KIND);
    } catch {
      return false;
    }
  };
  const place = () => {
    try {
      control.openTabIn(sessionId, TAB_KIND);
      return;
    } catch {
      /* fall through to the on-screen form */
    }
    try {
      control.openTab(TAB_KIND);
    } catch {
      /* no session surface yet; the retry loop covers it */
    }
  };
  if (has()) {
    place();
    return;
  }
  try {
    if (!control.isExpanded()) control.toggleExpanded();
  } catch {
    /* the column reports no expansion state before it mounts */
  }
  let frames = 0;
  const attempt = () => {
    place();
    if (has() || (frames += 1) > 45) return;
    requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}

/** Required services: slot seats, the right-Sidebar controller, and its type registry. */
export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs'];

/**
 * Client body: one page type in the right Sidebar, its body, a compact dock in
 * place of the shipped todo strip, and one header action to reach it.
 * @param ctx - client root context.
 */
export function apply(ctx) {
  installStyles();

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    priority: 'builtin',
    title: () => 'Work',
    guide: [{
      id: 'worklog',
      order: 25,
      title: () => 'Work',
      description: () => 'The live step, the activity behind it, changed files, and the commit.',
    }],
  }), 'worklog: sidebar tab type');

  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TAB_ID,
  }, WorkPanel));

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'todo',
    order: 0,
    inject: (sessionId) => ({ openWork: () => openWork(ctx, sessionId) }),
  }, WorkDock));

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'worklog',
    order: 40,
    inject: (sessionId) => ({ openWork: () => openWork(ctx, sessionId) }),
  }, WorkButton));
}
