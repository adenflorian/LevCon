export type SessionVisibility = "all" | "active";

export type MixerSession = {
	id: string;
	displayName: string;
	iconDataUri?: string;
	processName: string;
	processId?: number;
	isOutputVolume?: boolean;
	sessionIdentifier?: string;
	sessionInstanceIdentifier?: string;
	groupingParam?: string;
	state?: string;
	peakValue?: number;
	isSystemSoundsSession?: boolean;
	shortDisplayName?: string;
	volume: number;
	muted: boolean;
	active: boolean;
	recentlyActive?: boolean;
};

export type MixerSlotSettings = {
	showApps?: SessionVisibility;
	slotIndex?: number;
};

export type MixerGlobalSettings = {
	stepSize?: number;
	priorityMatchers?: string[];
};

export type MixerInspectorRequest = {
	type: "requestPreview";
	settings?: MixerSlotSettings;
};

export type MixerInspectorPreview = {
	type: "preview";
	currentSessionId?: string;
	error?: string;
	filter: SessionVisibility;
	page: number;
	sessionCount: number;
	sessions: MixerSession[];
	slotIndex: number;
	totalPages: number;
};

export type MixerViewModel = {
	page: number;
	totalPages: number;
	session?: MixerSession;
	sessionCount: number;
	slotCount: number;
};