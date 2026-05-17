import {
  action, DialAction, DialRotateEvent, DidReceiveSettingsEvent, KeyAction, KeyDownEvent,
	PropertyInspectorDidAppearEvent, SendToPluginEvent, SingletonAction, TouchTapEvent, WillAppearEvent, WillDisappearEvent
} from '@elgato/streamdeck';

import streamDeck from '@elgato/streamdeck';

import { audioSessionProvider } from '../services/audio-session-provider';
import { mixerRuntime } from '../services/mixer-runtime';

import type { MixerInspectorPreview, MixerInspectorRequest, MixerSlotSettings, SessionVisibility } from "../types/mixer";

export const MIXER_SLOT_UUID = "com.david-valachovic.levcon.mixer.slot";

type MixerSlotActionInstance = DialAction<MixerSlotSettings> | KeyAction<MixerSlotSettings>;

@action({ UUID: MIXER_SLOT_UUID })
export class MixerSlotAction extends SingletonAction<MixerSlotSettings> {
	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<MixerSlotSettings>): Promise<void> {
		const settings = await this.ensureSettings(ev.action, ev.payload.settings);
		this.registerAction(ev.action, settings);
		await this.render(ev.action, settings);
		await this.sendPreview(settings, ev.action.device.id, resolveSlotIndex(ev.action, settings));
	}

	override async onDialRotate(ev: DialRotateEvent<MixerSlotSettings>): Promise<void> {
		const settings = await this.ensureSettings(ev.action, ev.payload.settings);
		const stepSize = settings.stepSize ?? 5;
		const changed = await mixerRuntime.adjustSlot(ev.action.device.id, resolveSlotIndex(ev.action, settings), settings.showApps ?? "all", stepSize * ev.payload.ticks);
		if (!changed) {
			await ev.action.showAlert();
		}
	}

	override async onKeyDown(ev: KeyDownEvent<MixerSlotSettings>): Promise<void> {
		const settings = await this.ensureSettings(ev.action, ev.payload.settings);
		const changed = await mixerRuntime.toggleSlotMute(ev.action.device.id, resolveSlotIndex(ev.action, settings), settings.showApps ?? "all");
		if (!changed) {
			await ev.action.showAlert();
		}
	}

	override async onTouchTap(ev: TouchTapEvent<MixerSlotSettings>): Promise<void> {
		const settings = await this.ensureSettings(ev.action, ev.payload.settings);
		const changed = await mixerRuntime.toggleSlotMute(ev.action.device.id, resolveSlotIndex(ev.action, settings), settings.showApps ?? "all");
		if (!changed) {
			await ev.action.showAlert();
		}
	}

	override async onWillAppear(ev: WillAppearEvent<MixerSlotSettings>): Promise<void> {
		const settings = await this.ensureSettings(ev.action, ev.payload.settings);
		this.registerAction(ev.action, settings);
		await this.render(ev.action, settings);
		await this.sendPreview(settings, ev.action.device.id, resolveSlotIndex(ev.action, settings));
	}

	override async onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent<MixerSlotSettings>): Promise<void> {
		const settings = await this.ensureSettings(ev.action, await ev.action.getSettings<MixerSlotSettings>());
		await this.sendPreview(settings, ev.action.device.id, resolveSlotIndex(ev.action, settings));
	}

	override async onSendToPlugin(ev: SendToPluginEvent<MixerInspectorRequest, MixerSlotSettings>): Promise<void> {
		if (ev.payload.type !== "requestPreview") {
			return;
		}

		const settings = await this.ensureSettings(
			ev.action,
			ev.payload.settings ?? await ev.action.getSettings<MixerSlotSettings>(),
		);
		await this.sendPreview(settings, ev.action.device.id, resolveSlotIndex(ev.action, settings));
	}

	override onWillDisappear(ev: WillDisappearEvent<MixerSlotSettings>): void {
		mixerRuntime.unregister(ev.action.id);
	}

	private registerAction(action: MixerSlotActionInstance, settings: MixerSlotSettings): void {
		mixerRuntime.registerSlot({
			contextId: action.id,
			deviceId: action.device.id,
			filter: settings.showApps ?? "all",
			slotIndex: resolveSlotIndex(action, settings),
			refresh: () => this.render(action, settings),
		});
	}

	private async render(action: MixerSlotActionInstance, settings: MixerSlotSettings): Promise<void> {
		const view = await mixerRuntime.getView(action.device.id, resolveSlotIndex(action, settings), settings.showApps ?? "all");
		if (!view.session) {
			await action.setTitle(`Empty\n${view.page + 1}/${view.totalPages}`);
			return;
		}

		const muteLabel = view.session.muted ? "M" : `${view.session.volume}%`;
		await action.setTitle(`${labelForSession(view.session.displayName)}\n${muteLabel}`);
		if (action.isDial()) {
			await action.setTriggerDescription({
				rotate: "Adjust",
				push: "Mute",
			});
		}
	}

	private async ensureSettings(action: MixerSlotActionInstance, settings: MixerSlotSettings): Promise<MixerSlotSettings> {
		const nextSettings = withDefaults(action, settings);
		if (!sameSettings(settings, nextSettings)) {
			await action.setSettings(nextSettings);
		}

		return nextSettings;
	}

	private async sendPreview(settings: MixerSlotSettings, deviceId: string, slotIndex: number): Promise<void> {
		try {
			const filter = settings.showApps ?? defaultVisibility();
			const [sessions, view] = await Promise.all([
				audioSessionProvider.listSessions(filter),
				mixerRuntime.getView(deviceId, slotIndex, filter),
			]);

			const payload: MixerInspectorPreview = {
				type: "preview",
				currentSessionId: view.session?.id,
				filter,
				page: view.page,
				sessionCount: sessions.length,
				sessions,
				slotIndex,
				totalPages: view.totalPages,
			};

			await streamDeck.ui.sendToPropertyInspector(payload);
		} catch (error) {
			const payload: MixerInspectorPreview = {
				type: "preview",
				error: error instanceof Error ? error.message : "Unknown audio preview error.",
				filter: settings.showApps ?? defaultVisibility(),
				page: 0,
				sessionCount: 0,
				sessions: [],
				slotIndex,
				totalPages: 1,
			};

			await streamDeck.ui.sendToPropertyInspector(payload);
		}
	}
}

function labelForSession(label: string): string {
	return label.length <= 8 ? label : `${label.slice(0, 8)}`;
}

function resolveSlotIndex(action: MixerSlotActionInstance, settings: MixerSlotSettings): number {
	if (typeof settings.slotIndex === "number") {
		return Math.max(0, Math.floor(settings.slotIndex));
	}

	return action.coordinates?.column ?? 0;
}

function sameSettings(left: MixerSlotSettings, right: MixerSlotSettings): boolean {
	return left.showApps === right.showApps
		&& left.slotIndex === right.slotIndex
		&& left.stepSize === right.stepSize;
}

function withDefaults(action: MixerSlotActionInstance, settings: MixerSlotSettings): MixerSlotSettings {
	return {
		showApps: settings.showApps ?? defaultVisibility(),
		slotIndex: settings.slotIndex ?? (action.coordinates?.column ?? 0),
		stepSize: settings.stepSize ?? 5,
	};
}

function defaultVisibility(): SessionVisibility {
	return "active";
}