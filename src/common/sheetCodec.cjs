const path = require("node:path");

const AUTO_KEYS = [
	"y", "u", "i", "o", "p",
	"h", "j", "k", "l", ";",
	"n", "m", ",", ".", "/",
];
const SKY_KEY_PATTERN = /^(?:([0-9]+))?Key([0-9]+)$/;
const MAX_DURATION_MS = 15 * 60 * 1000;
const MAX_NOTE_COUNT = 20000;

class SheetCodecError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = "SheetCodecError";
		this.code = code;
		this.userMessage = message;
		this.details = details;
	}
}

function fail(code, message, details) {
	throw new SheetCodecError(code, message, details);
}

function parse(input = {}) {
	const fileName = String(input.fileName || "Untitled");
	const extension = String(input.extension || path.extname(fileName)).toLowerCase();
	let format = String(input.format || "").toLowerCase();
	let rawSheet;

	try {
		if (format === "midi" || extension === ".mid" || extension === ".midi") {
			format = "midi";
			rawSheet = parseMidi(input.content, path.basename(fileName, extension));
		} else {
			const text = decodeText(input.content);
			const normalizedText = text.trim().replace(/^\uFEFF/, "");
			if (!normalizedText) fail("EMPTY_FILE", "The selected sheet file is empty.");

			if (format === "abc" || (!format && looksLikeAbc(normalizedText))) {
				format = "abc";
				rawSheet = parseAbc(normalizedText, path.basename(fileName, extension));
			} else {
				format = "json";
				rawSheet = parseJson(normalizedText);
			}
		}
	} catch (error) {
		if (error instanceof SheetCodecError) throw error;
		fail("PARSE_FAILED", `Unable to read ${fileName}: ${error.message}`, { cause: error.message });
	}

	if (rawSheet.isEncrypted === true || (Array.isArray(rawSheet.songNotes) && typeof rawSheet.songNotes[0] === "number")) {
		try {
			rawSheet = { ...rawSheet, songNotes: decodeEncryptedNotes(rawSheet.songNotes), isEncrypted: false };
		} catch (error) {
			fail("DECRYPT_FAILED", "The sheet is encrypted but could not be decrypted. The file may be corrupted.", {
				cause: error.message,
			});
		}
	}

	return prepare(rawSheet, { format, fileName });
}

function loadStored(payload, options = {}) {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		fail("INVALID_STORED_PAYLOAD", "The stored sheet payload is invalid.");
	}

	const bitsPerPage = resolveBitsPerPage(options.bitsPerPage || payload.bitsPerPage);
	const rawKeyMap = payload.keyMap && typeof payload.keyMap === "object" ? payload.keyMap : payload;
	const songNotes = Array.isArray(payload.songNotes)
		? normalizeSongNotes(payload.songNotes, bitsPerPage, []).notes
		: null;
	const playbackNotes = songNotes ? buildPlaybackNotes(songNotes, bitsPerPage) : null;
	const keyMap = normalizeStoredKeyMap(rawKeyMap);

	return {
		keyMap,
		songNotes,
		playbackNotes,
		hasHoldNotes: hasHoldNotes(songNotes),
		bitsPerPage,
	};
}

function prepare(rawSheet, { format, fileName }) {
	if (!rawSheet || typeof rawSheet !== "object" || Array.isArray(rawSheet)) {
		fail("INVALID_SHEET", "The sheet must contain one song object.");
	}

	const warnings = [];
	const name = cleanText(rawSheet.name) || path.basename(fileName, path.extname(fileName)) || "Untitled";
	const author = cleanText(rawSheet.author) || "Unknown";
	const transcribedBy = cleanText(rawSheet.transcribedBy) || "Unknown";
	const bpm = normalizeBpm(rawSheet.bpm, warnings);
	const pitchLevel = normalizePitch(rawSheet.pitchLevel, warnings);
	const compatibleBits = resolveCompatibleBitsPerPage(rawSheet.songNotes, rawSheet.bitsPerPage);
	const normalized = normalizeSongNotes(rawSheet.songNotes, compatibleBits, warnings);
	const playbackNotes = buildPlaybackNotes(normalized.notes, compatibleBits);
	const keyMap = buildKeyMap(playbackNotes);
	const durationMs = normalized.notes.reduce((max, note) => Math.max(max, note.time + (note.hold || 0)), 0);
	const sheet = {
		...rawSheet,
		name,
		author,
		transcribedBy,
		isComposed: rawSheet.isComposed !== false,
		bpm,
		bitsPerPage: compatibleBits,
		pitchLevel,
		isEncrypted: false,
		songNotes: normalized.notes,
	};

	return {
		sheet,
		storage: {
			version: 2,
			keyMap,
			songNotes: normalized.notes,
		},
		preview: {
			format,
			name,
			author,
			transcribedBy,
			bpm,
			bitsPerPage: compatibleBits,
			pitchLevel,
			noteCount: normalized.notes.length,
			durationMs,
			hasHoldNotes: hasHoldNotes(normalized.notes),
		},
		warnings,
	};
}

