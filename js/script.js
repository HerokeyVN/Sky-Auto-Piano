const { ipcRenderer } = require('electron');
const fs = require("fs");
const path = require("path");
const { Base64 } = require('js-base64');
//const notie = require(path.join(__dirname, 'notie.js')); // optional, default = 4, enum: [1, 2, 3, 4, 5, 'success', 'warning', 'error', 'info', 'neutral']
const keys = ["y", "u", "i", "o", "p",
              "h", "j", "k", "l", ";",
              "n", "m", ",", ".", "/"];

// Read list sheet
ensureExists(path.join(__dirname, "..", "data"));
try {
    var listSheet = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "listSheet.json"), { encoding: "utf8" }));
} catch (_) {
    fs.writeFileSync(path.join(__dirname, "..", "data", "listSheet.json"), JSON.stringify([], null, 4), { mode: 0o666 });
    listSheet = [];
}

var listKeys = [];
var playing = 0;
var isPlay = false;
var maxPCB = 0;
var loopMode = 0;

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
    let done = 0;
    for (let file of files) {
        let text = fs.readFileSync(file.path, { encoding: "utf8" }).replaceAll("��", '').replaceAll(repl, '');
        let json;
        try {
            if (text[0] != '[') throw new Error();
            json = eval(text)[0];
        } catch (_) {
            if (files.length == 1) {
                notie.alert({
                    type: 3,
                    text: "File Sheet is not in the format. Please check again!"
                })
            }
            continue;
        }

        let res;
        try {
            res = encSheet(json);
        } catch (err) {
            console.error(err);
            if (files.length == 1) {
                notie.alert({
                    type: 3,
                    text: "File Sheet is not in the format. Please check again!"
                })
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
                text: res.msg
            })
        }
    }
    printSheet();

    if (files.length > 1) notie.alert({
        type: (done > 0 ? 1:3),
        text: `Complete import! Success: ${done}. Error: ${files.length-done}`
    })
    else if (done > 0) notie.alert({
        type: 1,
        text: `Complete import!`
    });
})

function encSheet(json) {
    if (json.isEncrypted) return {
        errCode: 1,
        msg: "Sheet has been encrypted!"
    };
    if (!json.songNotes) return {
        errCode: 2,
        msg: "The sheet file is not valid, please try again with another file!"
    }
    if (typeof json.songNotes[0] != "object") return {
        errCode: 1,
        msg: "Sheet has been encrypted!"
    };
    let tempEnc = {};
    //let fileName = Base64.encode((new Date()).getTime+"")+'.json';
    let fileName = Base64.encode(random(1, 9999) + (json.name + "").replace(/[^a-zA-Z0-9]/g, '-')) + '.json';
    for (let j in json.songNotes) {
        let i = json.songNotes[j]
        !tempEnc[i.time] ? tempEnc[i.time] = [] : "";
        tempEnc[i.time].push(keys[parseInt(i.key.split("Key")[1])]);
    }

    let temp = Object.keys(tempEnc);
    tempEnc[(Math.trunc(Number(temp[temp.length - 1]) / 1000) + 1) * 1000] = [];

    fs.writeFileSync(path.join(__dirname, "..", "data", fileName), JSON.stringify(!tempEnc["0"] ? { "0": [], ...tempEnc } : tempEnc), { mode: 0o666 });
    listSheet.push({
        name: json.name,
        author: json.author,
        transcribedBy: json.transcribedBy,
        bpm: json.bpm,
        keyMap: fileName
    })
    fs.writeFileSync(path.join(__dirname, "..", "data", "listSheet.json"), JSON.stringify(listSheet, null, 4), { mode: 0o666 });
}

