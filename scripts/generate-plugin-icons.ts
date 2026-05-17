import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

type IconTarget = {
	svgName: string;
	pngName: string;
	size: number;
};

const pluginIconDir = path.resolve('com.david-valachovic.levcon.sdPlugin', 'imgs', 'plugin');
const tempIconDir = path.resolve('.tmp', 'generated-icons');

const targets: IconTarget[] = [
	{ svgName: 'category-icon.svg', pngName: 'category-icon.png', size: 28 },
	{ svgName: 'category-icon.svg', pngName: 'category-icon@2x.png', size: 56 },
	{ svgName: 'marketplace.svg', pngName: 'marketplace.png', size: 288 },
	{ svgName: 'marketplace.svg', pngName: 'marketplace@2x.png', size: 512 },
];

const categorySvgMarkup = createCategoryIconSvg();
const marketplaceSvgMarkup = createMarketplaceIconSvg();

await mkdir(pluginIconDir, { recursive: true });
await mkdir(tempIconDir, { recursive: true });
await Promise.all([
	writeFile(path.join(tempIconDir, 'category-icon.svg'), categorySvgMarkup),
	writeFile(path.join(tempIconDir, 'marketplace.svg'), marketplaceSvgMarkup),
]);

await Promise.all(targets.map(async (target) => {
	const svgTempPath = path.join(tempIconDir, target.svgName);
	const pngPath = path.join(pluginIconDir, target.pngName);

	await sharp(svgTempPath)
		.resize(target.size, target.size)
		.png()
		.toFile(pngPath);
}));

function createCategoryIconSvg(): string {
	return `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" fill="none">
	<g fill="#FFFFFF">
		<path d="M100 206.5C100 194.074 110.074 184 122.5 184H189.638L279.379 111.445C293.963 99.6585 316 110.038 316 128.788V383.212C316 401.962 293.963 412.341 279.379 400.555L189.638 328H122.5C110.074 328 100 317.926 100 305.5V206.5Z"/>
		<rect x="336" y="294" width="20" height="60" rx="10"/>
		<rect x="373" y="254" width="20" height="100" rx="10"/>
		<rect x="410" y="209" width="20" height="145" rx="10"/>
		<rect x="447" y="171" width="20" height="183" rx="10"/>
	</g>
</svg>`.trimStart();
}

function createMarketplaceIconSvg(): string {
	return `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" fill="none">
	<defs>
		<linearGradient id="bg" x1="46" y1="34" x2="456" y2="478" gradientUnits="userSpaceOnUse">
			<stop stop-color="#171B24"/>
			<stop offset="1" stop-color="#11151D"/>
		</linearGradient>
		<radialGradient id="sheen" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(176 152) rotate(38) scale(288 364)">
			<stop stop-color="#252A36" stop-opacity="0.35"/>
			<stop offset="0.52" stop-color="#171B24" stop-opacity="0"/>
			<stop offset="1" stop-color="#171B24" stop-opacity="0"/>
		</radialGradient>
		<linearGradient id="speakerFill" x1="92" y1="143" x2="301" y2="378" gradientUnits="userSpaceOnUse">
			<stop stop-color="#FFFFFF"/>
			<stop offset="1" stop-color="#F3F5F8"/>
		</linearGradient>
		<linearGradient id="barFill" x1="292" y1="188" x2="402" y2="357" gradientUnits="userSpaceOnUse">
			<stop stop-color="#FFFFFF"/>
			<stop offset="1" stop-color="#EEF2F7"/>
		</linearGradient>
	</defs>
	<rect width="512" height="512" rx="88" fill="url(#bg)"/>
	<rect width="512" height="512" rx="88" fill="url(#sheen)"/>
	<g>
		<path fill="url(#speakerFill)" d="M100 206.5C100 194.074 110.074 184 122.5 184H189.638L279.379 111.445C293.963 99.6585 316 110.038 316 128.788V383.212C316 401.962 293.963 412.341 279.379 400.555L189.638 328H122.5C110.074 328 100 317.926 100 305.5V206.5Z"/>
		<rect x="336" y="294" width="20" height="60" rx="10" fill="url(#barFill)"/>
		<rect x="373" y="254" width="20" height="100" rx="10" fill="url(#barFill)"/>
		<rect x="410" y="209" width="20" height="145" rx="10" fill="url(#barFill)"/>
		<rect x="447" y="171" width="20" height="183" rx="10" fill="url(#barFill)"/>
	</g>
</svg>`.trimStart();
}