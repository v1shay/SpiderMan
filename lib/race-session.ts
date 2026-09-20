export type RacePoint = [number, number, number];
export type RaceMode = 'speed' | 'style' | 'combined';
export type RaceGateType =
  | 'free'
  | 'low-swing'
  | 'dive'
  | 'wall-run'
  | 'point-launch'
  | 'zip'
  | 'loop'
  | 'rooftop-vault'
  | 'wind'
  | 'split-route'
  | 'precision'
  | 'trick-score';
export type RaceGate = {
  id: string;
  position: RacePoint;
  radius: number;
  type: RaceGateType;
  next: string[];
  bonus: number;
  required?: boolean;
  scoreTarget?: number;
};
export type RaceParTimes = { gold: number; silver: number; bronze: number };
export type RaceCourse = {
  id: string;
  start: RacePoint;
  finish: RacePoint;
  side: number;
  seed?: number;
  gates?: RaceGate[];
  parTimes?: RaceParTimes;
  scoreTargets?: RaceParTimes;
  mode?: RaceMode;
  mapId?: string;
};
export type RaceSplit = { gateId: string; time: number; score: number };
export type RaceMedal = 'gold' | 'silver' | 'bronze' | 'complete';
export type RaceTelemetry = {
  mode?: string;
  speed?: number;
  verticalSpeed?: number;
  events?: readonly string[];
  styleScore?: number;
  wind?: boolean;
};
export type RacePacket = {
  version: 1;
  type: 'invite' | 'accept' | 'start' | 'finish' | 'cancel';
  sender: string;
  raceId: string;
  sentAt: number;
  course?: RaceCourse;
  until?: number;
  participants?: string[];
  elapsed?: number;
  splits?: RaceSplit[];
  score?: number;
};
export type RacePhase =
  | 'free'
  | 'inviting'
  | 'invited'
  | 'countdown'
  | 'racing'
  | 'finished';
export type RaceView = {
  phase: RacePhase;
  time: number;
  countdown: number;
  best: number | null;
  distance: number;
  participants: number;
  course: RaceCourse | null;
  results: { id: string; time: number; score?: number }[];
  ghost: boolean;
  wind: boolean;
  message: string;
  gateIndex?: number;
  gateCount?: number;
  gateType?: RaceGateType;
  missedGate?: boolean;
  splits?: RaceSplit[];
  splitDelta?: number | null;
  medal?: RaceMedal | null;
  styleScore?: number;
  mode?: RaceMode;
  target?: RacePoint;
  route?: RacePoint[];
};
export const emptyRaceView: RaceView = {
  phase: 'free',
  time: 0,
  countdown: 0,
  best: null,
  distance: 0,
  participants: 1,
  course: null,
  results: [],
  ghost: false,
  wind: false,
  message: 'Own the skyline',
};
export const raceDistance = (a: RacePoint, b: RacePoint) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export type RaceGeometrySampler = (
  desired: RacePoint,
  type: RaceGateType,
  radius: number,
) => { position: RacePoint; type?: RaceGateType; radius?: number } | null;
export type RaceCourseOptions = {
  sample?: RaceGeometrySampler;
  mode?: RaceMode;
  mapId?: string;
};
const types: RaceGateType[] = [
  'free',
  'low-swing',
  'dive',
  'wall-run',
  'point-launch',
  'zip',
  'loop',
  'rooftop-vault',
  'wind',
  'split-route',
  'precision',
  'trick-score',
];
const modes: RaceMode[] = ['speed', 'style', 'combined'];
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

/** Same UTC day and map always produce the same host-authored course. */
export function dailyRaceSeed(mapId: string, date = new Date()): number {
  let seed = 2166136261;
  for (const char of `${date.toISOString().slice(0, 10)}:${mapId}`)
    seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed >>> 0;
}

