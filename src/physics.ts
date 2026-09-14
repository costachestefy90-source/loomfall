export type Point = {
  x: number
  y: number
  px: number
  py: number
  pinned: boolean
  homeX: number
  homeY: number
}

export type Constraint = {
  a: number
  b: number
  rest: number
  active: boolean
  kind: 'structural' | 'shear' | 'bend'
}

export type ObjectKind = 'ball' | 'cube' | 'ring' | 'star'

export type SimObject = {
  id: number
  kind: ObjectKind
  x: number
  y: number
  vx: number
  vy: number
  angle: number
  spin: number
  size: number
  mass: number
  bounce: number
  color: string
  hitPulse: number
}

export type Cloth = {
  cols: number
  rows: number
  width: number
  height: number
  floorY: number
  points: Point[]
  constraints: Constraint[]
}

export type SimulationParams = {
  gravity: number
  stiffness: number
  damping: number
  wind: number
  speed: number
  objectMass: number
  objectBounce: number
  iterations: number
  tearThreshold: number
}

export type Contact = {
  x: number
  y: number
  strength: number
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const pointIndex = (col: number, row: number, cols: number) => row * cols + col

const addConstraint = (
  constraints: Constraint[],
  points: Point[],
  a: number,
  b: number,
  kind: Constraint['kind'],
) => {
  const dx = points[b].x - points[a].x
  const dy = points[b].y - points[a].y
  constraints.push({ a, b, rest: Math.hypot(dx, dy), active: true, kind })
}

export function createCloth(
  cols: number,
  rows: number,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  floorY: number,
): Cloth {
  const points: Point[] = []
  const constraints: Constraint[] = []

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const t = col / (cols - 1)
      const x = offsetX + t * width
      const y = offsetY + row * (height / (rows - 1))
      points.push({
        x,
        y,
        px: x,
        py: y,
        pinned: row === 0,
        homeX: x,
        homeY: y,
      })
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const current = pointIndex(col, row, cols)
      if (col < cols - 1) addConstraint(constraints, points, current, pointIndex(col + 1, row, cols), 'structural')
      if (row < rows - 1) addConstraint(constraints, points, current, pointIndex(col, row + 1, cols), 'structural')
      if (col < cols - 1 && row < rows - 1) {
        addConstraint(constraints, points, current, pointIndex(col + 1, row + 1, cols), 'shear')
        addConstraint(constraints, points, pointIndex(col + 1, row, cols), pointIndex(col, row + 1, cols), 'shear')
      }
      if (col < cols - 2) addConstraint(constraints, points, current, pointIndex(col + 2, row, cols), 'bend')
      if (row < rows - 2) addConstraint(constraints, points, current, pointIndex(col, row + 2, cols), 'bend')
    }
  }

  return { cols, rows, width, height, floorY, points, constraints }
}

export function cloneCloth(cloth: Cloth): Cloth {
  return {
    ...cloth,
    points: cloth.points.map((point) => ({ ...point })),
    constraints: cloth.constraints.map((constraint) => ({ ...constraint })),
  }
}

export function objectRadius(object: SimObject) {
  if (object.kind === 'cube') return object.size * 0.78
  if (object.kind === 'ring') return object.size * 0.72
  if (object.kind === 'star') return object.size * 0.8
  return object.size
}

const solveConstraint = (constraint: Constraint, points: Point[], stiffness: number) => {
  if (!constraint.active) return
  const a = points[constraint.a]
  const b = points[constraint.b]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const distance = Math.hypot(dx, dy) || 0.0001
  const difference = (distance - constraint.rest) / distance
  const correction = difference * stiffness
  const aWeight = a.pinned ? 0 : b.pinned ? 1 : 0.5
  const bWeight = b.pinned ? 0 : a.pinned ? 1 : 0.5
  a.x += dx * correction * aWeight
  a.y += dy * correction * aWeight
  b.x -= dx * correction * bWeight
  b.y -= dy * correction * bWeight
}

const resolveObjectCollision = (point: Point, object: SimObject, contacts: Contact[]) => {
  const radius = objectRadius(object) + 3
  const dx = point.x - object.x
  const dy = point.y - object.y
  const distance = Math.hypot(dx, dy)
  if (distance >= radius) return

  const safeDistance = distance || 0.001
  const nx = dx / safeDistance
  const ny = dy / safeDistance
  const penetration = radius - safeDistance
  point.x += nx * penetration
  point.y += ny * penetration
  const velocityX = point.x - point.px
  const velocityY = point.y - point.py
  const normalVelocity = velocityX * nx + velocityY * ny
  if (normalVelocity < 0) {
    const impact = clamp(1.05 + object.mass * 0.12, 1.05, 1.5)
    point.px = point.x - (velocityX - normalVelocity * nx * impact)
    point.py = point.y - (velocityY - normalVelocity * ny * impact)
  }
  object.hitPulse = Math.max(object.hitPulse, 1)
  contacts.push({ x: object.x + nx * objectRadius(object), y: object.y + ny * objectRadius(object), strength: 1 })
}

