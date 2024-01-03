import { app, BrowserWindow, ipcMain } from 'electron/main';
import fs from "fs";
import path from 'node:path';
import { Hardware } from "keysender";
import {fileURLToPath} from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const keys = ["y", "u", "i", "o", "p",
              "h", "j", "k", "l", ";",
              "n", "m", ",", ".", "/"];

function createWindow () {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
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
    var keyMap = JSON.parse(fs.readFileSync(path.join(__dirname, "data", data), { encoding: "utf8" }));
    autoPlay(keyMap);
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

async function autoPlay(keyMap){
  let ks = (new Hardware("Sky")).keyboard;
  let objKey = Object.keys(keyMap);
  await new Promise((rev)=>setTimeout(rev, 3.5*1000));

  for (let i=1; i < objKey.length; i++) {
      let delay = objKey[i] - objKey[i-1];

      console.log(keyMap[objKey[i-1]]);
    for (let j of keyMap[objKey[i-1]]) ks.sendKeys(j);

      await new Promise((rev)=>setTimeout(rev, delay));
  }
  console.log(keyMap[objKey[objKey.length-1]]);
  for (let j of keyMap[objKey[objKey.length-1]]) ks.sendKeys(j);
}