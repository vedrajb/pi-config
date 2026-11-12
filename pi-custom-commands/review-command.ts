import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerReviewCommand(pi: ExtensionAPI): void {
	pi.registerCommand("review", {
		description: "Run a one-shot reviewer subagent: /review <instructions>",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();
			const task = (args ?? "").trim() || "Review the current uncommitted changes.";
			const requestId = `review-${randomUUID()}`;
			const reply: any = await new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					unsubscribe();
					reject(new Error(`No review launch reply. Enable pi-subagents and /reload. Check /subagents-fleet before retrying; a review may have started (request ${requestId}).`));
				}, 3000);
				const unsubscribe = pi.events.on(`subagents:rpc:v1:reply:${requestId}`, (value) => {
					clearTimeout(timer);
					unsubscribe();
					resolve(value);
				});
				try {
					pi.events.emit("subagents:rpc:v1:request", {
						version: 1,
						requestId,
						method: "spawn",
						params: {
							agent: "reviewer",
							task: `Perform a read-only code review. Report actionable defects with severity and file/line evidence, and state any validation limits. Do not edit files or implement fixes.\n\nUser instructions:\n${task}`,
						},
					});
				} catch (error) {
					clearTimeout(timer);
					unsubscribe();
					reject(error);
				}
			});
			if (reply?.success !== true) throw new Error(`Review launch failed: ${reply?.error?.message ?? "Invalid pi-subagents response"}`);
			pi.sendMessage({ customType: "pi-review", content: `Reviewer started.\n\n${task}`, display: true, details: reply.data });
		},
	});
}
