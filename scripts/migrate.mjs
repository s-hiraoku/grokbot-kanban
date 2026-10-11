import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url || url === "pglite") {
	console.error("Set DATABASE_URL to the Neon connection string before migrating.");
	process.exit(1);
}

const sql = neon(url);
const text = readFileSync(new URL("../drizzle/0000_init.sql", import.meta.url), "utf8");
const statements = text
	.split(";")
	.map((statement) => statement.trim())
	.filter(Boolean);

for (const statement of statements) {
	await sql.query(statement);
}

console.log("Applied drizzle/0000_init.sql");
