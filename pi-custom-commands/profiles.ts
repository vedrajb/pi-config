import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerProfiles } from "./profile-commands.ts";
import { registerProfileShortcuts } from "./profile-shortcuts.ts";
import { registerProfileDefault } from "./profile-default.ts";

export default function (pi: ExtensionAPI): void {
	const options = { agentDir: getAgentDir() };
	registerProfiles(pi, options);
	registerProfileShortcuts(pi, options);
	registerProfileDefault(pi, options);
}
