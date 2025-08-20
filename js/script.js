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
// DECRYPTION LOGIC
// -------------------------------------
const MASK = Object.freeze([
  16, 34, 56, 18, 62, 19, -25, 55,
  15, 24, 30, 12, 30, 45, 39, -23,
  -10, 15, 45, -18, 37, -2, -21, 65,
  25, -4, -14, 43, 23, -4, -17, -17
]);

/**
 * Decrypts an array of numbers into a song notes object.
 * @param {number[]} nums The encrypted array of numbers from songNotes.
 * @returns {Object} The decrypted song notes object.
 */
function decodeNums(nums) {
  if (!Array.isArray(nums)) throw new TypeError("decodeNums: input must be an array of numbers");
  let s = "";
  for (let i = 0; i < nums.length; i++) {
    const n = nums[i] | 0;
    const code = n + MASK[i % MASK.length];
    s += String.fromCharCode(code);
  }
  // Clean up potential trailing characters and parse the JSON string
  try {
      const cleanedString = s.replace(/(].*)/, "]");
      return JSON.parse(cleanedString);
  } catch (e) {
      console.error("Failed to parse decrypted string:", s);
      throw new Error("Decryption resulted in invalid JSON.");
  }
}


// -------------------------------------
// DATA INITIALIZATION
// -------------------------------------
// Ensure data directory exists
ensureExists(path.join(__dirname, "..", "data"));

// Application state variables
let listSheet = []; // Will be populated asynchronously
let listKeys = [];  // Cached key maps for sheets
let playing = 0;    // Current playing sheet index
let isPlay = false; // Playback state
let maxPCB = 0;     // Maximum process bar value
let loopMode = 0;   // Loop mode (0: off, 1: playlist, 2: single)

const listSheetPath = path.join(__dirname, "..", "data", "listSheet.json");

fs.readFile(listSheetPath, { encoding: "utf8" }, (err, data) => {
    if (err) {
        fs.writeFile(listSheetPath, JSON.stringify([], null, 4), { mode: 0o666 }, (writeErr) => {
            if (writeErr) console.error("Failed to create listSheet.json:", writeErr);
        });
        listSheet = [];
    } else {
        try {
            listSheet = JSON.parse(data);
        } catch (parseErr) {
            console.error("Failed to parse listSheet.json:", parseErr);
            listSheet = [];
        }
    }
    
    printSheet();

    if (listSheet.length > 0) {
        fs.readFile(path.join(__dirname, "..", "data", listSheet[0].keyMap), { encoding: "utf8" }, (err, keymapData) => {
            if (!err) {
                listKeys[0] = JSON.parse(keymapData);
                updateFooter({ ...listSheet[0], keys: listKeys[0] }, 0);
            } else {
                console.error("Failed to preload first song's keymap:", err);
            }
        });
    }
});


