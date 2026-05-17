import type { KeyAction } from '@elgato/streamdeck';

type PagerRenderState = {
	image?: string;
	title?: string;
};

const pagerRenderStateByContext = new Map<string, PagerRenderState>();

function renderHiddenPagerKeySvg(): string {
	return `data:image/svg+xml;utf8,${encodeURIComponent(`
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
			<rect width="144" height="144" fill="#000000" fill-opacity="0"/>
		</svg>
	`)}`;
}

export function renderPagerKeySvg(label: string, direction: 'left' | 'right', page: number, totalPages: number): string {
	const chevron = direction === 'left'
		? '<path d="M86 39 58 72l28 33" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="10"/>'
		: '<path d="M58 39 86 72 58 105" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="10"/>';

	return `data:image/svg+xml;utf8,${encodeURIComponent(`
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
			<rect x="6" y="6" width="132" height="132" rx="18" fill="#0f1318" stroke="#2a3139" stroke-width="2"/>
			<rect x="22" y="20" width="100" height="108" rx="24" fill="#000000" stroke="#242b33" stroke-width="2"/>
			${chevron}
			<text x="72" y="112" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, sans-serif" font-size="22" font-weight="800">${label}</text>
			<text x="72" y="132" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, sans-serif" font-size="18" font-weight="800">${page}/${totalPages}</text>
		</svg>
	`)}`;
}

export async function renderPagerAction(action: KeyAction<Record<string, never>>, label: string, direction: 'left' | 'right', page: number, totalPages: number, visible: boolean): Promise<void> {
	const image = visible ? renderPagerKeySvg(label, direction, page, totalPages) : renderHiddenPagerKeySvg();
	const renderState = pagerRenderStateByContext.get(action.id);
	if (renderState?.image !== image) {
		await action.setImage(image);
	}
	if (renderState?.title !== '') {
		await action.setTitle('');
	}
	pagerRenderStateByContext.set(action.id, {
		image,
		title: '',
	});
}