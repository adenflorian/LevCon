import streamDeck, {
	action, BarSubType, DialAction, DialDownEvent, DialRotateEvent, DidReceiveSettingsEvent,
	FeedbackPayload, KeyAction, KeyDownEvent, SingletonAction, TouchTapEvent, WillAppearEvent,
	WillDisappearEvent
} from '@elgato/streamdeck';

import { audioSessionProvider } from '../services/audio-session-provider';
import { mixerRuntime } from '../services/mixer-runtime';

import type { MixerGlobalSettings, MixerSession, MixerSlotSettings } from "../types/mixer";

export const MIXER_SLOT_UUID = "com.david-valachovic.levcon.mixer.slot";
const DIAL_LAYOUT = "layouts/mixer-slot.json";
const DEFAULT_STEP_SIZE = 5;
const KEY_CANVAS_SIZE = 144;
const KEY_ICON_SIZE_PERCENT = 80;

type MixerSlotActionInstance = DialAction<MixerSlotSettings> | KeyAction<MixerSlotSettings>;
type DialRenderState = {
	icon: string;
	iconStateKey: string;
	name: string;
	feedbackKey?: string;
	layoutApplied: boolean;
};

type ActionRenderState = {
	image?: string;
	title?: string;
	triggerDescriptionKey?: string;
};

let globalStepSize = DEFAULT_STEP_SIZE;
let globalSettingsLoaded: Promise<void> | undefined;

streamDeck.settings.onDidReceiveGlobalSettings<MixerGlobalSettings>((ev) => {
	globalStepSize = clampStepSize(ev.settings.stepSize);
	audioSessionProvider.setPriorityMatchers(ev.settings.priorityMatchers);
	audioSessionProvider.setBlacklistMatchers(ev.settings.blacklistMatchers);
});

@action({ UUID: MIXER_SLOT_UUID })
export class MixerSlotAction extends SingletonAction<MixerSlotSettings> {
	private readonly dialRenderStateByContext = new Map<string, DialRenderState>();
	private readonly actionRenderStateByContext = new Map<string, ActionRenderState>();