// -------------------------------------
// UI INITIALIZATION
// -------------------------------------
// Initialize UI on document load
document.addEventListener("DOMContentLoaded", () => {
  // Theme management
  const themeToggleButtonLight = document.getElementById("btn-lightmode");
  const themeToggleButtonDark = document.getElementById("btn-darkmode");
  const body = document.body;

  const lightModeBgColor = "#ffffff";
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

  // -------------------------------------
  // NAVIGATION TAB FUNCTIONALITY
  // -------------------------------------
  // Initialize navigation tabs
  const navTabs = document.querySelectorAll('.nav-tab');
  let currentTab = 'all-songs';
  
  // Load favorites and recent plays from localStorage
  let favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
  let recentPlays = JSON.parse(localStorage.getItem('recentPlays') || '[]');
  
  // Tab switching functionality
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabType = tab.getAttribute('data-tab');
      
      // Remove active class from all tabs
      navTabs.forEach(t => t.classList.remove('active'));
      
      // Add active class to clicked tab
      tab.classList.add('active');
      
      // Update current tab
      currentTab = tabType;
      
      // Filter and display content based on selected tab
      filterContentByTab(tabType);
    });
  });
  
  /**
   * Filter content based on selected tab
   * @param {string} tabType - The type of tab selected
   */
  function filterContentByTab(tabType) {
    const cards = document.querySelectorAll('.card');
    const searchTerm = document.getElementById('search-bar').value.toLowerCase().trim();
    
    cards.forEach((card, index) => {
      if (index < listSheet.length) {
        const sheetData = listSheet[index];
        const sheetName = sheetData.name.toLowerCase();
        const authorName = (sheetData.author || "").toLowerCase();
        
        let shouldShow = false;
        
        switch (tabType) {
          case 'all-songs':
            shouldShow = true;
            break;
          case 'favorite':
            shouldShow = favorites.includes(sheetData.name);
            break;
          case 'recent-play':
            shouldShow = recentPlays.includes(sheetData.name);
            break;
        }
        
        // Apply search filter if there's a search term
        if (shouldShow && searchTerm) {
          shouldShow = sheetName.includes(searchTerm) || authorName.includes(searchTerm);
        }
        
        card.style.display = shouldShow ? "" : "none";
      } else {
        card.style.display = "none";
      }
    });
  }
  
  /**
   * Add a song to favorites
   * @param {string} songName - Name of the song to add to favorites
   */
  function addToFavorites(songName) {
    if (!favorites.includes(songName)) {
      favorites.push(songName);
      localStorage.setItem('favorites', JSON.stringify(favorites));
    }
  }
  
  /**
   * Remove a song from favorites
   * @param {string} songName - Name of the song to remove from favorites
   */
  function removeFromFavorites(songName) {
    const index = favorites.indexOf(songName);
    if (index > -1) {
      favorites.splice(index, 1);
      localStorage.setItem('favorites', JSON.stringify(favorites));
    }
  }
  
  /**
   * Add a song to recent plays
   * @param {string} songName - Name of the song to add to recent plays
   */
  function addToRecentPlays(songName) {
    // Remove if already exists
    const index = recentPlays.indexOf(songName);
    if (index > -1) {
      recentPlays.splice(index, 1);
    }
    
    // Add to beginning
    recentPlays.unshift(songName);
    
    // Keep only last 10 recent plays
    if (recentPlays.length > 10) {
      recentPlays = recentPlays.slice(0, 10);
    }
    
    localStorage.setItem('recentPlays', JSON.stringify(recentPlays));
  }
  
  // Make functions globally available
  window.addToFavorites = addToFavorites;
  window.removeFromFavorites = removeFromFavorites;
  window.addToRecentPlays = addToRecentPlays;
  window.filterContentByTab = filterContentByTab;
  window.favorites = favorites;
  window.recentPlays = recentPlays;
});

// -------------------------------------
// GLOBAL FUNCTIONS
// -------------------------------------
/**
 * Filter content based on selected tab (global function)
 * @param {string} tabType - The type of tab selected
 */
function filterContentByTab(tabType) {
  const cards = document.querySelectorAll('.card');
  const searchTerm = document.getElementById('search-bar').value.toLowerCase().trim();
  const favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
  const recentPlays = JSON.parse(localStorage.getItem('recentPlays') || '[]');
  
  cards.forEach((card, index) => {
    if (index < listSheet.length) {
      const sheetData = listSheet[index];
      const sheetName = sheetData.name.toLowerCase();
      const authorName = (sheetData.author || "").toLowerCase();
      
      let shouldShow = false;
      
      switch (tabType) {
        case 'all-songs':
          shouldShow = true;
          break;
        case 'favorite':
          shouldShow = favorites.includes(sheetData.name);
          break;
        case 'recent-play':
          shouldShow = recentPlays.includes(sheetData.name);
          break;
      }
      
      // Apply search filter if there's a search term
      if (shouldShow && searchTerm) {
        shouldShow = sheetName.includes(searchTerm) || authorName.includes(searchTerm);
      }
      
      card.style.display = shouldShow ? "" : "none";
    } else {
      card.style.display = "none";
    }
  });
}

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

// Configure search functionality
const searchBar = document.getElementById("search-bar");
const contentContainer = document.querySelector(".content");

