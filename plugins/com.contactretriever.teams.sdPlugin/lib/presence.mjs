/** Teams presence via the Unified Presence Service (UPS) synchronous read. */

import { PRESENCE_URL, cleanToken, tokenExpirationDetails, tokenAudience } from "./tokens.mjs";

/** availability -> UI color (hex). */
export function availabilityColor(availability) {
	switch (String(availability)) {
		case "Available":
		case "AvailableIdle":
			return "#2ecc40"; // green
		case "Busy":
		case "BusyIdle":
		case "DoNotDisturb":
		case "InAMeeting":
		case "InACall":
		case "Presenting":
			return "#e0245e"; // red
		case "Away":
		case "BeRightBack":
			return "#f5a623"; // orange
		case "Offline":
		case "PresenceUnknown":
			return "#7d7d7d"; // grey
		default:
			return "#7d7d7d";
	}
}

/** Normalize one UPS entry to a compact shape. */
export function normalizePresence(entry) {
	const p = entry?.presence || {};
	return {
		mri: entry?.mri || "",
		availability: p.availability || "PresenceUnknown",
		activity: p.activity || "",
		outOfOffice: Boolean(p.calendarData?.isOutOfOffice),
		deviceType: p.deviceType || "",
		color: availabilityColor(p.availability),
	};
}

function presenceError(token, status) {
	const err = new Error(
		`${status} : token presence invalide/expire.\n` +
			`Etat : ${tokenExpirationDetails(token)}\n` +
			`Audience : ${tokenAudience(token)}`,
	);
	err.code = "PRESENCE_401";
	return err;
}

/**
 * Fetch presence for a batch of MRIs.
 * @param {string} presenceToken JWT with aud=presence.teams.microsoft.com
 * @param {string[]} mris list of "8:orgid:<oid>"
 * @returns {Promise<Map<string, ReturnType<typeof normalizePresence>>>}
 */
export async function getPresences(presenceToken, mris) {
	const token = cleanToken(presenceToken);
	const list = [...new Set((mris || []).filter(Boolean))];
	const out = new Map();
	if (!token || list.length === 0) return out;

	const res = await fetch(PRESENCE_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			"x-ms-client-user-agent": "Teams-V2-Web",
			"x-ms-client-type": "cdlworker",
			Accept: "application/json",
		},
		body: JSON.stringify(list.map((mri) => ({ mri }))),
	});

	if (res.status === 401 || res.status === 403) throw presenceError(token, res.status);
	if (!res.ok) throw new Error(`presence HTTP ${res.status}`);

	const data = await res.json().catch(() => []);
	for (const entry of Array.isArray(data) ? data : []) {
		const norm = normalizePresence(entry);
		if (norm.mri) out.set(norm.mri, norm);
	}
	return out;
}
