// ES6 module import
import { app, BrowserWindow, globalShortcut, Menu, ipcMain, Notification } from 'electron/main';
import fs from "fs";
import axios from 'axios';
import path from 'node:path';
import { Hardware } from "keysender";
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
	app.quit();
	process.exit();
}

// Update info
const linkUpdate = "https://github.com/HerokeyVN/Sky-Auto-Piano/archive/refs/heads/main.zip";
const moduleUpdate = "https://raw.githubusercontent.com/HerokeyVN/Temp/main/mdl_SAM/node_modules.zip";
const packageUpdate = "https://raw.githubusercontent.com/HerokeyVN/Sky-Auto-Piano/main/package.json";
const folderUpdate = "Sky-Auto-Piano-main";
// Global value
var isPlay = false;
var curPlay = '';
var updatedNoti = undefined;
// Setting
const dirSetting = path.join(__dirname, "config", "config.json");
ensureExists(path.join(__dirname, "config"));
if (!fs.existsSync(dirSetting)) fs.writeFileSync(dirSetting, JSON.stringify({
	panel: {
		longPressMode: false,
		speed: 1,
		delayNext: 1,
		autoSave: true
	},
	keyboard: {
		customKeyboard: false,
		keys: ["y", "u", "i", "o", "p",
			   "h", "j", "k", "l", ";",
			   "n", "m", ",", ".", "/"]
	},
	shortcut: {
		pre: "Ctrl+Shift+C",
		play: "Ctrl+Shift+V",
		next: "Ctrl+Shift+B"
	}
}, null, 4));
var config = JSON.parse(fs.readFileSync(dirSetting));

var devMode = false;
var longPressMode = config.autoSave ? config.longPressMode:false;
var speed = config.autoSave ? config.speed:1;
var delayNext = config.autoSave ? config.delayNext:1;

if (!devMode) Menu.setApplicationMenu(Menu.buildFromTemplate([]));
app.setAppUserModelId("Sky Auto Piano");
app.setName("Sky Auto Piano");

// Function update

(async () => {
	console.log("Update:", "Checking update...");
	let pkgLocal = (JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"))));
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
		console.warn("Update:", "The new update has been discovered. Proceed to download the imported version...");
		let pathFile = path.join(__dirname, "update");
		try {
			// Download support module
			if (pkgUpdate.module_version != pkgLocal.module_version) {
				console.log("Update:", 'Start downloading support module...');
				await downloadUpdate(__dirname, "node_modules.zip");
			}
			// Download the software core
			console.log("Update:", 'Start downloading the software core...');
			await downloadUpdate(pathFile, "update.zip");
			console.log("Update:", 'Download the update completed!');
		} catch (error) {
			console.error("Update:", 'Error generation during the download process: ' + error);
			return;
		}

		// Extract the support module
		if (pkgUpdate.module_version != pkgLocal.module_version) {
			console.log("Update:", 'Start extracting the support module...');
			try {
				await extractZip(path.join(__dirname, "node_modules.zip"), __dirname);
				fs.unlinkSync(path.join(__dirname, "node_modules.zip"));
				console.log("Update:", 'Complete the support module update...');
			} catch (error) {
				fs.unlinkSync(path.join(__dirname, "node_modules.zip"));
				console.error("Update:", error);
				return;
			}
		}

		// Extract the software core
		console.log("Update:", 'Start extracting the software core...');
		try {
			await extractZip(path.join(pathFile, "update.zip"), pathFile);
			fs.unlinkSync(path.join(pathFile, "update.zip"));
			console.log("Update:", 'Extraction the software core completed!');
		} catch (error) {
			fs.unlinkSync(path.join(pathFile, "update.zip"));
			console.error("Update:", error);
			return;
		}

		let except = ["data"]; // The folders will be ignored when updated

		let listFile = fs.readdirSync(path.join(pathFile, folderUpdate));
		// delete require.cache[require.resolve("./core/util/log.js")];
		// delete require.cache[require.resolve("./core/util/scanDir.js")]
		for (let i of listFile)
			if (except.indexOf(i) == -1) {
				if (!fs.lstatSync(path.join(pathFile, folderUpdate, i)).isFile()) copyFolder(path.join(pathFile, folderUpdate, i), path.join(pathFile, "..", i));
				else fs.renameSync(path.join(pathFile, folderUpdate, i), path.join(pathFile, "..", i));
			}
		deleteFolderRecursive(path.join(pathFile, folderUpdate));
		console.log("Update:", "Complete update. Restart to apply update.");

		updatedNoti = {
			title: "Update",
			body: "Complete update! Please restart the application to apply updates.",
			icon: path.join(__dirname, 'icon', 'Icon9.ico')
		}
		try {
			new Notification(updatedNoti).show();
			updatedNoti = undefined;
		} catch (_) {};

	} else console.log("Update:", "Awesome, you're on the latest version!");
})();

