<script lang="ts">
	// Landing page. Points the host at /control (editor) and /overlay (OBS
	// Browser Source URL). Not exposed in OBS itself.
</script>

<main class="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-8">
	<header>
		<h1 class="text-3xl font-semibold">YAPms OBS Stream Overlay</h1>
		<p class="mt-2 text-base-content/70">
			Race overlay for OBS Browser Source, driven by a separate control tab.
		</p>
	</header>

	<nav class="flex flex-col gap-3">
		<a href="/control" class="btn btn-primary">Open /control (host editor)</a>
		<a href="/overlay" class="btn btn-outline">Open /overlay (OBS Browser Source URL)</a>
	</nav>

	<p class="text-sm text-base-content/60">
		Paste the <code>/overlay</code> URL into OBS → Add Source → Browser. Open
		<code>/control</code> in a regular browser tab to drive it.
	</p>
</main>