	public override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<MixerSlotSettings>): Promise<void> {
		await ensureGlobalSettingsLoaded();
		this.registerAction(ev.action);
		await this.render(ev.action);
	}

	public override async onDialRotate(ev: DialRotateEvent<MixerSlotSettings>): Promise<void> {
		await ensureGlobalSettingsLoaded();
		const stepSize = globalStepSize;
		const session = await mixerRuntime.adjustSlot(ev.action.device.id, resolveSlotIndex(ev.action), stepSize * ev.payload.ticks);
		if (!session) {
			await ev.action.showAlert();
			return;
		}

		await this.renderDialSession(ev.action, session);
	}

	public override async onDialDown(ev: DialDownEvent<MixerSlotSettings>): Promise<void> {
		const changed = await mixerRuntime.toggleSlotMute(ev.action.device.id, resolveSlotIndex(ev.action));
		if (!changed) {
			await ev.action.showAlert();
		}
	}

	public override async onKeyDown(ev: KeyDownEvent<MixerSlotSettings>): Promise<void> {
		const changed = await mixerRuntime.toggleSlotMute(ev.action.device.id, resolveSlotIndex(ev.action));
		if (!changed) {
			await ev.action.showAlert();
		}
	}

	public override async onTouchTap(ev: TouchTapEvent<MixerSlotSettings>): Promise<void> {
		const changed = await mixerRuntime.toggleSlotMute(ev.action.device.id, resolveSlotIndex(ev.action));
		if (!changed) {
			await ev.action.showAlert();
		}
	}

	public override async onWillAppear(ev: WillAppearEvent<MixerSlotSettings>): Promise<void> {
		await ensureGlobalSettingsLoaded();
		this.registerAction(ev.action);
		await this.render(ev.action);
	}

	public override onWillDisappear(ev: WillDisappearEvent<MixerSlotSettings>): void {
		this.dialRenderStateByContext.delete(ev.action.id);
		this.actionRenderStateByContext.delete(ev.action.id);
		mixerRuntime.unregister(ev.action.id);
	}

	private registerAction(action: MixerSlotActionInstance): void {
		mixerRuntime.registerSlot({
			contextId: action.id,
			deviceId: action.device.id,
			slotIndex: resolveSlotIndex(action),
			refresh: () => this.render(action),
		});
	}

	private async render(action: MixerSlotActionInstance): Promise<void> {
		await ensureGlobalSettingsLoaded();
		const view = await mixerRuntime.getView(action.device.id, resolveSlotIndex(action));
		if (!view.session) {
			if (action.isDial()) {
				const blankDialAsset = renderTransparentAssetSvg(200, 100);
				const blankIcon = renderDialIconSvg();
				const feedback = {
					background: blankDialAsset,
					icon: blankIcon,
					level: { value: 0, bar_fill_c: "#00000000", bar_bg_c: "#00000000", bar_border_c: "#00000000", subtype: BarSubType.Groove },
					name: "",
					value: "",
				};
				const feedbackKey = JSON.stringify(feedback);
				const renderState = this.dialRenderStateByContext.get(action.id);
				if (!renderState?.layoutApplied) {
					await action.setFeedbackLayout(DIAL_LAYOUT);
				}
				if (renderState?.feedbackKey !== feedbackKey) {
					await action.setFeedback(feedback);
				}
				await this.setImageIfChanged(action, blankIcon);
				this.dialRenderStateByContext.set(action.id, {
					icon: blankIcon,
					iconStateKey: "",
					name: "",
					feedbackKey,
					layoutApplied: true,
				});
			} else {
				await this.setImageIfChanged(action, renderKeySvg());
			}

			await this.setTitleIfChanged(action, "");
			return;
		}

		if (action.isDial()) {
			await this.renderDialSession(action, view.session);
		} else {
			await this.setImageIfChanged(action, renderKeySvg(view.session));
		}

		await this.setTitleIfChanged(action, "");
		if (action.isDial()) {
			await this.setTriggerDescriptionIfChanged(action, {
				rotate: "Adjust",
				push: "Mute",
			});
		}
	}

	private async renderDialSession(action: DialAction<MixerSlotSettings>, session: MixerSession): Promise<void> {
		const muteLabel = session.muted ? "M" : `${session.volume}%`;
		const iconStateKey = dialIconStateKey(session, session.muted);
		const name = dialLabel(session);
		const renderState = this.dialRenderStateByContext.get(action.id);
		const feedback: FeedbackPayload = {
			level: {
				value: session.volume,
				bar_fill_c: session.muted ? "#6d7783" : "#f6f8fb",
				bar_bg_c: "#242d36",
				bar_border_c: "#242d36",
				subtype: BarSubType.Groove,
			},
			value: muteLabel,
		};

		if (!renderState?.layoutApplied) {
			await action.setFeedbackLayout(DIAL_LAYOUT);
			feedback.background = renderDialBackgroundSvg();
		}

		if (renderState?.name !== name) {
			feedback.name = name;
		}

		let dialIcon = renderState?.icon;
		if (renderState?.iconStateKey !== iconStateKey) {
			dialIcon = renderDialIconSvg(session, session.muted);
			await this.setImageIfChanged(action, dialIcon);
			feedback.icon = dialIcon;
		}

		const feedbackKey = JSON.stringify(feedback);
		if (renderState?.feedbackKey !== feedbackKey) {
			await action.setFeedback(feedback);
		}

		this.dialRenderStateByContext.set(action.id, {
			icon: dialIcon ?? renderDialIconSvg(session, session.muted),
			iconStateKey,
			name,
			feedbackKey,
			layoutApplied: true,
		});
	}

	private async setImageIfChanged(action: MixerSlotActionInstance, image: string): Promise<void> {
		const renderState = this.actionRenderStateByContext.get(action.id);
		if (renderState?.image === image) {
			return;
		}

		await action.setImage(image);
		this.actionRenderStateByContext.set(action.id, {
			...renderState,
			image,
		});
	}

	private async setTitleIfChanged(action: MixerSlotActionInstance, title: string): Promise<void> {
		const renderState = this.actionRenderStateByContext.get(action.id);
		if (renderState?.title === title) {
			return;
		}

		await action.setTitle(title);
		this.actionRenderStateByContext.set(action.id, {
			...renderState,
			title,
		});
	}

	private async setTriggerDescriptionIfChanged(action: DialAction<MixerSlotSettings>, description: { rotate: string; push: string }): Promise<void> {
		const triggerDescriptionKey = `${description.rotate}|${description.push}`;
		const renderState = this.actionRenderStateByContext.get(action.id);
		if (renderState?.triggerDescriptionKey === triggerDescriptionKey) {
			return;
		}

		await action.setTriggerDescription(description);
		this.actionRenderStateByContext.set(action.id, {
			...renderState,
			triggerDescriptionKey,
		});
	}
}

