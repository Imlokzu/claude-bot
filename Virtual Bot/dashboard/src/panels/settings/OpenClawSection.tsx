import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Input, Select } from '@/components/ui/Field';
import { SkeletonList } from '@/components/ui/Feedback';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toaster';
import { get, post } from '@/lib/api';
import { useBrainModels } from '@/lib/queries';
import { groupLabel, ocText, t } from '@/locales/settings';
import { SettingGroup, SettingRow } from './SettingRow';

/*
 * OpenClaw settings the panel is allowed to change. The list comes from
 * the server allowlist; labels live here. A toggle writes immediately.
 * A number or a text field writes when it loses focus, and an empty
 * field clears the path so the gateway default returns.
 */

export interface OcField {
  path: string;
  section: string;
  group: string;
  kind: 'bool' | 'int' | 'enum' | 'string' | 'model';
  options: string[];
  value: boolean | number | string | null;
  unset: boolean;
}

interface OcSettings {
  available: boolean;
  fields: OcField[];
}

const control = 'h-8 w-[180px] text-[13px]';
const modelControl = 'h-8 w-[220px] text-[13px]';

export function useOpenClawSettings() {
  return useQuery({
    queryKey: ['openclaw-settings'],
    queryFn: () => get<OcSettings>('/api/openclaw/settings'),
  });
}

export function fieldMatches(field: OcField, needle: string): boolean {
  if (!needle) return true;
  const haystack = `${ocText(field.path)} ${ocText(field.path, true)} openclaw`.toLowerCase();
  return haystack.includes(needle);
}

/*
 * Gateway rows for one settings tab. Local rows of that tab stay in
 * SettingsPanel; this only fills the categories that belong to OpenClaw.
 */
export function OpenClawFields({
  section,
  query,
  group,
  skipGroups = [],
}: {
  section: string;
  query: string;
  group?: string;
  skipGroups?: string[];
}) {
  const toast = useToast();
  const client = useQueryClient();
  const settings = useOpenClawSettings();
  const brain = useBrainModels();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: { path: string; value: boolean | number | string | null }) =>
      post('/api/openclaw/settings', body),
    onSuccess: () => {
      toast.ok(t('settings.saved'));
      void client.invalidateQueries({ queryKey: ['openclaw-settings'] });
      void client.invalidateQueries({ queryKey: ['brain-models'] });
    },
    onError: (error: Error) => toast.error(t('settings.failed'), error.message),
    onSettled: () => setPending(null),
  });

  if (settings.isPending) {
    if (skipGroups.length > 0) return null;
    return (
      <SettingGroup>
        <div className="p-4"><SkeletonList rows={4} /></div>
      </SettingGroup>
    );
  }

  if (!settings.data?.available) {
    if (section !== 'brain' || group) return null;
    return <p className="px-1 text-[13px] text-ink-3">{t('settings.unavailable')}</p>;
  }

  const needle = query.trim().toLowerCase();
  const fields = settings.data.fields.filter((field) => {
    if (field.section !== section || !fieldMatches(field, needle)) return false;
    if (group && field.group !== group) return false;
    if (skipGroups.includes(field.group)) return false;
    return true;
  });

  if (fields.length === 0) return null;

  const groups: { id: string; fields: OcField[] }[] = [];
  for (const field of fields) {
    const last = groups[groups.length - 1];
    if (last?.id === field.group) last.fields.push(field);
    else groups.push({ id: field.group, fields: [field] });
  }

  const write = (field: OcField, value: boolean | number | string | null) => {
    setPending(field.path);
    save.mutate({ path: field.path, value });
  };

  const commitText = (field: OcField) => {
    const draft = drafts[field.path];
    if (draft === undefined) return;
    const current = field.unset || field.value == null ? '' : String(field.value);
    if (draft.trim() === current) return;
    if (field.kind === 'int') {
      if (draft.trim() === '') {
        write(field, null);
        return;
      }
      const number = Number(draft);
      if (!Number.isInteger(number)) return;
      write(field, number);
      return;
    }
    write(field, draft.trim() === '' ? null : draft.trim());
  };

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <SettingGroup key={group.id} label={groupLabel(group.id)}>
          {group.fields.map((field) => {
            const stored = field.unset || field.value == null ? '' : String(field.value);
            const shown = drafts[field.path] ?? stored;
            const liveModel = field.path === 'agents.defaults.model.primary'
              ? (brain.data?.selected || stored || brain.data?.default || '')
              : stored;
            const modelOptions = brain.data?.models ?? [];
            const modelValue = modelOptions.some((model) => model.id === liveModel) ? liveModel : '';
            return (
              <SettingRow
                key={field.path}
                label={ocText(field.path)}
                hint={ocText(field.path, true)}
                htmlFor={field.path}
                mark={t('settings.source.openclaw')}
              >
                {field.kind === 'bool' ? (
                  <Switch
                    checked={field.value === true}
                    disabled={pending === field.path}
                    label={ocText(field.path)}
                    onChange={(next) => write(field, next)}
                  />
                ) : field.kind === 'model' ? (
                  <Select
                    id={field.path}
                    className={modelControl}
                    disabled={pending === field.path}
                    value={modelValue}
                    onChange={(event) => write(field, event.target.value)}
                  >
                    <option value="">{t('settings.inherit')}</option>
                    {modelOptions.map((model) => (
                      <option key={model.id} value={model.id}>{model.label}</option>
                    ))}
                  </Select>
                ) : field.kind === 'enum' ? (
                  <Select
                    id={field.path}
                    className={control}
                    disabled={pending === field.path}
                    value={field.unset || field.value == null ? '' : String(field.value)}
                    onChange={(event) => write(field, event.target.value)}
                  >
                    <option value="">{t('settings.inherit')}</option>
                    {field.options.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    id={field.path}
                    className={control}
                    disabled={pending === field.path}
                    inputMode={field.kind === 'int' ? 'numeric' : 'text'}
                    value={shown}
                    placeholder={t('settings.inherit')}
                    onChange={(event) => setDrafts((current) => ({ ...current, [field.path]: event.target.value }))}
                    onBlur={() => commitText(field)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                    }}
                  />
                )}
              </SettingRow>
            );
          })}
        </SettingGroup>
      ))}
    </div>
  );
}
