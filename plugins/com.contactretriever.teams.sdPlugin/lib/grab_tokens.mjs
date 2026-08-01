/**
 * Capture Graph/Substrate + Skype tokens via Chrome DevTools Protocol.
 * Port of grab_tokens.py — no passwords, uses your Chrome session.
 *
 * CLI:  node lib/grab_tokens.mjs [--timeout 180] [--port 9222] [--clone-profile]
 */

import { spawn } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanToken, tokenClaim } from "./tokens.mjs";

const TEAMS_URL = "https://teams.microsoft.com/v2/";

const WANTED = {
	"https://graph.microsoft.com": { field: "graphToken", label: "recherche (Graph)" },
	"https://outlook.office.com/search": { field: "graphToken", label: "recherche (Substrate)" },
	"https://api.spaces.skype.com": { field: "skypeToken", label: "photos (Teams)" },
};

function profileDir() {
	const base =
		process.platform === "win32"
			? process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
			: path.join(os.homedir(), ".local", "share");
	return path.join(base, "contact-retriever", "chrome-profile");
}

function chromeCandidates() {
	if (process.platform === "win32") {
		const local = process.env.LOCALAPPDATA || "";
		return [
			"C:/Program Files/Google/Chrome/Application/chrome.exe",
			"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
			path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
		];
	}
	if (process.platform === "darwin") {
		return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
	}
	return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
}

function jwtAud(token) {
	return String(tokenClaim(token, "aud", "") || "");
}

function jwtExpLabel(token) {
	const exp = tokenClaim(token, "exp");
	if (typeof exp !== "number") return "?";
	const left = Math.floor(exp - Date.now() / 1000);
	return left > 0 ? `expire dans ~${Math.floor(left / 60)} min` : "DEJA EXPIRE";
}

function findChrome() {
	for (const p of chromeCandidates()) {
		if (p && existsSync(p)) return p;
	}
	throw new Error("Chrome introuvable. Installe Google Chrome ou ajuste chromeCandidates().");
}

async function debuggerUrl(port) {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
			signal: AbortSignal.timeout(1000),
		});
		if (!res.ok) return null;
		const data = await res.json();
		return data.webSocketDebuggerUrl || null;
	} catch {
		return null;
	}
}

async function cloneProfile(dir, onLog) {
	if (process.platform !== "win32") {
		onLog?.("clonage profil: Windows seulement, ignore.");
		return;
	}
	const src = path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "User Data");
	if (!existsSync(src)) {
		onLog?.(`profil Chrome habituel introuvable (${src}), on continue sans.`);
		return;
	}
	const items = [
		["Local State", "Local State"],
		[path.join("Default", "Network", "Cookies"), path.join("Default", "Network", "Cookies")],
		[path.join("Default", "Preferences"), path.join("Default", "Preferences")],
	];
	await mkdir(dir, { recursive: true });
	for (const [relSrc, relDst] of items) {
		const s = path.join(src, relSrc);
		const d = path.join(dir, relDst);
		await mkdir(path.dirname(d), { recursive: true });
		try {
			await copyFile(s, d);
			onLog?.(`copie : ${relSrc}`);
		} catch (e) {
			onLog?.(`echec copie ${relSrc} : ${e.message}`);
		}
	}
}

