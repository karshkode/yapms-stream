<script lang="ts">
	// Fullscreen affordance for /overlay.
	//
	// OBS's Browser Source renders this page offscreen at whatever canvas
	// size the source is configured for, so it gains nothing from fullscreen
	// — and anything permanently visible here is baked straight into the
	// capture. So this control starts hidden and only appears once a real
	// pointer moves or a key is pressed, neither of which OBS does unless
	// the host explicitly opens Interact. It stays free for the stream while
	// still being available for the two setups that do want it: a program-out
	// browser window on a second monitor, and OBS Window/Display Capture
	// pointed at a real browser.
	//
	// Deliberately not `visibility: hidden` when idle: that would take the
	// button out of the tab order, and a keyboard-only host has no pointer to
	// wake it with. Idle means transparent and click-through; `:focus-visible`
	// brings it back.

	interface Props {
		/**
		 * Start below the broadcast frame's banner. The banner spans the top
		 * edge and parks the wall clock in its right corner — the same spot
		 * this button wants — so with the frame on it drops underneath rather
		 * than hiding the time whenever the host moves the mouse.
		 */
		belowBanner?: boolean;
	}

	let { belowBanner = false }: Props = $props();

	/** How long after the last pointer/key event the chrome fades out. */
	const IDLE_MS = 2500;

	let supported = $state(false);
	let isFull = $state(false);
	let awake = $state(false);
	// requestFullscreen rejects when the gesture isn't trusted or a policy
	// blocks it (sandboxed iframes, some kiosk configs). Surfacing it on the
	// button beats a click that silently does nothing.
	let failure: string | null = $state(null);

	let idleTimer: ReturnType<typeof setTimeout> | undefined;

	function wake() {
		awake = true;
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => (awake = false), IDLE_MS);
	}

	async function toggle() {
		failure = null;
		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen();
			} else {
				// The whole document rather than a single element, so the
				// transparent page background keeps filling the screen and no
				// letterboxing appears around the frame.
				await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
			}
		} catch (err) {
			failure = err instanceof Error ? err.message : String(err);
		}
		wake();
	}

	function onKey(event: KeyboardEvent) {
		// Any key counts as presence, so a host driving this from the keyboard
		// sees the button acknowledge the state change.
		wake();
		if (event.key !== 'f' && event.key !== 'F') return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		event.preventDefault();
		void toggle();
	}

	$effect(() => {
		// `fullscreenEnabled` is false on iOS Safari, which only does
		// fullscreen for <video>. Better to show nothing than a button that
		// can't work.
		supported = document.fullscreenEnabled;

		const syncFullscreen = () => (isFull = !!document.fullscreenElement);
		syncFullscreen();

		document.addEventListener('fullscreenchange', syncFullscreen);
		window.addEventListener('pointermove', wake);
		// A tap that never moves still means someone's there.
		window.addEventListener('pointerdown', wake);
		window.addEventListener('keydown', onKey);

		return () => {
			document.removeEventListener('fullscreenchange', syncFullscreen);
			window.removeEventListener('pointermove', wake);
			window.removeEventListener('pointerdown', wake);
			window.removeEventListener('keydown', onKey);
			clearTimeout(idleTimer);
		};
	});

	$effect(() => {
		// A mouse arrow parked over a program-out display is as distracting as
		// a visible button. Only in fullscreen: in a windowed tab the host
		// still needs the cursor to reach their browser chrome.
		const hide = isFull && !awake;
		document.documentElement.classList.toggle('overlay-cursor-idle', hide);
		return () => document.documentElement.classList.remove('overlay-cursor-idle');
	});
</script>

{#if supported}
	<button
		type="button"
		class="fs-btn"
		class:awake
		class:below-banner={belowBanner}
		class:failed={failure !== null}
		aria-label={isFull ? 'Exit fullscreen' : 'Enter fullscreen'}
		aria-keyshortcuts="f"
		title={failure ?? (isFull ? 'Exit fullscreen · F' : 'Fullscreen · F')}
		onclick={(event) => {
			// A mouse click leaves focus on the button, and Chrome promotes a
			// focused element to :focus-visible as soon as the next key is
			// pressed — which would pin this pill on screen for the rest of the
			// session, exactly what the idle fade exists to prevent. Keyboard
			// activation (detail === 0) keeps focus, since that host has no
			// pointer to bring the button back with.
			if (event.detail > 0) event.currentTarget.blur();
			void toggle();
		}}
	>
		<span class="glyph" aria-hidden="true">{isFull ? '⤡' : '⤢'}</span>
		<span>{isFull ? 'Exit' : 'Fullscreen'}</span>
		<kbd aria-hidden="true">F</kbd>
	</button>
{/if}

<style>
	.fs-btn {
		position: fixed;
		top: 0.75rem;
		right: 0.75rem;
		/* Above the broadcast banner and the results rail, both of which run
		   to the edges of the capture area. */
		z-index: 100;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.7rem;
		min-height: 2.25rem;
		border: 1px solid rgb(from var(--color-base-content) r g b / 0.25);
		border-radius: 999px;
		background: rgb(from var(--color-base-100) r g b / 0.85);
		backdrop-filter: blur(8px);
		color: var(--color-base-content);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		opacity: 0;
		pointer-events: none;
		transition: opacity 160ms ease;
	}
	/* Clears the frame's 2.75rem banner (2.25rem on phones) plus its border,
	   leaving the same 0.75rem gutter the unframed position uses. */
	.fs-btn.below-banner {
		top: 3.5rem;
	}
	.fs-btn.awake,
	.fs-btn:focus-visible {
		opacity: 1;
		pointer-events: auto;
	}
	.fs-btn:hover {
		background: var(--color-primary);
		color: var(--color-primary-content);
		border-color: var(--color-primary);
	}
	.fs-btn.failed {
		border-color: var(--color-error);
		color: var(--color-error);
	}
	.glyph {
		font-size: 1rem;
		line-height: 1;
	}
	kbd {
		padding: 0.05rem 0.3rem;
		border: 1px solid rgb(from var(--color-base-content) r g b / 0.3);
		border-radius: 0.2rem;
		font-family: ui-monospace, monospace;
		font-size: 0.65rem;
		opacity: 0.75;
	}
	/* Touch devices have no hover and no F key, so the keycap is noise and the
	   label alone is the target. */
	@media (max-width: 640px) {
		kbd {
			display: none;
		}
		.fs-btn.below-banner {
			top: 3rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.fs-btn {
			transition: none;
		}
	}
	:global(html.overlay-cursor-idle) {
		cursor: none;
	}
</style>
