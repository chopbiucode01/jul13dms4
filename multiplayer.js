(() => {
  const PROJECT_URL = 'https://vnewdflwndwzsiqvjqvg.supabase.co'
  const PUBLISHABLE_KEY = 'sb_publishable_EMiPuJcLEfyWilh6giK4cw_T-7Uqe96'
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.7/dist/umd/supabase.min.js'
  const PUBLIC_GAME_URL = 'https://chopbiucode01.github.io/jul13dms4/'
  let sdk = window.supabase
  let sdkPromise = null
  const ui = {
    start: document.querySelector('#start-choice'),
    open: document.querySelector('#open-private-battle'),
    lobby: document.querySelector('#private-lobby'),
    title: document.querySelector('#private-lobby-title'),
    copy: document.querySelector('#private-lobby-copy'),
    actions: document.querySelector('#private-lobby-actions'),
    host: document.querySelector('#host-private-match'),
    joinForm: document.querySelector('#join-private-form'),
    codeInput: document.querySelector('#private-code'),
    waiting: document.querySelector('#private-waiting'),
    roomCode: document.querySelector('#private-room-code'),
    copyLink: document.querySelector('#copy-private-link'),
    status: document.querySelector('#private-status'),
    close: document.querySelector('#close-private-lobby'),
    leave: document.querySelector('#private-leave'),
  }

  let client = null
  let match = null
  let channel = null
  let lastVersion = -1
  let gameStarted = false
  let requestPending = false

  function status(message, kind = '') {
    ui.status.textContent = message
    ui.status.className = `private-status ${kind}`.trim()
  }

  function showLobby() {
    ui.start.classList.add('hidden')
    ui.lobby.classList.remove('hidden')
    ui.actions.classList.remove('hidden')
    ui.waiting.classList.add('hidden')
    ui.title.textContent = 'PRIVATE BATTLE'
    ui.copy.textContent = 'Host a battlefield or enter a six-character invitation code.'
    ui.close.textContent = 'BACK'
    status('')
    const code = new URLSearchParams(location.search).get('match')
    if (code) ui.codeInput.value = code.toUpperCase().slice(0, 6)
  }

  function showWaiting(current) {
    ui.actions.classList.add('hidden')
    ui.waiting.classList.remove('hidden')
    ui.roomCode.textContent = current.code
    ui.title.textContent = 'AWAITING YOUR RIVAL'
    ui.copy.textContent = 'The war table is ready. Keep this page open.'
    ui.close.textContent = 'CANCEL ROOM'
    status('Listening for your friend…')
  }

  function loadSdk() {
    if (sdk?.createClient) return Promise.resolve(sdk)
    if (sdkPromise) return sdkPromise
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = SDK_URL
      script.onload = () => { sdk = window.supabase; resolve(sdk) }
      script.onerror = () => reject(new Error('The private-battle connection could not load. Check your internet connection.'))
      document.head.appendChild(script)
    })
    return sdkPromise
  }

  async function waitForGameBridge() {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (window.startPrivateBattle) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('The battlefield is still loading. Try again in a moment.')
  }

  async function ensureClient() {
    await loadSdk()
    if (!client) client = sdk.createClient(PROJECT_URL, PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
    const { data } = await client.auth.getSession()
    if (!data.session) {
      const { error } = await client.auth.signInAnonymously()
      if (error) throw error
    }
    return client
  }

  async function invoke(command, extra = {}) {
    await ensureClient()
    const { data, error } = await client.functions.invoke('private-match', { body: { command, ...extra } })
    if (error) {
      let message = error.message || 'The private battle service did not respond.'
      try {
        const details = await error.context.json()
        if (details?.error) message = details.error
      } catch {}
      throw new Error(message)
    }
    if (data?.error) throw new Error(data.error)
    return data.match
  }

  function fromRow(row) {
    return {
      id: row.id,
      code: row.code,
      status: row.status,
      state: row.state,
      lastEvent: row.last_event,
      version: Number(row.version),
      side: match?.side,
      expiresAt: row.expires_at,
    }
  }

  async function subscribe(current) {
    if (channel) await client.removeChannel(channel)
    channel = client
      .channel(`private-match-${current.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'private_matches', filter: `id=eq.${current.id}` }, (payload) => deliver(fromRow(payload.new)))
      .subscribe((state) => {
        if (state === 'CHANNEL_ERROR') status('Live connection interrupted. Reconnecting…', 'error')
      })
  }

  async function deliver(next) {
    if (!next || next.version < lastVersion) return
    const previousVersion = lastVersion
    match = { ...next, side: next.side || match?.side }
    lastVersion = next.version
    if (match.status === 'waiting') {
      showWaiting(match)
      return
    }
    if (match.status === 'abandoned') {
      if (gameStarted && window.privateBattleOpponentLeft) window.privateBattleOpponentLeft()
      else status('This room was closed.', 'error')
      return
    }
    if (!gameStarted && (match.status === 'active' || match.status === 'finished')) {
      await waitForGameBridge()
      gameStarted = true
      ui.lobby.classList.add('hidden')
      ui.start.classList.add('hidden')
      ui.leave.classList.remove('hidden')
      if (window.startPrivateBattle) await window.startPrivateBattle(match)
      return
    }
    if (gameStarted && next.version > previousVersion && window.applyPrivateBattleUpdate) await window.applyPrivateBattleUpdate(match)
  }

  async function host() {
    if (requestPending) return
    requestPending = true
    status('Raising the war banner…')
    try {
      const created = await invoke('create')
      match = created
      lastVersion = Number(created.version)
      await subscribe(created)
      showWaiting(created)
    } catch (error) {
      status(error.message, 'error')
    } finally {
      requestPending = false
    }
  }

  async function join(code) {
    if (requestPending) return
    const cleaned = String(code || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6)
    ui.codeInput.value = cleaned
    if (cleaned.length !== 6) return status('Enter the full six-character room code.', 'error')
    requestPending = true
    status('Entering the battlefield…')
    try {
      const joined = await invoke('join', { code: cleaned })
      match = joined
      lastVersion = Number(joined.version)
      await subscribe(joined)
      await deliver(joined)
    } catch (error) {
      status(error.message, 'error')
    } finally {
      requestPending = false
    }
  }

  async function sendAction(action) {
    if (!match || requestPending) return false
    requestPending = true
    try {
      const updated = await invoke('action', { matchId: match.id, action })
      await deliver(updated)
      return true
    } catch (error) {
      if (window.privateBattleError) window.privateBattleError(error.message)
      else status(error.message, 'error')
      return false
    } finally {
      requestPending = false
    }
  }

  async function leave() {
    if (match && match.status !== 'finished') {
      try { await invoke('leave', { matchId: match.id }) } catch {}
    }
    if (channel && client) await client.removeChannel(channel)
    channel = null
    match = null
    lastVersion = -1
    gameStarted = false
    ui.leave.classList.add('hidden')
    ui.lobby.classList.add('hidden')
    ui.start.classList.remove('hidden')
    if (window.exitPrivateBattle) window.exitPrivateBattle()
  }

  ui.open.addEventListener('click', showLobby)
  ui.host.addEventListener('click', host)
  ui.joinForm.addEventListener('submit', (event) => { event.preventDefault(); join(ui.codeInput.value) })
  ui.codeInput.addEventListener('input', () => { ui.codeInput.value = ui.codeInput.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6) })
  ui.close.addEventListener('click', () => match?.status === 'waiting' ? leave() : (ui.lobby.classList.add('hidden'), ui.start.classList.remove('hidden')))
  ui.leave.addEventListener('click', () => { if (confirm('Leave this private battle? Your friend will be notified.')) leave() })
  ui.copyLink.addEventListener('click', async () => {
    if (!match) return
    const base = location.protocol === 'file:' ? PUBLIC_GAME_URL : location.href.split('?')[0].split('#')[0]
    const link = `${base}?match=${match.code}`
    try {
      await navigator.clipboard.writeText(link)
      status('Invitation link copied.', 'success')
    } catch {
      status(`Share this link: ${link}`, 'success')
    }
  })

  window.privateBattle = {
    sendAction,
    leave,
    get match() { return match },
    get pending() { return requestPending },
  }
})()
