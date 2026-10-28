import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mergeProfileDefinitions } from "./model-profiles.mjs";
import { readSettingsSnapshot } from "./profile-storage.mjs";

export function registerProfileShortcuts(pi: ExtensionAPI, options: { agentDir: string }): void {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;
	for (const [key, direction] of [["ctrl+shift+up", 1], ["ctrl+shift+down", -1]] as const) {
		pi.registerShortcut(key, {
			description: `Cycle model profiles ${direction === 1 ? "forward" : "backward"}`,
			handler: async (ctx) => {
				if (!ctx.isIdle()) {
					if (ctx.hasUI) ctx.ui.notify("Wait for the current turn to finish before switching profiles.", "info");
					return;
				}
				const settings = readSettingsSnapshot(join(options.agentDir, "settings.json")).settings;
				const definitions = mergeProfileDefinitions(settings.modelProfiles);
				const names = Object.keys(definitions.profiles).filter((name) => name !== "list" && name.trim() === name && name.length > 0 && !/[\r\n]/.test(name));
				if (!names.length) return;
				const current = names.indexOf(definitions.active);
				const index = current < 0 ? (direction === 1 ? 0 : names.length - 1) : (current + direction + names.length) % names.length;
				pi.sendUserMessage(`/profile ${names[index]}`, { expandPromptTemplates: true });
			},
		});
	}
}
