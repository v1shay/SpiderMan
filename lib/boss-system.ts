import { BOSS_DEFINITIONS, type BossId, type BossAttack, type ProjectileStyle } from './boss-definitions.ts';
import { PlayerCombatState, createAttackClock, advanceAttack, attackStage, canAttackHit, registerAttackHit,
  sweptSphereHit, cv, cadd, csub, cmul, clen, cunit, type CombatVector, type AttackClock, type PlayerCombatAction } from './combat-system.ts';

export type BossWorld = {
  groundAt(point: CombatVector): number | null;
  move(from: CombatVector, to: CombatVector, radius: number): CombatVector;
  lineOfSight(from: CombatVector, to: CombatVector): boolean;
};
export type BossPlayerInput = { position: CombatVector; velocity: CombatVector; grounded: boolean; traversalMode: string;
  attackPressed?: boolean; heavyPressed?: boolean; launcherPressed?: boolean; grabPressed?: boolean; dodgePressed?: boolean;
  blockHeld?: boolean; webPressed?: boolean; webHeld?: boolean; tauntPressed?: boolean };
export type BossEvent = { type: 'player-hit' | 'boss-hit' | 'death' | 'victory' | 'phase' | 'attack' | 'dodge' | 'blocked' | 'web-shot' | 'web-pull' | 'restrained' | 'wall-stagger'; value?: number; position?: CombatVector };
export type BossProjectile = { id: number; position: CombatVector; velocity: CombatVector; radius: number; damage: number; life: number; style: ProjectileStyle };
type RuntimeAttack = { definition: BossAttack; clock: AttackClock; target: CombatVector; start: CombatVector; direction: CombatVector; volleyFired: number };
export type BossSnapshot = {
  id: BossId; name: string; status: 'active' | 'dead' | 'victory'; phase: number; health: number; maxHealth: number; playerHealth: number;
  position: CombatVector; facing: CombatVector; moving: boolean; vulnerable: number; hitReact: number; webProgress: number; webCooldown: number;
  escaping: boolean; pursuing: boolean; objective: string; playerAttacking: boolean; playerDodging: boolean; elapsed: number;
  timeScale: number; cinematic: 'intro' | null;
  player: { action: PlayerCombatAction; actionElapsed: number; actionDuration: number; activeStart: number; activeEnd: number; comboIndex: number; blocking: boolean };
  attack: { id: string; label: string; kind: BossAttack['kind']; stage: ReturnType<typeof attackStage>; time: number; duration: number; clip: string;
    target: CombatVector; radius: number; progress: number } | null;
  projectiles: BossProjectile[];
};

/** Deterministic combat sim. Rendering, key state, player movement and city queries remain external. */
export class BossSystem {
  private id: BossId | null = null;
  private player = new PlayerCombatState();
  private position = cv();
  private facing = cv(0, 0, -1);
  private strafeDirection = 1;
  private attack: RuntimeAttack | null = null;
  private health = 0;
  private phase = 0;
  private elapsed = 0;
  private cooldown = 1.5;
  private vulnerable = 0;
  private webProgress = 0;
  private webCooldown = 0;
  private webComboWindow = 0;
  private sequence = 0;
  private projectileId = 0;
  private projectiles: BossProjectile[] = [];
  private moving = false;
  private cinematic = .72;
  private cinematicKind: BossSnapshot['cinematic'] = 'intro';
  private hitStop = 0;
  private hitReact = 0;
  private status: BossSnapshot['status'] = 'active';
  private statusElapsed = 0;
  private checkpoint = { position: cv(), health: 0, phase: 0 };

