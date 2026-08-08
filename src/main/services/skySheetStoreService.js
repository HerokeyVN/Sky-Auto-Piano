import axios from "axios";

const SKY_SHEET_STORE_API_BASE_URL = "https://api.skysheet.store";
const SKY_SHEET_STORE_SITE_BASE_URL = "https://skysheet.store";
const DEFAULT_TIMEOUT_MS = 15000;
const LIST_CACHE_TTL_MS = 30_000;
const PLAYER_CACHE_TTL_MS = 120_000;
const MAX_LIST_RESPONSE_BYTES = 256 * 1024;
const MAX_PLAYER_RESPONSE_BYTES = 600 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SkySheetStoreService {
	constructor() {
		this.listCache = new Map();
		this.playerCache = new Map();
		this.http = axios.create({
			baseURL: SKY_SHEET_STORE_API_BASE_URL,
			timeout: DEFAULT_TIMEOUT_MS,
			responseType: "json",
			validateStatus: () => true,
			headers: {
				Accept: "application/json",
				"User-Agent": "SkyAutoPiano/1.3.7a",
			},
		});
	}

	get siteBaseUrl() {
		return SKY_SHEET_STORE_SITE_BASE_URL;
	}

	async listSheets({ q = "", limit = 20, offset = 0, refresh = false } = {}) {
		const normalizedQuery = typeof q === "string" ? q.trim() : "";
		const normalizedLimit = clampInteger(limit, 1, 100, 20);
		const normalizedOffset = clampInteger(offset, 0, Number.MAX_SAFE_INTEGER, 0);
		const cacheKey = JSON.stringify({
			q: normalizedQuery,
			limit: normalizedLimit,
			offset: normalizedOffset,
		});

		if (!refresh) {
			const cached = this.listCache.get(cacheKey);
			if (cached && Date.now() - cached.timestamp < LIST_CACHE_TTL_MS) {
				return cached.data;
			}
		}

		const response = await this.http.get("/api/v1/sheets", {
			params: {
				q: normalizedQuery || undefined,
				limit: normalizedLimit,
				offset: normalizedOffset,
				sort: "newest",
			},
			maxContentLength: MAX_LIST_RESPONSE_BYTES,
			maxBodyLength: MAX_LIST_RESPONSE_BYTES,
		});

		const payload = this.#parseResponse(response);
		if (!payload || !Array.isArray(payload.items)) {
			throw new Error("Sky Sheet Store returned an invalid sheet list.");
		}

		const mapped = {
			items: payload.items.map((item) => this.#mapSummary(item)),
			limit: clampInteger(payload.limit, 1, 100, normalizedLimit),
			offset: clampInteger(payload.offset, 0, Number.MAX_SAFE_INTEGER, normalizedOffset),
			total: clampInteger(payload.total, 0, Number.MAX_SAFE_INTEGER, 0),
		};

		this.listCache.set(cacheKey, {
			timestamp: Date.now(),
			data: mapped,
		});

		return mapped;
	}

	async getPlayerSheet(id) {
		const normalizedId = typeof id === "string" ? id.trim() : "";
		if (!UUID_PATTERN.test(normalizedId)) {
			throw new Error("Invalid Sky Sheet Store sheet id.");
		}

		const cached = this.playerCache.get(normalizedId);
		if (cached && Date.now() - cached.timestamp < PLAYER_CACHE_TTL_MS) {
			return cached.data;
		}

		const response = await this.http.get(`/api/v1/sheets/${normalizedId}/player`, {
			maxContentLength: MAX_PLAYER_RESPONSE_BYTES,
			maxBodyLength: MAX_PLAYER_RESPONSE_BYTES,
		});

		const payload = this.#parseResponse(response);
		if (!payload || typeof payload !== "object") {
			throw new Error("Sky Sheet Store returned an invalid player payload.");
		}

		const mapped = this.#mapPlayerPayload(payload);
		this.playerCache.set(normalizedId, {
			timestamp: Date.now(),
			data: mapped,
		});
		return mapped;
	}

	#parseResponse(response) {
		if (response.status >= 200 && response.status < 300) {
			return response.data;
		}

		const backendMessage = response.data?.message;
		const backendCode = response.data?.error;
		const error = new Error(backendMessage || "Sky Sheet Store request failed.");
		error.code = backendCode || `http_${response.status}`;
		error.status = response.status;
		throw error;
	}

	#mapSummary(item) {
		const id = asTrimmedString(item?.id);
		if (!UUID_PATTERN.test(id)) {
			throw new Error("Sky Sheet Store returned an invalid sheet id.");
		}

		const coverUrl = this.#normalizeApiUrl(item?.coverUrl || item?.cover_url || item?.coverImageUrl);
		const creator = item?.creator && typeof item.creator === "object"
			? {
				handle: asTrimmedString(item.creator.handle),
				displayName: asTrimmedString(item.creator.displayName) || "Unknown",
			}
			: null;

		return {
			id,
			title: asTrimmedString(item?.title) || "Unknown",
			author: asTrimmedString(item?.author) || "Unknown",
			transcribedBy: asTrimmedString(item?.transcribed_by || item?.transcribedBy) || "Unknown",
			bpm: clampInteger(item?.bpm, 0, 2000, 0),
			bitsPerPage: clampInteger(item?.bits_per_page || item?.bitsPerPage, 0, 128, 0),
			pitchLevel: clampInteger(item?.pitch_level || item?.pitchLevel, -12, 12, 0),
			durationMs: clampInteger(item?.duration_ms || item?.durationMs, 0, 15 * 60 * 1000, 0),
			noteCount: clampInteger(item?.note_count || item?.noteCount, 0, 20_000, 0),
			difficulty: asTrimmedString(item?.difficulty) || "Unknown",
			priceAmount: clampInteger(item?.price_amount || item?.priceAmount, 0, Number.MAX_SAFE_INTEGER, 0),
			currency: asTrimmedString(item?.currency) || "USD",
			tags: Array.isArray(item?.tags)
				? item.tags.map((tag) => asTrimmedString(tag)).filter(Boolean)
				: [],
			originCountryCode: asTrimmedString(item?.originCountryCode) || "",
			accessMode: asTrimmedString(item?.accessMode) || "downloadable",
			protectionMode: asTrimmedString(item?.protectionMode) || "none",
			isProtected: Boolean(item?.isProtected),
			isDownloadable: Boolean(item?.isDownloadable),
			viewerActionState: asTrimmedString(item?.viewerActionState) || "",
			creator,
			coverUrl,
			sourceUrl: `${SKY_SHEET_STORE_SITE_BASE_URL}/sheets/${id}`,
		};
	}

	#mapPlayerPayload(payload) {
		const sheet = payload.sheet && typeof payload.sheet === "object" ? payload.sheet : null;
		const player = payload.player && typeof payload.player === "object" ? payload.player : null;
		const runtime = payload.runtime && typeof payload.runtime === "object" ? payload.runtime : null;
		const viewer = payload.viewer && typeof payload.viewer === "object" ? payload.viewer : null;

		if (!sheet || !player || !runtime || !Array.isArray(runtime.notes)) {
			throw new Error("Sky Sheet Store returned an incomplete player payload.");
		}

		const id = asTrimmedString(sheet.id);
		if (!UUID_PATTERN.test(id)) {
			throw new Error("Sky Sheet Store returned an invalid player sheet id.");
		}

		return {
			sheet: {
				id,
				title: asTrimmedString(sheet.title) || "Unknown",
				author: asTrimmedString(sheet.author),
				transcribedBy: asTrimmedString(sheet.transcribedBy),
				bpm: clampInteger(sheet.bpm, 1, 2000, 120),
				durationMs: clampInteger(sheet.durationMs, 0, 15 * 60 * 1000, 0),
				noteCount: clampInteger(sheet.noteCount, 0, 20_000, 0),
				accessMode: asTrimmedString(sheet.accessMode) || "downloadable",
				priceAmount: clampInteger(sheet.priceAmount, 0, Number.MAX_SAFE_INTEGER, 0),
				currency: asTrimmedString(sheet.currency) || "USD",
			},
			player: {
				mode: asTrimmedString(player.mode) || "full",
				instrument: asTrimmedString(player.instrument),
				pitch: asTrimmedString(player.pitch),
				bpm: clampInteger(player.bpm, 1, 2000, 120),
				bitsPerPage: clampInteger(player.bitsPerPage, 1, 128, 16),
				pitchLevel: clampInteger(player.pitchLevel, -12, 12, 0),
			},
			runtime: {
				notes: runtime.notes.map((note) => ({
					timeMs: clampInteger(note?.timeMs, 0, 15 * 60 * 1000, 0),
					keys: Array.isArray(note?.keys)
						? note.keys.map((key) => asTrimmedString(key)).filter(Boolean)
						: [],
				})),
			},
			viewer: {
				hasEntitlement: Boolean(viewer?.hasEntitlement),
				isOwner: Boolean(viewer?.isOwner),
				canDownload: Boolean(viewer?.canDownload),
				canOpenFull: Boolean(viewer?.canOpenFull),
			},
		};
	}

	#normalizeApiUrl(rawUrl) {
		const trimmed = asTrimmedString(rawUrl);
		if (!trimmed) return "";

		if (trimmed.startsWith("/")) {
			return `${SKY_SHEET_STORE_API_BASE_URL}${trimmed}`;
		}

		try {
			const parsed = new URL(trimmed);
			if (parsed.protocol !== "https:") return "";
			if (parsed.hostname !== "api.skysheet.store") return "";
			return parsed.toString();
		} catch (_) {
			return "";
		}
	}
}

function asTrimmedString(value) {
	return typeof value === "string" ? value.trim() : "";
}

function clampInteger(value, min, max, fallback) {
	const num = Number(value);
	if (!Number.isFinite(num)) return fallback;
	const intValue = Math.trunc(num);
	if (intValue < min || intValue > max) return fallback;
	return intValue;
}
