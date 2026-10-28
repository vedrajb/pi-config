import { spawnSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function git(args, allowed = [0]) {
	const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
	if (result.error || !allowed.includes(result.status)) {
		throw new Error(result.error?.message || result.stderr.trim() || "Git hook setup failed");
	}
	return result;
}

try {
	if (resolve(git(["rev-parse", "--show-toplevel"]).stdout.trim()) !== root) {
		throw new Error("Run hook setup from a checkout of this repository.");
	}
	const current = git(["config", "--get", "core.hooksPath"], [0, 1]);
	if (current.status === 0 && current.stdout.trim() !== ".githooks") {
		throw new Error("core.hooksPath is already configured. Add the deviceId check to your existing pre-commit hook instead of replacing it.");
	}
	if (current.status === 1) {
		const existing = resolve(root, git(["rev-parse", "--git-path", "hooks/pre-commit"]).stdout.trim());
		if (existsSync(existing)) throw new Error("A pre-commit hook already exists. Add the deviceId check to it instead of replacing it.");
	}
	chmodSync(resolve(root, ".githooks/pre-commit"), 0o755);
	git(["config", "--local", "core.hooksPath", ".githooks"]);
	console.log("Enabled the repository's deviceId pre-commit check (local Git configuration only).");
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
