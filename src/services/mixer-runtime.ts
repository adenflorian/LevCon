import type { MixerViewModel, SessionVisibility } from "../types/mixer";
import { audioSessionProvider } from './audio-session-provider';

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

	registerPager(registration: PagerRegistration): void {
		this.pagers.set(registration.contextId, registration);
	}

	registerSlot(registration: SlotRegistration): void {
		this.slots.set(registration.contextId, registration);
	}

	unregister(contextId: string): void {
		this.pagers.delete(contextId);
		this.slots.delete(contextId);
	}

	async adjustSlot(deviceId: string, slotIndex: number, filter: SessionVisibility, delta: number): Promise<boolean> {
		const view = await this.getView(deviceId, slotIndex, filter);
		if (!view.session) {
			return false;
		}

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
			return computeTotalPages(sessions.length, this.getSlotCount(deviceId));
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
		const totalPages = computeTotalPages(sessions.length, slotCount);
		const page = this.clampPage(deviceId, totalPages);
		const sessionIndex = page * slotCount + slotIndex;

		return {
			page,
			totalPages,
			session: sessions[sessionIndex],
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

	private async refreshDevice(deviceId: string): Promise<void> {
		const refreshables = [
			...Array.from(this.pagers.values()).filter((pager) => pager.deviceId === deviceId),
			...Array.from(this.slots.values()).filter((slot) => slot.deviceId === deviceId),
		];

		for (const refreshable of refreshables) {
			await refreshable.refresh();
		}
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function computeTotalPages(sessionCount: number, slotCount: number): number {
	return Math.max(1, Math.ceil(sessionCount / Math.max(1, slotCount)));
}

export const mixerRuntime = new MixerRuntime();