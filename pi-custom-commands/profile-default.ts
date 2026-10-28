import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mergeProfileDefinitions } from "./model-profiles.mjs";
import { readSettingsSnapshot } from "./profile-storage.mjs";

export function registerProfileDefault(pi: ExtensionAPI, options: { agentDir: string }): void {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;
	let context: ExtensionContext | undefined;
	let readySession: string | undefined;
	const scheduled = new Set<string>();
	const schedule = () => {
		if (!context?.hasUI || !context.isIdle() || context.hasPendingMessages()) return;
		const sessionId = context.sessionManager.getSessionId();
		if (!sessionId || readySession !== sessionId || scheduled.has(sessionId)) return;
		try {
			const definitions = mergeProfileDefinitions(readSettingsSnapshot(join(options.agentDir, "settings.json")).settings.modelProfiles);
			const name = definitions.pendingDefault;
			if (definitions.active || name === undefined) return;
			if (typeof name !== "string" || name === "list" || !name.trim() || name.trim() !== name || /[\r\n]/.test(name)
				|| !Object.hasOwn(definitions.profiles, name)) throw new Error("Invalid first-install default profile");
			scheduled.add(sessionId);
			pi.sendUserMessage(`/profile ${name}`, { expandPromptTemplates: true });
		} catch (error) {
			scheduled.add(sessionId);
			context.ui.notify(`Cannot activate the first-install profile: ${String(error)}. Use /profile claude after resolving the configuration.`, "error");
		}
	};
	pi.events.on("subagents:rpc:v1:ready", (value: any) => {
		if (value?.version !== 1 || typeof value.session?.sessionId !== "string") return;
		readySession = value.session.sessionId;
		schedule();
	});
	pi.on("session_start", (_event, ctx) => {
		context = ctx;
		schedule();
	});
	pi.on("session_shutdown", () => { context = undefined; });
}
