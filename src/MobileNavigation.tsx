import React from 'react';
import {House,LayoutGrid,UserRound,Menu as MenuIcon,FileText,Settings,ArrowRight,Activity,ShieldCheck} from 'lucide-react';
import type {Element} from './demo';
// @ts-ignore Shared appearance contract
import {appearanceToStyle} from './visualStyle.mjs';
import './mobileNavigation.css';
type Navigation=Extract<Element,{kind:'navigation'}>;
export default function MobileNavigation({element,onNavigate,selectedLinkId,onSelectLink,editing=false}:{element:Navigation;onNavigate:(id?:string)=>void;selectedLinkId?:string;onSelectLink?:(id:string)=>void;editing?:boolean}){
 const icons=[House,LayoutGrid,Activity,UserRound,FileText,Settings,ShieldCheck];
 return <nav className={'mobile-navigation mobile-navigation-'+element.variant+(editing?' mobile-navigation-editing':'')} style={appearanceToStyle(element.appearance)} aria-label={element.title}>
  {element.variant==='menu'&&<div className="mobile-navigation-title"><MenuIcon size={18}/><strong>{element.title}</strong></div>}
  <div className="mobile-navigation-links">
   {element.links.map((link,i)=>{
    const Icon=icons[i%icons.length];
    return <button type="button" key={link.id} className={'mobile-navigation-link'+(selectedLinkId===link.id?' selected':'')}
     data-select-level={editing?'nav-link':undefined} data-select-element={editing?element.id:undefined} data-select-child={editing?link.id:undefined}
     onClick={e=>{if(editing){e.preventDefault();onSelectLink?.(link.id);}else if(link.screenId)onNavigate(link.screenId);}}
     title={link.screenId?'Open '+link.label:editing?'Edit '+link.label:link.label+' — not connected'}>
     <Icon size={element.variant==='footer'?19:17}/>
     <span>{link.label}</span>{element.variant==='menu'&&<ArrowRight size={14}/>}
    </button>;
   })}
  </div>
  {editing&&<small className="mobile-navigation-hint">Select a menu item to edit its label or destination</small>}
 </nav>;
}