function random(min, max) {
    return Math.floor(Math.random() * (max - min + 2)) + min;
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
            try {
                !listKeys[j] ? listKeys[j] = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", i.keyMap), { encoding: "utf8" })) : "";
            } catch (_){}

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
    
    let totalMin = Math.trunc(Number(delayMap[delayMap.length - 1]) / (60 * 1000));
    totalMin < 10 ? totalMin = "0" + (totalMin + "") : "";
    let totalSec = Math.trunc(Number(delayMap[delayMap.length - 1]) / (1000)) - (totalMin * 60);
    totalSec < 10 ? totalSec = "0" + (totalSec + "") : "";
    document.getElementsByClassName('total-time')[0].innerHTML = `${totalMin}:${totalSec}`
}

function btnPrev() {
    if (playing - 1 < 0) playing = listSheet.length - 1;
    else playing--;
    !listKeys[playing] ? listKeys[playing] = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", listSheet[playing].keyMap), { encoding: "utf8" })) : "";
    updateFooter({ ...listSheet[playing], keys: listKeys[playing] }, playing);

    if (isPlay) {
        btnPlay();
        document.getElementsByClassName('process-bar')[0].value = 0;
        document.getElementsByClassName('live-time')[0].innerHTML = `00:00`;
        let delay = document.getElementById('delay-loop').value;
        delay = (delay == 0 ? 0.5:delay);
        setTimeout(btnPlay, delay*1000);
    }
}

document.getElementById('btn-prev').addEventListener("click", btnPrev);
ipcRenderer.on('btn-prev', btnPrev);

function btnNext() {
    if (playing + 1 >= listSheet.length) playing = 0;
    else playing++;
    !listKeys[playing] ? listKeys[playing] = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", listSheet[playing].keyMap), { encoding: "utf8" })) : "";
    updateFooter({ ...listSheet[playing], keys: listKeys[playing] }, playing);

    if (isPlay) {
        btnPlay();
        document.getElementsByClassName('process-bar')[0].value = 0;
        document.getElementsByClassName('live-time')[0].innerHTML = `00:00`;
        let delay = document.getElementById('delay-loop').value;
        delay = (delay == 0 ? 0.5:delay);
        setTimeout(btnPlay, delay*1000);
    }
}
document.getElementById('btn-next').addEventListener("click", btnNext);
ipcRenderer.on('btn-next', btnNext);

