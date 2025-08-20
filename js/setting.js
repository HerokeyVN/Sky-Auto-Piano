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
	const lightModeBgColor = "#f7f9fc";
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
// MODERN TAB NAVIGATION
// -------------------------------------
document.addEventListener('DOMContentLoaded', () => {
	const navItems = document.querySelectorAll('.nav-item');
	const tabContents = document.querySelectorAll('.tab-content');

	// Show the default active tab
	const activeTab = document.querySelector('.nav-item.active');
	if (activeTab) {
		const tabId = activeTab.getAttribute('data-tab');
		showTab(tabId);
	}

	// Set up tab switching functionality
	navItems.forEach(item => {
		item.addEventListener('click', (e) => {
			e.preventDefault();
			
			// Remove active class from all nav items
			navItems.forEach(nav => nav.classList.remove('active'));
			
			// Add active class to clicked item
			item.classList.add('active');
			
			// Show corresponding tab
			const tabId = item.getAttribute('data-tab');
			showTab(tabId);
		});
	});

	/**
	 * Show the specified tab and hide others
	 * @param {string} tabId - ID of the tab to show
	 */
	function showTab(tabId) {
		// Hide all tab contents
		tabContents.forEach(content => {
			content.classList.remove('active');
		});
		
		// Show the selected tab
		const targetTab = document.getElementById(tabId);
		if (targetTab) {
			targetTab.classList.add('active');
		}
	}
});

// -------------------------------------
// LOAD SETTINGS
// -------------------------------------
document.addEventListener('DOMContentLoaded', () => {
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
		
	// Add event listener for block updates switch with confirmation dialog
	document.getElementById("switch-block-update").addEventListener("change", (event) => {
		if (event.target.checked) {
			// Show custom centered confirmation dialog when trying to enable block updates
			showBlockUpdatesDialog(() => {
				// User confirmed - keep the switch enabled
				config.update = config.update || {};
				config.update.blockUpdate = true;
			}, () => {
				// User cancelled - revert the switch
				event.target.checked = false;
			});
		} else {
			// Disabling block updates - no confirmation needed
			config.update = config.update || {};
			config.update.blockUpdate = false;
		}
	});
});

// -------------------------------------
// UPDATE CHECK FUNCTIONALITY
// -------------------------------------
// Add click event listener to the "Check for Updates" button
document.addEventListener('DOMContentLoaded', () => {
	document.getElementById("check-update-btn").addEventListener("click", () => {
		ipcRenderer.send("check-update");
	});
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
		updateNowBtn.innerHTML = '<i class="bi bi-download"></i><span>Update Now</span>';
		
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

const keyMap = {
	"numpad0": "Num0",
	"numpad1": "Num1",
	"numpad2": "Num2",
	"numpad3": "Num3",
	"numpad4": "Num4",
	"numpad5": "Num5",
	"numpad6": "Num6",
	"numpad7": "Num7",
	"numpad8": "Num8",
	"numpad9": "Num9",
	"numpadadd": "NumAdd",
	"numpadsubtract": "NumSub",
	"numpadmultiply": "NumMult",
	"numpaddivide": "NumDiv",
	"numpaddecimal": "NumDec",
	"numpadcomma": "NumComma",
	"control": "Ctrl",
	"controlleft": "Ctrl",
	"controlright": "Ctrl",
	"altleft": "Alt",
	"altright": "Alt",
	"shiftleft": "Shift",
	"shiftright": "Shift",
	"meta": "Win",
	"metaleft": "Win",
	"metaright": "Win",
	"arrowleft": "Left",
	"arrowup": "Up",
	"arrowright": "Right",
	"arrowdown": "Down",
	"backquote": "`",
	"backslash": "\\",
	"semicolon": ";",
	"quote": "'",
	"comma": ",",
	"period": ".",
	"slash": "/",
	"minus": "-",
	"equal": "=",
	"bracketleft": "[",
	"bracketright": "]"
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

document.addEventListener('DOMContentLoaded', () => {
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

			let key = data.code; // Use code instead of key to detect numpad keys
			
			// Map special keys using keyMap
			if (keyMap[key.toLocaleLowerCase()]) {
				key = keyMap[key.toLocaleLowerCase()];
			}
			
			// Remove 'Key' prefix from regular keys
			if (key.startsWith("Key")) {
				key = key.substring(3);
			}
			// Remove 'Digit' prefix from digit keys
			if (key.startsWith("Digit")) {
				key = key.substring(5);
			}

			// Avoid duplicates in combination
			if (dom.value.split("+").indexOf(key) != -1) return;

			// Add key to combination
			if (dom.value != "") dom.value += "+";
			dom.value += key;
		});
	}
});

/**
 * Save settings button handler
 * Validates and saves all settings to the config file
 */
