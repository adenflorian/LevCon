export type SessionVisibility = "all" | "active";

export type MixerSession = {
	id: string;
	displayName: string;
	processName: string;
	volume: number;
	muted: boolean;
	active: boolean;
};

export type MixerSlotSettings = {
	showApps?: SessionVisibility;
	slotIndex?: number;
	stepSize?: number;
};

export type MixerViewModel = {
	page: number;
	totalPages: number;
	session?: MixerSession;
	sessionCount: number;
	slotCount: number;
};