import fs from "fs";
import path from "node:path";
import axios from "axios";
import { Notification, app } from "electron/main";
import { downloadToFile } from "../../common/download.js";
import { extractZip } from "../../common/archive.js";
import {
	ensureDirectory,
	copyFolder,
	deleteFolderRecursive,
	safeDeleteFile,
} from "../../common/fileSystem.js";

export class UpdateService {
	constructor(appDirectory, configService) {
		this.appDirectory = appDirectory;
		this.configService = configService;
		this.linkUpdate = "https://github.com/HerokeyVN/Sky-Auto-Piano/archive/refs/heads/main.zip";
		this.moduleUpdate = "https://raw.githubusercontent.com/HerokeyVN/Temp/main/mdl_SAM/node_modules.zip";
		this.packageUpdate = "https://raw.githubusercontent.com/HerokeyVN/Sky-Auto-Piano/main/package.json";
		this.folderUpdate = "Sky-Auto-Piano-main";
		this.state = {
			isUpdating: false,
			updateType: "",
			updateProgress: 0,
			updatedNotification: undefined,
		};
		this.mainWindow = null;
	}

	setMainWindow(win) {
		this.mainWindow = win;
	}

	get isUpdating() {
		return this.state.isUpdating;
	}

	get updateType() {
		return this.state.updateType;
	}

	updateProgress(progress) {
		this.state.updateProgress = progress;
		if (this.mainWindow && !this.mainWindow.isDestroyed()) {
			this.mainWindow.webContents.send("update-progress", {
				progress,
				type: this.state.updateType,
			});
		}
	}

	showToast(title, message, type = 1) {
		if (this.mainWindow && !this.mainWindow.isDestroyed()) {
			this.mainWindow.webContents.send("show-update-notification", {
				title,
				message,
				type,
			});
		}
		console.log(`${title}: ${message}`);
	}

	async initialize() {
		await this.cleanupPendingFiles();

		const config = this.configService.value;
		if (config.update?.blockUpdate) {
			return;
		}

		let pkgLocal;
		let pkgUpdate;

		try {
			pkgLocal = JSON.parse(
				fs.readFileSync(path.join(this.appDirectory, "package.json"), "utf-8"),
			);
			pkgUpdate = (await axios.get(this.packageUpdate)).data;
		} catch (error) {
			console.error("UpdateService", "Failed to fetch update metadata", error);
			return;
		}

		const moduleUpdateNeeded =
			pkgUpdate.module_version !== pkgLocal.module_version ||
			!fs.existsSync(path.join(this.appDirectory, "node_modules", ".bin"));

		if (moduleUpdateNeeded) {
			await this.performModuleUpdate(pkgUpdate);
		}

		await this.performUpdate();
	}

	async cleanupPendingFiles() {
		try {
			const cleanupFilePath = path.join(this.appDirectory, "cleanup-files.json");
			if (!fs.existsSync(cleanupFilePath)) return;

			const filesToDelete = JSON.parse(fs.readFileSync(cleanupFilePath, "utf-8"));
			const remaining = [];

			for (const file of filesToDelete) {
				try {
					if (fs.existsSync(file)) {
						fs.unlinkSync(file);
						console.log("Cleanup", `Deleted ${file}`);
					}
				} catch (error) {
					console.error("Cleanup", `Failed to delete ${file}`, error.message);
					remaining.push(file);
				}
			}

			if (remaining.length === 0) {
				fs.unlinkSync(cleanupFilePath);
			} else {
				fs.writeFileSync(cleanupFilePath, JSON.stringify(remaining));
			}
		} catch (error) {
			console.error("Cleanup", "Failed to cleanup pending files", error);
		}
	}

	async performModuleUpdate(pkgUpdate) {
		try {
			this.state.isUpdating = true;
			this.state.updateType = "module";
			this.updateProgress(0);

			this.showToast(
				"Updating support modules...",
				"Downloading required modules.",
				2,
			);

			const zipPath = await downloadToFile(
				this.appDirectory,
				"node_modules.zip",
				this.moduleUpdate,
				(progress) => this.updateProgress(progress),
			);

			this.showToast(
				"Installing modules...",
				"Extracting support modules.",
				2,
			);

			await extractZip(zipPath, this.appDirectory);

			try {
				await safeDeleteFile(zipPath, 5, 1000);
			} catch (error) {
				const cleanupPath = path.join(this.appDirectory, "cleanup-files.json");
				const list = fs.existsSync(cleanupPath)
					? JSON.parse(fs.readFileSync(cleanupPath, "utf-8"))
					: [];
				if (!list.includes(zipPath)) {
					list.push(zipPath);
					fs.writeFileSync(cleanupPath, JSON.stringify(list));
				}
			}

			this.showToast("Modules Updated", "Support modules installed.", 1);
			this.state.isUpdating = false;
			return true;
		} catch (error) {
			this.state.isUpdating = false;
			this.showToast("Update Failed", "Could not install support modules.", 3);
			console.error("UpdateService", "Module update failed", error);
			return false;
		}
	}