async function launchChrome(port, { clone = false, onLog } = {}) {
	if (await debuggerUrl(port)) {
		onLog?.(`Chrome deja en ecoute sur le port ${port}, reutilisation.`);
		return null;
	}
	const dir = profileDir();
	await mkdir(dir, { recursive: true });
	if (clone) {
		onLog?.("Clonage de la session du profil Chrome habituel :");
		await cloneProfile(dir, onLog);
	}
	const chrome = findChrome();
	onLog?.(`Lancement de Chrome (profil dedie : ${dir})`);
	const proc = spawn(
		chrome,
		[
			`--remote-debugging-port=${port}`,
			`--user-data-dir=${dir}`,
			"--remote-allow-origins=*",
			"--no-first-run",
			"--no-default-browser-check",
			TEAMS_URL,
		],
		{ detached: true, stdio: "ignore" },
	);
	proc.unref();

	for (let i = 0; i < 60; i++) {
		if (await debuggerUrl(port)) return proc;
		await sleep(500);
	}
	throw new Error(`Chrome n'a pas ouvert le port ${port}.`);
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

function getWebSocket() {
	if (typeof WebSocket !== "undefined") return WebSocket;
	throw new Error("WebSocket manquant (Node.js 22+ requis pour la capture CDP).");
}

class CDP {
	constructor(url) {
		const WS = getWebSocket();
		this.ws = new WS(url);
		this.nextId = 0;
		this.queue = [];
		this.waiters = [];
		this.ws.addEventListener("message", (ev) => {
			let msg;
			try {
				msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
			} catch {
				return;
			}
			if (this.waiters.length) this.waiters.shift()(msg);
			else this.queue.push(msg);
		});
	}

	async ready() {
		if (this.ws.readyState === 1) return;
		await new Promise((resolve, reject) => {
			this.ws.addEventListener("open", () => resolve(), { once: true });
			this.ws.addEventListener("error", (e) => reject(e.error || e), { once: true });
		});
	}

	send(method, params = {}, session = null) {
		this.nextId += 1;
		const msg = { id: this.nextId, method, params };
		if (session) msg.sessionId = session;
		this.ws.send(JSON.stringify(msg));
		return this.nextId;
	}

	poll(timeoutMs = 1000) {
		if (this.queue.length) return Promise.resolve(this.queue.shift());
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				const i = this.waiters.indexOf(onMsg);
				if (i >= 0) this.waiters.splice(i, 1);
				resolve(null);
			}, timeoutMs);
			const onMsg = (msg) => {
				clearTimeout(timer);
				resolve(msg);
			};
			this.waiters.push(onMsg);
		});
	}

	close() {
		try {
			this.ws.close();
		} catch {
			/* ignore */
		}
	}
}

function remember(token, found, origin, onLog) {
	token = cleanToken(token);
	const aud = jwtAud(token);
	if (!(aud in WANTED) || aud in found) return;
	found[aud] = token;
	const { label } = WANTED[aud];
	onLog?.(`[+] token ${label.padEnd(22)} via ${String(origin).padEnd(22)} (${jwtExpLabel(token)})`);
}

function scanCookieHeader(value, found, onLog) {
	const m = /authtoken=([^;]+)/.exec(value || "");
	if (!m) return;
	const raw = decodeURIComponent(m[1]);
	const m2 = /Bearer=([^&;\s]+)/.exec(raw);
	if (m2) remember(m2[1], found, "cookie authtoken", onLog);
}

function scanHeaders(headers, found, origin, onLog) {
	for (const [key, value] of Object.entries(headers || {})) {
		const low = key.toLowerCase();
		if (low === "authorization" && typeof value === "string") {
			const m = /^bearer\s+(\S+)/i.exec(value);
			if (m) remember(m[1], found, origin, onLog);
		} else if (low === "cookie" && typeof value === "string") {
			scanCookieHeader(value, found, onLog);
		}
	}
}

function haveAll(found) {
	const fields = new Set(Object.keys(found).map((a) => WANTED[a].field));
	return fields.has("graphToken") && fields.has("skypeToken");
}

function missingLabels(found) {
	const fields = new Set(Object.keys(found).map((a) => WANTED[a].field));
	const todo = [];
	if (!fields.has("graphToken")) todo.push("recherche");
	if (!fields.has("skypeToken")) todo.push("photos");
	return todo;
}

function advice(pageUrl, found) {
	const todo = missingLabels(found).join(", ");
	if (pageUrl.includes("login.microsoftonline.com") || pageUrl.includes("login.live.com")) {
		return `connexion Microsoft en attente -> termine le login dans Chrome (manque : ${todo})`;
	}
	if (!pageUrl.includes("teams.microsoft.com")) {
		return `en attente du chargement de Teams (manque : ${todo})`;
	}
	if (todo.includes("recherche")) {
		return "Teams charge -> TAPE UN NOM dans la barre de recherche Teams";
	}
	return `Teams charge, capture en cours (manque : ${todo})`;
}

function toSettings(found) {
	const out = { graphToken: "", skypeToken: "" };
	let graphAud = "";
	for (const [aud, token] of Object.entries(found)) {
		const { field } = WANTED[aud];
		if (field === "graphToken" && graphAud === "https://graph.microsoft.com") continue;
		out[field] = token;
		if (field === "graphToken") graphAud = aud;
	}
	return out;
}