function btnPlay() {
    isPlay = isPlay ? false : true;
    let send = {
        keys: sec2array(Number(document.getElementsByClassName('process-bar')[0].value), listKeys[playing]),
        sec: Number(document.getElementsByClassName('process-bar')[0].value),
        lockTime: (new Date()).getTime()+'',
        isPlay
    }
    ipcRenderer.send("play", send);
    document.getElementsByClassName('process-bar')[0].disabled = isPlay ? true : false;
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

ipcRenderer.on("process-bar", (event, data) => {
    document.getElementsByClassName('process-bar')[0].value = data;
    //console.log(data);
    let s2m = sec2min(Number(data));
    let min = s2m.min < 10 ? "0" + (s2m.min + "") : s2m.min;
    let sec = s2m.sec < 10 ? "0" + (s2m.sec + "") : s2m.sec;
    document.getElementsByClassName('live-time')[0].innerHTML = `${min}:${sec}`
})
ipcRenderer.on("stop-player", (event, data) => {
    document.getElementById('btn-play').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" heipkihght="20" fill="currentColor" class="bi bi-play-fill" viewBox="0 0 16 16">
    <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/>
    </svg>
    Play (Shift+V)`;
    isPlay = false;
    document.getElementById('process-bar').disabled = isPlay ? true : false;
    document.getElementsByClassName('process-bar')[0].value = 0;
    document.getElementsByClassName('live-time')[0].innerHTML = '00:00';
    if (loopMode == 1) {
        btnNext();
        let delay = document.getElementById('delay-loop').value;
        delay = (delay == 0 ? 0.5:delay);
        setTimeout(btnPlay, delay*1000);
        return;
    }
    if (loopMode == 2) {
        let delay = document.getElementById('delay-loop').value;
        delay = (delay == 0 ? 0.5:delay);
        setTimeout(btnPlay, delay*1000);
        return;
    }
})
ipcRenderer.on("stop", (event, data) => {
    document.getElementById('btn-play').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" heipkihght="20" fill="currentColor" class="bi bi-play-fill" viewBox="0 0 16 16">
    <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/>
    </svg>
    Play (Shift+V)`;
    isPlay = false;
    document.getElementById('process-bar').disabled = isPlay ? true : false;
})

document.getElementById('process-bar').addEventListener('change', (data) => {
    document.getElementsByClassName('process-bar')[0].max = maxPCB;
    
    let s2m = sec2min(Number(data.target.value));
    let min = s2m.min < 10 ? "0" + (s2m.min + "") : s2m.min;
    let sec = s2m.sec < 10 ? "0" + (s2m.sec + "") : s2m.sec;
    document.getElementsByClassName('live-time')[0].innerHTML = `${min}:${sec}`;
})

// long-press button

document.getElementsByClassName("long-press")[0].addEventListener('click', (data)=>{
    ipcRenderer.send("longPressMode", data.target.checked);
})

// loop button

document.getElementsByClassName("bi-loop")[0].addEventListener('click', ()=>{
    if (loopMode == 0) {
        loopMode = 1;
        document.getElementsByClassName("bi-loop")[0].style = "    box-shadow: inset 0 0 15px 0 rgba(256, 256, 256, 0.2), 0 0 15px 0 rgba(256, 256, 256, 0.4); border-radius: 5px; padding: 0 2px;"
    } else if (loopMode == 1) {
        loopMode = 2;
        document.getElementsByClassName("bi-loop")[0].innerHTML = `<path d="M11 4v1.466a.25.25 0 0 0 .41.192l2.36-1.966a.25.25 0 0 0 0-.384l-2.36-1.966a.25.25 0 0 0-.41.192V3H5a5 5 0 0 0-4.48 7.223.5.5 0 0 0 .896-.446A4 4 0 0 1 5 4zm4.48 1.777a.5.5 0 0 0-.896.446A4 4 0 0 1 11 12H5.001v-1.466a.25.25 0 0 0-.41-.192l-2.36 1.966a.25.25 0 0 0 0 .384l2.36 1.966a.25.25 0 0 0 .41-.192V13h6a5 5 0 0 0 4.48-7.223Z"/>
        <path d="M9 5.5a.5.5 0 0 0-.854-.354l-1.75 1.75a.5.5 0 1 0 .708.708L8 6.707V10.5a.5.5 0 0 0 1 0z"/>`;
    } else if (loopMode == 2) {
        loopMode = 0;
        document.getElementsByClassName("bi-loop")[0].style = "";
        document.getElementsByClassName("bi-loop")[0].innerHTML = `<path d="M11 5.466V4H5a4 4 0 0 0-3.584 5.777.5.5 0 1 1-.896.446A5 5 0 0 1 5 3h6V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192m3.81.086a.5.5 0 0 1 .67.225A5 5 0 0 1 11 13H5v1.466a.25.25 0 0 1-.41.192l-2.36-1.966a.25.25 0 0 1 0-.384l2.36-1.966a.25.25 0 0 1 .41.192V12h6a4 4 0 0 0 3.585-5.777.5.5 0 0 1 .225-.67Z"/>`;
    }
})

//delay loop

document.getElementById('delay-loop').addEventListener("change", (data)=>{
    document.getElementById('delay-next-value').innerHTML = `Delay next: ${data.target.value}s`;
});

//speed change

document.getElementById('speed-btn').addEventListener('change', (data)=>{
    if (Number(data.target.value) < Number(data.target.min)) data.target.value = data.target.min;
    if (Number(data.target.value) > Number(data.target.max)) data.target.value = data.target.max;
    console.log(data.target.value);
    ipcRenderer.send("changeSpeed", data.target.value);
})

function sec2min(sec) {
    let res = {
        min: Math.trunc(sec / 60),
        sec: sec - Math.trunc(sec / 60) * 60
    }
    return res;
}

function sec2array(sec, arr) {
    let res = { ...arr };
    for (let i in arr) {
        if (Number(i) < sec * 1000) delete res[i];
    }

    return res;
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