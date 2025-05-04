/**
 * Sky Auto Piano - Main Process
 * This is the main Electron process that handles application lifecycle,
 * window management, updates, and auto-play functionality.
 */
const devMode = false;
// -------------------------------------
// IMPORTS AND SETUP
// -------------------------------------
import {
	app, BrowserWindow, globalShortcut, Menu, ipcMain, Notification,
} from "electron/main";
import fs from "fs";
import axios from "axios";
import path from "node:path";
import { Hardware } from "keysender";
import { fileURLToPath } from "url";
import AdmZip from "adm-zip";

// Convert ES module paths to file paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -------------------------------------
// SINGLE INSTANCE CHECK
// -------------------------------------
// Ensure only one instance of the application runs at a time
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
	app.quit();
	process.exit();
}

// -------------------------------------
// APPLICATION CONSTANTS
// -------------------------------------
// Update information and endpoints
const linkUpdate =
	"https://github.com/HerokeyVN/Sky-Auto-Piano/archive/refs/heads/main.zip";
const moduleUpdate =
	"https://raw.githubusercontent.com/HerokeyVN/Temp/main/mdl_SAM/node_modules.zip";
const packageUpdate =
	"https://raw.githubusercontent.com/HerokeyVN/Sky-Auto-Piano/main/package.json";
const folderUpdate = "Sky-Auto-Piano-main";

// Global application state variables
var isPlay = false;
var curPlay = "";
var updatedNoti = undefined;
var isUpdating = false; 
var updateType = "";
var updateProgress = 0;

// -------------------------------------
// CONFIGURATION SETUP
// -------------------------------------
const dirSetting = path.join(__dirname, "config", "config.json");
ensureExists(path.join(__dirname, "config"));

// Default configuration including theme preference
const defaultConfig = {
	panel: {
		longPressMode: false,
		speed: 1,
		delayNext: 1,
		autoSave: true,
		minimizeOnPlay: true,
	},
	keyboard: {
		customKeyboard: false,
		keys: [
			"y", "u", "i", "o", "p",
			"h", "j", "k", "l", ";",
			"n", "m", ",", ".", "/"
		],
	},
	shortcut: {
		pre: "Ctrl+Shift+C",
		play: "Ctrl+Shift+V",
		next: "Ctrl+Shift+B",
		increaseSpeed: "Ctrl+Up",
		decreaseSpeed: "Ctrl+Down",
	},
	update: {
		blockUpdate: false,
	},
	appTheme: "light",
};

// Function to update config with missing values
function updateConfigWithDefaults(currentConfig, defaultConfig) {
	let updated = false;
	
	// Helper function to recursively check and update objects
	function updateObject(current, defaults, path = '') {
		for (const key in defaults) {
			const currentPath = path ? `${path}.${key}` : key;
			
			if (!(key in current)) {
				current[key] = defaults[key];
				updated = true;
				console.log(`Added missing config value: ${currentPath}`);
			} else if (typeof defaults[key] === 'object' && !Array.isArray(defaults[key])) {
				updateObject(current[key], defaults[key], currentPath);
			}
		}
	}
	
	updateObject(currentConfig, defaultConfig);
	return updated;
}

let config;
try {
	if (!fs.existsSync(dirSetting)) {
		fs.writeFileSync(dirSetting, JSON.stringify(defaultConfig, null, 4));
		config = defaultConfig;
	} else {
		config = JSON.parse(fs.readFileSync(dirSetting));
		
		// Update config with any missing values
		if (updateConfigWithDefaults(config, defaultConfig)) {
			fs.writeFileSync(dirSetting, JSON.stringify(config, null, 4));
			console.log("Config file updated with missing values");
		}
	}
} catch (error) {
	console.error("Error loading/saving config:", error);
	config = defaultConfig;
	try {
		fs.writeFileSync(dirSetting, JSON.stringify(config, null, 4));
	} catch (writeError) {
		console.error("Failed to write default config:", writeError);
	}
}

var longPressMode = defaultConfig.panel.longPressMode;
var speed = defaultConfig.panel.speed;
var delayNext = defaultConfig.panel.delayNext;

