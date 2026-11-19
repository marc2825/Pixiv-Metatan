/** One stylesheet for the closed shadow root (artwork panel, hover preview and results). */
export const STYLES = `
:host{all:initial;color-scheme:light dark;
  --bg:#ffffff;--surface:#f3f5f8;--fg:#18202b;--muted:#5d6b7c;--border:#d5dce4;--accent:#3d5afe;--accent-fg:#ffffff;
  --code:#eef1f5;--warn-bg:#fff4e0;--warn-fg:#6b4100;--warn-border:#f0c27a;--ok-bg:#e8f1ff;--ok-fg:#163c7a;--focus:#3d5afe;
  --shadow:0 10px 32px #0f172a33;}
@media (prefers-color-scheme:dark){:host{
  --bg:#161c25;--surface:#0f141b;--fg:#e8edf4;--muted:#a3b1c2;--border:#344255;--accent:#7b8cff;--accent-fg:#0b0f17;
  --code:#0c1118;--warn-bg:#3a2a10;--warn-fg:#ffd9a0;--warn-border:#7a5a24;--ok-bg:#18294a;--ok-fg:#cfe0ff;--focus:#9aa8ff;
  --shadow:0 10px 32px #0008;}}
*{box-sizing:border-box}
[hidden]{display:none!important}
button,select,input{font:inherit;color:inherit}
button,select,summary{cursor:pointer}
button{padding:5px 10px;border:1px solid var(--border);border-radius:7px;background:var(--bg);line-height:1.4}
button:hover:not(:disabled){border-color:var(--muted)}
button:disabled{opacity:.5;cursor:default}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.primary{background:var(--accent);color:var(--accent-fg);border-color:transparent;font-weight:600}
.quiet{border-color:transparent;background:transparent}
.buttons{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 0}
pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--code);padding:6px 8px;border-radius:6px;max-height:9.5em;overflow:auto;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
details{margin:8px 0 0}summary{font-weight:600;font-size:12px;color:var(--muted)}details pre{margin-top:4px;max-height:16em}
p{margin:6px 0}
.panel:focus,.hover-panel:focus{outline:none}
.panel,.hover-panel{background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);font:13px/1.5 system-ui,-apple-system,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif;overflow-wrap:anywhere}

/* Artwork-page panel */
.toggle{position:fixed;right:16px;bottom:20px;z-index:2147483646;background:var(--accent);color:var(--accent-fg);border:0;border-radius:999px;padding:10px 16px;font:600 13px system-ui,sans-serif;box-shadow:var(--shadow)}
.panel{position:fixed;right:16px;bottom:72px;z-index:2147483646;width:min(440px,calc(100vw - 32px));max-height:calc(100dvh - 96px);overflow:auto;overscroll-behavior:contain;padding:14px}
.panel h2{font-size:14px;margin:0 0 4px}.panel .intro{color:var(--muted);font-size:12px}
.panel label{display:block;font-weight:600;font-size:12px;margin-top:8px}
.panel select{width:100%;padding:6px;margin-top:4px;border:1px solid var(--border);border-radius:7px;background:var(--bg)}

/* Hover preview */
.hover-panel{position:fixed;z-index:2147483647;width:min(440px,calc(100vw - 16px));max-height:calc(100dvh - 16px);overflow:auto;overscroll-behavior:contain}
.hover-header{padding:10px 12px 8px;display:flex;gap:8px;align-items:start}.hover-heading{flex:1;min-width:0}
.hover-heading h2{font-size:14px;margin:0;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.hover-meta{margin:2px 0 0;font-size:12px;color:var(--muted)}.hover-meta a{color:var(--accent)}
.hover-close{border:0;background:transparent;padding:0 6px;font-size:18px;line-height:1.2;color:var(--muted)}
.preview-stage{position:relative;display:flex;align-items:center;justify-content:center;height:clamp(120px,42dvh,420px);background:var(--surface);outline-offset:-3px;touch-action:pan-y}
.preview-slot{width:100%;height:100%}.preview-image{width:100%;height:100%;object-fit:contain;display:block}
.preview-loading{position:absolute;bottom:8px;left:12px;right:12px;background:color-mix(in srgb,var(--bg) 88%,transparent);color:var(--fg);border-radius:6px;font-size:12px;padding:3px 8px;pointer-events:none}
.hover-toolbar{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--border)}
.hover-counter{font-variant-numeric:tabular-nums;white-space:nowrap;font-size:12px;color:var(--muted);min-width:3.5em;text-align:center}
.hover-previous,.hover-next{padding:2px 9px;font-size:16px;line-height:1.2}.hover-metadata{margin-left:auto}
.hover-info{margin:0;padding:8px 12px 0;font-size:12px;color:var(--muted)}
.hover-results{padding:4px 12px 0}.hover-results:empty{display:none}
.hover-local{margin:10px 12px 12px}

/* Results */
.result-summary{margin:6px 0;line-height:1.7}.result-summary .badge{margin-right:2px}
.badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;background:var(--surface);border:1px solid var(--border)}
.badge.ok{background:var(--ok-bg);color:var(--ok-fg);border-color:transparent}
.badge.warn{background:var(--warn-bg);color:var(--warn-fg);border-color:var(--warn-border)}
.result-source{font-size:12px;color:var(--muted)}
.result-problem{background:var(--warn-bg);color:var(--warn-fg);border:1px solid var(--warn-border);border-radius:8px;padding:6px 10px}
.result-problem p{margin:4px 0}
.field-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:10px 0 4px}
.field-head h4{margin:0;font-size:12px}.field-head button{padding:1px 8px;font-size:12px}
.metadata-settings{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 12px;margin:10px 0 0;font-size:12px}
.metadata-settings dt{font-weight:600;color:var(--muted)}.metadata-settings dd{margin:0;white-space:pre-wrap}
.provenance{margin:10px 0 0;padding:6px 10px;border-left:3px solid var(--border);font-size:12px}
.provenance p{margin:2px 0}
.result-notes{font-size:11.5px;color:var(--muted)}.result-notes p{margin:4px 0}
.copy-feedback{font-size:12px;color:var(--muted);margin-left:4px}
`;
