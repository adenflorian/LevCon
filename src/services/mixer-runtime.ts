import type { MixerViewModel, SessionVisibility } from "../types/mixer";
import { audioSessionProvider } from './audio-session-provider';

const DEVICE_REFRESH_INTERVAL_MS = 1500;

type SlotRegistration = {
	contextId: string;
	deviceId: string;
	filter: SessionVisibility;
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

	registerPager(registration: PagerRegistration): void {
		this.pagers.set(registration.contextId, registration);
		this.ensureRefreshLoop();
	}

	registerSlot(registration: SlotRegistration): void {
		this.slots.set(registration.contextId, registration);
		this.ensureRefreshLoop();
	}

	unregister(contextId: string): void {
		this.pagers.delete(contextId);
		this.slots.delete(contextId);
		this.stopRefreshLoopIfIdle();
	}

	async adjustSlot(deviceId: string, slotIndex: number, filter: SessionVisibility, delta: number): Promise<boolean> {
		const view = await this.getView(deviceId, slotIndex, filter);
		if (!view.session) {
			return false;
		}

		audioSessionProvider.setOptimisticSessionState(view.session);
		audioSessionProvider.applyOptimisticVolumeChange(view.session.id, delta);
		await this.refreshDevice(deviceId);
		const updated = await audioSessionProvider.adjustVolume(view.session.id, delta);
		await this.refreshDevice(deviceId);
		return updated;
	}

	async getPageSummary(deviceId: string): Promise<{ page: number; totalPages: number; hasPrevious: boolean; hasNext: boolean }> {
		const filters = Array.from(this.slots.values())
			.filter((slot) => slot.deviceId === deviceId)
			.map((slot) => slot.filter);

		if (filters.length === 0) {
			return { page: 0, totalPages: 1, hasPrevious: false, hasNext: false };
		}

		const totals = await Promise.all(filters.map(async (filter) => {
			const sessions = await audioSessionProvider.listSessions(filter);
			const { pinnedOutput, appSessions } = splitMixerSessions(sessions);
			return computeTotalPages(appSessions.length, this.getSlotCount(deviceId), Boolean(pinnedOutput));
		}));

		const totalPages = Math.max(1, ...totals);
		const page = this.clampPage(deviceId, totalPages);

		return {
			page,
			totalPages,
			hasPrevious: page > 0,
			hasNext: page < totalPages - 1,
		};
	}

	async getView(deviceId: string, slotIndex: number, filter: SessionVisibility): Promise<MixerViewModel> {
		const sessions = await audioSessionProvider.listSessions(filter);
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

	async movePage(deviceId: string, delta: number): Promise<void> {
		const summary = await this.getPageSummary(deviceId);
		const current = this.pageByDevice.get(deviceId) ?? 0;
		const next = clamp(current + delta, 0, Math.max(0, summary.totalPages - 1));
		this.pageByDevice.set(deviceId, next);
		await this.refreshDevice(deviceId);
	}

	async toggleSlotMute(deviceId: string, slotIndex: number, filter: SessionVisibility): Promise<boolean> {
		const view = await this.getView(deviceId, slotIndex, filter);
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