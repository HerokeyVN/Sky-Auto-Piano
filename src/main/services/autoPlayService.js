import { AutoPlayService as StrictAutoPlayService } from "./autoPlayServiceStrict.js";
import { AutoPlayService as LiteAutoPlayService } from "./autoPlayServiceLite.js";

export class AutoPlayService {
	constructor(configService) {
		this.configService = configService;
		this.strictService = new StrictAutoPlayService(configService);
		this.liteService = new LiteAutoPlayService(configService);
		this.activeMode = this._getPlaybackMode();
	}

	attachWindow(win) {
		this.strictService.attachWindow(win);
		this.liteService.attachWindow(win);
	}

	stop() {
		const { targetService, otherService } = this._getServicesForActiveMode();
		targetService.stop({ emitStopEvent: true, manualStop: true });
		otherService.stop({ emitStopEvent: false, manualStop: true });
	}

	handlePlayRequest(win, data) {
		this.attachWindow(win);
		const mode = this._getPlaybackMode();
		const { targetService, otherService } = this._getServicesForMode(mode);

		if (!data.isPlay) {
			const { targetService: activeService, otherService: inactiveService } = this._getServicesForActiveMode();
			activeService.stop({ emitStopEvent: true, manualStop: true });
			inactiveService.stop({ emitStopEvent: false, manualStop: true });
			return;
		}

		this.activeMode = mode;
		otherService.stop({ emitStopEvent: false, manualStop: true });
		targetService.handlePlayRequest(win, data);
	}

	_getPlaybackMode() {
		const mode = this.configService.value.panel?.playbackMode;
		return mode === "lite" ? "lite" : "strict";
	}

	_getServicesForMode(mode) {
		if (mode === "lite") {
			return { targetService: this.liteService, otherService: this.strictService };
		}
		return { targetService: this.strictService, otherService: this.liteService };
	}

	_getServicesForActiveMode() {
		const mode = this.activeMode ?? this._getPlaybackMode();
		return this._getServicesForMode(mode);
	}
}