  start(id: BossId, spawn: CombatVector, world: BossWorld) {
    this.id = id; this.player = new PlayerCombatState();
    const floor = world.groundAt(spawn);
    this.position = { ...spawn, y: (floor ?? spawn.y) + (id === 'ironman' ? 8 : 0) };
    this.health = BOSS_DEFINITIONS[id].health; this.phase = 0; this.elapsed = 0;
    this.checkpoint = { position: { ...this.position }, health: this.health, phase: 0 };
    this.resetTransient();
  }
  private resetTransient() {
    this.attack = null; this.projectiles = [];
    this.vulnerable = this.webProgress = this.webCooldown = this.webComboWindow = 0; this.cooldown = 2.4;
    this.sequence = 0; this.status = 'active'; this.statusElapsed = 0; this.moving = false;
    this.cinematic = .72; this.cinematicKind = 'intro'; this.hitStop = 0; this.hitReact = 0;
  }
  stop() { this.id = null; this.projectiles = []; this.attack = null; }
  retry() {
    if (!this.id) return;
    this.player = new PlayerCombatState(); this.position = { ...this.checkpoint.position };
    this.health = this.checkpoint.health; this.phase = this.checkpoint.phase;
    this.resetTransient();
  }
  get checkpointPosition() { return { ...this.checkpoint.position }; }

  step(delta: number, input: BossPlayerInput, world: BossWorld) {
    const events: BossEvent[] = [], impulse = cv();
    if (!this.id || !Number.isFinite(delta) || delta <= 0) return { events, playerImpulse: impulse };
    if (this.status !== 'active') {
      this.statusElapsed += Math.min(delta, .1);
      return { events, playerImpulse: impulse };
    }
    const total = Math.min(delta, .1), steps = Math.max(1, Math.ceil(total * 120)), dt = total / steps;
    for (let i = 0; i < steps && this.status === 'active'; i++) {
      this.tick(dt, { ...input,
        attackPressed: i === 0 && input.attackPressed,
        heavyPressed: i === 0 && input.heavyPressed,
        launcherPressed: i === 0 && input.launcherPressed,
        grabPressed: i === 0 && input.grabPressed,
        dodgePressed: i === 0 && input.dodgePressed,
        webPressed: i === 0 && input.webPressed,
        tauntPressed: i === 0 && input.tauntPressed,
      }, world, events, impulse);
    }
    return { events, playerImpulse: impulse };
  }

