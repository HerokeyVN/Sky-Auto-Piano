const { ipcRenderer, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { Base64 } = require("js-base64");
const marked = require("marked");

const appRoot = path.join(__dirname, "..", "..", "..");
const { SheetCodec } = require(path.join(appRoot, "src", "common", "sheetCodec.cjs"));
const dataDirectory = path.join(appRoot, "data");
const configPath = path.join(appRoot, "config", "config.json");
const listSheetPath = path.join(dataDirectory, "listSheet.json");
const playlistsPath = path.join(dataDirectory, "playlists.json");

const STORE_TAB = "sky-sheet-store";
const PLAYLISTS_TAB = "playlists";
const LOCAL_TABS = new Set(["all-songs", "favorite", "recent-play", PLAYLISTS_TAB]);
const STORE_SEARCH_DEBOUNCE_MS = 300;
const MAX_REMOTE_DURATION_MS = 15 * 60 * 1000;
const MAX_REMOTE_NOTE_COUNT = 20000;
// Sky Music Studio exports unprefixed keys (for example, "Key5").
// Treat those as the first page while retaining support for the existing
// page-prefixed sheet format (for example, "1Key5").
const SKY_KEY_PATTERN = /^(?:([0-9]+))?Key([0-9]+)$/;
const LOCAL_SEARCH_PLACEHOLDER = "Search the music sheet or author name...";
const STORE_SEARCH_PLACEHOLDER = "Search title, artist, or transcriber...";

const keys = [
	"y", "u", "i", "o", "p",
	"h", "j", "k", "l", ";",
	"n", "m", ",", ".", "/",
];

let config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
let listSheet = [];
let listKeys = [];
let listSheetPayloads = [];
let playlists = [];
let activePlaylistId = "";
let playlistPickerSheetIndex = null;
let playlistRenameId = "";
let isPlay = false;
let maxPCB = 0;
let loopMode = 0;
let loopTimer = null;
let manualStop = false;
let activeTab = "all-songs";
let localSearchQuery = "";
let bulkMode = false;
let bulkPlaylistId = "";
let bulkVisibleSheetKeys = [];
const bulkSelectedSheetKeys = new Set();

let currentPlayback = {
	type: "none",
	index: null,
	keyMap: null,
	notes: null,
	sheet: null,
};

const storeState = {
	items: [],
	query: "",
	loading: false,
	loadingPage: false,
	error: "",
	limit: 20,
	offset: 0,
	total: 0,
	page: 1,
	searchGeneration: 0,
	playingItemId: "",
	savingItemId: "",
	hasLoaded: false,
	cache: new Map(),
	searchTimer: null,
};

marked.setOptions({
	renderer: new marked.Renderer(),
});

ensureExists(dataDirectory);

const body = document.body;
const contentContainer = document.querySelector(".content");
const searchContainer = document.querySelector(".search-container");
const searchBar = document.getElementById("search-bar");
const addButton = document.querySelector(".btn-add");
const scrollTopButton = document.getElementById("scroll-top-btn");

document.addEventListener("click", (event) => {
	const target = event.target.closest("a");
	if (target && target.href && target.href.startsWith("http")) {
		event.preventDefault();
		shell.openExternal(target.href);
	}
});

init();

function init() {
	setupTheme();
	setupNavigation();
	setupTabs();
	setupSearch();
	setupContentEvents();
	setupPlaylistPicker();
	setupPlaybackControls();
	setupSettingsControls();
	applyConfigToUI(config);
	loadLocalSheets();
}

function setupNavigation() {
	const toggle = document.getElementById("nav-toggle");
	const navigation = document.querySelector(".nav-container");
	if (!toggle || !navigation) return;

	const closeNavigation = () => {
		body.classList.remove("nav-open");
		toggle.setAttribute("aria-expanded", "false");
		toggle.setAttribute("aria-label", "Open navigation");
	};

	toggle.addEventListener("click", () => {
		const isOpen = body.classList.toggle("nav-open");
		toggle.setAttribute("aria-expanded", String(isOpen));
		toggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
	});

	document.addEventListener("click", (event) => {
		if (!body.classList.contains("nav-open")) return;
		if (!navigation.contains(event.target) && !toggle.contains(event.target)) {
			closeNavigation();
		}
	});

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") closeNavigation();
	});
}

function setupTheme() {
	const themeToggleButtonLight = document.getElementById("btn-lightmode");
	const themeToggleButtonDark = document.getElementById("btn-darkmode");
	const lightModeBgColor = "#ffffff";
	const darkModeBgColor = "#1B1D1E";

	const applyTheme = (theme) => {
		if (theme === "dark") {
			body.classList.add("dark-mode");
			body.style.backgroundColor = darkModeBgColor;
		} else {
			body.classList.remove("dark-mode");
			body.style.backgroundColor = lightModeBgColor;
		}
		ipcRenderer.send("set-theme", theme);
	};

	const toggleTheme = () => {
		const newTheme = body.classList.contains("dark-mode") ? "light" : "dark";
		localStorage.setItem("theme", newTheme);
		applyTheme(newTheme);
	};

	themeToggleButtonLight?.addEventListener("click", toggleTheme);
	themeToggleButtonDark?.addEventListener("click", toggleTheme);

	const savedTheme = localStorage.getItem("theme");
	applyTheme(savedTheme || "light");
}

function setupTabs() {
	document.querySelectorAll(".nav-tab").forEach((tab) => {
		tab.addEventListener("click", () => {
			const tabType = tab.getAttribute("data-tab");
			if (!tabType) return;
			setActiveTab(tabType);
			body.classList.remove("nav-open");
			document.getElementById("nav-toggle")?.setAttribute("aria-expanded", "false");
			document.getElementById("nav-toggle")?.setAttribute("aria-label", "Open navigation");
		});
	});
}

function setupSearch() {
	if (!searchBar) return;

	searchBar.addEventListener("input", () => {
		if (activeTab === STORE_TAB) {
			storeState.query = searchBar.value.trim();
			if (storeState.searchTimer) {
				clearTimeout(storeState.searchTimer);
			}
			storeState.searchTimer = setTimeout(() => {
				void fetchStoreSheets({ page: 1, refresh: false });
			}, STORE_SEARCH_DEBOUNCE_MS);
			return;
		}

		localSearchQuery = searchBar.value;
		renderContent();
	});
}

function setupPlaylistPicker() {
	const picker = document.getElementById("playlist-picker");
	const form = document.getElementById("playlist-create-form");
	if (!picker || !form) return;

	picker.addEventListener("click", (event) => {
		if (event.target === picker || event.target.closest("[data-playlist-modal-action=\"close\"]")) {
			closePlaylistPicker();
			return;
		}

		if (event.target.closest(".playlist-picker-dialog")) {
			event.stopPropagation();
		}

		const addButton = event.target.closest("[data-playlist-modal-action=\"add\"]");
		if (addButton) {
			addSheetToPlaylist(addButton.getAttribute("data-playlist-id"), playlistPickerSheetIndex);
		}
	});

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		const input = document.getElementById("playlist-name-input");
		if (playlistRenameId) {
			const playlist = playlists.find((item) => item.id === playlistRenameId);
			const name = input.value.trim().slice(0, 80);
			if (!playlist) return;
			if (!name || playlists.some((item) => item.id !== playlist.id && item.name.toLowerCase() === name.toLowerCase())) {
				notie.alert({ type: 2, text: "Enter a unique playlist name." });
				return;
			}
			playlist.name = name;
			savePlaylists();
			closePlaylistPicker();
			renderContent();
			return;
		}
		const playlist = createPlaylist(input?.value || "");
		if (!playlist) return;
		if (input) input.value = "";
		if (Number.isInteger(playlistPickerSheetIndex)) {
			addSheetToPlaylist(playlist.id, playlistPickerSheetIndex);
		} else {
			closePlaylistPicker();
		}
		renderContent();
		renderPlaylistPicker();
	});
}

function loadPlaylists() {
	try {
		if (!fs.existsSync(playlistsPath)) {
			playlists = [];
			return;
		}
		const parsed = JSON.parse(fs.readFileSync(playlistsPath, "utf8"));
		playlists = Array.isArray(parsed) ? parsed
			.map((playlist) => ({
				id: typeof playlist?.id === "string" ? playlist.id : "",
				name: typeof playlist?.name === "string" ? playlist.name.trim().slice(0, 80) : "",
				sheetKeys: Array.from(new Set(Array.isArray(playlist?.sheetKeys)
					? playlist.sheetKeys.filter((key) => typeof key === "string" && key)
					: [])),
			}))
			.filter((playlist) => playlist.id && playlist.name)
			: [];
	} catch (error) {
		console.error("Failed to load playlists:", error);
		playlists = [];
	}
}

function savePlaylists() {
	fs.writeFileSync(playlistsPath, JSON.stringify(playlists, null, 4), { mode: 0o666 });
}

