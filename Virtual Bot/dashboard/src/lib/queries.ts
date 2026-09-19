import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post } from './api';

/*
 * Запити до бекенда. Один файл на всі ~90 ендпоїнтів переростив би себе,
 * тому тут лише те, що потрібне кільком розділам одночасно: стан, моделі,
 * сервіси. Вузькі запити живуть поруч зі своїм розділом.
 */

export interface BotStatus {
  omni: boolean;
  openclaw: boolean;
  anthropic: boolean;
  chat2api: boolean;
  vision: boolean;
  display: boolean;
  mode: string;
}

export interface ModelInfo {
  id: string;
  label?: string;
  [key: string]: unknown;
}

export interface ModelsResponse {
  models: ModelInfo[];
  selected: string;
  default: string;
  active: string;
  brain: string;
}

export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: () => get<BotStatus>('/api/status'),
    // Стан сервісів міняється рідко, але мовчки: опитуємо, бо SSE про нього
    // не повідомляє. 20 с — досить, щоб помітити падіння, і не досить, щоб
    // вантажити локальні health-перевірки.
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
}

export function useModels() {
  return useQuery({
    queryKey: ['models'],
    queryFn: () => get<ModelsResponse>('/api/models'),
    staleTime: 60_000,
  });
}

export function useSelectModel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (model: string) => post('/api/model', { model }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['models'] }),
  });
}

export interface ServiceState {
  [name: string]: unknown;
}

export function useServices() {
  return useQuery({
    queryKey: ['services'],
    queryFn: () => get<ServiceState>('/api/services'),
    refetchInterval: 15_000,
  });
}

export function useServiceAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ name, action }: { name: string; action: 'start' | 'stop' }) =>
      post(`/api/services/${encodeURIComponent(name)}/${action}`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['services'] });
      client.invalidateQueries({ queryKey: ['status'] });
    },
  });
}

/*
 * Мозок: моделі САМОГО OpenClaw і рівень його думання.
 *
 * Окремо від useModels (список Omni з config.yaml) навмисно: у чаті
 * відповідає OpenClaw своєю моделлю, і поки панель показувала список Omni,
 * вибір нічого не змінював — на екрані стояло одне, писало інше.
 */

export interface BrainModel {
  id: string;
  label: string;
  provider?: string;
  available?: boolean;
  context?: number;
  vision?: boolean;
  is_default?: boolean;
  fallback?: string;
}

export interface BrainModelsResponse {
  models: BrainModel[];
  selected: string;
  default: string;
  thinking: string;
  thinking_levels: string[];
  available: boolean;
}

export function useBrainModels() {
  return useQuery({
    queryKey: ['brain-models'],
    queryFn: () => get<BrainModelsResponse>('/api/brain/models'),
    // Каталог читається через CLI OpenClaw (~1 с) і міняється рідко.
    staleTime: 120_000,
  });
}

export function useSelectBrainModel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (model: string) => post('/api/brain/model', { model }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['brain-models'] });
      // У шапці показана модель, якою відповіли востаннє, — вона теж змінилась.
      void client.invalidateQueries({ queryKey: ['models'] });
    },
  });
}

export function useSetThinking() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (level: string) => post('/api/brain/thinking', { level }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['brain-models'] }),
  });
}
