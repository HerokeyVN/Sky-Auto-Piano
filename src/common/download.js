import fs from "fs";
import path from "node:path";
import axios from "axios";
import { ensureDirectory } from "./fileSystem.js";

/**
 * Stream download helper that exposes progress via callback.
 * @param {string} directory target directory
 * @param {string} filename output filename
 * @param {string} url download url
 * @param {(progress: number) => void} onProgress progress handler 0-100
 */
export async function downloadToFile(directory, filename, url, onProgress = () => {}) {
	ensureDirectory(directory);
	let lastProgress = 0;

	const response = await axios({
		url,
		method: "GET",
		responseType: "stream",
	});

	const outputPath = path.join(directory, filename);
	const writer = fs.createWriteStream(outputPath);
	const totalLength = parseInt(response.headers["content-length"], 10);
	let downloadedBytes = 0;

	response.data.on("data", (chunk) => {
		downloadedBytes += chunk.length;
		if (!totalLength) return;

		const progress = Math.round((downloadedBytes / totalLength) * 100);
		if (progress !== lastProgress) {
			lastProgress = progress;
			onProgress(progress);
		}
	});

	response.data.pipe(writer);

	await new Promise((resolve, reject) => {
		writer.on("finish", resolve);
		writer.on("error", reject);
	});

	return outputPath;
}
