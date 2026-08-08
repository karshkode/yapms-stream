/**
 * Zoom the map by transforming SVG geometry instead of the rendered element.
 *
 * Handed an element, panzoom picks a controller for it, and for an inline
 * `<svg>` it lands on the DOM controller, which writes `style.transform`. A CSS
 * transform is a promise about pixels, not about geometry, so the browser is
 * free to keep the layer's existing raster and stretch it — and Chrome, along
 * with the CEF build inside OBS, frequently does, especially once something in
 * the stage (the legend and the detail card both carry `backdrop-filter`) has
 * pushed the map into a composited layer. At the 8-12x the click-to-zoom
 * reaches, county borders and city labels visibly soften: the map goes fuzzy
 * exactly when the host has pushed in to talk about one county.
 *
 * The same matrix written to a `transform` attribute on a `<g>` inside the SVG
 * is a statement about geometry, so the paths are re-tessellated at the final
 * device scale and there is no raster to stretch. This is why panzoom refuses
 * to attach to a root `<svg>` at all and tells you to hand it a `<g>`.
 *
 * We can't just hand panzoom that `<g>`, though. Its SVG controller deletes the
 * root `viewBox` in `initTransform` so that user units equal CSS pixels, and we
 * need the viewBox: it is what refits the map when the OBS canvas is resized,
 * and load-svg computes a fresh one per filtered map so that a single-state
 * carve of the national SVG fills the frame instead of sitting in one corner.
 *
 * So this controller lets panzoom go on working in the CSS-pixel space it
 * already assumes — leaving MapView's click-to-zoom measurements, the zoom
 * clamps and `getTransform().scale` all meaning exactly what they did — and
 * converts to user units on the way out.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const SCENE_MARKER = 'panzoom-scene';

/** The group panzoom transforms, creating it on first call. */
export function ensureScene(svg: SVGSVGElement): SVGGElement {
	const existing = svg.querySelector<SVGGElement>(`g[map-type="${SCENE_MARKER}"]`);
	if (existing) return existing;

	const scene = document.createElementNS(SVG_NS, 'g');
	scene.setAttribute('map-type', SCENE_MARKER);
	// Moved rather than cloned. By the time a repaint reaches here the region
	// paths may already carry a click listener, a <title> child and the fills
	// apply-colors wrote, none of which survive serialization.
	while (svg.firstChild) scene.appendChild(svg.firstChild);
	svg.appendChild(scene);
	return scene;
}

/** The subset of panzoom's controller interface that a scene needs. */
export interface SceneController {
	getOwner(): HTMLElement;
	getBBox(): { left: number; top: number; width: number; height: number };
	applyTransform(transform: { x: number; y: number; scale: number }): void;
}

export function makeSceneController(
	svg: SVGSVGElement,
	viewport: HTMLElement,
	scene: SVGGElement
): SceneController {
	// panzoom's own controllers do this, and its arrow-key and +/- handlers are
	// bound to the owner, so without it the map can never take focus and the
	// keyboard does nothing.
	viewport.setAttribute('tabindex', '0');

	return {
		getOwner: () => viewport,
		// Only read by `autocenter` and the `bounds` clamp, both of which MapView
		// turns off. Reported honestly regardless, so enabling either later gets
		// a real answer rather than a stub.
		getBBox: () => ({
			left: 0,
			top: 0,
			width: svg.clientWidth,
			height: svg.clientHeight
		}),
		applyTransform: (transform) =>
			scene.setAttribute('transform', sceneMatrix(svg, viewport, transform))
	};
}

/**
 * The part of the map currently on screen, in the SVG's own coordinates.
 *
 * This is what gets mirrored to /overlay rather than panzoom's transform,
 * because a transform is only meaningful against the box it was computed in.
 * The operator's map lives beside a 22rem results rail in a browser window; the
 * OBS source is a different width and a different aspect ratio. Copying
 * `{x, y, scale}` across would put the two maps at the same magnification
 * looking at different places. A rectangle in user units says "these counties",
 * which is the thing the host actually means, and each side works out its own
 * transform to frame it.
 */
