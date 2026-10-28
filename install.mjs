#!/usr/bin/env node
// Installs the Pi packages listed in install.config.json with `pi install`.
// Remote (npm:/git:/URL) packages are also upgraded with `pi update <source>`.
// Backs up user configuration, deploys agents, merges workflow settings, and removes replaced packages.
// Usage: node install.mjs [--dry-run]
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, posix, resolve, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mergeProfileDefinitions } from "./pi-custom-commands/model-profiles.mjs";

const repoRoot = dirname(fileURLToPath(import.meta.url));

export function loadConfig(configPath) {
	const config = JSON.parse(readFileSync(configPath, "utf8"));
	if (!Array.isArray(config.packages) || config.packages.some((p) => typeof p !== "string" || !p.trim())) {
		throw new Error(`${configPath}: "packages" must be an array of non-empty strings`);
	}
	if (config.removePackages !== undefined && (!Array.isArray(config.removePackages) || config.removePackages.some((p) => typeof p !== "string" || !p.trim()))) {
		throw new Error(`${configPath}: "removePackages" must be an array of non-empty strings`);
	}
	if (config.packages.some((source) => config.removePackages?.includes(source))) {
		throw new Error(`${configPath}: packages cannot also appear in removePackages`);
	}
	return config;
}

// npm:/git:/URL sources are passed through; anything else is a path relative to baseDir.
export function isRemoteSource(source) {
	return /^(npm:|git:|git\+|https?:\/\/|ssh:\/\/)/.test(source);
}

export function resolveSource(source, baseDir) {
	if (isRemoteSource(source)) return source;
	const fullPath = resolve(baseDir, source);
	if (!existsSync(fullPath)) throw new Error(`Package path not found: ${fullPath}`);
	return fullPath;
}

export function installPackages(
	config,
	{ baseDir, dryRun = false, run = runPiInstall, update = runPiUpdate, log = console.log } = {},
) {
	const sources = config.packages.map((source) => resolveSource(source, baseDir));
	const prefix = dryRun ? "[dry-run] " : "";
	for (const source of sources) {
		log(`${prefix}pi install ${source}`);
		if (!dryRun) run(source);
		// Local paths are loaded in place, so only remote packages need upgrading.
		if (isRemoteSource(source)) {
			log(`${prefix}pi update ${source}`);
			if (!dryRun) update(source);
		}
	}
	return sources;
}

// settings.json is merged separately; extra user files are retained.
const userConfigEntries = ["agents", "AGENTS.md"];

export function copyUserConfig({
	sourceDir = resolve(repoRoot, ".pi.user"),
	targetDir = resolve(homedir(), ".pi", "agent"),
	homeDir = homedir(),
	dryRun = false,
	log = console.log,
	copy = copyRecursive,
} = {}) {
	const prefix = dryRun ? "[dry-run] " : "";
	const copied = [];
	for (const entry of userConfigEntries) {
		const src = resolve(sourceDir, entry);
		if (!existsSync(src)) throw new Error(`User config path not found: ${src}`);
		const dest = resolve(targetDir, entry);
		log(`${prefix}copy ${src} -> ${dest}`);
		if (!dryRun) {
			if (entry === "AGENTS.md" && copy === copyRecursive) {
				const incoming = readFileSync(src, "utf8");
				const content = existsSync(dest) ? mergeInstructions(readFileSync(dest, "utf8"), incoming) : incoming;
				writeFileSync(dest, renderInstructionPaths(content, homeDir));
			} else copy(src, dest);
		}
		copied.push(dest);
	}
	return copied;
}

