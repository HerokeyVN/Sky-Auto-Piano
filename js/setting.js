/**
 * Sky Auto Piano - Settings Page
 * Handles all settings UI interactions, theme management, tab navigation, 
 * and saving configuration to the config file.
 */

// -------------------------------------
// IMPORTS AND SETUP
// -------------------------------------
const { ipcRenderer, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const dirSetting = path.join(__dirname, "..", "config", "config.json");
const packageJson = require(path.join(__dirname, "..", "package.json"));
const marked = require('marked');

// Load current configuration
var config = JSON.parse(fs.readFileSync(dirSetting));

// Configure marked to open links in external browser
marked.setOptions({
	renderer: new marked.Renderer()
});

// Handle external links
document.addEventListener('click', (event) => {
	const target = event.target.closest('a');
	if (target && target.href && target.href.startsWith('http')) {
		event.preventDefault();
		shell.openExternal(target.href);
	}
});

// -------------------------------------
// THEME MANAGEMENT
// -------------------------------------
document.addEventListener("DOMContentLoaded", () => {
	const body = document.body;
	const lightModeBgColor = "#0a1930";
	const darkModeBgColor = "#1B1D1E";

	// Fetch version information
	document.getElementById("app-version").textContent = `Version: ${packageJson.version}`;
	/**
	 * Apply theme to the settings window
	 * @param {string} theme - 'light' or 'dark' theme name
	 */
	const applyTheme = (theme) => {
		if (theme === "dark") {
			body.classList.add("dark-mode");
			body.style.backgroundColor = darkModeBgColor;
		} else {
			body.classList.remove("dark-mode");
			body.style.backgroundColor = lightModeBgColor;
		}
	};

	// Apply saved theme or default to light
	const savedTheme = localStorage.getItem("theme");
	const initialTheme = savedTheme ? savedTheme : "light";
	applyTheme(initialTheme);
});

// -------------------------------------
// TAB NAVIGATION
// -------------------------------------
const menu = document.getElementsByClassName("menu")[0].childNodes;
var listTab = [];

// Show the default active tab
document.getElementById(
	getTab(document.querySelector(".menu .active"))
).style.display = "flex";

// Build list of available tabs
for (let dom of menu) {
	if (dom.nodeName != "H3") continue;
	listTab.push(getTab(dom));
}

// Set up tab switching functionality
for (let dom of menu) {
	if (dom.nodeName != "H3") continue;
	dom.addEventListener("click", (data) => {
		// Remove active class from all tabs
		for (let item of menu) {
			if (item.nodeName != "H3") continue;
			item.classList.remove("active");
		}

		// Handle clicking on either H3 or child span
		let target = data.target.parentNode;
		if (data.target.nodeName == "H3") target = data.target;

		// Set new active tab
		target.classList.add("active");

		// Show selected tab content, hide others
		listTab.map((tab) => {
			document.getElementById(tab).style = undefined;
			document.getElementById(getTab(target)).style.display = "flex";
		});
	});
}

// -------------------------------------
// LOAD SETTINGS
// -------------------------------------
// General settings
document.getElementById("switch-save-setting").checked = config.panel.autoSave;
document.getElementById("switch-minimize-on-play").checked = config.panel.minimizeOnPlay;

// Keyboard settings
let i = 0;
for (let dom of document.getElementsByClassName("keys")) {
	dom.value = config.keyboard.keys[i++];
}
document.getElementById("switch-custom-keyboard").checked =
	config.keyboard.customKeyboard;

// Shortcut settings
document.getElementById("pre-shortcut-setting").value = config.shortcut.pre;
document.getElementById("play-shortcut-setting").value = config.shortcut.play;
document.getElementById("next-shortcut-setting").value = config.shortcut.next;
document.getElementById("increase-speed-shortcut-setting").value = config.shortcut.increaseSpeed;
document.getElementById("decrease-speed-shortcut-setting").value = config.shortcut.decreaseSpeed;

// Update settings
document.getElementById("switch-block-update").checked =
	config.update?.blockUpdate ?? false;

// -------------------------------------
// UPDATE CHECK FUNCTIONALITY
// -------------------------------------
// Add click event listener to the "Check for Updates" button
// When clicked, it sends a message to the main process to check for updates
document.getElementById("check-update-btn").addEventListener("click", () => {
	ipcRenderer.send("check-update");
});

// Function to fetch changelog from GitHub
async function fetchChangelog(version) {
	try {
		const response = await fetch(`https://api.github.com/repos/HerokeyVN/Sky-Auto-Piano/releases/tags/v${version}`);
		const data = await response.json();
		return data.body;
	} catch (error) {
		console.error('Error fetching changelog:', error);
		return null;
	}
}

// Function to parse markdown changelog to HTML
function parseChangelog(markdown) {
	const changelogHTML = marked.parse(markdown);
	return `<div class="changelog-content">${changelogHTML}</div>`;
}

// Listen for the response from the main process about update availability
ipcRenderer.on("update-check-response", async (event, data) => {
	const messageElement = document.getElementById('update-message');
	const updatePrompt = document.getElementById('update-prompt');
	const updateVersion = document.getElementById('update-version');
	const currentVersion = document.getElementById('current-version');
	const changelogContent = document.getElementById('changelog-content');
	
	// Remove any existing classes and clear any existing timeouts
	messageElement.classList.remove('show', 'success', 'error');
	if (window.fadeTimeout) {
		clearTimeout(window.fadeTimeout);
	}
	
	if (data.error) {
		console.log("Update Check: Failed to connect to update server");
		messageElement.textContent = "Failed to check for updates. Please check your internet connection.";
		messageElement.classList.add('error', 'show');
	} else {
		if (data.currentVersion && data.latestVersion) {
			console.log(`Version Check: Current v${data.currentVersion} | Latest v${data.latestVersion}`);
		}

		if (data.available) {
			// Show update prompt with versions
			currentVersion.textContent = data.currentVersion;
			updateVersion.textContent = data.latestVersion;
			
			// Fetch and display changelog
			const changelog = await fetchChangelog(data.latestVersion);
			if (changelog) {
				changelogContent.innerHTML = parseChangelog(changelog);
			} else {
				changelogContent.innerHTML = '<p class="error">Failed to load changelog</p>';
			}

			updatePrompt.classList.add('show');
			
			// Handle update now button
			document.getElementById('update-now-btn').addEventListener('click', () => {
				const updateNowBtn = document.getElementById('update-now-btn');
				const updateLaterBtn = document.getElementById('update-later-btn');
				
				// Disable buttons and show loading state
				updateNowBtn.disabled = true;
				updateLaterBtn.disabled = true;
				updateNowBtn.innerHTML = '<svg class="spinner" viewBox="0 0 50 50"><circle class="path" cx="25" cy="25" r="20" fill="none" stroke-width="5"></circle></svg> Updating...';
				
				// Send update request to main process
				ipcRenderer.send('start-update');
			});
			
			// Handle later button
			document.getElementById('update-later-btn').addEventListener('click', () => {
				updatePrompt.classList.remove('show');
			});
		} else {
			messageElement.classList.add('success', 'show');
			messageElement.textContent = `You are using the latest version! (v${data.currentVersion})`;
		}
	}

	// Set timeout to remove the show class after 3 seconds
	window.fadeTimeout = setTimeout(() => {
		messageElement.classList.remove('show');
	}, 3000);
});

// Listen for update status from main process
ipcRenderer.on('update-status', (event, data) => {
	const updatePrompt = document.getElementById('update-prompt');
	const updateNowBtn = document.getElementById('update-now-btn');
	const updateLaterBtn = document.getElementById('update-later-btn');
	
	if (data.success) {
		// Update successful - prompt will be closed by the app restart
		updatePrompt.classList.remove('show');
	} else {
		// Update failed - show error and re-enable buttons
		updateNowBtn.disabled = false;
		updateLaterBtn.disabled = false;
		updateNowBtn.textContent = 'Update Now';
		
		// Show error message
		const messageElement = document.getElementById('update-message');
		messageElement.textContent = data.error || 'Update failed. Please try again later.';
		messageElement.classList.add('error', 'show');
		
		// Hide error message after 3 seconds
		setTimeout(() => {
			messageElement.classList.remove('show');
		}, 3000);
	}
});

// -------------------------------------
// EVENT HANDLERS
// -------------------------------------
/**
 * Shortcut key input handling
 * Allows capturing keyboard combinations and formatting them
 */
let keyup = true;

// Map of key codes to keysender format
const keyMap = {
	"Numpad0": "num0",
	"Numpad1": "num1",
	"Numpad2": "num2",
	"Numpad3": "num3",
	"Numpad4": "num4",
	"Numpad5": "num5",
	"Numpad6": "num6",
	"Numpad7": "num7",
	"Numpad8": "num8",
	"Numpad9": "num9",
	"NumpadAdd": "numadd",
	"NumpadSubtract": "numsub",
	"NumpadMultiply": "nummult",
	"NumpadDivide": "numdiv",
	"NumpadDecimal": "numdec",
	"NumpadComma": "numcomma",
	"Control": "ctrl",
	"Alt": "alt",
	"Shift": "shift",
	"Meta": "win"
};

// Function to convert shortcut to keysender format
function convertToKeysenderFormat(shortcut) {
	return shortcut.split("+").map(key => {
		// Check if it's a special key that needs mapping
		if (keyMap[key]) {
			return keyMap[key];
		}
		// For regular keys, just return lowercase
		return key.toLowerCase();
	}).join("+");
}

for (let id of [
	"pre-shortcut-setting",
	"play-shortcut-setting",
	"next-shortcut-setting",
	"increase-speed-shortcut-setting",
	"decrease-speed-shortcut-setting",
]) {
	// Handle key release - format the shortcut string
	document.getElementById(id).addEventListener("keyup", (data) => {
		let dom = document.getElementById(id);
		// Remove any duplicate keys while preserving order
		let keys = dom.value.split("+");
		let uniqueKeys = [];
		for (let key of keys) {
			if (!uniqueKeys.includes(key)) {
				uniqueKeys.push(key);
			}
		}
		dom.value = uniqueKeys.join("+");
		keyup = true;
	});

	// Handle key press - build the shortcut string
	document.getElementById(id).addEventListener("keydown", (data) => {
		let dom = document.getElementById(id);
		if (keyup) {
			dom.value = "";
			keyup = false;
		}

		let key = data.code; // Use code instead of key to detect numpad keys
		// Format special keys
		if (data.code === "ControlLeft" || data.code === "ControlRight") key = "Ctrl";
		if (data.code === "AltLeft" || data.code === "AltRight") key = "Alt";
		if (data.code === "ShiftLeft" || data.code === "ShiftRight") key = "Shift";
		if (data.code === "MetaLeft" || data.code === "MetaRight") key = "Win";
		
		// Remove 'Key' prefix from regular keys
		if (key.startsWith("Key")) {
			key = key.substring(3);
		}

		// Avoid duplicates in combination
		if (dom.value.split("+").indexOf(key) != -1) return;

		// Add key to combination
		if (dom.value != "") dom.value += "+";
		dom.value += key;
	});
}

/**
 * Save settings button handler
 * Validates and saves all settings to the config file
 */
document.getElementById("btn-save-setting").addEventListener("click", () => {
	// Save general settings
	config.panel.autoSave = document.getElementById("switch-save-setting").checked;
	config.panel.minimizeOnPlay = document.getElementById("switch-minimize-on-play").checked;

	// Save keyboard settings
	let i = 0;
	for (let dom of document.getElementsByClassName("keys")) {
		config.keyboard.keys[i++] = dom.value.toLowerCase();
	}
	config.keyboard.customKeyboard = document.getElementById("switch-custom-keyboard").checked;

	// Save and validate shortcut settings
	let arrShortcut = [];
	config.shortcut.pre = convertToKeysenderFormat(document.getElementById("pre-shortcut-setting").value);
	config.shortcut.play = convertToKeysenderFormat(document.getElementById("play-shortcut-setting").value);
	config.shortcut.next = convertToKeysenderFormat(document.getElementById("next-shortcut-setting").value);
	config.shortcut.increaseSpeed = convertToKeysenderFormat(document.getElementById("increase-speed-shortcut-setting").value);
	config.shortcut.decreaseSpeed = convertToKeysenderFormat(document.getElementById("decrease-speed-shortcut-setting").value);

	// Check for duplicate shortcuts
	for (let key in config.shortcut) {
		if (arrShortcut.indexOf(config.shortcut[key]) != -1) {
			return notie.alert({
				type: 3,
				text: "Unable to save the settings, the shortcut has been duplicated!",
			});
		}
		arrShortcut.push(config.shortcut[key]);
	}

	// Save update settings
	if (!config.update) {
		config.update = {};
	}
	config.update.blockUpdate = document.getElementById("switch-block-update").checked;

	// Write config to file
	try {
		fs.writeFileSync(dirSetting, JSON.stringify(config, null, 4));
		notie.alert({
			type: 1,
			text: "Saved the settings. Please restart the software to apply the settings.",
		});
		ipcRenderer.send("changeSetting");
	} catch (err) {
		console.log(err);
		notie.alert({
			type: 3,
			text: "Can't save the settings!",
		});
	}
});

// -------------------------------------
// UTILITY FUNCTIONS
// -------------------------------------
/**
 * Extract tab ID from DOM element
 * @param {Element} dom - Tab DOM element
 * @returns {string} Tab ID
 */
function getTab(dom) {
	let htmlDOM = dom.outerHTML.replaceAll(" ", "");
	return htmlDOM.split('tab="')[1].split('"')[0];
}

// Function to show changelog dialog
async function showChangelog(version) {
	const updatePrompt = document.getElementById('update-prompt');
	const currentVersion = document.getElementById('current-version');
	const updateVersion = document.getElementById('update-version');
	const changelogContent = document.getElementById('changelog-content');

	try {
		// Fetch and display changelog
		const changelog = await fetchChangelog(version);
		if (changelog) {
			// Update version display
			currentVersion.textContent = version;
			updateVersion.style.display = 'none'; // Hide the arrow and new version for post-update display
			
			// Update title and content
			const titleElement = updatePrompt.querySelector('h2');
			titleElement.textContent = 'What\'s New';
			
			// Display changelog
			changelogContent.innerHTML = parseChangelog(changelog);
			
			// Update buttons
			const buttonsContainer = updatePrompt.querySelector('.update-prompt-buttons');
			buttonsContainer.innerHTML = '<button id="close-changelog-btn" class="update-btn primary">Got it!</button>';
			
			// Show the dialog
			updatePrompt.classList.add('show');
			
			// Handle close button
			document.getElementById('close-changelog-btn').addEventListener('click', () => {
				updatePrompt.classList.remove('show');
				// Mark changelog as viewed
				const updateInfoPath = path.join(__dirname, '..', 'config', 'update-info.json');
				if (fs.existsSync(updateInfoPath)) {
					const updateInfo = JSON.parse(fs.readFileSync(updateInfoPath));
					updateInfo.showChangelog = false;
					fs.writeFileSync(updateInfoPath, JSON.stringify(updateInfo, null, 2));
				}
			});
		}
	} catch (error) {
		console.error('Error showing changelog:', error);
	}
}

// Check for post-update changelog on page load
document.addEventListener('DOMContentLoaded', () => {
	const updateInfoPath = path.join(__dirname, '..', 'config', 'update-info.json');
	if (fs.existsSync(updateInfoPath)) {
		try {
			const updateInfo = JSON.parse(fs.readFileSync(updateInfoPath));
			if (updateInfo.showChangelog) {
				showChangelog(updateInfo.newVersion);
			}
		} catch (error) {
			console.error('Error reading update info:', error);
		}
	}
});
