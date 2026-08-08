import { error, json } from '@sveltejs/kit';
import { normalizeRoomCode } from '$lib/sync/room-code';
import type { RequestHandler } from './$types';

/**
 * The relay that lets an overlay watch a desk it isn't in the same browser as.
 *
 * `POST` from /control with the current state; `GET` is an EventSource that
 * replays the latest state on connect and then streams every change. Server-Sent
 * Events rather than WebSockets because this app is served by adapter-node
 * through whatever tunnel the host happens to be using, and SSE is plain HTTP
 * that needs no upgrade handshake to survive the trip.
 *
 * Memory only, on purpose. A room is a live broadcast in progress: it means
 * nothing an hour after the desk closes, and the alternative — a database — is
 * the thing this project doesn't have and doesn't want. The cost of a restart is
 * that /control republishes within a second, because it publishes on change.
 *
 * The last state is kept per room so a late joiner (OBS starting after the desk,
 * a phone opening the link mid-broadcast) gets the current picture immediately
 * instead of a blank stage until the next mutation.
 */

interface Room {
	/** Last full snapshot, as the JSON string it arrived as. */
	state: string | null;
	updatedAt: number;
	subscribers: Set<(event: string, data: string) => void>;
}

const rooms = new Map<string, Room>();

/**
 * A room with no desk and no viewers for this long is over. Swept on access
 * rather than on a timer so an idle server isn't holding a wakeup.
 */
const ROOM_TTL_MS = 12 * 60 * 60_000;

/** Refuse a payload that could only be a mistake or an attack. */
const MAX_BODY_BYTES = 4_000_000;

function sweep(now: number) {
	for (const [code, room] of rooms) {
		if (room.subscribers.size === 0 && now - room.updatedAt > ROOM_TTL_MS) rooms.delete(code);
	}
}

function roomFor(code: string): Room {
	const existing = rooms.get(code);
	if (existing) return existing;
	const fresh: Room = { state: null, updatedAt: Date.now(), subscribers: new Set() };
	rooms.set(code, fresh);
	return fresh;
}

function requireCode(raw: string): string {
	const code = normalizeRoomCode(raw);
	if (!code) error(400, 'Not a room code');
	return code;
}

export const POST: RequestHandler = async ({ params, request }) => {
	const code = requireCode(params.code);
	const body = await request.text();
	if (body.length > MAX_BODY_BYTES) error(413, 'State too large');

	let parsed: { type?: string; state?: unknown; camera?: unknown };
	try {
		parsed = JSON.parse(body);
	} catch {
		error(400, 'Body is not JSON');
	}

	const room = roomFor(code);
	room.updatedAt = Date.now();

	if (parsed.type === 'camera') {
		// A map drag is the only thing that changes at gesture rates, so the desk
		// sends just the camera for it rather than a fresh copy of every county.
		// Merged into the stored snapshot so a late joiner still lands on the right
		// part of the map.
		if (room.state) {
			try {
				const snapshot = JSON.parse(room.state) as { ui?: Record<string, unknown> };
				if (snapshot.ui) {
					snapshot.ui.mapCamera = parsed.camera ?? null;
					room.state = JSON.stringify(snapshot);
				}
			} catch {
				// A snapshot we can't parse is one we shouldn't be serving; the next
				// full publish replaces it either way.
			}
		}
		const payload = JSON.stringify(parsed.camera ?? null);
		for (const send of room.subscribers) send('camera', payload);
	} else {
		if (typeof parsed.state !== 'object' || parsed.state === null) error(400, 'Missing state');
		room.state = JSON.stringify(parsed.state);
		for (const send of room.subscribers) send('state', room.state);
	}

	sweep(room.updatedAt);
	return json({ ok: true, subscribers: room.subscribers.size });
};

export const GET: RequestHandler = async ({ params }) => {
	const code = requireCode(params.code);
	const room = roomFor(code);

	const encoder = new TextEncoder();
	let send: (event: string, data: string) => void = () => {};
	let heartbeat: ReturnType<typeof setInterval> | undefined;

	const stream = new ReadableStream({
		start(controller) {
			send = (event, data) => {
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
				} catch {
					// The client went away between our check and this write; the cancel
					// handler below does the cleanup.
				}
			};
			room.subscribers.add(send);

			// Whatever the desk last said, so an overlay that connects mid-broadcast
			// isn't blank until the host next touches something.
			if (room.state) send('state', room.state);
			else send('waiting', '{}');

			// Tunnels and proxies drop a connection that goes quiet. A comment line
			// is a legal SSE no-op and keeps it open without the client having to
			// filter anything out.
			heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(': keep-alive\n\n'));
				} catch {
					/* closing */
				}
			}, 20_000);
		},
		cancel() {
			room.subscribers.delete(send);
			if (heartbeat) clearInterval(heartbeat);
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-store',
			connection: 'keep-alive',
			// Nginx and some tunnels buffer by default, which turns a live stream
			// into a stream that arrives all at once when it ends.
			'x-accel-buffering': 'no'
		}
	});
};
