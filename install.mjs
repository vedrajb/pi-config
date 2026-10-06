#!/usr/bin/env node
// Installs the Pi packages listed in install.config.json with `pi install`.
// Remote (npm:/git:/URL) packages are also upgraded with `pi update <source>`.
// Usage: node install.mjs [--dry-run]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = dirname(fileURLToPath(import.meta.url));

export function loadConfig(configPath) {
	const config = JSON.parse(readFileSync(configPath, "utf8"));
	if (!Array.isArray(config.packages) || config.packages.some((p) => typeof p !== "string" || !p.trim())) {
		throw new Error(`${configPath}: "packages" must be an array of non-empty strings`);
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
		installPackages(config, { baseDir: repoRoot, dryRun: process.argv.includes("--dry-run") });
	} catch (error) {
		console.error(error.message);
		process.exit(1);
	}
}
