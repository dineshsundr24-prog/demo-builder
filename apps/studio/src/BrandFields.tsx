// Optional brand assets: logo upload, palette presets or custom colours, and font.
import React, { useState } from 'react';
import { Upload, X } from 'lucide-react';

export type BrandValue = { logo?: string; primary?: string; secondary?: string; accent?: string; font?: 'system' | 'inter' | 'serif' | 'rounded' };
export const PALETTES: { name: string; primary: string; secondary: string; accent: string }[] = [
  { name: 'Navy & Teal', primary: '#17365D', secondary: '#0E9389', accent: '#F58220' },
  { name: 'Royal Blue', primary: '#0B4DA2', secondary: '#2F80ED', accent: '#F2C94C' },
  { name: 'Emerald', primary: '#0B6E4F', secondary: '#2BAE66', accent: '#F5B700' },
  { name: 'Burgundy', primary: '#7A1F3D', secondary: '#B23A48', accent: '#E9B44C' },
  { name: 'Slate & Gold', primary: '#1F2937', secondary: '#4B5563', accent: '#C9A227' },
  { name: 'Violet', primary: '#4B2E83', secondary: '#7B61FF', accent: '#FFB547' },
  { name: 'Ocean', primary: '#035388', secondary: '#0FB5BA', accent: '#F0B429' },
  { name: 'Desert', primary: '#8C5A2B', secondary: '#C48A3F', accent: '#2E7D6B' },
];
const MAX_LOGO = 300 * 1024;

export function BrandFields({ value, onChange, compact }: { value: BrandValue; onChange: (v: BrandValue) => void; compact?: boolean }) {
  const [error, setError] = useState('');
  const pick = async (file: File) => {
    setError('');
    if (!['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'].includes(file.type)) return setError('Use a PNG, JPEG, SVG or WebP image.');
    if (file.size > MAX_LOGO) return setError('Logo must be under 300 KB.');
    const url = await new Promise<string>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = fail; r.readAsDataURL(file); });
    onChange({ ...value, logo: url });
  };
  const active = PALETTES.find(p => p.primary === value.primary && p.secondary === value.secondary && p.accent === value.accent);
  return <div className={'brand-fields' + (compact ? ' compact' : '')} data-testid="brand-fields">
    <div className="brand-row">
      <span className="brand-label">Logo</span>
      {value.logo ? <span className="brand-logo"><img src={value.logo} alt="Uploaded logo" /><button type="button" aria-label="Remove logo" onClick={() => onChange({ ...value, logo: undefined })}><X size={14} /></button></span>
        : <label className="brand-upload"><Upload size={14} />Upload logo<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" aria-label="Upload logo" onChange={e => e.target.files?.[0] && pick(e.target.files[0])} /></label>}
    </div>
    {error ? <p className="studio-error" role="alert">{error}</p> : null}
    <div className="brand-row brand-palettes" role="radiogroup" aria-label="Colour palette">
      <span className="brand-label">Colours</span>
      <button type="button" role="radio" aria-checked={!value.primary} className="brand-auto" onClick={() => onChange({ ...value, primary: undefined, secondary: undefined, accent: undefined })}>Automatic</button>
      {PALETTES.map(p => <button type="button" role="radio" aria-checked={active?.name === p.name} key={p.name} title={p.name} aria-label={p.name} className="brand-swatch" onClick={() => onChange({ ...value, primary: p.primary, secondary: p.secondary, accent: p.accent })}>
        <span style={{ background: p.primary }} /><span style={{ background: p.secondary }} /><span style={{ background: p.accent }} /></button>)}
    </div>
    <div className="brand-row">
      <span className="brand-label">Custom</span>
      {(['primary', 'secondary', 'accent'] as const).map(k => <label key={k} className="brand-color"><input type="color" aria-label={k + ' colour'} value={value[k] ?? '#17365D'} onChange={e => onChange({ ...value, [k]: e.target.value.toUpperCase() })} />{k}</label>)}
    </div>
    <div className="brand-row">
      <span className="brand-label">Font</span>
      <select aria-label="Font" value={value.font ?? ''} onChange={e => onChange({ ...value, font: (e.target.value || undefined) as BrandValue['font'] })}>
        <option value="">Automatic</option><option value="inter">Modern (Inter)</option><option value="system">System</option><option value="rounded">Rounded</option><option value="serif">Classic serif</option>
      </select>
    </div>
  </div>;
}
