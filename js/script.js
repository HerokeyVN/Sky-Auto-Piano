/**
 * Sky Auto Piano - Renderer Process
 * This script handles the user interface interactions, sheet management,
 * and communication with the main process for auto-play functionality.
 */

// -------------------------------------
// IMPORTS AND SETUP
// -------------------------------------
const { ipcRenderer, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { Base64 } = require("js-base64");
const marked = require("marked");

// -------------------------------------
// CONFIGURATION AND CONSTANTS
// -------------------------------------
// Load application configuration
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "config", "config.json"))
);

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

// Piano key mapping (corresponds to the in-game keyboard layout)
const keys = [
  "y", "u", "i", "o", "p",
  "h", "j", "k", "l", ";",
  "n", "m", ",", ".", "/"
];


// -------------------------------------
// DATA INITIALIZATION
// -------------------------------------
// Ensure data directory exists
ensureExists(path.join(__dirname, "..", "data"));

// Load sheet music list
let listSheet = [];
try {
  listSheet = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "data", "listSheet.json"), {
      encoding: "utf8",
    })
  );
} catch (_) {
  fs.writeFileSync(
    path.join(__dirname, "..", "data", "listSheet.json"),
    JSON.stringify([], null, 4),
    { mode: 0o666 }
  );
}

// Application state variables
let listKeys = [];  // Cached key maps for sheets
let playing = 0;    // Current playing sheet index
let isPlay = false; // Playback state
let maxPCB = 0;     // Maximum process bar value
let loopMode = 0;   // Loop mode (0: off, 1: playlist, 2: single)

// -------------------------------------
// UI INITIALIZATION
// -------------------------------------
// Initialize UI on document load
document.addEventListener("DOMContentLoaded", () => {
  // Theme management
  const themeToggleButtonLight = document.getElementById("btn-lightmode");
  const themeToggleButtonDark = document.getElementById("btn-darkmode");
  const body = document.body;

  const lightModeBgColor = "#0a1930";
  const darkModeBgColor = "#1B1D1E";

  // Apply theme to UI
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

  // Toggle between light and dark themes
  const toggleTheme = () => {
    const isDarkMode = body.classList.contains("dark-mode");
    const newTheme = isDarkMode ? "light" : "dark";
    localStorage.setItem("theme", newTheme);
    applyTheme(newTheme);
  };

  // Set up theme toggle buttons
  if (themeToggleButtonLight) {
    themeToggleButtonLight.addEventListener("click", toggleTheme);
  }
  if (themeToggleButtonDark) {
    themeToggleButtonDark.addEventListener("click", toggleTheme);
  }

  // Apply saved theme or default
  const savedTheme = localStorage.getItem("theme");
  const initialTheme = savedTheme ? savedTheme : "light";
  applyTheme(initialTheme);
});

// -------------------------------------
// UI SETUP
// -------------------------------------
// Initialize shortcut display
document.getElementById("shortcut-pre").innerHTML = config.shortcut.pre;
document.getElementById("shortcut-play").innerHTML = config.shortcut.play;
document.getElementById("shortcut-next").innerHTML = config.shortcut.next;

// Apply saved panel settings
if (config.panel.autoSave) {
  document.getElementById("speed-btn").value = config.panel.speed;
  document.getElementById("switch").checked = config.panel.longPressMode;
  document.getElementById("delay-loop").value = config.panel.delayNext;
  document.getElementById("delay-next-value").innerHTML = `Delay next: ${config.panel.delayNext}s`;
} else {
  // Load speed from config even if autoSave is off
  document.getElementById("speed-btn").value = config.panel.speed;
}

// Load and display sheet list
printSheet();

// Configure search functionality
const searchBar = document.getElementById("search-bar");
const contentContainer = document.querySelector(".content");

if (searchBar && contentContainer) {
  searchBar.addEventListener("input", () => {
    const searchTerm = searchBar.value.toLowerCase().trim();
    const cards = contentContainer.querySelectorAll(".card");

    cards.forEach((card, index) => {
      if (index < listSheet.length) {
        const sheetData = listSheet[index];
        const sheetName = sheetData.name.toLowerCase();
        const authorName = (sheetData.author || "").toLowerCase();

        const isMatch =
          sheetName.includes(searchTerm) || authorName.includes(searchTerm);

        card.style.display = isMatch ? "" : "none";
      } else {
        card.style.display = "none";
      }
    });
  });
} else {
  console.error("Search bar or content container element not found!");
}

