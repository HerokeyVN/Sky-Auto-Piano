const { ipcRenderer } = require('electron');
const fs = require("fs");
const path = require("path");
const dirSetting = path.join(__dirname, "..", "config", "config.json")

var config = JSON.parse(fs.readFileSync(dirSetting));

/* 
    Event processing in the menu
*/
const menu = document.getElementsByClassName("menu")[0].childNodes
var listTab = [];

document.getElementById(getTab(document.querySelector(".menu .active"))).style.display = "flex"; // Show the default tab

// Get list tab
for (let dom of menu) {
    if (dom.nodeName != "H3") continue;
    listTab.push(getTab(dom));
}

// Handling page changes
for (let dom of menu) {
    if (dom.nodeName != "H3") continue;
    dom.addEventListener("click", (data) => {
        // Delete old Active Class
        for (let dom of menu) {
            if (dom.nodeName != "H3") continue;
            dom.classList.remove("active");
        }
        // Processing the user can click on the H3 or Span tag
        let target = data.target.parentNode;
        if (data.target.nodeName == "H3") target = data.target;
        // Add new Active Class
        target.classList.add("active");
        // Show the user installation page
        listTab.map((tab) => {
            document.getElementById(tab).style = undefined;
            document.getElementById(getTab(target)).style.display = "flex";
        })
    })
}

/*
    Setting
*/

/* Load setting */

// General setting
document.getElementById("switch-save-setting").checked = config.panel.autoSave

// Keyboard setting
let i = 0;
for (let dom of document.getElementsByClassName("keys")) {
    dom.value = config.keyboard.keys[i++]
}
document.getElementById("switch-custom-keyboard").checked = config.keyboard.customKeyboard;

// Shortcut setting
document.getElementById("pre-shortcut-setting").value = config.shortcut.pre
document.getElementById("play-shortcut-setting").value = config.shortcut.play
document.getElementById("next-shortcut-setting").value = config.shortcut.next

/* Handle event */
// Listen to the Shortcut changes

let keyup = true;
for (let id of ["pre-shortcut-setting", "play-shortcut-setting", "next-shortcut-setting"]) {
    document.getElementById(id).addEventListener("keyup", (data, err)=>{
        let dom = document.getElementById(id);
        dom.value = dom.value.split("+").sort((a, b)=>{
            if (a.length == 1 && b.length > 1) return 1;
            if (b.length == 1 && a.length > 1) return -1;
            if (a<b) return -1;
            if (a>b) return 1;
            return 0;
        }).join("+");
        keyup = true;
    })
    document.getElementById(id).addEventListener("keydown", (data, err)=>{
        let dom = document.getElementById(id);
        if (keyup) {
            dom.value = ""; keyup = false;
        }

        let key = data.key;
        if (data.key == "Control") key = "Ctrl";
        if (data.key.length == 1) key = data.key.toUpperCase();

        if (dom.value.split('+').indexOf(key) != -1) return;

        if (dom.value != "") dom.value += '+';
        dom.value += key;
    })
}


/* Save button */

document.getElementById("btn-save-setting").addEventListener("click", () => {
    config.panel.autoSave = document.getElementById("switch-save-setting").checked;

    let i = 0;
    for (let dom of document.getElementsByClassName("keys")) {
        config.keyboard.keys[i++] = dom.value.toLowerCase();
    }
    config.keyboard.customKeyboard = document.getElementById("switch-custom-keyboard").checked

    let arrShortcut = [];
    config.shortcut.pre = document.getElementById("pre-shortcut-setting").value;
    config.shortcut.play = document.getElementById("play-shortcut-setting").value;
    config.shortcut.next = document.getElementById("next-shortcut-setting").value;
    for (let key in config.shortcut) {
        if (arrShortcut.indexOf(config.shortcut[key]) != -1) return notie.alert({
            type: 3,
            text: "Unable to save the settings, the shortcut has been duplicated!"
        })
        arrShortcut.push(config.shortcut[key]);
    }

    try {
        fs.writeFileSync(dirSetting, JSON.stringify(config, null, 4));
        notie.alert({
            type: 1,
            text: "Saved the settings. Please restart the software to apply the settings."
        })
        ipcRenderer.send("changeSetting");
    } catch (err) {
        console.log(err);
        notie.alert({
            type: 3,
            text: "Can't save the settings!"
        })
    }
})

/*
    Support function
*/
function getTab(dom) {
    let htmlDOM = dom.outerHTML.replaceAll(' ', '');
    return htmlDOM.split("tab=\"")[1].split("\"")[0];
}