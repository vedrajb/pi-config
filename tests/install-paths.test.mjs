import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { copyUserConfig, migrateUserConfig, renderInstructionPaths } from "../install.mjs";

const template = "# Rules\n\n## Commit messages\nBefore ANY git commit, MUST read `{{CAVEMAN_COMMIT_SKILL}}`.\n";
const oldPath = "C:\\Users\\Kira9\\.agents\\skills\\caveman-commit\\SKILL.md";

function fixture(existing) {
	const root = mkdtempSync(join(tmpdir(), "pi-install-paths-"));
	const sourceDir = join(root, "source");
	const targetDir = join(root, "destination");
	mkdirSync(join(sourceDir, "agents"), { recursive: true });
	writeFileSync(join(sourceDir, "agents", "scout.md"), "Scout\n");
	writeFileSync(join(sourceDir, "AGENTS.md"), template);
	if (existing !== undefined) {
		mkdirSync(targetDir);
		writeFileSync(join(targetDir, "AGENTS.md"), existing);
	}
	return { sourceDir, targetDir, log: () => {}, homeDir: "D:\\Profiles\\Alex Smith" };
}

test("home-relative skill token renders for Windows, Unix and UNC homes without assuming a username", () => {
	for (const [homeDir, expected] of [
		["D:\\Profiles\\Alex Smith", "D:\\Profiles\\Alex Smith\\.agents\\skills\\caveman-commit\\SKILL.md"],
		["C:/Users/Other", "C:\\Users\\Other\\.agents\\skills\\caveman-commit\\SKILL.md"],
		["/home/alex", "/home/alex/.agents/skills/caveman-commit/SKILL.md"],
		["/Users/alex", "/Users/alex/.agents/skills/caveman-commit/SKILL.md"],
		["\\\\server\\profiles\\Alex", "\\\\server\\profiles\\Alex\\.agents\\skills\\caveman-commit\\SKILL.md"],
		["D:\\Profiles\\$& Team", "D:\\Profiles\\$& Team\\.agents\\skills\\caveman-commit\\SKILL.md"],
	]) {
		const rendered = renderInstructionPaths(template, homeDir);
		assert.equal(rendered, template.replace("{{CAVEMAN_COMMIT_SKILL}}", () => expected));
		assert.equal(renderInstructionPaths(rendered, homeDir), rendered);
	}
});

test("omitting homeDir uses the current machine's home directory", () => {
	assert.equal(renderInstructionPaths("{{CAVEMAN_COMMIT_SKILL}}"), join(homedir(), ".agents", "skills", "caveman-commit", "SKILL.md"));
});

test("legacy absolute skill paths migrate across machines and separator styles", () => {
	for (const path of [
		oldPath,
		"C:/Users/Previous/.agents/skills/caveman-commit/SKILL.md",
		"/home/previous/.agents/skills/caveman-commit/SKILL.md",
		"/srv/profiles/previous/.agents/skills/caveman-commit/SKILL.md",
		"D:\\Profiles\\Previous\\.agents\\skills\\caveman-commit\\SKILL.md",
		"\\\\server\\users\\Previous\\.agents\\skills\\caveman-commit\\SKILL.md",
	]) {
		assert.equal(renderInstructionPaths(`Read \`${path}\`.`, "/home/current"), "Read `/home/current/.agents/skills/caveman-commit/SKILL.md`.");
	}
});

test("path rendering leaves unrelated instructions, relative paths and URLs untouched", () => {
	const content = [
		"# Keep my rules",
		"Read `C:\\Users\\Colleague\\Documents\\notes.md`.",
		"Read `C:\\Users\\Previous\\.agents\\skills\\other-skill\\SKILL.md`.",
		"Keep the example drive root `C:\\`.",
		"Read `relative/.agents/skills/caveman-commit/SKILL.md`.",
		"See https://example.com/.agents/skills/caveman-commit/SKILL.md.",
	].join("\n");
	assert.equal(renderInstructionPaths(content, "/home/current"), content);
});

test("fresh copying expands the template without modifying repository source files", () => {
	const f = fixture();
	copyUserConfig(f);
	assert.equal(readFileSync(join(f.targetDir, "AGENTS.md"), "utf8"), renderInstructionPaths(template, f.homeDir));
	assert.equal(readFileSync(join(f.sourceDir, "AGENTS.md"), "utf8"), template);
	assert.equal(readFileSync(join(f.targetDir, "agents", "scout.md"), "utf8"), "Scout\n");
});

test("existing AGENTS.md gets its legacy skill path corrected without replacing custom rules", () => {
	const existing = `# My rules\n\n## Commit messages\nBefore git commit read \`${oldPath}\`. Keep my ticket format.\n\n## Coding Guidelines\nKeep these too.\n`;
	const f = fixture(existing);
	copyUserConfig(f);
	const installed = readFileSync(join(f.targetDir, "AGENTS.md"), "utf8");
	assert.equal(installed, renderInstructionPaths(existing, f.homeDir));
	assert.match(installed, /Keep my ticket format/);
	assert.match(installed, /Keep these too/);
	copyUserConfig(f);
	assert.equal(readFileSync(join(f.targetDir, "AGENTS.md"), "utf8"), installed);
});

test("migration renders paths after backup and preserves the destination's device UUID", () => {
	const existing = template.replace("{{CAVEMAN_COMMIT_SKILL}}", () => oldPath);
	const f = fixture(existing);
	writeFileSync(join(f.sourceDir, "settings.json"), JSON.stringify({ deviceId: "do-not-copy-source-device" }));
	writeFileSync(join(f.targetDir, "settings.json"), JSON.stringify({ deviceId: "destination-device", defaultModel: "keep" }));
	const backupDir = migrateUserConfig({ packages: [] }, f);
	assert.equal(readFileSync(join(f.targetDir, "AGENTS.md"), "utf8"), renderInstructionPaths(existing, f.homeDir));
	assert.equal(readFileSync(join(backupDir, "AGENTS.md"), "utf8"), existing);
	const settings = JSON.parse(readFileSync(join(f.targetDir, "settings.json"), "utf8"));
	assert.equal(settings.deviceId, "destination-device");
	assert.equal(settings.defaultModel, "keep");
});

test("fresh migration never imports the template machine's device UUID", () => {
	const f = fixture();
	writeFileSync(join(f.sourceDir, "settings.json"), JSON.stringify({ deviceId: "do-not-copy-source-device" }));
	migrateUserConfig({ packages: [] }, f);
	assert.equal(JSON.parse(readFileSync(join(f.targetDir, "settings.json"), "utf8")).deviceId, undefined);
	assert.equal(readFileSync(join(f.targetDir, "AGENTS.md"), "utf8"), renderInstructionPaths(template, f.homeDir));
});

test("dry run never renders or writes installed instruction files", () => {
	const f = fixture();
	copyUserConfig({ ...f, dryRun: true });
	assert.equal(existsSync(f.targetDir), false);
	assert.equal(readFileSync(join(f.sourceDir, "AGENTS.md"), "utf8"), template);
});