export function createRaceCourse(
  start: RacePoint,
  width: number,
  depth: number,
  seed: number,
  previousSide = -1,
  options: RaceCourseOptions = {},
): RaceCourse {
  let side = (seed >>> 0) % 4;
  if (side === previousSide) side = (side + 1) % 4;
  const dir: RacePoint = [
    [1, 0, 0],
    [0, 0, 1],
    [-1, 0, 0],
    [0, 0, -1],
  ][side] as RacePoint;
  const span = clamp(
    Math.abs(side % 2 ? depth : width) * (2 + ((seed >>> 3) % 2)),
    640,
    2400,
  );
  const perpendicular: RacePoint = [-dir[2], 0, dir[0]];
  const mode = options.mode ?? 'speed';
  let random = seed >>> 0;
  const rng = () => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return random / 4294967296;
  };
  const sequence: RaceGateType[] = [
    'free',
    'dive',
    'low-swing',
    'split-route',
    'wall-run',
    'rooftop-vault',
    'point-launch',
    'wind',
    mode === 'style' ? 'trick-score' : 'free',
    'precision',
  ];
  const gates: RaceGate[] = [];
  let previousGatePosition: RacePoint = [...start];
  for (let i = 0; i < sequence.length; i++) {
    const fraction = (i + 1) / sequence.length;
    const sway =
      i === sequence.length - 1 ? 0 : (rng() - 0.5) * Math.min(90, span * 0.13);
    const desired: RacePoint = [
      start[0] + dir[0] * span * fraction + perpendicular[0] * sway,
      i === 0
        ? start[1] - 18
        : previousGatePosition[1] + [-18, -22, -8, 6, 10, 16, 8, 18, 8, 4][i],
      start[2] + dir[2] * span * fraction + perpendicular[2] * sway,
    ];
    const radius =
      sequence[i] === 'precision' ? 7 : sequence[i] === 'wall-run' ? 8 : 12;
    let sampled = options.sample?.(desired, sequence[i], radius);
    if (options.sample && !sampled)
      sampled = options.sample(desired, 'free', radius);
    if (options.sample && !sampled)
      throw new Error(
        'No clear traversal route could be found here. Try another start.',
      );
    // Without geometry a skill-specific label would promise an unverified wall/roof.
    const type =
      sampled?.type ??
      (options.sample
        ? sequence[i]
        : ['wind', 'split-route', 'precision', 'trick-score'].includes(
              sequence[i],
            )
          ? sequence[i]
          : 'free');
    gates.push({
      id: `gate-${i}`,
      position: sampled?.position ?? desired,
      radius: sampled?.radius ?? radius,
      type,
      next: i < sequence.length - 1 ? [`gate-${i + 1}`] : [],
      bonus: type === 'precision' ? 100 : type === 'free' ? 25 : 150,
      required: !['free', 'wind', 'split-route', 'precision'].includes(type),
      ...(type === 'trick-score' ? { scoreTarget: 250 } : {}),
    });
    previousGatePosition = [...gates[gates.length - 1].position];
  }
  // The split selects either of two separately sampled corridors, then rejoins.
  const split = gates[3],
    branch = gates[4];
  const alternateDesired: RacePoint = [
    branch.position[0] + perpendicular[0] * 40,
    branch.position[1],
    branch.position[2] + perpendicular[2] * 40,
  ];
  const alternate = options.sample?.(
    alternateDesired,
    branch.type,
    branch.radius,
  );
  if (alternate || !options.sample) {
    const alternateGate: RaceGate = {
      ...branch,
      id: 'gate-4-alt',
      position: alternate?.position ?? alternateDesired,
      type: alternate?.type ?? branch.type,
      radius: alternate?.radius ?? branch.radius,
      next: [...branch.next],
    };
    alternateGate.required = ![
      'free',
      'wind',
      'split-route',
      'precision',
    ].includes(alternateGate.type);
    gates.splice(5, 0, alternateGate);
    split.next = [branch.id, alternateGate.id];
  }
  const finish = [...gates[gates.length - 1].position] as RacePoint;
  let distance = 0,
    previous = start;
  for (const gate of gates.filter((g) => g.id !== 'gate-4-alt')) {
    distance += raceDistance(previous, gate.position);
    previous = gate.position;
  }
  const base = Math.round((distance / 27 + sequence.length * 0.7) * 1000);
  return {
    id: `skyline-v5:${options.mapId ?? 'city'}:${seed >>> 0}:${side}:${mode}:${start.map((n) => n.toFixed(0)).join(',')}`,
    start: [...start],
    finish,
    side,
    seed: seed >>> 0,
    gates,
    mode,
    mapId: options.mapId,
    parTimes: {
      gold: base,
      silver: Math.round(base * 1.3),
      bronze: Math.round(base * 1.7),
    },
    scoreTargets: { gold: 3500, silver: 2200, bronze: 1200 },
  };
}

