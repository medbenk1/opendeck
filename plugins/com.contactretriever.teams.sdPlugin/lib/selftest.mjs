/** Quick offline checks — run: node lib/selftest.mjs */

import {
	cleanToken,
	detectBackend,
	tokenClaim,
	describeTokens,
	SKYPE_AUD,
} from "./tokens.mjs";
import { availabilityColor, normalizePresence } from "./presence.mjs";

function b64url(obj) {
	return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function fakeJwt(payload) {
	return `hdr.${b64url(payload)}.sig`;
}

let failed = 0;
function assert(cond, msg) {
	if (!cond) {
		console.error("FAIL:", msg);
		failed++;
	} else {
		console.log("ok:", msg);
	}
}

assert(cleanToken("Bearer abc\n def") === "abcdef", "cleanToken strips bearer/whitespace");
assert(detectBackend(fakeJwt({ aud: "https://graph.microsoft.com" })) === "graph", "detect graph");
assert(
	detectBackend(fakeJwt({ aud: "https://outlook.office.com/search" })) === "substrate",
	"detect substrate",
);
assert(tokenClaim(fakeJwt({ oid: "x" }), "oid") === "x", "tokenClaim oid");

const skype = fakeJwt({ aud: SKYPE_AUD, oid: "actor", exp: Math.floor(Date.now() / 1000) + 600 });
const info = describeTokens({ graphToken: fakeJwt({ aud: "https://graph.microsoft.com" }), skypeToken: skype });
assert(info.backend === "graph", "describe backend");
assert(info.hasSkype === true, "describe hasSkype");

assert(availabilityColor("Available") === "#2ecc40", "presence color available=green");
assert(availabilityColor("Busy") === "#e0245e", "presence color busy=red");
assert(availabilityColor("Away") === "#f5a623", "presence color away=orange");
assert(availabilityColor("Offline") === "#7d7d7d", "presence color offline=grey");
assert(availabilityColor("Wat") === "#7d7d7d", "presence color unknown=grey");

const pres = normalizePresence({
	mri: "8:orgid:x",
	presence: { availability: "Busy", activity: "InAMeeting", calendarData: { isOutOfOffice: true } },
});
assert(pres.availability === "Busy" && pres.outOfOffice === true, "normalizePresence maps fields");
assert(pres.color === "#e0245e", "normalizePresence sets color");

if (failed) {
	console.error(`\n${failed} failure(s)`);
	process.exit(1);
}
console.log("\nAll selftests passed.");
