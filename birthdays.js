// Birthday greetings. The dates live in a private JSON file (gitignored, on the
// Fly volume in production), never in the repo. Format:
//   [ { "name": "Sam", "date": "07-04", "group": "core", "year": 2015 }, ... ]
// "group" is "core" or "kids" (default kids). "year" is optional (adds "turns N"); "msg" optionally replaces the greeting.
const path = require('path')
const fs = require('fs')
const axios = require('axios')
const { getGif } = require('./api')

const BIRTHDAYS_PATH = process.env.BIRTHDAYS_PATH ||
  path.join(path.dirname(process.env.DB_PATH || path.join(__dirname, 'data', 'bot.sqlite')), 'birthdays.json')

// Re-read on every call so edits to the file don't need a restart.
const load = () => {
  try {
    return JSON.parse(fs.readFileSync(BIRTHDAYS_PATH, 'utf8'))
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('birthdays: could not read', BIRTHDAYS_PATH, e.message)
    return []
  }
}

// Today's month/day/year as seen in the schedule timezone (Fly runs in UTC).
const todayIn = (tz, now = new Date()) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now).map(p => [p.type, p.value])
  )
  return { md: `${parts.month}-${parts.day}`, month: parts.month, day: parts.day, year: Number(parts.year) }
}

const birthdaysOn = (md) => load().filter(b => b.date === md)

const findByName = (name) => load().find(b => b.name.toLowerCase() === name.toLowerCase())

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Keep it cheerful: this goes in a group chat on a kid's birthday. An event
// must read like good news (POSITIVE) and avoid anything grim (GRIM).
const GRIM = /\b(murder|kill|slain|slaughter|massacr|assassinat|execut|shot|shoot|bomb|explo|attack|invasion|invade|invad|war\b|wars\b|warfare|battle|siege|genocide|holocaust|terror|hostage|kidnap|abduct|suicide|torture|rape|crash|sink|sank|sunk|torpedo|disaster|famine|plague|epidemic|pandemic|earthquake|tsunami|hurricane|tornado|fire|die|died|dead|death|crime|prison|imprison|arrest|convict|coup|rebel|revolt|nazi|fascis|slave|slavery|lynch|hang|militant|militia|commando|overthrow|dictator|regime|troops|army|military|soldier|navy|naval|fleet|forces|police|protest|strike|islamic state|isis|taliban|extremist|insurgen|guerrilla|resist|occupation|occupy|surrender|outbreak|virus|disease|fatal|victim|wound|injur|missile|nuclear|weapon|gun|bullet|ambush|raid|cannibal|spill|flood|trapped|stormed|depose|oppress|racis|segregat|assault|crisis|conflict|hardship|scandal|corrupt|discredit|resign|sentence|abuse|slum|demolition|demolish|destroy|collapse|poison|toxic|pollut|eruption|erupt|wildfire|burn|worst|prevent|national guard|deployed|protectorate|white american|colony|colonial|settlers)/i
const POSITIVE = /\b(first|invent|discover|launch|opened|opens|released|premiere|debut|founded|established|unveil|inaugurat|completed|record|champion|olympic|won|album|film|novel|published|flight|flew|landed|spacecraft|space|telescope|patent|introduced|created|built|bridge|tower|museum|university|tournament|world cup|concert|opera|symphony|computer|internet|robot|electric|arrived|reached|summit|expedition|coaster|stadium|theme park|invention|medal|prize|award|astronaut|moon|satellite|rocket|planet|asteroid|comet|animal|zoo|aquarium|library|school|game|sport|baseball|football|basketball|hockey|soccer|golf|tennis|cricket|boxing|race|marathon|theatre|theater|painting|artist|composer|sings|singer|band|show|cartoon|toy|candy|food|restaurant|chocolate|ice cream|pizza)/i

const cheerful = (e) => e.text && e.year && POSITIVE.test(e.text) && !GRIM.test(e.text)

// Cheerful events per calendar date, cached so Wikipedia is hit once per date.
const pools = new Map()
const eventPool = async (month, day) => {
  const key = `${month}-${day}`
  if (pools.has(key)) return pools.get(key)
  const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/${month}/${day}`
  let data
  for (let attempt = 0; attempt < 2 && !data; attempt++) {
    try {
      ({ data } = await axios.get(url, { headers: { 'User-Agent': 'dad-chat-bot/1.0 (birthday fun facts)' }, timeout: 15000 }))
    } catch (e) { console.error('wikipedia attempt failed', attempt + 1, e.message) }
  }
  if (!data) return []   // not cached, so the next call can try again
  const selected = (data.selected || []).filter(cheerful)
  const pool = selected.length ? selected : (data.events || []).filter(cheerful)
  pools.set(key, pool)
  return pool
}

const historicalEvent = async (month, day) => {
  const pool = await eventPool(month, day)
  if (!pool.length) return null
  const e = pool[Math.floor(Math.random() * pool.length)]
  const text = e.text.replace(/\s*\((?:[^)]*\b(?:pictured|depicted|shown|illustrated)\b[^)]*)\)/gi, '').trim()
  return `On ${MONTHS[Number(month) - 1]} ${Number(day)}, ${e.year}: ${text}`
}

// Never fall back to an unrelated fact: no fact beats a random one.
const funFact = async (month, day) => {
  const fact = await historicalEvent(month, day)
  return fact ? `Fun fact: ${fact}` : null
}

const TZ = process.env.SCHEDULE_TZ || process.env.WRAPPED_TZ || 'America/Denver'
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)]

const GREETINGS = [
  (n) => `🎂 Happy Birthday ${n}!`,
  (n) => `🎉 It's ${n}'s birthday! Happy Birthday!`,
  (n) => `🥳 Happy Birthday, ${n}!`,
  (n) => `🎈 Today is ${n}'s big day. Happy Birthday!`,
]
const GIF_SEARCHES = ['happy birthday', 'birthday party', 'birthday cake', 'birthday celebration', 'happy birthday dance']

const buildMessage = async (b, year) => {
  const [month, day] = b.date.split('-')
  const age = b.year ? ` Turning ${year - b.year} today.` : ''
  const greeting = b.msg || pickRandom(GREETINGS)(b.name) + age
  const fact = await funFact(month, day)
  const parts = [greeting]
  if (fact) parts.push(fact)
  return parts.join('\n\n')
}

// Message, then a random birthday gif (skipped quietly if gifs are unavailable).
const sendBirthday = async (bot, chatId, b, year) => {
  await bot.sendMessage(chatId, await buildMessage(b, year))
  if (b.msg) return
  const gif = await getGif(pickRandom(GIF_SEARCHES))
  if (!gif) return
  try { await bot.sendAnimation(chatId, gif) } catch (e) { console.error('birthday gif failed', e.message) }
}

// Send today's birthday messages. Each entry has a "group" ("core" or "kids",
// default "kids") that picks its route from routes: { kids: { bot, chatId }, ... }.
// A route is used as-is: there is no fallback to another bot or chat.
const postToday = async (routes, tz = TZ) => {
  const { md, year } = todayIn(tz)
  for (const b of birthdaysOn(md)) {
    const group = b.group || 'kids'
    const route = routes[group]
    if (!route || !route.bot || !route.chatId) { console.error('birthday skipped, group not configured:', group, b.name); continue }
    try { await sendBirthday(route.bot, route.chatId, b, year) } catch (e) { console.error('birthday post failed', b.name, e.message) }
  }
}

module.exports = { postToday, sendBirthday, buildMessage, findByName, todayIn, BIRTHDAYS_PATH }