// Load the first sheet if available
if (listSheet.length > 0) {
  if (!listKeys[0]) {
    listKeys[0] = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "..", "data", listSheet[0].keyMap),
        { encoding: "utf8" }
      )
    );
  }
  updateFooter({ ...listSheet[0], keys: listKeys[0] }, 0);
}

// -------------------------------------
// SHEET MANAGEMENT
// -------------------------------------
// Add sheet event handler
document
  .getElementsByClassName("btn-add")[0]
  .addEventListener("change", (event) => {
    const { files } = event.target;

    let done = 0;
    for (let file of files) {
      // Detect file encoding
      let typeDetect = fs.readFileSync(file.path, { encoding: "utf8" })[0] != "[" ? "utf16le" : "utf8";
      let text = decUTF16toUTF8(
        fs.readFileSync(file.path, { encoding: typeDetect })
      );

      // Parse sheet file
      let json;
      try {
        if (text[0] != "[") throw new Error();
        json = eval(text)[0];
      } catch (_) {
        if (files.length == 1) {
          notie.alert({
            type: 3,
            text: "File Sheet is not in the format. Please check again!"
          });
        }
        continue;
      }

      // Process and encode sheet
      let res;
      try {
        res = encSheet(json);
      } catch (err) {
        console.error(err);
        if (files.length == 1) {
          notie.alert({
            type: 3,
            text: "File Sheet is not in the format. Please check again!",
          });
        }
        continue;
      }
      
      if (!res) {
        done++;
        continue;
      }
      
      if (files.length == 1) {
        notie.alert({
          type: 3,
          text: res.msg,
        });
      }
    }
    
    printSheet();

    // Show import results notification
    if (files.length > 1)
      notie.alert({
        type: done > 0 ? 1 : 3,
        text: `Complete import! Success: ${done}. Error: ${files.length - done}`,
      });
    else if (done > 0)
      notie.alert({
        type: 1,
        text: `Complete import!`,
      });
  });

/**
 * Encodes sheet music data and saves it to a file
 * @param {Object} json - Sheet music data in JSON format
 * @returns {Object|undefined} Error object or undefined on success
 */
function encSheet(json) {
  // Check if sheet is already encrypted
  if (json.isEncrypted)
    return {
      errCode: 1,
      msg: "Sheet has been encrypted!",
    };
  
  // Validate sheet format
  if (!json.songNotes)
    return {
      errCode: 2,
      msg: "The sheet file is not valid, please try again with another file!",
    };
  
  if (typeof json.songNotes[0] != "object")
    return {
      errCode: 1,
      msg: "Sheet has been encrypted!",
    };
  
  // Create encoded keymap
  let tempEnc = {};
  let fileName = Base64.encode(random(1, 9999) + (json.name + "").replace(/[^a-zA-Z0-9]/g, "-")) + ".json";
  
  // Convert song notes to keymap format
  for (let j in json.songNotes) {
    let i = json.songNotes[j];
    !tempEnc[i.time] ? (tempEnc[i.time] = []) : "";
    tempEnc[i.time].push(keys[parseInt(i.key.split("Key")[1])]);
  }

  let temp = Object.keys(tempEnc);
  // Add end marker
  tempEnc[(Math.trunc(Number(temp[temp.length - 1]) / 1000) + 1) * 1000] = [];

  // Save keymap file
  fs.writeFileSync(
    path.join(__dirname, "..", "data", fileName),
    JSON.stringify(!tempEnc["0"] ? { 0: [], ...tempEnc } : tempEnc),
    { mode: 0o666 }
  );
  
  // Update sheet list
  listSheet.push({
    name: json.name,
    author: json.author,
    transcribedBy: json.transcribedBy,
    bpm: json.bpm,
    keyMap: fileName,
  });
  
  fs.writeFileSync(
    path.join(__dirname, "..", "data", "listSheet.json"),
    JSON.stringify(listSheet, null, 4),
    { mode: 0o666 }
  );
}

/**
 * Generates a random integer between min and max (inclusive)
 */