function decodeText(content) {
	if (typeof content === "string") return content;
	if (!Buffer.isBuffer(content) && !(content instanceof Uint8Array)) {
		fail("UNSUPPORTED_INPUT", "The selected file could not be read as text or MIDI data.");
	}

	const buffer = Buffer.from(content);
	if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
		return buffer.subarray(2).toString("utf16le");
	}
	if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
		const swapped = Buffer.from(buffer.subarray(2));
		for (let i = 0; i + 1 < swapped.length; i += 2) {
			const first = swapped[i];
			swapped[i] = swapped[i + 1];
			swapped[i + 1] = first;
		}
		return swapped.toString("utf16le");
	}
	if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
		return buffer.subarray(3).toString("utf8");
	}

	const sampleLength = Math.min(buffer.length, 200);
	let oddZeros = 0;
	let evenZeros = 0;
	for (let i = 0; i < sampleLength; i++) {
		if (buffer[i] !== 0) continue;
		if (i % 2) oddZeros++;
		else evenZeros++;
	}
	if (oddZeros > sampleLength / 8) return buffer.toString("utf16le");
	if (evenZeros > sampleLength / 8) {
		const swapped = Buffer.from(buffer);
		for (let i = 0; i + 1 < swapped.length; i += 2) {
			const first = swapped[i];
			swapped[i] = swapped[i + 1];
			swapped[i + 1] = first;
		}
		return swapped.toString("utf16le");
	}
	return buffer.toString("utf8");
}

function parseJson(text) {
	const candidates = [text];
	const unwrapped = text.replace(/^\(\s*/, "").replace(/\s*\);?\s*$/, "");
	if (unwrapped !== text) candidates.push(unwrapped);

	for (const candidate of candidates) {
		try {
			return unwrapSheet(JSON.parse(candidate));
		} catch (_) {
			// Try the next safe representation.
		}
	}

	try {
		return unwrapSheet(JSON.parse(toRelaxedJson(unwrapped)));
	} catch (error) {
		fail("INVALID_JSON", `Invalid sheet JSON: ${error.message}`, { cause: error.message });
	}
}

function unwrapSheet(parsed) {
	if (Array.isArray(parsed)) {
		if (!parsed.length) fail("EMPTY_SHEET_ARRAY", "The sheet JSON array is empty.");
		return parsed[0];
	}
	if (parsed && typeof parsed === "object") return parsed;
	fail("INVALID_JSON_ROOT", "The sheet JSON must be an object or an array containing one object.");
}

function toRelaxedJson(value) {
	return value
		.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
		.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner) => JSON.stringify(inner.replace(/\\'/g, "'").replace(/\\"/g, '"')))
		.replace(/,\s*([}\]])/g, "$1");
}

function looksLikeAbc(text) {
	return text.startsWith("<DontCopyThisLine>") || /(?:^|\s)[A-C][1-5](?:\s|$)/m.test(text);
}

function parseAbc(text, fileName) {
	const lines = text.split(/\r?\n/);
	const meta = lines[0].trim().split(/\s+/);
	const hasMarker = meta[0] === "<DontCopyThisLine>";
	const offset = hasMarker ? 1 : 0;
	const bpm = Number.parseInt(meta[offset], 10) || 240;
	const pitchLevel = Number.parseInt(meta[offset + 1], 10) || 0;
	const bitsPerPage = Number.parseInt(meta[offset + 2], 10) || 16;
	const author = meta[offset + 3] || "Unknown";
	const transcribedBy = meta[offset + 4] || "Unknown";
	const step = Math.floor(60000 / bpm);
	const songNotes = [];
	let time = 0;

	for (let i = 1; i < lines.length; i++) {
		for (const token of lines[i].trim().split(/\s+/)) {
			if (token && token !== ".") {
				const matches = token.match(/[A-C][1-5]/g) || [];
				for (const match of matches) {
					const keyIndex = (match.charCodeAt(0) - 65) * 5 + Number.parseInt(match[1], 10) - 1;
					songNotes.push({ time, key: `1Key${keyIndex}` });
				}
			}
			time += step;
		}
	}

	return { name: fileName, author, transcribedBy, bpm, bitsPerPage, pitchLevel, isEncrypted: false, songNotes };
}

