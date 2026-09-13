// Live college football score watcher.
// Polls ESPN's public scoreboard (no API key) and posts to the chat when a
// followed team's game goes final. Rival losses get a gloat.
const axios = require('axios')
const { getGif, getGifBySlug } = require('./api')

const SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=400'

// Teams we care about. Override with FOLLOW_TEAMS / RIVAL_TEAMS in .env
// as comma-separated ESPN abbreviations, e.g. FOLLOW_TEAMS=ALA,MICH,COLO
const parseTeams = (v) => (v || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
const FOLLOW = parseTeams(process.env.FOLLOW_TEAMS || 'ALA,MICH,COLO')
const RIVALS = parseTeams(process.env.RIVAL_TEAMS) // off by default

const CHEERS = {
  ALA: 'Roll Tide',
  MICH: 'Go Blue',
  COLO: 'Sko Buffs',
  CSU: 'I said it SUCKS to be a CSU RAM!',
}

// Per-team lines inside the spoiler. Defaults: "<Cheer>! <Team> win." and
// "<Team> lost. Rough one."
const WIN_LINES = {
  CSU: 'Rams win but it still sucks to be a CSU Ram.',
}
const LOSS_LINES = {
  CSU: 'Rams lost. It sucks to be a CSU Ram.',
}

// Celebration gif after a win. Either `search` terms (one picked at random,
// good when Klipy's tagging for the team is clean) or curated `slugs`
// (needed for smaller programs where search drifts to LA Rams / Sopranos).
// Browse https://klipy.com to find more slugs.
const WIN_GIFS = {
  ALA: { search: ['roll tide', 'alabama crimson tide', 'nick saban'] },
  MICH: { search: ['go blue', 'michigan wolverines', 'michigan football'] },
  COLO: { slugs: [
    'sko-buffaloes',              // Ralphie runs onto the field
    'ralphie-colorado',           // Ralphie and Colorado football
    'ralphie-5',                  // Ralphie mascot on the field
    'deon-sanders-cu-buffalos',   // Deion riding a buffalo
    'coachprime-colorado',        // Coach Prime praises God
    'do-you-believe',             // Deion: do you believe now?
    'deion-sanders-4',            // Deion sideline: I'm coming
    'shedeur-shedeur-sanders',    // Shedeur vs TCU
    'shedeur-cu',                 // get Shedeur'd on
    'travis-hunter-travishunter', // Travis Hunter reacts
    'cu-buffs-colorado',          // ref's touchdown signal
    'colorado-fan-buffs',         // Colorado fan
    'peggycoppom-playoffpeggy',   // Playoff Peggy
  ] },
  CSU: { slugs: [
    'colorado-state-rams-dancing',    // Rams fan dancing
    'csu-rams-colorado-state-rams-1', // Cam the Ram up close
    'colorado-state-rams-csu-1',      // fan in ram costume
    'colorado-state-rams-flag',       // flag
    'colorado-state-rams',            // logo animation
    'colorado-state-rams-rams',       // team huddle
    'colorado-state-rams-csu-rams',   // team huddle 2
    'colorado-state-rams-csu',        // player "can't hear you"
    'colorado-state-rams-black-prez', // boombox
    'csu-bauta',                      // football action
    'cam-ram',                        // Cam the Ram
  ] },
}

// Consolation gif after a loss: shared pool plus anything team-specific.
const LOSS_GIFS_SHARED = [
  'crying-jordan-13',              // Crying Jordan
  'michael-jordan-mj-10',          // Crying Jordan "NOOOOOO"
  'sad-pablo-lonely-5',            // sad Pablo Escobar
  'this-is-fine-fire-6',           // This Is Fine dog
  'tom-brady-defeated',            // Brady sitting on the field
  'well-that-sucks-randy-marsh-1', // Randy Marsh: well that sucks
  'bob-parr-incredibles',          // sad Mr. Incredible
  'spongebob-walk',                // Spongebob sad walk
  'conan-o-brien-why',             // Conan: WHYYYYY
]
const LOSS_GIFS_TEAM = {
  MICH: ['michigan-fan-crying-michigan-football', 'kid-crying-14'],
  ALA: ['saban-bama'],             // Saban: DAMMIT
}

// gameId -> last seen state string ('pre' | 'in' | 'post')
const seen = new Map()

const pickTeam = (comp, abbr) => comp.competitors.find(t => t.team.abbreviation === abbr)

// Messages use Telegram HTML parse mode so the result can be wrapped in a
// tap-to-reveal spoiler. Team names like "Texas A&M" need escaping.
const esc = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const spoiler = (str) => `<tg-spoiler>${str}</tg-spoiler>`

const rank = t => (t.curatedRank && t.curatedRank.current <= 25 ? `#${t.curatedRank.current} ` : '')

// Visible part: who played. Hidden part: the score and the outcome.
const finalMessage = (event) => {
  const comp = event.competitions[0]
  const home = comp.competitors.find(t => t.homeAway === 'home')
  const away = comp.competitors.find(t => t.homeAway === 'away')
  const matchup = `${rank(away)}${esc(away.team.displayName)} @ ${rank(home)}${esc(home.team.displayName)}`
  const hidden = [`${esc(away.team.shortDisplayName)} ${away.score} - ${esc(home.team.shortDisplayName)} ${home.score}`]
  let ours = false
  for (const abbr of FOLLOW) {
    const t = pickTeam(comp, abbr)
    if (!t) continue
    ours = true
    const cheer = CHEERS[abbr] || abbr
    const line = t.winner
      ? (WIN_LINES[abbr] || `${cheer}! ${t.team.shortDisplayName} win.`)
      : (LOSS_LINES[abbr] || `${t.team.shortDisplayName} lost. Rough one.`)
    hidden.push(esc(line))
  }
  for (const abbr of RIVALS) {
    const t = pickTeam(comp, abbr)
    if (!t) continue
    ours = true
    if (!t.winner) hidden.push(`${esc(t.team.displayName)} lost 😂 ${abbr} sucks`)
  }
  if (!ours) return null
  return `🏈 FINAL: ${matchup}\n${spoiler(hidden.join('\n'))}`
}

const fetchScoreboard = async () => {
  const res = await axios.get(SCOREBOARD_URL, { timeout: 15000 })
  return (res.data && res.data.events) || []
}

// Followed teams that won / lost this game, for the follow-up gif.
const winners = (event) => {
  const comp = event.competitions[0]
  return FOLLOW.filter(abbr => { const t = pickTeam(comp, abbr); return t && t.winner })
}
const losers = (event) => {
  const comp = event.competitions[0]
  return FOLLOW.filter(abbr => { const t = pickTeam(comp, abbr); return t && !t.winner })
}

// One poll. Returns the list of messages that should be sent.
// Each entry: { text, gifTeams }
const check = async () => {
  const events = await fetchScoreboard()
  const out = []
  for (const event of events) {
    const comp = event.competitions[0]
    const involved = comp.competitors.some(t => FOLLOW.includes(t.team.abbreviation) || RIVALS.includes(t.team.abbreviation))
    if (!involved) continue
    const state = comp.status.type.state // pre | in | post
    const prev = seen.get(event.id)
    seen.set(event.id, state)
    // Only announce a transition we witnessed, so a restart mid-Sunday
    // doesn't replay every final from Saturday.
    if (prev && prev !== 'post' && state === 'post') {
      const msg = finalMessage(event)
      if (msg) out.push({ text: msg, gifTeams: winners(event), lossTeams: losers(event) })
      if (onFinal) {
        for (const abbr of FOLLOW) {
          const t = pickTeam(comp, abbr)
          if (t) onFinal(event.id, abbr, !!t.winner, event.shortName)
        }
      }
    }
  }
  return out
}

// Poll fast while any followed game is live, slow otherwise.
const LIVE_INTERVAL = 60 * 1000
const IDLE_INTERVAL = 10 * 60 * 1000

// Optional hook so finals can be recorded (used by the year-end Wrapped).
let onFinal = null
const setOnFinal = (fn) => { onFinal = fn }
const start = (bot, chatId) => {
  let timer
  const tick = async () => {
    let interval = IDLE_INTERVAL
    try {
      const msgs = await check()
      for (const m of msgs) {
        await bot.sendMessage(chatId, m.text, { parse_mode: 'HTML' })
        for (const abbr of m.gifTeams) await sendWinGif(bot, chatId, abbr)
        for (const abbr of m.lossTeams) await sendLossGif(bot, chatId, abbr)
      }
      if ([...seen.values()].includes('in')) interval = LIVE_INTERVAL
    } catch (e) {
      console.error('score poll failed', e.message)
    }
    timer = setTimeout(tick, interval)
  }
  tick()
  return () => clearTimeout(timer)
}

// Post a celebration gif for a winning team. Sent as a spoiler-free
// follow-up, so it only goes out after the masked final. Skipped quietly
// when GIF_KEY isn't set or Tenor has nothing.
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)]

