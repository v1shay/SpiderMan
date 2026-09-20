import type { RacePhase } from './race-session';
import type { ActionInputState, InputSystem } from './input-system';

/** The synchronized countdown is the only race phase that freezes traversal. */
export function raceAllowsTraversalInput(phase?: RacePhase): boolean {
  return phase !== 'countdown';
}

/** Countdown gates gameplay output, never device state. Call after race.update(). */
export function sampleRaceInput(
  input: InputSystem,
  phase?: RacePhase,
  enabled = true,
): ActionInputState {
  return input.sample({ enabled: enabled && raceAllowsTraversalInput(phase) });
}
