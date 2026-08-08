import type { RaceTemplate } from '../race-profile';
import { ALL_TEMPLATES } from '../templates';
import { normalizeQueryTokens } from './raceQuery';

/**
 * In-memory tokenized search index over the templates module.
 *
 * Built once at app boot (module scope). Each template contributes an entry
 * with tokens derived from its label, category, tags, and any state metadata
 * the spec mentions in the Race-picker section. Scoring is a tiny hand-rolled
 * matcher: per-token points (exact=3, prefix=2, substring=1), category boost,
 * early-rank boost. No external fuzzy-search dependency.
 */

interface IndexEntry {
	template: RaceTemplate;
	label: string;
	tokens: string[];
}

function tokenize(s: string): string[] {
	return s
		.toLowerCase()
		.split(/[\s\-_/|,]+/)
		.filter(Boolean);
}

export const INDEX: IndexEntry[] = ALL_TEMPLATES.map((t) => {
	const tokens = new Set<string>();
	for (const tok of tokenize(t.name)) tokens.add(tok);
	for (const tok of tokenize(t.category)) tokens.add(tok);
	for (const tag of t.tags) for (const tok of tokenize(tag)) tokens.add(tok);
	return { template: t, label: t.name, tokens: [...tokens] };
});

export interface SearchHit {
	template: RaceTemplate;
	score: number;
	matched: string[];
}

/**
 * Fallback hits kept deliberately short. These are consolation prizes, not
 * answers — the host asked for a specific race and we're offering the nearest
 * blank canvas, so a handful is generous.
 */
const PARTIAL_LIMIT = 5;

export function searchTemplates(query: string, limit = 40): SearchHit[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	// Normalized rather than raw-tokenized, so "nyc mayoral 2025" reaches the
	// city and mayor templates instead of matching nothing: nothing in the index
	// spells "mayoral" or carries a year in its tags, and only the handful of
	// city maps name a city at all.
	const qTokens = normalizeQueryTokens(q);
	if (qTokens.length === 0) return [];

	const full: SearchHit[] = [];
	const partial: SearchHit[] = [];
	for (const entry of INDEX) {
		let score = 0;
		const matched: string[] = [];
		for (const qt of qTokens) {
			let best = 0;
			for (const et of entry.tokens) {
				if (et === qt) {
					best = Math.max(best, 3);
					break;
				}
				if (et.startsWith(qt)) {
					best = Math.max(best, 2);
				} else if (et.includes(qt)) {
					best = Math.max(best, 1);
				}
			}
			if (best > 0) matched.push(qt);
			score += best;
		}
		if (matched.length === 0) continue;
		if (qTokens.includes(entry.template.category)) score += 2;
		const hit: SearchHit = { template: entry.template, score, matched };
		// Intersection search is the real answer: every word the host typed has
		// to land somewhere. Anything less goes in the partial pile.
		if (matched.length === qTokens.length) full.push(hit);
		else partial.push(hit);
	}

	const byScore = (a: SearchHit, b: SearchHit) =>
		b.score - a.score || a.template.name.localeCompare(b.template.name);
	full.sort(byScore);
	if (full.length > 0) return full.slice(0, limit);

	// Nothing matched everything. Rather than a bare "no results" — which is
	// what "new york city mayoral" used to produce, since no template names a
	// city — offer the closest starting points: the state's county map, and the
	// blank local race that the `mayor` tag reaches. civicAPI's local coverage
	// is patchy enough that building the race by hand is a normal outcome.
	//
	// Only the joint-closest are worth offering. Ranking on score alone would
	// pad the list with every template sharing one weak word: "new york city
	// mayor" would drag in New Hampshire, New Jersey and New Mexico on the
	// strength of "new", which is noise next to a template that matched twice.
	const bestMatched = partial.reduce((n, h) => Math.max(n, h.matched.length), 0);
	return partial
		.filter((h) => h.matched.length === bestMatched)
		.sort(byScore)
		.slice(0, Math.min(limit, PARTIAL_LIMIT));
}

export function highlight(label: string, matchedTokens: string[]): string {
	if (matchedTokens.length === 0) return escape(label);
	const pattern = new RegExp(
		`(${matchedTokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
		'gi'
	);
	return escape(label).replace(pattern, '<mark>$1</mark>');
}

function escape(s: string): string {
	return s.replace(/[&<>"']/g, (c) => {
		const m: Record<string, string> = {
			'&': '&amp;',
			'<': '&lt;',
			'>': '&gt;',
			'"': '&quot;',
			"'": '&#39;'
		};
		return m[c] ?? c;
	});
}
