import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	ExecResult,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export const DEFAULT_PROFILE = "default";
export const DEFAULT_REGION = "us-east-1";
export const CHECK_TTL = 5 * 60 * 1000;

const BEDROCK_PROVIDER = "amazon-bedrock";
const AWS_CONFIG_TIMEOUT = 10 * 1000;
const AWS_STS_TIMEOUT = 30 * 1000;
const AWS_SSO_LOGIN_TIMEOUT = 5 * 60 * 1000;

type Environment = Readonly<Record<string, string | undefined>>;

type AuthFile = {
	"amazon-bedrock"?: {
		env?: Record<string, unknown>;
	};
};

export interface AwsConfig {
	profile: string;
	region: string;
}

export function resolveAwsProfile(env: Environment = process.env): string {
	return (
		nonEmptyEnv(env, "PI_AWS_SSO_PROFILE") ??
		nonEmptyEnv(env, "AWS_PROFILE") ??
		DEFAULT_PROFILE
	);
}

export function resolveAwsRegionOverride(env: Environment = process.env): string | undefined {
	return (
		nonEmptyEnv(env, "PI_AWS_REGION") ??
		nonEmptyEnv(env, "AWS_REGION") ??
		nonEmptyEnv(env, "AWS_DEFAULT_REGION")
	);
}

export function setAwsEnvironment(config: AwsConfig): void {
	process.env.AWS_PROFILE = config.profile;
	process.env.AWS_REGION = config.region;
	process.env.AWS_DEFAULT_REGION = config.region;
}

export function extractAmazonBedrockEnvironment(auth: unknown): Environment {
	if (!auth || typeof auth !== "object" || Array.isArray(auth)) return {};

	const provider = (auth as AuthFile)["amazon-bedrock"];
	if (!provider?.env || typeof provider.env !== "object" || Array.isArray(provider.env)) {
		return {};
	}

	const env: Record<string, string> = {};
	for (const name of ["AWS_PROFILE", "AWS_REGION", "AWS_DEFAULT_REGION"] as const) {
		const value = provider.env[name];
		if (typeof value === "string" && value.trim()) env[name] = value;
	}
	return env;
}

export function readAmazonBedrockEnvironment(
	env: Environment = process.env,
	readFile: (path: string, encoding: "utf8") => string = readFileSync,
): Environment {
	const agentDir = nonEmptyEnv(env, "PI_CODING_AGENT_DIR") ?? join(homedir(), ".pi", "agent");
	try {
		return extractAmazonBedrockEnvironment(JSON.parse(readFile(join(agentDir, "auth.json"), "utf8")));
	} catch {
		// The file is optional, and a malformed or inaccessible credential file must
		// not prevent Pi from using its normal process-environment configuration.
		return {};
	}
}

function prepareBedrockEnvironment(authEnv: Environment): void {
	// Pi resolves whether the Bedrock provider is configured before
	// `model_select` is emitted. Set the profile early so a configured SSO
	// profile can make the native provider selectable without an AWS call.
	const profile = resolveAwsProfile({ ...process.env, ...authEnv });
	const regionOverride = resolveAwsRegionOverride({ ...process.env, ...authEnv });
	process.env.AWS_PROFILE = profile;
	if (regionOverride) {
		process.env.AWS_REGION = regionOverride;
		process.env.AWS_DEFAULT_REGION = regionOverride;
	}
}

function nonEmptyEnv(env: Environment, name: string): string | undefined {
	const value = env[name]?.trim();
	return value || undefined;
}

function isBedrockProvider(provider: string): boolean {
	return provider === BEDROCK_PROVIDER;
}

type FailureKind =
	| "cli-missing"
	| "profile-missing"
	| "login-failed"
	| "post-login-validation-failed"
	| "command-failed";

class AwsSsoFailure extends Error {
	readonly kind: FailureKind;

	constructor(kind: FailureKind) {
		super(kind);
		this.name = "AwsSsoFailure";
		this.kind = kind;
	}
}

