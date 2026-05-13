import AdmZip from "adm-zip";

/**
 * Extract zip file content to destination directory.
 * @param {string} filePath absolute path to zip file
 * @param {string} destinationPath destination directory
 * @returns {Promise<void>}
 */
export function extractZip(filePath, destinationPath) {
	return new Promise((resolve, reject) => {
		const zip = new AdmZip(filePath);
		zip.extractAllToAsync(destinationPath, true, (error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}
