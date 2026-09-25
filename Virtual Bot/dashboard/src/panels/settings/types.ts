export interface Profile {
  configured: boolean;
  name: string;
  language: string;
  persona: string;
  persona_custom: string;
  greeting: string;
  reply_length: string;
  use_emoji: boolean;
  spontaneous: boolean;
}

export interface Option {
  id: string;
  label: string;
  hint?: string;
  icon?: string;
}

export interface SetupData {
  profile: Profile;
  configured: boolean;
  languages: Option[];
  personas: Option[];
  reply_lengths: Option[];
  models: { id: string; label?: string }[];
  selected_model: string;
  keys_set: { omni: boolean; openclaw: boolean; openclaw_source?: 'openclaw' | 'env' };
}

/** One entry of OpenClaw's mcp.servers. Env and header values never arrive. */
export interface McpServer {
  name: string;
  transport: 'stdio' | 'http';
  launch: string;
  enabled: boolean;
  env_keys: string[];
  header_keys: string[];
  builtin: boolean;
}

export interface InstalledSkill {
  name: string;
  description: string;
  emoji: string;
  source: string;
  bundled: boolean;
  enabled: boolean;
  eligible: boolean;
  missing: string[];
  homepage: string;
}

export interface Extensions {
  available: boolean;
  mcp: McpServer[];
  skills: InstalledSkill[];
  errors: Record<string, string>;
}

export type CatalogSource = 'mcp-registry' | 'smithery' | 'clawhub' | 'skills-sh';

export interface CatalogItem {
  source: CatalogSource;
  kind: 'mcp' | 'skill';
  id: string;
  name: string;
  description: string;
  homepage: string;
  version?: string;
  popularity?: number;
  verified?: boolean;
  installable: boolean;
  via: string;
}

export interface CatalogResult {
  source: CatalogSource;
  kind: 'mcp' | 'skill';
  query: string;
  items: CatalogItem[];
}

export interface PlanField {
  name: string;
  description: string;
  required: boolean;
  secret: boolean;
  default: string;
  template: string;
}

export interface InstallPlan {
  source: CatalogSource;
  id: string;
  kind: 'mcp' | 'skill';
  name?: string;
  via?: string;
  transport?: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: PlanField[];
  headers?: PlanField[];
  ref?: string;
}