function parseMidi(content, fileName) {
	if (!content) fail("EMPTY_MIDI", "The selected MIDI file is empty.");
	let midi;
	try {
		const MidiParser = require("midi-parser-js");
		midi = MidiParser.parse(Buffer.from(content));
	} catch (error) {
		fail("INVALID_MIDI", `Invalid MIDI file: ${error.message}`, { cause: error.message });
	}
	if (!midi || !Array.isArray(midi.track)) fail("INVALID_MIDI", "The MIDI file does not contain any tracks.");

	const midiToSky = new Map([
		[60, 0], [62, 1], [64, 2], [65, 3], [67, 4], [69, 5], [71, 6],
		[72, 7], [74, 8], [76, 9], [77, 10], [79, 11], [81, 12], [83, 13], [84, 14],
	]);
	let tempo = 500000;
	let author = "Unknown";
	let transcribedBy = "Unknown";
	let name = fileName;

	for (const track of midi.track) {
		for (const event of track.event || []) {
			if (event.type !== 255) continue;
			if (event.metaType === 81) tempo = Number(event.data) || tempo;
			if (event.metaType === 2 && typeof event.data === "string") {
				[author = author, transcribedBy = transcribedBy] = event.data.split(",");
			}
			if (event.metaType === 3 && typeof event.data === "string") name = event.data;
		}
	}

	const timeDivision = Number(midi.timeDivision) || 480;
	const songNotes = [];
	for (const track of midi.track) {
		let absoluteTimeMs = 0;
		for (const event of track.event || []) {
			absoluteTimeMs += Number(event.deltaTime || 0) * (tempo / 1000) / timeDivision;
			if (event.type !== 9 || !event.data || Number(event.data[1]) <= 0) continue;
			const midiNote = Number(event.data[0]);
			let keyIndex = midiToSky.get(midiNote);
			if (keyIndex === undefined) {
				let closestDistance = Number.POSITIVE_INFINITY;
				for (const [candidate, candidateIndex] of midiToSky) {
					const distance = Math.abs(candidate - midiNote);
					if (distance < closestDistance) {
						closestDistance = distance;
						keyIndex = candidateIndex;
					}
				}
			}
			songNotes.push({ time: Math.round(absoluteTimeMs), key: `1Key${keyIndex}` });
		}
	}

	return {
		name,
		author: cleanText(author) || "Unknown",
		transcribedBy: cleanText(transcribedBy) || "Unknown",
		bpm: Math.round(60000000 / tempo),
		bitsPerPage: 16,
		pitchLevel: 0,
		isEncrypted: false,
		songNotes,
	};
}

function normalizeSongNotes(songNotes, bitsPerPage, warnings) {
	if (!Array.isArray(songNotes) || !songNotes.length) {
		fail("NO_NOTES", "The sheet does not contain any playable notes.");
	}
	if (songNotes.length > MAX_NOTE_COUNT) {
		fail("TOO_MANY_NOTES", `The sheet contains ${songNotes.length} notes; the limit is ${MAX_NOTE_COUNT}.`, {
			noteCount: songNotes.length,
			limit: MAX_NOTE_COUNT,
		});
	}

	let unprefixedCount = 0;
	const notes = songNotes.map((note, index) => {
		const time = Number(note?.time);
		if (!Number.isFinite(time) || time < 0 || time > MAX_DURATION_MS) {
			fail("INVALID_NOTE_TIME", `Note ${index + 1} has an invalid time value.`, { index, time: note?.time });
		}
		const rawKey = typeof note?.key === "string" ? note.key.trim() : "";
		const match = SKY_KEY_PATTERN.exec(rawKey);
		if (!match) {
			fail("INVALID_NOTE_KEY", `Note ${index + 1} uses unsupported key “${rawKey || "(empty)"}”.`, { index, key: rawKey });
		}
		const keyIndex = Number(match[2]);
		if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex >= bitsPerPage || keyIndex > 14) {
			fail("KEY_OUT_OF_RANGE", `Note ${index + 1} uses key ${keyIndex}, but supported keys are 0–14.`, { index, keyIndex });
		}
		if (!match[1]) unprefixedCount++;
		const hold = Number(note?.hold);
		return {
			time: Math.trunc(time),
			key: `1Key${keyIndex}`,
			...(Number.isFinite(hold) && hold > 0 ? { hold: Math.trunc(hold) } : {}),
		};
	});

	if (unprefixedCount) {
		warnings.push({
			code: "UNPREFIXED_KEYS_NORMALIZED",
			count: unprefixedCount,
			message: `${unprefixedCount} unprefixed keys were interpreted as page-one keys.`,
		});
	}
	notes.sort((a, b) => a.time - b.time || a.key.localeCompare(b.key));
	return { notes };
}

