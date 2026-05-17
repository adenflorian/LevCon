import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import type { MixerSession, SessionVisibility } from "../types/mixer";

const INACTIVE_ICON_DELAY_MS = 5_000;

type HelperListResponse = {
	endpoint: MixerSession;
	sessions: MixerSession[];
};

type HelperMutationResponse = {
	ok: boolean;
};

type HelperRequest = {
	command: "list" | "adjust-volume" | "toggle-mute";
	visibility?: SessionVisibility;
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
	private readonly cachedSessionsByVisibility = new Map<SessionVisibility, MixerSession[]>();
	private readonly inFlightSessionsByVisibility = new Map<SessionVisibility, Promise<MixerSession[]>>();
	private helperProcess?: ChildProcessWithoutNullStreams;
	private helperStdout?: readline.Interface;
	private helperStderr = "";
	private helperRequestChain = Promise.resolve();
	private pendingHelperResponses: PendingHelperResponse[] = [];

	async listSessions(visibility: SessionVisibility): Promise<MixerSession[]> {
		const cachedSessions = this.cachedSessionsByVisibility.get(visibility);
		if (cachedSessions) {
			void this.refreshSessions(visibility);
			return cachedSessions;
		}

		return this.refreshSessions(visibility);
	}

	applyOptimisticVolumeChange(sessionId: string, delta: number): void {
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

	setOptimisticSessionState(session: MixerSession): void {
		this.optimisticStateBySessionId.set(session.id, {
			volume: session.volume,
			muted: session.muted,
		});
		this.updateCachedSession(session.id, () => ({
			...session,
		}));
	}

	async adjustVolume(sessionId: string, delta: number): Promise<boolean> {
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

	async toggleMute(sessionId: string): Promise<boolean> {
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

	private refreshSessions(visibility: SessionVisibility): Promise<MixerSession[]> {
		const inFlight = this.inFlightSessionsByVisibility.get(visibility);
		if (inFlight) {
			return inFlight;
		}

		const nextFetch = this.fetchSessions(visibility)
			.finally(() => {
				this.inFlightSessionsByVisibility.delete(visibility);
			});

		this.inFlightSessionsByVisibility.set(visibility, nextFetch);
		return nextFetch;
	}

	private async fetchSessions(visibility: SessionVisibility): Promise<MixerSession[]> {
		const response = await this.runHelper<HelperListResponse>({
			command: "list",
			visibility,
		});
		const sessions = normalizeSessions(this.decorateRecentActivity(this.applyOptimisticState([response.endpoint, ...response.sessions])));
		this.cachedSessionsByVisibility.set(visibility, sessions);
		return sessions;
	}

	private async refreshAllSessionCaches(): Promise<void> {
		await Promise.all([
			this.refreshSessions("all"),
			this.refreshSessions("active"),
		]);
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
			const lastActiveAt = session.active ? now : this.lastActiveAtBySessionId.get(session.id);

			if (session.active) {
				this.lastActiveAtBySessionId.set(session.id, now);
			}

			return {
				...session,
				recentlyActive: session.active || (lastActiveAt !== undefined && now - lastActiveAt < INACTIVE_ICON_DELAY_MS),
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
		for (const [visibility, sessions] of this.cachedSessionsByVisibility.entries()) {
			let changed = false;
			const nextSessions = sessions.map((session) => {
				if (session.id !== sessionId) {
					return session;
				}

				changed = true;
				return updater(session);
			});

			if (changed) {
				this.cachedSessionsByVisibility.set(visibility, nextSessions);
			}
		}
	}
}

export const audioSessionProvider = new AudioSessionProvider();

function normalizeSessions(sessions: MixerSession[]): MixerSession[] {
	const pinnedOutput = sessions.find((session) => session.isOutputVolume);
	const appSessions = sessions.filter((session) => !session.isOutputVolume);
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

		const suffix = duplicateSuffix(session, group);
		const label = `${baseLabel(session)} (${suffix})`;

		return {
			...session,
			displayName: label,
			shortDisplayName: compactLabel(baseLabel(session), suffix),
		};
	});

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
	if (session.processId) {
		return `${session.processId}`.slice(-3);
	}

	const index = group.findIndex((candidate) => candidate.id === session.id);
	return `${index + 1}`;
}

function normalizeKey(value: string): string {
	return value.trim().toLowerCase();
}