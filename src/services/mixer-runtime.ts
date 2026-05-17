import type { MixerSession, MixerViewModel } from "../types/mixer";
import { audioSessionProvider } from './audio-session-provider';

const DEVICE_REFRESH_INTERVAL_MS = 500;

type SlotRegistration = {
	contextId: string;
	deviceId: string;
	slotIndex: number;
	refresh: () => Promise<void>;
};

type PagerRegistration = {
	contextId: string;
	deviceId: string;
	refresh: () => Promise<void>;
};

class MixerRuntime {
	private readonly pageByDevice = new Map<string, number>();
	private readonly pagers = new Map<string, PagerRegistration>();
	private readonly slots = new Map<string, SlotRegistration>();
	private refreshTimer?: ReturnType<typeof setInterval>;
	private refreshLoopActive = false;

	public registerPager(registration: PagerRegistration): void {
		this.pagers.set(registration.contextId, registration);
		this.ensureRefreshLoop();
	}

	public registerSlot(registration: SlotRegistration): void {
		this.slots.set(registration.contextId, registration);
		this.ensureRefreshLoop();
	}

	public unregister(contextId: string): void {
		this.pagers.delete(contextId);
		this.slots.delete(contextId);
		this.stopRefreshLoopIfIdle();
	}

	public async adjustSlot(deviceId: string, slotIndex: number, delta: number): Promise<MixerSession | undefined> {
		const view = await this.getView(deviceId, slotIndex);
		if (!view.session) {
			return undefined;
		}

		audioSessionProvider.setOptimisticSessionState(view.session);
		audioSessionProvider.applyOptimisticVolumeChange(view.session.id, delta);
		void this.adjustVolumeImmediately(deviceId, view.session.id, delta);
		return {
			...view.session,
			volume: Math.max(0, Math.min(100, view.session.volume + delta)),
			muted: view.session.volume + delta > 0 ? false : view.session.muted,
		};
	}

	public async getPageSummary(deviceId: string): Promise<{ page: number; totalPages: number; hasPrevious: boolean; hasNext: boolean }> {
		const deviceSlots = Array.from(this.slots.values()).filter((slot) => slot.deviceId === deviceId);

		if (deviceSlots.length === 0) {
			return { page: 0, totalPages: 1, hasPrevious: false, hasNext: false };
		}

		const sessions = await audioSessionProvider.listSessions();
		const { pinnedOutput, appSessions } = splitMixerSessions(sessions);
		const totalPages = computeTotalPages(appSessions.length, this.getSlotCount(deviceId), Boolean(pinnedOutput));
		const page = this.clampPage(deviceId, totalPages);

		return {
			page,
			totalPages,
			hasPrevious: page > 0,
			hasNext: page < totalPages - 1,
		};
	}

	public async getView(deviceId: string, slotIndex: number): Promise<MixerViewModel> {
		const sessions = await audioSessionProvider.listSessions();
		const slotCount = this.getSlotCount(deviceId);
		const { pinnedOutput, appSessions } = splitMixerSessions(sessions);
		const totalPages = computeTotalPages(appSessions.length, slotCount, Boolean(pinnedOutput));
		const page = this.clampPage(deviceId, totalPages);
		const session = resolveSlotSession({
			appSessions,
			page,
			pinnedOutput,
			slotCount,
			slotIndex,
		});

		return {
			page,
			totalPages,
			session,
			sessionCount: sessions.length,
			slotCount,
		};
	}

	public async movePage(deviceId: string, delta: number): Promise<void> {
		const summary = await this.getPageSummary(deviceId);
		const current = this.pageByDevice.get(deviceId) ?? 0;
		const next = clamp(current + delta, 0, Math.max(0, summary.totalPages - 1));
		this.pageByDevice.set(deviceId, next);
		await this.refreshDevice(deviceId);
	}

	public async toggleSlotMute(deviceId: string, slotIndex: number): Promise<boolean> {
		const view = await this.getView(deviceId, slotIndex);
		if (!view.session) {
			return false;
		}

		audioSessionProvider.setOptimisticSessionState({
			...view.session,
			muted: !view.session.muted,
		});
		await this.refreshDevice(deviceId);
		const updated = await audioSessionProvider.toggleMute(view.session.id);
		await this.refreshDevice(deviceId);
		return updated;
	}

