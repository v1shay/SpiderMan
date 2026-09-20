import type { TraversalState, TraversalEvent } from './traversal-physics.ts';

export type TrickAward = { id: number; label: string; score: number; multiplier: number; kind: 'air' | 'web' | 'glide' | 'impact' };
export type TrickSample = {
  dt: number; state: TraversalState; events: readonly TraversalEvent[];
  groundY: number; contact: boolean; impactSpeed?: number;
  /** Measured opposite-side ray distances, not button requests. */
  clearance?: { left: number; right: number };
  animation?: { name: string; progress: number; sequence: number };
};
const speedOf = (s: TraversalState) => Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z);

/** Physics events and completed animation cycles feed a single bounded combo. */
export class TrickSystem {
  score = 0;
  chain = 0;
  multiplier = 1;
  private time = 0;
  private lastAward = -100;
  private serial = 0;
  private cooldowns = new Map<string, number>();
  private previousSpeed = 0;
  private previousYSpeed = 0;
  private previousMode = 'idle';
  private previousSwing: { seconds: number; tangentSpeed: number; radialY: number } | null = null;
  private wallDistance = 0;
  private glideSeconds = 0;
  private diveAt = -100;
  private flowStage = 0;
  private flowAt = -100;
  private flowSpeed = 0;
  private stalled = 0;
  private flipSequence = '';
  private flipCount = 0;
  private narrow = false;
  private deepAwarded = false;
  private lowAwarded = false;
  private arcMin = 1;
  private arcMax = -1;
  resetCombo() { this.chain = 0; this.multiplier = 1; this.flowStage = 0; this.flipCount = 0; }
  reset() { this.resetCombo(); this.score = 0; this.cooldowns.clear(); this.previousSwing = null; this.lastAward = -100; }
  update(sample: TrickSample): TrickAward[] {
    const { state: s, dt, events } = sample;
    this.time += Math.max(0, dt);
    const speed = speedOf(s), awards: TrickAward[] = [];
    this.stalled = speed < 2 ? this.stalled + dt : 0;
    if (this.time - this.lastAward > 5 || this.stalled > 1.2 || (sample.contact && (sample.impactSpeed ?? 0) > 23)) this.resetCombo();
    const award = (label: string, base: number, kind: TrickAward['kind'], cooldown = 2) => {
      if (this.time < (this.cooldowns.get(label) ?? -1)) return;
      this.cooldowns.set(label, this.time + cooldown);
      this.chain++;
      this.multiplier = Math.min(4, 1 + (this.chain - 1) * .2);
      const score = Math.round(base * this.multiplier);
      this.score += score; this.lastAward = this.time;
      awards.push({ id: ++this.serial, label, score, multiplier: this.multiplier, kind });
    };
    if (s.mode === 'dive' && speed > 26) this.diveAt = this.time;
    const attached = events.some(e => e.type === 'web-attached');
    if (attached) {
      this.deepAwarded = false; this.lowAwarded = false; this.arcMin = 1; this.arcMax = -1;
      if (this.time - this.diveAt < 1.4 && speed > 24) { award('DIVE → SWING', 300, 'web', 3); this.diveAt = -100; }
      if (this.flowStage === 2 && this.time - this.flowAt < 5 && speed >= this.flowSpeed * .65) award('WALL FLOW', 400, 'web', 4);
      this.flowStage = 0;
    }
    if (s.swing) {
      const pivot = s.swing.simulationPivot ?? s.swing.pivot ?? s.swing.anchor;
      const x = s.position.x - pivot.x, y = s.position.y - pivot.y, z = s.position.z - pivot.z;
      const length = Math.hypot(x, y, z) || 1;
      const radialY = y / length;
      this.arcMin = Math.min(this.arcMin, radialY); this.arcMax = Math.max(this.arcMax, radialY);
      const radialSpeed = (s.velocity.x*x + s.velocity.y*y + s.velocity.z*z) / length;
      this.previousSwing = { seconds: s.swing.attachedSeconds, tangentSpeed: Math.sqrt(Math.max(0, speed*speed - radialSpeed*radialSpeed)), radialY };
      if (!this.lowAwarded && this.previousYSpeed < 0 && s.velocity.y >= 0 && speed > 18 && s.position.y - sample.groundY < 8) { award('LOW SWING',120,'web'); this.lowAwarded = true; }
      if (!this.deepAwarded && s.swing.attachedSeconds > 1.2 && this.arcMax - this.arcMin > .65 && s.swing.ropeLength > 22) { award('DEEP SWING',180,'web'); this.deepAwarded = true; }
    } else if (this.previousSwing) {
      if (events.some(e => e.type === 'web-released') && this.previousSwing.seconds > .2 && speed > 10) {
        award('WEB RELEASE',80,'web',.4);
        if (this.previousYSpeed > 8 && this.previousSwing.radialY < -.15 && this.previousSwing.radialY > -.9 && speed >= this.previousSwing.tangentSpeed * .9) award('PERFECT RELEASE',250,'web',1.5);
      }
      if (s.mode === 'wallRun') { this.flowStage = 1; this.flowAt = this.time; this.flowSpeed = this.previousSpeed; }
      this.previousSwing = null;
    }
    if (s.mode === 'wallRun') {
      this.wallDistance += speed * dt;
      if (this.wallDistance >= 12) { award('WALL RUN',100,'impact',3); this.wallDistance = 0; }
    } else this.wallDistance = 0;
    if (this.flowStage === 1 && (s.mode === 'mantle' || events.some(e=>e.type === 'wall-jump'))) this.flowStage = 2;
    if (this.time - this.flowAt > 6) this.flowStage = 0;
    if (s.mode === 'glide') {
      this.glideSeconds += dt;
      if (this.glideSeconds >= .8 && this.glideSeconds - dt < .8 && speed > 12) award('WEB GLIDE',150,'glide');
      if (this.glideSeconds >= 4 && this.glideSeconds - dt < 4 && speed > 12) award('EXTENDED GLIDE',250,'glide');
      if (this.glideSeconds >= 8 && this.glideSeconds - dt < 8 && speed > 12) award('SKY SURFER',400,'glide');
    } else this.glideSeconds = 0;
    if (sample.clearance && speed > 22 && !s.grounded && !sample.contact && !s.wallRunActive && !s.wallCrawlActive) {
      const {left,right} = sample.clearance;
      if (Math.min(left,right) < 1.8 && Math.min(left,right) > .45) award('NEAR MISS',200,'air',4);
      const narrow = left + right < 8 && left > .5 && right > .5;
      if (narrow && !this.narrow) award('THREAD THE NEEDLE',400,'air',5);
      this.narrow = narrow;
    } else this.narrow = false;
    for (const event of events) {
      if (event.type === 'loop-completed') award('LOOP DE LOOP',500,'web',1);
      if (event.type === 'point-launch' && speed > 15) award('POINT LAUNCH',180,'web',1);
      if (event.type === 'slingshot-launch' && speed > 25) award('SLINGSHOT',300,'web',2);
      if (event.type === 'roll' && speed > 5) award('IMPACT ROLL',100,'impact',2);
    }
    const a = sample.animation;
    if (a && !s.grounded && a.progress >= .85 && /Backflip|Front Flip|Front Twist|Forward Flip|Corkscrew|Aerial Evade|Butterfly/i.test(a.name)) {
      const key = `${a.name}:${a.sequence}`;
      if (key !== this.flipSequence) {
        this.flipSequence = key;
        this.flipCount++;
        const label = /backflip/i.test(a.name) ? (this.flipCount === 2 ? 'DOUBLE BACKFLIP' : 'BACKFLIP') : /front|forward/i.test(a.name) ? 'FRONT FLIP' : 'AERIAL TRICK';
        award(label,150,'air',.2);
      }
    }
    if (s.grounded) this.flipCount = 0;
    if (s.mode === 'mantle' && this.previousMode !== 'mantle' && speed > 8) award('ROOFTOP VAULT',150,'impact',2);
    this.previousMode = s.mode; this.previousSpeed = speed; this.previousYSpeed = s.velocity.y;
    return awards;
  }
}