const sendWinGif = async (bot, chatId, abbr) => {
  const cfg = WIN_GIFS[abbr] || { search: [abbr] }
  const gif = cfg.slugs ? await getGifBySlug(pickRandom(cfg.slugs)) : await getGif(pickRandom(cfg.search))
  if (!gif) return false
  try {
    await bot.sendAnimation(chatId, gif, { has_spoiler: true })
    return true
  } catch (e) {
    console.error('win gif failed', e.message)
    return false
  }
}

const sendLossGif = async (bot, chatId, abbr) => {
  const pool = [...LOSS_GIFS_SHARED, ...(LOSS_GIFS_TEAM[abbr] || [])]
  const gif = await getGifBySlug(pickRandom(pool))
  if (!gif) return false
  try {
    await bot.sendAnimation(chatId, gif, { has_spoiler: true })
    return true
  } catch (e) {
    console.error('loss gif failed', e.message)
    return false
  }
}

// "bot scores": list every followed team's game on today's board with its state.
const todaySummary = async () => {
  const events = await fetchScoreboard()
  const lines = []
  for (const event of events) {
    const comp = event.competitions[0]
    if (!comp.competitors.some(t => FOLLOW.includes(t.team.abbreviation))) continue
    const st = comp.status.type
    const when = st.state === 'pre' ? st.shortDetail : st.state === 'in' ? `LIVE ${st.shortDetail}` : 'Final'
    lines.push(`${esc(event.shortName)} — ${esc(when)}`)
  }
  if (!lines.length) return `No games on the board for ${FOLLOW.join(', ')} right now.`
  return `Watching ${FOLLOW.join(', ')}. Polling every ${LIVE_INTERVAL / 1000}s during games.\n\n${lines.join('\n')}`
}

// "bot test final": a fake final so the spoiler formatting can be checked.
const sampleFinal = () => finalMessage({
  id: 'sample',
  competitions: [{
    status: { type: { state: 'post' } },
    competitors: [
      { team: { abbreviation: FOLLOW[0] || 'ALA', displayName: 'Alabama Crimson Tide', shortDisplayName: 'Crimson Tide' }, score: '31', homeAway: 'away', winner: true, curatedRank: { current: 3 } },
      { team: { abbreviation: 'UK', displayName: 'Kentucky Wildcats', shortDisplayName: 'Wildcats' }, score: '10', homeAway: 'home', winner: false, curatedRank: { current: 99 } },
    ],
  }],
})

module.exports = { start, check, finalMessage, setOnFinal, todaySummary, sampleFinal, sendWinGif, sendLossGif, FOLLOW, RIVALS }
