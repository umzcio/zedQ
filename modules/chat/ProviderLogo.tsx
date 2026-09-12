import type { ProviderKind } from '@zq/module-api'
import ollama from './provider-assets/ollama.svg?inline'
import vllm from './provider-assets/vllm.svg?inline'
import openai from './provider-assets/openai.svg?inline'
import anthropic from './provider-assets/anthropic.svg?inline'
import google from './provider-assets/google.svg?inline'
import xai from './provider-assets/xai.svg?inline'
import perplexity from './provider-assets/perplexity.svg?inline'
import openrouter from './provider-assets/openrouter.svg?inline'
import groq from './provider-assets/groq.svg?inline'
import bedrock from './provider-assets/bedrock.svg?inline'

const providerMarks: Record<ProviderKind, { src: string; monochrome: boolean }> = {
 ollama: { src: ollama, monochrome: true },
 vllm: { src: vllm, monochrome: false },
 openai: { src: openai, monochrome: true },
 anthropic: { src: anthropic, monochrome: true },
 google: { src: google, monochrome: false },
 xai: { src: xai, monochrome: true },
 perplexity: { src: perplexity, monochrome: true },
 openrouter: { src: openrouter, monochrome: true },
 groq: { src: groq, monochrome: true },
 bedrock: { src: bedrock, monochrome: true },
}

/** Decorative provider mark; the surrounding control supplies its accessible name. */
export function ProviderLogo({ provider, size = 18, className = '' }: {
 provider: ProviderKind
 size?: number
 className?: string
}) {
 const mark = providerMarks[provider]
 const dimensions = { width: size, height: size, flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' } as const
 if (!mark.monochrome) {
  return <img className={`provider-logo ${className}`} src={mark.src} alt="" aria-hidden="true" draggable={false} style={{ ...dimensions, objectFit: 'contain' }}/>
 }
 const mask = `url("${mark.src}") center / contain no-repeat`
 return <span className={`provider-logo ${className}`} aria-hidden="true" style={{ ...dimensions, backgroundColor: 'currentColor', mask, WebkitMask: mask }}/>
}