if (searchBar && contentContainer) {
  searchBar.addEventListener("input", () => {
    // Get current active tab
    const activeTab = document.querySelector('.nav-tab.active');
    const currentTabType = activeTab ? activeTab.getAttribute('data-tab') : 'all-songs';
    
    // Filter content based on current tab and search term
    filterContentByTab(currentTabType);
  });
} else {
  console.error("Search bar or content container element not found!");
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
      
      // ---- START OF DECRYPTION MODIFICATION ----
      // Check if the sheet is encrypted and decrypt if necessary
      if (json.isEncrypted === true) {
        try {
          // Decrypt the songNotes
          const decryptedNotes = decodeNums(json.songNotes);
          // Replace the encrypted notes with the decrypted ones
          json.songNotes = decryptedNotes;
          // Mark it as not encrypted anymore for further processing
          json.isEncrypted = false;
        } catch (decryptErr) {
          console.error("Failed to decrypt sheet:", json.name, decryptErr);
          if (files.length == 1) {
            notie.alert({
              type: 3,
              text: "Failed to decrypt the sheet. It might be corrupted."
            });
          }
          continue; // Skip this file if decryption fails
        }
      }
      // ---- END OF DECRYPTION MODIFICATION ----

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
  // Check if sheet is already encrypted (this will be false for successfully decrypted sheets)
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
  
  // This check ensures notes are in the correct format (e.g., objects), not numbers (as in encrypted sheets)
  if (typeof json.songNotes[0] != "object")
    return {
      errCode: 1,
      msg: "Sheet format is incorrect or still encrypted!",
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
    author: json.author || 'Unknown',
    transcribedBy: json.transcribedBy || 'Unknown',
    bpm: json.bpm,
    bitsPerPage: json.bitsPerPage,
    pitchLevel: json.pitchLevel,
    isComposed: json.isComposed,
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

function printSheet() {
    const contentContainer = document.getElementsByClassName("content")[0];
    contentContainer.innerHTML = "";

    const fragment = document.createDocumentFragment();

    listSheet.forEach((sheetData, index) => {
        const card = document.createElement("div");
        card.className = "card";

        card.innerHTML = `
            <div class="sheet-info">
                <h3 class="name-sheet">${sheetData.name}</h3>
                <div class="info-lines">
                    <div class="info-item">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" class="icon author-icon"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M14 14s-1-1.5-6-1.5S2 14 2 14s1-4 6-4 6 4 6 4z"/></svg>
                        <span class="label">Author:</span>
                        <span class="value author-sheet">${sheetData.author || ''}</span>
                    </div>
                    <div class="info-item">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" class="icon trans-icon"><path d="M12.146.854a.5.5 0 0 1 .708 0l2.292 2.292a.5.5 0 0 1 0 .708L6.207 12.793l-3.75.75.75-3.75L12.146.854z"/><path d="M11.207 2.5 13.5 4.793 12.793 5.5 10.5 3.207 11.207 2.5z"/></svg>
                        <span class="label">Transcript by:</span>
                        <span class="value tranScript-sheet">${sheetData.transcribedBy || ''}</span>
                    </div>
                    <div class="info-item">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" class="icon bpm-icon"><path d="M8 3a6 6 0 1 0 0 12A6 6 0 0 0 8 3zm0 1a5 5 0 1 1 0 10A5 5 0 0 1 8 4z"/><path d="M10.5 8.5 8 11a1 1 0 1 1-1.414-1.414l3-3A1 1 0 1 1 10.5 8.5z"/></svg>
                        <span class="label">BPM:</span>
                        <span class="value bpm-sheet">${sheetData.bpm || ''}</span>
                    </div>
                </div>
            </div>
            <div class="menu-btn" style="display: flex; flex-direction: row; align-items: center; gap: 8px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" class="bi bi-heart favorite-btn" data-song="${sheetData.name}" viewBox="0 0 16 16" style="cursor:pointer;" fill="currentColor">
                    <path d="m8 2.748-.717-.737C5.6.281 2.514.878 1.4 3.053c-.523 1.023-.641 2.5.314 4.385.92 1.815 2.834 3.989 6.286 6.357 3.452-2.368 5.365-4.542 6.286-6.357.955-1.886.838-3.362.314-4.385C13.486.878 10.4.28 8.717 2.01L8 2.748zM8 15C-7.333 4.868 3.279-3.04 7.824 1.143c.06.055.119.112.176.171a3.12 3.12 0 0 1 .176-.17C12.72-3.042 23.333 4.867 8 15z"/>
                </svg>
                <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" class="bi bi-sheet-editor" viewBox="0 0 40 40" style="cursor:pointer;"><path d="M20.8333 36.6667H30C30.884 36.6667 31.7319 36.3155 32.357 35.6903C32.9821 35.0652 33.3333 34.2174 33.3333 33.3333V11.6667L25 3.33333H9.99996C9.1159 3.33333 8.26806 3.68452 7.64294 4.30964C7.01782 4.93476 6.66663 5.78261 6.66663 6.66666V22.5" fill="none" stroke="currentColor" stroke-width="4.16667" stroke-linecap="round" stroke-linejoin="round"/><path d="M23.333 3.33333V9.99999C23.333 10.884 23.6842 11.7319 24.3093 12.357C24.9344 12.9821 25.7822 13.3333 26.6663 13.3333H33.333M22.2963 26.0433C22.625 25.7146 22.8858 25.3243 23.0637 24.8948C23.2416 24.4653 23.3332 24.0049 23.3332 23.54C23.3332 23.0751 23.2416 22.6147 23.0637 22.1852C22.8858 21.7557 22.625 21.3654 22.2963 21.0367C21.9676 20.7079 21.5773 20.4471 21.1478 20.2692C20.7182 20.0913 20.2579 19.9997 19.793 19.9997C19.3281 19.9997 18.8677 20.0913 18.4382 20.2692C18.0087 20.4471 17.6184 20.7079 17.2896 21.0367L8.93964 29.39C8.54338 29.786 8.25334 30.2756 8.0963 30.8133L6.7013 35.5967C6.65947 35.7401 6.65697 35.8921 6.69404 36.0368C6.73112 36.1815 6.80641 36.3136 6.91205 36.4192C7.01768 36.5249 7.14977 36.6002 7.29449 36.6373C7.4392 36.6743 7.59122 36.6718 7.73464 36.63L12.518 35.235C13.0557 35.078 13.5453 34.7879 13.9413 34.3917L22.2963 26.0433Z" fill="none" stroke="currentColor" stroke-width="4.16667" stroke-linecap="round" stroke-linejoin="round"/></svg>
                <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" class="bi bi-trash3" viewBox="0 0 16 16" style="cursor:pointer;" fill="currentColor"><path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5M11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H2.506a.58.58 0 0 0-.01 0H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66h.538a.5.5 0 0 0 0-1h-.995a.59.59 0 0 0-.01 0zm1.958 1-.846 10.58a1 1 0 0 1-.997.92h-6.23a1 1 0 0 1-.997-.92L3.042 3.5zm-7.487 1a.5.5 0 0 1 .528.47l.5 8.5a.5.5 0 0 1-.998.06L5 5.03a.5.5 0 0 1 .47-.53Zm5.058 0a.5.5 0 0 1 .47.53l-.5 8.5a.5.5 0 1 1-.998-.06l.5-8.5a.5.5 0 0 1 .528-.47ZM8 4.5a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-1 0V5a.5.5 0 0 1 .5-.5" /></svg>
            </div>
        `;

        card.onclick = () => {
            fs.readFile(path.join(__dirname, "..", "data", sheetData.keyMap), { encoding: "utf8" }, (err, data) => {
                if (err) {
                    console.error("Failed to read keymap:", err);
                    notie.alert({ type: 3, text: "Error loading song data." });
                    return;
                }
                listKeys[index] = JSON.parse(data);
                window.addToRecentPlays(sheetData.name);
                updateFooter({ ...sheetData, keys: listKeys[index] }, index);
            });
        };

        card.querySelector(".bi-sheet-editor").onclick = (e) => {
            e.stopPropagation();
            ipcRenderer.send("openSheetEditor", { sheetIndex: index });
        };

        card.querySelector(".bi-trash3").onclick = (e) => {
            e.stopPropagation();
            fs.unlinkSync(path.join(__dirname, "..", "data", sheetData.keyMap));
            listSheet.splice(index, 1);
            listKeys.splice(index, 1);
            fs.writeFileSync(
                path.join(__dirname, "..", "data", "listSheet.json"),
                JSON.stringify(listSheet, null, 4),
                { mode: 0o666 }
            );
            printSheet();
        };

        const btnFavorite = card.querySelector(".favorite-btn");
        btnFavorite.onclick = (e) => {
            e.stopPropagation();
            const songName = sheetData.name;
            let favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
            
            if (favorites.includes(songName)) {
                window.removeFromFavorites(songName);
                btnFavorite.classList.remove('favorited');
                if (document.querySelector('.nav-tab.active')?.getAttribute('data-tab') === 'favorite') {
                    card.style.display = 'none';
                }
            } else {
                window.addToFavorites(songName);
                btnFavorite.classList.add('favorited');
            }
        };

        const favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
        if (favorites.includes(sheetData.name)) {
            btnFavorite.classList.add('favorited');
        }
        
        fragment.appendChild(card);
    });

    contentContainer.appendChild(fragment);

    const activeTab = document.querySelector('.nav-tab.active');
    if (activeTab) {
        const currentTabType = activeTab.getAttribute('data-tab');
        filterContentByTab(currentTabType);
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

    const playPrevSong = () => {
        updateFooter({ ...listSheet[playing], keys: listKeys[playing] }, playing);

        if (isPlay) {
            btnPlay(); 
            document.getElementsByClassName("process-bar")[0].value = 0;
            document.getElementsByClassName("live-time")[0].innerHTML = `00:00`;
            let delay = document.getElementById("delay-loop").value;
            delay = delay == 0 ? 0.5 : delay;
            setTimeout(btnPlay, delay * 1000); 
        }
    };

    if (listKeys[playing]) {
        playPrevSong();
    } else {
        fs.readFile(
            path.join(__dirname, "..", "data", listSheet[playing].keyMap),
            { encoding: "utf8" },
            (err, data) => {
                if (err) {
                    console.error("Failed to load previous song:", err);
                    return;
                }
                listKeys[playing] = JSON.parse(data);
                playPrevSong();
            }
        );
    }
}

document.getElementById("btn-prev").addEventListener("click", btnPrev);
ipcRenderer.on("btn-prev", btnPrev);

/**
 * Navigate to the next sheet
 */
function btnNext() {
    if (playing + 1 >= listSheet.length) playing = 0;
    else playing++;

    const playNextSong = () => {
        updateFooter({ ...listSheet[playing], keys: listKeys[playing] }, playing);

        if (isPlay) {
            btnPlay();
            document.getElementsByClassName("process-bar")[0].value = 0;
            document.getElementsByClassName("live-time")[0].innerHTML = `00:00`;
            let delay = document.getElementById("delay-loop").value;
            delay = delay == 0 ? 0.5 : delay;
            setTimeout(btnPlay, delay * 1000);
        }
    };
    if (listKeys[playing]) {
        playNextSong();
    } else {
        fs.readFile(
            path.join(__dirname, "..", "data", listSheet[playing].keyMap),
            { encoding: "utf8" },
            (err, data) => {
                if (err) {
                    console.error("Failed to load next song:", err);
                    return;
                }
                listKeys[playing] = JSON.parse(data);
                playNextSong();
            }
        );
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

ipcRenderer.on('sheet-list-updated', (event, { index, data }) => {
    listSheet[index] = data;
    
    // Instead of re-rendering everything, just update the specific card
    const card = document.querySelectorAll(".card")[index];
    if (card) {
        card.querySelector('.name-sheet').textContent = data.name;
        card.querySelector('.author-sheet').textContent = data.author || '';
        card.querySelector('.tranScript-sheet').textContent = data.transcribedBy || '';
        card.querySelector('.bpm-sheet').textContent = data.bpm || '';
    }

    if (playing === index) {
        // Asynchronously update the keymap if the currently playing song is edited
        fs.readFile(path.join(__dirname, '..', 'data', data.keyMap), { encoding: 'utf8' }, (err, keymapData) => {
            if (err) {
                console.error('Error reloading keymap after sheet update:', err);
                return;
            }
            listKeys[index] = JSON.parse(keymapData);
            updateFooter({ ...data, keys: listKeys[index] }, index);
        });
    }
});

ipcRenderer.on('keymap-updated', (event, { index }) => {
    fs.readFile(path.join(__dirname, '..', 'data', listSheet[index].keyMap), { encoding: 'utf8' }, (err, data) => {
        if (err) {
            console.error('Error reloading keymap:', err);
            return;
        }
        listKeys[index] = JSON.parse(data);
        if (playing === index) {
            updateFooter({ ...listSheet[index], keys: listKeys[index] }, index);
        }
    });
});