  private tick(dt: number, input: BossPlayerInput, world: BossWorld, events: BossEvent[], impulse: CombatVector) {
    const def = BOSS_DEFINITIONS[this.id!];
    this.elapsed += dt; this.moving = false;
    this.hitStop = Math.max(0, this.hitStop - dt);
    this.cinematic = Math.max(0, this.cinematic - dt);
    if (this.cinematic === 0) this.cinematicKind = null;
    this.hitReact = Math.max(0, this.hitReact - dt);
    this.webComboWindow = Math.max(0, this.webComboWindow - dt);
    this.vulnerable = Math.max(0, this.vulnerable - dt); this.webCooldown = Math.max(0, this.webCooldown - dt);
    if (this.cinematic > 0) return;
    const previousDodge = this.player.dodge;
    this.player.step(dt, {
      lightPressed: input.attackPressed,
      heavyPressed: input.heavyPressed,
      launcherPressed: input.launcherPressed,
      grabPressed: input.grabPressed,
      dodgePressed: input.dodgePressed,
      blockHeld: input.blockHeld,
      webPressed: input.webPressed,
      webHeld: input.webHeld,
      tauntPressed: input.tauntPressed,
      grounded: input.grounded,
    });
    if (this.player.dodge > previousDodge) {
      const away = cunit(csub(input.position, this.position));
      const tangent = cunit(cv(-away.z, .12, away.x));
      Object.assign(impulse, cadd(impulse, cmul(tangent, 12))); events.push({ type: 'dodge' });
    }
    const chest = cadd(input.position, cv(0, 1.05)), bossChest = cadd(this.position, cv(0, def.height * .5));
    const separation = clen(csub(chest, bossChest));
    const visible = separation < 180 && world.lineOfSight(chest, bossChest);
    if (input.attackPressed && separation > 3.2 && separation < 8 && visible) {
      const closeDistance = cunit(csub(this.position, input.position));
      Object.assign(impulse, cadd(impulse, cmul(closeDistance, Math.min(7, (separation - 3.2) * 2.2))));
    }
    const planarAway = cv(input.position.x - this.position.x, 0, input.position.z - this.position.z);
    const planarDistance = clen(planarAway);
    const personalSpace = this.id === 'hulk' ? 2.7 : this.id === 'venom' ? 2.35 : 1.75;
    if (planarDistance > .01 && planarDistance < personalSpace)
      Object.assign(impulse, cadd(impulse, cmul(cunit(planarAway), (personalSpace - planarDistance) * 20 * dt)));

    if (input.webPressed && separation < 52 && visible) events.push({ type: 'web-shot', position: { ...bossChest } });
    if (input.webHeld && separation < 52 && visible && this.webCooldown === 0) {
      this.webProgress = Math.min(1, this.webProgress + dt / (this.id === 'hulk' ? 1.5 : .95));
      this.webComboWindow = .9;
      if (separation > 3.7) {
        const pullDirection = cunit(csub(input.position, this.position));
        const pullSpeed = this.id === 'hulk' ? 4.2 : this.id === 'venom' ? 9.5 : 12;
        const desired = cadd(this.position, cmul(pullDirection, Math.min(separation - 3.7, pullSpeed * dt)));
        if (this.id !== 'ironman') {
          const floor = world.groundAt({ ...desired, y: this.position.y + 1.5 });
          if (floor !== null) desired.y = floor;
        }
        const next = world.move(this.position, desired, this.id === 'ironman' ? .7 : 1.15);
        if (clen(csub(next, this.position)) > .005) {
          this.position = { ...next }; this.moving = true;
          if (input.webPressed) events.push({ type: 'web-pull', position: { ...this.position } });
        }
      }
      if (this.webProgress >= 1) {
        this.attack = null; this.vulnerable = 3.8; this.cooldown = 3.8; this.webProgress = 0; this.webCooldown = 6;
        events.push({ type: 'restrained', position: { ...this.position } });
      }
    } else this.webProgress = Math.max(0, this.webProgress - dt * .7);

    const playerAttack = this.player.attack;
    const damagingAttack = playerAttack && this.player.attackKind !== 'webShot';
    const grabReady = this.player.attackKind !== 'grab' || this.vulnerable > 0 || this.webComboWindow > 0;
    if (damagingAttack && grabReady && canAttackHit(this.player.attack!, this.player.timing, 'boss') && separation < this.player.attackReach && visible) {
      registerAttackHit(playerAttack, 'boss');
      const traversalBonus = input.grounded ? 0 : Math.min(25, clen(input.velocity) * .6);
      const webCombo = this.webComboWindow > 0 ? 8 : 0;
      const damage = this.vulnerable > 0
        ? this.player.attackDamage * 1.7 + traversalBonus + webCombo
        : this.player.attackDamage + traversalBonus * .22 + webCombo;
      this.health = Math.max(0, this.health - damage);
      this.hitStop = this.player.attackKind === 'heavy' || this.player.attackKind === 'airHeavy' || this.player.attackKind === 'grab' ? .075 : .045;
      this.hitReact = this.player.attackKind === 'launcher' || this.player.attackKind === 'grab' ? .62 : .34;
      if (this.player.attackKind === 'launcher') this.vulnerable = Math.max(this.vulnerable, 1.2);
      if (this.player.attackKind === 'grab') this.vulnerable = Math.max(this.vulnerable, .8);
      this.webComboWindow = 0;
      this.attack = null; this.cooldown = Math.max(this.cooldown, .58);
      events.push({ type: 'boss-hit', value: damage, position: { ...bossChest } });
      if (this.health <= 0) { this.status = 'victory'; this.statusElapsed = 0; this.attack = null; this.projectiles = []; events.push({ type: 'victory' }); return; }
      const nextPhase = this.health <= def.health * .33 ? 2 : this.health <= def.health * .66 ? 1 : 0;
      if (nextPhase > this.phase) this.beginPhase(nextPhase, events);
    }

    if (!this.attack) {
      this.cooldown = Math.max(0, this.cooldown - dt);
      const desiredRange = this.id === 'ironman' ? (this.vulnerable > 0 ? 4 : 34) : 6.5;
      if (separation > desiredRange && this.vulnerable <= 0) {
        const target = { ...input.position, y: input.position.y + (this.id === 'ironman' ? 7 : 0) };
        this.moveToward(target, def.speed, dt, world, this.id === 'ironman');
      } else if (this.id === 'ironman' && this.vulnerable > 0) {
        this.moveToward(input.position, 5.5, dt, world, true);
      } else if (this.id === 'ironman' && this.cooldown > .25 && this.vulnerable <= 0 && separation < desiredRange + 5) {
        this.strafeAround(input.position, def.speed * .38, dt, world, this.id === 'ironman');
      }
      if (this.cooldown === 0 && this.vulnerable === 0 && separation < 150 && visible) {
        const choices = def.attacks.filter(candidate => separation < candidate.reach &&
          (!['charge', 'leap'].includes(candidate.kind) || separation > 9));
        const candidate = choices[this.sequence++ % Math.max(1, choices.length)];
        if (candidate) {
          const floor = world.groundAt(input.position);
          const target = { ...input.position, y: candidate.kind === 'leap' ? floor ?? input.position.y : input.position.y };
          this.facing = cunit(csub(target, this.position));
          this.attack = { definition: candidate, clock: createAttackClock(), target, start: { ...this.position }, direction: { ...this.facing }, volleyFired: 0 };
          this.strafeDirection *= -1;
          events.push({ type: 'attack', position: { ...target } });
        } else this.cooldown = .65;
      }
    } else this.updateAttack(dt, input, world, events, impulse);

    for (const projectile of this.projectiles) {
      const before = { ...projectile.position }, after = cadd(before, cmul(projectile.velocity, dt));
      projectile.life -= dt;
      if (!world.lineOfSight(before, after)) { projectile.life = 0; continue; }
      if (sweptSphereHit(before, after, chest, projectile.radius + .65)) {
        this.hitPlayer(projectile.damage, cunit(projectile.velocity), events, impulse); projectile.life = 0;
      }
      projectile.position = after;
    }
    this.projectiles = this.projectiles.filter(projectile => projectile.life > 0);
  }