if (config.panel.autoSave) {
	longPressMode = config.panel.longPressMode;
	speed = config.panel.speed;
	delayNext = config.panel.delayNext;
} else {
	speed = config.panel.speed;
}

speed = Math.round(speed * 10) / 10;
config.panel.speed = speed;

// -------------------------------------
// APPLICATION INITIALIZATION
// -------------------------------------
if (!devMode) Menu.setApplicationMenu(Menu.buildFromTemplate([]));
app.setAppUserModelId("Sky Auto Piano");
app.setName("Sky Auto Piano");

// -------------------------------------
// UPDATE FUNCTION
// -------------------------------------

// Automatic update checking
(async () => {
    // Clean up any pending files from previous update
    const cleanupFilePath = path.join(__dirname, "cleanup-files.json");
    if (fs.existsSync(cleanupFilePath)) {
        try {
            const filesToDelete = JSON.parse(fs.readFileSync(cleanupFilePath));
            let allDeleted = true;
            
            for (const file of filesToDelete) {
                try {
                    if (fs.existsSync(file)) {
                        fs.unlinkSync(file);
                        console.log(`Cleanup: Deleted pending file ${file}`);
                    }
                } catch (error) {
                    console.error(`Cleanup: Failed to delete ${file}:`, error.message);
                    allDeleted = false;
                }
            }

            if (allDeleted) {
                fs.unlinkSync(cleanupFilePath);
            }
        } catch (error) {
            console.error("Cleanup: Error processing cleanup files:", error);
        }
    }
    
    // Get package information for version checking
    let pkgLocal;
    let pkgUpdate;
    
    try {
        pkgLocal = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json")));
        pkgUpdate = (await axios.get(packageUpdate)).data;
    } catch (e) {
        console.error("Update:", e, "Failed to connect to the server!");
        return;
    }
    
    // Update modules
    if (!config.update?.blockUpdate) {
        const moduleUpdateNeeded = (pkgUpdate.module_version !== pkgLocal.module_version) || !fs.existsSync(path.join(__dirname, "node_modules", ".bin"));
        
        if (moduleUpdateNeeded) {
            await performModuleUpdate(pkgUpdate);
        }
        
        // Update core application
        await performUpdate();
    }
})();

