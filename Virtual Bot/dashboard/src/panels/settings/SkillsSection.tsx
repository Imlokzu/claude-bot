import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Compass, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { Switch } from '@/components/ui/Switch';
import { Empty, ErrorNote, SkeletonList } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toaster';
import { post } from '@/lib/api';
import { glue } from '@/lib/glue';
import { t } from '@/locales/extensions';
import { Badge, EXTENSIONS_KEY, useExtensions } from './McpSection';
import { SettingGroup } from './SettingRow';
import type { InstalledSkill } from './types';

/*
 * Every skill OpenClaw can see, with its on/off switch.
 *
 * The switch writes skills.entries.<name>.enabled through the CLI. OpenClaw
 * lists well over a hundred skills, so the list filters locally: it is
 * already in memory, so there is nothing to search on the server.
 */

type Filter = 'all' | 'on' | 'off';

export function SkillsSection({ onDiscover }: { onDiscover: () => void }) {
  const toast = useToast();
  const client = useQueryClient();
  const data = useExtensions();
  const [filter, setFilter] = useState<Filter>('all');
  const [needle, setNeedle] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const skills = data.data?.skills ?? [];
  const shown = useMemo(() => {
    const query = needle.trim().toLowerCase();
    return skills.filter((skill) => {
      if (filter === 'on' && !skill.enabled) return false;
      if (filter === 'off' && skill.enabled) return false;
      if (!query) return true;
      return `${skill.name} ${skill.description}`.toLowerCase().includes(query);
    });
  }, [skills, filter, needle]);

  const toggle = async (skill: InstalledSkill, enabled: boolean) => {
    setBusy(skill.name);
    try {
      await post(`/api/extensions/skills/${encodeURIComponent(skill.name)}/enabled`, { enabled });
      toast.ok(t('ext.saved'));
      await client.invalidateQueries({ queryKey: EXTENSIONS_KEY });
    } catch (error) {
      toast.error(t('ext.failed'), (error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (data.isPending) {
    return (
      <SettingGroup>
        <div className="p-4"><SkeletonList rows={6} /></div>
      </SettingGroup>
    );
  }
  if (data.isError) {
    return <ErrorNote message={(data.error as Error).message} onRetry={() => void data.refetch()} />;
  }
  if (!data.data.available) {
    return <ErrorNote message={glue(t('ext.unavailable'))} />;
  }

  const on = skills.filter((skill) => skill.enabled).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[440px] text-[12px] leading-snug text-ink-3">{glue(t('ext.skills.hint'))}</p>
        <Button size="sm" variant="outline" onClick={onDiscover}>
          <Compass />
          {t('ext.skills.discover')}
        </Button>
      </div>

      {data.data.errors.skills ? <ErrorNote message={data.data.errors.skills} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
          <input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            placeholder={t('ext.skills.search')}
            aria-label={t('ext.skills.search')}
            className="h-8 w-full rounded-md border border-line bg-surface-2 pl-8 pr-2 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
        </div>
        <Segmented
          ariaLabel={t('ext.skills.filter')}
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'all', label: t('ext.skills.all') },
            { value: 'on', label: t('ext.skills.on') },
            { value: 'off', label: t('ext.skills.off') },
          ]}
        />
      </div>

      <SettingGroup label={`${t('ext.skills.head')} · ${t('ext.skills.count', { on, total: skills.length })}`}>
        {shown.length === 0 ? (
          <div className="p-4"><Empty title={t('ext.skills.empty')} /></div>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((skill) => (
              <li key={skill.name} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
                    <span className="font-mono">{skill.name}</span>
                    {skill.bundled ? <Badge>{t('ext.skills.bundled')}</Badge> : skill.source ? <Badge>{skill.source}</Badge> : null}
                  </p>
                  {skill.description ? (
                    <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-3">{skill.description}</p>
                  ) : null}
                  {skill.missing.length > 0 ? (
                    <p className="mt-0.5 font-mono text-[11px] text-warn">
                      {t('ext.skills.missing', { what: skill.missing.join(', ') })}
                    </p>
                  ) : null}
                </div>
                <Switch
                  checked={skill.enabled}
                  disabled={busy === skill.name}
                  onChange={(next) => void toggle(skill, next)}
                  label={skill.name}
                />
              </li>
            ))}
          </ul>
        )}
      </SettingGroup>
    </div>
  );
}