function createWindow() {
	const win = new BrowserWindow({
		width: 750,
		minWidth: 700,
		height: 600,
		minHeight: 200,
		backgroundColor: "#0a1930",
		// transparent: true,
		// frame: false,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false
		}
	})

	win.loadFile(path.join(__dirname, 'index', 'index.html'));

	// Send noti went update done
	if (updatedNoti) {
		let notification = new Notification(updatedNoti);
		notification.on('click', (event, arg) => {
			app.relaunch();
            app.quit();
		});
		notification.show();
	}

	// Processing the Play button event
	ipcMain.on("play", (event, data) => {
		isPlay = data.isPlay;
		isPlay ? win.minimize() : '';
		console.log(isPlay);
		!isPlay ? win.webContents.send("stop") : '';
		if (!isPlay) return;
		curPlay = data.lockTime;
		let mapDelay = Object.keys(data.keys);
		autoPlay(data.keys);
		sendTimeProcess(Number(mapDelay[mapDelay.length - 1]), data.sec);
	})

	// Handling the event of the LongpressMode button
	ipcMain.on("longPressMode", (event, data) => {
		longPressMode = data; config.panel.longPressMode = longPressMode;
		fs.writeFileSync(dirSetting, JSON.stringify(config, null, 4));
	})

	// Processing speed changes
	ipcMain.on("changeSpeed", (event, data) => {
		speed = Number(data); config.panel.speed = speed;
		fs.writeFileSync(dirSetting, JSON.stringify(config, null, 4));
	})

	// Processing delay next changes
	ipcMain.on("changeDelayNext", (event, data) => {
		delayNext = Number(data); config.panel.delayNext = delayNext;
		fs.writeFileSync(dirSetting, JSON.stringify(config, null, 4));
	})

	// Send time data to front-end
	async function sendTimeProcess(total, sec) {
		let lockTime = curPlay + '';
		for (let i = sec; i <= Math.trunc(total / (1000)); i++) {
			await new Promise((rev) => setTimeout(rev, Math.trunc(1000 / speed)));
			if (!isPlay || lockTime != curPlay) return;
			win.webContents.send("process-bar", i);
		}
	}

	// Processing the shortcut event
	globalShortcut.register(config.shortcut.pre, () => {
		win.webContents.send("btn-prev");
	})
	globalShortcut.register(config.shortcut.play, () => {
		win.webContents.send("btn-play");
	})
	globalShortcut.register(config.shortcut.next, () => {
		win.webContents.send("btn-next");
	})

	// The main program automatically plays music (send pressing keys)
	async function autoPlay(keyMap) {
		let keysID = {"y": 0, "u": 1, "i": 2, "o": 3, "p": 4,
					  "h": 5, "j": 6, "k": 7, "l": 8, ";": 9,
					  "n": 10, "m": 11, ",": 12, ".": 13, "/": 14};
		let ks = (new Hardware("Sky")).keyboard;
		let objKey = Object.keys(keyMap);
		let lockTime = curPlay + ''; // The variable to determine whether the user will transfer the song while another song is running or not

		for (let i = 1; i < objKey.length; i++) {
			let delay = objKey[i] - objKey[i - 1];

			if (!isPlay || lockTime != curPlay) return isPlay = false;
			console.log(keyMap[objKey[i - 1]], lockTime);
			for (let key of keyMap[objKey[i - 1]]) {
				if (config.keyboard.customKeyboard) key = config.keyboard.keys[keysID[key]];
				ks.sendKeys(key, longPressMode ? Math.trunc(delay / speed) - 35 : undefined);
			}

			await new Promise((rev) => setTimeout(rev, Math.trunc(delay / speed)));
		}
		//if (!isPlay) return;
		//console.log(keyMap[objKey[objKey.length - 1]]);
		
		for (let key of keyMap[objKey[objKey.length - 1]]) {
			if (config.keyboard.customKeyboard) key = config.keyboard.keys[keysID[key]];
			ks.sendKeys(key, longPressMode ? 500 - 35 : undefined);
		}
		isPlay = false;
		win.webContents.send("stop-player");
	}

	// Function of processing events creating installation windows
	ipcMain.on("openSetting", ()=>{
		global.winMain = win;
		createWindowSetting();
	});

	app.on("second-instance", ()=>{
		if (win) {
			if (win.isMinimized()) win.restore();
			win.focus();
		}
	})

	win.once("closed", ()=>{
		app.quit();
	})
}

