const { ipcRenderer, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { Base64 } = require("js-base64");
const marked = require("marked");
const MidiParser = require("midi-parser-js");

const appRoot = path.join(__dirname, "..", "..", "..");
const dataDirectory = path.join(appRoot, "data");
const configPath = path.join(appRoot, "config", "config.json");
const listSheetPath = path.join(dataDirectory, "listSheet.json");

const STORE_TAB = "sky-sheet-store";
const LOCAL_TABS = new Set(["all-songs", "favorite", "recent-play"]);
const STORE_SEARCH_DEBOUNCE_MS = 300;
const MAX_REMOTE_DURATION_MS = 15 * 60 * 1000;
const MAX_REMOTE_NOTE_COUNT = 20000;
const STORE_KEY_PATTERN = /^([0-9]+)Key([0-9]+)$/;
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
let isPlay = false;
let maxPCB = 0;
let loopMode = 0;
let loopTimer = null;
let manualStop = false;
let activeTab = "all-songs";
let localSearchQuery = "";

let currentPlayback = {
	type: "none",
	index: null,
	keyMap: null,
	sheet: null,
};

const storeState = {
	items: [],
	query: "",
	loading: false,
	loadingMore: false,
	error: "",
	limit: 20,
	offset: 0,
	total: 0,
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
	setupTabs();
	setupSearch();
	setupContentEvents();
	setupPlaybackControls();
	setupSettingsControls();
	applyConfigToUI(config);
	loadLocalSheets();
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
				void fetchStoreSheets({ reset: true, refresh: false });
			}, STORE_SEARCH_DEBOUNCE_MS);
			return;
		}

		localSearchQuery = searchBar.value;
		renderContent();
	});
}

