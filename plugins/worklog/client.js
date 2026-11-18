window.__ModuleLoader__.load({
  id: '@local/worklog',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/entry.jsx
var entry_exports = {};
__export(entry_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(entry_exports);

// src/css.js
var CSS = `
.wl-root{
  --wl-fg: var(--dsw-alias-label-primary, #e9e9ec);
  --wl-2: var(--dsw-alias-label-secondary, #a2a3a8);
  --wl-3: var(--dsw-alias-label-tertiary, #74767d);
  --wl-line: var(--dsw-alias-border-l2, rgba(255,255,255,.075));
  --wl-line-strong: var(--dsw-alias-border-l3, rgba(255,255,255,.14));
  --wl-card: var(--dsw-alias-bg-l1, rgba(255,255,255,.032));
  --wl-card-2: var(--dsw-alias-bg-l2, rgba(255,255,255,.055));
  --wl-blue: var(--dsw-alias-state-business-primary, #5b7cfa);
  --wl-green: var(--dsw-alias-state-success-primary, #46c08a);
  --wl-red: var(--dsw-alias-state-error-primary, #f06a63);
  --wl-amber: var(--dsw-alias-state-warning-primary, #e0a33e);
  --wl-mono: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  color: var(--wl-fg);
  font-size: 13px;
  line-height: 20px;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: transparent;
  -webkit-font-smoothing: antialiased;
}
.wl-root *{box-sizing:border-box}
.wl-inline{height:auto;overflow:visible;display:block;font-size:12px}
.wl-scroll{overflow-y:auto;overflow-x:hidden;flex:1;min-height:0;padding:18px 16px 32px;scrollbar-gutter:stable}
.wl-scroll::-webkit-scrollbar{width:9px}
.wl-scroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2, rgba(255,255,255,.10));border-radius:9px;border:2px solid transparent;background-clip:padding-box}
.wl-scroll::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2, rgba(255,255,255,.18));background-clip:padding-box}

/* Header ---------------------------------------------------------------- */
.wl-head{display:flex;align-items:center;gap:10px;min-width:0}
.wl-status{display:inline-flex;align-items:center;gap:7px;height:24px;padding:0 10px 0 8px;border-radius:999px;border:1px solid var(--wl-line);color:var(--wl-2);font-size:11.5px;font-weight:500;letter-spacing:.01em;white-space:nowrap;flex:none;background:var(--wl-card)}
.wl-status[data-tone=working]{color:var(--wl-fg);border-color:color-mix(in srgb,var(--wl-blue) 34%,transparent);background:color-mix(in srgb,var(--wl-blue) 10%,transparent)}
.wl-status[data-tone=done]{color:color-mix(in srgb,var(--wl-green) 80%,var(--wl-fg));border-color:color-mix(in srgb,var(--wl-green) 30%,transparent);background:color-mix(in srgb,var(--wl-green) 8%,transparent)}
.wl-dot{width:6px;height:6px;border-radius:999px;background:currentColor;flex:none;display:inline-block}
.wl-dot[data-live]{background:var(--wl-blue);animation:wl-pulse 2s cubic-bezier(.4,0,.2,1) infinite}
.wl-head-meta{margin-left:auto;display:flex;align-items:center;gap:7px;color:var(--wl-3);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap;min-width:0;overflow:hidden}
.wl-head-meta b{font-weight:500;color:var(--wl-2)}
.wl-workspace{display:flex;align-items:baseline;gap:8px;margin-top:10px;min-width:0}
.wl-workspace-name{font-size:14px;line-height:20px;font-weight:550;letter-spacing:-.01em;color:var(--wl-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wl-workspace-sub{font-size:11px;color:var(--wl-3);font-variant-numeric:tabular-nums;white-space:nowrap;flex:none}
.wl-progress{height:2px;border-radius:2px;background:var(--wl-card-2);margin:14px 0 0;overflow:hidden}
.wl-progress>i{display:block;height:100%;border-radius:2px;background:var(--wl-blue);transition:width .5s cubic-bezier(.22,.61,.36,1)}

/* Section --------------------------------------------------------------- */
.wl-section{margin-top:28px}
.wl-section-head{display:flex;align-items:baseline;gap:8px;margin-bottom:10px;position:relative}
.wl-section-head::after{content:"";position:absolute;left:0;right:0;bottom:-6px;height:1px;background:linear-gradient(90deg, var(--wl-line-strong), transparent 82%)}
.wl-section-title{font-size:12px;font-weight:600;letter-spacing:.01em;color:var(--wl-fg)}
.wl-section-meta{margin-left:auto;color:var(--wl-3);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
.wl-section-meta b{color:var(--wl-2);font-weight:500}

/* Now ------------------------------------------------------------------ */
.wl-now{border-radius:12px;padding:12px 13px;background:color-mix(in srgb, var(--wl-card-2) 62%, transparent);transition:background .18s ease}
.wl-now[data-kind=tool]{background:color-mix(in srgb, var(--wl-blue) 7%, var(--wl-card))}
.wl-now-row{display:flex;align-items:center;gap:9px;min-width:0}
.wl-now-glyph{width:7px;height:7px;flex:none;border-radius:999px;background:var(--wl-3)}
.wl-now-glyph[data-live]{background:var(--wl-blue);animation:wl-pulse 2s cubic-bezier(.4,0,.2,1) infinite}
.wl-now-tool{font-size:10.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--wl-3);flex:none}
.wl-now[data-kind=tool] .wl-now-tool{color:color-mix(in srgb,var(--wl-blue) 82%,var(--wl-fg))}
.wl-now-target{font-family:var(--wl-mono);font-size:11.5px;color:var(--wl-2);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.wl-now[data-kind=tool] .wl-now-target{color:var(--wl-fg)}
.wl-now-time{font-size:10.5px;color:var(--wl-3);font-variant-numeric:tabular-nums;flex:none;letter-spacing:.02em}
.wl-now-body{margin-top:9px;color:var(--wl-2);font-size:12.5px;line-height:19.5px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.wl-now[data-kind=idle] .wl-now-body{margin-top:4px;color:var(--wl-3);font-size:11.5px}
.wl-thinking{display:inline-flex;align-items:center;gap:4px;margin-top:10px;height:8px}
.wl-thinking i{width:4px;height:4px;border-radius:999px;background:var(--wl-amber);opacity:.3;animation:wl-think 1.3s cubic-bezier(.4,0,.2,1) infinite}
.wl-thinking i:nth-child(2){animation-delay:.16s}
.wl-thinking i:nth-child(3){animation-delay:.32s}

/* Plan ------------------------------------------------------------------ */
.wl-plan{list-style:none;margin:0;padding:0}
.wl-step{display:flex;gap:11px;padding:7px 0 7px 1px;min-width:0;position:relative}
.wl-step-mark{width:14px;height:14px;margin-top:4px;flex:none;display:grid;place-items:center;position:relative;z-index:1;background:var(--dsw-alias-bg-base, transparent);border-radius:999px}
.wl-step-mark i{width:7px;height:7px;border-radius:999px;border:1.5px solid var(--wl-line-strong);background:transparent;display:block;transition:border-color .2s,background .2s}
.wl-step::before{content:"";position:absolute;left:7px;top:0;bottom:0;width:1px;background:var(--wl-line)}
.wl-step:first-child::before{top:11px}
.wl-step:last-child::before{bottom:calc(100% - 11px)}
.wl-step-text{min-width:0;flex:1;display:flex;align-items:baseline;gap:8px}
.wl-step-title{color:var(--wl-2);font-size:12.5px;line-height:19px;word-break:break-word;flex:1;min-width:0}
.wl-step[data-status=completed] .wl-step-title{color:var(--wl-3)}
.wl-step[data-status=in_progress] .wl-step-title{color:var(--wl-fg);font-weight:500}
.wl-step[data-status=in_progress] .wl-step-mark i{background:var(--wl-blue);border-color:var(--wl-blue);box-shadow:0 0 0 3px color-mix(in srgb,var(--wl-blue) 16%,transparent)}
.wl-step[data-next] .wl-step-mark i{border-style:dashed}
.wl-step-state{flex:none;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--wl-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.wl-step[data-status=in_progress] .wl-step-state{color:color-mix(in srgb,var(--wl-blue) 80%,var(--wl-fg))}
.wl-bar{height:2px;border-radius:2px;background:var(--wl-card-2);overflow:hidden;margin:12px 0 0}
.wl-bar>i{display:block;height:100%;border-radius:2px;background:linear-gradient(90deg,var(--wl-blue),color-mix(in srgb,var(--wl-blue) 55%, var(--wl-green)));transition:width .5s cubic-bezier(.22,.61,.36,1)}
.wl-hint{margin-top:10px;color:var(--wl-3);font-size:11px;line-height:16px}

/* Tabs / controls ------------------------------------------------------- */
.wl-tabs{display:flex;gap:18px;margin:0 0 2px;border-bottom:1px solid var(--wl-line)}
.wl-tabs button{position:relative;height:30px;padding:0;border:none;background:transparent;color:var(--wl-3);font:inherit;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:color .15s ease}
.wl-tabs button:hover{color:var(--wl-2)}
.wl-tabs button[data-active]{color:var(--wl-fg);font-weight:550}
.wl-tabs button[data-active]::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:1.5px;border-radius:2px;background:var(--wl-fg)}
.wl-tab-count{font-size:10.5px;color:var(--wl-3);font-variant-numeric:tabular-nums}
.wl-tabs button[data-active] .wl-tab-count{color:var(--wl-2)}
.wl-refresh{margin-left:auto;flex:none;width:24px;height:24px;border-radius:7px;border:1px solid transparent;background:transparent;color:var(--wl-3);cursor:pointer;display:grid;place-items:center;padding:0;transition:color .15s ease,background .15s ease}
.wl-refresh:hover{color:var(--wl-fg);background:var(--wl-card);border-color:var(--wl-line)}

/* Commit graph ---------------------------------------------------------- */
.wl-graph{list-style:none;margin:4px 0 0;padding:2px 0;max-height:264px;overflow-y:auto;border-radius:9px;background:color-mix(in srgb,var(--wl-card) 45%,transparent)}
.wl-graph::-webkit-scrollbar{width:8px}
.wl-graph::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:8px;border:2px solid transparent;background-clip:padding-box}
.wl-graph-lane{height:12px;line-height:12px;display:flex;align-items:center;padding:0 6px}
.wl-graph-row{display:flex;align-items:center;gap:9px;width:100%;min-width:0;height:26px;padding:0 6px;border:none;border-radius:7px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background .14s ease}
.wl-graph-row:hover{background:var(--wl-card)}
.wl-graph-row[data-active]{background:color-mix(in srgb,var(--wl-blue) 11%,transparent)}
.wl-graph-art{font-family:var(--wl-mono);font-size:11.5px;line-height:13px;white-space:pre;flex:none;max-width:96px;overflow:hidden;color:var(--wl-3)}
.wl-lane{color:color-mix(in srgb,var(--wl-3) 55%,transparent)}
.wl-lane-mark{color:color-mix(in srgb,var(--wl-3) 90%,var(--wl-2))}
.wl-graph-row[data-active] .wl-lane-mark{color:var(--wl-blue)}
.wl-graph-row[data-active] .wl-lane{color:color-mix(in srgb,var(--wl-blue) 38%,transparent)}
.wl-graph-hash{font-family:var(--wl-mono);font-size:11px;color:var(--wl-3);flex:none;letter-spacing:.01em}
.wl-graph-row[data-active] .wl-graph-hash{color:var(--wl-2)}
.wl-graph-subject{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--wl-2)}
.wl-graph-row[data-active] .wl-graph-subject{color:var(--wl-fg)}
.wl-graph-refs{display:inline-flex;gap:4px;flex:none;max-width:120px;overflow:hidden}
.wl-ref{font-size:9.5px;line-height:16px;padding:0 6px;border-radius:999px;background:color-mix(in srgb,var(--wl-blue) 13%,transparent);color:color-mix(in srgb,var(--wl-blue) 72%,var(--wl-fg));white-space:nowrap;max-width:78px;overflow:hidden;text-overflow:ellipsis}
.wl-graph-age{font-size:10.5px;color:var(--wl-3);flex:none;white-space:nowrap;font-variant-numeric:tabular-nums;width:44px;text-align:right}
.wl-commit-meta{display:flex;align-items:center;gap:8px;margin:14px 0 8px;color:var(--wl-3);font-size:11px;font-variant-numeric:tabular-nums;min-width:0}
.wl-commit-meta b{font-weight:500;color:var(--wl-2)}

/* File tree ------------------------------------------------------------- */
.wl-tree{list-style:none;margin:0;padding:0}
.wl-folder{display:flex;align-items:center;gap:6px;width:100%;min-width:0;height:24px;padding:0 6px;border:none;border-radius:7px;background:transparent;color:var(--wl-3);font:inherit;text-align:left;cursor:pointer;transition:color .14s ease,background .14s ease}
.wl-folder:hover{color:var(--wl-2);background:var(--wl-card)}
.wl-folder-name{font-size:12px;color:inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;letter-spacing:.005em}
.wl-file{display:block;min-width:0}
.wl-file-row{display:flex;align-items:center;gap:8px;width:100%;min-width:0;height:24px;padding:0 6px;border:none;border-radius:7px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background .14s ease}
.wl-file-row:hover{background:var(--wl-card)}
.wl-file[data-open] .wl-file-row{background:var(--wl-card)}
.wl-file-static{cursor:default}
.wl-badge{flex:none;width:9px;text-align:center;font-family:var(--wl-mono);font-size:9px;font-weight:700;letter-spacing:.02em}
.wl-badge[data-s=A]{color:var(--wl-green)}
.wl-badge[data-s=M]{color:var(--wl-amber)}
.wl-badge[data-s=D]{color:var(--wl-red)}
.wl-badge[data-s=R]{color:var(--wl-blue)}
.wl-file-path{font-family:var(--wl-mono);font-size:11.5px;color:var(--wl-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;direction:ltr}
.wl-file[data-open] .wl-file-path{color:var(--wl-fg)}
.wl-file-count{font-size:10.5px;color:var(--wl-3);flex:none;font-variant-numeric:tabular-nums;white-space:nowrap;letter-spacing:.01em}
.wl-add{color:color-mix(in srgb,var(--wl-green) 78%,var(--wl-fg))}
.wl-del{color:color-mix(in srgb,var(--wl-red) 78%,var(--wl-fg))}
.wl-chevron{flex:none;color:var(--wl-3);transition:transform .18s cubic-bezier(.22,.61,.36,1)}
.wl-chevron[data-open]{transform:rotate(180deg)}
.wl-empty{border:1px dashed var(--wl-line);border-radius:10px;padding:12px 13px;color:var(--wl-3);font-size:11.5px;line-height:17px}

/* Comparison ------------------------------------------------------------ */
.wl-diff-wrap{margin:2px 0 6px}
.wl-diff{border-radius:9px;background:color-mix(in srgb,var(--wl-card) 70%,transparent);overflow:hidden;max-height:320px;overflow-y:auto;overflow-x:auto}
.wl-diff-note{padding:9px 12px;color:var(--wl-3);font-size:11px}
.wl-hunk{overflow-x:auto}
.wl-hunk-head{font-family:var(--wl-mono);font-size:10.5px;color:var(--wl-3);padding:5px 10px;background:color-mix(in srgb,var(--wl-card-2) 70%,transparent)}
.wl-line{font-family:var(--wl-mono);font-size:10.5px;line-height:16px;white-space:pre;padding:0 10px;color:var(--wl-2);min-width:max-content}
.wl-line-add{background:color-mix(in srgb,var(--wl-green) 10%,transparent);color:color-mix(in srgb,var(--wl-green) 68%,var(--wl-fg))}
.wl-line-del{background:color-mix(in srgb,var(--wl-red) 10%,transparent);color:color-mix(in srgb,var(--wl-red) 68%,var(--wl-fg))}
.wl-diff-total{margin-top:8px;font-size:10.5px;color:var(--wl-3);font-variant-numeric:tabular-nums}

/* Footer ---------------------------------------------------------------- */
.wl-foot{margin-top:30px;display:flex;align-items:center;gap:7px;color:var(--wl-3);font-size:10.5px;letter-spacing:.02em}
.wl-foot .wl-dot{width:5px;height:5px}

/* Dock (composer strip) -------------------------------------------------- */
.wl-dock{
  width:calc(100% - 8px);
  max-width:var(--dsh-composer-card-max-width, 100%);
  margin:0 auto 7px;
  display:flex;align-items:center;gap:10px;
  height:34px;padding:0 6px 0 11px;border-radius:11px;
  border:1px solid var(--wl-line);
  background:color-mix(in srgb, var(--wl-card-2) 70%, transparent);
  backdrop-filter:blur(8px);
  color:var(--wl-fg);font-size:12px;
  transition:border-color .18s, background .18s;
}
.wl-dock:hover{border-color:var(--wl-line-strong);background:var(--wl-card-2)}
.wl-dock[data-status=working]{border-color:color-mix(in srgb,var(--wl-blue) 32%, transparent)}
.wl-dock-status{display:inline-flex;align-items:center;gap:6px;flex:none;color:var(--wl-2);font-size:11px;letter-spacing:.02em}
.wl-dock[data-status=working] .wl-dock-status{color:var(--wl-fg)}
.wl-dock-current{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--wl-2);font-size:12px}
.wl-dock-current b{color:var(--wl-fg);font-weight:500}
.wl-dock-progress{display:flex;align-items:center;gap:7px;flex:none}
.wl-dock-bar{width:54px;height:2px;border-radius:2px;background:var(--wl-card-2);overflow:hidden}
.wl-dock-bar>i{display:block;height:100%;background:var(--wl-blue);border-radius:2px;transition:width .4s ease}
.wl-dock-count{font-size:10.5px;color:var(--wl-3);font-variant-numeric:tabular-nums;letter-spacing:.02em}
.wl-dock-open{flex:none;height:24px;padding:0 9px;border-radius:7px;border:1px solid var(--wl-line);background:transparent;color:var(--wl-2);font-size:11px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;font-family:inherit}
.wl-dock-open:hover{color:var(--wl-fg);border-color:var(--wl-line-strong);background:var(--wl-card)}
.wl-dock-open svg{opacity:.8}

/* Header button ---------------------------------------------------------- */
.wl-hbtn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 9px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#a2a3a8);font-size:12px;font-family:inherit;cursor:pointer;white-space:nowrap}
.wl-hbtn:hover{color:var(--dsw-alias-label-primary,#e9e9ec);background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.wl-hbtn svg{opacity:.85}

@keyframes wl-pulse{0%,100%{opacity:1}50%{opacity:.38}}
@keyframes wl-think{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:1;transform:translateY(-1px)}}
@media (prefers-reduced-motion: reduce){.wl-dot[data-live],.wl-now-glyph[data-live],.wl-thinking i{animation:none}}
`;
var TAG_ID = "@local/worklog/styles";
function installStyles() {
  if (typeof document === "undefined") return;
  let tag = document.querySelector(`style[data-plugin-css="${TAG_ID}"]`);
  if (tag === null) {
    tag = document.createElement("style");
    tag.dataset.plugin = "@local/worklog";
    tag.dataset.pluginCss = TAG_ID;
    document.head.appendChild(tag);
  }
  if (tag.textContent !== CSS) tag.textContent = CSS;
}

// src/ui.jsx
var import_react = require("react");

// src/run.js
var TOOL_LABELS = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  str_replace_editor: "Edit",
  grep: "Search",
  glob: "Find",
  pwsh: "Shell",
  powershell: "Shell",
  bash: "Shell",
  shell: "Shell",
  terminal: "Terminal",
  todo_write: "Plan",
  web_search: "Web search",
  web_fetch: "Fetch",
  skill: "Skill",
  subagent: "Subagent",
  subagent_control: "Subagent",
  subagent_report: "Subagent",
  workflow: "Workflow",
  present: "Present",
  ask_user_question: "Question",
  jobs: "Job",
  job_output: "Job",
  job_kill: "Job",
  load_workspace_dependencies: "Workspace",
  create_goal: "Goal",
  get_goal: "Goal",
  update_goal: "Goal",
  schedule_create: "Schedule",
  schedule_list: "Schedule",
  schedule_update: "Schedule",
  schedule_delete: "Schedule",
  read_image: "Image"
};
var FILE_WRITE_TOOLS = /* @__PURE__ */ new Set(["write", "edit", "str_replace_editor"]);
var SHELL_TOOLS = /* @__PURE__ */ new Set(["pwsh", "powershell", "bash", "shell", "terminal"]);
function parseArgs(raw) {
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const value = JSON.parse(raw);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
function pathOf(args) {
  for (const key of ["file_path", "filePath", "path", "target_file", "notebook_path"]) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return void 0;
}
function targetOf(name, args) {
  if (Object.hasOwn(args, "todos") && Array.isArray(args.todos)) {
    return `${args.todos.length} ${args.todos.length === 1 ? "item" : "items"}`;
  }
  if (SHELL_TOOLS.has(name)) {
    const command = typeof args.command === "string" ? args.command : typeof args.cmd === "string" ? args.cmd : "";
    return firstLine(command);
  }
  if (name === "grep" || name === "glob") {
    const pattern = typeof args.pattern === "string" ? args.pattern : typeof args.query === "string" ? args.query : "";
    if (pattern.trim().length > 0) return firstLine(pattern);
  }
  if (name === "web_search" && typeof args.query === "string") return firstLine(args.query);
  if (name === "web_fetch" && typeof args.url === "string") return args.url;
  const path = pathOf(args);
  if (path !== void 0) return path;
  for (const key of ["pattern", "query", "url", "description", "prompt", "goal", "content"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim().length > 0) return firstLine(value);
  }
  return "";
}
function firstLine(text, max = 140) {
  const line = String(text).split(/\r?\n/).map((part) => part.trim()).find((part) => part.length > 0) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}\u2026` : line;
}
function toolLabel(name) {
  return TOOL_LABELS[name] ?? String(name).replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
function textOf(node) {
  const blocks = Array.isArray(node?.content) ? node.content : [];
  const parts = [];
  for (const block of blocks) {
    if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}
function reasoningExcerpt(chat) {
  const partial = chat?.legacy?.partial ?? null;
  const blocks = Array.isArray(partial?.blocks) ? partial.blocks : [];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.kind === "reasoning" && typeof block.text === "string" && block.text.trim().length > 0) {
      return tail(block.text);
    }
  }
  const nodes = chat?.legacy?.nodes ?? [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.kind !== "assistant") continue;
    const assistantBlocks = Array.isArray(node.blocks) ? node.blocks : [];
    for (let inner = assistantBlocks.length - 1; inner >= 0; inner -= 1) {
      const block = assistantBlocks[inner];
      if (block?.kind === "reasoning" && typeof block.text === "string" && block.text.trim().length > 0) {
        return tail(block.text);
      }
    }
  }
  return "";
}
function partialText(chat) {
  const blocks = chat?.legacy?.partial?.blocks ?? [];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.kind === "text" && typeof block.text === "string" && block.text.trim().length > 0) {
      return tail(block.text);
    }
  }
  return "";
}
function tail(text, max = 240) {
  const paragraphs = String(text).trim().split(/\n{2,}/);
  const last = paragraphs[paragraphs.length - 1] ?? "";
  const flat = last.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(flat.length - max);
  const boundary = cut.indexOf(" ");
  return `\u2026${boundary > 0 ? cut.slice(boundary + 1) : cut}`;
}
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const total = Math.floor(ms / 1e3);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}
function clock(time) {
  if (!Number.isFinite(time)) return "";
  const date = new Date(time);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
function shortenPath(path, max = 42) {
  const value = String(path).replace(/\\/g, "/");
  if (value.length <= max) return value;
  const parts = value.split("/").filter((part) => part.length > 0);
  const name = parts[parts.length - 1] ?? value;
  const parent = parts[parts.length - 2] ?? "";
  const tail2 = parent.length > 0 ? `${parent}/${name}` : name;
  if (tail2.length + 2 <= max) return `\u2026/${tail2}`;
  return `\u2026${name.slice(-(max - 1))}`;
}
function deriveRun(input) {
  const now = input.now ?? Date.now();
  const session = input.session ?? void 0;
  const chat = input.chat ?? void 0;
  const todos = Array.isArray(input.todos) ? input.todos : [];
  const running = session?.running === true;
  const nodes = chat?.legacy?.nodes ?? [];
  const runningCalls = chat?.legacy?.runningCalls ?? [];
  const partial = chat?.legacy?.partial ?? null;
  const timeline = chat?.timeline;
  const activeCall = runningCalls.length > 0 ? runningCalls[runningCalls.length - 1] : void 0;
  const turn = partial?.turn ?? activeCall?.turn ?? lastTurn(timeline) ?? 1;
  const step = partial?.step ?? activeCall?.step ?? 0;
  const items = todos.map((item, index) => ({
    index,
    content: typeof item?.content === "string" ? item.content : String(item?.content ?? ""),
    status: item?.status === "completed" || item?.status === "in_progress" ? item.status : "pending"
  }));
  const doneCount = items.filter((item) => item.status === "completed").length;
  const activeIndex = items.findIndex((item) => item.status === "in_progress");
  const nextIndex = activeIndex === -1 ? items.findIndex((item) => item.status === "pending") : -1;
  const located = activeIndex !== -1 ? activeIndex : nextIndex;
  const turnStart = timeline?.turns?.get?.(turn)?.start?.time;
  const turnEnd = timeline?.turns?.get?.(turn)?.end?.time;
  const elapsedMs = turnStart === void 0 ? 0 : Math.max(0, (turnEnd ?? (running ? now : turnStart)) - turnStart);
  const activity = recentActivity(nodes, runningCalls, now);
  const changes = collectChanges(nodes);
  const commit = collectCommit(nodes);
  const lastEvent = nodes.length > 0 ? nodes[nodes.length - 1].time : void 0;
  const current = describeNow({ running, activeCall, partial, chat, activity, startedAt: turnStart ?? lastEvent, now });
  const reasoning = reasoningExcerpt(chat);
  return {
    running,
    status: running ? "working" : items.length > 0 && doneCount === items.length ? "done" : items.length > 0 ? "paused" : "idle",
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
      pct: items.length === 0 ? 0 : Math.round(doneCount / items.length * 100),
      updatedAt: input.planUpdatedAt ?? 0
    },
    now: current,
    reasoning,
    activity,
    calls: nodes.filter((node) => node.kind === "tool-result").length + runningCalls.length,
    changes,
    commit
  };
}
function lastTurn(timeline) {
  const order = timeline?.turnOrder;
  if (!Array.isArray(order) || order.length === 0) return void 0;
  return order[order.length - 1];
}
function describeNow({ running, activeCall, partial, chat, activity, startedAt, now }) {
  if (!running) {
    const last = activity.find((entry) => entry.state !== "running");
    if (last !== void 0) {
      return { kind: "idle", label: "Idle", target: "", detail: `Last ${last.label.toLowerCase()} at ${clock(last.at)}`, since: last.at };
    }
    return { kind: "idle", label: "Idle", target: "", detail: "", since: startedAt ?? now };
  }
  if (activeCall !== void 0) {
    const args = parseArgs(activeCall.argsRaw);
    return {
      kind: "tool",
      label: toolLabel(activeCall.name),
      target: targetOf(activeCall.name, args),
      detail: "",
      since: activeCall.time
    };
  }
  const prose = partialText(chat);
  if (prose.length > 0) {
    return { kind: "writing", label: "Writing", target: "", detail: prose, since: startedAt ?? now };
  }
  if (partial !== null) {
    return { kind: "thinking", label: "Thinking", target: "", detail: "", since: startedAt ?? now };
  }
  return { kind: "waiting", label: "Waiting for the model", target: "", detail: "", since: startedAt ?? now };
}
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
      state: "running",
      at: call.time,
      ms: Math.max(0, now - (call.time ?? now))
    });
  }
  const settled = nodes.filter((node) => node.kind === "tool-result").slice(-8).reverse();
  for (const node of settled) {
    const name = node.call?.name ?? "tool";
    const args = parseArgs(node.call?.argsRaw ?? "");
    rows.push({
      key: `done:${node.seq}:${node.callId}`,
      callId: node.callId,
      name,
      label: toolLabel(name),
      target: targetOf(name, args),
      state: node.isError === true ? "error" : "ok",
      at: node.time,
      ms: typeof node.callTime === "number" && typeof node.time === "number" ? Math.max(0, node.time - node.callTime) : void 0
    });
    if (rows.length >= 8) break;
  }
  return rows.slice(0, 6);
}
function collectChanges(nodes) {
  const files = /* @__PURE__ */ new Map();
  let source = "tools";
  for (const node of nodes) {
    if (node.kind !== "tool-result") continue;
    const name = node.call?.name;
    if (!FILE_WRITE_TOOLS.has(name)) continue;
    const args = parseArgs(node.call?.argsRaw ?? "");
    const path = pathOf(args);
    if (path === void 0) continue;
    const previous = files.get(path);
    if (previous === void 0) {
      files.set(path, { path, status: name === "write" ? "A" : "M", edits: 1 });
    } else {
      previous.edits += 1;
      if (previous.status === "A" && name !== "write") previous.status = "M";
    }
  }
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.kind !== "tool-result" || !SHELL_TOOLS.has(node.call?.name ?? "")) continue;
    const args = parseArgs(node.call?.argsRaw ?? "");
    const command = typeof args.command === "string" ? args.command : "";
    if (!/\bgit\s+(status|diff|show)\b/.test(command)) continue;
    const parsed = parsePorcelain(textOf(node));
    if (parsed.length === 0) continue;
    source = "git";
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
    added: list.filter((file) => file.status === "A").length,
    deleted: list.filter((file) => file.status === "D").length,
    source
  };
}
function parsePorcelain(text) {
  const entries = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const match = /^([ MADRCU?!]{1,2})\s+(.+)$/.exec(raw);
    if (match === null) continue;
    const code = match[1].trim();
    let path = match[2].trim();
    if (path.includes(" -> ")) path = path.split(" -> ").pop() ?? path;
    path = path.replace(/^"|"$/g, "");
    if (path.length === 0 || path.startsWith("no changes")) continue;
    const status = code.includes("?") ? "A" : code.includes("D") ? "D" : code.includes("A") ? "A" : code === "M" || code === "MM" ? "M" : "M";
    entries.push({ path, status });
  }
  return entries;
}
function collectCommit(nodes) {
  let commit;
  let pushed = false;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.kind !== "tool-result" || !SHELL_TOOLS.has(node.call?.name ?? "")) continue;
    const args = parseArgs(node.call?.argsRaw ?? "");
    const command = typeof args.command === "string" ? args.command : "";
    const text = textOf(node);
    if (!/\bgit\b/.test(command)) continue;
    if (commit === void 0) commit = parseCommit(text, node.time);
    if (/\bgit\s+push\b/.test(command) && /->|Everything up-to-date|To (?:github|gitlab|ssh|https)/.test(text)) pushed = true;
    if (commit !== void 0 && /\bgit\s+push\b/.test(command)) break;
  }
  if (commit === void 0) return null;
  return { ...commit, pushed };
}
function parseCommit(text, at) {
  const value = String(text);
  let match = /^\s*\[([^\]\s]+)\s+([0-9a-f]{7,40})\]\s+(.+)$/m.exec(value);
  if (match !== null) return { hash: match[2], subject: match[3].trim(), branch: match[1].replace(/^\(|\)$/g, ""), at };
  match = /^commit ([0-9a-f]{40})$/m.exec(value);
  if (match !== null) {
    const after = value.slice(match.index + match[0].length).split(/\r?\n/).map((line) => line.trim());
    const subject = after.find((line) => line.length > 0 && !/^Author:|^Date:|^Merge:/.test(line));
    return { hash: match[1], subject: subject ?? "", branch: "", at };
  }
  match = /^([0-9a-f]{7,40})\s+(.+)$/m.exec(value);
  if (match !== null) return { hash: match[1], subject: match[2].trim(), branch: "", at };
  match = /HEAD is now at ([0-9a-f]{7,40})\s*(.*)$/m.exec(value);
  if (match !== null) return { hash: match[1], subject: match[2].trim(), branch: "", at };
  return void 0;
}
function planHint(run) {
  if (run.plan.total === 0) return "";
  if (run.running && run.plan.activeIndex === -1 && run.plan.nextIndex !== -1) {
    return "The agent has not marked a step in progress yet \u2014 the first open step is shown.";
  }
  if (!run.running && run.status === "done") return "All steps are complete.";
  return "";
}

// src/git.js
var BASE = "api/worklog";
async function read(route, params, signal) {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${BASE}.${route}?${query}`, {
    signal,
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
function fetchOverview(cwd, signal) {
  return read("overview", { cwd }, signal);
}
function fetchCommit(cwd, hash, signal) {
  return read("commit", { cwd, hash }, signal);
}
function fetchDiff(cwd, input, signal) {
  return read("diff", {
    cwd,
    scope: input.scope,
    hash: input.scope === "commit" ? input.hash ?? "" : "",
    path: input.path
  }, signal);
}
function fetchGraph(cwd, limit, signal) {
  return read("graph", { cwd, limit: String(limit) }, signal);
}
function relativeAge(time) {
  if (!Number.isFinite(time) || time <= 0) return "";
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1e3));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.round(months / 12)}y ago`;
}

// src/ui.jsx
var import_jsx_runtime = require("react/jsx-runtime");
function useTick(active) {
  const [now, setNow] = (0, import_react.useState)(() => Date.now());
  (0, import_react.useEffect)(() => {
    if (!active) {
      setNow(Date.now());
      return void 0;
    }
    const handle = setInterval(() => setNow(Date.now()), 1e3);
    return () => clearInterval(handle);
  }, [active]);
  return now;
}
function useWorkspaceLabel(useSessions, sessionId) {
  return useSessions((sessions) => {
    const row = sessions?.byId?.[sessionId];
    const cwd = typeof row?.cwd === "string" ? row.cwd : "";
    return cwd.length === 0 ? "" : cwd.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
  });
}
function useWorkingDirectory(useSessions, sessionId) {
  return useSessions((sessions) => {
    const cwd = sessions?.byId?.[sessionId]?.cwd;
    return typeof cwd === "string" ? cwd : "";
  });
}
function usePlan(useProjection) {
  const projection = useProjection("todos");
  const cache = (0, import_react.useRef)({ list: null, at: 0 });
  if (Array.isArray(projection)) {
    if (projection.length === 0) cache.current = { list: null, at: 0 };
    else if (cache.current.list !== projection) cache.current = { list: projection, at: Date.now() };
  }
  const live = Array.isArray(projection) && projection.length > 0 ? projection : null;
  return { todos: live ?? cache.current.list, updatedAt: cache.current.at };
}
function ThinkingDots() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "wl-thinking", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {})
  ] });
}
function IconList(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { viewBox: "0 0 16 16", width: props.size ?? 14, height: props.size ?? 14, fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M2.5 4.5l1.2 1.2L6 3.4M2.5 10.5l1.2 1.2L6 9.4M8.5 4.5h5M8.5 10.5h5", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" }) });
}
function IconOpen(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { viewBox: "0 0 16 16", width: props.size ?? 12, height: props.size ?? 12, fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6 3.5H3.5v9h9V10M9 3.5h3.5V7M12.5 3.5L7 9", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" }) });
}
function IconRefresh(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { viewBox: "0 0 16 16", width: props.size ?? 12, height: props.size ?? 12, fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M13 8a5 5 0 1 1-1.7-3.8M13 3v3.2h-3.2", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" }) });
}
function IconChevron(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { viewBox: "0 0 16 16", width: props.size ?? 12, height: props.size ?? 12, fill: "none", "aria-hidden": "true", className: "wl-chevron", "data-open": props.open || void 0, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4.5 6.5L8 10l3.5-3.5", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" }) });
}
function statusView(run) {
  if (run.running) return { tone: "working", label: "Working" };
  if (run.status === "done") return { tone: "done", label: "Complete" };
  if (run.plan.total > 0) return { tone: "paused", label: "Paused" };
  return { tone: "idle", label: "Idle" };
}
function PlanRow({ item, active, next }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { className: "wl-step", "data-status": item.status, "data-next": next || void 0, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-step-mark", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wl-step-text", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-step-title", children: item.content }),
      active ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-step-state", children: "in progress" }) : next ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-step-state", children: "next" }) : null
    ] })
  ] });
}
function FileCounts({ file }) {
  if (file.binary) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-file-count", children: "binary" });
  if (file.untracked) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-file-count", children: "new" });
  if ((file.added ?? 0) + (file.deleted ?? 0) === 0) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "wl-file-count", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-add", children: `+${file.added ?? 0}` }),
    "  ",
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-del", children: `\u2212${file.deleted ?? 0}` })
  ] });
}
function FileRow({ file, name, depth, open, onToggle, diff }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { className: "wl-file", "data-open": open || void 0, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        className: "wl-file-row",
        style: { paddingLeft: 6 + depth * 10 },
        "aria-expanded": open,
        onClick: onToggle,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-badge", "data-s": file.status, "aria-hidden": "true", children: file.status }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-file-path", title: file.path, children: name ?? shortenPath(file.path, 46) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FileCounts, { file }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconChevron, { open })
        ]
      }
    ),
    open ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-diff-wrap", style: { marginLeft: depth * 10 }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DiffBlock, { diff }) }) : null
  ] });
}
function DiffBlock({ diff }) {
  if (diff === void 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-diff wl-diff-note", children: "Loading comparison\u2026" });
  if (diff.kind === "binary") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-diff wl-diff-note", children: "Binary file \u2014 no line comparison." });
  if (diff.kind === "none") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-diff wl-diff-note", children: "No textual change." });
  if (diff.kind === "error" || diff.kind === "invalid") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-diff wl-diff-note", children: "This comparison is unavailable." });
  const hunks = Array.isArray(diff.hunks) ? diff.hunks : [];
  if (hunks.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-diff wl-diff-note", children: "Nothing to show." });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wl-diff", children: [
    hunks.map((hunk, hunkIndex) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wl-hunk", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-hunk-head", children: hunk.header }),
      hunk.lines.map((line, lineIndex) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "div",
        {
          className: `wl-line${line[0] === "+" ? " wl-line-add" : line[0] === "-" ? " wl-line-del" : ""}`,
          children: line
        },
        lineIndex
      ))
    ] }, `${hunk.header}:${hunkIndex}`)),
    diff.truncated ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-diff-note", children: "Comparison truncated." }) : null
  ] });
}
function SessionFiles({ changes }) {
  if (changes === void 0 || changes.total === 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-empty", children: "No files written in this session yet." });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "wl-files", children: changes.files.map((file) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { className: "wl-file", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wl-file-row wl-file-static", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-badge", "data-s": file.status, "aria-hidden": "true", children: file.status }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-file-path", title: file.path, children: shortenPath(file.path, 46) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-file-count", children: file.edits > 1 ? `${file.edits}\xD7` : "" })
  ] }) }, file.path)) });
}
function buildTree(files) {
  const root = { name: "", path: "", dirs: /* @__PURE__ */ new Map(), files: [] };
  for (const file of files) {
    const parts = String(file.path).replace(/\\/g, "/").split("/").filter((part) => part.length > 0);
    let node = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const segment = parts[index];
      let child = node.dirs.get(segment);
      if (child === void 0) {
        child = { name: segment, path: parts.slice(0, index + 1).join("/"), dirs: /* @__PURE__ */ new Map(), files: [] };
        node.dirs.set(segment, child);
      }
      node = child;
    }
    node.files.push({ ...file, name: parts[parts.length - 1] ?? String(file.path) });
  }
  return root;
}
function FileTree({ files, closed, onToggleFolder, expanded, keyFor, onToggle, diffs }) {
  const root = (0, import_react.useMemo)(() => buildTree(files), [files]);
  const renderNode = (node, depth) => {
    const dirs = [...node.dirs.values()].sort((left, right) => left.name.localeCompare(right.name));
    const leaves = [...node.files].sort((left, right) => left.name.localeCompare(right.name));
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      dirs.map((child) => {
        const isClosed = closed.has(child.path);
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "button",
            {
              type: "button",
              className: "wl-folder",
              style: { paddingLeft: 6 + depth * 10 },
              "aria-expanded": !isClosed,
              onClick: () => onToggleFolder(child.path),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconChevron, { open: !isClosed }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-folder-name", children: `${child.name}/` })
              ]
            }
          ),
          isClosed ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "wl-tree", children: renderNode(child, depth + 1) })
        ] }, `dir:${child.path}`);
      }),
      leaves.map((file) => {
        const key = keyFor(file);
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          FileRow,
          {
            file,
            name: file.name,
            depth,
            open: expanded === key,
            onToggle: () => onToggle(file),
            diff: diffs[key]
          }
        ) }, `file:${file.path}`);
      })
    ] });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "wl-tree", children: renderNode(root, 0) });
}
function refBadges(refs) {
  const parts = String(refs).split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  const clean = parts.map((part) => part.replace(/^HEAD -> /, "").replace(/^tag: /, ""));
  const unique = [...new Set(clean)];
  const shown = unique.slice(0, 1);
  const extra = unique.length - shown.length;
  return { shown, extra };
}
function GraphArt({ art }) {
  const parts = [];
  let buffer = "";
  for (const char of String(art)) {
    if (char !== "*") {
      buffer += char;
      continue;
    }
    if (buffer !== "") {
      parts.push(/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-lane", children: buffer }, `lane:${parts.length}`));
      buffer = "";
    }
    parts.push(/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-lane-mark", children: "*" }, `mark:${parts.length}`));
  }
  if (buffer !== "") parts.push(/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-lane", children: buffer }, `lane:${parts.length}`));
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-graph-art", children: parts });
}
function CommitGraph({ rows, value, onPick }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "wl-graph", role: "listbox", "aria-label": "Commit graph", children: rows.map((row, index) => {
    if (row.hash === void 0) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { className: "wl-graph-lane", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(GraphArt, { art: row.art }) }, `lane:${index}`);
    }
    const { shown, extra } = refBadges(row.refs);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { role: "option", "aria-selected": row.hash === value, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        className: "wl-graph-row",
        "data-active": row.hash === value || void 0,
        title: `${row.short} \xB7 ${row.author} \xB7 ${row.subject}`,
        onClick: () => onPick(row.hash),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(GraphArt, { art: row.art }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-graph-hash", children: row.short }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-graph-subject", children: row.subject }),
          shown.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "wl-graph-refs", children: [
            shown.map((ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-ref", children: ref }, ref)),
            extra > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-ref", title: row.refs, children: `+${extra}` }) : null
          ] }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-graph-age", children: relativeAge(row.time) })
        ]
      }
    ) }, row.hash);
  }) });
}
function ChangesPanel({ cwd, running, fallback }) {
  const [tab, setTab] = (0, import_react.useState)("uncommitted");
  const [overview, setOverview] = (0, import_react.useState)(null);
  const [failure, setFailure] = (0, import_react.useState)("");
  const [nonce, setNonce] = (0, import_react.useState)(0);
  const [hash, setHash] = (0, import_react.useState)("");
  const [commit, setCommit] = (0, import_react.useState)(null);
  const [commitFailure, setCommitFailure] = (0, import_react.useState)("");
  const [expanded, setExpanded] = (0, import_react.useState)("");
  const [diffs, setDiffs] = (0, import_react.useState)({});
  (0, import_react.useEffect)(() => {
    if (cwd === "") return void 0;
    const controller = new AbortController();
    let alive = true;
    const load = async () => {
      try {
        const data = await fetchOverview(cwd, controller.signal);
        if (!alive) return;
        setOverview(data);
        setFailure("");
      } catch (error) {
        if (!alive || error?.name === "AbortError") return;
        setFailure(error instanceof Error ? error.message : String(error));
      }
    };
    load();
    const handle = setInterval(load, running ? 4e3 : 2e4);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(handle);
    };
  }, [cwd, running, nonce]);
  const commits = overview?.git === true && Array.isArray(overview.commits) ? overview.commits : [];
  const [graph, setGraph] = (0, import_react.useState)([]);
  const [graphFailure, setGraphFailure] = (0, import_react.useState)("");
  (0, import_react.useEffect)(() => {
    if (cwd === "" || overview?.git !== true) return void 0;
    const controller = new AbortController();
    let alive = true;
    fetchGraph(cwd, 40, controller.signal).then((data) => {
      if (!alive) return;
      setGraph(Array.isArray(data?.rows) ? data.rows : []);
      setGraphFailure("");
    }).catch((error) => {
      if (alive && error?.name !== "AbortError") setGraphFailure(error instanceof Error ? error.message : String(error));
    });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [cwd, overview?.git, nonce, running]);
  const fallbackRows = commits.map((entry) => ({
    art: "* ",
    hash: entry.hash,
    short: entry.short,
    author: entry.author,
    time: entry.time,
    refs: "",
    subject: entry.subject
  }));
  const graphRows = graph.length > 0 ? graph : fallbackRows;
  const firstCommit = graphRows.find((row) => typeof row.hash === "string")?.hash;
  (0, import_react.useEffect)(() => {
    if (tab !== "committed" || hash !== "") return;
    if (typeof firstCommit === "string" && firstCommit.length > 0) setHash(firstCommit);
  }, [tab, hash, firstCommit]);
  (0, import_react.useEffect)(() => {
    if (hash === "" || overview?.git !== true) return void 0;
    const controller = new AbortController();
    let alive = true;
    setCommit(null);
    setCommitFailure("");
    fetchCommit(cwd, hash, controller.signal).then((data) => {
      if (alive) setCommit(data);
    }).catch((error) => {
      if (alive && error?.name !== "AbortError") setCommitFailure(error instanceof Error ? error.message : String(error));
    });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [cwd, hash, overview?.git, nonce]);
  (0, import_react.useEffect)(() => {
    if (expanded === "" || cwd === "" || diffs[expanded] !== void 0) return void 0;
    let request;
    try {
      request = JSON.parse(expanded);
    } catch {
      return void 0;
    }
    const controller = new AbortController();
    let alive = true;
    fetchDiff(cwd, request, controller.signal).then((data) => {
      if (alive) setDiffs((previous) => ({ ...previous, [expanded]: data }));
    }).catch(() => {
      if (alive) setDiffs((previous) => ({ ...previous, [expanded]: { kind: "error" } }));
    });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [expanded, cwd, diffs]);
  const git = overview?.git === true;
  const uncommitted = git ? overview.files : [];
  const branch = typeof overview?.branch === "string" ? overview.branch : "";
  const ahead = Number(overview?.ahead) || 0;
  const behind = Number(overview?.behind) || 0;
  const keyFor = (file) => JSON.stringify({
    scope: tab === "committed" ? "commit" : "worktree",
    hash: tab === "committed" ? hash : "",
    path: file.path
  });
  const toggle = (file) => {
    const key = keyFor(file);
    setExpanded((current) => current === key ? "" : key);
  };
  const [closed, setClosed] = (0, import_react.useState)(() => /* @__PURE__ */ new Set());
  const toggleFolder = (path) => {
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  const files = tab === "committed" ? commit?.files ?? [] : uncommitted;
  const added = files.reduce((total, file) => total + (file.added ?? 0), 0);
  const deleted = files.reduce((total, file) => total + (file.deleted ?? 0), 0);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "wl-section", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wl-section-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-section-title", children: "Changes" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-section-meta", children: git ? `${branch !== "" ? branch : "detached"}${ahead > 0 ? ` \u2191${ahead}` : ""}${behind > 0 ? ` \u2193${behind}` : ""}` : "no repo" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "wl-refresh", "aria-label": "Refresh changes", title: "Refresh changes", onClick: () => setNonce((value) => value + 1), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconRefresh, {}) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wl-tabs", role: "tablist", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", role: "tab", "aria-selected": tab === "uncommitted", "data-active": tab === "uncommitted" || void 0, onClick: () => setTab("uncommitted"), children: [
        "Uncommitted",
        git && uncommitted.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-tab-count", children: uncommitted.length }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", role: "tab", "aria-selected": tab === "committed", "data-active": tab === "committed" || void 0, onClick: () => setTab("committed"), children: [
        "Committed",
        Number(overview?.commitCount) > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-tab-count", children: overview.commitCount }) : null
      ] })
    ] }),
    failure !== "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wl-empty", children: [
        "The git bridge did not answer (",
        failure,
        "). Restart DeepSeek Harness to load the host routes, then reopen this tab."
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SessionFiles, { changes: fallback })
    ] }) : cwd === "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-empty", children: "This session has no working directory." }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SessionFiles, { changes: fallback })
    ] }) : overview === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-empty", children: "Reading the working tree\u2026" }) : !git ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-empty", children: overview?.reason === "git-unavailable" ? "Git is not available here \u2014 showing files this session wrote." : "This directory is not a git repository \u2014 showing files this session wrote." }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SessionFiles, { changes: fallback })
    ] }) : tab === "uncommitted" ? uncommitted.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-empty", children: "Working tree is clean." }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        FileTree,
        {
          files: uncommitted,
          closed,
          onToggleFolder: toggleFolder,
          expanded,
          keyFor,
          onToggle: toggle,
          diffs
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-diff-total", children: `${uncommitted.length} ${uncommitted.length === 1 ? "file" : "files"}${added + deleted > 0 ? ` \xB7 +${added} \u2212${deleted}` : ""}` })
    ] }) : graphRows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-empty", children: graphFailure !== "" ? `The commit graph could not be read (${graphFailure}).` : "No commits in this repository yet." }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        CommitGraph,
        {
          rows: graphRows,
          value: hash,
          onPick: (next) => {
            setHash(next);
            setExpanded("");
          }
        }
      ),
      commitFailure !== "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wl-empty", children: [
        "This commit could not be read (",
        commitFailure,
        ")."
      ] }) : null,
      commit !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wl-commit-meta", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: commit.author }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\xB7" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: relativeAge(commit.time) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\xB7" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `${commit.files.length} ${commit.files.length === 1 ? "file" : "files"}` }),
          added + deleted > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-add", children: `+${added}` }) : null,
          added + deleted > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-del", children: `\u2212${deleted}` }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          FileTree,
          {
            files: commit.files,
            closed,
            onToggleFolder: toggleFolder,
            expanded,
            keyFor,
            onToggle: toggle,
            diffs
          }
        )
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-empty", children: "Reading the commit\u2026" })
    ] })
  ] });
}
function WorkPanel({ useChat, useSession, useProjection, useSessions, sessionId }) {
  const session = useSession((value) => value);
  const chat = useChat((value) => value);
  const { todos, updatedAt } = usePlan(useProjection);
  const workspace = useWorkspaceLabel(useSessions, sessionId);
  const cwd = useWorkingDirectory(useSessions, sessionId);
  const now = useTick(session?.running === true);
  const run = (0, import_react.useMemo)(() => deriveRun({ session, chat, todos, planUpdatedAt: updatedAt, now }), [session, chat, todos, updatedAt, now]);
  const status = statusView(run);
  const hint = planHint(run);
  const nowBody = run.now.detail !== "" ? run.now.detail : run.reasoning;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-root", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wl-scroll", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wl-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "wl-status", "data-tone": status.tone, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "wl-dot", "data-live": run.running || void 0 }),
        status.label
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "wl-head-meta", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
          "Turn ",
          run.turn
        ] }),
        run.elapsedMs > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\xB7" }) : null,
        run.elapsedMs > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: formatDuration(run.elapsedMs) }) : null,
        run.calls > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\xB7" }) : null,
        run.calls > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
          run.calls,
          " calls"
        ] }) : null
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wl-workspace", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-workspace-name", children: workspace !== "" ? workspace : "This session" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-workspace-sub", children: run.plan.total > 0 ? `${run.plan.doneCount}/${run.plan.total} steps` : "no plan yet" })
    ] }),
    run.plan.total > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-progress", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { style: { width: `${run.plan.pct}%` } }) }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", { className: "wl-section", style: { marginTop: 20 }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wl-now", "data-kind": run.now.kind, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wl-now-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "wl-now-glyph", "data-live": run.running || void 0 }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-now-tool", children: run.now.label }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-now-target", title: run.now.target, children: run.now.target }),
        run.running && run.now.since ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-now-time", children: formatDuration(now - run.now.since) }) : null
      ] }),
      nowBody !== "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-now-body", children: nowBody }) : run.now.kind === "thinking" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ThinkingDots, {}) : null
    ] }) }),
    run.plan.total > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "wl-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wl-section-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-section-title", children: "Plan" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "wl-section-meta", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: run.plan.doneCount }),
          "/",
          run.plan.total,
          run.plan.updatedAt > 0 ? ` \xB7 ${clock(run.plan.updatedAt)}` : ""
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "wl-plan", children: run.plan.items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        PlanRow,
        {
          item,
          active: item.index === run.plan.located,
          next: item.index === run.plan.nextIndex
        },
        `${item.index}:${item.content}`
      )) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-bar", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { style: { width: `${run.plan.pct}%` } }) }),
      hint !== "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-hint", children: hint }) : null
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChangesPanel, { cwd, running: run.running, fallback: run.changes }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wl-foot", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "wl-dot", "data-live": run.running || void 0 }),
      run.running ? "Following this turn live" : "Waiting for the next turn"
    ] })
  ] }) });
}
function WorkDock({ useChat, useSession, useProjection, openWork: openWork2 }) {
  const session = useSession((value) => value);
  const chat = useChat((value) => value);
  const { todos, updatedAt } = usePlan(useProjection);
  const now = useTick(session?.running === true);
  const run = (0, import_react.useMemo)(() => deriveRun({ session, chat, todos, planUpdatedAt: updatedAt, now }), [session, chat, todos, updatedAt, now]);
  if (run.plan.total === 0 && !run.running) return null;
  const status = statusView(run);
  const current = run.plan.items[run.plan.located];
  const detail = run.now.kind === "tool" ? `${run.now.label}${run.now.target ? ` \xB7 ${run.now.target}` : ""}` : run.now.label;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wl-root wl-inline", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wl-dock", "data-status": status.tone, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "wl-dock-status", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "wl-dot", "data-live": run.running || void 0 }),
      status.label
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "wl-dock-current", title: current?.content ?? detail, children: [
      current ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: current.content }) : detail,
      run.running && current ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: "var(--wl-3)" }, children: ` \u2014 ${detail}` }) : null
    ] }),
    run.plan.total > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "wl-dock-progress", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wl-dock-bar", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { style: { width: `${run.plan.pct}%` } }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "wl-dock-count", children: [
        run.plan.doneCount,
        "/",
        run.plan.total
      ] })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "wl-dock-open", onClick: openWork2, title: "Open the Work panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconList, { size: 12 }),
      "Work",
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconOpen, { size: 11 })
    ] })
  ] }) });
}
function WorkButton({ openWork: openWork2 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "wl-hbtn", onClick: openWork2, title: "Open the Work panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconList, { size: 13 }),
    "Work"
  ] });
}

// src/entry.jsx
var TAB_ID = "@local/worklog";
var TAB_KIND = "worklog";
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
    }
    try {
      control.openTab(TAB_KIND);
    } catch {
    }
  };
  if (has()) {
    place();
    return;
  }
  try {
    if (!control.isExpanded()) control.toggleExpanded();
  } catch {
  }
  let frames = 0;
  const attempt = () => {
    place();
    if (has() || (frames += 1) > 45) return;
    requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}
var inject = ["slots", "sidebarRight", "sidebarRightTabs"];
function apply(ctx) {
  installStyles();
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    priority: "builtin",
    title: () => "Work",
    guide: [{
      id: "worklog",
      order: 25,
      title: () => "Work",
      description: () => "The live step, the activity behind it, changed files, and the commit."
    }]
  }), "worklog: sidebar tab type");
  ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
    name: "sidebar.right.pane.tab",
    key: TAB_ID
  }, WorkPanel));
  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock",
    id: "todo",
    order: 0,
    inject: (sessionId) => ({ openWork: () => openWork(ctx, sessionId) })
  }, WorkDock));
  ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
    name: "conversation.session.header.actions",
    id: "worklog",
    order: 40,
    inject: (sessionId) => ({ openWork: () => openWork(ctx, sessionId) })
  }, WorkButton));
}

    return module.exports;
  },
});
