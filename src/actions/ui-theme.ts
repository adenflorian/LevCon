import type { KeyAction } from '@elgato/streamdeck';

export function renderPagerKeySvg(direction: 'left' | 'right', page: number, totalPages: number): string {
	const chevron = direction === 'left'
		? '<path d="M86 39 58 72l28 33" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="10"/>'
		: '<path d="M58 39 86 72 58 105" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="10"/>';

	return `data:image/svg+xml;utf8,${encodeURIComponent(`
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
			<rect x="6" y="6" width="132" height="132" rx="18" fill="#0f1318" stroke="#2a3139" stroke-width="2"/>
			<rect x="32" y="28" width="80" height="88" rx="20" fill="#000000" stroke="#242b33" stroke-width="2"/>
			${chevron}
			<rect x="44" y="116" width="56" height="14" rx="7" fill="#2b323b"/>
			<text x="72" y="126.5" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, sans-serif" font-size="10" font-weight="700">${page}/${totalPages}</text>
		</svg>
	`)}`;
}

export async function renderPagerAction(action: KeyAction<Record<string, never>>, direction: 'left' | 'right', page: number, totalPages: number): Promise<void> {
	await action.setImage(renderPagerKeySvg(direction, page, totalPages));
	await action.setTitle('');
}