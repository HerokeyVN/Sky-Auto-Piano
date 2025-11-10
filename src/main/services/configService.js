import fs from "fs";
import path from "node:path";
import { ensureDirectory } from "../../common/fileSystem.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

export class ConfigService {
	constructor(appDirectory) {
		this.appDirectory = appDirectory;
		this.configDirectory = path.join(appDirectory, "config");
		this.configPath = path.join(this.configDirectory, "config.json");
		this.defaultConfig = {
			panel: {
				longPressMode: false,
				speed: 1,
				delayNext: 1,
				autoSave: true,
				minimizeOnPlay: true,
			},
			keyboard: {
				customKeyboard: false,
				keys: [
					"y", "u", "i", "o", "p",
					"h", "j", "k", "l", ";",
					"n", "m", ",", ".", "/",
				],
			},
			shortcut: {
				pre: "Ctrl+Shift+C",
				play: "Ctrl+Shift+V",
				next: "Ctrl+Shift+B",
				increaseSpeed: "Ctrl+Up",
				decreaseSpeed: "Ctrl+Down",
			},
			update: {
				blockUpdate: false,
			},
			appTheme: "dark",
		};

		ensureDirectory(this.configDirectory);
		this.config = this.#loadConfigFromDisk();
	}

	#getUpdatedConfig(currentConfig) {
		let updated = false;

		const walk = (current, defaults) => {
			Object.keys(defaults).forEach((key) => {
				if (!(key in current)) {
					current[key] = defaults[key];
					updated = true;
				} else if (
					typeof defaults[key] === "object" &&
					!Array.isArray(defaults[key]) &&
					defaults[key] !== null
				) {
					walk(current[key], defaults[key]);
				}
			});
		};

		walk(currentConfig, this.defaultConfig);
		return { updated, config: currentConfig };
	}

	#loadConfigFromDisk() {
		try {
			if (!fs.existsSync(this.configPath)) {
				fs.writeFileSync(
					this.configPath,
					JSON.stringify(this.defaultConfig, null, 4),
					"utf-8"
				);
				return clone(this.defaultConfig);
			}

			const currentConfig = JSON.parse(fs.readFileSync(this.configPath, "utf-8"));
			const { updated, config } = this.#getUpdatedConfig(currentConfig);
			if (updated) {
				this.#persist(config);
			}
			return config;
		} catch (error) {
			console.error("ConfigService", "Failed to load config", error);
			this.#persist(this.defaultConfig);
			return clone(this.defaultConfig);
		}
	}

	#persist(config) {
		fs.writeFileSync(this.configPath, JSON.stringify(config, null, 4), "utf-8");
	}

	get value() {
		return this.config;
	}

	save() {
		this.#persist(this.config);
	}

	setTheme(theme) {
		if (!["light", "dark"].includes(theme)) return;
		if (this.config.appTheme === theme) return;
		this.config.appTheme = theme;
		this.save();
	}

	updatePanel(partial) {
		this.config.panel = {
			...this.config.panel,
			...partial,
		};
		this.save();
	}

	updateShortcut(partial) {
		this.config.shortcut = {
			...this.config.shortcut,
			...partial,
		};
		this.save();
	}

	updateKeyboard(partial) {
		this.config.keyboard = {
			...this.config.keyboard,
			...partial,
		};
		this.save();
	}

	reloadFromDisk() {
		this.config = this.#loadConfigFromDisk();
		return this.config;
	}
}
