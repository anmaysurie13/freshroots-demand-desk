import raw from "../../config/rules.json";

export type RulesConfig = typeof raw;

/** The single source of every threshold. Edited only through a code change plus a version bump. */
export const rulesConfig: RulesConfig = raw;
export const RULES_VERSION: string = raw.version;