function point(p: unknown): p is RacePoint {
  return (
    Array.isArray(p) &&
    p.length === 3 &&
    p.every(
      (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e6,
    )
  );
}
export function validRaceCourse(value: unknown): value is RaceCourse {
  if (!value || typeof value !== 'object') return false;
  const c = value as RaceCourse;
  if (
    !(
      typeof c.id === 'string' &&
      c.id.length > 0 &&
      c.id.length < 200 &&
      point(c.start) &&
      point(c.finish) &&
      raceDistance(c.start, c.finish) >= 300 &&
      raceDistance(c.start, c.finish) < 10000 &&
      Number.isInteger(c.side) &&
      c.side >= 0 &&
      c.side < 4
    )
  )
    return false;
  if (c.mode !== undefined && !modes.includes(c.mode)) return false;
  if (
    c.mapId !== undefined &&
    (typeof c.mapId !== 'string' || c.mapId.length > 80)
  )
    return false;
  if (
    c.seed !== undefined &&
    (!Number.isInteger(c.seed) || c.seed < 0 || c.seed > 0xffffffff)
  )
    return false;
  for (const [name, p] of [
    ['time', c.parTimes],
    ['score', c.scoreTargets],
  ] as const)
    if (
      p &&
      (![p.gold, p.silver, p.bronze].every(
        (n) => Number.isFinite(n) && n > 0,
      ) ||
        (name === 'time'
          ? !(p.gold <= p.silver && p.silver <= p.bronze)
          : !(p.gold >= p.silver && p.silver >= p.bronze)))
    )
      return false;
  if (c.gates === undefined) return true; // Old saved ghosts remain readable.
  if (!Array.isArray(c.gates) || c.gates.length < 2 || c.gates.length > 32)
    return false;
  const indexes = new Map(c.gates.map((g, i) => [g?.id, i]));
  if (indexes.size !== c.gates.length) return false;
  const reached = new Set([c.gates[0]?.id]);
  for (let i = 0; i < c.gates.length; i++) {
    const g = c.gates[i];
    if (
      !g ||
      typeof g.id !== 'string' ||
      g.id.length > 80 ||
      !point(g.position) ||
      !Number.isFinite(g.radius) ||
      g.radius < 2 ||
      g.radius > 40 ||
      !types.includes(g.type) ||
      !Number.isFinite(g.bonus) ||
      g.bonus < 0 ||
      g.bonus > 2000 ||
      !Array.isArray(g.next) ||
      g.next.length > 3
    )
      return false;
    if (g.required !== undefined && typeof g.required !== 'boolean')
      return false;
    if (
      g.scoreTarget !== undefined &&
      (!Number.isFinite(g.scoreTarget) ||
        g.scoreTarget < 0 ||
        g.scoreTarget > 1e6)
    )
      return false;
    if (!reached.has(g.id)) return false;
    for (const next of g.next) {
      const j = indexes.get(next);
      if (j === undefined || j <= i) return false;
      reached.add(next);
    }
    if (g.next.length === 0 && raceDistance(g.position, c.finish) > g.radius)
      return false;
  }
  return true;
}
const validSplits = (splits: unknown): splits is RaceSplit[] =>
  Array.isArray(splits) &&
  splits.length <= 32 &&
  splits.every(
    (s, i) =>
      s &&
      typeof s.gateId === 'string' &&
      s.gateId.length <= 80 &&
      Number.isFinite(s.time) &&
      s.time >= 0 &&
      s.time < 3600000 &&
      Number.isFinite(s.score) &&
      s.score >= 0 &&
      s.score < 1e8 &&
      (i === 0 || s.time >= splits[i - 1].time),
  );
export function validRacePacket(value: unknown): value is RacePacket {
  if (!value || typeof value !== 'object') return false;
  const p = value as RacePacket;
  return (
    p.version === 1 &&
    ['invite', 'accept', 'start', 'finish', 'cancel'].includes(p.type) &&
    typeof p.sender === 'string' &&
    p.sender.length >= 8 &&
    p.sender.length <= 80 &&
    typeof p.raceId === 'string' &&
    p.raceId.length <= 100 &&
    Number.isFinite(p.sentAt) &&
    (p.course === undefined || validRaceCourse(p.course)) &&
    (p.until === undefined || Number.isFinite(p.until)) &&
    (p.elapsed === undefined ||
      (Number.isFinite(p.elapsed) && p.elapsed > 0 && p.elapsed < 3600000)) &&
    (p.splits === undefined || validSplits(p.splits)) &&
    (p.score === undefined ||
      (Number.isFinite(p.score) && p.score >= 0 && p.score < 1e8)) &&
    (p.participants === undefined ||
      (Array.isArray(p.participants) &&
        p.participants.length <= 64 &&
        new Set(p.participants).size === p.participants.length &&
        p.participants.every(
          (id) => typeof id === 'string' && id.length >= 8 && id.length <= 80,
        )))
  );
}

export function raceResultValue(
  mode: RaceMode,
  time: number,
  score: number,
): number {
  return mode === 'style'
    ? -score
    : mode === 'combined'
      ? time - score * 12
      : time;
}
export function raceMedal(
  course: RaceCourse,
  time: number,
  score: number,
): RaceMedal {
  for (const medal of ['gold', 'silver', 'bronze'] as const) {
    const fast = course.parTimes ? time <= course.parTimes[medal] : false;
    const stylish = course.scoreTargets
      ? score >= course.scoreTargets[medal]
      : false;
    if (
      course.mode === 'style'
        ? stylish
        : course.mode === 'combined'
          ? fast && stylish
          : fast
    )
      return medal;
  }
  return 'complete';
}

function gateSatisfied(
  g: RaceGate,
  t: RaceTelemetry,
  recent: Map<string, number>,
  now: number,
  score: number,
): boolean {
  if (!g.required) return true;
  const has = (event: string) =>
    recent.has(event) && now - recent.get(event)! < 1100;
  switch (g.type) {
    case 'low-swing':
      return t.mode === 'swing' && (t.speed ?? 0) >= 8;
    case 'dive':
      return (t.verticalSpeed ?? 0) < -7 || t.mode === 'dive';
    case 'wall-run':
      return t.mode === 'wallRun';
    case 'point-launch':
      return t.mode === 'pointLaunch' || has('point-launch');
    case 'zip':
      return t.mode === 'webZip' || has('zip-started');
    case 'loop':
      return has('loop-completed');
    case 'rooftop-vault':
      return t.mode === 'mantle' || has('roof-vault') || has('wall-jump');
    case 'wind':
      return t.wind === true;
    case 'trick-score':
      return score >= (g.scoreTarget ?? 250);
    default:
      return true;
  }
}
/** Segment crossing prevents tunnelling through small gates at high speed. */
export function gateCrossing(
  from: RacePoint,
  to: RacePoint,
  gate: RaceGate,
): number | null {
  const d = to.map((n, i) => n - from[i]),
    o = from.map((n, i) => n - gate.position[i]);
  const a = d.reduce((sum, n) => sum + n * n, 0),
    c = o.reduce((sum, n) => sum + n * n, 0) - gate.radius * gate.radius;
  if (c <= 0) return 0;
  if (a < 1e-10) return null;
  const b = 2 * d.reduce((sum, n, i) => sum + n * o[i], 0),
    disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const enter = (-b - Math.sqrt(disc)) / (2 * a);
  return enter >= 0 && enter <= 1 ? enter : null;
}

type Hooks = {
  send: (p: RacePacket) => void;
  teleport: (p: RacePoint) => void;
  finished: (course: RaceCourse, time: number) => void;
  started: (course: RaceCourse) => void;
};
/** Host-authoritative course/countdown, local swept checkpoints, proof of the
 * chosen checkpoint path on finish. Invitations never move nonparticipants. */
export class RaceSession {
  phase: RacePhase = 'free';
  course: RaceCourse | null = null;
  raceId = '';
  host = '';
  until = 0;
  startAt = 0;
  time = 0;
  accepted = false;
  participants = new Set<string>();
  results = new Map<string, number>();
  scores = new Map<string, number>();
  splits: RaceSplit[] = [];
  activeGateIds: string[] = [];
  completedGateIds = new Set<string>();
  missedGate = false;
  styleScore = 0;
  medal: RaceMedal | null = null;
  bestSplits: readonly RaceSplit[] = [];
  private nextRepeat = 0;
  private completed = false;
  private previousPosition: RacePoint | null = null;
  private previousTick = 0;
  private nearestGate = Infinity;
  private scoreBase: number | null = null;
  private gateBonus = 0;
  private recent = new Map<string, number>();
  private privateAttempt = false;
  readonly id: string;
  private hooks: Hooks;
  constructor(id: string, hooks: Hooks) {
    this.id = id;
    this.hooks = hooks;
  }
  get currentGate(): RaceGate | null {
    return (
      this.course?.gates?.find((g) => this.activeGateIds.includes(g.id)) ?? null
    );
  }
  get gateCount(): number {
    const gates = this.course?.gates;
    if (!gates?.length) return 0;
    const count = new Map<string, number>();
    for (let i = gates.length - 1; i >= 0; i--)
      count.set(
        gates[i].id,
        1 + Math.max(0, ...gates[i].next.map((id) => count.get(id) ?? 0)),
      );
    return count.get(gates[0].id) ?? gates.length;
  }
  get splitDelta(): number | null {
    const last = this.splits[this.splits.length - 1],
      best = last && this.bestSplits.find((s) => s.gateId === last.gateId);
    return last && best ? last.time - best.time : null;
  }
  private packet(
    type: RacePacket['type'],
    now: number,
    extra: Partial<RacePacket> = {},
  ) {
    this.hooks.send({
      version: 1,
      type,
      sender: this.id,
      raceId: this.raceId,
      sentAt: now,
      ...extra,
    });
  }
  invite(course: RaceCourse, now: number, peerCount: number, raceId: string) {
    if (
      ['racing', 'countdown', 'inviting'].includes(this.phase) ||
      !validRaceCourse(course)
    )
      return false;
    this.reset();
    this.host = this.id;
    this.raceId = raceId;
    this.course = course;
    this.accepted = true;
    this.participants.add(this.id);
    this.phase = 'inviting';
    this.until = now + (peerCount ? 8000 : 500);
    this.nextRepeat = now;
    this.packet('invite', now, { course, until: this.until });
    return true;
  }
  accept(now: number) {
    if (this.phase !== 'invited' || now > this.until) return;
    this.accepted = true;
    this.participants.add(this.id);
    this.packet('accept', now);
  }
  decline(now: number) {
    if (this.phase === 'invited') {
      this.accepted = false;
      this.reset();
    } else this.cancel(now);
  }
  cancel(now: number) {
    if (this.host === this.id) this.packet('cancel', now);
    this.reset();
  }
  /** Restart is a personal attempt; it never force-teleports other racers. */
  restart(now: number): boolean {
    if (!this.course) return false;
    const course = this.course,
      best = this.bestSplits;
    // End a hosted public attempt once, then keep retries entirely local.
    if (this.host === this.id && !this.privateAttempt) this.packet('cancel', now);
    this.reset();
    this.host = this.id;
    this.raceId = `retry-${this.id}-${Math.round(now)}`;
    this.course = course;
    this.accepted = true;
    this.privateAttempt = true;
    this.participants.add(this.id);
    this.bestSplits = best;
    this.phase = 'countdown';
    this.startAt = now + 700;
    this.until = this.startAt;
    this.nextRepeat = Infinity;
    this.primeProgress();
    this.hooks.teleport(course.start);
    return true;
  }
  private reset() {
    this.phase = 'free';
    this.accepted = false;
    this.course = null;
    this.results.clear();
    this.scores.clear();
    this.participants.clear();
    this.time = 0;
    this.completed = false;
    this.startAt = 0;
    this.splits = [];
    this.activeGateIds = [];
    this.completedGateIds.clear();
    this.missedGate = false;
    this.styleScore = 0;
    this.medal = null;
    this.previousPosition = null;
    this.previousTick = 0;
    this.nearestGate = Infinity;
    this.scoreBase = null;
    this.gateBonus = 0;
    this.recent.clear();
    this.bestSplits = [];
    this.privateAttempt = false;
  }
  private primeProgress() {
    this.splits = [];
    this.activeGateIds = this.course?.gates?.length
      ? [this.course.gates[0].id]
      : [];
    this.completedGateIds.clear();
    this.previousPosition = this.course ? [...this.course.start] : null;
    this.previousTick = this.startAt;
    this.nearestGate = Infinity;
  }
  private start(now: number, countdown = 3000) {
    if (!this.course) return;
    this.phase = 'countdown';
    this.startAt = now + countdown;
    this.until = this.startAt;
    this.nextRepeat = now + 750;
    this.primeProgress();
    this.hooks.teleport(this.course.start);
    this.packet('start', now, {
      course: this.course,
      until: this.startAt,
      participants: [...this.participants],
    });
  }
  private validFinishPath(splits: RaceSplit[] | undefined): boolean {
    if (!this.course?.gates) return true;
    if (!splits?.length) return false;
    let next = [this.course.gates[0].id];
    for (const split of splits) {
      if (!next.includes(split.gateId)) return false;
      const gate = this.course.gates.find((g) => g.id === split.gateId);
      if (!gate) return false;
      next = gate.next;
    }
    return next.length === 0;
  }
  receive(packet: unknown, now: number) {
    if (!validRacePacket(packet)) return;
    const p = packet;
    if (p.sender === this.id || Math.abs(p.sentAt - now) > 30000) return;
    if (p.type === 'invite') {
      if (!p.course || !p.until || p.until < now || p.until > now + 15000)
        return;
      if (this.raceId === p.raceId) return;
      if (!['free', 'finished', 'invited'].includes(this.phase)) return;
      if (this.phase === 'invited' && this.accepted) return;
      this.reset();
      this.phase = 'invited';
      this.host = p.sender;
      this.raceId = p.raceId;
      this.course = p.course;
      this.until = p.until;
      return;
    }
    if (p.raceId !== this.raceId) return;
    if (
      p.type === 'accept' &&
      p.sender !== this.id &&
      this.host === this.id &&
      this.phase === 'inviting' &&
      now < this.until
    ) {
      this.participants.add(p.sender);
      return;
    }
    if (
      p.type === 'start' &&
      p.sender === this.host &&
      this.accepted &&
      this.phase === 'invited' &&
      p.course &&
      p.participants?.includes(this.id) &&
      p.until &&
      p.until >= now - 1500 &&
      p.until < now + 10000
    ) {
      if (
        p.course.id !== this.course?.id ||
        JSON.stringify(p.course) !== JSON.stringify(this.course)
      )
        return;
      this.participants = new Set(p.participants);
      this.phase = 'countdown';
      this.startAt = p.until;
      this.primeProgress();
      this.hooks.teleport(p.course.start);
      return;
    }
    if (
      p.type === 'cancel' &&
      p.sender === this.host &&
      this.phase !== 'finished'
    ) {
      this.reset();
      return;
    }
    if (
      p.type === 'finish' &&
      this.participants.has(p.sender) &&
      p.elapsed &&
      this.startAt &&
      p.sentAt >= this.startAt &&
      Math.abs(p.sentAt - this.startAt - p.elapsed) < 2500 &&
      this.validFinishPath(p.splits) &&
      (!p.splits?.length || p.splits[p.splits.length - 1].time <= p.elapsed + 1)
    ) {
      if (!this.results.has(p.sender)) {
        this.results.set(p.sender, p.elapsed);
        this.scores.set(p.sender, p.score ?? 0);
      }
    }
  }
  tick(now: number, position: RacePoint, telemetry: RaceTelemetry = {}) {
    if (!Number.isFinite(now) || !point(position)) return;
    if (this.phase === 'inviting') {
      if (now >= this.until) this.start(now);
      else if (now >= this.nextRepeat) {
        this.nextRepeat = now + 1000;
        this.packet('invite', now, { course: this.course!, until: this.until });
      }
    }
    if (this.phase === 'invited') {
      if (this.accepted && now >= this.nextRepeat) {
        this.nextRepeat = now + 700;
        this.packet('accept', now);
      }
      if (now > this.until + 8000) this.reset();
    }
    if (this.phase === 'countdown') {
      if (
        this.host === this.id &&
        !this.privateAttempt &&
        now < this.startAt &&
        now >= this.nextRepeat
      ) {
        this.nextRepeat = now + 750;
        this.packet('start', now, {
          course: this.course!,
          until: this.startAt,
          participants: [...this.participants],
        });
      }
      if (now >= this.startAt) {
        this.phase = 'racing';
        this.scoreBase = telemetry.styleScore ?? 0;
        this.hooks.started(this.course!);
      }
    }
    if (this.phase !== 'racing' || !this.course) return;
    this.time = Math.max(0, now - this.startAt);
    if (
      telemetry.styleScore !== undefined &&
      Number.isFinite(telemetry.styleScore)
    )
      this.styleScore =
        Math.max(0, telemetry.styleScore - (this.scoreBase ?? 0)) +
        this.gateBonus;
    for (const event of telemetry.events ?? []) this.recent.set(event, now);
    for (const [event, time] of this.recent)
      if (now - time > 1500) this.recent.delete(event);
    const gates = this.course.gates;
    if (gates?.length) {
      let from = this.previousPosition ?? position;
      if (
        raceDistance(from, position) >
        Math.max(60, ((now - this.previousTick) / 1000) * 200)
      )
        from = position;
      for (let pass = 0; pass < gates.length; pass++) {
        const candidates = gates.filter((g) =>
          this.activeGateIds.includes(g.id),
        );
        const crossed = candidates
          .map((g) => ({ gate: g, t: gateCrossing(from, position, g) }))
          .filter(
            (x): x is { gate: RaceGate; t: number } =>
              x.t !== null &&
              gateSatisfied(
                x.gate,
                telemetry,
                this.recent,
                now,
                Math.max(0, this.styleScore - this.gateBonus),
              ),
          )
          .sort((a, b) => a.t - b.t)[0];
        if (!crossed) break;
        const gate = crossed.gate;
        this.gateBonus += gate.bonus;
        this.styleScore += gate.bonus;
        this.completedGateIds.add(gate.id);
        this.splits.push({
          gateId: gate.id,
          time: this.time,
          score: this.styleScore,
        });
        this.activeGateIds = [...gate.next];
        this.nearestGate = Infinity;
        this.missedGate = false;
        from = from.map(
          (n, i) => n + (position[i] - n) * crossed.t,
        ) as RacePoint;
        if (!this.activeGateIds.length) break;
      }
      const active = gates.filter((g) => this.activeGateIds.includes(g.id));
      if (active.length) {
        const distance = Math.min(
          ...active.map((g) => raceDistance(position, g.position)),
        );
        this.nearestGate = Math.min(this.nearestGate, distance);
        this.missedGate =
          distance > Math.max(70, this.nearestGate + 45) &&
          this.nearestGate < 50;
      }
    }
    this.previousPosition = [...position];
    this.previousTick = now;
    const reached = gates?.length
      ? this.activeGateIds.length === 0 && this.splits.length > 0
      : raceDistance(position, this.course.finish) < 9;
    if (!this.completed && reached && this.time > 250) {
      this.completed = true;
      this.phase = 'finished';
      this.medal = raceMedal(this.course, this.time, this.styleScore);
      this.results.set(this.id, this.time);
      this.scores.set(this.id, this.styleScore);
      if (!this.privateAttempt)
        this.packet('finish', now, {
          elapsed: this.time,
          splits: this.splits,
          score: this.styleScore,
        });
      this.hooks.finished(this.course, this.time);
    }
  }
}
export function formatRaceTime(ms: number | null) {
  if (ms === null) return '—';
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
}
