import { Hardware } from "keysender";

export class AutoPlayService {
	constructor(configService) {
		this.configService = configService;
		this.mainWindow = null;
		this.state = {
			isPlaying: false,
			sessionId: null,
			stopRequested: false,
			suppressStopEvent: false,
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

	_isSessionActive(sessionId) {
		return this.state.isPlaying && this.state.sessionId === sessionId;
	}

	_getSafeSpeed() {
		const speed = Number(this.panel.speed);
		return Number.isFinite(speed) && speed > 0 ? speed : 1;
	}

	_getSafeDelayNextMs() {
		const delayNextSeconds = Number(this.panel.delayNext);
		if (!Number.isFinite(delayNextSeconds) || delayNextSeconds < 0) {
			return 0;
		}
		return delayNextSeconds * 1000;
	}

	_getSteps(keyMap) {
		return Object.keys(keyMap)
			.map((step) => Number(step))
			.filter((step) => Number.isFinite(step))
			.sort((a, b) => a - b);
	}

	_resolveOutputKey(rawKey, keysID) {
		if (!this.keyboard.customKeyboard) {
			return rawKey;
		}

		const mappedIndex = keysID[rawKey];
		if (typeof mappedIndex !== "number") {
			return rawKey;
		}

		return this.keyboard.keys[mappedIndex] ?? rawKey;
	}

	_sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	_createSongClock(startSongTime) {
		return {
			songTime: startSongTime,
			lastRealTime: performance.now(),
		};
	}

	_advanceSongClock(clock) {
		const now = performance.now();
		const delta = now - clock.lastRealTime;
		if (delta > 0) {
			clock.songTime += delta * this._getSafeSpeed();
			clock.lastRealTime = now;
		}
	}

	async _waitForSongTime(clock, targetSongTime, sessionId) {
		while (clock.songTime < targetSongTime) {
			if (!this._isSessionActive(sessionId)) return false;

			this._advanceSongClock(clock);
			const remainingSong = targetSongTime - clock.songTime;
			if (remainingSong <= 0) break;

			const speed = this._getSafeSpeed();
			const sleepMs = Math.min(remainingSong / speed, 5);
			await this._sleep(sleepMs > 1 ? sleepMs : 0);
		}

		return this._isSessionActive(sessionId);
	}

	stop({ emitStopEvent = true, manualStop = true } = {}) {
		const wasPlaying = this.state.isPlaying;
		this.state.isPlaying = false;
		this.state.sessionId = null;
		this.state.stopRequested = manualStop;
		this.state.suppressStopEvent = !emitStopEvent;

		if (emitStopEvent && wasPlaying && this.mainWindow && !this.mainWindow.isDestroyed()) {
			this.mainWindow.webContents.send("stop");
			this.mainWindow.webContents.send("stop-player", { manualStop });
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
		this.state.stopRequested = false;

		const steps = this._getSteps(data.keys);
		const totalDuration = steps.length > 0 ? steps[steps.length - 1] : Number(data.sec || 0) * 1000;

		this._autoPlay(data.keys, this.state.sessionId, Number(data.sec || 0));
		this._sendTimeProcess(totalDuration, Number(data.sec || 0), this.state.sessionId);
	}

	async _autoPlay(keyMap, sessionId, startSec) {
		const keysID = {
			y: 0, u: 1, i: 2, o: 3, p: 4, h: 5, j: 6, k: 7,
			l: 8, ";": 9, n: 10, m: 11, ",": 12, ".": 13, "/": 14
		};
		const ks = new Hardware("Sky").keyboard;
		const { longPressMode } = this.panel;
		const delayNextMs = this._getSafeDelayNextMs();
		const minPressTimeSong = 25;
		const releaseTrimSong = 35;
		const chordDelayStep = 3;

		const startMs = startSec * 1000;
		const syncCalibration = 1.003; // Audio sync calibration tuned from playback testing.
		const startSongTime = startMs * syncCalibration;

		const timeline = [];
		const steps = this._getSteps(keyMap);

		if (steps.length === 0) {
			this.state.isPlaying = false;
			if (this.mainWindow && !this.mainWindow.isDestroyed()) {
				this.mainWindow.webContents.send("stop-player", { manualStop: false });
			}
			return;
		}

		for (let i = 0; i < steps.length; i++) {
			const currentStep = steps[i];
			if (currentStep < startMs) continue;

			const targetSongTime = currentStep * syncCalibration;

			let longPressSong = delayNextMs;
			if (i < steps.length - 1) {
				longPressSong = (steps[i + 1] - currentStep) * syncCalibration;
			}

			let chordDelay = 0;

			const keysForStep = Array.isArray(keyMap[currentStep]) ? keyMap[currentStep] : [];
			for (const key of keysForStep) {
				const outputKey = this._resolveOutputKey(key, keysID);

				let pressTimeSong = minPressTimeSong;
				if (longPressMode) {
					pressTimeSong = Math.max(minPressTimeSong, longPressSong - releaseTrimSong);
				}

				const finalSongTime = targetSongTime + chordDelay;

				timeline.push({ songTime: finalSongTime, key: outputKey, type: true });
				timeline.push({ songTime: finalSongTime + pressTimeSong, key: outputKey, type: false });

				chordDelay += chordDelayStep;
			}
		}

		timeline.sort((a, b) => {
			if (a.songTime === b.songTime) {
				return a.type === b.type ? 0 : (a.type ? 1 : -1);
			}
			return a.songTime - b.songTime;
		});

		const activeKeys = new Set();
		const clock = this._createSongClock(startSongTime);

		try {
			for (let i = 0; i < timeline.length; i++) {
				const ev = timeline[i];
				const ok = await this._waitForSongTime(clock, ev.songTime, sessionId);
				if (!ok) return;

				ks.toggleKey(ev.key, ev.type);
				if (ev.type) activeKeys.add(ev.key);
				else activeKeys.delete(ev.key);
			}

			await this._sleep(50);

		} finally {
			activeKeys.forEach(key => ks.toggleKey(key, false));
			activeKeys.clear();

			this.state.isPlaying = false;
			const shouldEmitStop = !this.state.suppressStopEvent;
			this.state.suppressStopEvent = false;
			if (shouldEmitStop && this.mainWindow && !this.mainWindow.isDestroyed()) {
				this.mainWindow.webContents.send("stop-player", {
					manualStop: this.state.stopRequested,
				});
			}
		}
	}

	async _sendTimeProcess(totalDuration, sec, sessionId) {
		const startSecond = Number(sec || 0);
		const maxSecond = Math.trunc(totalDuration / 1000);
		const clock = this._createSongClock(startSecond * 1000);

		for (let i = startSecond; i <= maxSecond; i++) {
			if (!this._isSessionActive(sessionId)) return;

			if (this.mainWindow && !this.mainWindow.isDestroyed()) {
				this.mainWindow.webContents.send("process-bar", i);
			}

			if (i < maxSecond) {
				const ok = await this._waitForSongTime(clock, (i + 1) * 1000, sessionId);
				if (!ok) return;
			}
		}
	}
}