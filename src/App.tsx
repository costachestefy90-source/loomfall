import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import {
  countActiveConstraints,
  createCloth,
  cutAlongPath,
  findNearestObject,
  findNearestPoint,
  objectRadius,
  stepSimulation,
  togglePin,
  type Cloth,
  type Contact,
  type ObjectKind,
  type Point,
  type SimObject,
  type SimulationParams,
} from './physics'
import './styles.css'

type Tool = 'grab' | 'cut' | 'pin' | 'object'
type PresetId = 'silk' | 'moon' | 'crosswind' | 'cut' | 'impact'

type ObjectSeed = {
  kind: ObjectKind
  x: number
  y: number
  size?: number
  mass?: number
  bounce?: number
  vx?: number
  vy?: number
  spin?: number
}

type Preset = {
  id: PresetId
  code: string
  name: string
  description: string
  color: 'amber' | 'cyan' | 'pink' | 'coral' | 'violet'
  params: SimulationParams
  objects: ObjectSeed[]
}

type Engine = {
  width: number
  height: number
  cloth: Cloth
  objects: SimObject[]
  time: number
  lastTime: number
  contacts: Contact[]
  dragTarget: { type: 'point' | 'object' | 'cut'; index: number } | null
  pointer: { active: boolean; x: number; y: number; path: Point[] }
  hoverPoint: number
}

type Telemetry = {
  fps: number
  nodes: number
  springs: number
  energy: number
  contacts: number
  tears: number
}

const DEFAULT_PARAMS: SimulationParams = {
  gravity: 0.92,
  stiffness: 0.86,
  damping: 0.992,
  wind: 0.24,
  speed: 1,
  objectMass: 1,
  objectBounce: 0.72,
  iterations: 6,
  tearThreshold: 1.72,
}

const PRESETS: Preset[] = [
  {
    id: 'silk',
    code: 'A01',
    name: 'Silk drop',
    description: 'Soft drape / low gravity',
    color: 'amber',
    params: { gravity: 0.72, stiffness: 0.78, damping: 0.995, wind: 0.14, speed: 0.86, objectMass: 0.72, objectBounce: 0.78, iterations: 6, tearThreshold: 1.9 },
    objects: [
      { kind: 'ball', x: 0.45, y: 0.17, size: 24, mass: 0.85, bounce: 0.74, vy: 68 },
      { kind: 'ring', x: 0.78, y: 0.23, size: 25, mass: 0.45, bounce: 0.82, vy: 42, spin: 1.8 },
    ],
  },
  {
    id: 'moon',
    code: 'A02',
    name: 'Moon relay',
    description: 'Low gravity / long hang',
    color: 'cyan',
    params: { gravity: 0.2, stiffness: 0.93, damping: 0.997, wind: -0.2, speed: 0.9, objectMass: 1.15, objectBounce: 0.88, iterations: 7, tearThreshold: 2.2 },
    objects: [
      { kind: 'cube', x: 0.34, y: 0.18, size: 28, mass: 1.6, bounce: 0.88, vy: 34, spin: -1.2 },
      { kind: 'star', x: 0.7, y: 0.13, size: 26, mass: 0.55, bounce: 0.9, vy: 48, spin: 2.3 },
    ],
  },
  {
    id: 'crosswind',
    code: 'A03',
    name: 'Crosswind',
    description: 'Strong lateral gusts',
    color: 'pink',
    params: { gravity: 0.95, stiffness: 0.72, damping: 0.989, wind: 1, speed: 1.05, objectMass: 1.1, objectBounce: 0.68, iterations: 6, tearThreshold: 1.56 },
    objects: [
      { kind: 'ball', x: 0.3, y: 0.1, size: 25, mass: 1.1, bounce: 0.72, vx: 60, vy: 95 },
      { kind: 'cube', x: 0.68, y: 0.05, size: 24, mass: 1.3, bounce: 0.65, vx: -25, vy: 70, spin: 1.5 },
    ],
  },
  {
    id: 'cut',
    code: 'A04',
    name: 'Tear study',
    description: 'Stress test / cut ready',
    color: 'coral',
    params: { gravity: 1.06, stiffness: 0.91, damping: 0.99, wind: 0.08, speed: 1, objectMass: 2.4, objectBounce: 0.46, iterations: 7, tearThreshold: 1.42 },
    objects: [
      { kind: 'cube', x: 0.52, y: 0.1, size: 34, mass: 2.5, bounce: 0.47, vy: 92, spin: 0.8 },
    ],
  },
  {
    id: 'impact',
    code: 'A05',
    name: 'Heavy impact',
    description: 'Dense objects / stiff mesh',
    color: 'violet',
    params: { gravity: 1.35, stiffness: 0.98, damping: 0.985, wind: 0, speed: 1.08, objectMass: 3.6, objectBounce: 0.32, iterations: 8, tearThreshold: 1.5 },
    objects: [
      { kind: 'ball', x: 0.48, y: 0.04, size: 39, mass: 4.2, bounce: 0.35, vy: 72 },
      { kind: 'ring', x: 0.74, y: 0.1, size: 28, mass: 1.7, bounce: 0.45, vy: 60, spin: -1.4 },
    ],
  },
]

const OBJECT_COLORS: Record<ObjectKind, string> = {
  ball: '#f6c85f',
  cube: '#6de1d0',
  ring: '#d974a7',
  star: '#ef8e5c',
}

const OBJECT_LABELS: Record<ObjectKind, string> = {
  ball: 'Ball',
  cube: 'Cube',
  ring: 'Ring',
  star: 'Star',
}

