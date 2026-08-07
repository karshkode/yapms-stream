import type { RaceTemplate } from '../race-profile';
import { ALL_TEMPLATES } from '../templates';

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

export function searchTemplates(query: string, limit = 40): SearchHit[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	const qTokens = tokenize(q);
	if (qTokens.length === 0) return [];

	const hits: SearchHit[] = [];
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
		// Require every query token to match somewhere (intersection search).
		if (matched.length < qTokens.length) continue;
		if (qTokens.includes(entry.template.category)) score += 2;
		hits.push({ template: entry.template, score, matched });
	}

	hits.sort((a, b) => b.score - a.score || a.template.name.localeCompare(b.template.name));
	return hits.slice(0, limit);
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
