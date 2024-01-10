const { ipcRenderer, globalShortcut } = require('electron');
// const globalShortcut = remote.globalShortcut;
console.log(globalShortcut)
const fs = require("fs");
const path = require("path");
const { Base64 } = require('js-base64');
const keys = ["y", "u", "i", "o", "p",
    "h", "j", "k", "l", ";",
    "n", "m", ",", ".", "/"];
var listSheet = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "listSheet.json"), { encoding: "utf8" }));
var listKeys = [];
var playing = 0;
var isPlay = false;
var maxPCB = 0;

// Load card
printSheet();

if (listSheet.length > 0) {
    !listKeys[0] ? listKeys[0] = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", listSheet[0].keyMap), { encoding: "utf8" })) : "";

    updateFooter({ ...listSheet[0], keys: listKeys[0] }, 0);
}

// Add sheet
document.getElementsByClassName('btn-add')[0].addEventListener('change', (event) => {
    const { files } = event.target;
    let repl = fs.readFileSync(path.join(__dirname, "..", "js", "repl"));
    //console.log(repl);
    let text = fs.readFileSync(files[0].path, { encoding: "utf8" }).replaceAll("��", '').replaceAll(repl, '');
    //console.log(eval(text).name);
    let json = eval(text)[0];

    //console.log(json);
    encSheet(json);
})

function encSheet(json) {
    if (json.isEncrypted) return;
    let tempEnc = {};
    //let fileName = Base64.encode((new Date()).getTime+"")+'.json';
    let fileName = Base64.encode(random(1, 9999) + (json.name + "").replace(/[^a-zA-Z0-9]/g, '-')) + '.json';
    for (let j in json.songNotes) {
        let i = json.songNotes[j]
        !tempEnc[i.time] ? tempEnc[i.time] = [] : "";
        tempEnc[i.time].push(keys[parseInt(i.key.split("Key")[1])]);
    }

    fs.writeFileSync(path.join(__dirname, "..", "data", fileName), JSON.stringify(!tempEnc["0"] ? {"0": [], ...tempEnc}:tempEnc), { mode: 0o666 });
    listSheet.push({
        name: json.name,
        author: json.author,
        transcribedBy: json.transcribedBy,
        bpm: json.bpm,
        keyMap: fileName
    })
    fs.writeFileSync(path.join(__dirname, "..", "data", "listSheet.json"), JSON.stringify(listSheet, null, 4), { mode: 0o666 });

    printSheet()
    //console.log(tempEnc);

}

