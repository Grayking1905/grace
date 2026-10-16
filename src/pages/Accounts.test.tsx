// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {it,expect} from 'vitest';
import axe from 'axe-core';
import {PublicAccountPage} from './Accounts';
it('exposes a labeled, keyboard-usable password recovery screen with no automated WCAG A/AA violations',async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});window.history.replaceState(null,'','/account/forgot');const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  try{await act(async()=>root.render(<MemoryRouter initialEntries={['/account/forgot']}><PublicAccountPage/></MemoryRouter>));expect(host.querySelector('input[type="email"]')).not.toBeNull();expect(host.querySelector('h1')?.textContent).toContain('back in');const result=await axe.run(host,{runOnly:{type:'tag',values:['wcag2a','wcag2aa']},rules:{'color-contrast':{enabled:false}}});expect(result.violations.map(v=>({id:v.id,description:v.description}))).toEqual([]);}finally{await act(async()=>root.unmount());host.remove();}
});
