import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import type { MixerSession } from "../types/mixer";

const INACTIVE_ICON_DELAY_MS = 5_000;
const PEAK_ACTIVITY_THRESHOLD = 0.001;
let sessionPriorityMatchers: string[] = [];
const DEFAULT_BLACKLIST_MATCHERS = ["system sounds"];
let sessionBlacklistMatchers: string[] = DEFAULT_BLACKLIST_MATCHERS;

type HelperListResponse = {
	endpoint: MixerSession;
	sessions: MixerSession[];
};

type HelperMutationResponse = {
	ok: boolean;
};

type HelperRequest = {
	command: "list" | "adjust-volume" | "toggle-mute";
	id?: string;
	delta?: number;
};

type HelperErrorResponse = {
	error: string;
};

type PendingHelperResponse = {
	resolve: (value: any) => void;
	reject: (reason?: unknown) => void;
};

export class AudioSessionProvider {
	readonly mode = "helper";

	private helperExecutablePath?: string;
	private readonly lastActiveAtBySessionId = new Map<string, number>();
	private readonly optimisticStateBySessionId = new Map<string, { volume?: number; muted?: boolean }>();
	private cachedSessions?: MixerSession[];
	private inFlightSessions?: Promise<MixerSession[]>;
	private helperProcess?: ChildProcessWithoutNullStreams;
	private helperStdout?: readline.Interface;
	private helperStderr = "";
	private helperRequestChain = Promise.resolve();
	private pendingHelperResponses: PendingHelperResponse[] = [];

	public async listSessions(): Promise<MixerSession[]> {
		if (this.cachedSessions) {
			void this.refreshSessions();
			return this.cachedSessions;
		}

		return this.refreshSessions();
	}

	public setPriorityMatchers(matchers: string[] | undefined): void {
		sessionPriorityMatchers = normalizePriorityMatchers(matchers);
		this.cachedSessions = undefined;
	}

	public setBlacklistMatchers(matchers: string[] | undefined): void {
		sessionBlacklistMatchers = normalizeBlacklistMatchers(matchers);
		this.cachedSessions = undefined;
	}

	public applyOptimisticVolumeChange(sessionId: string, delta: number): void {
		const current = this.optimisticStateBySessionId.get(sessionId);
		const nextVolume = Math.max(0, Math.min(100, (current?.volume ?? 0) + delta));
		this.optimisticStateBySessionId.set(sessionId, {
			...current,
			volume: nextVolume,
			muted: nextVolume > 0 ? false : current?.muted,
		});
		this.updateCachedSession(sessionId, (session) => ({
			...session,
			volume: nextVolume,
			muted: nextVolume > 0 ? false : session.muted,
		}));
	}

	public setOptimisticSessionState(session: MixerSession): void {
		this.optimisticStateBySessionId.set(session.id, {
			volume: session.volume,
			muted: session.muted,
		});
		this.updateCachedSession(session.id, () => ({
			...session,
		}));
	}

	public async adjustVolume(sessionId: string, delta: number): Promise<boolean> {
		const response = await this.runHelper<HelperMutationResponse>({
			command: "adjust-volume",
			id: sessionId,
			delta,
		});

		if (!response.ok) {
			this.optimisticStateBySessionId.delete(sessionId);
		}

		await this.refreshAllSessionCaches();

		return response.ok;
	}

	public async toggleMute(sessionId: string): Promise<boolean> {
		const response = await this.runHelper<HelperMutationResponse>({
			command: "toggle-mute",
			id: sessionId,
		});

		if (!response.ok) {
			this.optimisticStateBySessionId.delete(sessionId);
		}

		await this.refreshAllSessionCaches();

		return response.ok;
	}

	private refreshSessions(): Promise<MixerSession[]> {
		if (this.inFlightSessions) {
			return this.inFlightSessions;
		}

		const nextFetch = this.fetchSessions()
			.finally(() => {
				this.inFlightSessions = undefined;
			});

		this.inFlightSessions = nextFetch;
		return nextFetch;
	}

	private async fetchSessions(): Promise<MixerSession[]> {
		const response = await this.runHelper<HelperListResponse>({
			command: "list",
		});
		const sessions = normalizeSessions(this.decorateRecentActivity(this.applyOptimisticState([response.endpoint, ...response.sessions])));
		this.cachedSessions = sessions;
		return sessions;
	}

	private async refreshAllSessionCaches(): Promise<void> {
		await this.refreshSessions();
	}

