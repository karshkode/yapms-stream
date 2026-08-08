import { error, json } from '@sveltejs/kit';
import { normalizeRoomCode } from '$lib/sync/room-code';
import type { RequestHandler } from './$types';

/**
 * The relay that lets an overlay watch a desk it isn't in the same browser as.
 *
 * `POST` from /control with the current state. Two ways to read it back:
 *
 *   - `GET` plain — a Server-Sent Events stream, which is what a viewer on the
 *     same machine or LAN gets. Push, no polling, no upgrade handshake.
 *   - `GET ?poll=1&v=&cv=` — the same content as one JSON reply, for viewers who
 *     can't have a stream. Cloudflare's edge buffers an event stream through a
 *     quick tunnel: measured against a live tunnel, no events arrived at all in
 *     four seconds where localhost delivered the first in one millisecond. A host
 *     sharing their desk with remote testers is going through exactly that, so
 *     the stream cannot be the only way in.
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
	/** Bumped per full snapshot, so a poller can ask "anything newer?". */
	version: number;
	/**
	 * The map camera, kept out of the snapshot rather than merged into it.
	 *
	 * A pan or zoom is the one thing that changes at gesture rates, so it travels
	 * on its own — four numbers instead of another copy of every county. Held
	 * separately with its own counter so a poller can be told "only the camera
	 * moved" and be sent four numbers too.
	 */
	camera: string | null;
	cameraVersion: number;
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
	const fresh: Room = {
		state: null,
		version: 0,
		camera: null,
		cameraVersion: 0,
		updatedAt: Date.now(),
		subscribers: new Set()
	};
	rooms.set(code, fresh);
	return fresh;
}

function requireCode(raw: string): string {
	const code = normalizeRoomCode(raw);
	if (!code) error(400, 'Not a room code');
	return code;
}

/**
 * The stored snapshot with the newest camera folded in.
 *
 * A joiner has to get both in one piece, or it would paint the map at full
 * extent and then jump to wherever the desk actually is.
 */
/**
 * Every update carries the counters it was produced at, on both transports.
 *
 * This is what makes ordering a non-issue rather than a timing question. A
 * buffering proxy can hold an event stream and release it late — after a viewer
 * has already fallen back to polling and moved ahead — and a stale frame applied
 * on top of a newer one takes the overlay backwards, which showed up in testing
 * as the scene flashing back to "waiting for the desk". With a version on each
 * update the receiver simply drops anything that isn't newer than what it has,
 * and neither side has to reason about which arrived first.
 */
function stateEnvelope(room: Room): string {
	return `{"v":${room.version},"cv":${room.cameraVersion},"state":${snapshotWithCamera(room) ?? 'null'}}`;
}

function cameraEnvelope(room: Room): string {
	return `{"v":${room.version},"cv":${room.cameraVersion},"camera":${room.camera ?? 'null'}}`;
}

function snapshotWithCamera(room: Room): string | null {
	if (!room.state) return null;
	if (!room.camera) return room.state;
	try {
		const snapshot = JSON.parse(room.state) as { ui?: Record<string, unknown> };
		if (!snapshot.ui) return room.state;
		snapshot.ui.mapCamera = JSON.parse(room.camera);
		return JSON.stringify(snapshot);
	} catch {
		return room.state;
	}
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
		room.camera = JSON.stringify(parsed.camera ?? null);
		room.cameraVersion++;
		for (const send of room.subscribers) send('update', cameraEnvelope(room));
	} else {
		if (typeof parsed.state !== 'object' || parsed.state === null) error(400, 'Missing state');
		room.state = JSON.stringify(parsed.state);
		room.version++;
		// A full snapshot carries its own camera, so the separately-tracked one is
		// now redundant and would otherwise override a newer value from the same
		// publish on the next join.
		room.camera = null;
		for (const send of room.subscribers) send('update', stateEnvelope(room));
	}

	sweep(room.updatedAt);
	return json({ ok: true, subscribers: room.subscribers.size });
};

export const GET: RequestHandler = async ({ params, url }) => {
	const code = requireCode(params.code);
	const room = roomFor(code);

	if (url.searchParams.has('poll')) return pollReply(room, url);

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

			// Two kilobytes of nothing, first. Some proxies won't forward a response
			// until they have a certain amount of it, which for a stream that starts
			// with a 20-byte frame means forwarding nothing. A comment line is a legal
			// SSE no-op the client discards.
			controller.enqueue(encoder.encode(`:${' '.repeat(2048)}\n\n`));

			// Whatever the desk last said, so an overlay that connects mid-broadcast
			// isn't blank until the host next touches something.
			if (room.state) send('update', stateEnvelope(room));
			else send('waiting', '{}');

			// Tunnels and proxies drop a connection that goes quiet. Frequent enough
			// to also serve as the signal that the stream is alive at all.
			heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(': keep-alive\n\n'));
				} catch {
					/* closing */
				}
			}, 15_000);
		},
		cancel() {
			room.subscribers.delete(send);
			if (heartbeat) clearInterval(heartbeat);
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			// `no-transform` asks Cloudflare not to compress the stream, since
			// compressing one means buffering it. `x-accel-buffering` is the same
			// instruction to nginx, which is what a self-hosted reverse proxy in
			// front of this is likely to be. Neither is sufficient through a quick
			// tunnel, which is why the poll path exists.
			'cache-control': 'no-store, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};

/**
 * One JSON answer to "what's changed since I last asked?".
 *
 * Sends a full snapshot when there is a newer one, otherwise just the camera
 * when only that moved, otherwise nothing — so an idle room costs the viewer a
 * few bytes per poll and a map drag costs four numbers.
 */
function pollReply(room: Room, url: URL): Response {
	const sinceVersion = Number(url.searchParams.get('v') ?? 0);
	const sinceCamera = Number(url.searchParams.get('cv') ?? 0);
	const headers = { 'cache-control': 'no-store' };

	const asJson = { ...headers, 'content-type': 'application/json' };
	if (room.version > sinceVersion) {
		return new Response(stateEnvelope(room), { headers: asJson });
	}
	if (room.cameraVersion > sinceCamera) {
		return new Response(cameraEnvelope(room), { headers: asJson });
	}
	return json({ v: room.version, cv: room.cameraVersion }, { headers });
}