function createWindowSetting() {
	if (global.isOpenSetting) return;
	const win = new BrowserWindow({
		width: 750,
		height: 600,
		resizable: false,
		backgroundColor: "#0a1930",
		parent: global.winMain,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false
		}
	})

	globalShortcut.unregisterAll();

	win.loadFile(path.join(__dirname, 'index', 'setting.html'));
	global.isOpenSetting = true;

	win.once("closed", ()=>{
		global.isOpenSetting = false;
		globalShortcut.register(config.shortcut.pre, () => {
			global.winMain.webContents.send("btn-prev");
		})
		globalShortcut.register(config.shortcut.play, () => {
			global.winMain.webContents.send("btn-play");
		})
		globalShortcut.register(config.shortcut.next, () => {
			global.winMain.webContents.send("btn-next");
		})
	})
}

app.whenReady().then(() => {
	createWindow()

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow()
		}
	})
})

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit()
	}
})

// Support function

async function downloadUpdate(pathFile, nameFile) {
	let url = linkUpdate;

	ensureExists(pathFile);

	try {
		const response = await axios({
			url,
			method: 'GET',
			responseType: 'stream'
		});

		const writer = fs.createWriteStream(path.join(pathFile, nameFile));

		response.data.pipe(writer);

		return new Promise((resolve, reject) => {
			writer.on('finish', resolve);
			writer.on('error', reject);
		});
	} catch (error) {
		console.error("Update", 'Error downloading file: ' + error);
		process.exit(504);
	}
}

function extractZip(filePath, destinationPath) {
	return new Promise((resolve, reject) => {
		const zip = new AdmZip(filePath);
		zip.extractAllToAsync(destinationPath, true, (error) => {
			if (error) {
				console.error('Error extracting zip file:', error);
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
		console.error('Error copying folder: ' + error);
	}
}

function deleteFolderRecursive(folderPath) {
	if (fs.existsSync(folderPath)) {
		fs.readdirSync(folderPath).forEach((file) => {
			const curPath = folderPath + '/' + file;

			if (fs.lstatSync(curPath).isDirectory()) {
				deleteFolderRecursive(curPath);
			} else {
				fs.unlinkSync(curPath);
			}
		});

		fs.rmdirSync(folderPath);
	} else {
		console.log('Folder does not exist.');
	}
}

function ensureExists(path, mask) {
	if (typeof mask != 'number') {
		mask = 0o777;
	}
	try {
		fs.mkdirSync(path, {
			mode: mask,
			recursive: true
		});
		return;
	} catch (ex) {
		return {
			err: ex
		};
	}
}