import streamDeck, {
  action, KeyAction, KeyDownEvent, SingletonAction, WillAppearEvent, WillDisappearEvent
} from '@elgato/streamdeck';

import { audioSessionProvider } from '../services/audio-session-provider';
import { mixerRuntime } from '../services/mixer-runtime';

import type { MixerGlobalSettings } from '../types/mixer';

type ToggleActionSettings = Record<string, never>;
type ToggleActionInstance = KeyAction<ToggleActionSettings>;

export const TOGGLE_OUTPUT_VOLUME_UUID = 'com.david-valachovic.levcon.output.toggle';

let outputVisibilityLoaded: Promise<void> | undefined;
const visibleActions = new Map<string, ToggleActionInstance>();

streamDeck.settings.onDidReceiveGlobalSettings<MixerGlobalSettings>((ev) => {
	audioSessionProvider.setShowOutputVolume(ev.settings.showOutputVolume);
	for (const action of visibleActions.values()) {
		void renderToggleAction(action);
	}
});

@action({ UUID: TOGGLE_OUTPUT_VOLUME_UUID })
export class ToggleOutputVolumeVisibilityAction extends SingletonAction<ToggleActionSettings> {
	public override async onKeyDown(ev: KeyDownEvent<ToggleActionSettings>): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}

		await ensureOutputVisibilityLoaded();
		const settings = await streamDeck.settings.getGlobalSettings<MixerGlobalSettings>();
		const nextShowOutputVolume = !(settings.showOutputVolume ?? true);
		const nextSettings: MixerGlobalSettings = {
			...settings,
			showOutputVolume: nextShowOutputVolume,
		};

		audioSessionProvider.setShowOutputVolume(nextShowOutputVolume);
		await streamDeck.settings.setGlobalSettings(nextSettings);
		await renderToggleAction(ev.action);
		await ev.action.showOk();
	}

	public override async onWillAppear(ev: WillAppearEvent<ToggleActionSettings>): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}

		const action = ev.action as ToggleActionInstance;
		visibleActions.set(action.id, action);
		mixerRuntime.registerPager({
			contextId: action.id,
			deviceId: action.device.id,
			refresh: () => renderToggleAction(action),
		});
		await ensureOutputVisibilityLoaded();
		await renderToggleAction(action);
	}

	public override onWillDisappear(ev: WillDisappearEvent<ToggleActionSettings>): void {
		visibleActions.delete(ev.action.id);
		mixerRuntime.unregister(ev.action.id);
	}
}

async function ensureOutputVisibilityLoaded(): Promise<void> {
	if (!outputVisibilityLoaded) {
		outputVisibilityLoaded = streamDeck.settings.getGlobalSettings<MixerGlobalSettings>()
			.then((settings) => {
				audioSessionProvider.setShowOutputVolume(settings.showOutputVolume);
			});
	}

	await outputVisibilityLoaded;
}

async function renderToggleAction(action: ToggleActionInstance): Promise<void> {
	const showOutputVolume = audioSessionProvider.isOutputVolumeVisible();
	await action.setImage(renderToggleOutputSvg(showOutputVolume));
	await action.setTitle('');
}

function renderToggleOutputSvg(showOutputVolume: boolean): string {
	const eye = showOutputVolume
		? '<path d="M22 72c10-18 27-28 50-28s40 10 50 28c-10 18-27 28-50 28S32 90 22 72Z" fill="none" stroke="#f4f7fb" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="72" cy="72" r="14" fill="none" stroke="#f4f7fb" stroke-width="8"/>'
		: '<path d="M22 72c10-18 27-28 50-28 14 0 26 4 36 11" fill="none" stroke="#f4f7fb" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="M122 72c-10 18-27 28-50 28-14 0-26-4-36-11" fill="none" stroke="#f4f7fb" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="M32 32 112 112" fill="none" stroke="#df2635" stroke-width="10" stroke-linecap="round"/><circle cx="72" cy="72" r="14" fill="none" stroke="#f4f7fb" stroke-width="8" opacity="0.5"/>';
	const label = showOutputVolume ? 'Output On' : 'Output Off';

	return `data:image/svg+xml;utf8,${encodeURIComponent(`
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
			${eye}
			<text x="72" y="128" text-anchor="middle" fill="#f4f7fb" font-family="Segoe UI, sans-serif" font-size="22" font-weight="700">${label}</text>
		</svg>
	`)}`;
}