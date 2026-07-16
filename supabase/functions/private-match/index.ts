import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const classes: Record<string, { move: number; range: number }> = {
  sword: { move: 3, range: 1 },
  spear: { move: 3, range: 1 },
  axe: { move: 2, range: 1 },
  bow: { move: 3, range: 2 },
}

type Side = 'host' | 'guest'
type Unit = {
  id: string
  name: string
  type: 'sword' | 'spear' | 'axe' | 'bow'
  side: Side
  x: number
  y: number
  hp: number
  maxHp: number
  moved: boolean
  acted: boolean
}
type Obstacle = { type: string; x: number; y: number }
type MatchState = {
  turn: Side
  round: number
  winner: Side | null
  units: Unit[]
  obstacles: Obstacle[]
}

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function initialState(): MatchState {
  return {
    turn: 'host',
    round: 1,
    winner: null,
    units: [
      { id: 'h-sword', name: 'Ari', type: 'sword', side: 'host', x: 0, y: 2, hp: 10, maxHp: 10, moved: false, acted: false },
      { id: 'h-spear', name: 'Moss', type: 'spear', side: 'host', x: 0, y: 3, hp: 10, maxHp: 10, moved: false, acted: false },
      { id: 'h-bow', name: 'Nia', type: 'bow', side: 'host', x: 0, y: 4, hp: 10, maxHp: 10, moved: false, acted: false },
      { id: 'g-sword', name: 'Vera', type: 'sword', side: 'guest', x: 5, y: 3, hp: 10, maxHp: 10, moved: false, acted: false },
      { id: 'g-spear', name: 'Rook', type: 'spear', side: 'guest', x: 5, y: 2, hp: 10, maxHp: 10, moved: false, acted: false },
      { id: 'g-bow', name: 'Edda', type: 'bow', side: 'guest', x: 5, y: 1, hp: 10, maxHp: 10, moved: false, acted: false },
    ],
    obstacles: [
      { type: 'tree', x: 2, y: 1 },
      { type: 'rock', x: 3, y: 4 },
      { type: 'bramble', x: 2, y: 4 },
      { type: 'bramble', x: 3, y: 1 },
      { type: 'shrine', x: 1, y: 5 },
      { type: 'shrine', x: 4, y: 0 },
    ],
  }
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
const advantage = (a: string, b: string) => (a === 'axe' && b === 'sword') || (a === 'sword' && b === 'spear') || (a === 'spear' && b === 'axe')
const occupied = (state: MatchState, x: number, y: number, except = '') => state.units.some((u) => u.id !== except && u.x === x && u.y === y)
const blocked = (state: MatchState, x: number, y: number) => state.obstacles.some((o) => o.x === x && o.y === y && ['river', 'tree', 'rock'].includes(o.type))
const cover = (state: MatchState, unit: Unit) => state.obstacles.some((o) => ['tree', 'rock'].includes(o.type) && distance(unit, o) === 1) ? 1 : 0

function canAttack(attacker: Unit, defender: Unit) {
  const dx = Math.abs(attacker.x - defender.x)
  const dy = Math.abs(attacker.y - defender.y)
  return attacker.type === 'bow'
    ? (dx === 0 && dy === 2) || (dy === 0 && dx === 2) || (dx === 1 && dy === 1)
    : dx + dy === 1
}

function walkDistance(state: MatchState, unit: Unit, targetX: number, targetY: number) {
  if (targetX < 0 || targetX > 5 || targetY < 0 || targetY > 5 || blocked(state, targetX, targetY) || occupied(state, targetX, targetY, unit.id)) return null
  const queue = [{ x: unit.x, y: unit.y, d: 0 }]
  const seen = new Set([`${unit.x},${unit.y}`])
  while (queue.length) {
    const cell = queue.shift()!
    if (cell.x === targetX && cell.y === targetY) return cell.d
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const x = cell.x + dx
      const y = cell.y + dy
      const key = `${x},${y}`
      if (x >= 0 && x < 6 && y >= 0 && y < 6 && !seen.has(key) && !blocked(state, x, y) && !occupied(state, x, y, unit.id)) {
        seen.add(key)
        queue.push({ x, y, d: cell.d + 1 })
      }
    }
  }
  return null
}

