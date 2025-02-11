import fs from 'fs';
import path from 'path';

import glob from 'glob';
import strip from 'strip-json-comments';

export function readJson<T = Record<string, any>>(filePath: string, fallBackContext?: T): T {
	let json: string;
	try {
		const aPath = path.isAbsolute(filePath) ? filePath : path.resolve(__dirname, filePath);
		// console.log(`READ: ${aPath}`);
		json = fs.readFileSync(aPath, {
			encoding: 'utf-8',
		});
	} catch (error) {
		// console.warn(error);
		if (fallBackContext != null) {
			json = JSON.stringify(fallBackContext);
		} else {
			throw error;
		}
	}
	json = strip(json);
	return JSON.parse(json) as T;
}

export async function readJsons<T = Record<string, any>>(
	pattern: string,
	hook: (fileName: string, body: T) => T | Promise<T> = (_, body) => body,
	fallbackContext?: T,
): Promise<T[]> {
	const files = await glob(path.resolve(__dirname, pattern));
	return Promise.all(
		files.map(file => {
			const json = readJson(file, fallbackContext);
			return hook(file, json);
		}),
	);
}