function isAwsSsoFailure(error: unknown): error is AwsSsoFailure {
	return error instanceof AwsSsoFailure;
}

function commandOutput(result: Pick<ExecResult, "stdout" | "stderr">): string {
	return `${result.stdout}\n${result.stderr}`;
}

function isCommandNotFoundText(text: string): boolean {
	return /(?:ENOENT|command not found|not recognized as an internal or external command|cannot find the file|no such file or directory)/i.test(
		text,
	);
}

function isProfileMissingText(text: string): boolean {
	return (
		/profile\s*not\s*found/i.test(text) ||
		/profile\s+[^\r\n]{0,120}(?:could not be found|does not exist)/i.test(text) ||
		/profile.?notfound/i.test(text)
	);
}

function isCliMissingResult(result: ExecResult, allowEmptyFailure: boolean): boolean {
	if (result.killed) return false;

	const output = commandOutput(result);
	// pi.exec intentionally returns a compact result for spawn errors. A failed
	// command with no output is therefore the other reliable ENOENT signal.
	// The login command is only reached after a validation command has already
	// established that the CLI exists, so an empty login failure is a cancelled
	// or failed login rather than another missing-CLI report.
	return isCommandNotFoundText(output) ||
		(allowEmptyFailure && result.code === 1 && output.trim() === "");
}

function normalizeExecutionError(error: unknown): AwsSsoFailure {
	if (isAwsSsoFailure(error)) return error;

	const message = error instanceof Error ? error.message : String(error);
	return new AwsSsoFailure(isCommandNotFoundText(message) ? "cli-missing" : "command-failed");
}

async function executeAws(
	pi: Pick<ExtensionAPI, "exec">,
	args: string[],
	timeout: number,
): Promise<ExecResult> {
	let result: ExecResult;

	try {
		result = await pi.exec("aws", args, { timeout });
	} catch (error) {
		throw normalizeExecutionError(error);
	}

	if (isCliMissingResult(result, args[0] !== "sso")) {
		throw new AwsSsoFailure("cli-missing");
	}

	return result;
}

async function resolveAwsRegion(
	pi: Pick<ExtensionAPI, "exec">,
	profile: string,
	regionOverride: string | undefined,
): Promise<string> {
	if (regionOverride) return regionOverride;

	try {
		const result = await executeAws(
			pi,
			["configure", "get", "region", "--profile", profile],
			AWS_CONFIG_TIMEOUT,
		);

		if (result.code === 0) {
			const region = result.stdout.trim();
			if (region) return region;
		} else if (isProfileMissingText(commandOutput(result))) {
			throw new AwsSsoFailure("profile-missing");
		}
	} catch (error) {
		const failure = normalizeExecutionError(error);
		if (failure.kind === "cli-missing" || failure.kind === "profile-missing") {
			throw failure;
		}
		// A missing or unreadable region in the AWS config is allowed to use the
		// extension default. STS will still provide the definitive auth result.
	}

	return DEFAULT_REGION;
}

async function validateAwsSession(
	pi: Pick<ExtensionAPI, "exec">,
	profile: string,
): Promise<boolean> {
	const result = await executeAws(
		pi,
		["sts", "get-caller-identity", "--profile", profile],
		AWS_STS_TIMEOUT,
	);

	if (result.code === 0 && !result.killed) return true;
	if (isProfileMissingText(commandOutput(result))) {
		throw new AwsSsoFailure("profile-missing");
	}

	return false;
}

function failureMessage(kind: FailureKind, profile: string): string {
	switch (kind) {
		case "cli-missing":
			return "AWS CLI not found. Install AWS CLI v2 to use Bedrock SSO.";
		case "profile-missing":
			return `AWS profile "${profile}" was not found.`;
		case "login-failed":
			return `AWS SSO authentication failed for ${profile}.`;
		case "post-login-validation-failed":
			return "AWS credentials could not be validated after login.";
		default:
			return `AWS credentials could not be validated for ${profile}.`;
	}
}

