/**
 * Worklog styles.
 *
 * The right Sidebar paints with the conversation's own ground colour, so the
 * panel carries no raised background: it is a column of the page, not a card
 * over it. Colour resolves from the app's tokens with neutral fallbacks, so the
 * dark and light palettes both work unchanged.
 *
 * Visual language: a quiet instrument panel. Hairlines instead of boxes, one
 * accent used sparingly, tabular numerals, and monospace reserved for real data
 * (hashes, paths, commands, diff lines).
 */
export const CSS = `
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
.wl-step-state{flex:none;font-size:10.5px;letter-spacing:.01em;color:var(--wl-3);font-variant-numeric:tabular-nums;white-space:nowrap}
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
.wl-graph{list-style:none;margin:4px 0 0;padding:2px 0;max-height:264px;overflow-y:auto;scrollbar-gutter:stable}
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

/** Stable style element id so a plugin reload replaces rather than duplicates. */
const TAG_ID = '@local/worklog/styles';

/** Install the stylesheet once per document. */
export function installStyles() {
  if (typeof document === 'undefined') return;
  let tag = document.querySelector(`style[data-plugin-css="${TAG_ID}"]`);
  if (tag === null) {
    tag = document.createElement('style');
    tag.dataset.plugin = '@local/worklog';
    tag.dataset.pluginCss = TAG_ID;
    document.head.appendChild(tag);
  }
  if (tag.textContent !== CSS) tag.textContent = CSS;
}
