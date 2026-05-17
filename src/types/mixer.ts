export type MixerSession = {
	id: string;
	displayName: string;
	iconDataUri?: string;
	processName: string;
	processId?: number;
	processCommandLine?: string;
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
	lastAudibleAt?: number;
	recentlyActive?: boolean;
};

export type MixerSlotSettings = Record<string, never>;

export type MixerGlobalSettings = {
	stepSize?: number;
	priorityMatchers?: string[];
	blacklistMatchers?: string[];
	showOutputVolume?: boolean;
};

export type MixerViewModel = {
	page: number;
	totalPages: number;
	session?: MixerSession;
	sessionCount: number;
	slotCount: number;
};