function random(min, max) {
  return Math.floor(Math.random() * (max - min + 2)) + min;
}

/**
 * Renders the sheet list in the UI
 */
function printSheet() {
  document.getElementsByClassName("content")[0].innerHTML = "";
  
  for (let i of listSheet) {
    document.getElementsByClassName("content")[0].innerHTML += `
        <div class="card">
        <div class="sheet-info">
            <h3 class="name-sheet">${i.name}</h3>
            <a class="author-sheet">Author: ${i.author}<br></a>
            <a class="tranScript-sheet">Transcript by: ${i.transcribedBy}<br></a>
            <a class="bpm-sheet">BPM: ${i.bpm}<br></a>
        </div>
        <div class="menu-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" fill="currentColor" class="bi bi-trash3" viewBox="0 0 16 16">
                <path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5M11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H2.506a.58.58 0 0 0-.01 0H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66h.538a.5.5 0 0 0 0-1h-.995a.59.59 0 0 0-.01 0zm1.958 1-.846 10.58a1 1 0 0 1-.997.92h-6.23a1 1 0 0 1-.997-.92L3.042 3.5zm-7.487 1a.5.5 0 0 1 .528.47l.5 8.5a.5.5 0 0 1-.998.06L5 5.03a.5.5 0 0 1 .47-.53Zm5.058 0a.5.5 0 0 1 .47.53l-.5 8.5a.5.5 0 1 1-.998-.06l.5-8.5a.5.5 0 0 1 .528-.47ZM8 4.5a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-1 0V5a.5.5 0 0 1 .5-.5" />
            </svg>
        </div>
    </div>`;
  }

  // Set up click handlers for each sheet
  for (let j in listSheet) {
    let i = listSheet[j];
    let btnPlay = document.getElementsByClassName("card");
    btnPlay[j].onclick = () => {
      try {
        if (!listKeys[j]) {
          listKeys[j] = JSON.parse(
            fs.readFileSync(path.join(__dirname, "..", "data", i.keyMap), {
              encoding: "utf8",
            })
          );
        }
      } catch (_) {}

      updateFooter({ ...listSheet[j], keys: listKeys[j] }, j);
    };

    // Set up delete handlers
    let btndel = document.getElementsByClassName("bi-trash3");
    btndel[j].onclick = () => {
      fs.unlinkSync(path.join(__dirname, "..", "data", listSheet[j].keyMap));
      listSheet.splice(j, 1);
      listKeys.splice(j, 1);
      fs.writeFileSync(
        path.join(__dirname, "..", "data", "listSheet.json"),
        JSON.stringify(listSheet, null, 4),
        { mode: 0o666 }
      );
      printSheet();
    };
  }
}

/**
 * Updates the footer area with sheet information
 * @param {Object} info - Sheet information
 * @param {number} id - Sheet index
 */
function updateFooter(info, id) {
  playing = id;
  let delayMap = Object.keys(info.keys);
  
  // Set up progress bar
  document.getElementsByClassName("process-bar")[0].max = Math.trunc(
    Number(delayMap[delayMap.length - 1]) / 1000
  );
  maxPCB = Math.trunc(Number(delayMap[delayMap.length - 1]) / 1000);
  
  // Update UI elements
  document.getElementsByClassName("name-playing")[0].innerHTML = info.name;
  document.getElementsByClassName("process-bar")[0].value = 0;
  document.getElementsByClassName("live-time")[0].innerHTML = `00:00`;

  // Calculate and display total time
  let totalMin = Math.trunc(
    Number(delayMap[delayMap.length - 1]) / (60 * 1000)
  );
  totalMin = totalMin < 10 ? "0" + totalMin : totalMin;
  
  let totalSec =
    Math.trunc(Number(delayMap[delayMap.length - 1]) / 1000) - totalMin * 60;
  totalSec = totalSec < 10 ? "0" + totalSec : totalSec;
  
  document.getElementsByClassName(
    "total-time"
  )[0].innerHTML = `${totalMin}:${totalSec}`;
}

// -------------------------------------
// PLAYBACK CONTROL
// -------------------------------------
/**
 * Navigate to the previous sheet
 */
