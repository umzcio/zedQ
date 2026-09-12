import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as jsx from 'react/jsx-runtime'
import * as jsxDev from 'react/jsx-dev-runtime'
import * as ReactDOMClient from 'react-dom/client'
import * as icons from '@phosphor-icons/react'
import * as radix from 'radix-ui'
import * as sdk from '@zq/module-api'
import * as ui from '@zq/ui'
import { createRoot } from 'react-dom/client'
import DesktopRoot from './DesktopRoot'
import { loadModules } from './module-loader'
import '@zq/ui/styles.css'
import './shell.css'
Object.defineProperty(window,'__zqRuntime',{value:Object.freeze({React,ReactDOM,ReactDOMClient,jsx,jsxDev,icons,radix,sdk,ui}),writable:false,configurable:false})
document.documentElement.dataset.platform=window.zq?.platform??''
const root=createRoot(document.getElementById('root')!)
root.render(<div className="startup-state" role="status">Opening your modules…</div>)
loadModules().then(modules=>root.render(<React.StrictMode><ui.TooltipProvider><DesktopRoot modules={modules}/></ui.TooltipProvider></React.StrictMode>)).catch(error=>root.render(<div className="startup-state" role="alert"><h1>zQ could not load its modules</h1><p>{error.message}</p><p>Your saved workspace has not been changed.</p><ui.TooltipButton tooltip="Reload zQ and try loading modules again" onClick={()=>location.reload()}>Try again</ui.TooltipButton></div>))
