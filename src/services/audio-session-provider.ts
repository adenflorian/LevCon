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
		return response.sessions;
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