import fs from "fs";
import path from "node:path";
import { ipcMain, dialog } from "electron/main";

/**
 * Register IPC handlers for the main process.
 * @param {Object} deps dependencies
 * @param {import("../controllers/windowController.js").WindowController} deps.windowController
 * @param {import("../services/configService.js").ConfigService} deps.configService
 * @param {import("../services/autoPlayService.js").AutoPlayService} deps.autoPlayService
 * @param {import("../services/updateService.js").UpdateService} deps.updateService
 */
export function registerIpcHandlers({ windowController, configService, autoPlayService, updateService }) {
	const appDirectory = windowController.appDirectory;

	ipcMain.on("changeSetting", () => {
		const updatedConfig = configService.reloadFromDisk();
		const { mainWindow, editorWindow, settingWindow } = windowController;

		for (const win of [mainWindow, editorWindow, settingWindow]) {
			if (win && !win.isDestroyed()) {
				win.webContents.send("config-updated", updatedConfig);
			}
		}
	});

	ipcMain.on("set-theme", (_, theme) => {
		configService.setTheme(theme);

		if (windowController.editorWindow && !windowController.editorWindow.isDestroyed()) {
			windowController.editorWindow.webContents.send("theme-changed", theme);
		}
	});

	ipcMain.on("play", (event, data) => {
		const win = windowController.mainWindow;
		if (!win || win.isDestroyed()) return;

		if (data.isPlay && configService.value.panel.minimizeOnPlay) {
			win.minimize();
		}

		autoPlayService.handlePlayRequest(win, data);
	});

	ipcMain.on("longPressMode", (_, value) => {
		configService.updatePanel({ longPressMode: Boolean(value) });
	});

	ipcMain.on("changeSpeed", (_, value) => {
		configService.updatePanel({ speed: Number(value) });
	});

	ipcMain.on("changeDelayNext", (_, value) => {
		configService.updatePanel({ delayNext: Number(value) });
	});

	ipcMain.on("openSetting", () => {
		windowController.openSettingsWindow();
	});

	ipcMain.on("openSheetEditor", (_, args) => {
		windowController.openSheetEditor(args?.sheetIndex ?? 0);
	});

	ipcMain.on("check-update", async (event) => {
		try {
			const info = await updateService.getVersionInfo();
			event.reply("update-check-response", {
				available: info.currentVersion !== info.latestVersion,
				currentVersion: info.currentVersion,
				latestVersion: info.latestVersion,
			});
		} catch (error) {
			event.reply("update-check-response", {
				available: false,
				error: true,
			});
		}
	});

	ipcMain.on("start-update", async (event) => {
		try {
			const metadata = await updateService.getPackageMetadata();
			const moduleUpdateNeeded =
				metadata.remote.module_version !== metadata.local.module_version ||
				!fs.existsSync(path.join(appDirectory, "node_modules", ".bin"));

			if (moduleUpdateNeeded) {
				await updateService.performModuleUpdate(metadata.remote);
			}

			const result = await updateService.performUpdate({ isManualUpdate: true });
			event.reply("update-status", {
				success: result,
				moduleUpdated: moduleUpdateNeeded,
			});
		} catch (error) {
			console.error("IPC", "Manual update failed", error);
			event.reply("update-status", {
				success: false,
				error: "Failed to complete update. Please try again later.",
			});
		}
	});

	ipcMain.on("update-sheet-list", (_, { index, data }) => {
		try {
			const listSheetPath = path.join(appDirectory, "data", "listSheet.json");
			const sheets = JSON.parse(fs.readFileSync(listSheetPath, "utf-8"));
			sheets[index] = data;
			fs.writeFileSync(listSheetPath, JSON.stringify(sheets, null, 4));

			const win = windowController.mainWindow;
			if (win && !win.isDestroyed()) {
				win.webContents.send("sheet-list-updated", { index, data });
			}
		} catch (error) {
			console.error("IPC", "Failed to update sheet list", error);
		}
	});

	ipcMain.on("keymap-updated", (_, { index }) => {
		const win = windowController.mainWindow;
		if (win && !win.isDestroyed()) {
			win.webContents.send("keymap-updated", { index });
		}
	});

	ipcMain.handle("show-export-dialog", async () => {
		const win = windowController.editorWindow ?? windowController.mainWindow;
		const result = await dialog.showSaveDialog(win, {
			filters: [{ name: "Sky Sheet", extensions: ["json", "txt"] }],
		});
		return result;
	});

	ipcMain.handle("save-exported-file", async (_, { filePath, content }) => {
		try {
			fs.writeFileSync(filePath, content, "utf-8");
			return { success: true };
		} catch (error) {
			return { success: false, error: error.message };
		}
	});
}