// -------------------------------------
// WINDOW MANAGEMENT
// -------------------------------------
function createWindow() {
	const windowBackgroundColor =
		config.appTheme === "dark" ? "#1B1D1E" : "#0a1930";

	const win = new BrowserWindow({
		width: 750,
		minWidth: 700,
		height: 600,
		minHeight: 200,
		backgroundColor: windowBackgroundColor,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
		},
	});

	// Store window reference for notifications
	global.mainWindow = win;

	// Prevent window from being closed during update
	win.on('close', (event) => {
		if (isUpdating) {
			event.preventDefault();
			const updateTypeMsg = updateType === "core" ? "application" : "module";
			showUpdateNotie(
				"Update in Progress",
				`Cannot close - ${updateTypeMsg} update is in progress (${updateProgress}%). Please wait until the update completes.`,
				3
			);
			return false;
		}
	});

	win.loadFile(path.join(__dirname, "index", "index.html"));

	// Check for post-update changelog
	const updateInfoPath = path.join(__dirname, "config", "update-info.json");
	if (fs.existsSync(updateInfoPath)) {
		try {
			const updateInfo = JSON.parse(fs.readFileSync(updateInfoPath));
			if (updateInfo.showChangelog) {
				// Wait for window to load before showing changelog
				win.webContents.on('did-finish-load', () => {
					win.webContents.send('show-post-update-changelog', {
						version: updateInfo.newVersion
					});
				});
			}
		} catch (error) {
			console.error("Error reading update info:", error);
		}
	}

	// Send notification when update is done
	if (updatedNoti) {
		let notification = new Notification(updatedNoti);
		notification.on("click", (event, arg) => {
			app.relaunch();
			app.quit();
		});
		notification.show();
	}

	ipcMain.on("set-theme", (event, theme) => {
		if (theme === "light" || theme === "dark") {
			if (config.appTheme !== theme) {
				config.appTheme = theme;
				try {
					fs.writeFileSync(dirSetting, JSON.stringify(config, null, 4));
					console.log(`App theme saved: ${theme}`);
				} catch (error) {
					console.error("Failed to save theme preference:", error);
				}
			}
		} else {
			console.warn(`Received invalid theme setting: ${theme}`);
		}
	});

	// Processing the Play button event
	ipcMain.on("play", (event, data) => {
		isPlay = data.isPlay;
		if (isPlay && config.panel.minimizeOnPlay) {
			win.minimize();
		}

		console.log(isPlay);
		!isPlay ? win.webContents.send("stop") : "";
		if (!isPlay) return;
		curPlay = data.lockTime;
		let mapDelay = Object.keys(data.keys);
		autoPlay(data.keys);
		sendTimeProcess(Number(mapDelay[mapDelay.length - 1]), data.sec);
	});

	// Handling the event of the LongpressMode button
	ipcMain.on("longPressMode", (event, data) => {
		longPressMode = data;
		config.panel.longPressMode = longPressMode;
		fs.writeFileSync(dirSetting, JSON.stringify(config, null, 4));
	});

	// Processing speed changes
	ipcMain.on("changeSpeed", (event, data) => {
		speed = Number(data);
		config.panel.speed = speed;
		fs.writeFileSync(dirSetting, JSON.stringify(config, null, 4));
	});

	// Processing delay next changes
	ipcMain.on("changeDelayNext", (event, data) => {
		delayNext = Number(data);
		config.panel.delayNext = delayNext;
		fs.writeFileSync(dirSetting, JSON.stringify(config, null, 4));
	});

	// Send time data to front-end
	async function sendTimeProcess(total, sec) {
		let lockTime = curPlay + "";
		for (let i = sec; i <= Math.trunc(total / 1000); i++) {
			await new Promise((rev) => setTimeout(rev, Math.trunc(1000 / speed)));
			if (!isPlay || lockTime != curPlay) return;
			win.webContents.send("process-bar", i);
		}
	}

	// Processing the shortcut event
	globalShortcut.register(config.shortcut.pre, () => {
		win.webContents.send("btn-prev");
	});
	globalShortcut.register(config.shortcut.play, () => {
		win.webContents.send("btn-play");
	});
	globalShortcut.register(config.shortcut.next, () => {
		win.webContents.send("btn-next");
	});
	globalShortcut.register(config.shortcut.increaseSpeed, () => {
		speed = Math.min(5, Math.round((speed + 0.1) * 10) / 10);
		config.panel.speed = speed;
		fs.writeFileSync(dirSetting, JSON.stringify(config, null, 4));
		win.webContents.send("speed-changed", speed);
	});
	globalShortcut.register(config.shortcut.decreaseSpeed, () => {
		speed = Math.max(0.1, Math.round((speed - 0.1) * 10) / 10);
		config.panel.speed = speed;
		fs.writeFileSync(dirSetting, JSON.stringify(config, null, 4));
		win.webContents.send("speed-changed", speed);
	});

	// The main program automatically plays music (send pressing keys)
	async function autoPlay(keyMap) {
		winLog(win, delayNext * 1000 - 35);
		let keysID = {
			y: 0, u: 1, i: 2, o: 3, p: 4,
			h: 5, j: 6, k: 7, l: 8, ";": 9,
			n: 10, m: 11, ",": 12, ".": 13, "/": 14
		};
		let ks = new Hardware("Sky").keyboard;
		let objKey = Object.keys(keyMap);
		let lockTime = curPlay + "";

		for (let i = 1; i < objKey.length; i++) {
			let delay = objKey[i] - objKey[i - 1];
			delay = Math.trunc(delay / speed);
			let delay2 = undefined;
			if (keyMap[objKey[i]].length == 0) delay2 = delayNext * 1000;

			if (!isPlay || lockTime != curPlay) {
				return (isPlay = false);
			}

			for (let key of keyMap[objKey[i - 1]]) {
				if (config.keyboard.customKeyboard)
					key = config.keyboard.keys[keysID[key]];
				ks.sendKeys(
					key,
					longPressMode ? (delay2 ? delay2 : delay) - 35 : undefined
				);
			}

			await new Promise((rev) => setTimeout(rev, delay));
		}

		for (let key of keyMap[objKey[objKey.length - 1]]) {
			if (config.keyboard.customKeyboard)
				key = config.keyboard.keys[keysID[key]];
			ks.sendKeys(key, longPressMode ? delayNext * 1000 - 35 : undefined);
		}
		isPlay = false;
		win.webContents.send("stop-player");
	}

	// Function of processing events creating installation windows
	ipcMain.on("openSetting", () => {
		global.winMain = win;
		createWindowSetting();
	});

	// Open Sheet Editor window
	ipcMain.on("openSheetEditor", (event, args) => {
		const windowBackgroundColor = config.appTheme === "dark" ? "#1B1D1E" : "#0a1930";
		const editorWin = new BrowserWindow({
			width: 800,
			height: 600,
			resizable: false,
			maximizable: false,
			backgroundColor: windowBackgroundColor,
			parent: win,
			webPreferences: {
				nodeIntegration: true,
				contextIsolation: false,
			},
		});
		editorWin.loadFile(path.join(__dirname, "index", "editor.html"), {
			query: {
				sheetIndex: args.sheetIndex
			}
		});
	});

	app.on("second-instance", () => {
		if (win) {
			if (win.isMinimized()) win.restore();
			win.focus();
		}
	});

	win.once("closed", () => {
		app.quit();
	});
}

