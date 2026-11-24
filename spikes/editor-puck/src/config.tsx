import React from 'react';
import type { Config } from '@puckeditor/core';
// In the real build these definitions are GENERATED from the registry (fields
// from the Zod props). Hand-written here for the spike.
const theme = { primary: '#17365D', secondary: '#0E9389', accent: '#F58220' };
const btn = (v: string) => ({ padding: '12px 16px', borderRadius: 10, border: v === 'secondary' ? '1px solid ' + theme.primary : 'none', background: v === 'primary' ? theme.primary : 'transparent', color: v === 'primary' ? '#fff' : theme.primary, fontWeight: 600, width: v === 'link' ? 'auto' : '100%' });
export const config: Config = {
  categories: { layout: { components: ['Stack', 'Card', 'Form'] }, content: { components: ['Heading', 'Text', 'Stat'] }, input: { components: ['Input'] }, action: { components: ['Button'] } },
  components: {
    Stack: { fields: { direction: { type: 'radio', options: [{ label: 'Vertical', value: 'vertical' }, { label: 'Horizontal', value: 'horizontal' }] }, gap: { type: 'select', options: ['none', 'sm', 'md', 'lg'].map(v => ({ label: v, value: v })) }, children: { type: 'slot' } },
      defaultProps: { direction: 'vertical', gap: 'md', children: [] },
      render: ({ direction, gap, children: Children }: any) => <Children style={{ display: 'flex', flexDirection: direction === 'horizontal' ? 'row' : 'column', gap: { none: 0, sm: 8, md: 12, lg: 20 }[gap as 'sm'], minHeight: 40 }} /> },
    Card: { fields: { title: { type: 'text' }, tone: { type: 'select', options: ['default', 'brand', 'muted'].map(v => ({ label: v, value: v })) }, children: { type: 'slot' } },
      defaultProps: { title: 'Card', tone: 'default', children: [] },
      render: ({ title, tone, children: Children }: any) => <section data-testid="card" style={{ borderRadius: 14, padding: 16, background: tone === 'brand' ? theme.primary : '#fff', color: tone === 'brand' ? '#fff' : '#111', boxShadow: '0 1px 4px #0002' }}>{title && <h3 style={{ margin: '0 0 8px' }}>{title}</h3>}<Children style={{ minHeight: 30 }} /></section> },
    Form: { fields: { submitLabel: { type: 'text' }, children: { type: 'slot', allow: ['Input', 'Text', 'Stack'] } },
      defaultProps: { submitLabel: 'Continue', onSubmit: [], children: [] },
      render: ({ submitLabel, children: Children }: any) => <form onSubmit={e => e.preventDefault()} style={{ display: 'grid', gap: 10 }}><Children style={{ display: 'grid', gap: 10, minHeight: 30 }} /><button style={btn('primary')}>{submitLabel}</button></form> },
    Heading: { fields: { text: { type: 'text', contentEditable: true }, level: { type: 'select', options: ['1', '2', '3'].map(v => ({ label: 'H' + v, value: v })) } },
      defaultProps: { text: 'Heading', level: '2' },
      render: ({ text, level }: any) => React.createElement('h' + level, { style: { margin: 0, color: theme.primary } }, text) },
    Text: { fields: { text: { type: 'textarea', contentEditable: true } }, defaultProps: { text: 'Text' }, render: ({ text }: any) => <p style={{ margin: 0, color: '#444' }}>{text}</p> },
    Stat: { fields: { label: { type: 'text' }, value: { type: 'text' }, delta: { type: 'text' } }, defaultProps: { label: 'Balance', value: 'AED 0' },
      render: ({ label, value, delta }: any) => <div><small>{label}</small><div style={{ fontSize: 26, fontWeight: 700 }}>{value}</div>{delta && <small>{delta}</small>}</div> },
    Input: { fields: { label: { type: 'text' }, field: { type: 'text' }, inputType: { type: 'select', options: ['text', 'email', 'phone', 'number', 'password', 'date', 'otp', 'currency'].map(v => ({ label: v, value: v })) }, required: { type: 'radio', options: [{ label: 'Required', value: true }, { label: 'Optional', value: false }] } },
      defaultProps: { label: 'Field', field: 'form.field', inputType: 'text', required: false },
      render: ({ label, required, inputType }: any) => <label style={{ display: 'grid', gap: 4 }}><span>{label}{required && ' *'}</span><input type={inputType === 'currency' ? 'number' : inputType} style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }} /></label> },
    Button: { fields: { label: { type: 'text', contentEditable: true }, variant: { type: 'select', options: ['primary', 'secondary', 'link'].map(v => ({ label: v, value: v })) } },
      defaultProps: { label: 'Button', variant: 'primary', actions: [] },
      render: ({ label, variant }: any) => <button style={btn(variant)}>{label}</button> },
  },
};