function btnPrev() {
  if (playing - 1 < 0) playing = listSheet.length - 1;
  else playing--;
  
  // Load sheet if not already loaded
  if (!listKeys[playing]) {
    listKeys[playing] = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "..", "data", listSheet[playing].keyMap),
        { encoding: "utf8" }
      )
    );
  }
  
  updateFooter({ ...listSheet[playing], keys: listKeys[playing] }, playing);

  // Restart playback if playing
  if (isPlay) {
    btnPlay();
    document.getElementsByClassName("process-bar")[0].value = 0;
    document.getElementsByClassName("live-time")[0].innerHTML = `00:00`;
    let delay = document.getElementById("delay-loop").value;
    delay = delay == 0 ? 0.5 : delay;
    setTimeout(btnPlay, delay * 1000);
  }
}

// Set up event listeners for previous button
document.getElementById("btn-prev").addEventListener("click", btnPrev);
ipcRenderer.on("btn-prev", btnPrev);

/**
 * Navigate to the next sheet
 */
function btnNext() {
  if (playing + 1 >= listSheet.length) playing = 0;
  else playing++;
  
  // Load sheet if not already loaded
  if (!listKeys[playing]) {
    listKeys[playing] = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "..", "data", listSheet[playing].keyMap),
        { encoding: "utf8" }
      )
    );
  }
  
  updateFooter({ ...listSheet[playing], keys: listKeys[playing] }, playing);

  // Restart playback if playing
  if (isPlay) {
    btnPlay();
    document.getElementsByClassName("process-bar")[0].value = 0;
    document.getElementsByClassName("live-time")[0].innerHTML = `00:00`;
    let delay = document.getElementById("delay-loop").value;
    delay = delay == 0 ? 0.5 : delay;
    setTimeout(btnPlay, delay * 1000);
  }
}

// Set up event listeners for next button
document.getElementById("btn-next").addEventListener("click", btnNext);
ipcRenderer.on("btn-next", btnNext);

/**
 * Toggle playback state
 */
function btnPlay() {
  isPlay = !isPlay;
  
  // Prepare data to send to main process
  let send = {
    keys: sec2array(
      Number(document.getElementsByClassName("process-bar")[0].value),
      listKeys[playing]
    ),
    sec: Number(document.getElementsByClassName("process-bar")[0].value),
    lockTime: new Date().getTime() + "",
    isPlay,
  };
  
  // Send playback command to main process
  ipcRenderer.send("play", send);
  
  // Update UI
  document.getElementsByClassName("process-bar")[0].disabled = isPlay;
  document.getElementById("btn-play").innerHTML = isPlay
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pause-fill" viewBox="0 0 16 16">
    <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1.5-1.5"/>
    </svg>
    Pause (<a id="shortcut-play">${config.shortcut.play}</a>)`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" class="bi bi-play-fill" viewBox="0 0 16 16">
    <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/>
    </svg>
    Play (<a id="shortcut-play">${config.shortcut.play}</a>)`;
}

// Set up event listeners for play button
document.getElementById("btn-play").addEventListener("click", btnPlay);
ipcRenderer.on("btn-play", btnPlay);

// -------------------------------------
// IPC EVENT LISTENERS
// -------------------------------------
// Update progress bar from main process
ipcRenderer.on("process-bar", (event, data) => {
  document.getElementsByClassName("process-bar")[0].value = data;
  let s2m = sec2min(Number(data));
  let min = s2m.min < 10 ? "0" + s2m.min : s2m.min;
  let sec = s2m.sec < 10 ? "0" + s2m.sec : s2m.sec;
  document.getElementsByClassName("live-time")[0].innerHTML = `${min}:${sec}`;
});

// Handle speed change events
ipcRenderer.on("speed-changed", (event, newSpeed) => {
  document.getElementById("speed-btn").value = newSpeed;
});