function terrainEffect(state: MatchState, unit: Unit) {
  const terrain = state.obstacles.find((o) => o.x === unit.x && o.y === unit.y)
  if (!terrain) return null
  if (terrain.type === 'shrine') {
    const amount = Math.min(4, unit.maxHp - unit.hp)
    unit.hp += amount
    return amount ? { type: 'shrine', amount } : null
  }
  if (terrain.type === 'bramble') {
    unit.hp -= 1
    return { type: 'bramble', amount: 1 }
  }
  return null
}

function finishState(state: MatchState, actingSide: Side) {
  const opponent: Side = actingSide === 'host' ? 'guest' : 'host'
  if (!state.units.some((u) => u.side === opponent)) state.winner = actingSide
  if (!state.units.some((u) => u.side === actingSide)) state.winner = opponent
}

function applyAction(state: MatchState, side: Side, action: Record<string, unknown>, sequence: number) {
  if (state.winner) throw new Error('This battle is already finished.')
  if (state.turn !== side) throw new Error('Wait for your opponent to finish their turn.')
  const type = String(action.type || '')

  if (type === 'move') {
    const unit = state.units.find((u) => u.id === action.unitId)
    const x = Number(action.x)
    const y = Number(action.y)
    if (!unit || unit.side !== side) throw new Error('That troop is not yours.')
    if (unit.moved || unit.acted) throw new Error('That troop has already used its movement.')
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error('Invalid destination.')
    const steps = walkDistance(state, unit, x, y)
    if (!steps || steps > classes[unit.type].move) throw new Error('That tile is out of range.')
    const from = { x: unit.x, y: unit.y }
    unit.x = x
    unit.y = y
    unit.moved = true
    const terrain = terrainEffect(state, unit)
    if (unit.hp <= 0) state.units = state.units.filter((u) => u.id !== unit.id)
    finishState(state, side)
    return { sequence, type, side, unitId: unit.id, from, to: { x, y }, terrain, winner: state.winner }
  }

  if (type === 'attack') {
    const attacker = state.units.find((u) => u.id === action.attackerId)
    const defender = state.units.find((u) => u.id === action.targetId)
    if (!attacker || attacker.side !== side) throw new Error('That attacker is not yours.')
    if (!defender || defender.side === side) throw new Error('Choose an opposing troop.')
    if (attacker.acted) throw new Error('That troop has already attacked.')
    if (!canAttack(attacker, defender)) throw new Error('That target is out of range.')
    const defendedByCover = cover(state, defender)
    const base = advantage(attacker.type, defender.type) ? 4 : advantage(defender.type, attacker.type) ? 2 : 3
    const archerWeakness = defender.type === 'bow' && attacker.type !== 'bow' ? 1 : 0
    const dealt = Math.max(1, base + archerWeakness - defendedByCover)
    const canCounter = canAttack(defender, attacker)
    const counterBase = canCounter ? (advantage(defender.type, attacker.type) ? 3 : advantage(attacker.type, defender.type) ? 1 : 2) : 0
    const counter = counterBase ? Math.max(1, counterBase - cover(state, attacker)) : 0
    attacker.moved = true
    attacker.acted = true
    defender.hp -= dealt
    let defenderFell = defender.hp <= 0
    let attackerFell = false
    if (defenderFell) {
      state.units = state.units.filter((u) => u.id !== defender.id)
    } else if (counter) {
      attacker.hp -= counter
      attackerFell = attacker.hp <= 0
      if (attackerFell) state.units = state.units.filter((u) => u.id !== attacker.id)
    }
    finishState(state, side)
    return { sequence, type, side, attackerId: attacker.id, targetId: defender.id, dealt, counter: defenderFell ? 0 : counter, defenderFell, attackerFell, winner: state.winner }
  }

  if (type === 'end_turn') {
    const next: Side = side === 'host' ? 'guest' : 'host'
    state.turn = next
    if (next === 'host') state.round += 1
    state.units.filter((u) => u.side === next).forEach((u) => { u.moved = false; u.acted = false })
    return { sequence, type, side, next, round: state.round }
  }

  throw new Error('Unknown battle action.')
}

