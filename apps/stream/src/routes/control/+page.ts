// /control relies on localStorage, BroadcastChannel, and DOM APIs — all
// client-only. Disabling SSR avoids hydration work that just gets replaced
// when the client store mounts.

export const ssr = false;
export const prerender = false;