interface SuccessfulCheck {
	config: AwsConfig;
	checkedAt: number;
}

function isFreshCheck(check: SuccessfulCheck | undefined, profile: string, regionOverride: string | undefined): boolean {
	if (!check || Date.now() - check.checkedAt >= CHECK_TTL) return false;
	if (check.config.profile !== profile) return false;
	return regionOverride === undefined || check.config.region === regionOverride;
}

function createEnsureAwsSession(pi: ExtensionAPI, authEnv: Environment) {
	let successfulCheck: SuccessfulCheck | undefined;
	let authPromise: Promise<boolean> | null = null;

	async function authenticate(
		ctx: ExtensionContext,
		profile: string,
		regionOverride: string | undefined,
	): Promise<boolean> {
		try {
			const region = await resolveAwsRegion(pi, profile, regionOverride);
			const config = { profile, region } satisfies AwsConfig;

			// Set these before validation so the native Bedrock provider uses the
			// same profile and region as the AWS CLI checks below.
			setAwsEnvironment(config);

			if (await validateAwsSession(pi, profile)) {
				successfulCheck = { config, checkedAt: Date.now() };
				return true;
			}

			ctx.ui.notify(
				`AWS SSO session for ${profile} has expired. Authenticating...`,
				"info",
			);

			const login = await executeAws(
				pi,
				["sso", "login", "--profile", profile],
				AWS_SSO_LOGIN_TIMEOUT,
			);
			if (login.code !== 0 || login.killed) {
				if (isProfileMissingText(commandOutput(login))) {
					throw new AwsSsoFailure("profile-missing");
				}
				throw new AwsSsoFailure("login-failed");
			}

			if (!(await validateAwsSession(pi, profile))) {
				throw new AwsSsoFailure("post-login-validation-failed");
			}

			successfulCheck = { config, checkedAt: Date.now() };
			return true;
		} catch (error) {
			successfulCheck = undefined;
			const failure = normalizeExecutionError(error);
			ctx.ui.notify(failureMessage(failure.kind, profile), "error");
			return false;
		}
	}

	return async function ensureAwsSession(ctx: ExtensionContext): Promise<boolean> {
		const profile = resolveAwsProfile({ ...process.env, ...authEnv });
		const regionOverride = resolveAwsRegionOverride({ ...process.env, ...authEnv });

		if (isFreshCheck(successfulCheck, profile, regionOverride)) {
			// Keep the provider environment correct even if another extension or
			// host integration changed it since the last successful check.
			setAwsEnvironment(successfulCheck!.config);
			return true;
		}

		if (authPromise) return authPromise;

		const currentPromise = authenticate(ctx, profile, regionOverride);
		authPromise = currentPromise;

		try {
			return await currentPromise;
		} finally {
			if (authPromise === currentPromise) authPromise = null;
		}
	};
}

export default function (pi: ExtensionAPI): void {
	const authEnv = readAmazonBedrockEnvironment();
	prepareBedrockEnvironment(authEnv);
	const ensureAwsSession = createEnsureAwsSession(pi, authEnv);
	let revertingModel = false;

	pi.on("model_select", async (event, ctx) => {
		if (revertingModel || !isBedrockProvider(event.model.provider)) return;

		const authenticated = await ensureAwsSession(ctx);
		if (authenticated || event.source === "restore" || !event.previousModel) return;

		// Model selection cannot be cancelled through the event API. Restore the
		// previous model after a failed manual/cycle selection instead.
		revertingModel = true;
		try {
			await pi.setModel(event.previousModel);
		} finally {
			revertingModel = false;
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.model && isBedrockProvider(ctx.model.provider)) {
			// Startup/resume failures stay on Bedrock, but the user gets the same
			// actionable error notification from ensureAwsSession().
			await ensureAwsSession(ctx);
		}
	});
}
