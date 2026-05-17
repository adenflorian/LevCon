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