export function renderInstructionPaths(content, homeDir = homedir()) {
	const paths = /^(?:[a-z]:[\\/]|\\\\)/i.test(homeDir) ? win32 : posix;
	const skillPath = paths.join(homeDir, ".agents", "skills", "caveman-commit", "SKILL.md");
	return content
		.replaceAll("{{CAVEMAN_COMMIT_SKILL}}", () => skillPath)
		.replace(/(?<![\w:\/\\])(?:[a-z]:[\\/]|\\\\|\/)(?:[^\\/\r\n`]+[\\/])*\.agents[\\/]skills[\\/]caveman-commit[\\/]SKILL\.md\b/gi, () => skillPath);
}

export function mergeInstructions(existing, incoming) {
	for (const heading of ["Delegation", "Complex / Architect Workflow", "Plan mode"]) {
		const pattern = new RegExp(`^## ${heading}\\r?\\n[\\s\\S]*?(?=^## |$(?![\\s\\S]))`, "m");
		const section = incoming.match(pattern)?.[0];
		if (!section) continue;
		existing = pattern.test(existing)
			? existing.replace(pattern, () => `${section.trimEnd()}\n\n`)
			: `${existing.trimEnd()}\n\n${section.trimEnd()}\n`;
	}
	return `${existing.trimEnd()}\n`;
}

export function mergeSettings(existing) {
	if (!existing || typeof existing !== "object" || Array.isArray(existing)) throw new Error("settings.json must contain an object");
	if (existing.packages !== undefined && (!Array.isArray(existing.packages) || existing.packages.some((entry) =>
		typeof entry !== "string" && (!entry || typeof entry !== "object" || typeof entry.source !== "string")))) {
		throw new Error("Existing packages settings must contain package sources");
	}
	for (const value of [existing.subagents, existing.subagents?.agentOverrides, existing.subagents?.agentOverrides?.architect]) {
		if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
			throw new Error("Existing subagents settings must contain objects");
		}
	}
	return {
		...existing,
		modelProfiles: mergeProfileDefinitions(existing.modelProfiles),
		subagents: {
			...existing.subagents,
			agentOverrides: {
				...existing.subagents?.agentOverrides,
				architect: { ...existing.subagents?.agentOverrides?.architect, disabled: true },
			},
		},
	};
}

export function backupUserConfig({ targetDir, dryRun = false, log = console.log }) {
	const entries = ["settings.json", ...userConfigEntries].filter((entry) => existsSync(resolve(targetDir, entry)));
	if (!entries.length) return undefined;
	const prefix = dryRun ? "[dry-run] " : "";
	const backupRoot = resolve(targetDir, "backup-open-agents");
	log(`${prefix}backup ${entries.join(", ")} -> ${backupRoot}/<unique-directory>`);
	if (dryRun) return undefined;
	mkdirSync(backupRoot, { recursive: true });
	const backupDir = mkdtempSync(resolve(backupRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-`));
	for (const entry of entries) copyRecursive(resolve(targetDir, entry), resolve(backupDir, entry));
	log(`Backup saved: ${backupDir}`);
	return backupDir;
}

export function migrateUserConfig(config, {
	baseDir = repoRoot,
	sourceDir = resolve(baseDir, ".pi.user"),
	targetDir = resolve(homedir(), ".pi", "agent"),
	homeDir = homedir(),
	dryRun = false,
	run = runPiInstall,
	update = runPiUpdate,
	remove = (source) => runPi("uninstall", source),
	log = console.log,
} = {}) {
	config.packages.forEach((source) => resolveSource(source, baseDir));
	for (const entry of userConfigEntries) {
		if (!existsSync(resolve(sourceDir, entry))) throw new Error(`User config path not found: ${resolve(sourceDir, entry)}`);
	}
	const settingsPath = resolve(targetDir, "settings.json");
	const firstInstall = !existsSync(settingsPath);
	mergeSettings(existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {});
	const backupDir = backupUserConfig({ targetDir, dryRun, log });
	installPackages(config, { baseDir, dryRun, run, update, log });
	copyUserConfig({ sourceDir, targetDir, homeDir, dryRun, log });
	log(`${dryRun ? "[dry-run] " : ""}merge workflow settings -> ${settingsPath}`);
	if (firstInstall) log(`${dryRun ? "[dry-run] " : ""}queue first-install claude profile for activation in Pi`);
	if (!dryRun) {
		const existing = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
		const settings = mergeSettings(existing);
		if (firstInstall && !settings.modelProfiles.active) settings.modelProfiles.pendingDefault ??= "claude";
		writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
	}
	for (const source of config.removePackages ?? []) {
		const existing = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
		const registered = (existing.packages ?? []).map((entry) => typeof entry === "string" ? entry : entry.source)
			.filter((entry) => entry === source || (source.startsWith("npm:") && entry.startsWith(`${source}@`)));
		if (!dryRun && !registered.length) {
			log(`skip uninstall ${source} (not registered)`);
			continue;
		}
		for (const entry of registered.length ? registered : [source]) {
			log(`${dryRun ? "[dry-run] " : ""}pi uninstall ${entry}`);
			if (!dryRun) remove(entry);
		}
	}
	return backupDir;
}

// Overwrites existing files; extra files already in dest are kept.
function copyRecursive(src, dest) {
	mkdirSync(dirname(dest), { recursive: true });
	cpSync(src, dest, { recursive: true, force: true });
}

function runPiInstall(source) {
	runPi("install", source);
}

function runPiUpdate(source) {
	runPi("update", source);
}

function runPi(command, source) {
	// shell: true so the `pi` .cmd shim resolves on Windows.
	const result = spawnSync("pi", [command, `"${source}"`], { stdio: "inherit", shell: true });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`pi ${command} ${source} failed with exit code ${result.status}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const config = loadConfig(resolve(repoRoot, "install.config.json"));
		const dryRun = process.argv.includes("--dry-run");
		migrateUserConfig(config, { baseDir: repoRoot, dryRun });
	} catch (error) {
		console.error(error.message);
		process.exit(1);
	}
}