  private beginPhase(phase: number, events: BossEvent[]) {
    this.phase = phase; this.attack = null; this.projectiles = []; this.vulnerable = 0;
    this.cooldown = 1.15; this.hitReact = .5;
    events.push({ type: 'phase', value: phase + 1 });
  }

  private moveToward(target: CombatVector, speed: number, dt: number, world: BossWorld, flying: boolean) {
    let direction = csub(target, this.position);
    if (!flying) direction.y = 0;
    const distance = clen(direction); if (distance < .05) return;
    direction = cunit(direction); this.facing = direction;
    const desired = cadd(this.position, cmul(direction, Math.min(distance, speed * dt)));
    const floor = world.groundAt({ ...desired, y: this.position.y + 1.2 });
    if (!flying) {
      if (floor === null || Math.abs(floor - this.position.y) > 2.5) return;
      desired.y = floor;
    } else if (floor !== null) desired.y = Math.max(floor + .3, desired.y);
    const next = world.move(this.position, desired, this.id === 'ironman' ? .7 : 1.15);
    this.moving = clen(csub(next, this.position)) > .01; this.position = { ...next };
  }

  private strafeAround(target: CombatVector, speed: number, dt: number, world: BossWorld, flying: boolean) {
    const toward = cunit(csub(target, this.position));
    const tangent = cv(-toward.z * this.strafeDirection, 0, toward.x * this.strafeDirection);
    const desired = cadd(this.position, cmul(tangent, speed * dt));
    const floor = world.groundAt({ ...desired, y: this.position.y + 1.2 });
    if (!flying) {
      if (floor === null || Math.abs(floor - this.position.y) > 1.2) { this.strafeDirection *= -1; return; }
      desired.y = floor;
    } else desired.y = this.position.y;
    const next = world.move(this.position, desired, this.id === 'ironman' ? .7 : 1.15);
    if (clen(csub(next, desired)) > .08) { this.strafeDirection *= -1; return; }
    this.position = { ...next }; this.facing = toward; this.moving = true;
  }

