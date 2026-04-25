import { join } from "path";
import { existsSync } from "fs";
import { readConfig } from "./agency-config.js";

export const READ_FLAGS = [
  "--allow", "ls", "--allow", "glob_search",
  "--allow", "grep_search", "--allow", "read_file", "--allow", "view_repo_map",
];
export const WRITE_FLAGS = [...READ_FLAGS, "--allow", "create_new_file", "--allow", "edit_existing_file"];
export const FULL_FLAGS  = [...WRITE_FLAGS, "--allow", "run_terminal_command"];

export function getModel() {
  const cfg = readConfig();
  return process.env.AGENCY_MODEL ?? cfg?.provider?.model ?? "gpt-4o";
}

export const isInitialized = () => existsSync(join(process.cwd(), ".continue", "rules"));