// Handle playback completion
ipcRenderer.on("stop-player", (event, data) => {
  // Reset UI to initial state
  document.getElementById("btn-play").innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" heipkihght="20" fill="currentColor" class="bi bi-play-fill" viewBox="0 0 16 16">
    <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/>
    </svg>
    Play (<a id="shortcut-play">${config.shortcut.play}</a>)`;
  isPlay = false;
  document.getElementById("process-bar").disabled = false;
  document.getElementsByClassName("process-bar")[0].value = 0;
  document.getElementsByClassName("live-time")[0].innerHTML = "00:00";
  
  // Handle loop modes
  if (loopMode == 1) {
    // Next sheet loop
    btnNext();
    let delay = document.getElementById("delay-loop").value;
    delay = delay == 0 ? 0.5 : delay;
    setTimeout(btnPlay, delay * 1000);
    return;
  }
  if (loopMode == 2) {
    // Current sheet loop
    let delay = document.getElementById("delay-loop").value;
    delay = delay == 0 ? 0.5 : delay;
    setTimeout(btnPlay, delay * 1000);
    return;
  }
});

// Handle external stop command
ipcRenderer.on("stop", (event, data) => {
  document.getElementById("btn-play").innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" heipkihght="20" fill="currentColor" class="bi bi-play-fill" viewBox="0 0 16 16">
    <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/>
    </svg>
    Play (<a id="shortcut-play">${config.shortcut.play}</a>)`;
  isPlay = false;
  document.getElementById("process-bar").disabled = false;
});

// Process bar manual change handler
document.getElementById("process-bar").addEventListener("change", (data) => {
  document.getElementsByClassName("process-bar")[0].max = maxPCB;

  let s2m = sec2min(Number(data.target.value));
  let min = s2m.min < 10 ? "0" + s2m.min : s2m.min;
  let sec = s2m.sec < 10 ? "0" + s2m.sec : s2m.sec;
  document.getElementsByClassName("live-time")[0].innerHTML = `${min}:${sec}`;
});

// -------------------------------------
// SETTINGS HANDLERS
// -------------------------------------
// Long-press mode toggle
document
  .getElementsByClassName("long-press")[0]
  .addEventListener("click", (data) => {
    ipcRenderer.send("longPressMode", data.target.checked);
  });

// Loop mode button handler
document.getElementsByClassName("bi-loop")[0].addEventListener("click", () => {
  if (loopMode == 0) {
    // Enable playlist loop
    loopMode = 1;
    document.getElementsByClassName("bi-loop")[0].style =
      "box-shadow: inset 0 0 15px 0 rgba(256, 256, 256, 0.2), 0 0 15px 0 rgba(256, 256, 256, 0.4); border-radius: 5px; padding: 0 2px;";
  } else if (loopMode == 1) {
    // Enable single song loop
    loopMode = 2;
    document.getElementsByClassName(
      "bi-loop"
    )[0].innerHTML = `<path d="M11 4v1.466a.25.25 0 0 0 .41.192l2.36-1.966a.25.25 0 0 0 0-.384l-2.36-1.966a.25.25 0 0 0-.41.192V3H5a5 5 0 0 0-4.48 7.223.5.5 0 0 0 .896-.446A4 4 0 0 1 5 4zm4.48 1.777a.5.5 0 0 0-.896.446A4 4 0 0 1 11 12H5.001v-1.466a.25.25 0 0 0-.41-.192l-2.36 1.966a.25.25 0 0 0 0 .384l2.36 1.966a.25.25 0 0 0 .41-.192V13h6a5 5 0 0 0 4.48-7.223Z"/>
        <path d="M9 5.5a.5.5 0 0 0-.854-.354l-1.75 1.75a.5.5 0 1 0 .708.708L8 6.707V10.5a.5.5 0 0 0 1 0z"/>`;
  } else if (loopMode == 2) {
    // Disable looping
    loopMode = 0;
    document.getElementsByClassName("bi-loop")[0].style = "";
    document.getElementsByClassName(
      "bi-loop"
    )[0].innerHTML = `<path d="M11 5.466V4H5a4 4 0 0 0-3.584 5.777.5.5 0 1 1-.896.446A5 5 0 0 1 5 3h6V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192m3.81.086a.5.5 0 0 1 .67.225A5 5 0 0 1 11 13H5v1.466a.25.25 0 0 1-.41.192l-2.36-1.966a.25.25 0 0 1 0-.384l2.36-1.966a.25.25 0 0 1 .41.192V12h6a4 4 0 0 0 3.585-5.777.5.5 0 0 1 .225-.67Z"/>`;
  }
});

