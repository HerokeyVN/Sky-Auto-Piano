/**
 * Sky Auto Piano - Settings Page
 * Handles all settings UI interactions, theme management, tab navigation, 
 * and saving configuration to the config file.
 */

// -------------------------------------
// IMPORTS AND SETUP
// -------------------------------------
const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");
const dirSetting = path.join(__dirname, "..", "config", "config.json");
const packageJson = require(path.join(__dirname, "..", "package.json"));

// Load current configuration
var config = JSON.parse(fs.readFileSync(dirSetting));

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

// Listen for the response from the main process about update availability
// This handler receives the result of the update check and shows appropriate notification
ipcRenderer.on("update-check-response", (event, data) => {
	const messageElement = document.getElementById('update-message');
	
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

		messageElement.classList.add('success', 'show');
		if (data.available) {
			messageElement.textContent = `A new update is available! (v${data.latestVersion})`;
		} else {
			messageElement.textContent = `You are using the latest version! (v${data.currentVersion})`;
		}
	}

	// Set timeout to remove the show class after 3 seconds
	window.fadeTimeout = setTimeout(() => {
		messageElement.classList.remove('show');
	}, 3000);
});

// -------------------------------------
// EVENT HANDLERS
// -------------------------------------
/**
 * Shortcut key input handling
 * Allows capturing keyboard combinations and formatting them
 */
let keyup = true;
for (let id of [
	"pre-shortcut-setting",
	"play-shortcut-setting",
	"next-shortcut-setting",
]) {
	// Handle key release - format the shortcut string
	document.getElementById(id).addEventListener("keyup", (data) => {
		let dom = document.getElementById(id);
		dom.value = dom.value
			.split("+")
			.sort((a, b) => {
				// Sort modifier keys first, then regular keys
				if (a.length == 1 && b.length > 1) return 1;
				if (b.length == 1 && a.length > 1) return -1;
				if (a < b) return -1;
				if (a > b) return 1;
				return 0;
			})
			.join("+");
		keyup = true;
	});

	// Handle key press - build the shortcut string
	document.getElementById(id).addEventListener("keydown", (data) => {
		let dom = document.getElementById(id);
		if (keyup) {
			dom.value = "";
			keyup = false;
		}

		let key = data.key;
		// Format special keys
		if (data.key == "Control") key = "Ctrl";
		if (data.key.length == 1) key = data.key.toUpperCase();

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
	config.shortcut.pre = document.getElementById("pre-shortcut-setting").value;
	config.shortcut.play = document.getElementById("play-shortcut-setting").value;
	config.shortcut.next = document.getElementById("next-shortcut-setting").value;

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
