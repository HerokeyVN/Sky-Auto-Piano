/**
 * Sky Auto Piano - Main Process
 * This is the main Electron process that handles application lifecycle,
 * window management, updates, and auto-play functionality.
 */

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
		autoSave: false,
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
	},
	update: {
		blockUpdate: false,
	},
	appTheme: "light",
};

let config;
try {
	if (!fs.existsSync(dirSetting)) {
		fs.writeFileSync(dirSetting, JSON.stringify(defaultConfig, null, 4));
		config = defaultConfig;
	} else {
		config = JSON.parse(fs.readFileSync(dirSetting));
		let updated = false;
		if (config.appTheme === undefined) {
			config.appTheme = defaultConfig.appTheme;
			updated = true;
		}
		if (config.panel === undefined) {
			config.panel = defaultConfig.panel;
			updated = true;
		} else if (config.panel.minimizeOnPlay === undefined) {
			config.panel.minimizeOnPlay = defaultConfig.panel.minimizeOnPlay;
			updated = true;
		}
		if (config.update === undefined) {
			config.update = defaultConfig.update;
			updated = true;
		} else if (config.update.blockUpdate === undefined) {
			config.update.blockUpdate = defaultConfig.update.blockUpdate;
			updated = true;
		}

		if (updated) {
			fs.writeFileSync(dirSetting, JSON.stringify(config, null, 4));
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

var devMode = false;
var longPressMode = defaultConfig.panel.longPressMode;
var speed = defaultConfig.panel.speed;
var delayNext = defaultConfig.panel.delayNext;

if (config.panel.autoSave) {
	longPressMode = config.panel.longPressMode;
	speed = config.panel.speed;
	delayNext = config.panel.delayNext;
}

// -------------------------------------
// APPLICATION INITIALIZATION
// -------------------------------------
if (!devMode) Menu.setApplicationMenu(Menu.buildFromTemplate([]));
app.setAppUserModelId("Sky Auto Piano");
app.setName("Sky Auto Piano");

(async () => {
	if (config.update?.blockUpdate === true) {
		console.log("Update: Update checking is blocked by user setting.");
		return;
	}

	console.log("Update:", "Checking update...");
	let pkgLocal = JSON.parse(
		fs.readFileSync(path.join(__dirname, "package.json"))
	);
	let vern = pkgLocal.version;
	try {
		var pkgUpdate = (await axios.get(packageUpdate)).data;
		var verg = pkgUpdate.version;
	} catch (e) {
		console.error("Update:", e, "Failed to connect to to the server!");
		return;
	}

	if (fs.existsSync(path.join(__dirname, "update"))) {
		deleteFolderRecursive(path.join(__dirname, "update"));
	}

	if (vern != verg) {
		console.warn(
			"Update:",
			"The new update has been discovered. Proceed to download the imported version..."
		);
		let pathFile = path.join(__dirname, "update");
		try {
			if (pkgUpdate.module_version != pkgLocal.module_version) {
				console.log("Update:", "Start downloading support module...");
				await downloadUpdate(__dirname, "node_modules.zip");
			}
			// Download the software core
			console.log("Update:", "Start downloading the software core...");
			await downloadUpdate(pathFile, "update.zip");
			console.log("Update:", "Download the update completed!");
		} catch (error) {
			console.error(
				"Update:",
				"Error generation during the download process: " + error
			);
			return;
		}

		// Extract the support module
		if (pkgUpdate.module_version != pkgLocal.module_version) {
			console.log("Update:", "Start extracting the support module...");
			try {
				await extractZip(path.join(__dirname, "node_modules.zip"), __dirname);
				fs.unlinkSync(path.join(__dirname, "node_modules.zip"));
				console.log("Update:", "Complete the support module update...");
			} catch (error) {
				fs.unlinkSync(path.join(__dirname, "node_modules.zip"));
				console.error("Update:", error);
				return;
			}
		}

		// Extract the software core
		console.log("Update:", "Start extracting the software core...");
		try {
			await extractZip(path.join(pathFile, "update.zip"), pathFile);
			fs.unlinkSync(path.join(pathFile, "update.zip"));
			console.log("Update:", "Extraction the software core completed!");
		} catch (error) {
			fs.unlinkSync(path.join(pathFile, "update.zip"));
			console.error("Update:", error);
			return;
		}

		let except = ["data"]; // The folders will be ignored when updated

		let listFile = fs.readdirSync(path.join(pathFile, folderUpdate));
		for (let i of listFile)
			if (except.indexOf(i) == -1) {
				if (!fs.lstatSync(path.join(pathFile, folderUpdate, i)).isFile())
					copyFolder(
						path.join(pathFile, folderUpdate, i),
						path.join(pathFile, "..", i)
					);
				else
					fs.renameSync(
						path.join(pathFile, folderUpdate, i),
						path.join(pathFile, "..", i)
					);
			}
		deleteFolderRecursive(path.join(pathFile, folderUpdate));
		console.log("Update:", "Complete update. Restart to apply update.");

		updatedNoti = {
			title: "Update",
			body: "Complete update! Please restart the application to apply updates.",
			icon: path.join(__dirname, "icon", "Icon9.ico"),
		};
		try {
			new Notification(updatedNoti).show();
			updatedNoti = undefined;
		} catch (_) { }
	} else console.log("Update:", "Awesome, you're on the latest version!");
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

	win.loadFile(path.join(__dirname, "index", "index.html"));

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
function winLog(win, msg) {
	if (typeof msg == "object") msg = JSON.stringify(msg);
	msg += "";
	win.webContents.send("winLog", msg);
}

async function downloadUpdate(pathFile, nameFile) {
	let url = linkUpdate;

	ensureExists(pathFile);

	try {
		const response = await axios({
			url,
			method: "GET",
			responseType: "stream",
		});

		const writer = fs.createWriteStream(path.join(pathFile, nameFile));

		response.data.pipe(writer);

		return new Promise((resolve, reject) => {
			writer.on("finish", resolve);
			writer.on("error", reject);
		});
	} catch (error) {
		console.error("Update", "Error downloading file: " + error);
		process.exit(504);
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

ipcMain.on("changeSetting", () => {
	config = JSON.parse(fs.readFileSync(dirSetting));
});

// -------------------------------------
// UPDATE CHECK HANDLER
// -------------------------------------
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

// Handle update request from renderer
ipcMain.on("start-update", async (event) => {
	try {
		console.log("Update:", "Starting update process...");
		
		// Create update directory if it doesn't exist
		const updateDir = path.join(__dirname, "update");
		if (fs.existsSync(updateDir)) {
			deleteFolderRecursive(updateDir);
		}
		ensureExists(updateDir);

		// Download the update
		console.log("Update:", "Downloading update...");
		await downloadUpdate(updateDir, "update.zip");
		
		// Extract the update
		console.log("Update:", "Extracting update...");
		await extractZip(path.join(updateDir, "update.zip"), updateDir);
		fs.unlinkSync(path.join(updateDir, "update.zip"));

		// Copy files to main directory
		console.log("Update:", "Installing update...");
		const except = ["data"]; // Folders to ignore during update
		const listFile = fs.readdirSync(path.join(updateDir, folderUpdate));
		
		for (let file of listFile) {
			if (except.indexOf(file) === -1) {
				const sourcePath = path.join(updateDir, folderUpdate, file);
				const targetPath = path.join(__dirname, file);
				
				if (!fs.lstatSync(sourcePath).isFile()) {
					copyFolder(sourcePath, targetPath);
				} else {
					fs.copyFileSync(sourcePath, targetPath);
				}
			}
		}

		// Clean up
		deleteFolderRecursive(path.join(updateDir, folderUpdate));
		console.log("Update:", "Update completed successfully!");

		// Notify user and restart
		const notification = new Notification({
			title: "Update Complete",
			body: "The update has been installed. The application will now restart.",
			icon: path.join(__dirname, "icon", "Icon9.ico"),
		});

		notification.on("click", () => {
			app.relaunch();
			app.quit();
		});

		notification.show();
		
		// Send success message to renderer
		event.reply("update-status", { success: true });
	} catch (error) {
		console.error("Update:", "Error during update process:", error);
		event.reply("update-status", { 
			success: false, 
			error: "Failed to complete update. Please try again later." 
		});
	}
});
