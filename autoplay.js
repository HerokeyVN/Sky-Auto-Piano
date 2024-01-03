import fs from "fs";
import path from "path";
import { Hardware } from "keysender";
import {fileURLToPath} from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const keys = ["y", "u", "i", "o", "p",
              "h", "j", "k", "l", ";",
              "n", "m", ",", ".", "/"];

let json = JSON.parse(fs.readFileSync(path.join(__dirname, "temp", "Tát nhật lãng rực rỡ.txt")))[0];
let tempEnc = {};

for (let i of json.songNotes) {
    !tempEnc[i.time] ? tempEnc[i.time] = []:"";
    tempEnc[i.time].push(keys[parseInt(i.key.split("Key")[1])]);
}


(async ()=>{
    let ks = (new Hardware("Sky")).keyboard;
    let objKey = Object.keys(tempEnc);

    for (let i=1; i < objKey.length; i++) {
        let delay = objKey[i] - objKey[i-1];

        console.log(tempEnc[objKey[i-1]]);
	    for (let j of tempEnc[objKey[i-1]]) ks.sendKeys(j);

        await new Promise((rev)=>setTimeout(rev, delay));
    }
    console.log(tempEnc[objKey[objKey.length-1]]);
    for (let j of tempEnc[objKey[objKey.length-1]]) ks.sendKeys(j);
})()

//console.log(jsonEnc);
//ks.sendKeys(['y', 'u', 'c']);
// ks.sendCombination(['control', 'shift', 'v']);
