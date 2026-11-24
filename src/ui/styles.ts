/**
 * One stylesheet for the closed shadow root on pixiv and for the extension's own inspector page.
 * A single dark, colourless theme: the artwork supplies the colour, so the UI reads the same on
 * pixiv's light and dark themes. Yellow is used in one place only: the current step of the trust
 * scale. System fonts only (a pixiv page cannot load extension fonts without exposing resources).
 */
export const STYLES = `
:host{all:initial;color-scheme:dark;
  --ink:#1c1e22;--ink-deep:#141518;--raised:#2a2d33;--raised-hover:#363a41;--line:#3d414a;--line-strong:#6b707a;
  --fg:#f2f3f5;--muted:#adb1b9;--faint:#868b95;--mark:#ffe14d;--mark-fg:#1c1e22;--alert:#ff9e8f;--focus:#f2f3f5;
  --font:system-ui,-apple-system,"Segoe UI","Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic UI",Meiryo,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Consolas,monospace;}
*{box-sizing:border-box}
[hidden]{display:none!important}
.visually-hidden{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
button,select,input{font:inherit;color:inherit}
button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:28px;padding:0 12px;border:1px solid var(--line);border-radius:6px;background:var(--raised);line-height:1.2;cursor:pointer;white-space:nowrap}
button:hover:not(:disabled){background:var(--raised-hover)}
button:disabled{cursor:default;color:var(--faint);background:transparent;border-style:dashed}
.primary{background:var(--fg);color:var(--ink);border-color:var(--fg);font-weight:600}
.primary:hover:not(:disabled){background:#ffffff}
.primary:disabled{border-color:var(--line)}
.icon-button{width:28px;padding:0;background:transparent;border-color:transparent;color:var(--muted)}
.icon-button:hover:not(:disabled){color:var(--fg)}
.icon-button:disabled{border-color:transparent;color:var(--line)}
.icon{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
summary{cursor:pointer;width:fit-content}
p{margin:0}
pre{margin:6px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--ink-deep);color:var(--fg);padding:8px 10px;border-radius:6px;max-height:16em;overflow:auto;font:12px/1.5 var(--mono)}

/* Viewer: image column, optional result sheet beside or below it */
.hover-panel{position:fixed;z-index:2147483647;display:flex;align-items:stretch;max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);overflow:hidden;background:var(--ink);color:var(--fg);border:1px solid var(--line);border-radius:12px;box-shadow:0 16px 40px #0000008c;font:13px/1.6 var(--font);overflow-wrap:anywhere;animation:metatan-in .14s ease-out}
.hover-panel[data-sheet=left]{flex-direction:row-reverse}
.hover-panel[data-layout=stack]{flex-direction:column}
.hover-panel:focus,.sheet:focus{outline:none}
@keyframes metatan-in{from{opacity:0;transform:translateY(4px)}}
@media (prefers-reduced-motion:reduce){.hover-panel{animation:none}}
.viewer{display:flex;flex-direction:column;flex:none;min-width:0}
.preview-stage{position:relative;display:flex;align-items:center;justify-content:center;max-width:100%;background:var(--ink-deep);touch-action:pan-y;outline-offset:-3px}
.preview-slot{width:100%;height:100%}
.preview-image{display:block;width:100%;height:100%;object-fit:contain}
.preview-loading{position:absolute;left:10px;bottom:10px;padding:2px 8px;border-radius:4px;background:#000000b3;color:var(--fg);font-size:12px;pointer-events:none}
.hover-bar{display:flex;align-items:center;gap:6px;min-height:44px;padding:0 8px;border-top:1px solid var(--line)}
.hover-nav{display:flex;align-items:center;gap:2px;margin-right:auto}
.hover-counter{min-width:3.5em;text-align:center;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.hover-unavailable{font-size:12px;color:var(--muted);line-height:1.4}
.hover-info{display:flex;flex-direction:column;align-items:flex-start;gap:6px;max-width:100%;padding:10px 12px;border-top:1px solid var(--line);font-size:12px}
.hover-info details{color:var(--muted)}
.hover-info details p{margin-top:4px;max-width:36em}
.sheet{display:flex;flex-direction:column;gap:14px;width:340px;flex:none;padding:14px 16px 16px;overflow:auto;overscroll-behavior:contain;border-left:1px solid var(--line)}
[data-sheet=left] .sheet{border-left:0;border-right:1px solid var(--line)}
[data-layout=stack] .sheet{width:auto;border-left:0;border-right:0;border-top:1px solid var(--line)}
[data-layout=stack] .preview-stage{width:100%!important}
.sheet-status{color:var(--muted)}
.sheet-actions:empty{display:none}

/* Artwork page: opens the same viewer for the artwork itself */
.toggle{position:fixed;right:16px;bottom:20px;z-index:2147483646;min-height:36px;padding:0 14px;border-radius:999px;background:var(--ink);color:var(--fg);border:1px solid var(--line);box-shadow:0 6px 18px #00000066;font:600 13px/1 var(--font)}
.toggle:hover:not(:disabled){background:var(--raised)}
.toggle[aria-expanded=true]{background:var(--fg);color:var(--ink);border-color:var(--fg)}

/* Result: one sentence first, then prompt and settings; everything else folded */
.hover-results,.local-results{display:flex;flex-direction:column;gap:14px;min-width:0}
.verdict{display:flex;flex-direction:column;gap:6px}
.verdict-context{font-size:12px;color:var(--muted)}
.verdict-title{margin:0;font-size:15px;font-weight:700;line-height:1.5;text-wrap:balance}
.verdict.failure .verdict-title::before{content:"";display:inline-block;width:8px;height:8px;margin-right:8px;border-radius:50%;background:var(--alert);vertical-align:.12em}
.verdict-detail{font-size:12px;color:var(--muted)}
.trust-scale{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin:4px 0 0;padding:0;list-style:none;font-size:12px;line-height:1.35}
.trust-scale li{display:block;align-content:center;word-break:keep-all;padding:5px 4px;border:1px solid var(--line);border-radius:4px;color:var(--muted);text-align:center}
.trust-scale li.unavailable{border-style:dashed}
.trust-scale li.now{background:var(--mark);border-color:var(--mark);color:var(--mark-fg);font-weight:700}
.field{display:flex;flex-direction:column;gap:6px}
.field-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.field-head h4,details.field>summary{margin:0;font-size:12px;font-weight:600;color:var(--muted)}
.field-actions{display:flex;justify-content:flex-end}
.field-text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.65}
.field-text.clamped{display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden}
.text-button{align-self:flex-start;min-height:24px;padding:0;border:0;background:none;color:var(--muted);font-size:12px;text-decoration:underline}
.text-button:hover:not(:disabled){background:none;color:var(--fg)}
.copy{min-height:28px;padding:0 10px;font-size:12px}
.copy.done{border-color:var(--fg)}
.copy-error{font-size:12px;color:var(--alert)}
.settings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px;margin:0;padding-top:12px;border-top:1px solid var(--line)}
.settings div{min-width:0}
.settings dt{font-size:12px;color:var(--muted)}
.settings dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.raw>summary{font-size:12px;color:var(--muted)}
.result-more{padding-top:10px;border-top:1px solid var(--line)}
.result-more>summary{font-size:12px;font-weight:600;color:var(--muted)}
.result-more-body{display:flex;flex-direction:column;gap:6px;margin-top:8px;font-size:12px;color:var(--muted)}
.buttons{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:4px;color:var(--fg)}

/* Extension page opened from the toolbar icon (no network) */
.local-page{display:block;min-height:100dvh;padding:32px 16px 48px;background:var(--ink-deep);color:var(--fg);font:14px/1.7 var(--font);overflow-wrap:anywhere}
.local-wrap{display:flex;flex-direction:column;gap:20px;max-width:1120px;margin:0 auto}
.local-page h1{margin:0;font-size:20px;line-height:1.4}
.local-intro{max-width:44em;color:var(--muted)}
.local-layout{display:grid;grid-template-columns:300px minmax(0,1fr);gap:20px;align-items:start}
.local-side{display:flex;flex-direction:column;gap:12px;min-width:0}
.dropzone{display:flex;flex-direction:column;align-items:center;gap:8px;padding:20px 14px;border:1.5px dashed var(--line-strong);border-radius:10px;background:var(--ink);text-align:center}
.dropzone.active{border-color:var(--mark)}
.dropzone-hint{font-size:12px;color:var(--muted)}
.local-actions{display:flex;flex-wrap:wrap;gap:6px}
.local-list{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none}
.local-item{width:100%;min-height:56px;justify-content:flex-start;gap:10px;padding:6px 8px;border-color:transparent;background:transparent;text-align:left;white-space:normal}
.local-item[aria-current=true]{background:var(--ink);border-color:var(--line)}
.local-item .thumb{width:40px;height:40px;flex:none;border-radius:4px;background:var(--raised);object-fit:cover}
.local-item .text{display:flex;flex-direction:column;min-width:0}
.local-item .name{font-weight:600}
.local-item .state{font-size:12px;color:var(--muted)}
.local-detail{display:grid;grid-template-columns:minmax(0,260px) minmax(0,1fr);gap:20px;align-items:start;padding:20px;border:1px solid var(--line);border-radius:12px;background:var(--ink)}
.local-preview{display:block;width:100%;max-height:420px;object-fit:contain;border-radius:8px;background:var(--ink-deep)}
.local-detail-body{display:flex;flex-direction:column;gap:14px;min-width:0}
.local-status{color:var(--muted)}
.local-footer{max-width:52em;font-size:12px;color:var(--muted)}
@media (max-width:760px){.local-layout,.local-detail{grid-template-columns:minmax(0,1fr)}.local-page{padding-top:20px}}
`;