function createWindowSetting() {
	if (global.isOpenSetting) return;
	const windowBackgroundColor =
		config.appTheme === "dark" ? "#1B1D1E" : "#0a1930";

	const win = new BrowserWindow({
		width: 750,
		height: 600,
		resizable: false,
		backgroundColor: windowBackgroundColor,
		parent: global.winMain,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
		},
	});

	globalShortcut.unregisterAll();

	win.loadFile(path.join(__dirname, "index", "setting.html"));
	global.isOpenSetting = true;

	win.once("closed", () => {
		global.isOpenSetting = false;
		globalShortcut.register(config.shortcut.pre, () => {
			global.winMain.webContents.send("btn-prev");
		});
		globalShortcut.register(config.shortcut.play, () => {
			global.winMain.webContents.send("btn-play");
		});
		globalShortcut.register(config.shortcut.next, () => {
			global.winMain.webContents.send("btn-next");
		});
	});
}

// Handle the update check request from the renderer process
// This function checks if a new version is available by comparing local and remote versions
ipcMain.on("check-update", async (event) => {
	try {
		// Read the local package.json to get current version
		let pkgLocal = JSON.parse(
			fs.readFileSync(path.join(__dirname, "package.json"))
		);
		let vern = pkgLocal.version;

		// Fetch the remote package.json to get latest version
		var pkgUpdate = (await axios.get(packageUpdate)).data;
		var verg = pkgUpdate.version;

		console.log("Update Check:", `Current version: ${vern}, Latest version: ${verg}`);

		// Send response back to renderer with update availability and versions
		event.reply("update-check-response", {
			available: vern !== verg,
			currentVersion: vern,
			latestVersion: verg
		});
	} catch (e) {
		// If there's an error (e.g., network issue), log it and notify the user
		console.error("Update:", e, "Failed to connect to the server!");
		event.reply("update-check-response", {
			available: false,
			error: true
		});
	}
});


// Handle manual update request from renderer
ipcMain.on("start-update", async (event) => {
    try {
        console.log("Update:", "Starting manual update process...");
        
        // Get package information
        const pkgLocal = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json")));
        const pkgUpdate = (await axios.get(packageUpdate)).data;
        
        // First update modules if needed
        const moduleUpdateNeeded = pkgUpdate.module_version !== pkgLocal.module_version || 
                                  !fs.existsSync(path.join(__dirname, "node_modules", ".bin"));
        if (moduleUpdateNeeded) {
            await performModuleUpdate(pkgUpdate);
        }
        
        // Then update core (always attempt in manual update)
        const coreUpdateResult = await performUpdate({
            isManualUpdate: true,
            skipVersionCheck: false
        });
        
        // Send result back to renderer
        event.reply("update-status", { 
            success: coreUpdateResult, 
            moduleUpdated: moduleUpdateNeeded
        });
    } catch (error) {
        console.error("Update:", "Error during manual update process:", error);
        event.reply("update-status", { 
            success: false, 
            error: "Failed to complete update. Please try again later." 
        });
    }
});

