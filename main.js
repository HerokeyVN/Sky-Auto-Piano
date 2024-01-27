// ES6 module import
import { app, BrowserWindow, globalShortcut, Menu, ipcMain } from 'electron/main';
import fs from "fs";
import axios from 'axios';
import path from 'node:path';
import { Hardware } from "keysender";
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const keys = ["y", "u", "i", "o", "p",
              "h", "j", "k", "l", ";",
              "n", "m", ",", ".", "/"];
// Update info
const linkUpdate = "https://github.com/HerokeyVN/Sky-Auto-Piano/archive/refs/heads/main.zip";
const moduleUpdate = "https://raw.githubusercontent.com/HerokeyVN/Temp/main/mdl_SAM/node_modules.zip";
const packageUpdate = "https://raw.githubusercontent.com/HerokeyVN/Sky-Auto-Piano/main/package.json";
const folderUpdate = "Sky-Auto-Piano-main";
// Global value
var isPlay = false;
var curPlay = '';
// Setting
var longPressMode = false;
var speed = 1;

Menu.setApplicationMenu(Menu.buildFromTemplate([]));

// Function update
(async ()=>{
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
			if (pkgUpdate.module_version != pkgUpdate.module_version) {
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
		fs.unlinkSync(path.join(pathFile, folderUpdate));
		console.log("Update:", "Complete update. Restart to apply update.");

	} else console.log("Update:", "Awesome, you're on the latest version!");
})()

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



  ipcMain.on("play", (event, data) => {
    isPlay = data.isPlay;
    isPlay ? win.minimize() : '';
    console.log(isPlay);
    !isPlay ? win.webContents.send("stop"):'';
    if (!isPlay) return;
    curPlay = data.lockTime;
    let mapDelay = Object.keys(data.keys);
    autoPlay(data.keys);
    sendTimeProcess(Number(mapDelay[mapDelay.length - 1]), data.sec);
  })

  ipcMain.on("longPressMode", (event, data) => {
    longPressMode = data;
  })

  ipcMain.on("changeSpeed", (event, data) => {
    speed = Number(data);
  })

  async function sendTimeProcess(total, sec) {
    let lockTime = curPlay+'';
    for (let i = sec; i <= Math.trunc(total / (1000)); i++) {
      await new Promise((rev) => setTimeout(rev, Math.trunc(1000/speed)));
      if (!isPlay || lockTime != curPlay) return;
      win.webContents.send("process-bar", i);
    }
  }

  globalShortcut.register('Shift+C', () => {
    win.webContents.send("btn-prev");
  })
  globalShortcut.register('Shift+V', () => {
    win.webContents.send("btn-play");
  })
  globalShortcut.register('Shift+B', () => {
    win.webContents.send("btn-next");
  })

  async function autoPlay(keyMap) {
    let ks = (new Hardware("Sky")).keyboard;
    let objKey = Object.keys(keyMap);
    let lockTime = curPlay+'';

    for (let i = 1; i < objKey.length; i++) {
      let delay = objKey[i] - objKey[i - 1];

      if (!isPlay || lockTime != curPlay) return isPlay = false;
      console.log(keyMap[objKey[i - 1]], lockTime);
      for (let j of keyMap[objKey[i - 1]]) ks.sendKeys(j, longPressMode ? (delay>=35 ? delay : undefined):undefined);

      console.log(speed)
      await new Promise((rev) => setTimeout(rev, Math.trunc(delay/speed)));
    }
    //if (!isPlay) return;
    console.log(keyMap[objKey[objKey.length - 1]]);
    for (let j of keyMap[objKey[objKey.length - 1]]) ks.sendKeys(j);
    isPlay = false;
    win.webContents.send("stop-player");
  }
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