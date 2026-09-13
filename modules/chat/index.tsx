import './styles.css'
import { useEffect } from 'react'
import { useHost, ModuleSurface } from '@zq/module-api'
import { useChat } from './useChat'
import ChatView from './ChatView'
import ArtifactLibrary from './ArtifactLibrary'
import {ArtifactWorkspace} from './ArtifactPane'
import ChatSidebar from './ChatSidebar'
import SkillsSettings from './SkillsSettings'
import ConnectorSettings from './ConnectorSettings'
import ConnectionsSettings from './ConnectionsSettings'
import './chat.css'
import './appearance.css'
import './models.css'
function ChatRoot(){
 const host=useHost(),chat=useChat()
 function settings(){if(host.openSettings){host.openSettings('connections');return}host.navigate('Settings');requestAnimationFrame(()=>document.getElementById('model-connections')?.scrollIntoView())}
 return <><ModuleSurface slot="sidebar"><ChatSidebar chat={chat} closing={host.closing}/></ModuleSurface><ModuleSurface><ArtifactWorkspace chat={chat}>{chat.artifactsView?<ArtifactLibrary chat={chat}/>:<ChatView chat={chat} notes={host.workspace.notes} closing={host.closing} prepareNotes={host.flushWorkspace} settings={settings}/>}</ArtifactWorkspace></ModuleSurface><ModuleSurface slot="settings"><ConnectionsSettings chat={chat} closing={host.closing}/></ModuleSurface><ModuleSurface slot="connectorsSettings"><ConnectorSettings chat={chat} closing={host.closing}/></ModuleSurface><ModuleSurface slot="skillsSettings"><SkillsSettings chat={chat} closing={host.closing}/></ModuleSurface></>
}
export default {Root:ChatRoot}
