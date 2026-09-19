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
  keys_set: { omni: boolean; openclaw: boolean };
}

export interface StoreSkill {
  slug: string;
  name?: string;
  description?: string;
  installed?: boolean;
  version?: string;
}

export interface StoreMcp {
  id: string;
  label?: string;
  name?: string;
  description?: string;
  hint?: string;
  installed?: boolean;
}

export interface StoreCatalog {
  skills: StoreSkill[];
  mcp: StoreMcp[];
  installed: { skills: string[]; mcp: string[] };
  errors: Record<string, string>;
  openclaw: { available: boolean };
}
