import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Every drizzle/*.sql file in name order. Each file is written to be safe to apply twice.
export function migrationSql(root = process.cwd()): string {
	const dir = path.join(root, "drizzle");
	return readdirSync(dir)
		.filter((name) => name.endsWith(".sql"))
		.sort()
		.map((name) => readFileSync(path.join(dir, name), "utf8"))
		.join("\n");
}