	private clampPage(deviceId: string, totalPages: number): number {
		const page = clamp(this.pageByDevice.get(deviceId) ?? 0, 0, Math.max(0, totalPages - 1));
		this.pageByDevice.set(deviceId, page);
		return page;
	}

	private getSlotCount(deviceId: string): number {
		const deviceSlots = Array.from(this.slots.values()).filter((slot) => slot.deviceId === deviceId);
		if (deviceSlots.length === 0) {
			return 1;
		}

		return Math.max(...deviceSlots.map((slot) => slot.slotIndex)) + 1;
	}

	private ensureRefreshLoop(): void {
		if (this.refreshTimer) {
			return;
		}

		this.refreshTimer = setInterval(() => {
			void this.refreshAllDevices();
		}, DEVICE_REFRESH_INTERVAL_MS);
	}

	private stopRefreshLoopIfIdle(): void {
		if (this.refreshTimer && this.pagers.size === 0 && this.slots.size === 0) {
			clearInterval(this.refreshTimer);
			this.refreshTimer = undefined;
		}
	}

	private async refreshAllDevices(): Promise<void> {
		if (this.refreshLoopActive) {
			return;
		}

		this.refreshLoopActive = true;
		try {
			const deviceIds = new Set<string>([
				...Array.from(this.pagers.values()).map((pager) => pager.deviceId),
				...Array.from(this.slots.values()).map((slot) => slot.deviceId),
			]);

			await Promise.all(Array.from(deviceIds, async (deviceId) => this.refreshDevice(deviceId)));
		} finally {
			this.refreshLoopActive = false;
		}
	}

	private async refreshDevice(deviceId: string): Promise<void> {
		const refreshables = [
			...Array.from(this.pagers.values()).filter((pager) => pager.deviceId === deviceId),
			...Array.from(this.slots.values()).filter((slot) => slot.deviceId === deviceId),
		];

		await Promise.all(refreshables.map(async (refreshable) => refreshable.refresh()));
	}

	private async adjustVolumeImmediately(deviceId: string, sessionId: string, delta: number): Promise<void> {
		await audioSessionProvider.adjustVolume(sessionId, delta);
		await this.refreshDevice(deviceId);
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function computeTotalPages(sessionCount: number, slotCount: number, hasPinnedOutput: boolean): number {
	const normalizedSlotCount = Math.max(1, slotCount);
	if (!hasPinnedOutput) {
		return Math.max(1, Math.ceil(sessionCount / normalizedSlotCount));
	}

	const firstPageCapacity = Math.max(0, normalizedSlotCount - 1);
	if (sessionCount <= firstPageCapacity) {
		return 1;
	}

	return 1 + Math.ceil((sessionCount - firstPageCapacity) / normalizedSlotCount);
}

function resolveSlotSession({
	appSessions,
	page,
	pinnedOutput,
	slotCount,
	slotIndex,
}: {
	appSessions: MixerViewModel["session"][];
	page: number;
	pinnedOutput?: MixerViewModel["session"];
	slotCount: number;
	slotIndex: number;
}): MixerViewModel["session"] {
	if (pinnedOutput && page === 0 && slotIndex === 0) {
		return pinnedOutput;
	}

	const normalizedSlotCount = Math.max(1, slotCount);
	if (!pinnedOutput) {
		return appSessions[page * normalizedSlotCount + slotIndex];
	}

	const firstPageCapacity = Math.max(0, normalizedSlotCount - 1);
	if (page === 0) {
		const firstPageIndex = slotIndex - 1;
		if (firstPageIndex < 0) {
			return undefined;
		}

		return appSessions[firstPageIndex];
	}

	if (normalizedSlotCount <= 0) {
		return undefined;
	}

	const sessionIndex = firstPageCapacity + ((page - 1) * normalizedSlotCount) + slotIndex;
	return appSessions[sessionIndex];
}

function splitMixerSessions(sessions: MixerViewModel["session"][]): {
	pinnedOutput?: MixerViewModel["session"];
	appSessions: NonNullable<MixerViewModel["session"]>[];
} {
	const pinnedOutput = sessions.find((session) => session?.isOutputVolume);
	const appSessions = sessions.filter((session): session is NonNullable<MixerViewModel["session"]> => Boolean(session && !session.isOutputVolume));
	return { pinnedOutput, appSessions };
}

export const mixerRuntime = new MixerRuntime();