document.addEventListener('DOMContentLoaded', () => {
	document.getElementById("btn-save-setting").addEventListener("click", () => {
		// Save general settings
		config.panel.autoSave = document.getElementById("switch-save-setting").checked;
		config.panel.minimizeOnPlay = document.getElementById("switch-minimize-on-play").checked;

		// Save keyboard settings
		let i = 0;
		for (let dom of document.getElementsByClassName("keys")) {
			config.keyboard.keys[i++] = dom.value;
		}
		config.keyboard.customKeyboard = document.getElementById("switch-custom-keyboard").checked;

		// Save and validate shortcut settings
		let arrShortcut = [];
		config.shortcut.pre = document.getElementById("pre-shortcut-setting").value;
		config.shortcut.play = document.getElementById("play-shortcut-setting").value;
		config.shortcut.next = document.getElementById("next-shortcut-setting").value;
		config.shortcut.increaseSpeed = document.getElementById("increase-speed-shortcut-setting").value;
		config.shortcut.decreaseSpeed = document.getElementById("decrease-speed-shortcut-setting").value;

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
});

// -------------------------------------
// UTILITY FUNCTIONS
// -------------------------------------

/**
 * Show custom centered dialog for block updates confirmation
 * @param {Function} onConfirm - Callback when user confirms
 * @param {Function} onCancel - Callback when user cancels
 */
function showBlockUpdatesDialog(onConfirm, onCancel) {
	// Create dialog container
	const dialogOverlay = document.createElement('div');
	dialogOverlay.className = 'block-updates-dialog-overlay';
	dialogOverlay.id = 'block-updates-dialog';
	
	// Create dialog content
	dialogOverlay.innerHTML = `
		<div class="block-updates-dialog">
			<div class="dialog-header">
				<div class="dialog-icon">
					<i class="bi bi-exclamation-triangle"></i>
				</div>
				<h2>Block Automatic Updates?</h2>
			</div>
			<div class="dialog-content">
				<p>Are you sure you want to block automatic updates?</p>
				<div class="warning-details">
					<div class="warning-item">
						<i class="bi bi-shield-x"></i>
						<span>You won't receive important security patches</span>
					</div>
					<div class="warning-item">
						<i class="bi bi-bug"></i>
						<span>Bug fixes and improvements will be missed</span>
					</div>
					<div class="warning-item">
						<i class="bi bi-lightbulb"></i>
						<span>New features won't be available automatically</span>
					</div>
				</div>
				<p class="note">You can still manually check for updates in the Updates tab.</p>
			</div>
			<div class="dialog-buttons">
				<button class="dialog-btn cancel-btn" id="block-updates-cancel">
					<i class="bi bi-x-circle"></i>
					<span>Cancel</span>
				</button>
				<button class="dialog-btn confirm-btn" id="block-updates-confirm">
					<i class="bi bi-shield-check"></i>
					<span>Yes, Block Updates</span>
				</button>
			</div>
		</div>
	`;
	
	// Add to document
	document.body.appendChild(dialogOverlay);
	
	// Add event listeners
	document.getElementById('block-updates-cancel').addEventListener('click', () => {
		closeBlockUpdatesDialog();
		onCancel();
	});
	
	document.getElementById('block-updates-confirm').addEventListener('click', () => {
		closeBlockUpdatesDialog();
		onConfirm();
	});
	
	// Close on overlay click
	dialogOverlay.addEventListener('click', (e) => {
		if (e.target === dialogOverlay) {
			closeBlockUpdatesDialog();
			onCancel();
		}
	});
	
	// Close on Escape key
	document.addEventListener('keydown', handleEscapeKey);
	
	// Show dialog with animation
	setTimeout(() => {
		dialogOverlay.classList.add('show');
	}, 10);
}

/**
 * Close the block updates dialog
 */
function closeBlockUpdatesDialog() {
	const dialog = document.getElementById('block-updates-dialog');
	if (dialog) {
		dialog.classList.remove('show');
		setTimeout(() => {
			if (dialog.parentNode) {
				dialog.parentNode.removeChild(dialog);
			}
		}, 300);
	}
	document.removeEventListener('keydown', handleEscapeKey);
}

/**
 * Handle Escape key for dialog
 */
function handleEscapeKey(e) {
	if (e.key === 'Escape') {
		const dialog = document.getElementById('block-updates-dialog');
		if (dialog) {
			closeBlockUpdatesDialog();
			// Trigger cancel callback
			const cancelBtn = document.getElementById('block-updates-cancel');
			if (cancelBtn) {
				cancelBtn.click();
			}
		}
	}
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
			buttonsContainer.innerHTML = '<button id="close-changelog-btn" class="update-btn primary"><i class="bi bi-check-lg"></i><span>Got it!</span></button>';
			
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



