const KEY = 'qinghua-night-progress-v1';

export interface Progress {
  cleared: string[];
}

/** Failures must not wipe this. Only a cleared chapter is written. */
export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { cleared: [] };
    const parsed = JSON.parse(raw) as Partial<Progress>;
    const cleared = Array.isArray(parsed.cleared) ? parsed.cleared.filter((id) => typeof id === 'string') : [];
    return { cleared };
  } catch {
    return { cleared: [] };
  }
}

export function markCleared(id: string): void {
  const progress = loadProgress();
  if (progress.cleared.includes(id)) return;
  progress.cleared.push(id);
  localStorage.setItem(KEY, JSON.stringify(progress));
}
