import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Puck, Render } from '@puckeditor/core';
import '@puckeditor/core/puck.css';
import { config } from './config';
import { screenToData, dataToScreen } from './convert';
import kapiko from '../../v2-schema/fixtures/kapiko.synthetic.json';
const screen = kapiko.screens.find((s: any) => s.id === 'dashboard')!;
const initial = screenToData(screen);
(window as any).__initial = screen;
function App() {
  const [data, setData] = useState<any>(initial);
  const mode = new URLSearchParams(location.search).get('mode');
  if (mode === 'render') return <div style={{ width: 390, margin: '0 auto', padding: 16, display: 'grid', gap: 12 }} data-testid="render"><Render config={config} data={initial} /></div>;
  return <Puck config={config} data={data} viewports={[{ width: 390, height: 844, label: 'Phone', icon: 'Smartphone' }, { width: 1280, height: 800, label: 'Portal', icon: 'Monitor' }]}
    onChange={d => { setData(d); (window as any).__screen = dataToScreen(screen, d); }} />;
}
createRoot(document.getElementById('root')!).render(<App />);