function random(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function printSheet() {
    document.getElementsByClassName('content')[0].innerHTML = "";
    for (let i of listSheet) {
        document.getElementsByClassName('content')[0].innerHTML += `
        <div class="card">
        <div class="sheet-info">
            <h3 class="name-sheet">${i.name}</h3>
            <a class="author-sheet">Author: ${i.author}<br></a>
            <a class="tranScript-sheet">Transcript by: ${i.transcribedBy}<br></a>
            <a class="bpm-sheet">BPM: ${i.bpm}<br></a>
        </div>
        <div class="menu-btn">
            <!--svg xmlns="http://www.w3.org/2000/svg" width="35" height="35" fill="currentColor" class="bi bi-play-fill" viewBox="0 0 16 16">
                <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/>
            </svg-->
            <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" fill="currentColor" class="bi bi-trash3" viewBox="0 0 16 16">
                <path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5M11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H2.506a.58.58 0 0 0-.01 0H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66h.538a.5.5 0 0 0 0-1h-.995a.59.59 0 0 0-.01 0zm1.958 1-.846 10.58a1 1 0 0 1-.997.92h-6.23a1 1 0 0 1-.997-.92L3.042 3.5zm-7.487 1a.5.5 0 0 1 .528.47l.5 8.5a.5.5 0 0 1-.998.06L5 5.03a.5.5 0 0 1 .47-.53Zm5.058 0a.5.5 0 0 1 .47.53l-.5 8.5a.5.5 0 1 1-.998-.06l.5-8.5a.5.5 0 0 1 .528-.47ZM8 4.5a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-1 0V5a.5.5 0 0 1 .5-.5" />
            </svg>
        </div>
    </div>`
    }

    for (let j in listSheet) {
        let i = listSheet[j];
        let btnPlay = document.getElementsByClassName("card");
        btnPlay[j].onclick = () => {
            //ipcRenderer.send("play", i.keyMap);
            !listKeys[j] ? listKeys[j] = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", i.keyMap), { encoding: "utf8" })) : "";

            updateFooter({ ...listSheet[j], keys: listKeys[j] }, j);
        }

        let btndel = document.getElementsByClassName("bi-trash3");
        btndel[j].onclick = () => {
            fs.unlinkSync(path.join(__dirname, "..", "data", listSheet[j].keyMap));
            listSheet.splice(j, 1);
            listKeys.splice(j, 1);
            fs.writeFileSync(path.join(__dirname, "..", "data", "listSheet.json"), JSON.stringify(listSheet, null, 4), { mode: 0o666 });
            printSheet();
        }
    }
}

function updateFooter(info, id) {
    playing = id;
    let delayMap = Object.keys(info.keys)
    document.getElementsByClassName('process-bar')[0].max = Math.trunc(Number(delayMap[delayMap.length - 1]) / (1000));
    maxPCB = Math.trunc(Number(delayMap[delayMap.length - 1]) / (1000));
    document.getElementsByClassName('name-playing')[0].innerHTML = info.name;
    document.getElementsByClassName('process-bar')[0].value = 0;
    document.getElementsByClassName('live-time')[0].innerHTML = `00:00`
    //console.log(Number(delayMap[delayMap.length - 1]) / 1000);
    let totalMin = Math.trunc(Number(delayMap[delayMap.length - 1]) / (60 * 1000));
    totalMin < 10 ? totalMin = "0" + (totalMin + "") : "";
    let totalSec = Math.trunc(Number(delayMap[delayMap.length - 1]) / (1000)) - (totalMin * 60);
    totalSec < 10 ? totalSec = "0" + (totalSec + "") : "";
    document.getElementsByClassName('total-time')[0].innerHTML = `${totalMin}:${totalSec}`
}

function btnPrev() {
    if (playing-1 < 0) playing = listSheet.length-1;
    else playing--;
    !listKeys[playing] ? listKeys[playing] = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", listSheet[playing].keyMap), { encoding: "utf8" })) : "";
    updateFooter({ ...listSheet[playing], keys: listKeys[playing] }, playing);

    if (isPlay) {
        btnPlay();
        document.getElementsByClassName('process-bar')[0].value = 0;
        document.getElementsByClassName('live-time')[0].innerHTML = `00:00`;
        setTimeout(btnPlay, 1000);
    }
}

document.getElementById('btn-prev').addEventListener("click", btnPrev);
ipcRenderer.on('btn-prev', btnPrev);

function btnNext() {
    if (playing+1 >= listSheet.length) playing = 0;
    else playing++;
    !listKeys[playing] ? listKeys[playing] = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", listSheet[playing].keyMap), { encoding: "utf8" })) : "";
    updateFooter({ ...listSheet[playing], keys: listKeys[playing] }, playing);

    if (isPlay) {
        btnPlay();
        document.getElementsByClassName('process-bar')[0].value = 0;
        document.getElementsByClassName('live-time')[0].innerHTML = `00:00`;
        setTimeout(btnPlay, 1000);
    }
}
document.getElementById('btn-next').addEventListener("click", btnNext);
ipcRenderer.on('btn-next', btnNext);

function btnPlay() {
    isPlay = isPlay ? false : true;
    let send = {
        keys: sec2array(Number(document.getElementsByClassName('process-bar')[0].value), listKeys[playing]),
        sec: Number(document.getElementsByClassName('process-bar')[0].value)+1
    }
    ipcRenderer.send("play", send);
    document.getElementsByClassName('process-bar')[0].disabled = isPlay ? true:false;
    document.getElementById('btn-play').innerHTML = isPlay ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pause-fill" viewBox="0 0 16 16">
    <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5"/>
    </svg>
    Pause (Shift+V)`: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" class="bi bi-play-fill" viewBox="0 0 16 16">
    <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/>
    </svg>
    Play (Shift+V)`;
}

document.getElementById('btn-play').addEventListener("click", btnPlay);
ipcRenderer.on('btn-play', btnPlay);

ipcRenderer.on("process-bar", (event, data)=>{
	document.getElementsByClassName('process-bar')[0].value = data;
    //console.log(data);
    let s2m = sec2min(Number(data));
    let min = s2m.min < 10 ? "0"+(s2m.min+""):s2m.min;
    let sec = s2m.sec < 10 ? "0"+(s2m.sec+""):s2m.sec;
    document.getElementsByClassName('live-time')[0].innerHTML = `${min}:${sec}`
})
ipcRenderer.on("stop-player", (event, data)=>{
	document.getElementById('btn-play').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" heipkihght="20" fill="currentColor" class="bi bi-play-fill" viewBox="0 0 16 16">
    <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/>
    </svg>
    Play (Shift+V)`;
    isPlay = false;
    document.getElementById('process-bar').disabled = isPlay ? true:false;
    document.getElementsByClassName('process-bar')[0].value = 0;
    document.getElementsByClassName('live-time')[0].innerHTML = '00:00';
})

document.getElementById('process-bar').addEventListener('change', (data)=>{
    document.getElementsByClassName('process-bar')[0].max = maxPCB;
    //console.log(document.getElementsByClassName('process-bar')[0].value);
    let s2m = sec2min(Number(data.target.value));
    let min = s2m.min < 10 ? "0"+(s2m.min+""):s2m.min;
    let sec = s2m.sec < 10 ? "0"+(s2m.sec+""):s2m.sec;
    document.getElementsByClassName('live-time')[0].innerHTML = `${min}:${sec}`;
})

function sec2min(sec) {
    let res = {
        min: Math.trunc(sec/60),
        sec: sec - Math.trunc(sec/60)*60
    }
    return res;
}

function sec2array(sec, arr) {
    let res = { ...arr };
    for (let i in arr) {
        if (Number(i) < sec*1000) delete res[i];
    }

    return res;
}