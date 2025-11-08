import path from "node:path";
import { fileURLToPath } from "url";
import {
	app,
	Menu,
	globalShortcut,
} from "electron/main";
import { WindowController } from "./controllers/windowController.js";
import { ConfigService } from "./services/configService.js";
import { AutoPlayService } from "./services/autoPlayService.js";
import { UpdateService } from "./services/updateService.js";
import { registerIpcHandlers } from "./ipc/registerIpcHandlers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDirectory = path.join(__dirname, "..", "..");

const devMode = false;

if (!devMode) {
	Menu.setApplicationMenu(Menu.buildFromTemplate([]));
}

app.setAppUserModelId("Sky Auto Piano");
app.setName("Sky Auto Piano");

const configService = new ConfigService(appDirectory);
const autoPlayService = new AutoPlayService(configService);
const updateService = new UpdateService(appDirectory, configService);
const windowController = new WindowController(appDirectory, configService, autoPlayService, updateService);

registerIpcHandlers({ windowController, configService, autoPlayService, updateService });

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
	process.exit();
}

app.on("second-instance", () => {
	const win = windowController.mainWindow;
	if (!win) return;
	if (win.isMinimized()) win.restore();
	win.focus();
});

app.whenReady().then(async () => {
	windowController.createMainWindow();
	await updateService.initialize();

	app.on("activate", () => {
		if (windowController.mainWindow === null) {
			windowController.createMainWindow();
		}
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("will-quit", () => {
	globalShortcut.unregisterAll();
});
