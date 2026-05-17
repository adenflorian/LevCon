import type { MixerSession, SessionVisibility } from "../types/mixer";

const seedSessions: MixerSession[] = [
	{ id: "discord-voice", displayName: "Discord", processName: "discord.exe", volume: 42, muted: false, active: true },
	{ id: "discord-notify", displayName: "Discord", processName: "discord.exe", volume: 18, muted: false, active: true },
	{ id: "spotify-main", displayName: "Spotify", processName: "spotify.exe", volume: 67, muted: false, active: true },
	{ id: "chrome-youtube", displayName: "Chrome", processName: "chrome.exe", volume: 55, muted: false, active: true },
	{ id: "obs-monitor", displayName: "OBS", processName: "obs64.exe", volume: 73, muted: false, active: true },
	{ id: "slack-huddle", displayName: "Slack", processName: "slack.exe", volume: 39, muted: true, active: true },
	{ id: "teams-call", displayName: "Teams", processName: "ms-teams.exe", volume: 61, muted: false, active: false },
	{ id: "vlc-player", displayName: "VLC", processName: "vlc.exe", volume: 84, muted: false, active: false },
	{ id: "game-audio", displayName: "Game", processName: "game.exe", volume: 90, muted: false, active: true },
	{ id: "browser-meet", displayName: "Edge", processName: "msedge.exe", volume: 48, muted: false, active: true },
];

export class AudioSessionProvider {
	readonly mode = "stub";

	private sessions = seedSessions.map((session) => ({ ...session }));

	async listSessions(visibility: SessionVisibility): Promise<MixerSession[]> {
		const sessions = visibility === "active"
			? this.sessions.filter((session) => session.active)
			: this.sessions;

		return sessions.map((session) => ({ ...session }));
	}

	async adjustVolume(sessionId: string, delta: number): Promise<boolean> {
		const session = this.sessions.find((candidate) => candidate.id === sessionId);
		if (!session) {
			return false;
		}

		session.volume = clamp(session.volume + delta, 0, 100);
		if (session.volume > 0) {
			session.muted = false;
		}

		return true;
	}

	async toggleMute(sessionId: string): Promise<boolean> {
		const session = this.sessions.find((candidate) => candidate.id === sessionId);
		if (!session) {
			return false;
		}

		session.muted = !session.muted;
		return true;
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export const audioSessionProvider = new AudioSessionProvider();