function setupContentEvents() {
	contentContainer.addEventListener("click", async (event) => {
		const localAction = event.target.closest("[data-local-action]");
		if (localAction) {
			event.preventDefault();
			const index = Number(localAction.getAttribute("data-index"));
			if (!Number.isInteger(index) || index < 0 || index >= listSheet.length) return;
			const action = localAction.getAttribute("data-local-action");
			if (action === "favorite") {
				toggleFavorite(listSheet[index].name);
				renderContent();
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
					void fetchStoreSheets({ reset: true, refresh: true });
					return;
				case "load-more":
					void fetchStoreSheets({ reset: false, refresh: true });
					return;
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

		const localCard = event.target.closest("[data-local-card]");
		if (localCard) {
			const index = Number(localCard.getAttribute("data-index"));
			if (Number.isInteger(index) && index >= 0 && index < listSheet.length) {
				void selectLocalSheet(index, { trackRecentPlay: true });
			}
		}
	});
}

function setupPlaybackControls() {
	document.getElementById("btn-prev").addEventListener("click", btnPrev);
	document.getElementById("btn-next").addEventListener("click", btnNext);
	document.getElementById("btn-play").addEventListener("click", btnPlay);
	document.getElementById("process-bar").addEventListener("change", (event) => {
		document.getElementById("process-bar").max = maxPCB;
		updateLiveTime(Number(event.target.value));
	});

	ipcRenderer.on("btn-prev", btnPrev);
	ipcRenderer.on("btn-next", btnNext);
	ipcRenderer.on("btn-play", btnPlay);
	ipcRenderer.on("process-bar", (_, data) => {
		document.getElementById("process-bar").value = data;
		updateLiveTime(Number(data));
	});
	ipcRenderer.on("speed-changed", (_, newSpeed) => {
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
		void fetchStoreSheets({ reset: true, refresh: false });
	}

	renderContent();
}

function renderContent() {
	if (activeTab === STORE_TAB) {
		renderStoreBrowser();
		return;
	}
	renderLocalLibrary();
}

function renderLocalLibrary() {
	const searchTerm = localSearchQuery.toLowerCase().trim();
	const favorites = getFavorites();
	const recentPlays = getRecentPlays();
	const fragment = document.createDocumentFragment();

	contentContainer.innerHTML = "";

	listSheet.forEach((sheetData, index) => {
		if (!shouldShowLocalSheet(sheetData, searchTerm, favorites, recentPlays)) return;
		const card = document.createElement("div");
		card.className = "card";
		card.setAttribute("data-local-card", "true");
		card.setAttribute("data-index", String(index));
		card.innerHTML = `
			<div class="sheet-info" sheetID="${sheetData.keyMap.split(".json")[0]}">
				<h3 class="name-sheet">${escapeHtml(sheetData.name)}</h3>
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
			<div class="menu-btn local-menu-btn">
				<svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" class="bi bi-heart favorite-btn ${favorites.includes(sheetData.name) ? "favorited" : ""}" data-local-action="favorite" data-index="${index}" viewBox="0 0 16 16" style="cursor:pointer;" fill="currentColor"><path d="m8 2.748-.717-.737C5.6.281 2.514.878 1.4 3.053c-.523 1.023-.641 2.5.314 4.385.92 1.815 2.834 3.989 6.286 6.357 3.452-2.368 5.365-4.542 6.286-6.357.955-1.886.838-3.362.314-4.385C13.486.878 10.4.28 8.717 2.01L8 2.748zM8 15C-7.333 4.868 3.279-3.04 7.824 1.143c.06.055.119.112.176.171a3.12 3.12 0 0 1 .176-.17C12.72-3.042 23.333 4.867 8 15z"/></svg>
				<svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" class="bi bi-sheet-editor" data-local-action="edit" data-index="${index}" viewBox="0 0 40 40" style="cursor:pointer;"><path d="M20.8333 36.6667H30C30.884 36.6667 31.7319 36.3155 32.357 35.6903C32.9821 35.0652 33.3333 34.2174 33.3333 33.3333V11.6667L25 3.33333H9.99996C9.1159 3.33333 8.26806 3.68452 7.64294 4.30964C7.01782 4.93476 6.66663 5.78261 6.66663 6.66666V22.5" fill="none" stroke="currentColor" stroke-width="4.16667" stroke-linecap="round" stroke-linejoin="round"/><path d="M23.333 3.33333V9.99999C23.333 10.884 23.6842 11.7319 24.3093 12.357C24.9344 12.9821 25.7822 13.3333 26.6663 13.3333H33.333M22.2963 26.0433C22.625 25.7146 22.8858 25.3243 23.0637 24.8948C23.2416 24.4653 23.3332 24.0049 23.3332 23.54C23.3332 23.0751 23.2416 22.6147 23.0637 22.1852C22.8858 21.7557 22.625 21.3654 22.2963 21.0367C21.9676 20.7079 21.5773 20.4471 21.1478 20.2692C20.7182 20.0913 20.2579 19.9997 19.793 19.9997C19.3281 19.9997 18.8677 20.0913 18.4382 20.2692C18.0087 20.4471 17.6184 20.7079 17.2896 21.0367L8.93964 29.39C8.54338 29.786 8.25334 30.2756 8.0963 30.8133L6.7013 35.5967C6.65947 35.7401 6.65697 35.8921 6.69404 36.0368C6.73112 36.1815 6.80641 36.3136 6.91205 36.4192C7.01768 36.5249 7.14977 36.6002 7.29449 36.6373C7.4392 36.6743 7.59122 36.6718 7.73464 36.63L12.518 35.235C13.0557 35.078 13.5453 34.7879 13.9413 34.3917L22.2963 26.0433Z" fill="none" stroke="currentColor" stroke-width="4.16667" stroke-linecap="round" stroke-linejoin="round"/></svg>
				<svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" class="bi bi-trash3" data-local-action="delete" data-index="${index}" viewBox="0 0 16 16" style="cursor:pointer;" fill="currentColor"><path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5M11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H2.506a.58.58 0 0 0-.01 0H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66h.538a.5.5 0 0 0 0-1h-.995a.59.59 0 0 0-.01 0zm1.958 1-.846 10.58a1 1 0 0 1-.997.92h-6.23a1 1 0 0 1-.997-.92L3.042 3.5zm-7.487 1a.5.5 0 0 1 .528.47l.5 8.5a.5.5 0 0 1-.998.06L5 5.03a.5.5 0 0 1 .47-.53Zm5.058 0a.5.5 0 0 1 .47.53l-.5 8.5a.5.5 0 1 1-.998-.06l.5-8.5a.5.5 0 0 1 .528-.47ZM8 4.5a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-1 0V5a.5.5 0 0 1 .5-.5"/></svg>
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
	const showLoadMore = storeState.items.length < storeState.total;
	const footer = showLoadMore
		? `<div class="store-load-more"><button class="store-toolbar-btn" data-store-action="load-more" ${storeState.loadingMore ? "disabled" : ""}>${storeState.loadingMore ? "Loading..." : "Load More"}</button></div>`
		: "";
	return `<div class="store-card-list">${cards}</div>${footer}`;
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
		item.accessMode === "web_only" ? "Web only" : "Downloadable",
		item.priceAmount > 0 ? "Paid" : "Free",
	]
		.concat(item.tags.slice(0, 3))
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
					<button class="store-action-btn primary" data-store-action="play" data-sheet-id="${item.id}" ${disabledPlay ? "disabled" : ""}>${isPlayingItem ? "Preparing..." : "Play"}</button>
					<button class="store-action-btn" data-store-action="save" data-sheet-id="${item.id}" ${disabledSave ? "disabled" : ""}>${isSavingItem ? "Saving..." : "Save to Library"}</button>
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

async function fetchStoreSheets({ reset, refresh }) {
	if (!reset) {
		if (storeState.loadingMore) return;
		if (storeState.loading) return;
		if (storeState.total > 0 && storeState.items.length >= storeState.total) return;
	}

	const nextOffset = reset ? 0 : storeState.items.length;
	const requestQuery = storeState.query;
	const requestGeneration = reset ? storeState.searchGeneration + 1 : storeState.searchGeneration;

	if (reset) {
		storeState.searchGeneration = requestGeneration;
		storeState.loading = true;
		storeState.loadingMore = false;
		storeState.error = "";
	} else {
		storeState.loadingMore = true;
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

		if (reset) {
			storeState.items = response.items;
		} else {
			const existingIds = new Set(storeState.items.map((item) => item.id));
			const nextItems = response.items.filter((item) => !existingIds.has(item.id));
			storeState.items = storeState.items.concat(nextItems);
		}

		storeState.offset = storeState.items.length;
		storeState.total = response.total;
		storeState.hasLoaded = true;
	} catch (error) {
		if (requestGeneration !== storeState.searchGeneration || requestQuery !== storeState.query) return;
		if (reset) {
			storeState.error = normalizeRendererError(error, "Unable to connect to Sky Sheet Store.");
		} else {
			notie.alert({
				type: 3,
				text: normalizeRendererError(error, "Unable to load more sheets. Please try again."),
			});
		}
	} finally {
		if (requestGeneration === storeState.searchGeneration && requestQuery === storeState.query) {
			if (reset) {
				storeState.loading = false;
			}
			storeState.loadingMore = false;
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
			sheet: prepared.displaySheet,
		});
		btnPlay();
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

async function prepareStoreSheet(sheetId, item) {
	const cached = storeState.cache.get(sheetId);
	if (cached) return cached;

	const payload = await ipcRenderer.invoke("sky-sheet-store:get-player-sheet", { id: sheetId });
	const normalizedSheet = normalizeStorePlayerPayload(payload, item);
	const keyMap = mapStoreRuntimeNotesToAutoPianoKeyMap(payload.runtime.notes, payload.player.bitsPerPage);
	const prepared = {
		normalizedSheet,
		keyMap,
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
			sourceUrl: item.sourceUrl,
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
	const key = typeof storeKey === "string" ? storeKey.trim() : "";
	const match = STORE_KEY_PATTERN.exec(key);
	if (!match) return null;

	const keyIndex = Number(match[2]);
	const safeBitsPerPage = Number(bitsPerPage);
	if (!Number.isFinite(safeBitsPerPage) || safeBitsPerPage <= 0 || safeBitsPerPage > 128) {
		return null;
	}
	if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex >= safeBitsPerPage) {
		return null;
	}
	if (keyIndex > 14) {
		return null;
	}
	return keys[keyIndex] || null;
}

function mapStoreRuntimeNotesToAutoPianoKeyMap(runtimeNotes, bitsPerPage) {
	const keyMap = {};

	for (const group of runtimeNotes) {
		const timeMs = Number(group?.timeMs);
		if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs > MAX_REMOTE_DURATION_MS) {
			throw new Error("The downloaded sheet is invalid.");
		}

		if (!keyMap[timeMs]) {
			keyMap[timeMs] = [];
		}

		const dedupe = new Set(keyMap[timeMs]);
		for (const key of Array.isArray(group?.keys) ? group.keys : []) {
			const autoKey = mapStoreRuntimeKeyToAutoPianoKey(key, bitsPerPage);
			if (!autoKey) {
				throw new Error("The downloaded sheet is invalid.");
			}
			if (!dedupe.has(autoKey)) {
				dedupe.add(autoKey);
				keyMap[timeMs].push(autoKey);
			}
		}
	}

	const timestamps = Object.keys(keyMap).map(Number).sort((a, b) => a - b);
	if (!timestamps.length) {
		throw new Error("The downloaded sheet is invalid.");
	}

	const normalized = {};
	if (!timestamps.includes(0)) {
		normalized[0] = [];
	}

	for (const timestamp of timestamps) {
		normalized[timestamp] = keyMap[timestamp];
	}

	const lastTimestamp = timestamps[timestamps.length - 1];
	normalized[(Math.trunc(lastTimestamp / 1000) + 1) * 1000] = [];
	return normalized;
}

function getStoreAvailability(item) {
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
		const keyMap = await getLocalKeyMap(index);
		setPlaybackTarget({
			type: "local",
			index,
			keyMap,
			sheet: sheetData,
		});
		if (trackRecentPlay) addToRecentPlays(sheetData.name);
	} catch (error) {
		console.error("Failed to load local sheet:", error);
		notie.alert({ type: 3, text: "Error loading song data." });
	}
}

function setPlaybackTarget({ type, index, keyMap, sheet }) {
	currentPlayback = {
		type,
		index,
		keyMap,
		sheet,
	};
	updateFooter({ ...sheet, keys: keyMap });
}

async function getLocalKeyMap(index) {
	if (listKeys[index]) return listKeys[index];
	const sheet = listSheet[index];
	if (!sheet) throw new Error("Sheet not found.");

	const data = await fs.promises.readFile(path.join(dataDirectory, sheet.keyMap), { encoding: "utf8" });
	const parsed = JSON.parse(data);
	listKeys[index] = parsed;
	return parsed;
}

function deleteLocalSheet(index) {
	const sheetData = listSheet[index];
	if (!sheetData) return;

	fs.unlinkSync(path.join(dataDirectory, sheetData.keyMap));
	listSheet.splice(index, 1);
	listKeys.splice(index, 1);
	fs.writeFileSync(listSheetPath, JSON.stringify(listSheet, null, 4), { mode: 0o666 });

	if (currentPlayback.type === "local") {
		if (currentPlayback.index === index) {
			if (listSheet.length > 0) {
				const nextIndex = Math.max(0, Math.min(index, listSheet.length - 1));
				void selectLocalSheet(nextIndex, { trackRecentPlay: false });
			} else {
				currentPlayback = { type: "none", index: null, keyMap: null, sheet: null };
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

	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		const ext = path.extname(file.path).toLowerCase();
		let json = null;

		if (ext === ".mid" || ext === ".midi") {
			try {
				const fileArray = fs.readFileSync(file.path);
				const midi = MidiParser.parse(fileArray);
				json = parseMidiToSkyFormat(midi, path.basename(file.path, ext));
			} catch (error) {
				console.error("Failed to parse MIDI:", error);
				if (files.length === 1) {
					notie.alert({ type: 3, text: "File Sheet is not in the format. Please check again!" });
				}
				continue;
			}
		} else {
			const utf8Text = fs.readFileSync(file.path, { encoding: "utf8" });
			const typeDetect = utf8Text[0] !== "[" && utf8Text[0] !== "<" && utf8Text[0] !== "{"
				? "utf16le"
				: "utf8";
			const text = decUTF16toUTF8(fs.readFileSync(file.path, { encoding: typeDetect }));

			try {
				if (text[0] === "[" || text[0] === "{") {
					json = parseJsonSheetText(text);
				} else if (text.startsWith("<DontCopyThisLine>") || text.match(/([A-C][1-5])/)) {
					json = parseABCToSkyFormat(text, path.basename(file.path, ext));
				} else {
					throw new Error("Unsupported sheet format.");
				}
			} catch (error) {
				if (files.length === 1) {
					notie.alert({ type: 3, text: "File Sheet is not in the format. Please check again!" });
				}
				continue;
			}
		}

		if (json.isEncrypted === true || (Array.isArray(json.songNotes) && typeof json.songNotes[0] === "number")) {
			try {
				json.songNotes = decodeNums(json.songNotes);
				json.isEncrypted = false;
			} catch (decryptErr) {
				console.error("Failed to decrypt sheet:", json.name, decryptErr);
				if (files.length === 1) {
					notie.alert({ type: 3, text: "Failed to decrypt the sheet. It might be corrupted." });
				}
				continue;
			}
		}

		let result;
		try {
			result = encSheet(json);
		} catch (error) {
			console.error(error);
			if (files.length === 1) {
				notie.alert({ type: 3, text: "File Sheet is not in the format. Please check again!" });
			}
			continue;
		}

		if (!result) {
			done++;
			continue;
		}

		if (files.length === 1) {
			notie.alert({ type: 3, text: result.msg });
		}
	}

	renderContent();

	if (files.length > 1) {
		notie.alert({
			type: done > 0 ? 1 : 3,
			text: `Complete import! Success: ${done}. Error: ${files.length - done}`,
		});
	} else if (done > 0) {
		notie.alert({ type: 1, text: "Complete import!" });
	}

	event.target.value = "";
});

function parseJsonSheetText(text) {
	const normalized = typeof text === "string" ? text.trim().replace(/^\uFEFF/, "") : "";
	if (!normalized) throw new Error("Invalid sheet JSON.");

	const candidates = [normalized];
	const unwrapped = normalized.replace(/^\(\s*/, "").replace(/\s*\);?\s*$/, "");
	if (unwrapped !== normalized) candidates.push(unwrapped);

	for (const candidate of candidates) {
		try {
			return unwrapParsedSheet(JSON.parse(candidate));
		} catch (_) {
			// Try the next safe candidate.
		}
	}

	return unwrapParsedSheet(JSON.parse(toRelaxedJson(unwrapped)));
}

function unwrapParsedSheet(parsed) {
	if (Array.isArray(parsed)) {
		if (!parsed.length) throw new Error("Empty sheet array.");
		return parsed[0];
	}
	if (parsed && typeof parsed === "object") {
		return parsed;
	}
	throw new Error("Invalid sheet JSON.");
}

function toRelaxedJson(value) {
	return value
		.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
		.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner) => JSON.stringify(unescapeSingleQuotedString(inner)))
		.replace(/,\s*([}\]])/g, "$1");
}

function unescapeSingleQuotedString(value) {
	return value
		.replace(/\\\\/g, "\\")
		.replace(/\\'/g, "'")
		.replace(/\\"/g, '"');
}

function parseABCToSkyFormat(text, fileName) {
	const lines = text.split("\n");
	const meta = lines[0].split(" ");

	let bpm;
	let pitch;
	let bitsPerPage;
	let author;
	let transcribedBy;
	const hasDontCopy = meta[0] === "<DontCopyThisLine>";

	if (hasDontCopy) {
		bpm = parseInt(meta[1], 10) || 240;
		pitch = parseInt(meta[2], 10) || 0;
		bitsPerPage = parseInt(meta[3], 10) || 16;
		author = meta[4] || "Unknown";
		transcribedBy = meta[5] || "Unknown";
	} else {
		bpm = parseInt(meta[0], 10) || 240;
		pitch = parseInt(meta[1], 10) || 0;
		bitsPerPage = parseInt(meta[2], 10) || 16;
		author = meta[3] || "Unknown";
		transcribedBy = meta[4] || "Unknown";
	}

	const step = Math.floor(60000 / bpm);
	let time = 0;
	const notes = [];

	for (let i = 1; i < lines.length; i++) {
		const tokens = lines[i].trim().split(/\s+/);
		for (const token of tokens) {
			if (token !== "." && token !== "") {
				const matches = token.match(/([A-C][1-5])/g);
				if (matches) {
					for (const match of matches) {
						const group = match.charCodeAt(0) - 65;
						const num = parseInt(match[1], 10) - 1;
						const index = group * 5 + num;
						notes.push({ time, key: `1Key${index}` });
					}
				}
			}
			time += step;
		}
	}

	return {
		name: fileName,
		author,
		transcribedBy,
		isComposed: true,
		bpm,
		bitsPerPage,
		pitchLevel: pitch,
		isEncrypted: false,
		songNotes: notes,
	};
}

function parseMidiToSkyFormat(midi, fileName) {
	const midiToSky = {
		60: 0, 62: 1, 64: 2, 65: 3, 67: 4, 69: 5, 71: 6,
		72: 7, 74: 8, 76: 9, 77: 10, 79: 11, 81: 12, 83: 13,
		84: 14,
	};

	let tempo = 500000;
	let author = "Unknown";
	let transcribedBy = "Unknown";
	let songName = fileName;

	midi.track.forEach((track) => {
		if (!track.event) return;
		track.event.forEach((event) => {
			if (event.type === 255) {
				if (event.metaType === 81) tempo = event.data;
				if (event.metaType === 2 && typeof event.data === "string") {
					author = event.data.split(",")[0] || author;
					transcribedBy = event.data.split(",")[1] || transcribedBy;
				}
				if (event.metaType === 3 && typeof event.data === "string") songName = event.data;
			}
		});
	});

	const bpm = Math.round(60000000 / tempo);
	const timeDivision = midi.timeDivision || 480;
	const notes = [];

	midi.track.forEach((track) => {
		if (!track.event) return;
		let absoluteTimeMs = 0;
		track.event.forEach((event) => {
			absoluteTimeMs += event.deltaTime * (tempo / 1000) / timeDivision;
			if (event.type === 9 && event.data && event.data[1] > 0) {
				const note = event.data[0];
				let skyKey = midiToSky[note];
				if (skyKey === undefined) {
					let closest = 0;
					let minDiff = 100;
					for (const key in midiToSky) {
						const diff = Math.abs(parseInt(key, 10) - note);
						if (diff < minDiff) {
							minDiff = diff;
							closest = midiToSky[key];
						}
					}
					skyKey = closest;
				}
				notes.push({ time: Math.round(absoluteTimeMs), key: `1Key${skyKey}` });
			}
		});
	});

	notes.sort((a, b) => a.time - b.time);

	return {
		name: songName,
		author,
		transcribedBy,
		isComposed: true,
		bpm,
		bitsPerPage: 16,
		pitchLevel: 0,
		isEncrypted: false,
		songNotes: notes,
	};
}

function encSheet(json, extraMeta = {}) {
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

	const tempEnc = {};
	const fileName = `${Base64.encode(random(1, 9999) + String(json.name || "").replace(/[^a-zA-Z0-9]/g, "-"))}.json`;

	for (const note of json.songNotes) {
		if (!tempEnc[note.time]) tempEnc[note.time] = [];
		tempEnc[note.time].push(keys[parseInt(String(note.key).split("Key")[1], 10)]);
	}

	const timestamps = Object.keys(tempEnc);
	if (!timestamps.length) {
		return { errCode: 4, msg: "The sheet file is not valid, please try again with another file!" };
	}

	tempEnc[(Math.trunc(Number(timestamps[timestamps.length - 1]) / 1000) + 1) * 1000] = [];

	fs.writeFileSync(
		path.join(dataDirectory, fileName),
		JSON.stringify(!tempEnc["0"] ? { 0: [], ...tempEnc } : tempEnc),
		{ mode: 0o666 },
	);

	listSheet.push({
		name: json.name,
		author: json.author || "Unknown",
		transcribedBy: json.transcribedBy || "Unknown",
		bpm: json.bpm,
		bitsPerPage: json.bitsPerPage,
		pitchLevel: json.pitchLevel,
		isComposed: json.isComposed,
		keyMap: fileName,
		...(extraMeta.source ? {
			source: extraMeta.source,
			sourceId: extraMeta.sourceId || "",
			sourceUrl: extraMeta.sourceUrl || "",
		} : {}),
	});

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
	document.getElementsByClassName("name-playing")[0].innerHTML = info.name;
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

function decodeNums(nums) {
	const MASK = Object.freeze([
		16, 34, 56, 18, 62, 19, -25, 55,
		15, 24, 30, 12, 30, 45, 39, -23,
		-10, 15, 45, -18, 37, -2, -21, 65,
		25, -4, -14, 43, 23, -4, -17, -17,
	]);
	if (!Array.isArray(nums)) throw new TypeError("decodeNums: input must be an array of numbers");
	let value = "";
	for (let i = 0; i < nums.length; i++) {
		const n = nums[i] | 0;
		value += String.fromCharCode(n + MASK[i % MASK.length]);
	}
	try {
		return JSON.parse(value.replace(/(].*)/, "]"));
	} catch (_) {
		console.error("Failed to parse decrypted string:", value);
		throw new Error("Decryption resulted in invalid JSON.");
	}
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

function decUTF16toUTF8(str) {
	const chunkSize = 10000;
	let result = "";
	for (let i = 0; i < str.length; i += chunkSize) {
		const chunk = str.slice(i, i + chunkSize);
		const utf16leArray = new Uint16Array(chunk.length);
		for (let j = 0; j < chunk.length; j++) {
			utf16leArray[j] = chunk.charCodeAt(j);
		}
		const utf8Array = new TextEncoder().encode(String.fromCharCode.apply(null, utf16leArray));
		result += new TextDecoder("utf-8").decode(utf8Array);
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
		fs.readFile(path.join(dataDirectory, data.keyMap), { encoding: "utf8" }, (err, keymapData) => {
			if (err) {
				console.error("Error reloading keymap after sheet update:", err);
				return;
			}
			listKeys[index] = JSON.parse(keymapData);
			setPlaybackTarget({
				type: "local",
				index,
				keyMap: listKeys[index],
				sheet: data,
			});
		});
	}
	renderContent();
});

ipcRenderer.on("keymap-updated", (_, { index }) => {
	fs.readFile(path.join(dataDirectory, listSheet[index].keyMap), { encoding: "utf8" }, (err, data) => {
		if (err) {
			console.error("Error reloading keymap:", err);
			return;
		}
		listKeys[index] = JSON.parse(data);
		if (currentPlayback.type === "local" && currentPlayback.index === index) {
			setPlaybackTarget({
				type: "local",
				index,
				keyMap: listKeys[index],
				sheet: listSheet[index],
			});
		}
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