  private updateAttack(dt: number, input: BossPlayerInput, world: BossWorld, events: BossEvent[], impulse: CombatVector) {
    const a = this.attack!, d = a.definition;
    advanceAttack(a.clock, dt);
    const stage = attackStage(a.clock, d), before = { ...this.position };
    if (stage === 'active' || canAttackHit(a.clock, d, 'activation')) {
      if (d.kind === 'charge') {
        const desired = cadd(this.position, cmul(a.direction, (d.speed ?? 30) * dt));
        const floor = world.groundAt({ ...desired, y: this.position.y + 1 });
        if (this.id !== 'ironman' && floor !== null) desired.y = floor;
        const next = world.move(this.position, desired, 1.15);
        this.position = { ...next }; this.moving = true;
        if (clen(csub(next, desired)) > .08) {
          this.attack = null; this.vulnerable = 4; this.cooldown = 4;
          events.push({ type: 'wall-stagger', position: { ...this.position } }); return;
        }
      }
      if (d.kind === 'leap') {
        const t = Math.max(0, Math.min(1, (a.clock.elapsed - d.startup) / d.active));
        const desired = cadd(a.start, cmul(csub(a.target, a.start), t));
        desired.y += Math.sin(Math.PI * t) * (this.id === 'hulk' ? 14 : 10);
        this.position = { ...world.move(this.position, desired, 1.15) }; this.moving = true;
      }
      if (d.kind === 'projectile' && !a.clock.fired) {
        a.clock.fired = true;
        const definition = BOSS_DEFINITIONS[this.id!];
        const center = cadd(this.position, cv(0, definition.height * .64));
        const count = d.projectileCount ?? 1;
        const spread = d.spread ?? 0;
        for (let index = 0; index < count; index++) {
          const hand = index % 2 ? 1 : -1;
          const right = cv(-this.facing.z, 0, this.facing.x);
          const origin = cadd(cadd(center, cmul(right, hand * .58)), cmul(this.facing, 1.15));
          const direction = cunit(csub(cadd(a.target, cv(0, 1)), origin));
          const angle = (index - (count - 1) / 2) * spread;
          const aimed = cv(direction.x * Math.cos(angle) - direction.z * Math.sin(angle), direction.y, direction.x * Math.sin(angle) + direction.z * Math.cos(angle));
          this.projectiles.push({ id: ++this.projectileId, position: { ...origin }, velocity: cmul(aimed, d.speed ?? 45), radius: d.radius, damage: d.damage, life: 5.5, style: d.projectileStyle ?? 'bolt' });
        }
      }
    }
    if (d.kind !== 'projectile' && canAttackHit(a.clock, d, 'player')) {
      const center = cadd(input.position, cv(0, 1));
      let hit = false;
      if (d.kind === 'charge') hit = sweptSphereHit(cadd(before, cv(0, 1)), cadd(this.position, cv(0, 1)), center, d.radius + .5);
      if (d.kind === 'melee') hit = sweptSphereHit(cadd(this.position, cv(0, 1.2)), cadd(this.position, cadd(cmul(a.direction, d.reach), cv(0, 1.2))), center, d.radius);
      if (d.kind === 'slam' || d.kind === 'leap') {
        const impact = d.kind === 'leap' ? a.target : this.position;
        const landed = d.kind !== 'leap' || a.clock.elapsed >= d.startup + d.active - .08;
        hit = landed && Math.hypot(input.position.x - impact.x, input.position.z - impact.z) < d.radius && input.position.y < impact.y + 2;
      }
      if (hit && world.lineOfSight(cadd(this.position, cv(0, 1)), center)) {
        registerAttackHit(a.clock, 'player'); this.hitPlayer(d.damage, cunit(csub(input.position, this.position)), events, impulse);
      }
    }
    if (stage === 'recovery') this.vulnerable = Math.max(this.vulnerable, .2);
    if (stage === 'complete') {
      this.attack = null;
      this.cooldown = (d.cooldown ?? 1.6) + (this.phase === 2 ? -.2 : .25);
      this.vulnerable = Math.max(this.vulnerable, 1.15);
    }
  }

