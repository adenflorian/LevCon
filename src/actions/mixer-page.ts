import {
	action, KeyAction, KeyDownEvent, SingletonAction, WillAppearEvent, WillDisappearEvent
} from '@elgato/streamdeck';

import { mixerRuntime } from '../services/mixer-runtime';
import { renderPagerAction } from './ui-theme';

type PagerSettings = Record<string, never>;

type PagerActionInstance = KeyAction<PagerSettings>;

export const MIXER_PREVIOUS_UUID = "com.david-valachovic.levcon.mixer.previous";
export const MIXER_NEXT_UUID = "com.david-valachovic.levcon.mixer.next";

@action({ UUID: MIXER_PREVIOUS_UUID })
export class MixerPreviousPageAction extends SingletonAction<PagerSettings> {
	override async onKeyDown(ev: KeyDownEvent<PagerSettings>): Promise<void> {
		await mixerRuntime.movePage(ev.action.device.id, -1);
	}

	override async onWillAppear(ev: WillAppearEvent<PagerSettings>): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}

		this.registerPager(ev.action, "Prev");
		await this.render(ev.action, "Prev");
	}

	override onWillDisappear(ev: WillDisappearEvent<PagerSettings>): void {
		mixerRuntime.unregister(ev.action.id);
	}

	private registerPager(action: PagerActionInstance, label: string): void {
		mixerRuntime.registerPager({
			contextId: action.id,
			deviceId: action.device.id,
			refresh: () => this.render(action, label),
		});
	}

	private async render(action: PagerActionInstance, label: string): Promise<void> {
		const summary = await mixerRuntime.getPageSummary(action.device.id);
		await renderPagerAction(action, label, 'left', summary.page + 1, summary.totalPages, summary.hasPrevious);
	}
}

@action({ UUID: MIXER_NEXT_UUID })
export class MixerNextPageAction extends SingletonAction<PagerSettings> {
	override async onKeyDown(ev: KeyDownEvent<PagerSettings>): Promise<void> {
		await mixerRuntime.movePage(ev.action.device.id, 1);
	}

	override async onWillAppear(ev: WillAppearEvent<PagerSettings>): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}

		this.registerPager(ev.action, "Next");
		await this.render(ev.action, "Next");
	}

	override onWillDisappear(ev: WillDisappearEvent<PagerSettings>): void {
		mixerRuntime.unregister(ev.action.id);
	}

	private registerPager(action: PagerActionInstance, label: string): void {
		mixerRuntime.registerPager({
			contextId: action.id,
			deviceId: action.device.id,
			refresh: () => this.render(action, label),
		});
	}

	private async render(action: PagerActionInstance, label: string): Promise<void> {
		const summary = await mixerRuntime.getPageSummary(action.device.id);
		await renderPagerAction(action, label, 'right', summary.page + 1, summary.totalPages, summary.hasNext);
	}
}