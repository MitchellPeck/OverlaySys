// Rewrites the generated tables in companion/HELP.md from the module's own definitions.
// Run with: pnpm --filter @overlaysys/companion-module gen:help (cwd = the package dir).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { currentHelpDefs, renderHelpTables, spliceHelp } from "../src/helpTables";

const path = resolve(process.cwd(), "companion/HELP.md");
writeFileSync(path, spliceHelp(readFileSync(path, "utf8"), renderHelpTables(currentHelpDefs())));
console.log(`Updated ${path}`);