  private hitPlayer(damage: number, direction: CombatVector, events: BossEvent[], impulse: CombatVector) {
    if (!this.player.damage(damage)) return;
    this.hitStop = .055;
    if (this.player.lastDamageBlocked) {
      Object.assign(impulse, cadd(impulse, cadd(cmul(direction, 2.2), cv(0, .8))));
      events.push({ type: 'blocked', value: damage * .18 });
    } else {
      Object.assign(impulse, cadd(impulse, cadd(cmul(direction, 13), cv(0, 6))));
      events.push({ type: 'player-hit', value: damage });
    }
    if (this.player.health === 0) { this.status = 'dead'; this.statusElapsed = 0; this.attack = null; this.projectiles = []; events.push({ type: 'death' }); }
  }

  snapshot(): BossSnapshot | null {
    if (!this.id) return null;
    const d = BOSS_DEFINITIONS[this.id], a = this.attack;
    const playerTiming = this.player.timing;
    const timeScale = this.hitStop > 0 ? .25 : this.cinematic > 0 ? .32 : 1;
    return { id: this.id, name: d.name, status: this.status, phase: this.phase + 1, health: this.health, maxHealth: d.health,
      playerHealth: this.player.health, position: { ...this.position }, facing: { ...this.facing }, moving: this.moving,
      vulnerable: this.vulnerable, hitReact: this.hitReact, webProgress: this.webProgress, webCooldown: this.webCooldown, escaping: false, pursuing: false,
      objective: this.status === 'dead' ? 'Defeated · restart the fight' : this.status === 'victory' ? 'Encounter complete'
        : this.vulnerable > 0 ? 'VULNERABLE · close in and strike' : d.phases[this.phase],
      playerAttacking: !!this.player.attack, playerDodging: this.player.dodge > 0, elapsed: this.elapsed, timeScale, cinematic: this.cinematicKind,
      player: this.status === 'victory' ? { action: 'idle', actionElapsed: 0, actionDuration: 0, activeStart: 0, activeEnd: 0, comboIndex: 0, blocking: false }
        : this.player.health <= 0 ? { action: 'defeated', actionElapsed: this.statusElapsed, actionDuration: 1.8, activeStart: 0, activeEnd: 0, comboIndex: this.player.comboIndex, blocking: false }
        : this.player.dodge > 0 ? { action: 'dodge', actionElapsed: .62 - this.player.dodge, actionDuration: .62, activeStart: 0, activeEnd: .62, comboIndex: this.player.comboIndex, blocking: false }
        : this.player.blocking ? { action: 'block', actionElapsed: this.elapsed, actionDuration: 1, activeStart: 0, activeEnd: 1, comboIndex: this.player.comboIndex, blocking: true }
        : this.player.webPulling && this.player.webPullElapsed > .16 ? { action: 'webPull', actionElapsed: this.player.webPullElapsed, actionDuration: 1, activeStart: 0, activeEnd: 1, comboIndex: this.player.comboIndex, blocking: false }
        : this.player.attack ? { action: this.player.attackKind, actionElapsed: this.player.attack.elapsed, actionDuration: playerTiming.startup + playerTiming.active + playerTiming.recovery, activeStart: playerTiming.startup, activeEnd: playerTiming.startup + playerTiming.active, comboIndex: this.player.comboIndex, blocking: false }
        : this.player.taunt > 0 ? { action: 'taunt', actionElapsed: 1.8 - this.player.taunt, actionDuration: 1.8, activeStart: 0, activeEnd: 0, comboIndex: this.player.comboIndex, blocking: false }
        : this.player.hurtCooldown > .35 ? { action: 'hit', actionElapsed: .9 - this.player.hurtCooldown, actionDuration: .55, activeStart: 0, activeEnd: 0, comboIndex: this.player.comboIndex, blocking: false }
        : { action: 'idle', actionElapsed: 0, actionDuration: 0, activeStart: 0, activeEnd: 0, comboIndex: this.player.comboIndex, blocking: false },
      attack: a ? { id: a.definition.id, label: a.definition.label, kind: a.definition.kind, stage: attackStage(a.clock, a.definition), time: a.clock.elapsed,
        duration: a.definition.startup + a.definition.active + a.definition.recovery, clip: a.definition.clip,
        target: { ...a.target }, radius: a.definition.radius, progress: Math.min(1, a.clock.elapsed / a.definition.startup) } : null,
      projectiles: this.projectiles.map(p => ({ ...p, position: { ...p.position }, velocity: { ...p.velocity } })) };
  }
}
