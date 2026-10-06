import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
	const modes = ["/agent plan", "/agent architect", "/agent review"];
	let modeIndex = -1;

	pi.registerShortcut("shift+tab", {
		description: "Cycle plan/architect/review agent",
		handler: async () => {
			modeIndex = (modeIndex + 1) % modes.length;
			pi.sendUserMessage(modes[modeIndex], { expandPromptTemplates: true });
		},
	});

	for (const mode of ["plan", "architect", "none"]) {
		pi.registerCommand(mode, {
			description: `Switch to the ${mode} agent`,
			handler: async () => {
				pi.sendUserMessage(`/agent ${mode}`, { expandPromptTemplates: true });
			},
		});
	}
}
