import {TooltipButton} from '@zq/ui'
import { useLayoutEffect, useRef, type Ref } from 'react'
import type { SettingsSection, WorkspaceState } from '@zq/module-api'
import { Check } from '@phosphor-icons/react'
import ModuleSettings from './ModuleSettings'
import VoiceSettings from './VoiceSettings'
import UpdateSettings from './UpdateSettings'
import './settings.css'

const palettes=['green','blue','red','gunmetal'] as const
export default function Settings({section,theme,palette,setTheme,setPalette,closing,settingsRef,skillsSettingsRef,connectorsSettingsRef}:{section:SettingsSection;theme:WorkspaceState['theme'];palette:WorkspaceState['palette'];setTheme:(theme:WorkspaceState['theme'])=>void;setPalette:(palette:WorkspaceState['palette'])=>void;closing:boolean;settingsRef:Ref<HTMLDivElement>;skillsSettingsRef?:Ref<HTMLDivElement>;connectorsSettingsRef?:Ref<HTMLDivElement>}){
 const page=useRef<HTMLDivElement>(null)
 useLayoutEffect(()=>{page.current?.closest('main')?.scrollTo({top:0})},[section])
 return <div className={`settings-page${section==='appearance'?' settings-page-appearance':''}`} ref={page}>
  <div className="settings-panel settings-view" hidden={section!=='appearance'} inert={section!=='appearance'||closing}>
   <header className="page-heading"><div><div className="date-line">MAKE YOURSELF AT HOME</div><h1>Your space, your way<span className="accent">.</span></h1><p>A few small choices that make it feel like yours.</p></div></header>
   <section id="appearance" aria-labelledby="appearance-title">
    <h2 id="appearance-title">Appearance</h2>
    <p>Choose light, dark, or follow your Mac’s preference.</p>
    <div className="theme-options">
     {(['light','dark','system'] as const).map(t=><TooltipButton key={t} tooltip={t==='system'?"Follow your Mac’s light or dark appearance":`Use ${t} appearance`} aria-pressed={theme===t} className={`theme-option ${theme===t?'selected':''}`} onClick={()=>setTheme(t)}>
      <div className={`theme-preview preview-${t}`}><div/><section><span/><i/><i/></section></div>
      <span>{t[0].toUpperCase()+t.slice(1)}{theme===t&&<Check size={16}/>}</span>
     </TooltipButton>)}
    </div>
   </section>
   <section className="palette-section">
    <h2>Color theme</h2>
    <p>A little personality. Works with light, dark, and system appearance.</p>
    <div className="palette-options" role="group" aria-label="Color theme">
     {palettes.map(color=><TooltipButton key={color} tooltip={`Use the ${color} color theme`} className={`palette-option ${palette===color?'selected':''}`} aria-label={`${color[0].toUpperCase()+color.slice(1)} color theme`} aria-pressed={palette===color} onClick={()=>setPalette(color)}>
      <span className={`palette-swatch swatch-${color}`}><i/><i/><i/></span>
      <span className="palette-name">{color[0].toUpperCase()+color.slice(1)}{palette===color&&<Check size={15}/>}</span>
     </TooltipButton>)}
    </div>
   </section>
  </div>
  <div className="settings-panel" hidden={section!=='connections'} inert={section!=='connections'||closing}><div ref={settingsRef}/></div>
  <div className="settings-panel" hidden={section!=='connectors'} inert={section!=='connectors'||closing}><div ref={connectorsSettingsRef}/></div>
  <div className="settings-panel" hidden={section!=='skills'} inert={section!=='skills'||closing}><div ref={skillsSettingsRef}/></div>
  <div className="settings-panel" hidden={section!=='modules'} inert={section!=='modules'||closing}><ModuleSettings closing={closing}/></div>
  <div className="settings-panel" hidden={section!=='voice'} inert={section!=='voice'||closing}><VoiceSettings active={section==='voice'} closing={closing}/></div>
  <div className="settings-panel" hidden={section!=='updates'} inert={section!=='updates'||closing}><UpdateSettings active={section==='updates'} closing={closing}/></div>
 </div>
}
