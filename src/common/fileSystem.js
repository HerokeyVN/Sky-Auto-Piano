import fs from "fs";
import path from "node:path";

/**
 * Ensure directory exists with optional mask.
 * @param {string} targetPath absolute path to ensure exists
 * @param {number} mask directory permissions
 */
export function ensureDirectory(targetPath, mask = 0o777) {
	try {
		fs.mkdirSync(targetPath, { mode: mask, recursive: true });
	} catch (error) {
		if (error.code !== "EEXIST") {
			throw error;
		}
	}
}

/**
 * Recursively copy folders preserving structure.
 * @param {string} sourcePath source directory
 * @param {string} destinationPath destination directory
 */
export function copyFolder(sourcePath, destinationPath) {
	ensureDirectory(destinationPath);
	const entries = fs.readdirSync(sourcePath, { withFileTypes: true });

	entries.forEach((entry) => {
		const sourceFile = path.join(sourcePath, entry.name);
		const destinationFile = path.join(destinationPath, entry.name);

		if (entry.isFile()) {
			fs.copyFileSync(sourceFile, destinationFile);
		} else {
			copyFolder(sourceFile, destinationFile);
		}
	});
}

/**
 * Recursively delete a directory if it exists.
 * @param {string} folderPath absolute folder path
 */
export function deleteFolderRecursive(folderPath) {
	if (!fs.existsSync(folderPath)) return;

	const entries = fs.readdirSync(folderPath, { withFileTypes: true });
	entries.forEach((entry) => {
		const entryPath = path.join(folderPath, entry.name);
		if (entry.isDirectory()) {
			deleteFolderRecursive(entryPath);
		} else {
			fs.unlinkSync(entryPath);
		}
	});
	fs.rmdirSync(folderPath);
}

/**
 * Safely delete a file with retries in case of locks.
 * @param {string} filePath absolute file path
 * @param {number} maxRetries number of attempts
 * @param {number} delayMs delay between attempts in milliseconds
 */
export async function safeDeleteFile(filePath, maxRetries = 5, delayMs = 1000) {
	if (!fs.existsSync(filePath)) return;

	let lastError;
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			fs.unlinkSync(filePath);
			return;
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}

	throw new Error(`Failed to delete ${filePath} after ${maxRetries} attempts: ${lastError?.message}`);
}
