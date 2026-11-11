const KEY = 'qinghua-night-progress-v1';

export interface Progress {
  cleared: string[];
}

/** Read-only in v0.1. Later versions write chapter ids here. Failures must not wipe it. */
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