function publicMatch(row: Record<string, unknown>, userId: string) {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    state: row.state,
    lastEvent: row.last_event,
    version: row.version,
    side: row.host_id === userId ? 'host' : 'guest',
    expiresAt: row.expires_at,
  }
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const values = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return reply({ error: 'Sign in before entering a private battle.' }, 401)
    const { data: authData, error: authError } = await admin.auth.getUser(token)
    if (authError || !authData.user) return reply({ error: 'Your guest session has expired.' }, 401)
    const userId = authData.user.id
    const body = await req.json()
    const command = String(body.command || '')

    if (command === 'create') {
      let inserted: Record<string, unknown> | null = null
      for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
        const code = randomCode()
        const { data, error } = await admin.from('private_matches').insert({
          code,
          host_id: userId,
          status: 'waiting',
          state: initialState(),
          last_event: { sequence: 0, type: 'created', side: 'host' },
        }).select().single()
        if (!error) inserted = data
        else if (error.code !== '23505') throw error
      }
      if (!inserted) throw new Error('Could not create a unique room code. Try again.')
      return reply({ match: publicMatch(inserted, userId) })
    }

    if (command === 'join') {
      const code = String(body.code || '').toUpperCase().replace(/[^A-Z2-9]/g, '')
      const { data: existing, error: findError } = await admin.from('private_matches').select('*').eq('code', code).gt('expires_at', new Date().toISOString()).single()
      if (findError || !existing) return reply({ error: 'Room not found or expired.' }, 404)
      if (existing.host_id === userId) return reply({ match: publicMatch(existing, userId) })
      if (existing.guest_id && existing.guest_id !== userId) return reply({ error: 'That private battle already has two players.' }, 409)
      if (existing.status === 'finished' || existing.status === 'abandoned') return reply({ error: 'That private battle is no longer active.' }, 409)
      const nextVersion = Number(existing.version) + 1
      const { data: joined, error: joinError } = await admin.from('private_matches').update({
        guest_id: userId,
        status: 'active',
        version: nextVersion,
        updated_at: new Date().toISOString(),
        last_event: { sequence: nextVersion, type: 'joined', side: 'guest' },
      }).eq('id', existing.id).or(`guest_id.is.null,guest_id.eq.${userId}`).select().single()
      if (joinError || !joined) return reply({ error: 'Another player joined this room first.' }, 409)
      return reply({ match: publicMatch(joined, userId) })
    }

    const matchId = String(body.matchId || '')
    const { data: match, error: matchError } = await admin.from('private_matches').select('*').eq('id', matchId).single()
    if (matchError || !match) return reply({ error: 'Private battle not found.' }, 404)
    const side: Side | null = match.host_id === userId ? 'host' : match.guest_id === userId ? 'guest' : null
    if (!side) return reply({ error: 'You are not part of this private battle.' }, 403)

    if (command === 'get') return reply({ match: publicMatch(match, userId) })

    if (command === 'leave') {
      const nextVersion = Number(match.version) + 1
      const { data: left, error } = await admin.from('private_matches').update({
        status: 'abandoned',
        version: nextVersion,
        updated_at: new Date().toISOString(),
        last_event: { sequence: nextVersion, type: 'left', side },
      }).eq('id', match.id).select().single()
      if (error) throw error
      return reply({ match: publicMatch(left, userId) })
    }

    if (command === 'action') {
      if (match.status !== 'active') return reply({ error: 'Wait for your friend to join the room.' }, 409)
      const state = structuredClone(match.state) as MatchState
      const nextVersion = Number(match.version) + 1
      let event
      try {
        event = applyAction(state, side, body.action || {}, nextVersion)
      } catch (error) {
        return reply({ error: error instanceof Error ? error.message : 'Illegal battle action.' }, 400)
      }
      const status = state.winner ? 'finished' : 'active'
      const { data: updated, error: updateError } = await admin.from('private_matches').update({
        state,
        status,
        version: nextVersion,
        last_event: event,
        updated_at: new Date().toISOString(),
      }).eq('id', match.id).eq('version', match.version).select().single()
      if (updateError || !updated) return reply({ error: 'The match changed before that action arrived. Try again.' }, 409)
      return reply({ match: publicMatch(updated, userId) })
    }

    return reply({ error: 'Unknown private-match command.' }, 400)
  } catch (error) {
    console.error(error)
    return reply({ error: error instanceof Error ? error.message : 'Private battle service failed.' }, 500)
  }
})
