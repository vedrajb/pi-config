import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { applyProfileSettings, assertNoProfileConflicts, assertProfileScope, mergeProfileDefinitions, resolveProfile } from "./model-profiles.mjs";
import { assertSnapshot, readSettingsSnapshot, restoreProfileSettings, writeProfileSettings } from "./profile-storage.mjs";

type ProfileModel = NonNullable<ExtensionContext["model"]>;
type ResolvedProfile = Record<string, ProfileModel>;
type ModelReferences = Record<string, { provider: string; id: string }>;
type PendingProfile = {
	id: string;
	name: string;
	status: "pending" | "ready" | "failed";
	thinking: ReturnType<ExtensionAPI["getThinkingLevel"]>;
	resolved: ModelReferences;
	backup: string;
};
const entryType = "pi-model-profile";

export async function assertNoActiveSubagents(pi: Pick<ExtensionAPI, "events">, timeoutMs = 3000): Promise<void> {
	const requestId = `profile-${randomUUID()}`;
	const reply: any = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			unsubscribe();
			reject(new Error("Cannot verify subagent status. Enable pi-subagents and /reload before switching profiles."));
		}, timeoutMs);
		const unsubscribe = pi.events.on(`subagents:rpc:v1:reply:${requestId}`, (value) => {
			clearTimeout(timer);
			unsubscribe();
			resolve(value);
		});
		try {
			pi.events.emit("subagents:rpc:v1:request", { version: 1, requestId, method: "status" });
		} catch (error) {
			clearTimeout(timer);
			unsubscribe();
			reject(error);
		}
	});
	if (!reply?.success || !Number.isSafeInteger(reply.data?.fleet?.totalActive) || reply.data.fleet.totalActive < 0) {
		throw new Error("Cannot verify subagent status; no profile changes were applied.");
	}
	if (reply.data.fleet.totalActive > 0) throw new Error("Wait for active or queued subagents to finish before switching profiles.");
}