function labelForSession(session: { displayName: string; shortDisplayName?: string; isSystemSoundsSession?: boolean; isOutputVolume?: boolean }): string {
	if (session.isOutputVolume) {
		return "Output";
	}

	if (isSystemSession(session)) {
		return "System";
	}

	const label = session.shortDisplayName ?? session.displayName;
	return label.length <= 8 ? label : `${label.slice(0, 8)}`;
}

function keyLabelLines(session: { displayName: string; shortDisplayName?: string; isSystemSoundsSession?: boolean; isOutputVolume?: boolean }): string[] {
	if (session.isOutputVolume) {
		return ["Output"];
	}

	if (isSystemSession(session)) {
		return ["System"];
	}

	const words = session.displayName
		.split(/\s+/u)
		.map((part) => part.trim())
		.filter(Boolean);

	if (words.length >= 2 && words[0].length <= 10) {
		const firstLine = words[0];
		const secondLine = words.slice(1).join(" ");
		if (secondLine.length <= 10) {
			return [firstLine, secondLine];
		}
	}

	return [labelForSession(session)];
}


function dialLabel(session: { displayName: string; shortDisplayName?: string; isSystemSoundsSession?: boolean; isOutputVolume?: boolean }): string {
	if (session.isOutputVolume) {
		return "Output Volume";
	}

	if (isSystemSession(session)) {
		return "System Sounds";
	}

	return session.displayName.length <= 18 ? session.displayName : `${session.displayName.slice(0, 18)}...`;
}

