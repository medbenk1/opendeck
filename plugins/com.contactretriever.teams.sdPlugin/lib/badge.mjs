/** Compose a presence badge (colored dot) onto a contact photo -> PNG data URL. */

import { Jimp } from "jimp";
import { availabilityColor } from "./presence.mjs";

function hexInt(hex, alpha = 0xff) {
	const h = String(hex).replace("#", "");
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	return (((r << 24) >>> 0) + (g << 16) + (b << 8) + alpha) >>> 0;
}

const WHITE = hexInt("#ffffff");

function drawDot(image, cx, cy, radius, colorInt, ringInt, ringW) {
	const w = image.bitmap.width;
	const h = image.bitmap.height;
	const outer = radius + ringW;
	for (let y = Math.max(0, cy - outer); y <= Math.min(h - 1, cy + outer); y++) {
		for (let x = Math.max(0, cx - outer); x <= Math.min(w - 1, cx + outer); x++) {
			const d = Math.hypot(x - cx, y - cy);
			if (d <= radius) image.setPixelColor(colorInt, x, y);
			else if (d <= outer) image.setPixelColor(ringInt, x, y);
		}
	}
}

function dataUrlToBuffer(dataUrl) {
	const i = String(dataUrl).indexOf(",");
	return Buffer.from(i >= 0 ? dataUrl.slice(i + 1) : dataUrl, "base64");
}

async function toPngDataUrl(image) {
	const buf = await image.getBuffer("image/png");
	return `data:image/png;base64,${buf.toString("base64")}`;
}

/**
 * Overlay an availability dot (bottom-right) on the photo.
 * @param {string} photoDataUrl base64 data URL (jpeg/png)
 * @param {string} availability Teams availability string
 * @returns {Promise<string>} PNG data URL
 */
export async function badgeImage(photoDataUrl, availability) {
	const image = await Jimp.read(dataUrlToBuffer(photoDataUrl));
	const w = image.bitmap.width;
	const h = image.bitmap.height;
	const radius = Math.max(6, Math.round(Math.min(w, h) * 0.16));
	const ringW = Math.max(2, Math.round(radius * 0.22));
	const cx = w - radius - Math.round(w * 0.06);
	const cy = h - radius - Math.round(h * 0.06);
	drawDot(image, cx, cy, radius, hexInt(availabilityColor(availability)), WHITE, ringW);
	return toPngDataUrl(image);
}

/** Fallback when no photo: solid tile in the availability color with a dot. */
export async function badgeTile(availability, size = 144) {
	const image = new Jimp({ width: size, height: size, color: hexInt("#1e1e1e") });
	const radius = Math.round(size * 0.28);
	drawDot(image, Math.round(size / 2), Math.round(size / 2), radius, hexInt(availabilityColor(availability)), WHITE, 3);
	return toPngDataUrl(image);
}