function createPlaylist(rawName) {
	const name = String(rawName || "").trim().slice(0, 80);
	if (!name) {
		notie.alert({ type: 2, text: "Enter a playlist name." });
		return null;
	}
	if (playlists.some((playlist) => playlist.name.toLowerCase() === name.toLowerCase())) {
		notie.alert({ type: 2, text: "A playlist with this name already exists." });
		return null;
	}
	const playlist = {
		id: `playlist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		name,
		sheetKeys: [],
	};
	playlists.push(playlist);
	savePlaylists();
	return playlist;
}

function getActivePlaylist() {
	return playlists.find((playlist) => playlist.id === activePlaylistId) || null;
}

function getPlaylistSheetIndices(playlist) {
	if (!playlist) return [];
	const byKeyMap = new Map(listSheet.map((sheet, index) => [sheet.keyMap, index]));
	return playlist.sheetKeys.map((keyMap) => byKeyMap.get(keyMap)).filter(Number.isInteger);
}

function addSheetToPlaylist(playlistId, sheetIndex) {
	const playlist = playlists.find((item) => item.id === playlistId);
	const sheet = listSheet[sheetIndex];
	if (!playlist || !sheet) return;
	if (playlist.sheetKeys.includes(sheet.keyMap)) {
		notie.alert({ type: 2, text: "This sheet is already in the playlist." });
		return;
	}
	playlist.sheetKeys.push(sheet.keyMap);
	savePlaylists();
	renderPlaylistPicker();
	notie.alert({ type: 1, text: "Added to playlist." });
}

function removeSheetFromPlaylist(sheetIndex) {
	const playlist = getActivePlaylist();
	const sheet = listSheet[sheetIndex];
	if (!playlist || !sheet) return;
	playlist.sheetKeys = playlist.sheetKeys.filter((keyMap) => keyMap !== sheet.keyMap);
	savePlaylists();
	renderContent();
}

function moveSheetInActivePlaylist(sheetIndex, direction) {
	const playlist = getActivePlaylist();
	const sheet = listSheet[sheetIndex];
	if (!playlist || !sheet) return;

	const currentIndex = playlist.sheetKeys.indexOf(sheet.keyMap);
	const nextIndex = currentIndex + direction;
	if (currentIndex === -1 || nextIndex < 0 || nextIndex >= playlist.sheetKeys.length) return;

	[playlist.sheetKeys[currentIndex], playlist.sheetKeys[nextIndex]] = [playlist.sheetKeys[nextIndex], playlist.sheetKeys[currentIndex]];
	savePlaylists();
	renderContent();
}

function removeSheetFromPlaylists(sheetKeyMap) {
	let changed = false;
	playlists.forEach((playlist) => {
		const nextKeys = playlist.sheetKeys.filter((keyMap) => keyMap !== sheetKeyMap);
		if (nextKeys.length !== playlist.sheetKeys.length) {
			playlist.sheetKeys = nextKeys;
			changed = true;
		}
	});
	if (changed) savePlaylists();
}

function setBulkMode(enabled) {
	bulkMode = Boolean(enabled);
	if (!bulkMode) {
		bulkSelectedSheetKeys.clear();
		bulkPlaylistId = "";
	} else if (!playlists.some((playlist) => playlist.id === bulkPlaylistId)) {
		bulkPlaylistId = playlists[0]?.id || "";
	}
	closeLocalActionMenus();
	renderContent();
}

function toggleBulkSheet(sheetKeyMap) {
	if (!sheetKeyMap) return;
	if (bulkSelectedSheetKeys.has(sheetKeyMap)) bulkSelectedSheetKeys.delete(sheetKeyMap);
	else bulkSelectedSheetKeys.add(sheetKeyMap);
	renderContent();
}

function toggleAllVisibleSheets() {
	const allSelected = bulkVisibleSheetKeys.length > 0
		&& bulkVisibleSheetKeys.every((key) => bulkSelectedSheetKeys.has(key));
	for (const key of bulkVisibleSheetKeys) {
		if (allSelected) bulkSelectedSheetKeys.delete(key);
		else bulkSelectedSheetKeys.add(key);
	}
	renderContent();
}

function addBulkSelectionToPlaylist() {
	const playlist = playlists.find((item) => item.id === bulkPlaylistId);
	if (!playlist) {
		notie.alert({ type: 2, text: "Create or select a playlist first." });
		return;
	}
	const selectedSheets = listSheet.filter((sheet) => bulkSelectedSheetKeys.has(sheet.keyMap));
	if (!selectedSheets.length) return;

	let added = 0;
	for (const sheet of selectedSheets) {
		if (playlist.sheetKeys.includes(sheet.keyMap)) continue;
		playlist.sheetKeys.push(sheet.keyMap);
		added++;
	}
	if (added > 0) savePlaylists();
	notie.alert({
		type: added > 0 ? 1 : 2,
		text: added > 0
			? `Added ${added} sheet${added === 1 ? "" : "s"} to ${playlist.name}.`
			: `All selected sheets are already in ${playlist.name}.`,
	});
}

function deleteBulkSelection() {
	const selectedSheets = listSheet.filter((sheet) => bulkSelectedSheetKeys.has(sheet.keyMap));
	if (!selectedSheets.length) return;
	if (!window.confirm(`Delete ${selectedSheets.length} selected sheet${selectedSheets.length === 1 ? "" : "s"}? This cannot be undone.`)) return;

	const deletedKeys = new Set();
	const failedNames = [];
	for (const sheet of selectedSheets) {
		try {
			const sheetPath = path.resolve(dataDirectory, sheet.keyMap);
			const relativePath = path.relative(dataDirectory, sheetPath);
			if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
				throw new Error("Invalid sheet file path.");
			}
			if (fs.existsSync(sheetPath)) fs.unlinkSync(sheetPath);
			deletedKeys.add(sheet.keyMap);
		} catch (error) {
			console.error("Failed to delete sheet:", sheet.name, error);
			failedNames.push(sheet.name || sheet.keyMap);
		}
	}
	if (!deletedKeys.size) {
		notie.alert({ type: 3, text: `Unable to delete the selected sheets. ${failedNames[0] || ""}`.trim() });
		return;
	}

	const previousPlaybackKey = currentPlayback.type === "local" ? currentPlayback.sheet?.keyMap : null;
	const nextSheets = [];
	const nextKeys = [];
	const nextPayloads = [];
	listSheet.forEach((sheet, index) => {
		if (deletedKeys.has(sheet.keyMap)) return;
		nextSheets.push(sheet);
		nextKeys.push(listKeys[index]);
		nextPayloads.push(listSheetPayloads[index]);
	});
	listSheet = nextSheets;
	listKeys = nextKeys;
	listSheetPayloads = nextPayloads;

	for (const playlist of playlists) {
		playlist.sheetKeys = playlist.sheetKeys.filter((key) => !deletedKeys.has(key));
	}
	savePlaylists();
	fs.writeFileSync(listSheetPath, JSON.stringify(listSheet, null, 4), { mode: 0o666 });

	bulkSelectedSheetKeys.clear();
	bulkMode = false;
	bulkPlaylistId = "";
	if (previousPlaybackKey && deletedKeys.has(previousPlaybackKey)) {
		if (listSheet.length) void selectLocalSheet(0, { trackRecentPlay: false });
		else {
			currentPlayback = { type: "none", index: null, keyMap: null, notes: null, sheet: null };
			clearFooter();
		}
	} else if (previousPlaybackKey) {
		currentPlayback.index = listSheet.findIndex((sheet) => sheet.keyMap === previousPlaybackKey);
	}
	renderContent();

	notie.alert({
		type: failedNames.length ? 2 : 1,
		text: failedNames.length
			? `Deleted ${deletedKeys.size} sheet(s). Failed: ${failedNames.join(", ")}.`
			: `Deleted ${deletedKeys.size} sheet${deletedKeys.size === 1 ? "" : "s"}.`,
	});
}

function renderBulkToolbar() {
	const selectedCount = bulkSelectedSheetKeys.size;
	const allVisibleSelected = bulkVisibleSheetKeys.length > 0
		&& bulkVisibleSheetKeys.every((key) => bulkSelectedSheetKeys.has(key));
	const playlistOptions = playlists.map((playlist) =>
		`<option value="${escapeAttribute(playlist.id)}" ${playlist.id === bulkPlaylistId ? "selected" : ""}>${escapeHtml(playlist.name)}</option>`
	).join("");

	return `<div class="bulk-toolbar">
		<div class="bulk-selection-control">
			<button type="button" class="bulk-select-all" data-bulk-action="select-visible" aria-pressed="${allVisibleSelected}" aria-label="${allVisibleSelected ? "Clear visible selection" : "Select all visible sheets"}" title="${allVisibleSelected ? "Clear visible selection" : "Select all visible sheets"}" ${bulkVisibleSheetKeys.length ? "" : "disabled"}>
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-check-square" viewBox="0 0 16 16" aria-hidden="true"><path d="M14 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z"/>${allVisibleSelected ? '<path d="M10.97 4.97a.75.75 0 0 1 1.071 1.05l-3.992 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425z"/>' : ""}</svg>
			</button>
			<span class="bulk-selection-summary"><strong>${selectedCount}</strong> selected</span>
		</div>
		<div class="bulk-toolbar-actions">
			<select class="bulk-playlist-select" data-bulk-playlist-select aria-label="Target playlist" ${playlists.length ? "" : "disabled"}>
				${playlistOptions || `<option value="">No playlists</option>`}
			</select>
			<button type="button" class="bulk-btn primary" data-bulk-action="add-playlist" ${selectedCount && playlists.length ? "" : "disabled"}>Add to playlist</button>
			<button type="button" class="bulk-btn danger" data-bulk-action="delete" ${selectedCount ? "" : "disabled"}>Delete</button>
			<button type="button" class="bulk-btn" data-bulk-action="cancel">Done</button>
		</div>
	</div>`;
}

function updateScrollTopButton() {
	if (!scrollTopButton) return;
	const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
	scrollTopButton.hidden = scrollTop < 280;
}

function openPlaylistPicker(sheetIndex = null, renameId = "") {
	if (sheetIndex !== null && !listSheet[sheetIndex]) return;
	playlistPickerSheetIndex = sheetIndex;
	playlistRenameId = renameId;
	const playlist = playlists.find((item) => item.id === renameId);
	document.getElementById("playlist-picker-title").textContent = renameId ? "Rename Playlist" : sheetIndex === null ? "New Playlist" : "Add to Playlist";
	const input = document.getElementById("playlist-name-input");
	input.value = playlist?.name || "";
	document.querySelector("#playlist-create-form button[type=submit]").textContent = renameId ? "Save" : "Create";
	renderPlaylistPicker();
	const picker = document.getElementById("playlist-picker");
	picker?.classList.add("show");
	picker?.setAttribute("aria-hidden", "false");
	ipcRenderer.send("set-shortcuts-suspended", true);
	requestAnimationFrame(() => {
		input.focus();
		input.select();
	});
}

function closePlaylistPicker() {
	playlistPickerSheetIndex = null;
	playlistRenameId = "";
	const picker = document.getElementById("playlist-picker");
	picker?.classList.remove("show");
	picker?.setAttribute("aria-hidden", "true");
	ipcRenderer.send("set-shortcuts-suspended", false);
}

function renderPlaylistPicker() {
	const list = document.getElementById("playlist-picker-list");
	if (!list) return;
	const sheet = listSheet[playlistPickerSheetIndex];
	if (!sheet) {
		list.innerHTML = "";
		return;
	}
	if (!playlists.length) {
		list.innerHTML = `<div class="playlist-empty-copy">Create a playlist to add ${escapeHtml(sheet.name)}.</div>`;
		return;
	}
	list.innerHTML = playlists.map((playlist) => {
		const added = playlist.sheetKeys.includes(sheet.keyMap);
		return `<div class="playlist-picker-row"><span>${escapeHtml(playlist.name)}</span><button class="store-action-btn primary" data-playlist-modal-action="add" data-playlist-id="${escapeAttribute(playlist.id)}" ${added ? "disabled" : ""}>${added ? "Added" : "Add"}</button></div>`;
	}).join("");
}

function renderPlaylists() {
	const activePlaylist = getActivePlaylist();
	if (activePlaylist) {
		contentContainer.innerHTML = `<section class="playlist-browser"><div class="playlist-toolbar playlist-detail-toolbar"><button class="store-toolbar-btn playlist-back-btn" data-playlist-action="back" aria-label="Back" title="Back"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-left" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M15 8a.5.5 0 0 0-.5-.5H2.707l3.147-3.146a.5.5 0 1 0-.708-.708l-4 4a.5.5 0 0 0 0 .708l4 4a.5.5 0 0 0 .708-.708L2.707 8.5H14.5A.5.5 0 0 0 15 8"/></svg></button><div class="playlist-detail-heading"><h2 class="playlist-title">${escapeHtml(activePlaylist.name)}</h2><p class="playlist-subtitle">${getPlaylistSheetIndices(activePlaylist).length} sheets</p></div><span class="playlist-detail-spacer" aria-hidden="true"></span></div></section>`;
		renderLocalLibrary(getPlaylistSheetIndices(activePlaylist), { preserveContent: true });
		return;
	}

	const cards = playlists.map((playlist) => `<article class="playlist-card" data-playlist-action="open" data-playlist-id="${escapeAttribute(playlist.id)}"><div class="playlist-card-info"><h3>${escapeHtml(playlist.name)}</h3><p>${getPlaylistSheetIndices(playlist).length} sheets</p></div><div class="playlist-card-actions"><div class="local-actions-menu"><button type="button" class="local-actions-toggle" aria-label="Playlist actions"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" class="bi bi-three-dots-vertical local-actions-more-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0m0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0m0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0"/></svg><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x local-actions-close-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708"/></svg></button><div class="local-actions-popover"><button type="button" class="local-action-item" data-playlist-action="rename" data-playlist-id="${escapeAttribute(playlist.id)}"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" class="bi bi-pencil" viewBox="0 0 16 16" fill="currentColor"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325"/></svg><span>Rename</span></button><button type="button" class="local-action-item danger" data-playlist-action="delete" data-playlist-id="${escapeAttribute(playlist.id)}"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" class="bi bi-trash3" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5M11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H2.506a.58.58 0 0 0-.01 0H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66h.538a.5.5 0 0 0 0-1h-.995a.59.59 0 0 0-.01 0zm1.958 1-.846 10.58a1 1 0 0 1-.997.92h-6.23a1 1 0 0 1-.997-.92L3.042 3.5zm-7.487 1a.5.5 0 0 1 .528.47l.5 8.5a.5.5 0 0 1-.998.06L5 5.03a.5.5 0 0 1 .47-.53Zm5.058 0a.5.5 0 0 1 .47.53l-.5 8.5a.5.5 0 1 1-.998-.06l.5-8.5a.5.5 0 0 1 .528-.47ZM8 4.5a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-1 0V5a.5.5 0 0 1 .5-.5"/></svg><span>Delete</span></button></div></div></div></article>`).join("");
	contentContainer.innerHTML = `<section class="playlist-browser"><div class="playlist-toolbar"><div><h2 class="playlist-title">Playlists</h2></div><button class="store-toolbar-btn" data-playlist-action="create">New Playlist</button></div><div class="playlist-card-list">${cards || `<div class="store-state-card"><div class="store-state-title">No playlists yet.</div><div class="store-state-copy">Create a playlist, then add sheets from your library.</div></div>`}</div></section>`;
}

function handlePlaylistAction(actionButton) {
	const action = actionButton.getAttribute("data-playlist-action");
	const playlistId = actionButton.getAttribute("data-playlist-id");
	switch (action) {
		case "open":
			if (playlistId && playlists.some((playlist) => playlist.id === playlistId)) {
				activePlaylistId = playlistId;
				renderContent();
			}
			return;
		case "back":
			activePlaylistId = "";
			renderContent();
			return;
		case "create": {
			openPlaylistPicker();
			return;
		}
		case "rename": {
			const playlist = playlists.find((item) => item.id === playlistId);
			if (!playlist) return;
			openPlaylistPicker(null, playlist.id);
			return;
		}
		case "delete":
			if (!playlistId || !window.confirm("Delete this playlist? Sheets will remain in your library.")) return;
			playlists = playlists.filter((playlist) => playlist.id !== playlistId);
			if (activePlaylistId === playlistId) activePlaylistId = "";
			savePlaylists();
			renderContent();
			return;
		default:
			return;
	}
}
function setupContentEvents() {
	contentContainer.addEventListener("click", async (event) => {
		const bulkSelect = event.target.closest("[data-bulk-select]");
		if (bulkSelect) {
			event.preventDefault();
			toggleBulkSheet(bulkSelect.getAttribute("data-bulk-select"));
			return;
		}

		const bulkAction = event.target.closest("[data-bulk-action]");
		if (bulkAction) {
			event.preventDefault();
			switch (bulkAction.getAttribute("data-bulk-action")) {
				case "toggle":
				case "cancel":
					setBulkMode(!bulkMode);
					return;
				case "select-visible":
					toggleAllVisibleSheets();
					return;
				case "add-playlist":
					addBulkSelectionToPlaylist();
					return;
				case "delete":
					deleteBulkSelection();
					return;
				default:
					return;
			}
		}

		const clickedActionMenu = event.target.closest(".local-actions-menu");
		const actionToggle = event.target.closest(".local-actions-toggle");
		if (actionToggle) {
			event.preventDefault();
			const actionMenu = actionToggle.closest(".local-actions-menu");
			if (!actionMenu) return;
			const shouldOpen = !actionMenu.classList.contains("open");
			closeLocalActionMenus();
			if (shouldOpen) openLocalActionMenu(actionMenu);
			return;
		}
		if (!clickedActionMenu) closeLocalActionMenus();

		const playlistAction = event.target.closest("[data-playlist-action]");
		if (playlistAction) {
			if (clickedActionMenu) {
				if (playlistAction === clickedActionMenu.closest(".playlist-card")) {
					return;
				}
				closeLocalActionMenus();
			}
			event.preventDefault();
			handlePlaylistAction(playlistAction);
			return;
		}

		const localAction = event.target.closest("[data-local-action]");
		if (localAction) {
			event.preventDefault();
			const actionMenu = localAction.closest(".local-actions-menu");
			if (actionMenu) closeLocalActionMenus();
			const index = Number(localAction.getAttribute("data-index"));
			if (!Number.isInteger(index) || index < 0 || index >= listSheet.length) return;
			const action = localAction.getAttribute("data-local-action");
			if (action === "favorite") {
				toggleFavorite(listSheet[index].name);
				renderContent();
				return;
			}
			if (action === "playlist") {
				openPlaylistPicker(index);
				return;
			}
			if (action === "playlist-remove") {
				removeSheetFromPlaylist(index);
				return;
			}
			if (action === "playlist-move-up") {
				moveSheetInActivePlaylist(index, -1);
				return;
			}
			if (action === "playlist-move-down") {
				moveSheetInActivePlaylist(index, 1);
				return;
			}
			if (action === "edit") {
				ipcRenderer.send("openSheetEditor", { sheetIndex: index });
				return;
			}
			if (action === "delete") {
				deleteLocalSheet(index);
			}
			return;
		}

		const storeAction = event.target.closest("[data-store-action]");
		if (storeAction) {
			event.preventDefault();
			const action = storeAction.getAttribute("data-store-action");
			switch (action) {
				case "refresh":
				case "retry":
					void fetchStoreSheets({ page: 1, refresh: true });
					return;
				case "page-prev":
					if (storeState.page > 1) {
						void fetchStoreSheets({ page: storeState.page - 1, refresh: false });
					}
					return;
				case "page-next":
					if (storeState.page < getStoreTotalPages()) {
						void fetchStoreSheets({ page: storeState.page + 1, refresh: false });
					}
					return;
				case "page": {
					const page = Number(storeAction.getAttribute("data-store-page"));
					if (Number.isInteger(page) && page > 0 && page !== storeState.page) {
						void fetchStoreSheets({ page, refresh: false });
					}
					return;
				}
				case "play":
				case "save": {
					const sheetId = storeAction.getAttribute("data-sheet-id");
					if (!sheetId) return;
					if (action === "play") {
						await playStoreSheet(sheetId);
						return;
					}
					await saveStoreSheet(sheetId);
					return;
				}
				default:
					return;
			}
			return;
		}

		if (clickedActionMenu) return;

		const localCard = event.target.closest("[data-local-card]");
		if (localCard) {
			const index = Number(localCard.getAttribute("data-index"));
			if (Number.isInteger(index) && index >= 0 && index < listSheet.length) {
				if (bulkMode) {
					toggleBulkSheet(listSheet[index].keyMap);
					return;
				}
				void selectLocalSheet(index, { trackRecentPlay: true });
			}
		}
	});

	contentContainer.addEventListener("change", (event) => {
		const select = event.target.closest("[data-bulk-playlist-select]");
		if (!select) return;
		bulkPlaylistId = select.value;
	});

	scrollTopButton?.addEventListener("click", () => {
		window.scrollTo({ top: 0, behavior: "smooth" });
	});

	document.addEventListener("click", (event) => {
		if (!event.target.closest(".local-actions-menu")) {
			closeLocalActionMenus();
		}
	});

	window.addEventListener("resize", () => closeLocalActionMenus());
	window.addEventListener("scroll", () => {
		closeLocalActionMenus();
		updateScrollTopButton();
	}, true);
	updateScrollTopButton();
}

function closeLocalActionMenus(exceptMenu = null) {
	contentContainer.querySelectorAll(".local-actions-menu.open").forEach((menu) => {
		if (menu === exceptMenu) return;
		menu.classList.remove("open", "open-up", "open-down");
		const popover = menu.querySelector(".local-actions-popover");
		if (popover) popover.style.removeProperty("--popover-shift");
		const card = menu.closest(".card, .playlist-card");
		if (card) card.classList.remove("local-action-card-open");
	});
}

function openLocalActionMenu(menu) {
	const popover = menu.querySelector(".local-actions-popover");
	const toggle = menu.querySelector(".local-actions-toggle");
	if (!popover || !toggle) return;

	menu.classList.add("open");
	const card = menu.closest(".card, .playlist-card");
	if (card) card.classList.add("local-action-card-open");

	popover.style.setProperty("--popover-shift", "0px");
	menu.classList.remove("open-up", "open-down");
	menu.classList.add("open-down");

	const toggleRect = toggle.getBoundingClientRect();
	const popoverRect = popover.getBoundingClientRect();
	const viewportPadding = 8;
	const spaceBelow = window.innerHeight - toggleRect.bottom;
	const spaceAbove = toggleRect.top;

	if (spaceBelow < popoverRect.height + viewportPadding && spaceAbove > spaceBelow) {
		menu.classList.remove("open-down");
		menu.classList.add("open-up");
	}

	const adjustedRect = popover.getBoundingClientRect();
	let shift = 0;
	if (adjustedRect.right > window.innerWidth - viewportPadding) {
		shift -= adjustedRect.right - (window.innerWidth - viewportPadding);
	}
	if (adjustedRect.left + shift < viewportPadding) {
		shift += viewportPadding - (adjustedRect.left + shift);
	}
	popover.style.setProperty("--popover-shift", `${Math.round(shift)}px`);
}

function setupPlaybackControls() {
	document.getElementById("btn-prev").addEventListener("click", btnPrev);
	document.getElementById("btn-next").addEventListener("click", btnNext);
	document.getElementById("btn-play").addEventListener("click", btnPlay);
	document.getElementById("process-bar").addEventListener("change", (event) => {
		document.getElementById("process-bar").max = maxPCB;
		updateLiveTime(Number(event.target.value));
	});

	ipcRenderer.on("btn-prev", () => {
		if (!shouldIgnoreShortcutEvent()) btnPrev();
	});
	ipcRenderer.on("btn-next", () => {
		if (!shouldIgnoreShortcutEvent()) btnNext();
	});
	ipcRenderer.on("btn-play", () => {
		if (!shouldIgnoreShortcutEvent()) btnPlay();
	});
	ipcRenderer.on("process-bar", (_, data) => {
		document.getElementById("process-bar").value = data;
		updateLiveTime(Number(data));
	});
	ipcRenderer.on("speed-changed", (_, newSpeed) => {
		if (shouldIgnoreShortcutEvent()) return;
		document.getElementById("speed-btn").value = newSpeed;
	});
	ipcRenderer.on("stop-player", (_, data) => {
		if (loopTimer) {
			clearTimeout(loopTimer);
			loopTimer = null;
		}

		renderPlayButton(false);
		isPlay = false;
		document.getElementById("process-bar").disabled = false;

		const manualStopEvent = data?.manualStop === true;
		const shouldResetPosition = !(manualStopEvent || manualStop);
		if (shouldResetPosition) {
			document.getElementById("process-bar").value = 0;
			document.querySelector(".live-time").innerHTML = "00:00";
		}

		if (manualStopEvent || manualStop) {
			manualStop = false;
			return;
		}

		if (loopMode === 1) {
			btnNext();
			const delay = getDelayLoopSeconds();
			loopTimer = setTimeout(() => {
				if (!manualStop) btnPlay();
			}, delay * 1000);
			return;
		}

		if (loopMode === 2) {
			const delay = getDelayLoopSeconds();
			loopTimer = setTimeout(() => {
				if (!manualStop) btnPlay();
			}, delay * 1000);
		}
	});
	ipcRenderer.on("stop", () => {
		renderPlayButton(false);
		isPlay = false;
		manualStop = true;
		if (loopTimer) {
			clearTimeout(loopTimer);
			loopTimer = null;
		}
		document.getElementById("process-bar").disabled = false;
	});
}

function shouldIgnoreShortcutEvent() {
	const activeElement = document.activeElement;
	if (!activeElement) return false;
	const tagName = activeElement.tagName;
	return Boolean(
		document.getElementById("playlist-picker")?.classList.contains("show")
		|| activeElement.isContentEditable
		|| tagName === "INPUT"
		|| tagName === "TEXTAREA"
		|| tagName === "SELECT",
	);
}

function setupSettingsControls() {
	document.getElementsByClassName("long-press")[0].addEventListener("click", (event) => {
		ipcRenderer.send("longPressMode", event.target.checked);
	});

	document.getElementsByClassName("bi-loop")[0].addEventListener("click", () => {
		if (loopMode === 0) {
			loopMode = 1;
			document.getElementsByClassName("bi-loop")[0].style =
				"box-shadow: inset 0 0 15px 0 rgba(256, 256, 1, 0.2), 0 0 15px 0 rgba(256, 256, 1, 0.4); border-radius: 5px; padding: 0 2px;";
			return;
		}

		if (loopMode === 1) {
			loopMode = 2;
			document.getElementsByClassName("bi-loop")[0].innerHTML = `<path d="M11 4v1.466a.25.25 0 0 0 .41.192l2.36-1.966a.25.25 0 0 0 0-.384l-2.36-1.966a.25.25 0 0 0-.41.192V3H5a5 5 0 0 0-4.48 7.223.5.5 0 0 0 .896-.446A4 4 0 0 1 5 4zm4.48 1.777a.5.5 0 0 0-.896.446A4 4 0 0 1 11 12H5.001v-1.466a.25.25 0 0 0-.41-.192l-2.36 1.966a.25.25 0 0 0 0 .384l2.36 1.966a.25.25 0 0 0 .41-.192V13h6a5 5 0 0 0 4.48-7.223Z"/><path d="M9 5.5a.5.5 0 0 0-.854-.354l-1.75 1.75a.5.5 0 1 0 .708.708L8 6.707V10.5a.5.5 0 0 0 1 0z"/>`;
			return;
		}

		loopMode = 0;
		document.getElementsByClassName("bi-loop")[0].style = "";
		document.getElementsByClassName("bi-loop")[0].innerHTML = `<path d="M11 5.466V4H5a4 4 0 0 0-3.584 5.777.5.5 0 1 1-.896.446A5 5 0 0 1 5 3h6V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192m3.81.086a.5.5 0 0 1 .67.225A5 5 0 0 1 11 13H5v1.466a.25.25 0 0 1-.41.192l-2.36-1.966a.25.25 0 0 1 0-.384l2.36-1.966a.25.25 0 0 1 .41.192V12h6a4 4 0 0 0 3.585-5.777.5.5 0 0 1 .225-.67Z"/>`;
	});

	document.getElementById("delay-loop").addEventListener("change", (event) => {
		document.getElementById("delay-next-value").innerHTML = `Delay next: ${event.target.value}s`;
		ipcRenderer.send("changeDelayNext", getDelayLoopSeconds());
	});

	document.getElementById("speed-btn").addEventListener("change", (event) => {
		if (Number(event.target.value) < Number(event.target.min)) event.target.value = event.target.min;
		if (Number(event.target.value) > Number(event.target.max)) event.target.value = event.target.max;
		const roundedSpeed = Math.round(Number(event.target.value) * 10) / 10;
		event.target.value = roundedSpeed;
		ipcRenderer.send("changeSpeed", roundedSpeed);
	});

	document.getElementById("btn-setting").addEventListener("click", () => {
		notie.alert({
			type: 2,
			text: "When opening the settings, you will not be able to use shortcuts, please turn off the settings to use the shortcut!",
		});
		ipcRenderer.send("openSetting");
	});
}

function applyConfigToUI(currentConfig) {
	if (!currentConfig) return;
	document.getElementById("shortcut-pre").innerHTML = currentConfig.shortcut.pre;
	document.getElementById("shortcut-play").innerHTML = currentConfig.shortcut.play;
	document.getElementById("shortcut-next").innerHTML = currentConfig.shortcut.next;
	document.getElementById("speed-btn").value = currentConfig.panel.speed;
	document.getElementById("switch").checked = currentConfig.panel.longPressMode;
	document.getElementById("delay-loop").value = currentConfig.panel.delayNext;
	document.getElementById("delay-next-value").innerHTML = `Delay next: ${currentConfig.panel.delayNext}s`;
}

ipcRenderer.on("config-updated", (_, updatedConfig) => {
	config = updatedConfig;
	applyConfigToUI(config);
});

function loadLocalSheets() {
	loadPlaylists();
	fs.readFile(listSheetPath, { encoding: "utf8" }, async (err, data) => {
		if (err) {
			fs.writeFile(listSheetPath, JSON.stringify([], null, 4), { mode: 0o666 }, (writeErr) => {
				if (writeErr) console.error("Failed to create listSheet.json:", writeErr);
			});
			listSheet = [];
			listKeys = [];
			renderContent();
			clearFooter();
			return;
		}

		try {
			listSheet = JSON.parse(data);
			if (!Array.isArray(listSheet)) listSheet = [];
		} catch (parseErr) {
			console.error("Failed to parse listSheet.json:", parseErr);
			listSheet = [];
		}

		listKeys = new Array(listSheet.length);
		listSheetPayloads = new Array(listSheet.length);
		renderContent();

		if (listSheet.length > 0) {
			await selectLocalSheet(0, { trackRecentPlay: false });
		} else {
			clearFooter();
		}
	});
}

function setActiveTab(tabType) {
	if (activeTab !== STORE_TAB) {
		localSearchQuery = searchBar?.value || "";
	} else if (searchBar) {
		storeState.query = searchBar.value.trim();
	}

	if (activeTab !== tabType && bulkMode) {
		bulkMode = false;
		bulkPlaylistId = "";
		bulkSelectedSheetKeys.clear();
	}
	activeTab = tabType;
	document.querySelectorAll(".nav-tab").forEach((tab) => {
		tab.classList.toggle("active", tab.getAttribute("data-tab") === tabType);
	});

	const isStore = tabType === STORE_TAB;
	addButton.style.display = isStore ? "none" : "";
	if (searchContainer) {
		searchContainer.style.display = "flex";
	}
	if (searchBar) {
		searchBar.placeholder = isStore ? STORE_SEARCH_PLACEHOLDER : LOCAL_SEARCH_PLACEHOLDER;
		searchBar.value = isStore ? storeState.query : localSearchQuery;
	}

	if (isStore && !storeState.hasLoaded) {
		void fetchStoreSheets({ page: 1, refresh: false });
	}

	renderContent();
}

function renderContent() {
	if (activeTab === STORE_TAB) {
		renderStoreBrowser();
		return;
	}
	if (activeTab === PLAYLISTS_TAB) {
		renderPlaylists();
		return;
	}
	renderLocalLibrary();
}

function renderLocalLibrary(sheetIndexes = null, { preserveContent = false } = {}) {
	const searchTerm = localSearchQuery.toLowerCase().trim();
	const favorites = getFavorites();
	const recentPlays = getRecentPlays();
	const fragment = document.createDocumentFragment();
	const availableSheetKeys = new Set(listSheet.map((sheet) => sheet.keyMap));
	for (const selectedKey of bulkSelectedSheetKeys) {
		if (!availableSheetKeys.has(selectedKey)) bulkSelectedSheetKeys.delete(selectedKey);
	}
	const indexes = Array.isArray(sheetIndexes) ? sheetIndexes : listSheet.map((_, index) => index);
	const visibleIndexes = indexes.filter((index) => {
		const sheetData = listSheet[index];
		return sheetData && shouldShowLocalSheet(sheetData, searchTerm, favorites, recentPlays);
	});
	bulkVisibleSheetKeys = visibleIndexes.map((index) => listSheet[index].keyMap);

	if (!preserveContent) contentContainer.innerHTML = "";
	if (activeTab !== PLAYLISTS_TAB) {
		const header = document.createElement("div");
		header.className = "library-header";
		header.innerHTML = `<h2>${getLocalTabTitle()}</h2><button type="button" class="bulk-mode-toggle ${bulkMode ? "active" : ""}" data-bulk-action="toggle">${bulkMode ? "Exit multi-select" : "Multi-select"}</button>`;
		contentContainer.appendChild(header);
	} else {
		const entry = document.createElement("div");
		entry.className = "bulk-entry-row";
		entry.innerHTML = `<button type="button" class="bulk-mode-toggle ${bulkMode ? "active" : ""}" data-bulk-action="toggle">${bulkMode ? "Exit multi-select" : "Multi-select"}</button>`;
		contentContainer.appendChild(entry);
	}
	if (bulkMode) {
		const toolbar = document.createElement("div");
		toolbar.innerHTML = renderBulkToolbar();
		contentContainer.appendChild(toolbar.firstElementChild);
	}

	visibleIndexes.forEach((index) => {
		const sheetData = listSheet[index];
		const activePlaylist = getActivePlaylist();
		const playlistSheetPosition = activePlaylist ? activePlaylist.sheetKeys.indexOf(sheetData.keyMap) : -1;
		const canMoveInPlaylist = activeTab === PLAYLISTS_TAB && activePlaylistId && playlistSheetPosition !== -1;
		const isBulkSelected = bulkSelectedSheetKeys.has(sheetData.keyMap);
		const card = document.createElement("div");
		card.className = `card${isBulkSelected ? " bulk-selected" : ""}${bulkMode ? " bulk-selectable" : ""}`;
		card.setAttribute("data-local-card", "true");
		card.setAttribute("data-index", String(index));
		card.innerHTML = `
			${bulkMode ? `<button type="button" class="bulk-sheet-check" data-bulk-select="${escapeAttribute(sheetData.keyMap)}" aria-pressed="${isBulkSelected}" aria-label="${isBulkSelected ? "Deselect" : "Select"} ${escapeAttribute(sheetData.name)}"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-check-square" viewBox="0 0 16 16" aria-hidden="true"><path d="M14 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z"/>${isBulkSelected ? '<path d="M10.97 4.97a.75.75 0 0 1 1.071 1.05l-3.992 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425z"/>' : ""}</svg></button>` : ""}
			<div class="sheet-info" sheetID="${sheetData.keyMap.split(".json")[0]}">
				<div class="sheet-title-row">
					<h3 class="name-sheet">${escapeHtml(sheetData.name)}</h3>
					${renderHoldBadge(sheetData.hasHoldNotes)}
				</div>
				<div class="info-lines">
					<div class="info-item">
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" class="icon author-icon"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M14 14s-1-1.5-6-1.5S2 14 2 14s1-4 6-4 6 4 6 4z"/></svg>
						<span class="label">Author:</span>
						<span class="value author-sheet">${escapeHtml(sheetData.author || "Unknown")}</span>
					</div>
					<div class="info-item">
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" class="icon trans-icon"><path d="M12.146.854a.5.5 0 0 1 .708 0l2.292 2.292a.5.5 0 0 1 0 .708L6.207 12.793l-3.75.75.75-3.75L12.146.854z"/><path d="M11.207 2.5 13.5 4.793 12.793 5.5 10.5 3.207 11.207 2.5z"/></svg>
						<span class="label">Transcript by:</span>
						<span class="value tranScript-sheet">${escapeHtml(sheetData.transcribedBy || "Unknown")}</span>
					</div>
					<div class="info-item">
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" class="icon bpm-icon"><path d="M8 3a6 6 0 1 0 0 12A6 6 0 0 0 8 3zm0 1a5 5 0 1 1 0 10A5 5 0 0 1 8 4z"/><path d="M10.5 8.5 8 11a1 1 0 1 1-1.414-1.414l3-3A1 1 0 1 1 10.5 8.5z"/></svg>
						<span class="label">BPM:</span>
						<span class="value bpm-sheet">${escapeHtml(String(sheetData.bpm || ""))}</span>
					</div>
				</div>
			</div>
			<div class="menu-btn local-menu-btn" ${bulkMode ? "hidden" : ""}>
				<div class="local-actions-menu">
					<button type="button" class="local-actions-toggle" aria-label="Sheet actions">
						<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" class="bi bi-three-dots-vertical local-actions-more-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0m0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0m0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0"/></svg>
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x local-actions-close-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708"/></svg>
					</button>
					<div class="local-actions-popover">
						<button type="button" class="local-action-item" data-local-action="favorite" data-index="${index}">
							<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" class="bi bi-heart favorite-btn ${favorites.includes(sheetData.name) ? "favorited" : ""}" viewBox="0 0 16 16" fill="currentColor"><path d="m8 2.748-.717-.737C5.6.281 2.514.878 1.4 3.053c-.523 1.023-.641 2.5.314 4.385.92 1.815 2.834 3.989 6.286 6.357 3.452-2.368 5.365-4.542 6.286-6.357.955-1.886.838-3.362.314-4.385C13.486.878 10.4.28 8.717 2.01L8 2.748zM8 15C-7.333 4.868 3.279-3.04 7.824 1.143c.06.055.119.112.176.171a3.12 3.12 0 0 1 .176-.17C12.72-3.042 23.333 4.867 8 15z"/></svg>
							<span>${favorites.includes(sheetData.name) ? "Unfavorite" : "Favorite"}</span>
						</button>
						<button type="button" class="local-action-item" data-local-action="edit" data-index="${index}">
							<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" class="bi bi-sheet-editor" viewBox="0 0 40 40"><path d="M20.8333 36.6667H30C30.884 36.6667 31.7319 36.3155 32.357 35.6903C32.9821 35.0652 33.3333 34.2174 33.3333 33.3333V11.6667L25 3.33333H9.99996C9.1159 3.33333 8.26806 3.68452 7.64294 4.30964C7.01782 4.93476 6.66663 5.78261 6.66663 6.66666V22.5" fill="none" stroke="currentColor" stroke-width="4.16667" stroke-linecap="round" stroke-linejoin="round"/><path d="M23.333 3.33333V9.99999C23.333 10.884 23.6842 11.7319 24.3093 12.357C24.9344 12.9821 25.7822 13.3333 26.6663 13.3333H33.333M22.2963 26.0433C22.625 25.7146 22.8858 25.3243 23.0637 24.8948C23.2416 24.4653 23.3332 24.0049 23.3332 23.54C23.3332 23.0751 23.2416 22.6147 23.0637 22.1852C22.8858 21.7557 22.625 21.3654 22.2963 21.0367C21.9676 20.7079 21.5773 20.4471 21.1478 20.2692C20.7182 20.0913 20.2579 19.9997 19.793 19.9997C19.3281 19.9997 18.8677 20.0913 18.4382 20.2692C18.0087 20.4471 17.6184 20.7079 17.2896 21.0367L8.93964 29.39C8.54338 29.786 8.25334 30.2756 8.0963 30.8133L6.7013 35.5967C6.65947 35.7401 6.65697 35.8921 6.69404 36.0368C6.73112 36.1815 6.80641 36.3136 6.91205 36.4192C7.01768 36.5249 7.14977 36.6002 7.29449 36.6373C7.4392 36.6743 7.59122 36.6718 7.73464 36.63L12.518 35.235C13.0557 35.078 13.5453 34.7879 13.9413 34.3917L22.2963 26.0433Z" fill="none" stroke="currentColor" stroke-width="4.16667" stroke-linecap="round" stroke-linejoin="round"/></svg>
							<span>Edit</span>
						</button>
						<button type="button" class="local-action-item" data-local-action="playlist" data-index="${index}">
							<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" class="bi bi-collection-plus" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h7A1.5 1.5 0 0 1 12 3.5v5a.5.5 0 0 1-1 0v-5a.5.5 0 0 0-.5-.5h-7a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h5a.5.5 0 0 1 0 1h-5A1.5 1.5 0 0 1 2 10.5z"/><path d="M13 10a.5.5 0 0 1 .5.5V12H15a.5.5 0 0 1 0 1h-1.5v1.5a.5.5 0 0 1-1 0V13H11a.5.5 0 0 1 0-1h1.5v-1.5a.5.5 0 0 1 .5-.5"/></svg>
							<span>Add to playlist</span>
						</button>
						${canMoveInPlaylist ? `<button type="button" class="local-action-item" data-local-action="playlist-move-up" data-index="${index}" ${playlistSheetPosition <= 0 ? "disabled" : ""}><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" class="bi bi-arrow-up" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 12a.5.5 0 0 0 .5-.5V5.707l2.146 2.147a.5.5 0 0 0 .708-.708l-3-3a.5.5 0 0 0-.708 0l-3 3a.5.5 0 1 0 .708.708L7.5 5.707V11.5A.5.5 0 0 0 8 12"/></svg><span>Move up</span></button><button type="button" class="local-action-item" data-local-action="playlist-move-down" data-index="${index}" ${playlistSheetPosition >= activePlaylist.sheetKeys.length - 1 ? "disabled" : ""}><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" class="bi bi-arrow-down" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 4a.5.5 0 0 1 .5.5v5.793l2.146-2.147a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 1 1 .708-.708L7.5 10.293V4.5A.5.5 0 0 1 8 4"/></svg><span>Move down</span></button>` : ""}
						${activeTab === PLAYLISTS_TAB && activePlaylistId ? `<button type="button" class="local-action-item" data-local-action="playlist-remove" data-index="${index}"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" class="bi bi-dash-circle" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0m0 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1"/><path d="M4.5 7.5a.5.5 0 0 0 0 1h7a.5.5 0 0 0 0-1z"/></svg><span>Remove from playlist</span></button>` : ""}
						<button type="button" class="local-action-item danger" data-local-action="delete" data-index="${index}">
							<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" class="bi bi-trash3" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5M11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H2.506a.58.58 0 0 0-.01 0H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66h.538a.5.5 0 0 0 0-1h-.995a.59.59 0 0 0-.01 0zm1.958 1-.846 10.58a1 1 0 0 1-.997.92h-6.23a1 1 0 0 1-.997-.92L3.042 3.5zm-7.487 1a.5.5 0 0 1 .528.47l.5 8.5a.5.5 0 0 1-.998.06L5 5.03a.5.5 0 0 1 .47-.53Zm5.058 0a.5.5 0 0 1 .47.53l-.5 8.5a.5.5 0 1 1-.998-.06l.5-8.5a.5.5 0 0 1 .528-.47ZM8 4.5a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-1 0V5a.5.5 0 0 1 .5-.5"/></svg>
							<span>Delete</span>
						</button>
					</div>
				</div>
			</div>
		`;
		fragment.appendChild(card);
	});

	if (!fragment.childNodes.length) {
		const empty = document.createElement("div");
		empty.className = "store-state-card";
		empty.innerHTML = `<div class="store-state-title">No sheets found.</div><div class="store-state-copy">Import a local sheet with the plus button, or switch tabs.</div>`;
		fragment.appendChild(empty);
	}

	contentContainer.appendChild(fragment);
}

function getLocalTabTitle() {
	switch (activeTab) {
		case "favorite":
			return "Favorite";
		case "recent-play":
			return "Recent Play";
		default:
			return "All Songs";
	}
}

function renderStoreBrowser() {
	const stateMarkup = renderStoreResultsMarkup();
	contentContainer.innerHTML = `
		<section class="store-browser">
			<div class="store-banner">
				<div class="store-banner-copy">
					<h2 class="store-title">Sky Sheet Store</h2>
					<p class="store-subtitle">Browse community sheets from skysheet.store</p>
				</div>
				<button class="store-toolbar-btn" data-store-action="refresh">Refresh</button>
			</div>
			<div class="store-results">${stateMarkup}</div>
		</section>
	`;
}

function renderHoldBadge(hasHoldNotes, className = "sheet-badge") {
	if (!hasHoldNotes) return "";
	return `<span class="${className}">Hold</span>`;
}

function renderStoreResultsMarkup() {
	if (storeState.loading && !storeState.items.length) {
		return `<div class="store-state-card"><div class="store-state-title">Loading sheets...</div></div>`;
	}

	if (storeState.error && !storeState.items.length) {
		return `<div class="store-state-card"><div class="store-state-title">Unable to connect to Sky Sheet Store.</div><div class="store-state-copy">${escapeHtml(storeState.error)}</div><button class="store-toolbar-btn" data-store-action="retry">Retry</button></div>`;
	}

	if (!storeState.items.length) {
		return `<div class="store-state-card"><div class="store-state-title">No sheets found.</div></div>`;
	}

	const cards = storeState.items.map((item) => renderStoreCardMarkup(item)).join("");
	return `<div class="store-card-list">${cards}</div>${renderStorePaginationMarkup()}`;
}

function renderStorePaginationMarkup() {
	const totalPages = getStoreTotalPages();
	if (totalPages <= 1) return "";

	const currentPage = Math.min(storeState.page, totalPages);
	let startPage = Math.max(1, currentPage - 2);
	const endPage = Math.min(totalPages, startPage + 4);
	startPage = Math.max(1, endPage - 4);

	const pageButtons = [];
	for (let page = startPage; page <= endPage; page++) {
		pageButtons.push(
			`<button class="store-page-btn ${page === currentPage ? "active" : ""}" data-store-action="page" data-store-page="${page}" ${storeState.loadingPage || page === currentPage ? "disabled" : ""}>${page}</button>`
		);
	}

	return `
		<div class="store-pagination">
			<button class="store-page-btn" data-store-action="page-prev" ${storeState.loadingPage || currentPage <= 1 ? "disabled" : ""}>Prev</button>
			<div class="store-page-list">${pageButtons.join("")}</div>
			<button class="store-page-btn" data-store-action="page-next" ${storeState.loadingPage || currentPage >= totalPages ? "disabled" : ""}>Next</button>
		</div>
	`;
}

function getStoreTotalPages() {
	return Math.max(1, Math.ceil(storeState.total / storeState.limit));
}

function renderStoreCardMarkup(item) {
	const availability = getStoreAvailability(item);
	const isPlayingItem = storeState.playingItemId === item.id;
	const isSavingItem = storeState.savingItemId === item.id;
	const metaLine = [
		item.author !== "Unknown" ? item.author : "",
		item.transcribedBy !== "Unknown" ? `Transcribed by ${item.transcribedBy}` : "",
		item.creator?.displayName ? `Uploaded by ${item.creator.displayName}` : "",
	].filter(Boolean).join(" · ");

	const badges = [
		item.difficulty || "Unknown",
		item.bpm ? `${item.bpm} BPM` : "Unknown BPM",
		item.noteCount ? `${item.noteCount} notes` : "Unknown notes",
		item.accessMode === "web_only" ? "Web only" : "",
		item.priceAmount > 0 ? "Paid" : "",
	]
		.concat(item.tags.slice(0, 3))
		.filter(Boolean)
		.map((badge) => `<span class="store-badge">${escapeHtml(badge)}</span>`)
		.join("");

	const disabledPlay = !availability.canPlay || isPlayingItem;
	const disabledSave = !availability.canSave || isSavingItem;
	const statusCopy = availability.message ? `<div class="store-item-status">${escapeHtml(availability.message)}</div>` : "";

	return `
		<article class="store-card">
			<div class="store-card-body">
				<div class="store-card-main">
					<h3 class="store-card-title">${escapeHtml(item.title)}</h3>
					<div class="store-card-meta">${escapeHtml(metaLine || "Unknown")}</div>
					<div class="store-badge-row">${badges}</div>
					${statusCopy}
				</div>
				<div class="store-card-actions">
					<button class="store-action-btn play" data-store-action="play" data-sheet-id="${item.id}" ${disabledPlay ? "disabled" : ""}><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="bi bi-play-fill" viewBox="0 0 16 16"><path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/></svg><span>${isPlayingItem ? "Preparing..." : "Play"}</span></button>
					<button class="store-action-btn" data-store-action="save" data-sheet-id="${item.id}" ${disabledSave ? "disabled" : ""}><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="bi bi-music-note-list" viewBox="0 0 16 16"><path d="M12 13c0 1.105-1.12 2-2.5 2S7 14.105 7 13s1.12-2 2.5-2 2.5.895 2.5 2"/><path fill-rule="evenodd" d="M12 3v10h-1V3z"/><path d="M11 2.82a1 1 0 0 1 .804-.98l3-.6A1 1 0 0 1 16 2.22V4l-5 1z"/><path fill-rule="evenodd" d="M0 11.5a.5.5 0 0 1 .5-.5H4a.5.5 0 0 1 0 1H.5a.5.5 0 0 1-.5-.5m0-4A.5.5 0 0 1 .5 7H8a.5.5 0 0 1 0 1H.5a.5.5 0 0 1-.5-.5m0-4A.5.5 0 0 1 .5 3H8a.5.5 0 0 1 0 1H.5a.5.5 0 0 1-.5-.5"/></svg><span>${isSavingItem ? "Saving..." : "Save Sheet"}</span></button>
				</div>
			</div>
		</article>
	`;
}

function shouldShowLocalSheet(sheetData, searchTerm, favorites, recentPlays) {
	let visible = false;
	switch (activeTab) {
		case "all-songs":
			visible = true;
			break;
		case "favorite":
			visible = favorites.includes(sheetData.name);
			break;
		case "recent-play":
			visible = recentPlays.includes(sheetData.name);
			break;
		default:
			visible = true;
			break;
	}

	if (!visible) return false;
	if (!searchTerm) return true;
	return (sheetData.name || "").toLowerCase().includes(searchTerm) ||
		(sheetData.author || "").toLowerCase().includes(searchTerm);
}

async function fetchStoreSheets({ page = 1, refresh }) {
	const safePage = Number.isInteger(page) && page > 0 ? page : 1;
	const nextOffset = (safePage - 1) * storeState.limit;
	const requestQuery = storeState.query;
	const requestGeneration = safePage === 1 ? storeState.searchGeneration + 1 : storeState.searchGeneration;
	const isInitialPage = safePage === 1;

	if (isInitialPage) {
		storeState.searchGeneration = requestGeneration;
		storeState.loading = true;
		storeState.loadingPage = false;
		storeState.error = "";
	} else {
		if (storeState.loading || storeState.loadingPage) return;
		storeState.loadingPage = true;
	}

	renderContent();

	try {
		const response = await ipcRenderer.invoke("sky-sheet-store:list", {
			q: requestQuery,
			limit: storeState.limit,
			offset: nextOffset,
			refresh,
		});

		if (requestGeneration !== storeState.searchGeneration || requestQuery !== storeState.query) return;

		storeState.items = response.items;
		storeState.page = safePage;
		storeState.offset = nextOffset;
		storeState.total = response.total;
		storeState.hasLoaded = true;
	} catch (error) {
		if (requestGeneration !== storeState.searchGeneration || requestQuery !== storeState.query) return;
		if (isInitialPage) {
			storeState.error = normalizeRendererError(error, "Unable to connect to Sky Sheet Store.");
		} else {
			notie.alert({
				type: 3,
				text: normalizeRendererError(error, "Unable to load this page. Please try again."),
			});
		}
	} finally {
		if (requestGeneration === storeState.searchGeneration && requestQuery === storeState.query) {
			if (isInitialPage) {
				storeState.loading = false;
			}
			storeState.loadingPage = false;
			if (activeTab === STORE_TAB) renderContent();
		}
	}
}

async function playStoreSheet(sheetId) {
	const item = storeState.items.find((entry) => entry.id === sheetId);
	if (!item) return;

	const availability = getStoreAvailability(item);
	if (!availability.canPlay) {
		notie.alert({ type: 3, text: availability.message || "This sheet is not available for playback." });
		return;
	}

	storeState.playingItemId = sheetId;
	renderContent();

	try {
		const prepared = await prepareStoreSheet(sheetId, item);
		if (isPlay) {
			btnPlay();
		}
		setPlaybackTarget({
			type: "remote",
			index: null,
			keyMap: prepared.keyMap,
			notes: prepared.playbackNotes,
			sheet: prepared.displaySheet,
		});
		btnPlay();
		void trackStorePlayerStart(item);
	} catch (error) {
		notie.alert({
			type: 3,
			text: normalizeRendererError(error, "Unable to load this sheet. Please try again."),
		});
	} finally {
		storeState.playingItemId = "";
		if (activeTab === STORE_TAB) renderContent();
	}
}

async function saveStoreSheet(sheetId) {
	const item = storeState.items.find((entry) => entry.id === sheetId);
	if (!item) return;

	const availability = getStoreAvailability(item);
	if (!availability.canSave) {
		notie.alert({ type: 3, text: availability.message || "This sheet cannot be saved." });
		return;
	}

	storeState.savingItemId = sheetId;
	renderContent();

	try {
		const prepared = await prepareStoreSheet(sheetId, item);
		const result = encSheet(prepared.normalizedSheet, {
			source: "sky-sheet-store",
			sourceId: item.id,
			sourceUrl: item.sourceUrl,
		});

		if (result) {
			notie.alert({ type: 3, text: result.msg });
		} else {
			notie.alert({ type: 1, text: "Saved to Library." });
			void trackStoreDownload(item);
			if (LOCAL_TABS.has(activeTab)) renderContent();
		}
	} catch (error) {
		notie.alert({
			type: 3,
			text: normalizeRendererError(error, "Unable to load this sheet. Please try again."),
		});
	} finally {
		storeState.savingItemId = "";
		if (activeTab === STORE_TAB) renderContent();
	}
}

async function trackStorePlayerStart(item) {
	if (!item?.id) return;

	try {
		await ipcRenderer.invoke("sky-sheet-store:record-player-start", {
			id: item.id,
			sourceType: item.sourceType || "user",
		});
	} catch (error) {
		console.warn("Failed to record Sky Sheet Store player start", error);
	}
}

async function trackStoreDownload(item) {
	if (!item?.id) return;

	try {
		await ipcRenderer.invoke("sky-sheet-store:record-download", {
			id: item.id,
			sourceType: item.sourceType || "user",
		});
	} catch (error) {
		console.warn("Failed to record Sky Sheet Store download", error);
	}
}

async function prepareStoreSheet(sheetId, item) {
	const cached = storeState.cache.get(sheetId);
	if (cached) return cached;

	const payload = await ipcRenderer.invoke("sky-sheet-store:get-player-sheet", {
		id: sheetId,
		sourceType: item?.sourceType || "user",
	});
	const normalizedSheet = normalizeStorePlayerPayload(payload, item);
	const playbackNotes = buildPlaybackNotesFromSongNotes(normalizedSheet.songNotes, normalizedSheet.bitsPerPage);
	const keyMap = buildKeyMapFromPlaybackNotes(playbackNotes);
	const hasHoldNotes = hasSongNotesWithHold(normalizedSheet.songNotes);
	const prepared = {
		normalizedSheet,
		keyMap,
		playbackNotes: hasHoldNotes ? playbackNotes : null,
		hasHoldNotes,
		displaySheet: {
			name: normalizedSheet.name,
			author: normalizedSheet.author,
			transcribedBy: normalizedSheet.transcribedBy,
			bpm: normalizedSheet.bpm,
			bitsPerPage: normalizedSheet.bitsPerPage,
			pitchLevel: normalizedSheet.pitchLevel,
			isComposed: normalizedSheet.isComposed,
			source: "sky-sheet-store",
			sourceId: sheetId,
			sourceType: item?.sourceType || "user",
			sourceUrl: item.sourceUrl,
			hasHoldNotes,
		},
	};

	storeState.cache.set(sheetId, prepared);
	return prepared;
}

function normalizeStorePlayerPayload(payload, item) {
	if (!payload?.sheet || !payload?.player || !payload?.runtime) {
		throw new Error("The downloaded sheet is invalid.");
	}

	const title = (payload.sheet.title || item.title || "").trim();
	if (!title || title.length > 180) {
		throw new Error("The downloaded sheet is invalid.");
	}

	const bpm = Number(payload.player.bpm || payload.sheet.bpm);
	const bitsPerPage = Number(payload.player.bitsPerPage);
	const pitchLevel = Number(payload.player.pitchLevel);
	if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 2000) {
		throw new Error("The downloaded sheet is invalid.");
	}
	if (!Number.isFinite(bitsPerPage) || bitsPerPage <= 0 || bitsPerPage > 128) {
		throw new Error("The downloaded sheet is invalid.");
	}
	if (!Number.isFinite(pitchLevel) || pitchLevel < -12 || pitchLevel > 12) {
		throw new Error("The downloaded sheet is invalid.");
	}

	const songNotes = flattenStoreRuntimeNotes(payload.runtime.notes, bitsPerPage);
	const hasHoldNotes = hasSongNotesWithHold(songNotes);
	return {
		name: title,
		author: (payload.sheet.author || item.author || "Unknown").trim() || "Unknown",
		transcribedBy: (payload.sheet.transcribedBy || item.transcribedBy || "Unknown").trim() || "Unknown",
		isComposed: true,
		bpm,
		bitsPerPage,
		pitchLevel,
		isEncrypted: false,
		songNotes,
		hasHoldNotes,
	};
}

function flattenStoreRuntimeNotes(runtimeNotes, bitsPerPage) {
	if (!Array.isArray(runtimeNotes) || !runtimeNotes.length) {
		throw new Error("The downloaded sheet is invalid.");
	}

	const songNotes = [];
	const dedupe = new Set();
	let previousTime = -1;

	for (const group of runtimeNotes) {
		const timeMs = Number(group?.timeMs);
		if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs > MAX_REMOTE_DURATION_MS) {
			throw new Error("The downloaded sheet is invalid.");
		}
		if (timeMs < previousTime) {
			throw new Error("The downloaded sheet is invalid.");
		}
		previousTime = timeMs;

		if (!Array.isArray(group?.keys) || !group.keys.length) continue;
		for (const key of group.keys) {
			const autoKey = mapStoreRuntimeKeyToAutoPianoKey(key, bitsPerPage);
			if (!autoKey) {
				throw new Error("The downloaded sheet is invalid.");
			}
			const noteKey = `${timeMs}:${key}`;
			if (dedupe.has(noteKey)) continue;
			dedupe.add(noteKey);
			songNotes.push({ time: timeMs, key });
			if (songNotes.length > MAX_REMOTE_NOTE_COUNT) {
				throw new Error("The downloaded sheet is invalid.");
			}
		}
	}

	if (!songNotes.length) {
		throw new Error("The downloaded sheet is invalid.");
	}

	return songNotes;
}

function mapStoreRuntimeKeyToAutoPianoKey(storeKey, bitsPerPage) {
	return mapSongKeyToAutoPianoKey(storeKey, bitsPerPage);
}

function mapStoreRuntimeNotesToAutoPianoKeyMap(runtimeNotes, bitsPerPage) {
	return buildKeyMapFromPlaybackNotes(buildPlaybackNotesFromSongNotes(flattenStoreRuntimeNotes(runtimeNotes, bitsPerPage), bitsPerPage));
}

function getStoreAvailability(item) {
	if (item.sourceType === "archive") {
		return {
			canPlay: true,
			canSave: true,
			message: "",
		};
	}
	if (item.accessMode === "web_only") {
		return {
			canPlay: false,
			canSave: false,
			message: "Web only",
		};
	}
	if (!item.isDownloadable) {
		return {
			canPlay: false,
			canSave: false,
			message: "Not downloadable",
		};
	}
	if (item.priceAmount > 0 || item.viewerActionState === "checkout") {
		return {
			canPlay: false,
			canSave: false,
			message: "Purchase required",
		};
	}
	if (item.viewerActionState === "login_to_open") {
		return {
			canPlay: false,
			canSave: false,
			message: "Login required",
		};
	}
	return {
		canPlay: true,
		canSave: true,
		message: "",
	};
}

async function selectLocalSheet(index, { trackRecentPlay = true } = {}) {
	const sheetData = listSheet[index];
	if (!sheetData) return;

	try {
		const payload = await getLocalSheetPayload(index);
		setPlaybackTarget({
			type: "local",
			index,
			keyMap: payload.keyMap,
			notes: payload.hasHoldNotes ? payload.playbackNotes : null,
			sheet: {
				...sheetData,
				hasHoldNotes: Boolean(sheetData.hasHoldNotes || payload.hasHoldNotes),
			},
		});
		if (trackRecentPlay) addToRecentPlays(sheetData.name);
	} catch (error) {
		console.error("Failed to load local sheet:", error);
		notie.alert({ type: 3, text: "Error loading song data." });
	}
}

function setPlaybackTarget({ type, index, keyMap, notes = null, sheet }) {
	currentPlayback = {
		type,
		index,
		keyMap,
		notes,
		sheet,
	};
	updateFooter({ ...sheet, keys: keyMap });
}

async function getLocalSheetPayload(index) {
	if (listSheetPayloads[index]) return listSheetPayloads[index];
	const sheet = listSheet[index];
	if (!sheet) throw new Error("Sheet not found.");

	const data = await fs.promises.readFile(path.join(dataDirectory, sheet.keyMap), { encoding: "utf8" });
	const parsed = JSON.parse(data);
	const payload = parseStoredSheetPayload(parsed, sheet.bitsPerPage);
	listKeys[index] = payload.keyMap;
	listSheetPayloads[index] = payload;
	return payload;
}

async function reloadLocalSheetPayload(index) {
	listKeys[index] = undefined;
	listSheetPayloads[index] = undefined;
	return getLocalSheetPayload(index);
}

function deleteLocalSheet(index) {
	const sheetData = listSheet[index];
	if (!sheetData) return;

	fs.unlinkSync(path.join(dataDirectory, sheetData.keyMap));
	removeSheetFromPlaylists(sheetData.keyMap);
	listSheet.splice(index, 1);
	listKeys.splice(index, 1);
	listSheetPayloads.splice(index, 1);
	fs.writeFileSync(listSheetPath, JSON.stringify(listSheet, null, 4), { mode: 0o666 });

	if (currentPlayback.type === "local") {
		if (currentPlayback.index === index) {
			if (listSheet.length > 0) {
				const nextIndex = Math.max(0, Math.min(index, listSheet.length - 1));
				void selectLocalSheet(nextIndex, { trackRecentPlay: false });
			} else {
				currentPlayback = { type: "none", index: null, keyMap: null, notes: null, sheet: null };
				clearFooter();
			}
		} else if (currentPlayback.index > index) {
			currentPlayback.index -= 1;
		}
	}

	renderContent();
}

function toggleFavorite(songName) {
	const favorites = getFavorites();
	const index = favorites.indexOf(songName);
	if (index >= 0) {
		favorites.splice(index, 1);
	} else {
		favorites.push(songName);
	}
	localStorage.setItem("favorites", JSON.stringify(favorites));
}

function addToRecentPlays(songName) {
	const recentPlays = getRecentPlays().filter((name) => name !== songName);
	recentPlays.unshift(songName);
	localStorage.setItem("recentPlays", JSON.stringify(recentPlays.slice(0, 10)));
}

function getFavorites() {
	return JSON.parse(localStorage.getItem("favorites") || "[]");
}

function getRecentPlays() {
	return JSON.parse(localStorage.getItem("recentPlays") || "[]");
}

document.getElementsByClassName("btn-add")[0].addEventListener("change", (event) => {
	const { files } = event.target;
	let done = 0;
	const failures = [];

	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		let decoded;
		try {
			decoded = SheetCodec.parse({
				content: fs.readFileSync(file.path),
				fileName: path.basename(file.path),
			});
		} catch (error) {
			console.error("Failed to import sheet:", file.name, error);
			failures.push({ fileName: file.name, message: getSheetImportErrorMessage(error) });
			continue;
		}

		let result;
		try {
			const stored = SheetCodec.loadStored(decoded.storage, { bitsPerPage: decoded.sheet.bitsPerPage });
			result = encSheet(decoded.sheet, {}, {
				...stored,
				bitsPerPage: decoded.sheet.bitsPerPage,
			});
		} catch (error) {
			console.error(error);
			failures.push({ fileName: file.name, message: getSheetImportErrorMessage(error) });
			continue;
		}

		if (!result) {
			done++;
			continue;
		}

		failures.push({ fileName: file.name, message: result.msg });
	}

	renderContent();

	if (files.length > 1) {
		notie.alert({
			type: done > 0 ? 1 : 3,
			text: failures.length
				? `Import complete. Success: ${done}. Failed: ${failures.length}. ${failures[0].fileName}: ${failures[0].message}`
				: `Import complete. Success: ${done}.`,
		});
	} else if (failures.length) {
		notie.alert({ type: 3, text: failures[0].message });
	} else if (done > 0) {
		notie.alert({ type: 1, text: "Sheet imported successfully." });
	}

	event.target.value = "";
});

function getSheetImportErrorMessage(error) {
	if (typeof error?.userMessage === "string" && error.userMessage.trim()) return error.userMessage.trim();
	if (typeof error?.message === "string" && error.message.trim()) return error.message.trim();
	return "The selected sheet could not be imported.";
}

function parseStoredSheetPayload(parsed, bitsPerPage) {
	return SheetCodec.loadStored(parsed, { bitsPerPage });
}

function resolveBitsPerPage(bitsPerPage) {
	const safeBitsPerPage = Number(bitsPerPage);
	if (Number.isFinite(safeBitsPerPage) && safeBitsPerPage > 0 && safeBitsPerPage <= 128) {
		return Math.trunc(safeBitsPerPage);
	}
	return 16;
}

function hasSongNotesWithHold(songNotes) {
	return Array.isArray(songNotes) && songNotes.some((note) => Number(note?.hold) > 0);
}

function mapSongKeyToAutoPianoKey(songKey, bitsPerPage) {
	const key = typeof songKey === "string" ? songKey.trim() : "";
	const match = SKY_KEY_PATTERN.exec(key);
	if (!match) return null;

	const keyIndex = Number(match[2]);
	const safeBitsPerPage = resolveBitsPerPage(bitsPerPage);
	if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex >= safeBitsPerPage || keyIndex > 14) {
		return null;
	}

	return keys[keyIndex] || null;
}

function buildPlaybackNotesFromSongNotes(songNotes, bitsPerPage) {
	const safeBitsPerPage = resolveBitsPerPage(bitsPerPage);
	const byPlaybackKey = new Map();

	for (const note of songNotes) {
		const playbackKey = mapSongKeyToAutoPianoKey(note.key, safeBitsPerPage);
		if (!playbackKey) {
			throw new Error("The sheet file is not valid, please try again with another file!");
		}

		const mapKey = `${note.time}:${playbackKey}`;
		const existing = byPlaybackKey.get(mapKey);
		if (existing) {
			if (note.hold && (!existing.hold || note.hold > existing.hold)) {
				existing.hold = note.hold;
			}
			continue;
		}

		byPlaybackKey.set(mapKey, {
			time: note.time,
			key: playbackKey,
			...(note.hold ? { hold: note.hold } : {}),
		});
	}

	return [...byPlaybackKey.values()].sort((a, b) => a.time - b.time || a.key.localeCompare(b.key));
}

function buildKeyMapFromPlaybackNotes(playbackNotes) {
	if (!Array.isArray(playbackNotes) || !playbackNotes.length) {
		throw new Error("The sheet file is not valid, please try again with another file!");
	}

	const keyMap = {};
	let maxSongTime = 0;

	for (const note of playbackNotes) {
		if (!keyMap[note.time]) {
			keyMap[note.time] = [];
		}
		if (!keyMap[note.time].includes(note.key)) {
			keyMap[note.time].push(note.key);
		}

		const endTime = note.time + (Number(note.hold) > 0 ? Number(note.hold) : 0);
		if (endTime > maxSongTime) {
			maxSongTime = endTime;
		}
	}

	const timestamps = Object.keys(keyMap).map(Number).sort((a, b) => a - b);
	if (!timestamps.length) {
		throw new Error("The sheet file is not valid, please try again with another file!");
	}

	const normalized = {};
	if (!timestamps.includes(0)) {
		normalized[0] = [];
	}

	for (const timestamp of timestamps) {
		normalized[timestamp] = keyMap[timestamp];
	}

	const lastSongTime = Math.max(maxSongTime, timestamps[timestamps.length - 1]);
	normalized[(Math.trunc(lastSongTime / 1000) + 1) * 1000] = [];
	return normalized;
}

function encSheet(json, extraMeta = {}, preparedSheet = null) {
	if (json.isEncrypted) {
		return { errCode: 1, msg: "Sheet has been encrypted!" };
	}
	if (!json.songNotes) {
		return { errCode: 2, msg: "The sheet file is not valid, please try again with another file!" };
	}
	if (typeof json.songNotes[0] !== "object") {
		return { errCode: 1, msg: "Sheet format is incorrect or still encrypted!" };
	}
	if (extraMeta.source === "sky-sheet-store" && extraMeta.sourceId) {
		const duplicate = listSheet.find((sheet) => sheet.source === extraMeta.source && sheet.sourceId === extraMeta.sourceId);
		if (duplicate) {
			return { errCode: 3, msg: "This sheet is already in your library." };
		}
	}

	let prepared = preparedSheet;
	if (!prepared) {
		const decoded = SheetCodec.parse({
			content: JSON.stringify([json]),
			fileName: `${json.name || "sheet"}.json`,
		});
		prepared = {
			...SheetCodec.loadStored(decoded.storage, { bitsPerPage: decoded.sheet.bitsPerPage }),
			bitsPerPage: decoded.sheet.bitsPerPage,
		};
		json = decoded.sheet;
	}
	const normalizedSheet = {
		...json,
		bitsPerPage: prepared.bitsPerPage,
	};
	const fileName = `${Base64.encode(random(1, 9999) + String(normalizedSheet.name || "").replace(/[^a-zA-Z0-9]/g, "-"))}.json`;

	fs.writeFileSync(
		path.join(dataDirectory, fileName),
		JSON.stringify({
			version: 2,
			keyMap: prepared.keyMap,
			songNotes: prepared.songNotes,
		}),
		{ mode: 0o666 },
	);

	listSheet.push({
		name: normalizedSheet.name,
		author: normalizedSheet.author || "Unknown",
		transcribedBy: normalizedSheet.transcribedBy || "Unknown",
		bpm: normalizedSheet.bpm,
		bitsPerPage: normalizedSheet.bitsPerPage,
		pitchLevel: normalizedSheet.pitchLevel,
		isComposed: normalizedSheet.isComposed,
		keyMap: fileName,
		hasHoldNotes: prepared.hasHoldNotes,
		...(extraMeta.source ? {
			source: extraMeta.source,
			sourceId: extraMeta.sourceId || "",
			sourceUrl: extraMeta.sourceUrl || "",
		} : {}),
	});
	listKeys.push(prepared.keyMap);
	listSheetPayloads.push(prepared);

	fs.writeFileSync(listSheetPath, JSON.stringify(listSheet, null, 4), { mode: 0o666 });
	return undefined;
}

function random(min, max) {
	return Math.floor(Math.random() * (max - min + 2)) + min;
}

function updateFooter(info) {
	const delayMap = Object.keys(info.keys);
	const lastDelay = Number(delayMap[delayMap.length - 1] || 0);
	document.getElementById("process-bar").max = Math.trunc(lastDelay / 1000);
	maxPCB = Math.trunc(lastDelay / 1000);
	document.getElementsByClassName("name-playing")[0].innerHTML = `${escapeHtml(info.name)}${renderHoldBadge(info.hasHoldNotes, "footer-hold-badge")}`;
	document.getElementById("process-bar").value = 0;
	document.getElementsByClassName("live-time")[0].innerHTML = "00:00";

	const totalMinNumber = Math.trunc(lastDelay / (60 * 1000));
	const totalSecNumber = Math.trunc(lastDelay / 1000) - totalMinNumber * 60;
	const totalMin = totalMinNumber < 10 ? `0${totalMinNumber}` : `${totalMinNumber}`;
	const totalSec = totalSecNumber < 10 ? `0${totalSecNumber}` : `${totalSecNumber}`;
	document.getElementsByClassName("total-time")[0].innerHTML = `${totalMin}:${totalSec}`;
}

function clearFooter() {
	document.getElementsByClassName("name-playing")[0].innerHTML = "* Click on the plus to add sheet";
	document.getElementById("process-bar").max = 0;
	document.getElementById("process-bar").value = 0;
	document.getElementsByClassName("live-time")[0].innerHTML = "00:00";
	document.getElementsByClassName("total-time")[0].innerHTML = "00:00";
}

function btnPrev() {
	if (currentPlayback.type !== "local") return;
	const previousIndex = findPreviousVisibleCard(currentPlayback.index);
	if (previousIndex === -1) return;

	void selectLocalSheet(previousIndex, { trackRecentPlay: true }).then(() => {
		if (!isPlay) return;
		btnPlay();
		document.getElementById("process-bar").value = 0;
		document.getElementsByClassName("live-time")[0].innerHTML = "00:00";
		setTimeout(() => btnPlay(), getDelayLoopSeconds() * 1000);
	});
}

function btnNext() {
	if (currentPlayback.type !== "local") return;
	const nextIndex = findNextVisibleCard(currentPlayback.index);
	if (nextIndex === -1) return;

	void selectLocalSheet(nextIndex, { trackRecentPlay: true }).then(() => {
		if (!isPlay) return;
		btnPlay();
		document.getElementById("process-bar").value = 0;
		document.getElementsByClassName("live-time")[0].innerHTML = "00:00";
		if (loopTimer) clearTimeout(loopTimer);
		loopTimer = setTimeout(() => {
			if (!manualStop) btnPlay();
		}, getDelayLoopSeconds() * 1000);
	});
}

function btnPlay() {
	if (!currentPlayback.keyMap) return;

	if (isPlay) {
		manualStop = true;
		if (loopTimer) {
			clearTimeout(loopTimer);
			loopTimer = null;
		}
	}

	isPlay = !isPlay;
	if (isPlay) manualStop = false;

	ipcRenderer.send("play", {
		keys: sec2array(Number(document.getElementById("process-bar").value), currentPlayback.keyMap),
		notes: currentPlayback.notes || undefined,
		sec: Number(document.getElementById("process-bar").value),
		lockTime: `${new Date().getTime()}`,
		isPlay,
	});

	document.getElementById("process-bar").disabled = isPlay;
	renderPlayButton(isPlay);
}

function renderPlayButton(playingState) {
	document.getElementById("btn-play").innerHTML = playingState
		? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pause-fill" viewBox="0 0 16 16"><path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1.5-1.5"/></svg> Pause (<a id="shortcut-play">${config.shortcut.play}</a>)`
		: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" class="bi bi-play-fill" viewBox="0 0 16 16"><path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/></svg> Play (<a id="shortcut-play">${config.shortcut.play}</a>)`;
}

function isCardVisible(index) {
	const card = document.querySelector(`[data-local-card="true"][data-index="${index}"]`);
	return Boolean(card && window.getComputedStyle(card).display !== "none");
}

function findPreviousVisibleCard(currentIndex) {
	let index = currentIndex - 1;
	let searchCount = 0;
	while (searchCount < listSheet.length) {
		if (index < 0) index = listSheet.length - 1;
		if (isCardVisible(index)) return index;
		index--;
		searchCount++;
	}
	return -1;
}

function findNextVisibleCard(currentIndex) {
	let index = currentIndex + 1;
	let searchCount = 0;
	while (searchCount < listSheet.length) {
		if (index >= listSheet.length) index = 0;
		if (isCardVisible(index)) return index;
		index++;
		searchCount++;
	}
	return -1;
}

function updateLiveTime(seconds) {
	const { min, sec } = sec2min(seconds);
	document.getElementsByClassName("live-time")[0].innerHTML =
		`${min < 10 ? `0${min}` : min}:${sec < 10 ? `0${sec}` : sec}`;
}

function getDelayLoopSeconds() {
	const value = Number(document.getElementById("delay-loop").value);
	return value === 0 ? 0.5 : value;
}

function sec2min(sec) {
	return {
		min: Math.trunc(sec / 60),
		sec: sec - Math.trunc(sec / 60) * 60,
	};
}

function sec2array(sec, arr) {
	const result = { ...arr };
	for (const time in arr) {
		if (Number(time) < sec * 1000) delete result[time];
	}
	return result;
}

function ensureExists(targetPath, mask = 0o777) {
	try {
		fs.mkdirSync(targetPath, { mode: mask, recursive: true });
	} catch (error) {
		return { err: error };
	}
	return undefined;
}

async function fetchChangelog(version) {
	try {
		const response = await fetch(`https://api.github.com/repos/HerokeyVN/Sky-Auto-Piano/releases/tags/v${version}`);
		const data = await response.json();
		return data.body;
	} catch (error) {
		console.error("Error fetching changelog:", error);
		return null;
	}
}

function parseChangelog(markdown) {
	return `<div class="changelog-content">${marked.parse(markdown)}</div>`;
}

ipcRenderer.on("show-post-update-changelog", async (_, data) => {
	const updatePrompt = document.getElementById("update-prompt");
	const currentVersion = document.getElementById("current-version");
	const changelogContent = document.getElementById("changelog-content");

	try {
		const changelog = await fetchChangelog(data.version);
		if (!changelog) return;

		currentVersion.textContent = `Version ${data.version}`;
		changelogContent.innerHTML = parseChangelog(changelog);
		updatePrompt.classList.add("show");

		document.getElementById("close-changelog-btn").addEventListener("click", () => {
			updatePrompt.classList.remove("show");
			const updateInfoPath = path.join(appRoot, "config", "update-info.json");
			if (!fs.existsSync(updateInfoPath)) return;
			const updateInfo = JSON.parse(fs.readFileSync(updateInfoPath));
			updateInfo.showChangelog = false;
			fs.writeFileSync(updateInfoPath, JSON.stringify(updateInfo, null, 2));
		});
	} catch (error) {
		console.error("Error showing changelog:", error);
	}
});

ipcRenderer.on("show-update-notification", (_, data) => {
	const displayMessage = data.title ? `<b>${data.title}</b><br>${data.message}` : data.message;
	notie.alert({
		type: data.type,
		text: displayMessage,
		stay: data.type === 3,
		time: 5,
	});
});

ipcRenderer.on("update-progress", (_, data) => {
	if (data.progress % 10 !== 0 && data.progress !== 100) return;
	const moduleType = data.type === "core" ? "application" : "module";
	notie.alert({
		type: 4,
		text: `Downloading ${moduleType} update: ${data.progress}% complete`,
		time: 3,
	});
});

ipcRenderer.on("sheet-list-updated", (_, { index, data }) => {
	listSheet[index] = data;
	if (currentPlayback.type === "local" && currentPlayback.index === index) {
		void getLocalSheetPayload(index)
			.then((payload) => {
				setPlaybackTarget({
					type: "local",
					index,
					keyMap: payload.keyMap,
					notes: payload.hasHoldNotes ? payload.playbackNotes : null,
					sheet: {
						...data,
						hasHoldNotes: Boolean(data.hasHoldNotes || payload.hasHoldNotes),
					},
				});
			})
			.catch((error) => {
				console.error("Error reloading keymap after sheet update:", error);
			});
	}
	renderContent();
});

ipcRenderer.on("keymap-updated", (_, { index }) => {
	void reloadLocalSheetPayload(index)
		.then((payload) => {
			if (currentPlayback.type === "local" && currentPlayback.index === index) {
				setPlaybackTarget({
					type: "local",
					index,
					keyMap: payload.keyMap,
					notes: payload.hasHoldNotes ? payload.playbackNotes : null,
					sheet: {
						...listSheet[index],
						hasHoldNotes: Boolean(listSheet[index]?.hasHoldNotes || payload.hasHoldNotes),
					},
				});
			}
		})
		.catch((error) => {
			console.error("Error reloading keymap:", error);
		});
});

ipcRenderer.on("winLog", (_, msg) => {
	console.log("[main]", msg);
});

function normalizeRendererError(error, fallbackMessage) {
	if (!error) return fallbackMessage;
	if (typeof error === "string") return error;
	return error.message || fallbackMessage;
}

function escapeHtml(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
	return escapeHtml(value).replaceAll("`", "&#96;");
}