/**
 * @param {{ port?: number, timeout?: number, cloneProfile?: boolean, onLog?: (msg: string) => void, signal?: AbortSignal }} opts
 * @returns {Promise<{ graphToken: string, skypeToken: string, found: Record<string, string> }>}
 */
export async function captureTokens(opts = {}) {
	const port = opts.port ?? 9222;
	const timeout = opts.timeout ?? 180;
	const onLog = opts.onLog || (() => {});
	const signal = opts.signal;

	await launchChrome(port, { clone: Boolean(opts.cloneProfile), onLog });
	onLog(`Ecoute du trafic Teams pendant ${timeout}s au maximum...`);
	onLog("(connecte-toi dans la fenetre Chrome si elle le demande)");

	const url = await debuggerUrl(port);
	if (!url) throw new Error(`Pas de debugger sur le port ${port}`);

	const cdp = new CDP(url);
	await cdp.ready();
	cdp.send("Target.setAutoAttach", {
		autoAttach: true,
		waitForDebuggerOnStart: false,
		flatten: true,
	});

	const found = {};
	let pageUrl = "";
	const deadline = Date.now() + timeout * 1000;
	let lastPoll = 0;

	try {
		while (Date.now() < deadline && !haveAll(found)) {
			if (signal?.aborted) throw new Error("capture annulee");

			if (Date.now() - lastPoll > 5000) {
				lastPoll = Date.now();
				cdp.send("Storage.getCookies");
				cdp.send("Target.getTargets");
				const left = Math.floor((deadline - Date.now()) / 1000);
				onLog(`[${String(left).padStart(3)}s] ${advice(pageUrl, found)}`);
			}

			const msg = await cdp.poll(1000);
			if (!msg) continue;

			const method = msg.method;
			const params = msg.params || {};
			const result = msg.result || {};

			if (method === "Target.attachedToTarget") {
				const session = params.sessionId || msg.sessionId;
				cdp.send("Network.enable", {}, session);
			} else if (method === "Network.requestWillBeSent") {
				scanHeaders(params.request?.headers, found, "en-tete Authorization", onLog);
			} else if (method === "Network.requestWillBeSentExtraInfo") {
				scanHeaders(params.headers, found, "en-tete Authorization", onLog);
			} else if (result.cookies) {
				for (const c of result.cookies) {
					if (c.name === "authtoken") {
						scanCookieHeader(`authtoken=${c.value || ""}`, found, onLog);
					}
				}
			} else if (result.targetInfos) {
				const pages = result.targetInfos.filter((t) => t.type === "page");
				const teams = pages.find((t) => (t.url || "").includes("teams.microsoft.com"));
				pageUrl = teams?.url || pages[0]?.url || "";
			}
		}
	} finally {
		cdp.close();
	}

	const settings = toSettings(found);
	if (!settings.graphToken && !settings.skypeToken) {
		throw new Error("Aucun token capture.");
	}
	return { ...settings, found };
}

/** CLI entry */
async function main() {
	const args = process.argv.slice(2);
	const get = (name, def) => {
		const i = args.indexOf(name);
		return i >= 0 ? args[i + 1] : def;
	};
	const port = Number(get("--port", "9222"));
	const timeout = Number(get("--timeout", "180"));
	const clone = args.includes("--clone-profile");

	try {
		const { graphToken, skypeToken } = await captureTokens({
			port,
			timeout,
			cloneProfile: clone,
			onLog: (m) => console.log(`  ${m}`),
		});
		console.log("\nResultat :");
		const { writeFile } = await import("node:fs/promises");
		if (graphToken) {
			await writeFile("token.txt", graphToken + "\n", "utf8");
			console.log(`  token.txt          <- recherche  (${jwtExpLabel(graphToken)})`);
		} else {
			console.log("  /!\\ token.txt manquant");
		}
		if (skypeToken) {
			await writeFile("skype_token.txt", skypeToken + "\n", "utf8");
			console.log(`  skype_token.txt    <- photos     (${jwtExpLabel(skypeToken)})`);
		} else {
			console.log("  /!\\ skype_token.txt manquant");
		}
		process.exit(graphToken && skypeToken ? 0 : 1);
	} catch (e) {
		console.error(e.message || e);
		process.exit(1);
	}
}

const isCli =
	process.argv[1] &&
	path.resolve(process.argv[1]).replace(/\\/g, "/").endsWith("/lib/grab_tokens.mjs");
if (isCli) main();