const resolveObjectPair = (a: SimObject, b: SimObject, contacts: Contact[]) => {
  const minimumDistance = objectRadius(a) + objectRadius(b)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const distance = Math.hypot(dx, dy)
  if (distance >= minimumDistance) return

  const safeDistance = distance || 0.001
  const nx = dx / safeDistance
  const ny = dy / safeDistance
  const inverseA = 1 / Math.max(a.mass, 0.1)
  const inverseB = 1 / Math.max(b.mass, 0.1)
  const totalInverse = inverseA + inverseB
  const correction = (minimumDistance - safeDistance) / totalInverse
  a.x -= nx * correction * inverseA
  a.y -= ny * correction * inverseA
  b.x += nx * correction * inverseB
  b.y += ny * correction * inverseB

  const relativeVelocity = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
  if (relativeVelocity < 0) {
    const bounce = Math.min(a.bounce, b.bounce)
    const impulse = -(1 + bounce) * relativeVelocity / totalInverse
    a.vx -= impulse * nx * inverseA
    a.vy -= impulse * ny * inverseA
    b.vx += impulse * nx * inverseB
    b.vy += impulse * ny * inverseB
  }
  a.hitPulse = Math.max(a.hitPulse, 0.75)
  b.hitPulse = Math.max(b.hitPulse, 0.75)
  contacts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, strength: 0.72 })
}

export function stepSimulation(
  cloth: Cloth,
  objects: SimObject[],
  params: SimulationParams,
  delta: number,
  time: number,
): Contact[] {
  const dt = clamp(delta, 0.001, 0.032) * params.speed
  const gravity = 580 * params.gravity
  const windStrength = params.wind * 155
  const contacts: Contact[] = []

  for (const point of cloth.points) {
    if (point.pinned) {
      point.x = point.homeX
      point.y = point.homeY
      point.px = point.x
      point.py = point.y
      continue
    }

    const velocityX = (point.x - point.px) * params.damping
    const velocityY = (point.y - point.py) * params.damping
    const gust = Math.sin(time * 3.1 + point.y * 0.018) * 0.28 + Math.cos(time * 1.7 + point.x * 0.012) * 0.16
    point.px = point.x
    point.py = point.y
    point.x += velocityX + windStrength * (0.72 + gust) * dt * dt
    point.y += velocityY + gravity * dt * dt
  }

  for (const object of objects) {
    object.vy += gravity * dt
    object.vx += windStrength * 0.035 * dt
    object.x += object.vx * dt
    object.y += object.vy * dt
    object.angle += object.spin * dt
    object.hitPulse = Math.max(0, object.hitPulse - dt * 3.6)

    const radius = objectRadius(object)
    if (object.x - radius < 24) {
      object.x = 24 + radius
      object.vx = Math.abs(object.vx) * object.bounce
    }
    if (object.x + radius > cloth.width + 24) {
      object.x = cloth.width + 24 - radius
      object.vx = -Math.abs(object.vx) * object.bounce
    }
    if (object.y + radius > cloth.floorY) {
      object.y = cloth.floorY - radius
      object.vy = -Math.abs(object.vy) * object.bounce
      object.vx *= 0.985
    }
  }

  for (let first = 0; first < objects.length; first += 1) {
    for (let second = first + 1; second < objects.length; second += 1) {
      resolveObjectPair(objects[first], objects[second], contacts)
    }
  }

  for (let iteration = 0; iteration < params.iterations; iteration += 1) {
    for (const constraint of cloth.constraints) {
      solveConstraint(constraint, cloth.points, params.stiffness * (constraint.kind === 'bend' ? 0.66 : 1))
    }
    for (const point of cloth.points) {
      if (point.pinned) continue
      if (point.y > cloth.floorY) {
        point.y = cloth.floorY
        point.py = point.y + (point.y - point.py) * 0.35
      }
      for (const object of objects) resolveObjectCollision(point, object, contacts)
    }
  }

  for (const constraint of cloth.constraints) {
    if (!constraint.active || constraint.kind === 'bend') continue
    const a = cloth.points[constraint.a]
    const b = cloth.points[constraint.b]
    if (Math.hypot(b.x - a.x, b.y - a.y) > constraint.rest * params.tearThreshold) constraint.active = false
  }

  return contacts.slice(-16)
}

export function findNearestPoint(cloth: Cloth, x: number, y: number, maxDistance = 38) {
  let nearest = -1
  let nearestDistance = maxDistance
  cloth.points.forEach((point, index) => {
    const distance = Math.hypot(point.x - x, point.y - y)
    if (distance < nearestDistance) {
      nearest = index
      nearestDistance = distance
    }
  })
  return nearest
}

export function findNearestObject(objects: SimObject[], x: number, y: number) {
  let nearest = -1
  let nearestDistance = Number.POSITIVE_INFINITY
  objects.forEach((object, index) => {
    const distance = Math.hypot(object.x - x, object.y - y)
    if (distance < objectRadius(object) + 18 && distance < nearestDistance) {
      nearest = index
      nearestDistance = distance
    }
  })
  return nearest
}

const distanceToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy || 1
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1)
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export function cutAlongPath(cloth: Cloth, path: Point[], radius = 16) {
  if (path.length < 2) return 0
  let cutCount = 0
  for (const constraint of cloth.constraints) {
    if (!constraint.active || constraint.kind === 'bend') continue
    const a = cloth.points[constraint.a]
    const b = cloth.points[constraint.b]
    for (let index = 1; index < path.length; index += 1) {
      const previous = path[index - 1]
      const current = path[index]
      if (distanceToSegment(a.x, a.y, previous.x, previous.y, current.x, current.y) < radius || distanceToSegment(b.x, b.y, previous.x, previous.y, current.x, current.y) < radius) {
        constraint.active = false
        cutCount += 1
        break
      }
    }
  }
  return cutCount
}

export function togglePin(cloth: Cloth, index: number) {
  if (index < 0 || index >= cloth.points.length) return
  const point = cloth.points[index]
  point.pinned = !point.pinned
  point.homeX = point.x
  point.homeY = point.y
  point.px = point.x
  point.py = point.y
}

export function countActiveConstraints(cloth: Cloth) {
  return cloth.constraints.reduce((count, constraint) => count + (constraint.active && constraint.kind !== 'bend' ? 1 : 0), 0)
}
