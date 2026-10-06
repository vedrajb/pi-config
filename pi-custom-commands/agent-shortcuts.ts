import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
	for (const mode of ["plan", "architect", "none"]) {
		pi.registerCommand(mode, {
			description: `Switch to the ${mode} agent`,
			handler: async () => {
				pi.sendUserMessage(`/agent ${mode}`, { expandPromptTemplates: true });
			},
		});
	}
}
