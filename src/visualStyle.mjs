// Shared, bounded visual-style contract for generated and refined demo UI.
// Only declared visual properties are allowed; no arbitrary CSS or executable values.
export const appearanceProperties=['backgroundColor','textColor','textAlign','padding','borderRadius','alignment'];
export const appearanceTargets=new Set(['element','button','item']);
export function validAppearance(value){
 if(value===undefined)return true;
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const keys=Object.keys(value);
 if(!keys.length||keys.some(k=>!appearanceProperties.includes(k)))return false;
 return keys.every(k=>validAppearanceValue(k,value[k]));
}
export function validAppearanceValue(property,value){
 if(['backgroundColor','textColor'].includes(property))return typeof value==='string'&&/^#[0-9a-fA-F]{6}$/.test(value);
 if(['textAlign','alignment'].includes(property))return ['left','center','right'].includes(value);
 if(property==='padding')return Number.isInteger(value)&&value>=0&&value<=48;
 if(property==='borderRadius')return Number.isInteger(value)&&value>=0&&value<=32;
 return false;
}
export function appearanceToStyle(value){
 if(!validAppearance(value)||!value)return undefined;
 const css={};
 // Explicit backgrounds must replace class-level gradients/images, not sit underneath them.
 // Setting only CSS backgroundColor leaves a preexisting background-image visible.
 if(value.backgroundColor!==undefined)css.background=value.backgroundColor;
 if(value.textColor!==undefined)css.color=value.textColor;
 if(value.textAlign!==undefined)css.textAlign=value.textAlign;
 if(value.padding!==undefined)css.padding=value.padding+'px';
 if(value.borderRadius!==undefined)css.borderRadius=value.borderRadius+'px';
 if(value.alignment==='center'){css.marginLeft='auto';css.marginRight='auto';}
 else if(value.alignment==='right'){css.marginLeft='auto';css.marginRight='0';}
 else if(value.alignment==='left'){css.marginLeft='0';css.marginRight='auto';}
 return css;
}
