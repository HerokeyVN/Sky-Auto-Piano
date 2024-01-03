const { ipcRenderer } = require('electron');
const fs = require("fs");
const path = require("path");
const { Base64 } = require('js-base64');
const keys = ["y", "u", "i", "o", "p",
    "h", "j", "k", "l", ";",
    "n", "m", ",", ".", "/"];
var listSheet = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "listSheet.json"), { encoding: "utf8" }));

// Load card
printSheet();

// Add sheet
document.getElementsByClassName('btn-add')[0].addEventListener('change', (event) => {
    const { files } = event.target;
    let repl = fs.readFileSync(path.join(__dirname, "..", "js", "repl"));
    console.log(repl);
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
    let fileName = Base64.encode(random(1, 9999) + (json.name+"").replace(/[^a-zA-Z0-9]/g, '-')) + '.json';
    for (let j in json.songNotes) {
        let i = json.songNotes[j]
        !tempEnc[i.time] ? tempEnc[i.time] = [] : "";
        tempEnc[i.time].push(keys[parseInt(i.key.split("Key")[1])]);
    }

    fs.writeFileSync(path.join(__dirname, "..", "data", fileName), JSON.stringify(tempEnc), { mode: 0o666 });
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
            <svg xmlns="http://www.w3.org/2000/svg" width="35" height="35" fill="currentColor" class="bi bi-play-fill" viewBox="0 0 16 16">
                <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/>
            </svg>
            <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" fill="currentColor" class="bi bi-trash3" viewBox="0 0 16 16">
                <path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5M11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H2.506a.58.58 0 0 0-.01 0H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66h.538a.5.5 0 0 0 0-1h-.995a.59.59 0 0 0-.01 0zm1.958 1-.846 10.58a1 1 0 0 1-.997.92h-6.23a1 1 0 0 1-.997-.92L3.042 3.5zm-7.487 1a.5.5 0 0 1 .528.47l.5 8.5a.5.5 0 0 1-.998.06L5 5.03a.5.5 0 0 1 .47-.53Zm5.058 0a.5.5 0 0 1 .47.53l-.5 8.5a.5.5 0 1 1-.998-.06l.5-8.5a.5.5 0 0 1 .528-.47ZM8 4.5a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-1 0V5a.5.5 0 0 1 .5-.5" />
            </svg>
        </div>
    </div>`
    }

    for (let j in listSheet) {
        let i = listSheet[j];
        let btnPlay = document.getElementsByClassName("bi-play-fill");
        btnPlay[j].onclick = ()=>{
            ipcRenderer.send("play", i.keyMap);
        }

        let btndel = document.getElementsByClassName("bi-trash3");
        btndel[j].onclick = ()=>{
            fs.unlinkSync(path.join(__dirname, "..", "data", listSheet[j].keyMap));
            listSheet.splice(j, 1);
            printSheet();
        }
    }
}