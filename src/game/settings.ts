export type QualityName = 'low' | 'mid' | 'high';

export interface Settings {
  quality: QualityName;
  sensitivity: number;
  invertY: boolean;
  volume: number;
  fov: number;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'mid',
  sensitivity: 1,
  invertY: false,
  volume: 0.7,
  fov: 74,
};

const KEY = 'qinghua-night-settings-v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const quality: QualityName =
      parsed.quality === 'low' || parsed.quality === 'high' || parsed.quality === 'mid'
        ? parsed.quality
        : 'mid';
    return {
      quality,
      sensitivity: clamp(num(parsed.sensitivity, 1), 0.2, 3),
      invertY: Boolean(parsed.invertY),
      volume: clamp(num(parsed.volume, 0.7), 0, 1),
      fov: clamp(num(parsed.fov, 74), 60, 100),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