// Delay next setting handler
document.getElementById("delay-loop").addEventListener("change", (data) => {
  document.getElementById(
    "delay-next-value"
  ).innerHTML = `Delay next: ${data.target.value}s`;
  ipcRenderer.send("changeDelayNext",
    data.target.value == 0 ? 0.5 : data.target.value
  );
});

// Speed change handler
document.getElementById("speed-btn").addEventListener("change", (data) => {
  // Validate input
  if (Number(data.target.value) < Number(data.target.min))
    data.target.value = data.target.min;
  if (Number(data.target.value) > Number(data.target.max))
    data.target.value = data.target.max;
  
  // Round to one decimal place
  const roundedSpeed = Math.round(Number(data.target.value) * 10) / 10;
  data.target.value = roundedSpeed;
  
  ipcRenderer.send("changeSpeed", roundedSpeed);
});

// Settings button handler
document.getElementById("btn-setting").addEventListener("click", () => {
  notie.alert({
    type: 2,
    text: "When opening the settings, you will not be able to use shortcuts, please turn off the settings to use the shortcut!",
  });
  ipcRenderer.send("openSetting");
});

// Console log from main process
ipcRenderer.on("winLog", (event, msg) => {
  console.log("[main]", msg);
});

// -------------------------------------
// UTILITY FUNCTIONS
// -------------------------------------
/**
 * Convert seconds to minutes and seconds
 * @param {number} sec - Time in seconds
 * @returns {Object} Object with min and sec properties
 */
function sec2min(sec) {
  let res = {
    min: Math.trunc(sec / 60),
    sec: sec - Math.trunc(sec / 60) * 60,
  };
  return res;
}

/**
 * Get subset of array from a specific time point
 * @param {number} sec - Starting time in seconds
 * @param {Object} arr - Array of note timings
 * @returns {Object} Filtered array
 */
function sec2array(sec, arr) {
  let res = { ...arr };
  for (let i in arr) {
    if (Number(i) < sec * 1000) delete res[i];
  }
  return res;
}

/**
 * Convert UTF-16 encoded string to UTF-8
 * @param {string} str - UTF-16 string
 * @returns {string} UTF-8 string
 */
function decUTF16toUTF8(str) {
  const utf16leArray = new Uint16Array(str.length);
  for (let i = 0; i < str.length; i++) {
    utf16leArray[i] = str.charCodeAt(i);
  }

  // Convert Uint16Array to a Uint8Array (UTF-8)
  const utf8Array = new TextEncoder().encode(
    String.fromCharCode.apply(null, utf16leArray)
  );

  // Convert Uint8Array to a UTF-8 string
  const utf8String = new TextDecoder("utf-8").decode(utf8Array);

  return utf8String;
}

/**
 * Ensure directory exists, create if it doesn't
 * @param {string} path - Directory path
 * @param {number} mask - Permission mask
 */
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

// Handle post-update changelog display
ipcRenderer.on('show-post-update-changelog', async (event, data) => {
    const updatePrompt = document.getElementById('update-prompt');
    const currentVersion = document.getElementById('current-version');
    const changelogContent = document.getElementById('changelog-content');

    try {
        // Fetch and display changelog
        const changelog = await fetchChangelog(data.version);
        if (changelog) {
            // Update version display
            currentVersion.textContent = `Version ${data.version}`;
            
            // Display changelog
            changelogContent.innerHTML = parseChangelog(changelog);
            
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
});

// -------------------------------------
// UPDATE NOTIFICATION HANDLERS
// -------------------------------------
// Handle update notifications from the main process
ipcRenderer.on("show-update-notification", (event, data) => {
    const { title, message, type } = data;
    
    const displayMessage = title ? `<b>${title}</b><br>${message}` : message;
    
    notie.alert({
        type: type, // 1=success, 2=warning, 3=error, 4=info
        text: displayMessage,
        stay: type === 3,
        time: 5
    });
});

// Handle update progress from main process
ipcRenderer.on("update-progress", (event, data) => {
    const { progress, type } = data;
    
    if (progress % 10 === 0 || progress === 100) {
        const moduleType = type === 'core' ? 'application' : 'module';
        notie.alert({
            type: 4,
            text: `Downloading ${moduleType} update: ${progress}% complete`,
            time: 3
        });
    }
});
