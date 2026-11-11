export type WeaponName = 'hands' | 'bar' | 'gun';

/** Gear carried from the road into the station, or granted at a chapter-2 checkpoint. */
export interface Kit {
  health: number;
  hasFlash: boolean;
  flashOn: boolean;
  headlamp: boolean;
  hasBar: boolean;
  hasGun: boolean;
  ammoIn: number;
  ammoReserve: number;
  weapon: WeaponName;
}

export function stationCheckpoint(): Kit {
  return {
    health: 100,
    hasFlash: true,
    flashOn: true,
    headlamp: false,
    hasBar: true,
    hasGun: true,
    ammoIn: 4,
    ammoReserve: 2,
    weapon: 'gun',
  };
}