function buildPlaybackNotes(songNotes, bitsPerPage) {
	const byKey = new Map();
	for (const note of songNotes) {
		const keyIndex = Number(SKY_KEY_PATTERN.exec(note.key)?.[2]);
		if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex >= bitsPerPage || keyIndex > 14) {
			fail("INVALID_NOTE_KEY", `Unsupported playback key “${note.key}”.`);
		}
		const outputKey = AUTO_KEYS[keyIndex];
		const id = `${note.time}:${outputKey}`;
		const existing = byKey.get(id);
		if (existing) {
			if (note.hold && (!existing.hold || note.hold > existing.hold)) existing.hold = note.hold;
			continue;
		}
		byKey.set(id, { time: note.time, key: outputKey, ...(note.hold ? { hold: note.hold } : {}) });
	}
	return [...byKey.values()].sort((a, b) => a.time - b.time || a.key.localeCompare(b.key));
}

function buildKeyMap(playbackNotes) {
	const keyMap = {};
	let maxSongTime = 0;
	for (const note of playbackNotes) {
		if (!keyMap[note.time]) keyMap[note.time] = [];
		if (!keyMap[note.time].includes(note.key)) keyMap[note.time].push(note.key);
		maxSongTime = Math.max(maxSongTime, note.time + (note.hold || 0));
	}
	const timestamps = Object.keys(keyMap).map(Number).sort((a, b) => a - b);
	if (!timestamps.length) fail("NO_NOTES", "The sheet does not contain any playable notes.");
	if (!timestamps.includes(0)) keyMap[0] = [];
	keyMap[(Math.trunc(Math.max(maxSongTime, timestamps.at(-1)) / 1000) + 1) * 1000] = [];
	return Object.fromEntries(Object.keys(keyMap).map(Number).sort((a, b) => a - b).map((time) => [time, keyMap[time]]));
}

function normalizeStoredKeyMap(rawKeyMap) {
	if (!rawKeyMap || typeof rawKeyMap !== "object" || Array.isArray(rawKeyMap)) {
		fail("INVALID_KEYMAP", "The stored sheet keymap is invalid.");
	}
	const result = {};
	for (const rawTime of Object.keys(rawKeyMap).map(Number).filter((time) => Number.isFinite(time) && time >= 0).sort((a, b) => a - b)) {
		const seen = new Set();
		result[rawTime] = [];
		for (const key of Array.isArray(rawKeyMap[rawTime]) ? rawKeyMap[rawTime] : []) {
			const safeKey = typeof key === "string" ? key.trim() : "";
			if (!AUTO_KEYS.includes(safeKey) || seen.has(safeKey)) continue;
			seen.add(safeKey);
			result[rawTime].push(safeKey);
		}
	}
	return result;
}

function resolveBitsPerPage(value) {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 && number <= 128 ? Math.trunc(number) : 16;
}

function resolveCompatibleBitsPerPage(songNotes, value) {
	const configured = resolveBitsPerPage(value);
	if (!Array.isArray(songNotes)) return configured;
	let maxKeyIndex = -1;
	for (const note of songNotes) {
		const match = SKY_KEY_PATTERN.exec(typeof note?.key === "string" ? note.key.trim() : "");
		if (match) maxKeyIndex = Math.max(maxKeyIndex, Number(match[2]));
	}
	if (maxKeyIndex >= configured && maxKeyIndex <= 14) return maxKeyIndex + 1;
	return configured;
}

function normalizeBpm(value, warnings) {
	const bpm = Number(value);
	if (Number.isFinite(bpm) && bpm > 0 && bpm <= 2000) return bpm;
	warnings.push({ code: "BPM_DEFAULTED", message: "Missing or invalid BPM was replaced with 120." });
	return 120;
}

function normalizePitch(value, warnings) {
	const pitch = Number(value);
	if (Number.isFinite(pitch) && pitch >= -12 && pitch <= 12) return pitch;
	warnings.push({ code: "PITCH_DEFAULTED", message: "Missing or invalid pitch was replaced with 0." });
	return 0;
}

function hasHoldNotes(songNotes) {
	return Array.isArray(songNotes) && songNotes.some((note) => Number(note?.hold) > 0);
}

function cleanText(value) {
	return typeof value === "string" ? value.trim() : "";
}

function decodeEncryptedNotes(nums) {
	const mask = [
		16, 34, 56, 18, 62, 19, -25, 55,
		15, 24, 30, 12, 30, 45, 39, -23,
		-10, 15, 45, -18, 37, -2, -21, 65,
		25, -4, -14, 43, 23, -4, -17, -17,
	];
	if (!Array.isArray(nums)) throw new TypeError("Encrypted notes must be an array.");
	let json = "";
	for (let i = 0; i < nums.length; i++) json += String.fromCharCode((nums[i] | 0) + mask[i % mask.length]);
	return JSON.parse(json.replace(/(].*)/, "]"));
}

const SheetCodec = Object.freeze({ parse, loadStored });

module.exports = { SheetCodec };
