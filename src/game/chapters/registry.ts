import type { Chapter, Host } from '../types';
import { HighwayChapter } from './highway';

export interface ChapterMeta {
  id: string;
  label: string;
  name: string;
  playable: boolean;
}

/** Later chapters stay in the menu. v0.1 only mounts the highway. */
export const CHAPTERS: ChapterMeta[] = [
  { id: 'south-road', label: '第一章', name: '南岸公路', playable: true },
  { id: 'substation', label: '第二章', name: '南岸变电站', playable: false },
  { id: 'bridge', label: '第三章', name: '青桦桥', playable: false },
  { id: 'cold-store', label: '第四章', name: '北栈冷库', playable: false },
  { id: 'clinic', label: '第五章', name: '县卫生院', playable: false },
];

export function createChapter(id: string, host: Host): Chapter {
  if (id === 'south-road') return new HighwayChapter(host);
  throw new Error(`章节尚未实现: ${id}`);
}
