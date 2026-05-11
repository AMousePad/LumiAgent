// Inline SVG markup for UI icons. Authored as 24x24 viewBox so they scale
// cleanly via CSS. Originals live under assets/icons/ in the repo; this
// module is the runtime copy that ships in the frontend bundle.

const STROKE = `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"`;

// Circular arrow with a small arrowhead at the top — the universal "retry"
// glyph. Sourced from svgrepo; condensed for our 14x14 button target.
export const ICON_RETRY = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M21 3V8M21 8H16M21 8L18 5.29168C16.4077 3.86656 14.3051 3 12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21C16.2832 21 19.8675 18.008 20.777 14" ${STROKE}/></svg>`;

// Pencil-over-page glyph for "edit this message".
export const ICON_EDIT = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M20 16v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" ${STROKE}/><polygon points="12.5 15.8 22 6.2 17.8 2 8.3 11.5 8 16 12.5 15.8" ${STROKE}/></svg>`;

// Trash-bin glyph for "delete this message".
export const ICON_TRASH = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6" ${STROKE}/></svg>`;
