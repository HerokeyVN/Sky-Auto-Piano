import { Hardware } from "keysender";

const keySenderAliases = {
	esc: "escape",
	pageup: "pageUp",
	pagedown: "pageDown",
	numadd: "num+",
	numsub: "num-",
	nummult: "num*",
	numdiv: "num/",
	numdec: "num.",
};

function normalizeKeySenderKey(key) {
	const normalized = String(key || "").trim();
	return keySenderAliases[normalized.toLowerCase()] || normalized;
}

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

	stop({ emitStopEvent = true, manualStop = true } = {}) {
		const wasPlaying = this.state.isPlaying;
		this.state.isPlaying = false;
		this.state.sessionId = null;

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
		this.state.sessionId = `${data.lockTime}`;

		const mapKeys = Object.keys(data.keys);
		const totalDuration = Number(mapKeys[mapKeys.length - 1] || 0);

		void this.#autoPlay(data.keys, Array.isArray(data.notes) ? data.notes : null, this.state.sessionId, Number(data.sec || 0));
		void this.#sendTimeProcess(totalDuration, data.sec, this.state.sessionId);
	}

	#getPlaybackNotes(notes) {
		if (!Array.isArray(notes) || !notes.length) {
			return [];
		}

		return notes
			.map((note) => {
				const time = Number(note?.time);
				const key = typeof note?.key === "string" ? note.key.trim() : "";
				const hold = Number(note?.hold);
				if (!Number.isFinite(time) || time < 0 || !key) {
					return null;
				}
				return {
					time: Math.trunc(time),
					key,
					hold: Number.isFinite(hold) && hold > 0 ? Math.trunc(hold) : 0,
				};
			})
			.filter(Boolean)
			.sort((a, b) => a.time - b.time || a.key.localeCompare(b.key));
	}

	#getStepDurations(notes, delayNextMs) {
		const steps = [...new Set(notes.map((note) => note.time))].sort((a, b) => a - b);
		const durations = new Map();
		for (let i = 0; i < steps.length; i++) {
			const currentStep = steps[i];
			const nextStep = steps[i + 1];
			durations.set(currentStep, nextStep ? nextStep - currentStep : delayNextMs);
		}
		return durations;
	}

	#getNoteDurationMs(note, stepDurations, longPressMode) {
		if (!longPressMode) {
			return undefined;
		}

		const speed = Number(this.panel.speed) > 0 ? Number(this.panel.speed) : 1;
		if (note.hold > 0) {
			return Math.max(25, Math.trunc(note.hold / speed) - 35);
		}

		const fallbackDuration = stepDurations.get(note.time) ?? this.panel.delayNext * 1000;
		return Math.max(25, Math.trunc(fallbackDuration / speed) - 35);
	}

	async #autoPlayNotes(notes, sessionId, startSec) {
		const keysID = {
			y: 0,
			u: 1,
			i: 2,
			o: 3,
			p: 4,
			h: 5,
			j: 6,
			k: 7,
			l: 8,
			";": 9,
			n: 10,
			m: 11,
			",": 12,
			".": 13,
			"/": 14,
		};
		const ks = new Hardware("Sky").keyboard;
		const startMs = startSec * 1000;
		const stepDurations = this.#getStepDurations(notes, this.panel.delayNext * 1000);
		const longPressMode = this.panel.longPressMode;
		const speed = Number(this.panel.speed) > 0 ? Number(this.panel.speed) : 1;

		const preparedNotes = [];
		for (const note of notes) {
			if (note.time < startMs) {
				if (!(longPressMode && note.hold > 0 && note.time + note.hold > startMs)) {
					continue;
				}
				preparedNotes.push({
					time: startMs,
					key: note.key,
					hold: note.time + note.hold - startMs,
				});
				continue;
			}
			preparedNotes.push(note);
		}

		let previousTime = startMs;
		for (const note of preparedNotes) {
			if (!this.state.isPlaying || this.state.sessionId !== sessionId) {
				return;
			}

			const waitMs = Math.max(0, Math.trunc((note.time - previousTime) / speed));
			if (waitMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, waitMs));
				if (!this.state.isPlaying || this.state.sessionId !== sessionId) {
					return;
				}
			}

			const outputKey = this.keyboard.customKeyboard
				? this.keyboard.keys[keysID[note.key]] ?? note.key
				: note.key;

			ks.sendKey(
				normalizeKeySenderKey(outputKey),
				this.#getNoteDurationMs(note, stepDurations, longPressMode),
			);

			previousTime = note.time;
		}
	}

	async #autoPlay(keyMap, notes, sessionId, startSec) {
		const playbackNotes = this.#getPlaybackNotes(notes);
		if (playbackNotes.length) {
			await this.#autoPlayNotes(playbackNotes, sessionId, startSec);
			if (!this.state.isPlaying || this.state.sessionId !== sessionId) {
				return;
			}

			this.state.isPlaying = false;
			if (this.mainWindow && !this.mainWindow.isDestroyed()) {
				this.mainWindow.webContents.send("stop-player", { manualStop: false });
			}
			return;
		}

		const keysID = {
			y: 0,
			u: 1,
			i: 2,
			o: 3,
			p: 4,
			h: 5,
			j: 6,
			k: 7,
			l: 8,
			";": 9,
			n: 10,
			m: 11,
			",": 12,
			".": 13,
			"/": 14,
			".": 13,
		};
		const ks = new Hardware("Sky").keyboard;
		const steps = Object.keys(keyMap);
		const { longPressMode, delayNext } = this.panel;
		const config = this.configService.value;

		for (let i = 1; i < steps.length; i++) {
			if (!this.state.isPlaying || this.state.sessionId !== sessionId) {
				return;
			}

			const currentStep = Number(steps[i]);
			const previousStep = Number(steps[i - 1]);
			let delay = currentStep - previousStep;
			delay = Math.trunc(delay / this.panel.speed);
			let longPressDuration;

			if (keyMap[currentStep].length === 0) {
				longPressDuration = delayNext * 1000;
			}

			for (let key of keyMap[previousStep]) {
				if (config.keyboard.customKeyboard) {
					key = config.keyboard.keys[keysID[key]];
				}
				ks.sendKey(
					normalizeKeySenderKey(key),
					longPressMode ? (longPressDuration ? longPressDuration : delay) - 35 : undefined,
				);
			}

			await new Promise((resolve) => setTimeout(resolve, delay));
		}

		const lastStepKey = steps[steps.length - 1];
		if (lastStepKey) {
			for (let key of keyMap[lastStepKey]) {
				let outputKey = key;
				if (this.keyboard.customKeyboard) {
					outputKey = this.keyboard.keys[keysID[key]];
				}
				ks.sendKey(
					normalizeKeySenderKey(outputKey),
					this.panel.longPressMode ? this.panel.delayNext * 1000 - 35 : undefined,
				);
			}
		}

		this.state.isPlaying = false;
		if (this.mainWindow && !this.mainWindow.isDestroyed()) {
			this.mainWindow.webContents.send("stop-player", { manualStop: false });
		}
	}

	async #sendTimeProcess(totalDuration, sec, sessionId) {
		for (let i = sec; i <= Math.trunc(totalDuration / 1000); i++) {
			await new Promise((resolve) => setTimeout(resolve, Math.trunc(1000 / this.panel.speed)));
			if (!this.state.isPlaying || this.state.sessionId !== sessionId) {
				return;
			}

			if (this.mainWindow && !this.mainWindow.isDestroyed()) {
				this.mainWindow.webContents.send("process-bar", i);
			}
		}
	}
}
