import type { CSSProperties } from 'react'
import { FolderSimple, Anchor, Aperture, AppleLogo, Archive, BeerStein, Bell, Bird, BookOpen, BookmarkSimple, Cube, Briefcase, Bug, Buildings, Calculator, CalendarBlank, Camera, Car, Cat, ChefHat, ClipboardText, Clock, Code, Coffee, Compass, DiamondsFour, Cpu, Database, Diamond, Dog, CurrencyDollar, Drop, FilmStrip, Fish, Flag, Flame, Flask, GameController, SketchLogo, Eyeglasses, Globe, GraduationCap, Headphones, Heart, House, Hourglass, Key, Laptop, Leaf, Lightbulb, Envelope, Microscope, Monitor, Moon, Mountains, MusicNotes, Palette, Phone, PushPin, Airplane, Play, Rocket, Sailboat, Scales, Shield, TShirt, Smiley, Sparkle, Star, Stethoscope, Sun, Sword, Tag, Train, Tree, Truck, Umbrella, LockSimple, User, ForkKnife, VideoCamera, Wrench, Lightning } from '@phosphor-icons/react'
import appearance from './project-appearance.json'
import type { ChatProject } from '@zq/module-api'
export const projectIcons={FolderSimple, Anchor, Aperture, AppleLogo, Archive, BeerStein, Bell, Bird, BookOpen, BookmarkSimple, Cube, Briefcase, Bug, Buildings, Calculator, CalendarBlank, Camera, Car, Cat, ChefHat, ClipboardText, Clock, Code, Coffee, Compass, DiamondsFour, Cpu, Database, Diamond, Dog, CurrencyDollar, Drop, FilmStrip, Fish, Flag, Flame, Flask, GameController, SketchLogo, Eyeglasses, Globe, GraduationCap, Headphones, Heart, House, Hourglass, Key, Laptop, Leaf, Lightbulb, Envelope, Microscope, Monitor, Moon, Mountains, MusicNotes, Palette, Phone, PushPin, Airplane, Play, Rocket, Sailboat, Scales, Shield, TShirt, Smiley, Sparkle, Star, Stethoscope, Sun, Sword, Tag, Train, Tree, Truck, Umbrella, LockSimple, User, ForkKnife, VideoCamera, Wrench, Lightning}
export const projectColors=appearance.colors
export function ProjectIcon({project,size=18}:{project:Pick<ChatProject,'icon'|'color'>;size?:number}){
 const Icon=projectIcons[project.icon as keyof typeof projectIcons]??FolderSimple
 const color=projectColors.find(c=>c.id===project.color)??projectColors[0]
 return <Icon size={size} weight="light" className="project-icon" style={{'--project-icon-light':color.light,'--project-icon-dark':color.dark} as CSSProperties}/>
}
