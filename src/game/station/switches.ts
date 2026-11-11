export type SwitchId = 'inlet2' | 'protect' | 'feeder' | 'inlet1';

export interface Breakers {
  inlet2: boolean;
  protect: boolean;
  feeder: boolean;
}

export type ThrowOk = 'set' | 'noop' | 'trip' | 'short';

export function blankBreakers(): Breakers {
  return { inlet2: false, protect: false, feeder: false };
}

export function feederLive(state: Breakers): boolean {
  return state.inlet2 && state.protect && state.feeder;
}

/** Next legal step. `live` means the south-bank feeder is already closed. */
export function nextOrder(state: Breakers): 'inlet2' | 'protect' | 'feeder' | 'live' {
  if (!state.inlet2) return 'inlet2';
  if (!state.protect) return 'protect';
  if (!state.feeder) return 'feeder';
  return 'live';
}

export function throwBreaker(state: Breakers, id: SwitchId): { ok: ThrowOk; breakers: Breakers } {
  if (id === 'inlet1') return { ok: 'short', breakers: state };
  if (id === 'inlet2') {
    if (state.inlet2) return { ok: 'noop', breakers: state };
    if (state.protect || state.feeder) return { ok: 'trip', breakers: state };
    return { ok: 'set', breakers: { ...state, inlet2: true } };
  }
  if (id === 'protect') {
    if (state.protect) return { ok: 'noop', breakers: state };
    if (!state.inlet2 || state.feeder) return { ok: 'trip', breakers: state };
    return { ok: 'set', breakers: { ...state, protect: true } };
  }
  if (state.feeder) return { ok: 'noop', breakers: state };
  if (!state.inlet2 || !state.protect) return { ok: 'trip', breakers: state };
  return { ok: 'set', breakers: { ...state, feeder: true } };
}

/** Wrong order and a short both drop the breakers open. A short is not a trip. */
export function applyThrow(state: Breakers, id: SwitchId): { state: Breakers; ok: ThrowOk; live: boolean } {
  const result = throwBreaker(state, id);
  if (result.ok === 'set') {
    return { state: result.breakers, ok: 'set', live: feederLive(result.breakers) };
  }
  if (result.ok === 'noop') return { state, ok: 'noop', live: feederLive(state) };
  return { state: blankBreakers(), ok: result.ok, live: false };
}

export function canBind(
  px: number,
  pz: number,
  ex: number,
  ez: number,
  cx: number,
  cz: number,
  down: boolean,
  bound: boolean,
  chairFree: boolean,
): boolean {
  if (!down || bound || !chairFree) return false;
  return Math.hypot(px - cx, pz - cz) < 2.35 && Math.hypot(ex - cx, ez - cz) < 2.6;
}
