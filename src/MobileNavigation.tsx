import React,{useState} from 'react';
import {House,LayoutGrid,UserRound,Menu as MenuIcon,X,FileText,Settings,ArrowRight,Activity,ShieldCheck} from 'lucide-react';
import type {Element} from './demo';
// @ts-ignore Shared appearance contract
import {appearanceToStyle} from './visualStyle.mjs';
import './mobileNavigation.css';
type Navigation=Extract<Element,{kind:'navigation'}>;
export default function MobileNavigation({element,onNavigate,selectedLinkId,onSelectLink,editing=false}:{element:Navigation;onNavigate:(id?:string)=>void;selectedLinkId?:string;onSelectLink?:(id:string)=>void;editing?:boolean}){
 const [menuOpen,setMenuOpen]=useState(false);
 const icons=[House,LayoutGrid,Activity,UserRound,FileText,Settings,ShieldCheck];
 const isMenu=element.variant==='menu';
 const links=<div className="mobile-navigation-links" id={isMenu?'menu-links-'+element.id:undefined}>
   {element.links.map((link,i)=>{
    const Icon=icons[i%icons.length];
    return <button type="button" key={link.id} className={'mobile-navigation-link'+(selectedLinkId===link.id?' selected':'')}
     data-select-level={editing?'nav-link':undefined} data-select-element={editing?element.id:undefined} data-select-child={editing?link.id:undefined}
     onClick={e=>{if(editing){e.preventDefault();onSelectLink?.(link.id);}else if(link.screenId){setMenuOpen(false);onNavigate(link.screenId);}}}
     title={editing?'Edit '+link.label:link.screenId?'Open '+link.label:link.label+' — not connected'}>
     <Icon size={isMenu?17:19}/>
     <span>{link.label}</span>{isMenu&&<ArrowRight size={14}/>}
    </button>;
   })}
  </div>;
 return <nav className={'mobile-navigation mobile-navigation-'+element.variant+(editing?' mobile-navigation-editing':'')+(menuOpen?' is-open':'')} style={appearanceToStyle(element.appearance)} aria-label={element.title}>
  {isMenu?<div className="mobile-menu-anchor">
    <button type="button" className="mobile-menu-trigger" aria-label={menuOpen?'Close '+element.title:'Open '+element.title}
      aria-expanded={menuOpen} aria-controls={'menu-links-'+element.id} data-editor-control="true"
      onClick={e=>{e.stopPropagation();setMenuOpen(v=>!v);}}>
      {menuOpen?<X size={19}/>:<MenuIcon size={19}/>}<span>{element.title}</span>
    </button>
    {menuOpen&&<div className="mobile-menu-drawer" role="region" aria-label={element.title}>
      <div className="mobile-menu-drawer-heading"><strong>{element.title}</strong><button type="button" data-editor-control="true" aria-label="Close menu" onClick={e=>{e.stopPropagation();setMenuOpen(false);}}><X size={17}/></button></div>
      {links}
      {editing&&<small className="mobile-navigation-hint">Select a menu item to edit its label or destination</small>}
    </div>}
   </div>:links}
 </nav>;
}
