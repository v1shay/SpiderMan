import { ADVANCED_TRAVERSAL_CONFIG } from './traversal-advanced.ts';
import type { TraversalConfig } from './traversal-physics.ts';

export type SwingParameter = {
  key: keyof TraversalConfig; label: string; description: string; group: string;
  min: number; max: number; step: number; value: number;
};
const p = (key: keyof TraversalConfig, label: string, description: string, group: string, min: number, max: number, step: number, value: number): SwingParameter => ({ key, label, description, group, min, max, step, value });
export const SWING_PARAMETERS: readonly SwingParameter[] = [
  p('maximumSpeed','Speed limit','Maximum total traversal speed (m/s).','Momentum',25,130,1,78),
  p('swingCruiseSpeed','Swing cruising speed','The pump fades as you reach this speed; dives can go faster.','Momentum',15,100,1,42),
  p('swingPumpAcceleration','Pump power','Acceleration through the arc, strongest near the bottom.','Momentum',0,80,1,32),
  p('swingHorizontalDrag','Horizontal damping','Higher values tame long forward travel.','Momentum',0,1,.01,.10),
  p('swingVerticalDrag','Vertical damping','Higher values shorten vertical oscillations.','Momentum',0,1,.01,.04),
  p('gravity','Gravity','Weight and fall acceleration (m/s²).','Arc and bounce',10,55,1,29),
  p('swingElasticity','Web stretch','Allowed elastic stretch before the rope reaches its hard limit.','Arc and bounce',0,.10,.005,.025),
  p('swingSpring','Web spring stiffness','Lower values give a stretchier, bouncier catch.','Arc and bounce',20,120,1,72),
  p('swingDamping','Web damping','Damps radial web stretch, not the whole swing.','Arc and bounce',2,22,.5,11),
  p('swingHorizontalTension','Horizontal arc strength','Sideways rope force; higher values make a rounder pendulum arc.','Arc and bounce',.15,1.2,.01,.82),
  p('swingVerticalTension','Vertical arc strength','Vertical rope support and rebound.','Arc and bounce',.5,1.4,.01,1),
  p('swingPayout','Automatic web slack','How much forward travel lengthens the web. Zero makes a fixed-length pendulum.','Arc and bounce',0,.85,.01,.06),
  p('swingPumpVerticalScale','Vertical bounce','How much pumping contributes to the vertical arc.','Arc and bounce',0,1.8,.05,1.05),
  p('swingPumpHorizontalScale','Horizontal bounce','How much pumping contributes to horizontal movement.','Arc and bounce',0,1.8,.05,.85),
  p('swingMinimumLength','Shortest web','Minimum web length in metres.','Web and anchors',4,20,1,6),
  p('swingMaximumLength','Longest web','Maximum web length in metres.','Web and anchors',35,150,1,88),
  p('swingReelSpeed','Manual reel speed','D-pad or V/B web adjustment speed.','Web and anchors',2,24,1,10),
  p('anchorMinimumDistance','Closest anchor','Minimum distance to a real building attachment.','Web and anchors',3,20,1,5),
  p('anchorMaximumDistance','Anchor reach','Maximum building search distance.','Web and anchors',45,170,1,125),
  p('anchorMinimumHeight','Anchor height','Minimum height of the attachment above you.','Web and anchors',1,15,.5,4),
  p('swingAutoReattach','Automatic next web','Release near a slow apex and look for the next real building. Zero keeps the current pendulum.','Web and anchors',0,1,1,1),
  p('swingCatchSlack','Catch softness','Slack added on fast airborne attachments.','Web and anchors',0,4,.1,1),
  p('swingSteerAcceleration','Steering response','How quickly movement input bends the swing.','Control',5,90,1,42),
  p('swingCameraSteering','Camera steering','How much the camera guides swings without stick/WASD input.','Control',0,1,.05,.35),
  p('swingPitchAcceleration','Height control','Look up to add tangent lift; look down to lower the arc.','Control',0,40,1,18),
  p('airAcceleration','Air control','Steering power after releasing the web.','Control',0,28,1,10),
  p('diveGravityMultiplier','Dive gravity','Additional gravity while holding dive.','Control',1,3,.05,1.75),
  p('diveAcceleration','Dive push','Forward dive acceleration.','Control',0,30,1,11),
  p('swingLaunchUp','Street takeoff height','One supported push-off when starting a swing from the ground.','Release',6,26,1,16),
  p('swingReleaseBoost','Release forward boost','Small forward bonus; timing preserves your existing momentum.','Release',0,20,.5,4),
  p('swingReleaseLift','Release lift','Maximum added release lift; an upswing gets the best result.','Release',0,25,.5,12),
  p('swingJumpKick','Jump off the web','Extra lift when you jump out of a swing.','Release',0,15,.5,5),
  p('swingReleaseChargeSeconds','Release charge time','Hold duration for the full release assist.','Release',.4,2.5,.1,1.1),
  p('swingAvoidance','Building avoidance','Strength of predictive lane steering. Zero disables assistance.','Assistance',0,1,.05,1),
  p('swingAvoidanceLookAhead','Building look ahead','Seconds of travel scanned for a clear lane.','Assistance',.4,2.5,.1,1.8),
  p('swingAvoidanceTurnRate','Avoidance turning','Maximum assisted turning speed (radians/s).','Assistance',.5,3.5,.1,2.4),
  p('swingAvoidanceAcceleration','Avoidance force','Upper acceleration limit for clear-lane steering.','Assistance',20,100,1,78),
  p('swingAvoidanceBraking','Obstacle braking','Brake when there is not enough space to turn.','Assistance',10,90,1,62),
  p('swingGroundAssist','Ground skim assist','Softens accidental low swings. Diving bypasses this assist.','Assistance',0,1,.05,1),
  p('swingGroundClearance','Street clearance','Height the ground protection tries to preserve.','Assistance',.5,5,.1,1.8),
  p('swingAssistBudget','Total assist strength','Shared acceleration allowance for safety, steering, and pumping.','Assistance',30,120,1,96),
  p('baseFov','Camera field of view','Base camera field of view.','Camera',50,85,1,66),
  p('maximumFov','Speed field of view','Maximum camera field of view at high speed.','Camera',70,110,1,91),
  p('cameraMotionScale','Camera motion','Strength of swing camera movement; reduced motion still takes priority.','Camera',0,1.5,.05,.8),
];
export type SwingPreset = 'friendly' | 'physical' | 'acrobat' | 'custom';
export type SavedSwingProfile = { version: 1; name: string; preset: SwingPreset; values: Partial<TraversalConfig> };
export const PROFILE_STORAGE_KEY = 'spiderman-swing-profile-v1';
export function swingPreset(preset: SwingPreset = 'friendly'): SavedSwingProfile {
  const values = Object.fromEntries(SWING_PARAMETERS.map(field => [field.key,field.value])) as Partial<TraversalConfig>;
  if (preset === 'physical') Object.assign(values,{swingAutoReattach:0,swingPayout:0,swingCameraSteering:0,swingAvoidance:.45,swingPumpAcceleration:18,swingHorizontalTension:1,swingReleaseBoost:0,swingReleaseLift:4});
  if (preset === 'acrobat') Object.assign(values,{swingPumpVerticalScale:1.45,swingReleaseLift:20,swingJumpKick:9,swingMaximumLength:72,swingCruiseSpeed:46});
  return {version:1,name:preset === 'physical' ? 'Momentum' : preset === 'acrobat' ? 'Acrobat' : 'Friendly Neighborhood',preset,values};
}
export function sanitizeSwingProfile(value: unknown): SavedSwingProfile {
  const defaults = swingPreset();
  if (!value || typeof value !== 'object') return defaults;
  const saved = value as Partial<SavedSwingProfile>;
  if (saved.version !== 1) return defaults;
  const output = { ...defaults, name: typeof saved.name === 'string' ? saved.name.slice(0,48) : defaults.name,
    preset: ['friendly','physical','acrobat','custom'].includes(saved.preset ?? '') ? saved.preset! : 'custom' as SwingPreset };
  for (const field of SWING_PARAMETERS) {
    const v = saved.values?.[field.key];
    if (typeof v === 'number' && Number.isFinite(v)) (output.values as Record<string,number>)[field.key] = Math.max(field.min,Math.min(field.max,v));
  }
  output.values.swingMaximumLength = Math.max(output.values.swingMinimumLength!,output.values.swingMaximumLength!);
  output.values.anchorMaximumDistance = Math.max(output.values.anchorMinimumDistance!,output.values.anchorMaximumDistance!);
  output.values.maximumFov = Math.max(output.values.baseFov!,output.values.maximumFov!);
  output.values.swingCruiseSpeed = Math.min(output.values.maximumSpeed!,output.values.swingCruiseSpeed!);
  return output;
}
export function loadSwingProfile(): SavedSwingProfile {
  try { return sanitizeSwingProfile(JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) ?? 'null')); } catch { return swingPreset(); }
}
export function saveSwingProfile(profile: SavedSwingProfile): SavedSwingProfile {
  const next = sanitizeSwingProfile(profile);
  try { localStorage.setItem(PROFILE_STORAGE_KEY,JSON.stringify(next)); } catch { /* Session settings remain available. */ }
  window.dispatchEvent(new CustomEvent('swing-profile-change',{detail:next}));
  return next;
}
export function swingProfileConfig(profile: SavedSwingProfile): Partial<TraversalConfig> {
  return {...ADVANCED_TRAVERSAL_CONFIG,...sanitizeSwingProfile(profile).values,profiledSwing:true};
}

/** Ghosts and personal bests belong to the same physics, not only the same route. */
export function swingProfileFingerprint(profile: SavedSwingProfile): string {
  let hash = 2166136261;
  const values = sanitizeSwingProfile(profile).values;
  const text = SWING_PARAMETERS.map(p => `${p.key}:${values[p.key]}`).join('|');
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0),16777619);
  return (hash >>> 0).toString(16);
}
