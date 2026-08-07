// Overlay is pure client-side: it relies on BroadcastChannel and the client's
// DOM for SVG getBBox() work during the filtered-region pass. Disabling SSR
// here means OBS's Browser Source skips the prerender and loads cleanly.

export const ssr = false;
export const prerender = false;