export function registerProfiles(pi: ExtensionAPI, options: { agentDir: string }): void {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;
	let switching = false;
	const settingsPath = join(options.agentDir, "settings.json");
	const report = (ctx: ExtensionContext, message: string, type: "info" | "error" = "info") => {
		if (ctx.hasUI) ctx.ui.notify(message, type);
		else pi.sendMessage({ customType: entryType, content: message, display: true });
	};
	pi.on("session_start", async (_event, ctx) => {
		const entry = ctx.sessionManager.getBranch().filter((entry) => entry.type === "custom" && entry.customType === entryType).at(-1);
		const pending = entry?.type === "custom" ? entry.data as PendingProfile : undefined;
		if (!pending || pending.status !== "pending") return;
		try {
			const settings: any = pi.getSettings();
			if (settings.defaultProvider !== pending.resolved.parent.provider || settings.defaultModel !== pending.resolved.parent.id) {
				throw new Error("Reloaded parent defaults do not match the saved profile");
			}
			for (const [role, model] of Object.entries(pending.resolved)) {
				if (role !== "parent" && settings.subagents?.agentOverrides?.[role]?.model !== `${model.provider}/${model.id}`) {
					throw new Error(`Reloaded ${role} model does not match the saved profile`);
				}
			}
			const model = ctx.modelRegistry.find(pending.resolved.parent.provider, pending.resolved.parent.id);
			if (!model || !await pi.setModel(model)) throw new Error("Cannot select profile parent model after reload");
			pi.setThinkingLevel(pending.thinking);
			if (pi.getThinkingLevel() !== pending.thinking) throw new Error("Reloaded model cannot preserve the saved effort");
			pi.appendEntry(entryType, { ...pending, status: "ready" });
			report(ctx, `Profile: ${pending.name}\n${formatModels(pending.resolved)}\nSettings backup: ${pending.backup}`);
		} catch (error) {
			pi.appendEntry(entryType, { ...pending, status: "failed" });
			report(ctx, `Profile saved but activation failed: ${String(error)}. Restore ${pending.backup} if needed, then /reload.`, "error");
		}
	});

	pi.registerCommand("profile", {
		description: "Show, list, or apply model profiles: /profile [list|name]",
		getArgumentCompletions: (prefix) => {
			const profiles = mergeProfileDefinitions(readSettingsSnapshot(settingsPath).settings.modelProfiles).profiles;
			return ["list", ...Object.keys(profiles)].filter((name) => name.startsWith(prefix)).map((name) => ({ value: name, label: name }));
		},
		handler: async (args, ctx) => {
			if (switching) throw new Error("A profile switch is already in progress");
			switching = true;
			try {
				await ctx.waitForIdle();
				const snapshot = readSettingsSnapshot(settingsPath);
				const definitions = mergeProfileDefinitions(snapshot.settings.modelProfiles);
				const name = args.trim();
				if (!name || name === "list") {
					const overrides = snapshot.settings.subagents?.agentOverrides ?? {};
					report(ctx, name === "list" ? `Profiles: ${Object.keys(definitions.profiles).join(", ")}`
						: `Last applied profile: ${definitions.active ?? "none"}${definitions.pendingDefault ? `\nPending first-install default: ${definitions.pendingDefault}` : ""}\nSelected: ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none"}\nDefault: ${snapshot.settings.defaultProvider ?? "?"}/${snapshot.settings.defaultModel ?? "?"}\n${["scout", "worker", "reviewer"].map((role) => `${role}: ${overrides[role]?.model ?? "agent default"}`).join("\n")}`);
					return;
				}
				if (!Object.hasOwn(definitions.profiles, name)) throw new Error(`Unknown profile: ${name}. Use /profile list.`);
				await assertNoActiveSubagents(pi);
				const project = ctx.isProjectTrusted() ? readSettingsSnapshot(join(ctx.cwd, ".pi", "settings.json")) : undefined;
				const scoped = ctx.scopedModels.map((entry) => entry.model);
				const models = scoped.length ? scoped : ctx.modelRegistry.getAvailable();
				const resolved = await resolveProfile(definitions.profiles[name], models, async (role: string, matches: ProfileModel[]) => {
					if (!ctx.hasUI) throw new Error(`Multiple scoped models match ${role}; apply this profile in an interactive session`);
					const selected = await ctx.ui.select(`Choose ${name} ${role} model`, matches.map((model) => `${model.provider}/${model.id}`));
					return matches.find((model) => `${model.provider}/${model.id}` === selected);
				}) as ResolvedProfile;
				for (const model of Object.values(resolved)) {
					if (!ctx.modelRegistry.hasConfiguredAuth(model)) throw new Error(`Authentication is not configured for ${model.provider}/${model.id}`);
				}
				assertNoProfileConflicts(project?.settings ?? {}, snapshot.settings, resolved);
				const effective: any = pi.getSettings();
				const modelScope = project?.settings.subagents?.modelScope ?? effective.subagents?.modelScope;
				assertProfileScope({ subagents: { modelScope } }, resolved, scoped);
				if (!ctx.model) throw new Error("Select a parent model before switching profiles so failures can restore it");
				const previous = ctx.model;
				const thinking = pi.getThinkingLevel();
				const settings = applyProfileSettings(snapshot.settings, name, resolved, definitions);
				await assertNoActiveSubagents(pi);
				assertSnapshot(snapshot);
				if (project) assertSnapshot(project);
				let committed: ReturnType<typeof writeProfileSettings> | undefined;
				try {
					if (!await pi.setModel(resolved.parent)) throw new Error("Cannot select the profile parent model");
					pi.setThinkingLevel(thinking);
					if (pi.getThinkingLevel() !== thinking) throw new Error("Profile parent model cannot preserve the current effort setting");
					if (project) assertSnapshot(project);
					committed = writeProfileSettings(snapshot, settings);
					const references = Object.fromEntries(Object.entries(resolved).map(([role, model]) => [role, { provider: model.provider, id: model.id }]));
					pi.appendEntry(entryType, { id: randomUUID(), name, status: "pending", thinking, resolved: references, backup: committed.backup } satisfies PendingProfile);
				} catch (error) {
					const failures: string[] = [];
					try {
						if (committed) restoreProfileSettings(committed, snapshot);
					} catch (restoreError) {
						failures.push(`Settings recovery failed: ${String(restoreError)}. Backup: ${committed!.backup}`);
					}
					try {
						if (!await pi.setModel(previous)) throw new Error("Previous model selection failed");
						pi.setThinkingLevel(thinking);
					} catch (restoreError) {
						failures.push(`Session recovery failed: ${String(restoreError)}`);
					}
					if (failures.length) throw new Error(`${String(error)}. ${failures.join(". ")}`);
					throw error;
				}
				try {
					await ctx.reload();
				} catch (error) {
					throw new Error(`Profile settings were saved but reload failed: ${String(error)}. Run /reload, or restore ${committed!.backup}.`);
				}
			} finally {
				switching = false;
			}
		},
	});
}

function formatModels(resolved: ModelReferences): string {
	return Object.entries(resolved).map(([role, model]) => `${role}: ${model.provider}/${model.id}`).join("\n");
}
