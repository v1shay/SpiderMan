import type { AttackTiming } from './combat-system.ts';

export type BossId = 'hulk' | 'venom' | 'ironman';
export type ProjectileStyle = 'bolt' | 'orb' | 'missile' | 'beam';
export type BossAttack = AttackTiming & {
  id: string; label: string;
  kind: 'melee' | 'slam' | 'charge' | 'leap' | 'projectile';
  clip: string; damage: number; radius: number; reach: number;
  speed?: number; cooldown?: number; projectileStyle?: ProjectileStyle;
  projectileCount?: number; spread?: number;
};
export type BossDefinition = {
  id: BossId; name: string; subtitle: string; asset: string; portrait: string;
  height: number; health: number; speed: number; modelYaw: number; accent: string;
  clips: { idle: string; move: string; hit: string; stunned: string; dead: string; intro: string };
  attacks: readonly BossAttack[]; phases: readonly string[];
};

export const BOSS_DEFINITIONS: Record<BossId, BossDefinition> = {
  hulk: {
    id: 'hulk', name: 'HULK', subtitle: 'THE STRONGEST ONE THERE IS',
    asset: '/assets/bosses/hulk.glb', portrait: '/assets/previews/bosses/hulk.png',
    height: 3.6, health: 560, speed: 6.4, modelYaw: Math.PI, accent: '#82f05f',
    clips: { idle: 'Idle_C', move: 'Walk_Fwd_C', hit: 'Giddiness', stunned: 'Giddiness', dead: 'Dead_B', intro: 'Fight_Start' },
    phases: [
      'Read the shoulders. Dodge the rush and punish the recovery.',
      'Web the arms after a smash. Use height to clear the shockwave.',
      'Survive the leap chain. Turn the final charge into the wall.',
    ],
    attacks: [
      { id: 'gamma-jab', label: 'GAMMA JAB', kind: 'melee', clip: '101211_Punch_01', startup: 1.05, active: .22, recovery: 1.25, damage: 16, radius: 2.5, reach: 6, cooldown: 1.55 },
      { id: 'backhand', label: 'BACKHAND', kind: 'melee', clip: '101211_Punch_02', startup: 1.25, active: .24, recovery: 1.45, damage: 19, radius: 3, reach: 7.2, cooldown: 1.7 },
      { id: 'breaker-combo', label: 'BREAKER COMBO', kind: 'melee', clip: '101211_Punch_04', startup: 1.5, active: .34, recovery: 1.65, damage: 22, radius: 3.2, reach: 8, cooldown: 1.8 },
      { id: 'gamma-hook', label: 'GAMMA HOOK', kind: 'melee', clip: '101211_Punch_03', startup: 1.2, active: .24, recovery: 1.4, damage: 18, radius: 2.8, reach: 7, cooldown: 1.6 },
      { id: 'earthbreaker', label: 'EARTHBREAKER', kind: 'slam', clip: 'Smashing', startup: 2, active: .32, recovery: 2.2, damage: 26, radius: 11, reach: 16, cooldown: 2.1 },
      { id: 'bull-rush', label: 'BULL RUSH', kind: 'charge', clip: 'Run_Fwd_C', startup: 1.85, active: 1.65, recovery: 2.25, damage: 28, radius: 2.3, reach: 48, speed: 17, cooldown: 2.2 },
      { id: 'skybreaker', label: 'SKYBREAKER', kind: 'leap', clip: '101291_Jump_Attack_Start', startup: 1.65, active: 1.35, recovery: 2.1, damage: 25, radius: 8, reach: 72, speed: 23, cooldown: 2.25 },
      { id: 'turning-fist', label: 'TURNING FIST', kind: 'melee', clip: '101211_Punch_Turn_R', startup: 1.35, active: .25, recovery: 1.45, damage: 18, radius: 3, reach: 7, cooldown: 1.6 },
      { id: 'reverse-turning-fist', label: 'REVERSE BACKFIST', kind: 'melee', clip: '101211_Punch_Turn_L', startup: 1.45, active: .26, recovery: 1.5, damage: 19, radius: 3, reach: 7.5, cooldown: 1.7 },
      { id: 'gamma-grab', label: 'GAMMA GRAB', kind: 'melee', clip: '101199_Throw_Start', startup: 1.75, active: .32, recovery: 2.05, damage: 25, radius: 2.4, reach: 5.5, cooldown: 2.2 },
      { id: 'repulse-roar', label: 'GAMMA REPULSE', kind: 'slam', clip: 'Repulse_Start', startup: 2.2, active: .38, recovery: 2.1, damage: 23, radius: 13, reach: 18, cooldown: 2.4 },
    ],
  },
  venom: {
    id: 'venom', name: 'VENOM', subtitle: 'LETHAL PROTECTOR',
    asset: '/assets/bosses/venom.glb', portrait: '/assets/previews/bosses/venom.png',
    height: 3.1, health: 440, speed: 9.2, modelYaw: Math.PI, accent: '#f4f5ff',
    clips: { idle: 'Idle_C', move: 'Walk_Fwd_C', hit: 'SmashRecover', stunned: 'Giddiness', dead: 'SmashLieDown', intro: '103581_Symbiote' },
    phases: [
      'Circle the tendrils. Counter after the second lash.',
      'Keep him in view through the rooftop pursuit.',
      'Dodge the pounce chain, then bind him during recovery.',
    ],
    attacks: [
      { id: 'claw-one', label: 'SAVAGE CLAW', kind: 'melee', clip: '103511_Attack01', startup: 1.05, active: .26, recovery: 1.25, damage: 16, radius: 2.5, reach: 7.5, cooldown: 1.35 },
      { id: 'claw-two', label: 'RAVAGER COMBO', kind: 'melee', clip: '103511_Attack02', startup: 1.3, active: .32, recovery: 1.45, damage: 19, radius: 2.8, reach: 8.5, cooldown: 1.5 },
      { id: 'claw-three', label: 'DEVOURING SWEEP', kind: 'melee', clip: '103511_Attack03', startup: 1.65, active: .38, recovery: 1.7, damage: 22, radius: 3.2, reach: 10, cooldown: 1.75 },
      { id: 'tendril-left', label: 'TENDRIL LASH', kind: 'melee', clip: '103521_Tentacles_01', startup: 1.4, active: .28, recovery: 1.55, damage: 18, radius: 2.2, reach: 16, cooldown: 1.65 },
      { id: 'tendril-cross', label: 'CROSS LASH', kind: 'melee', clip: '103521_Tentacles_02', startup: 1.7, active: .36, recovery: 1.8, damage: 21, radius: 2.8, reach: 19, cooldown: 1.8 },
      { id: 'predator-pounce', label: 'PREDATOR POUNCE', kind: 'leap', clip: '103531_Descent_Start', startup: 1.55, active: 1.15, recovery: 1.85, damage: 24, radius: 6, reach: 76, speed: 25, cooldown: 2 },
      { id: 'symbiote-rush', label: 'SYMBIOTE RUSH', kind: 'charge', clip: '103551_Ground_Flight_Start_C', startup: 1.6, active: 1.1, recovery: 1.8, damage: 21, radius: 2, reach: 42, speed: 19, cooldown: 1.9 },
      { id: 'shackle', label: 'SYMBIOTE SHACKLE', kind: 'melee', clip: '103541_Shackle', startup: 1.9, active: .4, recovery: 2, damage: 24, radius: 3, reach: 18, cooldown: 2.15 },
      { id: 'predator-dash-right', label: 'PREDATOR DASH', kind: 'charge', clip: '103551_Dash_R', startup: 1.45, active: .85, recovery: 1.75, damage: 19, radius: 2.2, reach: 34, speed: 18, cooldown: 1.8 },
      { id: 'predator-dash-left', label: 'HUNTER DASH', kind: 'charge', clip: '103551_Dash_L', startup: 1.55, active: .9, recovery: 1.8, damage: 20, radius: 2.2, reach: 36, speed: 18.5, cooldown: 1.9 },
      { id: 'wall-pounce', label: 'WALL POUNCE', kind: 'leap', clip: 'Onwall_To_Jump', startup: 1.85, active: 1.2, recovery: 2, damage: 25, radius: 6.5, reach: 82, speed: 26, cooldown: 2.3 },
    ],
  },
  ironman: {
    id: 'ironman', name: 'IRON MAN', subtitle: 'ARMORED AVENGER',
    asset: '/assets/bosses/ironman.glb', portrait: '/assets/previews/bosses/ironman.png',
    height: 2.15, health: 390, speed: 9.5, modelYaw: Math.PI, accent: '#60dfff',
    clips: { idle: 'fly_idle', move: 'fly_slow', hit: 'pain_blocking', stunned: 'blocking', dead: 'victim1', intro: 'menu_action' },
    phases: [
      'Strafe the repulsor line. Close in while the gauntlets cool.',
      'Swing through the fan barrage and punish the hover reset.',
      'Bait the missile spread, then attack through the blue-core cooldown.',
    ],
    attacks: [
      { id: 'repulsor-bolt', label: 'REPULSOR BOLT', kind: 'projectile', clip: 'power_4', startup: 1.35, active: .55, recovery: 1.45, damage: 12, radius: .55, reach: 180, speed: 52, cooldown: 1.35, projectileStyle: 'bolt', projectileCount: 1 },
      { id: 'twin-repulsor', label: 'TWIN REPULSORS', kind: 'projectile', clip: 'power_5', startup: 1.55, active: .7, recovery: 1.6, damage: 10, radius: .5, reach: 180, speed: 48, cooldown: 1.5, projectileStyle: 'bolt', projectileCount: 2, spread: .07 },
      { id: 'repulsor-fan', label: 'REPULSOR FAN', kind: 'projectile', clip: 'power_6', startup: 1.7, active: .85, recovery: 1.75, damage: 9, radius: .48, reach: 175, speed: 44, cooldown: 1.65, projectileStyle: 'orb', projectileCount: 5, spread: .14 },
      { id: 'micro-missiles', label: 'MICRO-MISSILE SPREAD', kind: 'projectile', clip: 'power_8', startup: 2, active: 1, recovery: 2.05, damage: 14, radius: .75, reach: 190, speed: 34, cooldown: 2.1, projectileStyle: 'missile', projectileCount: 5, spread: .12 },
      { id: 'unibeam', label: 'UNIBEAM', kind: 'projectile', clip: 'power_9', startup: 2.25, active: .65, recovery: 2.3, damage: 24, radius: 1.1, reach: 210, speed: 78, cooldown: 2.5, projectileStyle: 'beam', projectileCount: 1 },
      { id: 'aerial-dive', label: 'AERIAL DIVE', kind: 'charge', clip: 'fly_fast', startup: 1.55, active: 1.15, recovery: 2, damage: 20, radius: 1.8, reach: 72, speed: 24, cooldown: 2 },
      { id: 'armor-combo', label: 'ARMOR COMBO', kind: 'melee', clip: 'attack_light3', startup: 1.15, active: .25, recovery: 1.35, damage: 16, radius: 2.2, reach: 6.5, cooldown: 1.45 },
      { id: 'repulsor-snap', label: 'REPULSOR SNAP', kind: 'projectile', clip: 'power_1', startup: 1.25, active: .5, recovery: 1.35, damage: 11, radius: .45, reach: 180, speed: 56, cooldown: 1.3, projectileStyle: 'bolt', projectileCount: 1 },
      { id: 'repulsor-crossfire', label: 'CROSSFIRE', kind: 'projectile', clip: 'power_2', startup: 1.65, active: .72, recovery: 1.7, damage: 10, radius: .5, reach: 185, speed: 47, cooldown: 1.65, projectileStyle: 'bolt', projectileCount: 3, spread: .1 },
      { id: 'pulse-orbs', label: 'PULSE ORBS', kind: 'projectile', clip: 'power_3', startup: 1.8, active: .82, recovery: 1.8, damage: 12, radius: .68, reach: 175, speed: 38, cooldown: 1.85, projectileStyle: 'orb', projectileCount: 4, spread: .13 },
      { id: 'repulsor-lance', label: 'REPULSOR LANCE', kind: 'projectile', clip: 'power_7', startup: 2.05, active: .65, recovery: 2.15, damage: 21, radius: .88, reach: 205, speed: 70, cooldown: 2.25, projectileStyle: 'beam', projectileCount: 1 },
      { id: 'smart-missiles', label: 'SMART MISSILES', kind: 'projectile', clip: 'power_12', startup: 2.15, active: .95, recovery: 2.2, damage: 13, radius: .72, reach: 195, speed: 35, cooldown: 2.35, projectileStyle: 'missile', projectileCount: 6, spread: .1 },
      { id: 'rocket-uppercut', label: 'ROCKET UPPERCUT', kind: 'melee', clip: 'attack_heavy1', startup: 1.5, active: .3, recovery: 1.75, damage: 21, radius: 2.5, reach: 7, cooldown: 1.8 },
      { id: 'armor-knockback', label: 'ARMOR KNOCKBACK', kind: 'melee', clip: 'attack_knockback1', startup: 1.7, active: .34, recovery: 1.9, damage: 23, radius: 2.8, reach: 8, cooldown: 2 },
    ],
  },
};
