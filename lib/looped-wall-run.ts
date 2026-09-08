import * as THREE from 'three';

/** Close a cropped run's seam without playing the footwork backwards.
 * Only numeric/vector/quaternion motion is rebuilt. The source is not mutated.
 * This removes a value discontinuity, not a substitute for reviewing the stride.
 */
export function closeWallRunLoop(source: THREE.AnimationClip): THREE.AnimationClip {
  const duration = source.duration;
  if (!Number.isFinite(duration) || duration <= 0) return source.clone();
  const samples = Math.max(2, Math.ceil(duration * 60));
  const blendSeconds = Math.min(.12, duration * .2);
  const times = new Float32Array(Array.from({ length: samples + 1 }, (_, i) => i * duration / samples));
  const tracks = source.tracks.map(track => {
    const result = track.clone();
    if (!['number', 'vector', 'quaternion', 'color'].includes(track.ValueTypeName)) return result;
    const size = track.getValueSize();
    const interpolant = track.getInterpolation() === THREE.InterpolateDiscrete
      ? track.InterpolantFactoryMethodDiscrete() : track.InterpolantFactoryMethodLinear();
    const first = Array.from(interpolant.evaluate(0)) as number[];
    const values = new Float32Array(times.length * size);
    const quaternion = track.ValueTypeName === 'quaternion' && size === 4;
    for (let i = 0; i < times.length; i++) {
      const sample = Array.from(interpolant.evaluate(times[i])) as number[];
      const t = Math.max(0, Math.min(1, (times[i] - (duration - blendSeconds)) / blendSeconds));
      const blend = t * t * (3 - 2 * t);
      if (quaternion) {
        const blended = [0, 0, 0, 1];
        THREE.Quaternion.slerpFlat(blended, 0, sample, 0, first, 0, blend);
        for (let j = 0; j < 4; j++) values[i * size + j] = blended[j];
      } else {
        for (let j = 0; j < size; j++) values[i * size + j] = sample[j] + (first[j] - sample[j]) * blend;
      }
    }
    // Float32 time rounding must not leave a tiny non-matching last pose.
    values.set(first, (times.length - 1) * size);
    result.times = times.slice();
    result.values = values;
    result.setInterpolation(THREE.InterpolateLinear);
    return result;
  });
  return new THREE.AnimationClip(source.name, duration, tracks, source.blendMode);
}
