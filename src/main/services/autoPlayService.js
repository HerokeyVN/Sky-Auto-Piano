import { Hardware } from "keysender";

export class AutoPlayService {
	constructor(configService) {
		this.configService = configService;
		this.mainWindow = null;
		this.state = {
			isPlaying: false,
			sessionId: null,
		};
	}

	attachWindow(win) {
		this.mainWindow = win;
	}

	get panel() {
		return this.configService.value.panel;
	}

	get keyboard() {
		return this.configService.value.keyboard;
	}

	stop() {
		this.state.isPlaying = false;
		this.state.sessionId = null;

		if (this.mainWindow && !this.mainWindow.isDestroyed()) {
			this.mainWindow.webContents.send("stop");
			this.mainWindow.webContents.send("stop-player");
		}
	}

	handlePlayRequest(win, data) {
		this.attachWindow(win);

		if (!data.isPlay) {
			this.stop();
			return;
		}

		this.state.isPlaying = true;
		this.state.sessionId = String(data.lockTime);

		const mapKeys = Object.keys(data.keys);
		const totalDuration = Number(mapKeys[mapKeys.length - 1] || 0);

		this._autoPlay(data.keys, this.state.sessionId, data.sec || 0);
		this._sendTimeProcess(totalDuration, data.sec || 0, this.state.sessionId);
	}

	async _autoPlay(keyMap, sessionId, startSec) {
		const keysID = {
			y: 0, u: 1, i: 2, o: 3, p: 4, h: 5, j: 6, k: 7,
			l: 8, ";": 9, n: 10, m: 11, ",": 12, ".": 13, "/": 14
		};
		const ks = new Hardware("Sky").keyboard;
		const config = this.configService.value;
		const { longPressMode, delayNext } = this.panel;
		const speed = this.panel.speed || 1;

		const startMs = startSec * 1000;
		const syncCalibration = 1.003; 

		const timeline = [];
		const steps = Object.keys(keyMap).map(Number).sort((a, b) => a - b);

		for (let i = 0; i < steps.length; i++) {
			const currentStep = steps[i];
			if (currentStep < startMs) continue;

			const targetTimeOffset = (currentStep / speed) * syncCalibration;

			let longPressDuration = delayNext * 1000;
			if (i < steps.length - 1) {
				longPressDuration = (steps[i + 1] - currentStep) / speed;
			}

			let chordDelay = 0; 

			for (let key of keyMap[currentStep]) {
				let outputKey = config.keyboard.customKeyboard ? config.keyboard.keys[keysID[key]] : key;

				let pressTime = 25;
				if (longPressMode) {
					pressTime = Math.max(25, longPressDuration - 35);
				}

				const finalTimeOffset = targetTimeOffset + chordDelay;

				timeline.push({ timeOffset: finalTimeOffset, key: outputKey, type: true });
				timeline.push({ timeOffset: finalTimeOffset + pressTime, key: outputKey, type: false });

				chordDelay += 3; 
			}
		}

		timeline.sort((a, b) => {
			if (a.timeOffset === b.timeOffset) {
				return a.type === b.type ? 0 : (a.type ? 1 : -1);
			}
			return a.timeOffset - b.timeOffset;
		});

		const activeKeys = new Set();
		const startRealTime = performance.now() - (startMs / speed);

		try {
			for (let i = 0; i < timeline.length; i++) {
				if (!this.state.isPlaying || this.state.sessionId !== sessionId) return;

				const ev = timeline[i];
				const absoluteTargetTime = startRealTime + ev.timeOffset;
				let remaining = absoluteTargetTime - performance.now();

				if (remaining > 3) {
					await new Promise(r => setTimeout(r, remaining - 3));
				}

				while (performance.now() < absoluteTargetTime) {
					if (!this.state.isPlaying || this.state.sessionId !== sessionId) return;
				}

				ks.toggleKey(ev.key, ev.type);
				if (ev.type) activeKeys.add(ev.key);
				else activeKeys.delete(ev.key);
			}

			await new Promise(r => setTimeout(r, 50));

		} finally {
			activeKeys.forEach(key => ks.toggleKey(key, false));
			activeKeys.clear();
			
			this.state.isPlaying = false;
			if (this.mainWindow && !this.mainWindow.isDestroyed()) {
				this.mainWindow.webContents.send("stop-player");
			}
		}
	}

	async _sendTimeProcess(totalDuration, sec, sessionId) {
		for (let i = sec; i <= Math.trunc(totalDuration / 1000); i++) {
			if (!this.state.isPlaying || this.state.sessionId !== sessionId) return;

			if (this.mainWindow && !this.mainWindow.isDestroyed()) {
				this.mainWindow.webContents.send("process-bar", i);
			}
			await new Promise((resolve) => setTimeout(resolve, Math.trunc(1000 / this.panel.speed)));
		}
	}
}