const TOOL_LABELS: Record<Tool, string> = {
  grab: 'Grab',
  cut: 'Cut',
  pin: 'Pin',
  object: 'Drop',
}

const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`)

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function makeObject(seed: ObjectSeed, id: number, clothWidth: number, floorY: number): SimObject {
  const size = seed.size ?? (seed.kind === 'ball' ? 25 : 27)
  return {
    id,
    kind: seed.kind,
    x: 24 + clamp(seed.x, 0.08, 0.92) * clothWidth,
    y: clamp(seed.y * floorY, 38, floorY - size - 12),
    vx: seed.vx ?? 0,
    vy: seed.vy ?? 0,
    angle: 0,
    spin: seed.spin ?? 0,
    size,
    mass: seed.mass ?? 1,
    bounce: seed.bounce ?? 0.7,
    color: OBJECT_COLORS[seed.kind],
    hitPulse: 0,
  }
}

function createEngine(width: number, height: number, preset: Preset, params = preset.params): Engine {
  const clothWidth = Math.max(270, Math.min(780, width - 48))
  const clothHeight = Math.max(175, Math.min(390, height - 140))
  const floorY = Math.max(clothHeight + 105, height - 54)
  const cols = clamp(Math.round(clothWidth / 24), 18, 34)
  const rows = clamp(Math.round(clothHeight / 20), 12, 22)
  const cloth = createCloth(cols, rows, clothWidth, clothHeight, 24, 68, floorY)
  const objects = preset.objects.map((seed, index) => makeObject(seed, index + 1, clothWidth, floorY))
  return {
    width,
    height,
    cloth,
    objects,
    time: 0,
    lastTime: 0,
    contacts: [],
    dragTarget: null,
    pointer: { active: false, x: 0, y: 0, path: [] },
    hoverPoint: -1,
  }
}

function drawStar(ctx: CanvasRenderingContext2D, radius: number) {
  ctx.beginPath()
  for (let index = 0; index < 10; index += 1) {
    const angle = -Math.PI / 2 + index * (Math.PI / 5)
    const distance = index % 2 === 0 ? radius : radius * 0.45
    const x = Math.cos(angle) * distance
    const y = Math.sin(angle) * distance
    if (index === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

function drawScene(ctx: CanvasRenderingContext2D, engine: Engine, tool: Tool, stressView: boolean) {
  const { width, height, cloth } = engine
  ctx.clearRect(0, 0, width, height)

  const background = ctx.createLinearGradient(0, 0, width, height)
  background.addColorStop(0, '#071321')
  background.addColorStop(0.5, '#0d1b2b')
  background.addColorStop(1, '#12253a')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)

  const halo = ctx.createRadialGradient(width * 0.58, height * 0.36, 20, width * 0.58, height * 0.36, width * 0.7)
  halo.addColorStop(0, 'rgba(109, 225, 208, 0.08)')
  halo.addColorStop(1, 'rgba(109, 225, 208, 0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, width, height)

  ctx.save()
  ctx.lineWidth = 1
  for (let x = 0; x <= width; x += 32) {
    ctx.strokeStyle = x % 160 === 0 ? 'rgba(154, 185, 204, 0.1)' : 'rgba(154, 185, 204, 0.045)'
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }
  for (let y = 0; y <= height; y += 32) {
    ctx.strokeStyle = y % 160 === 0 ? 'rgba(154, 185, 204, 0.1)' : 'rgba(154, 185, 204, 0.045)'
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }
  ctx.restore()

  ctx.save()
  ctx.setLineDash([4, 8])
  ctx.strokeStyle = 'rgba(109, 225, 208, 0.18)'
  ctx.beginPath()
  ctx.moveTo(24, cloth.floorY)
  ctx.lineTo(width - 24, cloth.floorY)
  ctx.stroke()
  ctx.restore()

  const activeEdges = new Set(cloth.constraints.filter((constraint) => constraint.active && constraint.kind === 'structural').map((constraint) => edgeKey(constraint.a, constraint.b)))
  const clothGradient = ctx.createLinearGradient(24, 60, width - 24, cloth.floorY)
  clothGradient.addColorStop(0, '#f6c85f')
  clothGradient.addColorStop(0.44, '#ef8e5c')
  clothGradient.addColorStop(1, '#c95d91')

  const drawCells = () => {
    for (let row = 0; row < cloth.rows - 1; row += 1) {
      for (let col = 0; col < cloth.cols - 1; col += 1) {
        const aIndex = row * cloth.cols + col
        const bIndex = aIndex + 1
        const cIndex = aIndex + cloth.cols
        const dIndex = cIndex + 1
        const connected = activeEdges.has(edgeKey(aIndex, bIndex)) && activeEdges.has(edgeKey(aIndex, cIndex)) && activeEdges.has(edgeKey(cIndex, dIndex)) && activeEdges.has(edgeKey(bIndex, dIndex))
        if (!connected) continue
        const a = cloth.points[aIndex]
        const b = cloth.points[bIndex]
        const c = cloth.points[cIndex]
        const d = cloth.points[dIndex]
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.lineTo(d.x, d.y)
        ctx.lineTo(c.x, c.y)
        ctx.closePath()
        ctx.fill()
      }
    }
  }

  ctx.save()
  ctx.globalAlpha = 0.18
  ctx.filter = 'blur(16px)'
  ctx.fillStyle = '#c95d91'
  drawCells()
  ctx.restore()

  ctx.save()
  ctx.globalAlpha = 0.84
  ctx.fillStyle = clothGradient
  drawCells()
  ctx.restore()

  ctx.save()
  for (const constraint of cloth.constraints) {
    if (!constraint.active || constraint.kind === 'bend') continue
    const a = cloth.points[constraint.a]
    const b = cloth.points[constraint.b]
    const ratio = Math.hypot(b.x - a.x, b.y - a.y) / constraint.rest
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    if (stressView && ratio > 1.04) {
      ctx.strokeStyle = ratio > 1.18 ? 'rgba(255, 114, 132, 0.86)' : 'rgba(246, 200, 95, 0.76)'
      ctx.lineWidth = ratio > 1.18 ? 2.6 : 1.8
    } else {
      ctx.strokeStyle = constraint.kind === 'shear' ? 'rgba(255, 238, 189, 0.22)' : 'rgba(255, 230, 172, 0.54)'
      ctx.lineWidth = constraint.kind === 'shear' ? 0.7 : 1.05
    }
    ctx.stroke()
  }
  ctx.restore()

  const brokenPoints = new Set<number>()
  cloth.constraints.forEach((constraint) => {
    if (!constraint.active && constraint.kind !== 'bend') {
      brokenPoints.add(constraint.a)
      brokenPoints.add(constraint.b)
    }
  })
  ctx.save()
  for (const [index, point] of cloth.points.entries()) {
    if (point.pinned) {
      ctx.fillStyle = '#ffd77a'
      ctx.shadowColor = 'rgba(255, 215, 122, 0.68)'
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.arc(point.x, point.y, 4.8, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0
    } else if (stressView || index === engine.hoverPoint) {
      ctx.fillStyle = index === engine.hoverPoint ? '#ffffff' : 'rgba(246, 200, 95, 0.78)'
      ctx.beginPath()
      ctx.arc(point.x, point.y, index === engine.hoverPoint ? 3.1 : 1.7, 0, Math.PI * 2)
      ctx.fill()
    }
    if (brokenPoints.has(index)) {
      ctx.strokeStyle = 'rgba(255, 113, 132, 0.8)'
      ctx.lineWidth = 1.3
      ctx.beginPath()
      ctx.arc(point.x, point.y, 5.5, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  ctx.restore()

  for (const object of engine.objects) {
    const radius = objectRadius(object)
    ctx.save()
    ctx.translate(object.x, object.y)
    ctx.rotate(object.angle)
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
    ctx.shadowBlur = 17
    ctx.shadowOffsetY = 8

    if (object.kind === 'ball') {
      const ball = ctx.createRadialGradient(-radius * 0.35, -radius * 0.45, 2, 0, 0, radius)
      ball.addColorStop(0, '#fff1b8')
      ball.addColorStop(0.25, object.color)
      ball.addColorStop(1, '#c06b48')
      ctx.fillStyle = ball
      ctx.beginPath()
      ctx.arc(0, 0, radius, 0, Math.PI * 2)
      ctx.fill()
    } else if (object.kind === 'cube') {
      const cube = ctx.createLinearGradient(-radius, -radius, radius, radius)
      cube.addColorStop(0, '#b7fff0')
      cube.addColorStop(0.35, object.color)
      cube.addColorStop(1, '#2d8c91')
      ctx.fillStyle = cube
      ctx.beginPath()
      ctx.roundRect(-radius * 0.82, -radius * 0.82, radius * 1.64, radius * 1.64, 7)
      ctx.fill()
      ctx.strokeStyle = 'rgba(5, 31, 42, 0.72)'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(-radius * 0.48, -radius * 0.82)
      ctx.lineTo(-radius * 0.48, radius * 0.82)
      ctx.moveTo(-radius * 0.82, -radius * 0.48)
      ctx.lineTo(radius * 0.82, -radius * 0.48)
      ctx.strokeStyle = 'rgba(230, 255, 248, 0.34)'
      ctx.stroke()
    } else if (object.kind === 'ring') {
      ctx.strokeStyle = object.color
      ctx.lineWidth = 8
      ctx.beginPath()
      ctx.arc(0, 0, radius * 0.72, 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(255, 239, 242, 0.7)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(-radius * 0.05, -radius * 0.05, radius * 0.72, Math.PI * 1.08, Math.PI * 1.72)
      ctx.stroke()
    } else {
      ctx.fillStyle = object.color
      drawStar(ctx, radius)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255, 242, 220, 0.66)'
      ctx.lineWidth = 2
      ctx.stroke()
    }
    ctx.restore()

    if (object.hitPulse > 0) {
      ctx.save()
      ctx.strokeStyle = `rgba(109, 225, 208, ${object.hitPulse * 0.55})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(object.x, object.y, radius + (1 - object.hitPulse) * 24, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  if (engine.contacts.length > 0) {
    ctx.save()
    for (const contact of engine.contacts) {
      ctx.strokeStyle = `rgba(109, 225, 208, ${Math.min(contact.strength * 0.38, 0.38)})`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(contact.x, contact.y, 13 + contact.strength * 14, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  if (engine.pointer.active && tool === 'cut' && engine.pointer.path.length > 1) {
    ctx.save()
    ctx.strokeStyle = '#ff7184'
    ctx.shadowColor = 'rgba(255, 113, 132, 0.64)'
    ctx.shadowBlur = 10
    ctx.lineWidth = 2.4
    ctx.setLineDash([7, 6])
    ctx.beginPath()
    engine.pointer.path.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.stroke()
    ctx.restore()
  }

  if (!engine.pointer.active && engine.hoverPoint >= 0 && tool !== 'object') {
    const point = cloth.points[engine.hoverPoint]
    ctx.save()
    ctx.strokeStyle = tool === 'cut' ? 'rgba(255, 113, 132, 0.75)' : 'rgba(255, 255, 255, 0.7)'
    ctx.setLineDash([3, 4])
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(point.x, point.y, tool === 'cut' ? 15 : 11, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  ctx.save()
  ctx.fillStyle = 'rgba(231, 241, 246, 0.42)'
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.letterSpacing = '1px'
  ctx.fillText('FIELD 01  /  CLOTH', 24, 28)
  ctx.fillText(`FLOOR  ${Math.round(cloth.floorY)}px`, width - 112, 28)
  ctx.restore()
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  switch (name) {
    case 'play': return <svg {...common}><path d="M8 5l11 7-11 7V5z" fill="currentColor" stroke="none" /></svg>
    case 'pause': return <svg {...common}><path d="M8 5v14M16 5v14" /></svg>
    case 'reset': return <svg {...common}><path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.7M4 4v4.7h4.7" /></svg>
    case 'grab': return <svg {...common}><path d="M7 12V6.5a1.5 1.5 0 0 1 3 0v4M10 10V4.8a1.5 1.5 0 0 1 3 0V10M13 10V6.3a1.5 1.5 0 0 1 3 0v5M16 11V9.6a1.5 1.5 0 0 1 3 0v4.2c0 3.4-2.7 6.2-6.1 6.2h-.5c-1.9 0-3.7-.9-4.8-2.4L5 14.7a1.5 1.5 0 0 1 2.4-1.8L9 15" /></svg>
    case 'cut': return <svg {...common}><path d="M6 4l12 16M18 4L6 20M6 4l3.2 3.2M18 20l-3.2-3.2" /></svg>
    case 'pin': return <svg {...common}><path d="M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v7" /></svg>
    case 'ball': return <svg {...common}><circle cx="12" cy="12" r="7" /></svg>
    case 'cube': return <svg {...common}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4.5 7.7L12 12l7.5-4.3M12 12v9" /></svg>
    case 'ring': return <svg {...common}><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="3" /></svg>
    case 'star': return <svg {...common}><path d="M12 3l2.6 5.4 6 .9-4.3 4.2 1 6-5.3-2.8-5.3 2.8 1-6-4.3-4.2 6-.9L12 3z" /></svg>
    case 'wind': return <svg {...common}><path d="M3 8h11a2.5 2.5 0 1 0-2.2-3.7M3 12h15a2.5 2.5 0 1 1-2.2 3.7M3 16h8" /></svg>
    case 'gravity': return <svg {...common}><path d="M12 4v14M7 13l5 5 5-5M5 4h14" /></svg>
    case 'nodes': return <svg {...common}><circle cx="5" cy="6" r="2" /><circle cx="19" cy="7" r="2" /><circle cx="8" cy="18" r="2" /><circle cx="18" cy="17" r="2" /><path d="M7 7.2l9.8 5.5M17.3 8.8l-7.8 7.4M9.5 18h6.5" /></svg>
    case 'help': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.3 2.3 0 1 1 3.8 1.7c-1 .8-1.6 1.2-1.6 2.7M12 17h.01" /></svg>
    case 'spark': return <svg {...common}><path d="M12 2l1.3 6.7L20 11l-6.7 1.3L12 19l-1.3-6.7L4 11l6.7-2.3L12 2zM19 16l.5 2.5L22 19l-2.5.5L19 22l-.5-2.5L16 19l2.5-.5L19 16z" /></svg>
    case 'trash': return <svg {...common}><path d="M5 7h14M10 11v6M14 11v6M7 7l.7 13h8.6L17 7M9 7l1-3h4l1 3" /></svg>
    case 'close': return <svg {...common}><path d="M6 6l12 12M18 6L6 18" /></svg>
    case 'chevron': return <svg {...common}><path d="M9 5l7 7-7 7" /></svg>
    case 'target': return <svg {...common}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
    default: return <svg {...common}><circle cx="12" cy="12" r="8" /></svg>
  }
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  tone = 'cyan',
  icon,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (value: number) => void
  tone?: 'cyan' | 'amber' | 'pink'
  icon: string
}) {
  const progress = `${((value - min) / (max - min)) * 100}%`
  return (
    <label className="range-row">
      <span className="range-label">
        <span className={`range-icon tone-${tone}`}><Icon name={icon} size={15} /></span>
        <span>{label}</span>
        <output>{display}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={{ '--range-progress': progress } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function ToolButton({ tool, active, onClick }: { tool: Tool; active: boolean; onClick: () => void }) {
  return (
    <button className={`tool-button ${active ? 'is-active' : ''}`} onClick={onClick} aria-pressed={active} title={`${TOOL_LABELS[tool]} tool`}>
      <span className="tool-glyph"><Icon name={tool === 'object' ? 'ball' : tool} size={17} /></span>
      <span>{TOOL_LABELS[tool]}</span>
      <kbd>{tool === 'grab' ? 'G' : tool === 'cut' ? 'C' : tool === 'pin' ? 'P' : 'O'}</kbd>
    </button>
  )
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const paramsRef = useRef<SimulationParams>(DEFAULT_PARAMS)
  const runningRef = useRef(true)
  const nextObjectId = useRef(20)
  const presetRef = useRef<PresetId>('silk')
  const [activePreset, setActivePreset] = useState<PresetId | 'custom'>('silk')
  const [params, setParams] = useState<SimulationParams>(DEFAULT_PARAMS)
  const [tool, setTool] = useState<Tool>('grab')
  const [objectKind, setObjectKind] = useState<ObjectKind>('ball')
  const [isRunning, setIsRunning] = useState(true)
  const [stressView, setStressView] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [toast, setToast] = useState('Silk drop loaded')
  const [telemetry, setTelemetry] = useState<Telemetry>({ fps: 60, nodes: 0, springs: 0, energy: 0, contacts: 0, tears: 0 })
  const toolRef = useRef<Tool>('grab')
  const stressViewRef = useRef(false)

  const currentPreset = useMemo(() => PRESETS.find((preset) => preset.id === presetRef.current) ?? PRESETS[0], [activePreset])

  const stageSize = useCallback(() => {
    const canvas = canvasRef.current
    return {
      width: Math.max(320, Math.round(canvas?.clientWidth ?? 900)),
      height: Math.max(360, Math.round(canvas?.clientHeight ?? 560)),
    }
  }, [])

  const loadPreset = useCallback((id: PresetId) => {
    const preset = PRESETS.find((candidate) => candidate.id === id) ?? PRESETS[0]
    const size = stageSize()
    paramsRef.current = preset.params
    presetRef.current = preset.id
    setParams(preset.params)
    setActivePreset(preset.id)
    engineRef.current = createEngine(size.width, size.height, preset)
    setToast(`${preset.name} loaded`)
  }, [stageSize])

  const resetScene = useCallback(() => {
    const preset = PRESETS.find((candidate) => candidate.id === presetRef.current) ?? PRESETS[0]
    const size = stageSize()
    engineRef.current = createEngine(size.width, size.height, preset, paramsRef.current)
    setToast('Scene reset / constraints intact')
  }, [stageSize])

  const updateParam = useCallback(<K extends keyof SimulationParams>(key: K, value: SimulationParams[K]) => {
    paramsRef.current = { ...paramsRef.current, [key]: value }
    setParams(paramsRef.current)
    if (key === 'objectMass' || key === 'objectBounce') {
      const engine = engineRef.current
      if (engine) engine.objects.forEach((object) => { object.mass = paramsRef.current.objectMass; object.bounce = paramsRef.current.objectBounce })
    }
    setActivePreset('custom')
    setToast('Custom lab parameters active')
  }, [])

  const addObjectAt = useCallback((kind: ObjectKind, x?: number, y?: number) => {
    const engine = engineRef.current
    if (!engine) return
    const safeX = x ?? engine.width * 0.5
    const safeY = y ?? 52
    const object = makeObject({ kind, x: (safeX - 24) / engine.cloth.width, y: safeY / engine.cloth.floorY, size: kind === 'ball' ? 25 : 28, mass: paramsRef.current.gravity > 1.1 ? 1.5 : 1, bounce: 0.72, vy: 20 }, nextObjectId.current, engine.cloth.width, engine.cloth.floorY)
    nextObjectId.current += 1
    object.x = clamp(safeX, 36, engine.width - 36)
    object.y = clamp(safeY, 36, engine.cloth.floorY - objectRadius(object) - 10)
    engine.objects.push(object)
    setToast(`${OBJECT_LABELS[kind]} dropped into the field`)
  }, [])

  const clearObjects = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.objects = []
    setToast('Object field cleared')
  }, [])

  const removeObject = useCallback((id: number) => {
    const engine = engineRef.current
    if (!engine) return
    engine.objects = engine.objects.filter((object) => object.id !== id)
    setToast('Object removed from field')
  }, [])

  useEffect(() => {
    paramsRef.current = params
  }, [params])

  useEffect(() => {
    runningRef.current = isRunning
  }, [isRunning])

  useEffect(() => {
    toolRef.current = tool
  }, [tool])

  useEffect(() => {
    stressViewRef.current = stressView
  }, [stressView])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const width = Math.max(320, Math.round(rect.width))
      const height = Math.max(360, Math.round(rect.height))
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = width * dpr
      canvas.height = height * dpr
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      const preset = PRESETS.find((candidate) => candidate.id === presetRef.current) ?? PRESETS[0]
      engineRef.current = createEngine(width, height, preset, paramsRef.current)
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    let frameId = 0
    let frameCount = 0
    let telemetryAt = performance.now()

    const animate = (now: number) => {
      const engine = engineRef.current
      if (engine) {
        if (!engine.lastTime) engine.lastTime = now
        const delta = Math.min((now - engine.lastTime) / 1000, 0.032)
        engine.lastTime = now
        if (runningRef.current) engine.contacts = stepSimulation(engine.cloth, engine.objects, paramsRef.current, delta, engine.time)
        engine.time += delta
        drawScene(context, engine, toolRef.current, stressViewRef.current)
        frameCount += 1
        if (now - telemetryAt > 260) {
          const energyTotal = engine.cloth.points.reduce((total, point) => total + Math.hypot(point.x - point.px, point.y - point.py), 0) + engine.objects.reduce((total, object) => total + Math.hypot(object.vx, object.vy) * 0.02, 0)
          const tears = engine.cloth.constraints.filter((constraint) => !constraint.active && constraint.kind !== 'bend').length
          setTelemetry({
            fps: Math.round((frameCount * 1000) / (now - telemetryAt)),
            nodes: engine.cloth.points.length,
            springs: countActiveConstraints(engine.cloth),
            energy: Math.min(99.9, energyTotal / 10),
            contacts: engine.contacts.length,
            tears,
          })
          frameCount = 0
          telemetryAt = now
        }
      }
      frameId = requestAnimationFrame(animate)
    }
    frameId = requestAnimationFrame(animate)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frameId)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const key = event.key.toLowerCase()
      if (event.code === 'Space') {
        event.preventDefault()
        setIsRunning((current) => !current)
      } else if (key === 'r') resetScene()
      else if (key === 'g') setTool('grab')
      else if (key === 'c') setTool('cut')
      else if (key === 'p') setTool('pin')
      else if (key === 'o') setTool('object')
      else if (/^[1-5]$/.test(key)) loadPreset(PRESETS[Number(key) - 1].id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [loadPreset, resetScene])

  const pointerPosition = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current
    const rect = event.currentTarget.getBoundingClientRect()
    if (!engine) return { x: 0, y: 0 }
    return {
      x: clamp((event.clientX - rect.left) * (engine.width / rect.width), 0, engine.width),
      y: clamp((event.clientY - rect.top) * (engine.height / rect.height), 0, engine.height),
    }
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current
    if (!engine) return
    const { x, y } = pointerPosition(event)
    engine.pointer = { active: true, x, y, path: [{ x, y, px: x, py: y, pinned: false, homeX: x, homeY: y }] }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'grab') {
      const objectIndex = findNearestObject(engine.objects, x, y)
      if (objectIndex >= 0) engine.dragTarget = { type: 'object', index: objectIndex }
      else {
        const pointIndex = findNearestPoint(engine.cloth, x, y)
        if (pointIndex >= 0) engine.dragTarget = { type: 'point', index: pointIndex }
      }
    } else if (tool === 'pin') {
      const pointIndex = findNearestPoint(engine.cloth, x, y)
      if (pointIndex >= 0) {
        togglePin(engine.cloth, pointIndex)
        setToast(engine.cloth.points[pointIndex].pinned ? 'Point pinned in place' : 'Point released')
      }
      engine.pointer.active = false
    } else if (tool === 'cut') {
      engine.dragTarget = { type: 'cut', index: -1 }
    } else if (tool === 'object') {
      addObjectAt(objectKind, x, y)
      engine.pointer.active = false
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current
    if (!engine) return
    const { x, y } = pointerPosition(event)
    engine.pointer.x = x
    engine.pointer.y = y
    const nearest = findNearestPoint(engine.cloth, x, y, tool === 'object' ? 0 : 34)
    engine.hoverPoint = nearest
    if (!engine.pointer.active || !engine.dragTarget) return
    if (engine.dragTarget.type === 'point') {
      const point = engine.cloth.points[engine.dragTarget.index]
      point.x = x
      point.y = y
      point.px = x
      point.py = y
    } else if (engine.dragTarget.type === 'object') {
      const object = engine.objects[engine.dragTarget.index]
      if (object) {
        object.x = clamp(x, 34, engine.width - 34)
        object.y = clamp(y, 34, engine.cloth.floorY - objectRadius(object) - 6)
        object.vx = 0
        object.vy = 0
      }
    } else {
      engine.pointer.path.push({ x, y, px: x, py: y, pinned: false, homeX: x, homeY: y })
      if (engine.pointer.path.length > 80) engine.pointer.path.shift()
      cutAlongPath(engine.cloth, engine.pointer.path, 15)
    }
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current
    if (!engine) return
    if (engine.dragTarget?.type === 'cut') {
      const cutCount = cutAlongPath(engine.cloth, engine.pointer.path, 17)
      setToast(cutCount > 0 ? `Cut ${cutCount} constraints` : 'No constraints crossed')
    }
    engine.pointer.active = false
    engine.dragTarget = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* pointer may already be released */ }
  }

  const activeToolHint = tool === 'grab' ? 'Drag a node or object' : tool === 'cut' ? 'Drag across the cloth to sever springs' : tool === 'pin' ? 'Click a node to pin / release it' : `Click to drop a ${OBJECT_LABELS[objectKind].toLowerCase()}`

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div>
            <div className="brand-name">LOOMFALL</div>
            <div className="brand-subtitle">CONSTRAINT LAB <span>/</span> 01</div>
          </div>
        </div>
        <nav className="topnav" aria-label="Project navigation">
          <span className="nav-active">LABORATORY</span>
          <span>FIELD NOTES</span>
          <span>ABOUT THE SOLVER</span>
        </nav>
        <div className="top-actions">
          <span className="live-indicator"><i /> SIMULATION LIVE</span>
          <button className="icon-button ghost" aria-label="Help" title="Keyboard shortcuts" onClick={() => setShowHelp(true)}><Icon name="help" size={17} /></button>
        </div>
      </header>

      <main className="workspace">
        <aside className="left-rail">
          <section className="panel intro-panel">
            <div className="eyebrow"><span className="eyebrow-dot" /> EXPERIMENT 01</div>
            <h1>Cloth, under pressure.</h1>
            <p>Pull on the mesh. Drop a weight. Find the edge between structure and surrender.</p>
            <div className="intro-meta"><span><Icon name="nodes" size={14} /> mass-spring mesh</span><span><Icon name="target" size={14} /> live field</span></div>
          </section>

          <section className="panel control-panel">
            <div className="panel-heading">
              <div><span className="section-index">01</span><h2>Tools</h2></div>
              <span className="control-hint">{activeToolHint}</span>
            </div>
            <div className="tool-grid">
              <ToolButton tool="grab" active={tool === 'grab'} onClick={() => setTool('grab')} />
              <ToolButton tool="cut" active={tool === 'cut'} onClick={() => setTool('cut')} />
              <ToolButton tool="pin" active={tool === 'pin'} onClick={() => setTool('pin')} />
              <ToolButton tool="object" active={tool === 'object'} onClick={() => setTool('object')} />
            </div>
            {tool === 'object' && (
              <div className="object-picker" aria-label="Choose object type">
                {(Object.keys(OBJECT_LABELS) as ObjectKind[]).map((kind) => (
                  <button key={kind} className={objectKind === kind ? 'selected' : ''} onClick={() => setObjectKind(kind)} aria-pressed={objectKind === kind}>
                    <Icon name={kind} size={16} /> {OBJECT_LABELS[kind]}
                  </button>
                ))}
              </div>
            )}
            <div className="tool-divider" />
            <div className="panel-heading compact"><div><span className="section-index">02</span><h2>Material</h2></div><span className="live-value">{Math.round(params.stiffness * 100)}% bonded</span></div>
            <div className="range-stack">
              <RangeControl label="Stiffness" value={params.stiffness} min={0.45} max={1} step={0.01} display={`${Math.round(params.stiffness * 100)}%`} onChange={(value) => updateParam('stiffness', value)} tone="amber" icon="nodes" />
              <RangeControl label="Damping" value={params.damping} min={0.975} max={0.999} step={0.001} display={`${Math.round((1 - params.damping) * 1000) / 10}%`} onChange={(value) => updateParam('damping', value)} tone="pink" icon="reset" />
              <RangeControl label="Tear limit" value={params.tearThreshold} min={1.2} max={2.5} step={0.01} display={`${params.tearThreshold.toFixed(2)}×`} onChange={(value) => updateParam('tearThreshold', value)} tone="pink" icon="cut" />
            </div>
            <div className="tool-divider" />
            <div className="panel-heading compact"><div><span className="section-index">03</span><h2>Environment</h2></div><span className="live-value">{params.speed.toFixed(2)}× time</span></div>
            <div className="range-stack">
              <RangeControl label="Gravity" value={params.gravity} min={0} max={1.6} step={0.01} display={`${params.gravity.toFixed(2)}g`} onChange={(value) => updateParam('gravity', value)} tone="cyan" icon="gravity" />
              <RangeControl label="Wind" value={params.wind} min={-1} max={1} step={0.01} display={`${params.wind > 0 ? '+' : ''}${params.wind.toFixed(2)}`} onChange={(value) => updateParam('wind', value)} tone="cyan" icon="wind" />
              <RangeControl label="Simulation" value={params.speed} min={0.25} max={1.5} step={0.05} display={`${params.speed.toFixed(2)}×`} onChange={(value) => updateParam('speed', value)} tone="amber" icon="play" />
            </div>
            <div className="tool-divider" />
            <div className="panel-heading compact"><div><span className="section-index">04</span><h2>Collision</h2></div><span className="live-value">{params.objectMass.toFixed(1)}× mass</span></div>
            <div className="range-stack">
              <RangeControl label="Object mass" value={params.objectMass} min={0.2} max={4} step={0.1} display={`${params.objectMass.toFixed(1)}×`} onChange={(value) => updateParam('objectMass', value)} tone="pink" icon="nodes" />
              <RangeControl label="Bounce" value={params.objectBounce} min={0} max={1} step={0.05} display={`${Math.round(params.objectBounce * 100)}%`} onChange={(value) => updateParam('objectBounce', value)} tone="cyan" icon="reset" />
            </div>
          </section>

          <section className="panel micro-panel">
            <div className="micro-label"><Icon name="spark" size={14} /> TRY THIS</div>
            <p>Use <kbd>G</kbd> to grab the top edge, then switch to <kbd>C</kbd> and draw a diagonal tear.</p>
          </section>
        </aside>

        <section className="stage-column">
          <div className="stage-header">
            <div><span className="stage-kicker">INTERACTIVE PHYSICS SANDBOX</span><h2>{currentPreset.name}<span className="title-slash"> / </span><em>{activePreset === 'custom' ? 'custom field' : currentPreset.description.toLowerCase()}</em></h2></div>
            <div className="stage-header-actions"><button className={`view-toggle ${stressView ? 'active' : ''}`} onClick={() => setStressView((value) => !value)}><span className="toggle-dot" /> stress view</button><span className="stage-code">{activePreset === 'custom' ? 'CUSTOM' : currentPreset.code}</span></div>
          </div>
          <div className="stage-frame">
            <canvas ref={canvasRef} className="simulation-canvas" aria-label="Interactive cloth physics simulation" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} />
            <div className="stage-overlay top-left"><span className="status-pip" /> {isRunning ? 'RUNNING' : 'PAUSED'} <span className="overlay-separator">•</span> {telemetry.fps || 60} FPS</div>
            <div className="stage-overlay top-right"><span className="crosshair" /> pointer field</div>
            <div className="stage-overlay bottom-left">DRAG / CUT / PIN <span className="overlay-separator">•</span> {telemetry.nodes || '—'} NODES</div>
            <div className="stage-overlay bottom-right">{Math.round(params.gravity * 100)}% gravity</div>
          </div>
          <div className="stage-caption"><span>{toast}</span><span className="caption-right"><span className="caption-key">SPACE</span> pause <span className="caption-key">R</span> reset</span></div>
          <div className="transport-bar">
            <div className="transport-left">
              <button className="transport-play" onClick={() => setIsRunning((value) => !value)} aria-label={isRunning ? 'Pause simulation' : 'Play simulation'}>{isRunning ? <Icon name="pause" size={18} /> : <Icon name="play" size={18} />}</button>
              <button className="transport-reset" onClick={resetScene}><Icon name="reset" size={15} /> RESET SCENE</button>
              <span className="transport-time"><span className="transport-dot" /> T+ {(engineRef.current?.time ?? 0).toFixed(1).padStart(5, '0')}s</span>
            </div>
            <div className="transport-right"><button className="object-drop-button" onClick={() => addObjectAt(objectKind)}><Icon name={objectKind} size={15} /> DROP {OBJECT_LABELS[objectKind].toUpperCase()}</button><button className="clear-button" onClick={clearObjects}><Icon name="trash" size={15} /> CLEAR OBJECTS</button></div>
          </div>

          <section className="panel preset-panel">
            <div className="panel-heading preset-heading"><div><span className="section-index">04</span><h2>Scenarios</h2></div><span className="control-hint">Five starting conditions</span></div>
            <div className="preset-grid">
              {PRESETS.map((preset) => (
                <button key={preset.id} className={`preset-card tone-${preset.color} ${activePreset === preset.id ? 'is-active' : ''}`} onClick={() => loadPreset(preset.id)}>
                  <span className="preset-top"><span className="preset-code">{preset.code}</span><span className="preset-check">{activePreset === preset.id ? '●' : '○'}</span></span>
                  <span className="preset-name">{preset.name}</span>
                  <span className="preset-description">{preset.description}</span>
                </button>
              ))}
            </div>
          </section>
        </section>

        <aside className="right-rail">
          <section className="panel telemetry-panel">
            <div className="panel-heading"><div><span className="section-index">05</span><h2>Telemetry</h2></div><span className="telemetry-live"><i /> LIVE</span></div>
            <div className="telemetry-main"><span className="telemetry-number">{telemetry.energy.toFixed(1)}</span><span className="telemetry-unit">energy<br />index</span><div className="telemetry-sparkline" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /><span /></div></div>
            <div className="metric-grid">
              <div><span>FPS</span><strong>{telemetry.fps || 60}</strong></div>
              <div><span>NODES</span><strong>{telemetry.nodes || '—'}</strong></div>
              <div><span>SPRINGS</span><strong>{telemetry.springs || '—'}</strong></div>
              <div><span>TEARS</span><strong className={telemetry.tears > 0 ? 'warning-value' : ''}>{telemetry.tears}</strong></div>
            </div>
            <div className="telemetry-footer"><span><span className="footer-line cyan-line" /> cloth mesh</span><span><span className="footer-line amber-line" /> contacts {telemetry.contacts}</span></div>
          </section>

          <section className="panel objects-panel">
            <div className="panel-heading"><div><span className="section-index">06</span><h2>In the field</h2></div><button className="text-button" onClick={clearObjects}>clear</button></div>
            <div className="object-list">
              {(engineRef.current?.objects ?? []).length === 0 && <div className="empty-state"><Icon name="target" size={18} /><span>No objects yet.<br />Choose Drop or click the field.</span></div>}
              {(engineRef.current?.objects ?? []).map((object) => <div className="object-row" key={object.id}><span className="object-icon" style={{ color: object.color }}><Icon name={object.kind} size={17} /></span><span className="object-info"><strong>{OBJECT_LABELS[object.kind]}</strong><small>{object.mass.toFixed(1)}× mass <span>•</span> {Math.round(object.size)}px</small></span><button className="remove-object" onClick={() => removeObject(object.id)} aria-label={`Remove ${OBJECT_LABELS[object.kind]}`}><Icon name="close" size={14} /></button></div>)}
            </div>
            <div className="object-mass-control"><span>OBJECT MASS / BOUNCE</span><strong>{params.objectMass.toFixed(1)}× / {Math.round(params.objectBounce * 100)}%</strong></div>
          </section>

          <section className="panel shortcuts-panel">
            <div className="panel-heading"><div><span className="section-index">07</span><h2>Field notes</h2></div><button className="icon-button ghost small" aria-label="Open shortcuts" onClick={() => setShowHelp(true)}><Icon name="chevron" size={15} /></button></div>
            <div className="shortcut-list"><div><kbd>G</kbd><span>grab a node</span></div><div><kbd>C</kbd><span>cut constraints</span></div><div><kbd>1—5</kbd><span>load scenario</span></div></div>
            <button className="help-link" onClick={() => setShowHelp(true)}><Icon name="help" size={14} /> full control map <Icon name="chevron" size={13} /></button>
          </section>
        </aside>
      </main>

      <footer className="app-footer"><span><span className="footer-mark">✳</span> A tactile experiment by Loomfall Studio</span><span>VER 0.4.0 <span className="footer-separator">•</span> NO BACKEND <span className="footer-separator">•</span> STATIC / LOCAL FIRST</span></footer>

      {showHelp && <div className="modal-backdrop" role="presentation" onClick={() => setShowHelp(false)}><section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowHelp(false)} aria-label="Close help"><Icon name="close" size={18} /></button><span className="eyebrow"><span className="eyebrow-dot" /> CONTROL MAP</span><h2 id="help-title">Make the mesh move.</h2><p>Every tool works directly on the field. Try slow changes first, then introduce force.</p><div className="help-grid"><div><kbd>SPACE</kbd><span>pause / resume</span></div><div><kbd>R</kbd><span>reset current scene</span></div><div><kbd>G</kbd><span>grab cloth or objects</span></div><div><kbd>C</kbd><span>draw a cut path</span></div><div><kbd>P</kbd><span>pin / release a node</span></div><div><kbd>O</kbd><span>drop selected object</span></div></div><button className="modal-action" onClick={() => { setShowHelp(false); setTool('cut') }}><Icon name="cut" size={16} /> start with a cut</button></section></div>}
    </div>
  )
}
