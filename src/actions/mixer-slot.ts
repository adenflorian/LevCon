import streamDeck, {
	action, BarSubType, DialAction, DialRotateEvent, DidReceiveSettingsEvent, KeyAction,
	KeyDownEvent, PropertyInspectorDidAppearEvent, SendToPluginEvent, SingletonAction,
	TouchTapEvent, WillAppearEvent, WillDisappearEvent
} from '@elgato/streamdeck';

import { audioSessionProvider } from '../services/audio-session-provider';
import { mixerRuntime } from '../services/mixer-runtime';

import type { MixerInspectorPreview, MixerInspectorRequest, MixerSlotSettings, SessionVisibility } from "../types/mixer";

export const MIXER_SLOT_UUID = "com.david-valachovic.levcon.mixer.slot";
const DIAL_LAYOUT = "layouts/mixer-slot.json";

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
			if (action.isDial()) {
				await action.setFeedbackLayout(DIAL_LAYOUT);
				await action.setFeedback({
					background: renderDialBackgroundSvg(),
					icon: renderDialIconSvg(),
					level: { value: 0, bar_fill_c: "#3e4b58", bar_bg_c: "#1d252d", bar_border_c: "#1d252d", subtype: BarSubType.Groove },
					name: "Empty",
					value: `${view.page + 1}/${view.totalPages}`,
				});
			} else {
				await action.setImage(renderKeySvg());
			}

			await action.setTitle("");
			return;
		}

		const muteLabel = view.session.muted ? "M" : `${view.session.volume}%`;
		if (action.isDial()) {
			await action.setImage(renderDialIconSvg(view.session.iconDataUri, view.session.muted));
			await action.setFeedbackLayout(DIAL_LAYOUT);
			await action.setFeedback({
				background: renderDialBackgroundSvg(),
				icon: renderDialIconSvg(view.session.iconDataUri, view.session.muted),
				level: {
					value: view.session.volume,
					bar_fill_c: view.session.muted ? "#6d7783" : "#f6f8fb",
					bar_bg_c: "#242d36",
					bar_border_c: "#242d36",
					subtype: BarSubType.Groove,
				},
				name: dialLabel(view.session),
				value: muteLabel,
			});
		} else {
			await action.setImage(renderKeySvg(view.session, muteLabel));
		}

		await action.setTitle("");
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

function labelForSession(session: { displayName: string; shortDisplayName?: string }): string {
	const label = session.shortDisplayName ?? session.displayName;
	return label.length <= 8 ? label : `${label.slice(0, 8)}`;
}

function dialLabel(session: { displayName: string }): string {
	return session.displayName.length <= 18 ? session.displayName : `${session.displayName.slice(0, 18)}...`;
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function fallbackGlyphSvg(): string {
	return `data:image/svg+xml;utf8,${encodeURIComponent(`
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
			<path d="M34 7c-8.7 0-16 7.3-16 16v5.2C13.3 31.6 10 37.4 10 44c0 7.8 6.2 14 14 14h16c7.8 0 14-6.2 14-14 0-6.6-3.3-12.4-8-15.8V23c0-8.7-7.3-16-16-16Zm0 6c5.4 0 10 4.6 10 10v2.8c-3.1-1.2-6.5-1.8-10-1.8s-6.9.6-10 1.8V23c0-5.4 4.6-10 10-10Zm-6 18h12a13 13 0 0 1 13 13c0 4.4-3.6 8-8 8H19c-4.4 0-8-3.6-8-8a13 13 0 0 1 13-13h4Zm6 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z" fill="#ffffff"/>
		</svg>
	`)}`;
}

function renderDialBackgroundSvg(): string {
	return `data:image/svg+xml;utf8,${encodeURIComponent(`
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
			<rect x="0.5" y="0.5" width="199" height="99" rx="12" fill="#171d24" stroke="#242b33" />
		</svg>
	`)}`;
}

function renderDialIconSvg(iconDataUri?: string, muted = false): string {
	const icon = iconDataUri ?? fallbackGlyphSvg();
	const iconOpacity = muted ? "0.52" : "1";

	return `data:image/svg+xml;utf8,${encodeURIComponent(`
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
			<image href="${icon}" x="6" y="6" width="52" height="52" opacity="${iconOpacity}" preserveAspectRatio="xMidYMid meet" />
		</svg>
	`)}`;
}

function renderKeySvg(
	session?: { iconDataUri?: string; muted?: boolean; shortDisplayName?: string; displayName?: string },
	valueText?: string,
): string {
	const label = session ? escapeXml(labelForSession({
		shortDisplayName: session.shortDisplayName,
		displayName: session.displayName ?? "Session",
	})) : "";
	const icon = session?.iconDataUri ?? fallbackGlyphSvg();
	const muted = session?.muted ?? false;
	const value = valueText ? `<text x="72" y="124" text-anchor="middle" fill="#f4f7fb" font-family="Segoe UI, sans-serif" font-size="14" font-weight="700">${escapeXml(valueText)}</text>` : "";

	return `data:image/svg+xml;utf8,${encodeURIComponent(`
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
			<rect x="6" y="6" width="132" height="132" rx="18" fill="#0f1318" stroke="#2a3139" stroke-width="2"/>
			<image href="${icon}" x="32" y="22" width="80" height="80" opacity="${muted ? "0.5" : "1"}" preserveAspectRatio="xMidYMid meet" />
			<text x="72" y="108" text-anchor="middle" fill="#f4f7fb" font-family="Segoe UI, sans-serif" font-size="19" font-weight="700">${label}</text>
			${value}
		</svg>
	`)}`;
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