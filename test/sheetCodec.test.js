import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SheetCodec } = require("../src/common/sheetCodec.cjs");

function jsonSheet(overrides = {}) {
	return [{
		name: "Fixture",
		author: "Tester",
		bpm: 120,
		pitchLevel: 0,
		isEncrypted: false,
		songNotes: [{ time: 0, key: "1Key0" }],
		...overrides,
	}];
}

describe("SheetCodec", () => {
	it("imports Sky Music Studio JSON with unprefixed keys", () => {
		const source = JSON.stringify([{
			name: "Rubia",
			author: "Sky Music Studio",
			bpm: 68,
			pitchLevel: 0,
			isEncrypted: false,
			songNotes: [
				{ time: 0, key: "Key5" },
				{ time: 882, key: "Key2" },
			],
		}]);

		const result = SheetCodec.parse({ content: source, fileName: "Rubia.json" });

		expect(result.sheet.songNotes).toEqual([
			{ time: 0, key: "1Key5" },
			{ time: 882, key: "1Key2" },
		]);
		expect(result.storage.keyMap).toEqual({
			0: ["h"],
			882: ["i"],
			1000: [],
		});
		expect(result.preview).toMatchObject({
			format: "json",
			name: "Rubia",
			noteCount: 2,
			durationMs: 882,
		});
		expect(result.warnings).toContainEqual(expect.objectContaining({
			code: "UNPREFIXED_KEYS_NORMALIZED",
			count: 2,
		}));
	});

	it.each([
		["UTF-8 BOM", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(jsonSheet()))])],
		["UTF-16 LE", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify(jsonSheet()), "utf16le")])],
	])("imports %s JSON", (_, content) => {
		const result = SheetCodec.parse({ content, fileName: "encoding.json" });
		expect(result.preview).toMatchObject({ format: "json", name: "Fixture", noteCount: 1 });
	});

	it("imports ABC text", () => {
		const result = SheetCodec.parse({
			content: "<DontCopyThisLine> 120 0 16 Author Transcriber\nA1 A2A3 .",
			fileName: "example.txt",
		});
		expect(result.preview).toMatchObject({ format: "abc", name: "example", noteCount: 3 });
		expect(result.sheet.songNotes).toEqual([
			{ time: 0, key: "1Key0" },
			{ time: 500, key: "1Key1" },
			{ time: 500, key: "1Key2" },
		]);
	});

	it("imports a standard MIDI file", () => {
		const midi = Buffer.from([
			0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x00, 0x60,
			0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, 0x13,
			0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
			0x00, 0x90, 0x3c, 0x40,
			0x60, 0x80, 0x3c, 0x40,
			0x00, 0xff, 0x2f, 0x00,
		]);
		const result = SheetCodec.parse({ content: midi, fileName: "middle-c.mid" });
		expect(result.preview).toMatchObject({ format: "midi", name: "middle-c", noteCount: 1 });
		expect(result.sheet.songNotes).toEqual([{ time: 0, key: "1Key0" }]);
	});

	it("decrypts encrypted numeric notes", () => {
		const encryptedNotes = [75, 89, -22, 98, 43, 90, 126, -21, 43, 24, 14, 22, 77, 56, 82, 57, 68, 19, 4, 93, 64, 123, 69, -31, 100, 97];
		const result = SheetCodec.parse({
			content: JSON.stringify(jsonSheet({ isEncrypted: true, songNotes: encryptedNotes })),
			fileName: "encrypted.json",
		});
		expect(result.sheet.isEncrypted).toBe(false);
		expect(result.sheet.songNotes).toEqual([{ time: 0, key: "1Key0" }]);
	});

	it("reports the exact invalid note", () => {
		expect(() => SheetCodec.parse({
			content: JSON.stringify(jsonSheet({ songNotes: [{ time: 250, key: "Key99" }] })),
			fileName: "broken.json",
		})).toThrow(expect.objectContaining({
			code: "KEY_OUT_OF_RANGE",
			userMessage: "Note 1 uses key 99, but supported keys are 0–14.",
		}));
	});

	it("loads stored payloads for the player and editor", () => {
		const loaded = SheetCodec.loadStored({
			version: 2,
			keyMap: { 0: ["y", "y"], 1000: [] },
			songNotes: [{ time: 0, key: "Key0", hold: 400 }],
		}, { bitsPerPage: 16 });

		expect(loaded.keyMap).toEqual({ 0: ["y"], 1000: [] });
		expect(loaded.songNotes).toEqual([{ time: 0, key: "1Key0", hold: 400 }]);
		expect(loaded.playbackNotes).toEqual([{ time: 0, key: "y", hold: 400 }]);
		expect(loaded.hasHoldNotes).toBe(true);
	});
});