app.whenReady().then(() => {
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

// -------------------------------------
// SUPPORT FUNCTIONS
// -------------------------------------


/**
 * Updates support modules
 * @param {Object} pkgUpdate - Package update information
 * @returns {Promise<boolean>} Success status
 */
async function performModuleUpdate(pkgUpdate) {
    try {
        isUpdating = true;
        updateType = "module";

        showUpdateNotie("Updating support modules...", "Sky Auto Piano is downloading essential modules. Please don't close the application.", 2);
        
        console.log("Update:", "Start downloading support module...");
        await downloadUpdate(__dirname, "node_modules.zip", moduleUpdate);
        
        console.log("Update:", "Start extracting the support module...");
        showUpdateNotie("Installing modules...", "Installing support modules. Please don't close the application.", 2);
        
        await extractZip(path.join(__dirname, "node_modules.zip"), __dirname);
        
        try {
			isUpdating = false;
            // Try to delete the zip file safely
            await safeDeleteFile(path.join(__dirname, "node_modules.zip"), 5, 1000);
            console.log("Update:", "Module zip file deleted successfully");
        } catch (deleteError) {
            console.warn("Update:", "Could not delete module zip file, will be cleaned up on next restart:", deleteError.message);
            
            // Add to cleanup list for next startup
            const cleanupPath = path.join(__dirname, "cleanup-files.json");
            const filesToCleanup = fs.existsSync(cleanupPath) 
                ? JSON.parse(fs.readFileSync(cleanupPath, 'utf8')) 
                : [];
            
            if (!filesToCleanup.includes(path.join(__dirname, "node_modules.zip"))) {
                filesToCleanup.push(path.join(__dirname, "node_modules.zip"));
                fs.writeFileSync(cleanupPath, JSON.stringify(filesToCleanup));
            }
        }

        console.log("Update:", "Complete the support module update...");
        showUpdateNotie("Modules Updated", "Support modules have been successfully updated.", 1);
        isUpdating = false;
        return true;
    } catch (error) {
        isUpdating = false;
        console.error("Update:", error);
        showUpdateNotie("Update Failed", "Failed to install support modules. The application will continue with current version.", 3);
        return false;
    }
}

// Common update function that both auto and manual updates can use
async function performUpdate(options = {}) {
    const { 
        isManualUpdate = false, 
        responseCallback = null,
        skipVersionCheck = false
    } = options;

    if (!isManualUpdate && config.update?.blockUpdate === true) {
        console.log("Update: Update checking is blocked by user setting.");
        return false;
    }

    try {
        console.log("Update:", isManualUpdate ? "Starting manual update process..." : "Checking update...");

        // Get version information
        let pkgLocal = JSON.parse(
            fs.readFileSync(path.join(__dirname, "package.json"))
        );
        let vern = pkgLocal.version;
        
        try {
            var pkgUpdate = (await axios.get(packageUpdate)).data;
            var verg = pkgUpdate.version;
        } catch (e) {
            console.error("Update:", e, "Failed to connect to the server!");
            if (responseCallback) {
                responseCallback({
                    success: false,
                    error: "Failed to connect to update server."
                });
            }
            return false;
        }

        // Check if update is needed
        const updateNeeded = (vern !== verg) || skipVersionCheck;
        
        if (!updateNeeded && !isManualUpdate) {
            console.log("Update:", "Awesome, you're on the latest version!");
            return false;
        }
        
		isUpdating = false;
        // Ensure update directory exists and is clean
        const updateDir = path.join(__dirname, "update");
        if (fs.existsSync(updateDir)) {
            deleteFolderRecursive(updateDir);
        }
        ensureExists(updateDir);

        // Save update information for changelog
        const updateInfo = {
            previousVersion: pkgLocal.version,
            newVersion: pkgUpdate.version,
            updateTime: new Date().toISOString(),
            showChangelog: true
        };
        fs.writeFileSync(
            path.join(__dirname, "config", "update-info.json"),
            JSON.stringify(updateInfo, null, 2)
        );

        // Start the update
        isUpdating = true;
        updateType = "core";
        
        showUpdateNotie("Updating Sky Auto Piano...", "A new version is being downloaded. Please don't close the application.", 2);
        
        // Download the software core
        console.log("Update:", "Start downloading the software core...");
        await downloadUpdate(updateDir, "update.zip");
        console.log("Update:", "Download the update completed!");
        
        // Extract the software core
        console.log("Update:", "Start extracting the software core...");
        showUpdateNotie("Installing update...", "Installing application update. Please don't close the application.", 2);
        
        await extractZip(path.join(updateDir, "update.zip"), updateDir);
        fs.unlinkSync(path.join(updateDir, "update.zip"));
        console.log("Update:", "Extraction the software core completed!");

        // Copy files to main directory
        console.log("Update:", "Installing update...");
        const except = ["data"]; // Folders to ignore during update
        const listFile = fs.readdirSync(path.join(updateDir, folderUpdate));
        
        for (let file of listFile) {
            if (except.indexOf(file) === -1) {
                const sourcePath = path.join(updateDir, folderUpdate, file);
                const targetPath = path.join(__dirname, file);
                
                if (!fs.lstatSync(sourcePath).isFile())
                    copyFolder(sourcePath, targetPath);
                else
                    fs.copyFileSync(sourcePath, targetPath);
            }
        }

        // Clean up
        deleteFolderRecursive(path.join(updateDir, folderUpdate));
        console.log("Update:", "Update completed successfully!");

        // Show notifications
        isUpdating = false;
        updatedNoti = {
            title: "Update Complete",
            body: "Complete update! Please restart the application to apply updates.",
            type: 1
        };
        
        // Show GUI notification
        showUpdateNotie(updatedNoti.title, updatedNoti.body, updatedNoti.type);
        
        // Show system notification
        const systemNotification = new Notification({
            title: updatedNoti.title,
            body: updatedNoti.body,
            icon: path.join(__dirname, "icon", "Icon9.ico"),
            silent: false
        });
        
        // Add click handler to restart the app
        systemNotification.on('click', () => {
            app.relaunch();
            app.quit();
        });
        
        systemNotification.show();
        
        // Send success response if this is a manual update
        if (responseCallback) {
            responseCallback({ success: true });
        }
        
        return true;
        
    } catch (error) {
        isUpdating = false;
        console.error("Update:", "Error during update process:", error);
        
        showUpdateNotie("Update Failed", "Failed to complete the update. The application will continue with current version.", 3);
        
        if (responseCallback) {
            responseCallback({ 
                success: false, 
                error: "Failed to complete update. Please try again later." 
            });
        }
        
        return false;
    }
}

/**
 * Download update function
 */
async function downloadUpdate(pathFile, nameFile, url = linkUpdate) {
	ensureExists(pathFile);
	updateProgress = 0;

	try {
		const response = await axios({
			url,
			method: "GET",
			responseType: "stream"
		});

		const writer = fs.createWriteStream(path.join(pathFile, nameFile));
		const totalLength = parseInt(response.headers['content-length'], 10);
		let downloadedBytes = 0;
		
		response.data.on('data', (chunk) => {
			downloadedBytes += chunk.length;
			if (totalLength) {
				const progress = Math.round((downloadedBytes / totalLength) * 100);
				
				// Update progress every 5%
				if (progress % 5 === 0 && progress !== updateProgress) {
					updateProgress = progress;
					console.log(`Download progress: ${progress}%`);
					
					// Send progress to renderer
					if (global.mainWindow && !global.mainWindow.isDestroyed()) {
						global.mainWindow.webContents.send("update-progress", {
							progress,
							type: updateType
						});
					}
				}
			}
		});

		response.data.pipe(writer);

		return new Promise((resolve, reject) => {
			writer.on("finish", resolve);
			writer.on("error", reject);
		});
	} catch (error) {
		console.error("Update", "Error downloading file: " + error);
		throw error;
	}
}

function winLog(win, msg) {
	if (typeof msg == "object") msg = JSON.stringify(msg);
	msg += "";
	win.webContents.send("winLog", msg);
}

/**
 * Shows a notification in the renderer process using notie.alert
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {number} type - Notification type (1: success, 2: warning, 3: error, 4: info)
 */
function showUpdateNotie(title, message, type = 1) {
	try {
		// Check if there's a valid window to send to
		if (global.mainWindow && !global.mainWindow.isDestroyed()) {
			global.mainWindow.webContents.send("show-update-notification", {
				title,
				message,
				type
			});
		} else {
			// Fallback to console
			console.log(`${title}: ${message}`);
		}
	} catch (error) {
		console.error("Failed to show GUI notification:", error);
	}
}

function extractZip(filePath, destinationPath) {
	return new Promise((resolve, reject) => {
		const zip = new AdmZip(filePath);
		zip.extractAllToAsync(destinationPath, true, (error) => {
			if (error) {
				console.error("Error extracting zip file:", error);
				reject(error);
				process.exit(504);
			} else {
				resolve();
			}
		});
	});
}

function copyFolder(sourcePath, destinationPath) {
	try {
		ensureExists(destinationPath);

		const files = fs.readdirSync(sourcePath);

		files.forEach((file) => {
			const sourceFile = path.join(sourcePath, file);
			const destinationFile = path.join(destinationPath, file);

			if (fs.lstatSync(sourceFile).isFile()) {
				fs.copyFileSync(sourceFile, destinationFile);
			} else {
				copyFolder(sourceFile, destinationFile);
			}
		});
	} catch (error) {
		console.error("Error copying folder: " + error);
	}
}

function deleteFolderRecursive(folderPath) {
	if (fs.existsSync(folderPath)) {
		fs.readdirSync(folderPath).forEach((file) => {
			const curPath = folderPath + "/" + file;

			if (fs.lstatSync(curPath).isDirectory()) {
				deleteFolderRecursive(curPath);
			} else {
				fs.unlinkSync(curPath);
			}
		});

		fs.rmdirSync(folderPath);
	} else {
		console.log("Folder does not exist.");
	}
}

/**
 * Safely delete a file with retries to handle locked files
 * @param {string} filePath - Path to the file to delete
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} delay - Delay between retries in ms
 * @returns {Promise<void>}
 */
async function safeDeleteFile(filePath, maxRetries = 5, delay = 1000) {
	if (!fs.existsSync(filePath)) {
		return;
	}

	let lastError;
	for (let i = 0; i < maxRetries; i++) {
		try {
			fs.unlinkSync(filePath);
			console.log(`Successfully deleted file: ${filePath}`);
			return;
		} catch (error) {
			console.warn(`Delete attempt ${i+1}/${maxRetries} failed: ${error.message}`);
			lastError = error;
			
			// Wait before next attempt
			await new Promise(resolve => setTimeout(resolve, delay));
		}
	}
	
	// If all attempts fail, throw the last error
	throw new Error(`Failed to delete ${filePath} after ${maxRetries} attempts: ${lastError.message}`);
}

function ensureExists(path, mask) {
	if (typeof mask != "number") {
		mask = 0o777;
	}
	try {
		fs.mkdirSync(path, {
			mode: mask,
			recursive: true,
		});
		return;
	} catch (ex) {
		return {
			err: ex,
		};
	}
}

// Handle sheet list updates from editor
ipcMain.on('update-sheet-list', (event, { index, data }) => {
    try {
        // Update the sheet list in memory
        const listSheet = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'listSheet.json'), 'utf8'));
        listSheet[index] = data;
        fs.writeFileSync(path.join(__dirname, 'data', 'listSheet.json'), JSON.stringify(listSheet, null, 4));

        // Notify the main window to update its display
        if (global.mainWindow && !global.mainWindow.isDestroyed()) {
            global.mainWindow.webContents.send('sheet-list-updated', { index, data });
        }
    } catch (error) {
        console.error('Error updating sheet list:', error);
    }
});

// Handle keymap updates from editor
ipcMain.on('keymap-updated', (event, { index }) => {
    try {
        // Notify the main window to update its keymap data
        if (global.mainWindow && !global.mainWindow.isDestroyed()) {
            global.mainWindow.webContents.send('keymap-updated', { index });
        }
    } catch (error) {
        console.error('Error handling keymap update:', error);
    }
});