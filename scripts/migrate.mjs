import { readdirSync, readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url || url === "pglite") {
	console.error("Set DATABASE_URL to the Neon connection string before migrating.");
	process.exit(1);
}

const sql = neon(url);
const dir = new URL("../drizzle/", import.meta.url);
const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();

for (const file of files) {
	const text = readFileSync(new URL(file, dir), "utf8");
	const statements = text
		.split(";")
		.map((statement) => statement.trim())
		.filter(Boolean);
	for (const statement of statements) {
		await sql.query(statement);
	}
	console.log(`Applied drizzle/${file}`);
}
