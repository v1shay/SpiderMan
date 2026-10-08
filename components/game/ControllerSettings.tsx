'use client';
import { useEffect, useState } from 'react';
import { buttonName, controllerName, defaultControllerSettings, loadControllerSettings, saveControllerSettings, type ControllerSettings as Settings } from '@/lib/controller';
import type { InputAction } from '@/lib/input-system';

export default function ControllerSettings() {
  const [settings, setSettings] = useState<Settings>(defaultControllerSettings);
  const [status, setStatus] = useState('Connect in macOS Bluetooth, then press any controller button.');
  const [family, setFamily] = useState('Xbox');
  const [capture, setCapture] = useState<InputAction | null>(null);
  useEffect(() => { const frame = requestAnimationFrame(() => setSettings(loadControllerSettings())); return () => cancelAnimationFrame(frame); }, []);
  useEffect(() => {
    let frame = 0;
    let armed = false;
    const candidate = new Set<number>();
    const poll = () => {
      const pad = Array.from(navigator.getGamepads?.() ?? []).find(p => p?.connected);
      if (pad) {
        setFamily(controllerName(pad.id));
        setStatus(`${controllerName(pad.id)} connected${pad.mapping === 'standard' ? '' : ' · customize buttons and axes below'}`);
        const buttons = pad.buttons.flatMap((b, i) => b.pressed || b.value > .55 ? [i] : []);
        if (!buttons.length && !candidate.size) armed = true;
        if (capture && armed && buttons.length) buttons.forEach(button => { if (button !== 9) candidate.add(button); });
        if (capture && armed && !buttons.length && candidate.size) {
          const next = { ...settings, bindings: { ...settings.bindings, [capture]: [...candidate].slice(0, 3) } };
          setSettings(next); saveControllerSettings(next); setCapture(null);
        }
      } else setStatus('Connect in macOS Bluetooth, then press any controller button.');
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [capture, settings]);
  const update = (next: Settings) => { setSettings(next); saveControllerSettings(next); };
  return <section aria-labelledby="controller-settings-heading">
    <h2 id="controller-settings-heading">Controller</h2>
    <output>{status}</output>
    <p>Left stick moves · Right stick looks · Menu / Options pauses. Xbox and PlayStation labels match the same physical buttons. Bluetooth and USB use the same layout.</p>
    <label className="settings-row"><span><b>Stick dead zone</b><small>{Math.round(settings.deadzone * 100)}% · increase for stick drift</small></span><input aria-label="Controller dead zone" type="range" min="0.05" max="0.4" step="0.01" value={settings.deadzone} onChange={e => update({ ...settings, deadzone: Number(e.target.value) })} /></label>
    <label className="settings-row"><span><b>Camera sensitivity</b><small>{settings.sensitivity.toFixed(1)}</small></span><input aria-label="Controller camera sensitivity" type="range" min="0.3" max="6" step="0.1" value={settings.sensitivity} onChange={e => update({ ...settings, sensitivity: Number(e.target.value) })} /></label>
    <label aria-label="Invert controller camera Y" className="settings-row"><span><b>Invert camera Y</b></span><input type="checkbox" checked={settings.invertY} onChange={e => update({ ...settings, invertY: e.target.checked })} /></label>
    {(['moveAxes','lookAxes'] as const).map(kind => <div key={kind}><b>{kind === 'moveAxes' ? 'Movement' : 'Camera'} axes</b>{([0, 1] as const).map(axis => <label key={axis}> {axis === 0 ? 'Horizontal' : 'Vertical'} <input aria-label={`${kind} ${axis === 0 ? 'horizontal' : 'vertical'} axis`} type="number" min="0" max="15" value={settings[kind][axis]} onChange={e => { const axes = [...settings[kind]] as [number, number]; axes[axis] = Math.max(0, Math.min(15, Math.floor(Number(e.target.value)))); update({ ...settings, [kind]: axes }); }} /></label>)}</div>)}
    <p>Choose a binding, release all buttons, then press and release a button or combination. Menu / Options is reserved for pause. Longer combinations take priority. Combat buttons apply during boss fights.</p>
    {(Object.keys(settings.bindings) as InputAction[]).filter(a => !a.startsWith('move')).map(action => <div className="settings-row" key={action}><span><b>{action.replace(/([A-Z])/g, ' $1')}</b></span><button type="button" onClick={() => setCapture(capture === action ? null : action)}>{capture === action ? 'Press controller buttons… (click to cancel)' : settings.bindings[action].map(b => buttonName(b, family)).join(' + ') || 'Unbound'}</button><button type="button" aria-label={`Clear ${action} binding`} onClick={() => update({ ...settings, bindings: { ...settings.bindings, [action]: [] } })}>Clear</button></div>)}
    <button type="button" onClick={() => { setCapture(null); update(defaultControllerSettings()); }}>Restore Insomniac-style defaults</button>
  </section>;
}
