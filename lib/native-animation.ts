import * as THREE from 'three';

/** Extract authored curves at exact endpoints; never retarget or resynthesize. */
export function nativeSegment(source: THREE.AnimationClip, start: number, end: number, name: string) {
  end = Math.min(end, source.duration);
  const tracks = source.tracks.map(track => {
    const times = [start, ...Array.from(track.times).filter(t => t > start && t < end), end];
    const interpolant = track.getInterpolation() === THREE.InterpolateDiscrete
      ? track.InterpolantFactoryMethodDiscrete() : track.InterpolantFactoryMethodLinear();
    const copy = track.clone();
    copy.times = new Float32Array(times.map(time => time - start));
    copy.values = new Float32Array(times.flatMap(time => Array.from(interpolant.evaluate(time))));
    return copy;
  });
  return new THREE.AnimationClip(name, end - start, tracks);
}

export type NativeSelection = {
  clip: THREE.AnimationClip;
  loop: typeof THREE.LoopOnce | typeof THREE.LoopPingPong | typeof THREE.LoopRepeat;
  rate: number;
  bodySupport?: boolean;
};
