import { app, BrowserWindow, globalShortcut, Menu, ipcMain } from 'electron/main';
import fs from "fs";
import path from 'node:path';
import { Hardware } from "keysender";
import { fileURLToPath } from 'url';
import { moveMessagePortToContext } from 'worker_threads';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const keys = ["y", "u", "i", "o", "p",
  "h", "j", "k", "l", ";",
  "n", "m", ",", ".", "/"];
var isPlay = false;
var interval;

Menu.setApplicationMenu(Menu.buildFromTemplate([]))

function createWindow() {
  const win = new BrowserWindow({
    width: 750,
    minWidth: 650,
    height: 600,
    minHeight: 185,
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
    //var keyMap = JSON.parse(fs.readFileSync(path.join(__dirname, "data", data), { encoding: "utf8" }));

    isPlay = !isPlay ? true : false;
    isPlay ? win.minimize() : "";
    let mapDelay = Object.keys(data.keys);
    autoPlay(data.keys);
    sendTimeProcess(Number(mapDelay[mapDelay.length - 1]), data.sec);
  })

  async function sendTimeProcess(total, sec) {
    for (let i = sec; i <= Math.trunc(total / (1000)); i++) {
      await new Promise((rev) => setTimeout(rev, 1 * 1000));
      if (!isPlay) return;
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
    //await new Promise((rev) => setTimeout(rev, 0.5 * 1000));

    for (let i = 1; i < objKey.length; i++) {
      let delay = objKey[i] - objKey[i - 1];

      if (!isPlay) return isPlay = false;;
      console.log(keyMap[objKey[i - 1]]);
      for (let j of keyMap[objKey[i - 1]]) ks.sendKeys(j);

      await new Promise((rev) => setTimeout(rev, delay));
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

