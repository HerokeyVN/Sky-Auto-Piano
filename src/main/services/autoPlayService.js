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
		this.state.sessionId = `${data.lockTime}`;

		const mapKeys = Object.keys(data.keys);
		const totalDuration = Number(mapKeys[mapKeys.length - 1] || 0);

		void this.#autoPlay(data.keys, this.state.sessionId);
		void this.#sendTimeProcess(totalDuration, data.sec, this.state.sessionId);
	}

	async #autoPlay(keyMap, sessionId) {
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
		const steps = Object.keys(keyMap);
		const { longPressMode, speed, delayNext } = this.panel;
		const config = this.configService.value;

		for (let i = 1; i < steps.length; i++) {
			if (!this.state.isPlaying || this.state.sessionId !== sessionId) {
				return;
			}

			const currentStep = Number(steps[i]);
			const previousStep = Number(steps[i - 1]);
			let delay = currentStep - previousStep;
			delay = Math.trunc(delay / speed);
			let longPressDuration;

			if (keyMap[currentStep].length === 0) {
				longPressDuration = delayNext * 1000;
			}

			for (let key of keyMap[previousStep]) {
				if (config.keyboard.customKeyboard) {
					key = config.keyboard.keys[keysID[key]];
				}
				ks.sendKeys(
					key,
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
				ks.sendKeys(
					outputKey,
					this.panel.longPressMode ? this.panel.delayNext * 1000 - 35 : undefined,
				);
			}
		}

		this.state.isPlaying = false;
		if (this.mainWindow && !this.mainWindow.isDestroyed()) {
			this.mainWindow.webContents.send("stop-player");
		}
	}

	async #sendTimeProcess(totalDuration, sec, sessionId) {
		const { speed } = this.panel;

		for (let i = sec; i <= Math.trunc(totalDuration / 1000); i++) {
			await new Promise((resolve) => setTimeout(resolve, Math.trunc(1000 / speed)));
			if (!this.state.isPlaying || this.state.sessionId !== sessionId) {
				return;
			}

			if (this.mainWindow && !this.mainWindow.isDestroyed()) {
				this.mainWindow.webContents.send("process-bar", i);
			}
		}
	}
}
