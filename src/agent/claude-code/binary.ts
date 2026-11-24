import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type BinaryLookup = {
	env: Record<string, string | undefined>;
	platform: NodeJS.Platform;
	homeDir: string;
	cwd?: string;
	isExecutable: (path: string) => boolean;
};

type SearchSpec = {
	paths: path.PlatformPath;
	names: string[];
	knownDirs: string[];
};

function getWindowsSearchSpec(env: BinaryLookup["env"], homeDir: string): SearchSpec {
	const paths = path.win32;
	const appData = env.APPDATA ?? paths.join(homeDir, "AppData", "Roaming");
	const npmPrefix = env.npm_config_prefix ?? paths.join(appData, "npm");

	return {
		paths,
		// Direct spawn deliberately uses no shell. A .cmd-only npm install
		// is not runnable and must not count as an available provider.
		names: ["claude.exe"],
		knownDirs: [
			paths.join(homeDir, ".local", "bin"),
			paths.join(homeDir, ".claude", "local"),
			npmPrefix,
			// Fork: npm installs only put a claude.cmd shim on PATH; the native claude.exe sits inside the package.
			paths.join(npmPrefix, "node_modules", "@anthropic-ai", "claude-code", "bin"),
		],
	};
}

function getPosixSearchSpec(env: BinaryLookup["env"], homeDir: string): SearchSpec {
	const paths = path.posix;
	const npmBin = env.npm_config_prefix
		? paths.join(env.npm_config_prefix, "bin")
		: paths.join(homeDir, ".npm-global", "bin");

	return {
		paths,
		names: ["claude"],
		knownDirs: [
			paths.join(homeDir, ".local", "bin"),
			paths.join(homeDir, ".claude", "local"),
			npmBin,
			"/opt/homebrew/bin",
			"/usr/local/bin",
			// Nix (home-manager with useUserPackages, standalone home-manager /
			// nix profile, NixOS/nix-darwin system packages). These are only on
			// PATH after shell init, so desktop launches never see them.
			...(env.USER ? [paths.join("/etc/profiles/per-user", env.USER, "bin")] : []),
			paths.join(homeDir, ".nix-profile", "bin"),
			"/run/current-system/sw/bin",
		],
	};
}

const warnedOverrides = new Set<string>(); // Fork

export function resolveClaudeBinary({ env, platform, homeDir, cwd = process.cwd(), isExecutable }: BinaryLookup): string | null {
	// Fork: LH_CLAUDE_BIN overrides discovery.
	const override = env.LH_CLAUDE_BIN?.trim();
	if (override) { // Fork: absolute, like discovered paths
		const resolved = (platform === "win32" ? path.win32 : path.posix).resolve(cwd, override);
		if (isExecutable(resolved)) return resolved;
		// Fork: say so once per value (this runs on every lookup), then fall back to discovery.
		if (!warnedOverrides.has(resolved)) {
			warnedOverrides.add(resolved);
			console.warn(`[claude-code] LH_CLAUDE_BIN=${resolved} is not an executable file; using normal discovery instead.`);
		}
	}

	const { paths, names, knownDirs } = platform === "win32"
		? getWindowsSearchSpec(env, homeDir)
		: getPosixSearchSpec(env, homeDir);

	const pathDirs = (env.PATH ?? "").split(paths.delimiter).filter(Boolean);

	for (const name of names) {
		for (const dir of [...pathDirs, ...knownDirs]) {
			// Discovery is relative to the server cwd; probes/model work use
			// different directories and must receive the same absolute identity.
			const candidate = paths.resolve(cwd, dir, name);
			if (isExecutable(candidate)) return candidate;
		}
	}

	return null;
}

function isExecutableFile(filePath: string): boolean {
	try {
		fs.accessSync(filePath, fs.constants.X_OK);
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

export function getClaudeBinary(): string | null {
	return resolveClaudeBinary({
		env: process.env,
		platform: process.platform,
		homeDir: os.homedir(),
		isExecutable: isExecutableFile,
	});
}
