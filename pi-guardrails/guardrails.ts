import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function isSubagentProcess(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.PI_SUBAGENT_CHILD === "1";
}

// Best-effort shell split into command segments (does not respect quotes).
// includePipe=true also splits pipelines so every piped command is inspected.
function splitSegments(command: string, includePipe: boolean): string[] {
	const re = includePipe ? /\r?\n|;|&&|\|\||\|/ : /\r?\n|;|&&|\|\|/;
	return command.split(re).map((s) => s.trim()).filter(Boolean);
}

// Whitespace tokens with leading env assignments (FOO=1 cmd) dropped.
function tokens(segment: string): string[] {
	const t = segment.split(/\s+/).filter(Boolean);
	while (t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])) t.shift();
	return t;
}

function unquote(s: string): string {
	return s.replace(/^["']|["']$/g, "");
}

// Returns the git subcommand after optional global options, or undefined.
function gitSubcommand(t: string[]): string | undefined {
	if (!t.length || !/^git(\.exe)?$/i.test(unquote(t[0]))) return undefined;
	let i = 1;
	// Skip global options; -C/-c/--git-dir/--work-tree consume a value argument.
	while (i < t.length) {
		const a = t[i];
		if (a === "-C" || a === "-c" || a === "--git-dir" || a === "--work-tree") i += 2;
		else if (a.startsWith("-")) i += 1;
		else return a.toLowerCase();
	}
	return undefined;
}

export function isGitCommit(command: string): boolean {
	return splitSegments(command, true).some((seg) => gitSubcommand(tokens(seg)) === "commit");
}

// Normalise Windows separators so either path style matches.
export function isSkillRead(path: string): boolean {
	return path.split("\\").join("/").toLowerCase().endsWith("caveman-commit/skill.md");
}

const SEARCH_COMMANDS = new Set(["rg", "grep", "egrep", "fgrep", "find", "fd", "findstr", "ag", "ack", "tree", "select-string"]);
const LIST_COMMANDS = new Set(["ls", "dir", "get-childitem", "gci"]);

export function findSearchCommand(command: string): string | undefined {
	for (const seg of splitSegments(command, false)) {
		// Only the head of a pipeline counts; `cmd | grep x` is output filtering, not code search.
		const first = seg.split("|")[0];
		const t = tokens(first);
		if (!t.length) continue;
		const name = unquote(t[0]).replace(/\.exe$/i, "").toLowerCase();
		if (name === "git") {
			const sub = gitSubcommand(t);
			if (sub === "grep" || sub === "ls-files") return `git ${sub}`;
			continue;
		}
		if (SEARCH_COMMANDS.has(name)) return name;
		// Listing commands are only treated as search when recursive.
		if (LIST_COMMANDS.has(name)) {
			const args = t.slice(1);
			const recursive = args.some((a) => {
				if (/^-recurse$/i.test(a) || a.toLowerCase() === "/s") return true;
				if (name === "ls") return a === "-R" || a === "-r" || (/^-[A-Za-z]+$/.test(a) && /[Rr]/.test(a));
				return false;
			});
			if (recursive) return name;
		}
	}
	return undefined;
}

const SHELL_TOOLS = new Set(["bash", "powershell"]);
// Built via RegExp string: Node's TS type-stripper rejects some backslash regex literals.
const SKILL_IN_COMMAND = new RegExp("caveman-commit[\\\\/]skill\\.md", "i");
const SEARCH_TOOLS = new Set(["grep", "find", "ls"]);

export default function (pi: ExtensionAPI): void {
	const env = process.env;
	let skillRead = false;
	let searchGateEnabled = env.PI_GUARDRAILS_SEARCH !== "off";
	const skillPath = env.PI_CAVEMAN_COMMIT_SKILL ?? join(homedir(), ".agents", "skills", "caveman-commit", "SKILL.md");

	// Skill-read state is per session; new/resumed/forked sessions must read it again.
	pi.on("session_start", () => {
		skillRead = false;
	});

	pi.on("tool_call", (event: any) => {
		const tool = String(event.toolName ?? "").toLowerCase();
		const input = event.input ?? {};
		const command: string = typeof input.command === "string" ? input.command : "";

		// Track caveman-commit SKILL.md reads (read tool or e.g. `cat` in a shell).
		if (tool === "read") {
			const p = input.path ?? input.file_path;
			if (typeof p === "string" && isSkillRead(p)) skillRead = true;
		} else if (SHELL_TOOLS.has(tool) && SKILL_IN_COMMAND.test(command)) {
			skillRead = true;
		}

		// Commit gate: applies to every process that loads this extension.
		if (SHELL_TOOLS.has(tool) && isGitCommit(command) && !skillRead) {
			return {
				block: true,
				reason: `Commit blocked by guardrails: read the caveman-commit skill first (read ${skillPath}) and write the message per its rules, then retry.`,
			};
		}

		// Search gate: main agent only, so scouts/workers can still search.
		if (!isSubagentProcess(process.env) && searchGateEnabled) {
			if ((SHELL_TOOLS.has(tool) && findSearchCommand(command)) || SEARCH_TOOLS.has(tool)) {
				return {
					block: true,
					reason:
						'Search blocked by guardrails: delegate codebase search/investigation to the scout subagent (subagent({ agent: "scout", task })). Use read only for files whose path you already know. User can disable with /guardrails search off.',
				};
			}
		}
		return undefined;
	});

	pi.registerCommand("guardrails", {
		description: "Guardrails status or toggle: /guardrails [status|search on|search off]",
		handler: async (args: string, ctx: any) => {
			const a = (args ?? "").trim().toLowerCase().replace(/\s+/g, " ");
			let msg: string;
			if (a === "search off") {
				searchGateEnabled = false;
				msg = "Guardrails: search gate off";
			} else if (a === "search on") {
				searchGateEnabled = true;
				msg = "Guardrails: search gate on";
			} else if (a === "" || a === "status") {
				msg = `Guardrails: search gate ${searchGateEnabled ? "on" : "off"}, skillRead=${skillRead}, subagent=${isSubagentProcess(process.env)}`;
			} else {
				msg = "Usage: /guardrails [status|search on|search off]";
			}
			if (ctx?.hasUI) ctx.ui.notify(msg, "info");
		},
	});
}
