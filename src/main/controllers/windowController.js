import fs from "fs";
import path from "node:path";
import {
	app,
	BrowserWindow,
	globalShortcut,
} from "electron/main";

export class WindowController {
	/**
	 * @param {string} appDirectory absolute path to app folder
	 * @param {ConfigService} configService configuration service
	 * @param {AutoPlayService} autoPlayService playback service
	 * @param {UpdateService} updateService update service
	 */
	constructor(appDirectory, configService, autoPlayService, updateService) {
		this.appDirectory = appDirectory;
		this.rendererRoot = path.join(appDirectory, "src", "renderer");
		this.configService = configService;
		this.autoPlayService = autoPlayService;
		this.updateService = updateService;

		this.mainWindow = null;
		this.settingsWindow = null;
		this.editorWindow = null;
	}

	createMainWindow() {
		const { appTheme } = this.configService.value;
		const backgroundColor = appTheme === "dark" ? "#171717" : "#0a1930";

		const win = new BrowserWindow({
			width: 750,
			height: 600,
			minWidth: 700,
			minHeight: 200,
			backgroundColor,
			webPreferences: {
				nodeIntegration: true,
				contextIsolation: false,
			},
		});

		this.mainWindow = win;
		this.autoPlayService.attachWindow(win);
		this.updateService.setMainWindow(win);

		win.on("close", (event) => {
			if (this.updateService.isUpdating) {
				event.preventDefault();
				const type = this.updateService.updateType === "core" ? "application" : "module";
				this.updateService.showToast(
					"Update in Progress",
					`Cannot close - ${type} update is running (${this.updateService.state?.updateProgress || 0}%).`,
					3,
				);
			}
		});

		win.loadFile(path.join(this.rendererRoot, "views", "index.html"));

		this.#registerShortcuts(win);
		this.#bindUpdateNotification(win);

		win.once("closed", () => {
			this.mainWindow = null;
			this.autoPlayService.attachWindow(null);
		});

		return win;
	}

	#createThemeAwareBackground() {}

	#registerShortcuts(win) {
		globalShortcut.unregisterAll();
		const shortcuts = this.configService.value.shortcut;

		globalShortcut.register(shortcuts.pre, () => {
			if (!win.isDestroyed()) {
				win.webContents.send("btn-prev");
			}
		});
		globalShortcut.register(shortcuts.play, () => {
			if (!win.isDestroyed()) {
				win.webContents.send("btn-play");
			}
		});
		globalShortcut.register(shortcuts.next, () => {
			if (!win.isDestroyed()) {
				win.webContents.send("btn-next");
			}
		});
		globalShortcut.register(shortcuts.increaseSpeed, () => {
			const panel = this.configService.value.panel;
			panel.speed = Math.min(5, Math.round((panel.speed + 0.1) * 10) / 10);
			this.configService.updatePanel({ speed: panel.speed });
			if (!win.isDestroyed()) {
				win.webContents.send("speed-changed", panel.speed);
			}
		});
		globalShortcut.register(shortcuts.decreaseSpeed, () => {
			const panel = this.configService.value.panel;
			panel.speed = Math.max(0.1, Math.round((panel.speed - 0.1) * 10) / 10);
			this.configService.updatePanel({ speed: panel.speed });
			if (!win.isDestroyed()) {
				win.webContents.send("speed-changed", panel.speed);
			}
		});
	}

	#bindUpdateNotification(win) {
		const infoPath = path.join(this.appDirectory, "config", "update-info.json");
		if (!fs.existsSync(infoPath)) return;

		try {
			const info = JSON.parse(fs.readFileSync(infoPath, "utf-8"));
			if (!info.showChangelog) return;

			win.webContents.on("did-finish-load", () => {
				win.webContents.send("show-post-update-changelog", {
					version: info.newVersion,
				});
			});
		} catch (error) {
			console.error("WindowController", "Failed to read update info", error);
		}
	}

	openSettingsWindow() {
		if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
			this.settingsWindow.focus();
			return this.settingsWindow;
		}

		const { appTheme } = this.configService.value;
		const backgroundColor = appTheme === "dark" ? "#171717" : "#0a1930";

		const settingsWin = new BrowserWindow({
			width: 800,
			height: 650,
			resizable: false,
			maximizable: false,
			backgroundColor,
			parent: this.mainWindow ?? undefined,
			webPreferences: {
				nodeIntegration: true,
				contextIsolation: false,
			},
		});

		settingsWin.loadFile(path.join(this.rendererRoot, "views", "setting.html"));
		this.settingsWindow = settingsWin;
		globalShortcut.unregisterAll();

		settingsWin.once("closed", () => {
			this.settingsWindow = null;
			if (this.mainWindow && !this.mainWindow.isDestroyed()) {
				this.#registerShortcuts(this.mainWindow);
			}
		});

		return settingsWin;
	}

	openSheetEditor(sheetIndex) {
		if (this.editorWindow && !this.editorWindow.isDestroyed()) {
			this.editorWindow.focus();
			return this.editorWindow;
		}

		const { appTheme } = this.configService.value;
		const backgroundColor = appTheme === "dark" ? "#171717" : "#0a1930";

		const editorWin = new BrowserWindow({
			width: 900,
			height: 600,
			resizable: false,
			maximizable: false,
			backgroundColor,
			parent: this.mainWindow ?? undefined,
			webPreferences: {
				nodeIntegration: true,
				contextIsolation: false,
			},
		});

		editorWin.loadFile(path.join(this.rendererRoot, "views", "editor.html"), {
			query: {
				sheetIndex,
			},
		});

		this.editorWindow = editorWin;

		editorWin.webContents.on("did-finish-load", () => {
			editorWin.webContents.send("theme-changed", this.configService.value.appTheme);
		});

		editorWin.once("closed", () => {
			this.editorWindow = null;
		});

		return editorWin;
	}
}