export interface MapCamera {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** The viewBox mapping, `pixels = k * user + t`, in viewport coordinates. */
function viewBoxMapping(
	svg: SVGSVGElement,
	viewport: HTMLElement
): { k: number; tx: number; ty: number } | null {
	const ctm = svg.getScreenCTM();
	if (!ctm || ctm.a === 0) return null;
	const rect = viewport.getBoundingClientRect();
	return { k: ctm.a, tx: ctm.e - rect.left, ty: ctm.f - rect.top };
}

/** The visible rect in user units, from panzoom's current pixel transform. */
export function cameraFromTransform(
	svg: SVGSVGElement,
	viewport: HTMLElement,
	transform: { x: number; y: number; scale: number }
): MapCamera | null {
	const mapping = viewBoxMapping(svg, viewport);
	if (!mapping) return null;
	const { k, tx, ty } = mapping;
	const { scale } = transform;
	if (scale === 0) return null;
	const rect = viewport.getBoundingClientRect();
	if (rect.width === 0 || rect.height === 0) return null;

	// A viewport pixel `p` shows the user point `u` where p = scale*(k*u + t) + P,
	// so inverting at the two corners gives the rect.
	const toUser = (px: number, pan: number, origin: number) => (px - pan) / scale / k - origin / k;
	return {
		x: toUser(0, transform.x, tx),
		y: toUser(0, transform.y, ty),
		w: rect.width / (scale * k),
		h: rect.height / (scale * k)
	};
}

/**
 * The panzoom transform that frames a camera rect in this viewport.
 *
 * Fits rather than stretches — panzoom has one scale, and the two surfaces have
 * different aspect ratios — so the follower shows the host's rectangle plus
 * whatever slack its own shape adds on one axis. Showing slightly more than the
 * operator is the right failure: showing less would crop the county they're
 * pointing at.
 */
export function transformForCamera(
	svg: SVGSVGElement,
	viewport: HTMLElement,
	camera: MapCamera
): { x: number; y: number; scale: number } | null {
	const mapping = viewBoxMapping(svg, viewport);
	if (!mapping) return null;
	const { k, tx, ty } = mapping;
	const rect = viewport.getBoundingClientRect();
	if (rect.width === 0 || rect.height === 0) return null;
	if (camera.w <= 0 || camera.h <= 0) return null;

	const scale = Math.min(rect.width / (k * camera.w), rect.height / (k * camera.h));
	if (!Number.isFinite(scale) || scale <= 0) return null;

	const cx = camera.x + camera.w / 2;
	const cy = camera.y + camera.h / 2;
	return {
		scale,
		x: rect.width / 2 - scale * (k * cx + tx),
		y: rect.height / 2 - scale * (k * cy + ty)
	};
}

/**
 * panzoom's pixel-space transform, rewritten in the SVG's user units.
 *
 * The viewBox already maps a user point `u` onto the viewport at `k*u + t`.
 * panzoom wants the rendered result to land where a CSS `matrix(s, 0, 0, s, p)`
 * on the whole SVG would have put it, which is `s*(k*u + t) + p`. Asking which
 * user-space transform `T(u) = s*u + d` produces those same pixels once the
 * viewBox mapping is applied on top of it:
 *
 *     k*(s*u + d) + t = s*(k*u + t) + p
 *                 k*d = (s - 1)*t + p
 *
 * The scale carries straight across; only the translation has to be converted.
 * Both `k` and `t` are read from the live DOM on every frame rather than cached,
 * because a resized OBS canvas changes them and a stale `k` would send the map
 * sliding off frame.
 */
function sceneMatrix(
	svg: SVGSVGElement,
	viewport: HTMLElement,
	transform: { x: number; y: number; scale: number }
): string {
	const { scale } = transform;
	// getScreenCTM on an outermost <svg> includes the viewBox mapping, which is
	// the whole reason it can be asked for `k` and `t` at once. Null while the
	// SVG is detached or display:none, in which case the identity fallback is
	// harmless — nothing is on screen to be misplaced, and the next frame after
	// it becomes visible recomputes.
	const mapping = viewBoxMapping(svg, viewport);
	const k = mapping?.k ?? 1;
	const originX = mapping?.tx ?? 0;
	const originY = mapping?.ty ?? 0;

	const dx = ((scale - 1) * originX + transform.x) / k;
	const dy = ((scale - 1) * originY + transform.y) / k;

	return `matrix(${scale} 0 0 ${scale} ${dx} ${dy})`;
}