function isSystemSession(session: { displayName: string; shortDisplayName?: string; isSystemSoundsSession?: boolean }): boolean {
	if (session.isSystemSoundsSession) {
		return true;
	}

	const normalizedDisplayName = session.displayName.trim().toLowerCase();
	const normalizedShortName = session.shortDisplayName?.trim().toLowerCase();
	return normalizedDisplayName === "system sounds" || normalizedShortName === "system";
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function renderMutedOverlaySvg(size: number, x: number, y: number): string {
	const strokeWidth = Math.max(2, Math.round(size * 0.12));

	return `
		<g transform="translate(${x} ${y})">
			<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#d93a45"/>
			<path d="M${size * 0.22} ${size * 0.42}h${size * 0.18}l${size * 0.16}-${size * 0.16}v${size * 0.48}l-${size * 0.16}-${size * 0.16}h-${size * 0.18}z" fill="#ffffff"/>
			<path d="M${size * 0.7} ${size * 0.3}L${size * 0.3} ${size * 0.7}" stroke="#ffffff" stroke-width="${strokeWidth}" stroke-linecap="round"/>
		</g>
	`;
}

function fallbackGlyphSvg(): string {
	return `data:image/svg+xml;utf8,${encodeURIComponent(`
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
			<path d="M34 7c-8.7 0-16 7.3-16 16v5.2C13.3 31.6 10 37.4 10 44c0 7.8 6.2 14 14 14h16c7.8 0 14-6.2 14-14 0-6.6-3.3-12.4-8-15.8V23c0-8.7-7.3-16-16-16Zm0 6c5.4 0 10 4.6 10 10v2.8c-3.1-1.2-6.5-1.8-10-1.8s-6.9.6-10 1.8V23c0-5.4 4.6-10 10-10Zm-6 18h12a13 13 0 0 1 13 13c0 4.4-3.6 8-8 8H19c-4.4 0-8-3.6-8-8a13 13 0 0 1 13-13h4Zm6 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z" fill="#ffffff"/>
		</svg>
	`)}`;
}

function systemSoundsGlyphSvg(): string {
	return `data:image/svg+xml;utf8,${encodeURIComponent(`
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
			<path d="M12 26h10l12-10v32L22 38H12z" fill="#ffffff"/>
			<path d="M42 24a12 12 0 0 1 0 16" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-width="4"/>
			<path d="M48 18a20 20 0 0 1 0 28" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-width="4" opacity="0.85"/>
		</svg>
	`)}`;
}

function outputVolumeGlyphSvg(): string {
	return `data:image/svg+xml;utf8,${encodeURIComponent(`
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
			<path d="M10 26h11l13-11v34L21 38H10z" fill="#ffffff"/>
			<path d="M43 18v28" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-width="4" opacity="0.95"/>
			<path d="M51 24v16" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-width="4" opacity="0.75"/>
		</svg>
	`)}`;
}

function renderTransparentAssetSvg(width: number, height: number): string {
	return `data:image/svg+xml;utf8,${encodeURIComponent(`
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
			<rect width="${width}" height="${height}" fill="#000000" fill-opacity="0"/>
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

function dialIconStateKey(
	session: { id?: string; iconDataUri?: string; shortDisplayName?: string; displayName?: string; isSystemSoundsSession?: boolean; isOutputVolume?: boolean; recentlyActive?: boolean },
	muted: boolean,
): string {
	return [
		session.id ?? "",
		session.iconDataUri ?? "",
		session.shortDisplayName ?? "",
		session.displayName ?? "",
		session.isSystemSoundsSession ? "1" : "0",
		session.isOutputVolume ? "1" : "0",
		session.recentlyActive === false ? "0" : "1",
		muted ? "1" : "0",
	].join("|");
}

function renderDialIconSvg(
	session?: { iconDataUri?: string; shortDisplayName?: string; displayName?: string; isSystemSoundsSession?: boolean; isOutputVolume?: boolean; recentlyActive?: boolean },
	muted = false,
): string {
	if (!session) {
		return renderTransparentAssetSvg(64, 64);
	}

	const icon = session.isOutputVolume
		? outputVolumeGlyphSvg()
		: (isSystemSession({
			shortDisplayName: session.shortDisplayName,
			displayName: session.displayName ?? "Session",
			isSystemSoundsSession: session.isSystemSoundsSession,
		}) ? systemSoundsGlyphSvg() : (session.iconDataUri ?? fallbackGlyphSvg()));
	const iconOpacity = muted ? (session.recentlyActive === false ? "0.38" : "0.56") : (session.recentlyActive === false ? "0.62" : "1");
	const filter = session.recentlyActive === false ? '<defs><filter id="inactive-icon"><feColorMatrix type="saturate" values="0"/></filter></defs>' : '';
	const filterAttribute = session.recentlyActive === false ? ' filter="url(#inactive-icon)"' : '';
	const mutedOverlay = muted ? renderMutedOverlaySvg(20, 38, 38) : '';

	return `data:image/svg+xml;utf8,${encodeURIComponent(`
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
			${filter}
			<image href="${icon}" x="6" y="6" width="52" height="52" opacity="${iconOpacity}" preserveAspectRatio="xMidYMid meet"${filterAttribute} />
			${mutedOverlay}
		</svg>
	`)}`;
}

function renderKeySvg(
	session?: { iconDataUri?: string; muted?: boolean; shortDisplayName?: string; displayName?: string; isSystemSoundsSession?: boolean; isOutputVolume?: boolean; recentlyActive?: boolean },
): string {
	const labelLines = session ? keyLabelLines({
		shortDisplayName: session.shortDisplayName,
		displayName: session.displayName ?? "Session",
		isSystemSoundsSession: session.isSystemSoundsSession,
		isOutputVolume: session.isOutputVolume,
	}).map(escapeXml) : [];
	const icon = session
		? (session.isOutputVolume
			? outputVolumeGlyphSvg()
			: (isSystemSession({
			shortDisplayName: session.shortDisplayName,
			displayName: session.displayName ?? "Session",
			isSystemSoundsSession: session.isSystemSoundsSession,
		}) ? systemSoundsGlyphSvg() : (session.iconDataUri ?? fallbackGlyphSvg())))
		: undefined;
	const muted = session?.muted ?? false;
	const inactive = session?.recentlyActive === false;
	const iconOpacity = muted ? (inactive ? "0.38" : "0.5") : (inactive ? "0.62" : "1");
	const filter = inactive ? '<defs><filter id="inactive-icon"><feColorMatrix type="saturate" values="0"/></filter></defs>' : '';
	const filterAttribute = inactive ? ' filter="url(#inactive-icon)"' : '';
	const keyIconSize = percentOfCanvas(KEY_ICON_SIZE_PERCENT);
	const keyIconOffset = centeredCanvasOffset(keyIconSize);
	const image = icon
		? `<image href="${icon}" x="${keyIconOffset}" y="${keyIconOffset}" width="${keyIconSize}" height="${keyIconSize}" opacity="${iconOpacity}" preserveAspectRatio="xMidYMid meet"${filterAttribute} />`
		: "";
	const mutedOverlay = muted ? renderMutedOverlaySvg(28, 86, 68) : '';
	const label = labelLines.length > 1
		? `
				<text x="72" y="98" text-anchor="middle" fill="#f4f7fb" font-family="Segoe UI, sans-serif" font-size="26" font-weight="700">
					${labelLines[0]}
				</text>
				<text x="72" y="120" text-anchor="middle" fill="#f4f7fb" font-family="Segoe UI, sans-serif" font-size="26" font-weight="700">
					${labelLines[1]}
				</text>
			`
		: `
				<text x="72" y="110" text-anchor="middle" fill="#f4f7fb" font-family="Segoe UI, sans-serif" font-size="26" font-weight="700">
					${labelLines[0] ?? ""}
				</text>
			`
		;

	return `data:image/svg+xml;utf8,${encodeURIComponent(`
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
			<rect x="6" y="6" width="132" height="132" rx="18" fill="#0f1318" stroke="#2a3139" stroke-width="2"/>
			${filter}
			${image}
			${mutedOverlay}
			${label}
		</svg>
	`)}`;
}

function percentOfCanvas(percent: number): number {
	return (KEY_CANVAS_SIZE * percent) / 100;
}

function centeredCanvasOffset(size: number): number {
	return (KEY_CANVAS_SIZE - size) / 2;
}

function resolveSlotIndex(action: MixerSlotActionInstance): number {
	return action.coordinates?.column ?? 0;
}

async function ensureGlobalSettingsLoaded(): Promise<void> {
	if (!globalSettingsLoaded) {
		globalSettingsLoaded = streamDeck.settings.getGlobalSettings<MixerGlobalSettings>()
			.then((settings) => {
				globalStepSize = clampStepSize(settings.stepSize);
				audioSessionProvider.setPriorityMatchers(settings.priorityMatchers);
				audioSessionProvider.setBlacklistMatchers(settings.blacklistMatchers);
			});
	}

	await globalSettingsLoaded;
}

function clampStepSize(stepSize: number | undefined): number {
	if (typeof stepSize !== 'number' || Number.isNaN(stepSize)) {
		return DEFAULT_STEP_SIZE;
	}

	return Math.max(1, Math.min(25, Math.round(stepSize)));
}