	async performUpdate(options = {}) {
		const { isManualUpdate = false, skipVersionCheck = false, responseCallback = null } = options;
		const config = this.configService.value;

		if (!isManualUpdate && config.update?.blockUpdate) {
			return false;
		}

		let pkgLocal;
		let pkgUpdate;

		try {
			pkgLocal = JSON.parse(
				fs.readFileSync(path.join(this.appDirectory, "package.json"), "utf-8"),
			);
			pkgUpdate = (await axios.get(this.packageUpdate)).data;
		} catch (error) {
			console.error("UpdateService", "Failed to fetch package info", error);
			if (responseCallback) {
				responseCallback({ success: false, error: "Failed to connect to update server." });
			}
			return false;
		}

		const currentVersion = pkgLocal.version;
		const latestVersion = pkgUpdate.version;
		const updateNeeded = skipVersionCheck || currentVersion !== latestVersion;

		if (!updateNeeded && !isManualUpdate) {
			return false;
		}

		const updateDir = path.join(this.appDirectory, "update");
		if (fs.existsSync(updateDir)) {
			deleteFolderRecursive(updateDir);
		}
		ensureDirectory(updateDir);

		const updateInfo = {
			previousVersion: currentVersion,
			newVersion: latestVersion,
			updateTime: new Date().toISOString(),
			showChangelog: true,
		};
		fs.writeFileSync(
			path.join(this.appDirectory, "config", "update-info.json"),
			JSON.stringify(updateInfo, null, 2),
		);

		try {
			this.state.isUpdating = true;
			this.state.updateType = "core";
			this.updateProgress(0);

			this.showToast(
				"Updating Sky Auto Piano...",
				"Downloading latest version.",
				2,
			);

			const zipPath = await downloadToFile(
				updateDir,
				"update.zip",
				this.linkUpdate,
				(progress) => this.updateProgress(progress),
			);

			this.showToast("Installing update...", "Applying latest version.", 2);
			await extractZip(zipPath, updateDir);
			fs.unlinkSync(zipPath);

			const sourceRoot = path.join(updateDir, this.folderUpdate);
			const entries = fs.readdirSync(sourceRoot);
			entries.forEach((entry) => {
				if (entry === "data") return;
				const sourcePath = path.join(sourceRoot, entry);
				const targetPath = path.join(this.appDirectory, entry);
				if (fs.lstatSync(sourcePath).isDirectory()) {
					copyFolder(sourcePath, targetPath);
				} else {
					fs.copyFileSync(sourcePath, targetPath);
				}
			});

			deleteFolderRecursive(sourceRoot);

			this.state.isUpdating = false;
			this.state.updatedNotification = {
				title: "Update Complete",
				body: "Restart the app to apply updates.",
				type: 1,
			};

			this.showToast(
				this.state.updatedNotification.title,
				this.state.updatedNotification.body,
				this.state.updatedNotification.type,
			);

			const systemNotification = new Notification({
				title: this.state.updatedNotification.title,
				body: this.state.updatedNotification.body,
				icon: path.join(this.appDirectory, "icon", "Icon9.ico"),
				silent: false,
			});
			systemNotification.on("click", () => {
				app.relaunch();
				app.quit();
			});
			systemNotification.show();

			if (responseCallback) {
				responseCallback({ success: true });
			}
			return true;
		} catch (error) {
			this.state.isUpdating = false;
			this.showToast("Update Failed", "Unable to complete update.", 3);
			console.error("UpdateService", "Update failed", error);
			if (responseCallback) {
				responseCallback({ success: false, error: "Failed to complete update." });
			}
			return false;
		}
	}

	getPendingNotification() {
		return this.state.updatedNotification;
	}

	async getVersionInfo() {
		try {
			const { local, remote } = await this.getPackageMetadata();
			return {
				currentVersion: local.version,
				latestVersion: remote.version,
			};
		} catch (error) {
			console.error("UpdateService", "Failed to load version info", error);
			throw error;
		}
	}

	async getPackageMetadata() {
		try {
			const pkgLocal = JSON.parse(
				fs.readFileSync(path.join(this.appDirectory, "package.json"), "utf-8"),
			);
			const pkgRemote = (await axios.get(this.packageUpdate)).data;
			return {
				local: pkgLocal,
				remote: pkgRemote,
			};
		} catch (error) {
			console.error("UpdateService", "Failed to load package metadata", error);
			throw error;
		}
	}
}
