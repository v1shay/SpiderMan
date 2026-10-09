'use client';
import { useEffect, useState } from 'react';
import { SWING_PARAMETERS, loadSwingProfile, saveSwingProfile, swingPreset, sanitizeSwingProfile, type SavedSwingProfile, type SwingPreset } from '@/lib/swing-profile';

export default function SwingProfileSettings({ locked = false }: { locked?: boolean }) {
  const [profile,setProfile] = useState<SavedSwingProfile>(swingPreset);
  const [message,setMessage] = useState('');
  useEffect(() => {
    const frame = requestAnimationFrame(() => setProfile(loadSwingProfile()));
    return () => cancelAnimationFrame(frame);
  },[]);
  const update = (next: SavedSwingProfile) => setProfile(saveSwingProfile(next));
  const groups = [...new Set(SWING_PARAMETERS.map(p => p.group))];
  return <section aria-labelledby="swing-profile-heading" className="swing-profile-settings">
    <h2 id="swing-profile-heading">Your swing profile</h2>
    <p>Start with assisted, rounded swings or build your own. Look up or down to shape the arc. Release on the upswing for height; jump off the web for an extra kick.</p>
    {locked && <output>Finish or leave the race to change your profile. Everyone races with the host&apos;s profile.</output>}
    <fieldset disabled={locked} style={{border:0,padding:0,margin:0}}>
      <label className="settings-row"><span><b>Preset</b><small>Changes apply when you resume</small></span><select aria-label="Swing profile preset" value={profile.preset} onChange={e => update(swingPreset(e.target.value as SwingPreset))}>
        <option value="friendly">Friendly Neighborhood</option><option value="physical">Momentum</option><option value="acrobat">Acrobat</option><option value="custom" disabled>Custom</option>
      </select></label>
      <label className="settings-row"><span><b>Profile name</b></span><input aria-label="Swing profile name" maxLength={48} value={profile.name} onChange={e => update({...profile,name:e.target.value})} /></label>
      {groups.map(group => <details key={group} open={group === 'Arc and bounce'}><summary>{group}</summary>
        {SWING_PARAMETERS.filter(field => field.group === group).map(field => <label className="swing-profile-field" key={field.key} htmlFor={`swing-${field.key}`}>
          <span><b>{field.label}</b><small>{field.description}</small></span>
          <input id={`swing-${field.key}`} type="range" min={field.min} max={field.max} step={field.step} value={Number(profile.values[field.key])} onChange={e => update({...profile,preset:'custom',values:{...profile.values,[field.key]:Number(e.target.value)}})} />
          <input aria-label={`${field.label} value`} type="number" min={field.min} max={field.max} step={field.step} value={Number(profile.values[field.key])} onChange={e => { if (Number.isFinite(e.target.valueAsNumber)) update({...profile,preset:'custom',values:{...profile.values,[field.key]:e.target.valueAsNumber}}); }} />
        </label>)}
      </details>)}
      <div className="settings-action-grid"><button type="button" onClick={() => update(swingPreset())}>Restore default swing</button><button type="button" onClick={() => {
        const blob = new Blob([JSON.stringify(profile,null,2)],{type:'application/json'});
        const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'spiderman-swing-profile.json'; link.click(); URL.revokeObjectURL(url);
      }}>Export profile</button></div>
      <label className="settings-row"><span><b>Import profile</b></span><input aria-label="Import swing profile" type="file" accept=".json,application/json" onChange={e => {
        const file = e.target.files?.[0]; if (!file) return;
        if (file.size > 20000) { setMessage('Choose a swing profile smaller than 20 KB.'); return; }
        void file.text().then(text => { const saved = JSON.parse(text); if (saved.version !== 1 || !saved.values) throw new Error('Invalid profile'); update(sanitizeSwingProfile(saved)); setMessage('Profile imported.'); }).catch(() => setMessage('This file is not a valid swing profile.'));
        e.target.value = '';
      }} /></label>
    </fieldset><output>{message}</output>
  </section>;
}
