import {SidebarSection} from '@zq/ui';
import type { CodeSession, CodeSnapshot } from '@zq/module-api';
import { ChatCircle, TerminalWindow } from '@phosphor-icons/react';
import { ItemMenu, MoreMenu, type Action } from './CodeManagement';
import { hostLabel } from './CodeSSH';
import { stateLabel } from './session-model';

export function CodeSessionNavigation({ snapshot, selected, archived, busy, opening, onOpen, actions }: {
  snapshot: CodeSnapshot | null;
  selected: string;
  archived: boolean;
  busy: boolean;
  opening: string;
  onOpen: (session: CodeSession) => void;
  actions: (session: CodeSession) => Action[];
}) {
  const sessions = (snapshot?.sessions || [])
    .filter(session => !!session.archivedAt === archived)
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  if (!sessions.length) return null;
  return <SidebarSection className="code-session-navigation" storageKey="code.sessions" title={archived ? 'Archived sessions' : 'Sessions'} meta={sessions.length}>
    <div className="code-session-navigation-list">
      {sessions.map(session => {
        const location = hostLabel(snapshot?.hosts.find(host => host.id === session.hostId));
        const status = stateLabel(session);
        const Icon = session.mode === 'chat' ? ChatCircle : TerminalWindow;
        return <ItemMenu key={session.id} actions={actions(session)}>
          <div className={`code-session-row code-session-shortcut ${selected === session.id ? 'selected' : ''}`}>
            <button disabled={busy} aria-label={`${session.title} · ${location}`} aria-current={selected === session.id ? 'page' : undefined} title={`${session.title}\n${location} · ${status}\n${session.cwd}`} onClick={() => onOpen(session)}>
              <Icon size={16}/>
              <span className="code-session-shortcut-text"><span>{session.title}</span><small>{opening === session.id ? 'Connecting…' : location}</small></span>
              <span className={`code-state-dot code-state-${session.state}`} role="img" aria-label={status}/>
            </button>
            <MoreMenu label={`Actions for ${session.title}`} actions={actions(session)}/>
          </div>
        </ItemMenu>;
      })}
    </div>
  </SidebarSection>;
}