	private async resolveHelperPath(): Promise<string> {
		if (this.helperExecutablePath) {
			return this.helperExecutablePath;
		}

		const candidates = [
			path.resolve(process.cwd(), "com.david-valachovic.levcon.sdPlugin", "bin", "audio-helper", "LevCon.AudioHelper.exe"),
			path.resolve(process.cwd(), "bin", "audio-helper", "LevCon.AudioHelper.exe"),
			path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../com.david-valachovic.levcon.sdPlugin/bin/audio-helper/LevCon.AudioHelper.exe"),
		];

		for (const candidate of candidates) {
			try {
				await access(candidate);
				this.helperExecutablePath = candidate;
				return candidate;
			} catch {
				// Try the next candidate.
			}
		}

		throw new Error(`LevCon audio helper executable not found. Expected one of: ${candidates.join(", ")}`);
	}

	private async runHelper<T>(request: HelperRequest): Promise<T> {
		const runRequest = async (): Promise<T> => {
			const child = await this.ensureHelperProcess();

			return new Promise<T>((resolve, reject) => {
				const pendingResponse: PendingHelperResponse = { resolve, reject };
				this.pendingHelperResponses.push(pendingResponse);
				child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
					if (!error) {
						return;
					}

					const index = this.pendingHelperResponses.indexOf(pendingResponse);
					if (index >= 0) {
						this.pendingHelperResponses.splice(index, 1);
					}
					reject(error);
				});
			});
		};

		const nextRequest = this.helperRequestChain.then(runRequest, runRequest);
		this.helperRequestChain = nextRequest.then(() => undefined, () => undefined);
		return nextRequest;
	}

	private async ensureHelperProcess(): Promise<ChildProcessWithoutNullStreams> {
		if (this.helperProcess && !this.helperProcess.killed && this.helperProcess.exitCode === null) {
			return this.helperProcess;
		}

		const helperPath = await this.resolveHelperPath();
		const child = spawn(helperPath, ["serve"], {
			windowsHide: true,
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.helperProcess = child;
		this.helperStderr = "";
		this.helperStdout?.close();
		this.helperStdout = readline.createInterface({ input: child.stdout });
		this.helperStdout.on("line", (line) => {
			const pendingResponse = this.pendingHelperResponses.shift();
			if (!pendingResponse) {
				return;
			}

			try {
				const message = JSON.parse(line) as unknown;
				if (typeof message === "object" && message && "error" in message) {
					pendingResponse.reject(new Error((message as HelperErrorResponse).error));
					return;
				}

				pendingResponse.resolve(message);
			} catch (error) {
				pendingResponse.reject(error);
			}
		});

		child.stderr.on("data", (chunk) => {
			this.helperStderr += chunk.toString();
		});

		child.on("exit", (code, signal) => {
			const reason = this.helperStderr.trim() || `Helper exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"}).`;
			this.helperProcess = undefined;
			this.helperStdout?.close();
			this.helperStdout = undefined;

			while (this.pendingHelperResponses.length > 0) {
				this.pendingHelperResponses.shift()?.reject(new Error(reason));
			}
		});

		return child;
	}

	private decorateRecentActivity(sessions: MixerSession[]): MixerSession[] {
		const now = Date.now();
		const liveSessionIds = new Set<string>();

		const nextSessions = sessions.map((session) => {
			liveSessionIds.add(session.id);
			const audiblyActive = isAudiblyActive(session);
			const lastActiveAt = audiblyActive ? now : this.lastActiveAtBySessionId.get(session.id);

			if (audiblyActive) {
				this.lastActiveAtBySessionId.set(session.id, now);
			}

			return {
				...session,
				recentlyActive: session.isOutputVolume || audiblyActive || (lastActiveAt !== undefined && now - lastActiveAt < INACTIVE_ICON_DELAY_MS),
			};
		});

		for (const [sessionId, lastActiveAt] of this.lastActiveAtBySessionId.entries()) {
			if (!liveSessionIds.has(sessionId) && now - lastActiveAt >= INACTIVE_ICON_DELAY_MS) {
				this.lastActiveAtBySessionId.delete(sessionId);
			}
		}

		return nextSessions;
	}

	private applyOptimisticState(sessions: MixerSession[]): MixerSession[] {
		return sessions.map((session) => {
			const optimisticState = this.optimisticStateBySessionId.get(session.id);
			if (!optimisticState) {
				return session;
			}

			if (optimisticState.volume === session.volume && optimisticState.muted === session.muted) {
				this.optimisticStateBySessionId.delete(session.id);
				return session;
			}

			return {
				...session,
				volume: optimisticState.volume ?? session.volume,
				muted: optimisticState.muted ?? session.muted,
			};
		});
	}

	private updateCachedSession(sessionId: string, updater: (session: MixerSession) => MixerSession): void {
		if (!this.cachedSessions) {
			return;
		}

		let changed = false;
		const nextSessions = this.cachedSessions.map((session) => {
			if (session.id !== sessionId) {
				return session;
			}

			changed = true;
			return updater(session);
		});

		if (changed) {
			this.cachedSessions = nextSessions;
		}
	}
}

export const audioSessionProvider = new AudioSessionProvider();

function normalizeSessions(sessions: MixerSession[]): MixerSession[] {
	const pinnedOutput = sessions.find((session) => session.isOutputVolume);
	const appSessions = sessions.filter((session) => !session.isOutputVolume && !isBlacklistedSession(session));
	const groups = new Map<string, MixerSession[]>();

	for (const session of appSessions) {
		const key = normalizeKey(baseLabel(session));
		const group = groups.get(key);
		if (group) {
			group.push(session);
		} else {
			groups.set(key, [session]);
		}
	}

	const normalizedApps = appSessions.map((session) => {
		const key = normalizeKey(baseLabel(session));
		const group = groups.get(key) ?? [session];
		if (group.length === 1) {
			return {
				...session,
				displayName: baseLabel(session),
				shortDisplayName: compactLabel(baseLabel(session)),
			};
		}

		const discordLabels = discordDuplicateLabels(session, group);
		if (discordLabels) {
			return {
				...session,
				displayName: discordLabels.displayName,
				shortDisplayName: discordLabels.shortDisplayName,
			};
		}

		const suffix = duplicateSuffix(session, group);
		const label = `${baseLabel(session)} (${suffix})`;

		return {
			...session,
			displayName: label,
			shortDisplayName: compactLabel(baseLabel(session), suffix),
		};
	}).sort(compareSessions);

	if (!pinnedOutput) {
		return normalizedApps;
	}

	return [{
		...pinnedOutput,
		displayName: "Output Volume",
		shortDisplayName: "Output",
		recentlyActive: true,
	}, ...normalizedApps];
}

function baseLabel(session: MixerSession): string {
	const label = session.displayName.trim() || session.processName.trim() || "Session";
	return label.replace(/\.exe$/i, "");
}

function compactLabel(label: string, suffix?: string): string {
	if (!suffix) {
		return label.length <= 8 ? label : label.slice(0, 8);
	}

	const separator = " ";
	const available = Math.max(1, 8 - suffix.length - separator.length);
	return `${label.slice(0, available)}${separator}${suffix}`;
}

function duplicateSuffix(session: MixerSession, group: MixerSession[]): string {
	const orderedGroup = [...group].sort(compareDuplicateSessions);
	const index = orderedGroup.findIndex((candidate) => candidate.id === session.id);
	return `${index + 1}`;
}

function discordDuplicateLabels(session: MixerSession, group: MixerSession[]): { displayName: string; shortDisplayName: string } | undefined {
	if (!isDiscordSession(session) || !group.every(isDiscordSession)) {
		return undefined;
	}

	const role = discordRole(session.processCommandLine);
	if (!role) {
		return undefined;
	}

	const orderedGroup = [...group].sort(compareDuplicateSessions);
	const matchingRole = orderedGroup.filter((candidate) => discordRole(candidate.processCommandLine) === role);
	const index = matchingRole.findIndex((candidate) => candidate.id === session.id);
	const suffix = matchingRole.length > 1 ? ` ${index + 1}` : "";

	if (role === "app") {
		return {
			displayName: `Discord App${suffix}`,
			shortDisplayName: `D App${suffix}`,
		};
	}

	return {
		displayName: `Discord Voice${suffix}`,
		shortDisplayName: `D Vc${suffix}`,
	};
}

function isDiscordSession(session: MixerSession): boolean {
	return normalizeKey(baseLabel(session)) === "discord" || normalizeKey(session.processName).replace(/\.exe$/i, "") === "discord";
}

function discordRole(processCommandLine: string | undefined): "app" | "voice" | undefined {
	const commandLine = normalizeKey(processCommandLine ?? "");
	if (!commandLine) {
		return undefined;
	}

	if (commandLine.includes("--utility-sub-type=audio.mojom.audioservice")) {
		return "app";
	}

	if (commandLine.includes("--type=renderer")) {
		return "voice";
	}

	return undefined;
}

function compareDuplicateSessions(left: MixerSession, right: MixerSession): number {
	const processIdComparison = compareNumber(left.processId, right.processId);
	if (processIdComparison !== 0) {
		return processIdComparison;
	}

	const sessionIdentifierComparison = compareText(left.sessionIdentifier, right.sessionIdentifier);
	if (sessionIdentifierComparison !== 0) {
		return sessionIdentifierComparison;
	}

	return compareText(left.id, right.id);
}

function compareNumber(left: number | undefined, right: number | undefined): number {
	return (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER);
}

function compareText(left: string | undefined, right: string | undefined): number {
	return (left ?? "").localeCompare(right ?? "");
}

function normalizeKey(value: string): string {
	return value.trim().toLowerCase();
}

function compareSessions(left: MixerSession, right: MixerSession): number {
	const systemRank = compareBooleanRank(isSystemSession(left), isSystemSession(right));
	if (systemRank !== 0) {
		return systemRank;
	}

	const priorityComparison = comparePriorityRank(left, right);
	if (priorityComparison !== 0) {
		return priorityComparison;
	}

	const audibleRank = compareBooleanRank(Boolean(left.recentlyActive), Boolean(right.recentlyActive));
	if (audibleRank !== 0) {
		return audibleRank;
	}

	const labelRank = baseLabel(left).localeCompare(baseLabel(right), undefined, { sensitivity: "base" });
	if (labelRank !== 0) {
		return labelRank;
	}

	const processRank = left.processName.localeCompare(right.processName, undefined, { sensitivity: "base" });
	if (processRank !== 0) {
		return processRank;
	}

	const pidRank = (left.processId ?? Number.MAX_SAFE_INTEGER) - (right.processId ?? Number.MAX_SAFE_INTEGER);
	if (pidRank !== 0) {
		return pidRank;
	}

	return left.id.localeCompare(right.id, undefined, { sensitivity: "base" });
}

function compareBooleanRank(left: boolean, right: boolean): number {
	if (left === right) {
		return 0;
	}

	return left ? -1 : 1;
}

function comparePriorityRank(left: MixerSession, right: MixerSession): number {
	const leftRank = priorityRank(left);
	const rightRank = priorityRank(right);

	if (leftRank === rightRank) {
		return 0;
	}

	return leftRank - rightRank;
}

function priorityRank(session: MixerSession): number {
	const haystacks = [session.displayName, baseLabel(session), session.processName]
		.map((value) => normalizeKey(value))
		.filter(Boolean);

	for (let index = 0; index < sessionPriorityMatchers.length; index += 1) {
		const matcher = sessionPriorityMatchers[index];
		if (haystacks.some((value) => value.includes(matcher))) {
			return index;
		}
	}

	return Number.MAX_SAFE_INTEGER;
}

function isSystemSession(session: MixerSession): boolean {
	if (session.isSystemSoundsSession) {
		return true;
	}

	const normalizedDisplayName = normalizeKey(session.displayName);
	const normalizedShortName = normalizeKey(session.shortDisplayName ?? "");
	return normalizedDisplayName === "system sounds" || normalizedShortName === "system";
}

function normalizePriorityMatchers(matchers: string[] | undefined): string[] {
	if (!matchers) {
		return [];
	}

	return [...new Set(matchers.map((matcher) => normalizeKey(matcher)).filter(Boolean))];
}

function normalizeBlacklistMatchers(matchers: string[] | undefined): string[] {
	if (!matchers) {
		return [...DEFAULT_BLACKLIST_MATCHERS];
	}

	return [...new Set(matchers.map((matcher) => normalizeKey(matcher)).filter(Boolean))];
}

function isBlacklistedSession(session: MixerSession): boolean {
	if (sessionBlacklistMatchers.length === 0) {
		return false;
	}

	const haystacks = [
		session.displayName,
		baseLabel(session),
		session.shortDisplayName ?? "",
		session.processName,
		session.processCommandLine ?? "",
	].map((value) => normalizeKey(value)).filter(Boolean);

	if (isSystemSession(session)) {
		haystacks.push("system sounds", "system");
	}

	return sessionBlacklistMatchers.some((matcher) => haystacks.some((value) => value.includes(matcher)));
}

function isAudiblyActive(session: MixerSession): boolean {
	return (session.peakValue ?? 0) > PEAK_ACTIVITY_THRESHOLD;
}