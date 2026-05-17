import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { MixerSession, SessionVisibility } from "../types/mixer";

const execFileAsync = promisify(execFile);

type HelperListResponse = {
	sessions: MixerSession[];
};

type HelperMutationResponse = {
	ok: boolean;
};

export class AudioSessionProvider {
	readonly mode = "helper";

	private helperExecutablePath?: string;

	async listSessions(visibility: SessionVisibility): Promise<MixerSession[]> {
		const response = await this.runHelper<HelperListResponse>(["list", "--visibility", visibility]);
		return normalizeSessions(response.sessions);
	}

	async adjustVolume(sessionId: string, delta: number): Promise<boolean> {
		const response = await this.runHelper<HelperMutationResponse>([
			"adjust-volume",
			"--id",
			sessionId,
			"--delta",
			String(delta),
		]);

		return response.ok;
	}

	async toggleMute(sessionId: string): Promise<boolean> {
		const response = await this.runHelper<HelperMutationResponse>([
			"toggle-mute",
			"--id",
			sessionId,
		]);

		return response.ok;
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

	private async runHelper<T>(arguments_: string[]): Promise<T> {
		const helperPath = await this.resolveHelperPath();
		const { stdout, stderr } = await execFileAsync(helperPath, arguments_, {
			windowsHide: true,
		});

		if (stderr.trim().length > 0) {
			throw new Error(stderr.trim());
		}

		return JSON.parse(stdout) as T;
	}
}

export const audioSessionProvider = new AudioSessionProvider();

function normalizeSessions(sessions: MixerSession[]): MixerSession[] {
	const groups = new Map<string, MixerSession[]>();

	for (const session of sessions) {
		const key = normalizeKey(baseLabel(session));
		const group = groups.get(key);
		if (group) {
			group.push(session);
		} else {
			groups.set(key, [session]);
		}
	}

	return sessions.map((session) => {
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