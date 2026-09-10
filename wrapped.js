// Year-end "Wrapped" for a chat, built from the message log in db.js.
const { db } = require('./db')

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const TZ = process.env.WRAPPED_TZ || 'America/Denver'

const STOP = new Set(`the a an and or but if then so to of in on at for with from by as is are was were be been being it its this that these those i im me my we our you your u ur he she they them his her their what which who whom when where why how not no yes do does did done have has had can could would should will just like get got go going gonna one all any some more most very really about out up down over into than too also there here dont cant wont didnt isnt thats youre ive youve lol lmao haha hahaha ok okay yeah yea nah oh ah hey hi yo`.split(/\s+/))

const emojiRe = /\p{Extended_Pictographic}/gu

// Phrases worth counting per chat. Extend via WRAPPED_PHRASES="roll tide,go blue"
const PHRASES = (process.env.WRAPPED_PHRASES || 'roll tide,go blue,sko buffs,fun fact,bot quote')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

const range = (year) => {
  const from = Math.floor(Date.UTC(year, 0, 1) / 1000)
  const to = Math.floor(Date.UTC(year + 1, 0, 1) / 1000)
  return { from, to }
}

const localParts = (ts) => {
  const d = new Date(ts * 1000)
  const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false, weekday: 'long', month: 'numeric', day: 'numeric', year: 'numeric' })
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]))
  return { hour: Number(p.hour) % 24, month: Number(p.month) - 1, day: Number(p.day), year: Number(p.year), weekday: p.weekday, dateKey: `${p.year}-${p.month}-${p.day}` }
}

// Ignore months that haven't happened yet when running mid-year.
const quietestMonth = (months, year) => {
  const now = localParts(Math.floor(Date.now() / 1000))
  const last = year < now.year ? 11 : now.month
  let idx = 0
  for (let i = 1; i <= last; i++) if (months[i] < months[idx]) idx = i
  return idx
}

const computeStats = (chatId, year) => {
  const { from, to } = range(year)
  const rows = db.prepare(`SELECT user_id, first_name, ts, kind, text, reply_to_user_id FROM messages WHERE chat_id = ? AND ts >= ? AND ts < ? ORDER BY ts`).all(chatId, from, to)
  if (!rows.length) return null

  const byUser = new Map()
  const user = (id, name) => {
    if (!byUser.has(id)) byUser.set(id, { name, msgs: 0, chars: 0, gifs: 0, stickers: 0, photos: 0, night: 0, early: 0, repliesGot: 0, emoji: 0, longest: 0, phrases: {} })
    const u = byUser.get(id); if (name) u.name = name; return u
  }
  const months = new Array(12).fill(0), hours = new Array(24).fill(0), weekdays = {}
  const words = new Map(), emojis = new Map(), days = new Set(), phraseCounts = {}
  let media = 0

  for (const r of rows) {
    const u = user(r.user_id, r.first_name)
    const p = localParts(r.ts)
    u.msgs++; months[p.month]++; hours[p.hour]++; weekdays[p.weekday] = (weekdays[p.weekday] || 0) + 1; days.add(p.dateKey)
    if (p.hour < 5) u.night++
    if (p.hour >= 5 && p.hour < 8) u.early++
    if (r.kind === 'gif') u.gifs++
    if (r.kind === 'sticker') u.stickers++
    if (r.kind === 'photo' || r.kind === 'video') u.photos++
    if (r.kind !== 'text') media++
    if (r.reply_to_user_id) user(r.reply_to_user_id, null).repliesGot++
    if (r.text) {
      u.chars += r.text.length
      if (r.text.length > u.longest) u.longest = r.text.length
      const lower = r.text.toLowerCase()
      for (const ph of PHRASES) {
        if (lower.includes(ph)) { phraseCounts[ph] = (phraseCounts[ph] || 0) + 1; u.phrases[ph] = (u.phrases[ph] || 0) + 1 }
      }
      for (const w of lower.replace(/https?:\/\/\S+/g, '').match(/[a-z']{3,}/g) || []) {
        if (!STOP.has(w)) words.set(w, (words.get(w) || 0) + 1)
      }
      for (const e of r.text.match(emojiRe) || []) { emojis.set(e, (emojis.get(e) || 0) + 1); u.emoji++ }
    }
  }

  // longest streak of consecutive days with at least one message
  const sorted = [...days].map(k => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d) }).sort((a, b) => a - b)
  let streak = 0, best = 0, prev = null
  for (const d of sorted) { streak = prev !== null && d - prev === 86400000 ? streak + 1 : 1; best = Math.max(best, streak); prev = d }

  const top = (arr, n = 3) => [...arr].sort((a, b) => b[1] - a[1]).slice(0, n)
  const users = [...byUser.values()].filter(u => u.msgs > 0)
  const maxBy = (key) => users.reduce((a, b) => (b[key] > (a?.[key] ?? 0) ? b : a), null)
  const maxUser = maxBy('msgs')

  const finals = db.prepare(`SELECT team, SUM(won) AS w, COUNT(*) - SUM(won) AS l FROM finals WHERE chat_id = ? AND ts >= ? AND ts < ? GROUP BY team`).all(chatId, from, to)

  return {
    year, total: rows.length, media, activeDays: days.size, streak: best,
    busiestMonth: months.indexOf(Math.max(...months)),
    quietestMonth: quietestMonth(months, year),
    busiestHour: hours.indexOf(Math.max(...hours)),
    busiestWeekday: Object.entries(weekdays).sort((a, b) => b[1] - a[1])[0]?.[0],
    topUsers: users.sort((a, b) => b.msgs - a.msgs).slice(0, 5),
    yapper: maxUser,
    novelist: maxBy('longest'), nightOwl: maxBy('night'), earlyBird: maxBy('early'),
    gifLord: maxBy('gifs'), stickerGuy: maxBy('stickers'), photographer: maxBy('photos'),
    mostReplied: maxBy('repliesGot'), emojiGuy: maxBy('emoji'),
    topWords: top(words, 5), topEmoji: top(emojis, 5),
    phrases: Object.entries(phraseCounts).sort((a, b) => b[1] - a[1]),
    phraseLeaders: Object.fromEntries(PHRASES.map(ph => [ph, users.filter(u => u.phrases[ph]).sort((a, b) => b.phrases[ph] - a.phrases[ph])[0]]).filter(([, u]) => u)),
    finals,
  }
}

const fmtHour = (h) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`
const award = (label, u, detail) => (u && detail(u) ? `• ${label}: <b>${esc(u.name)}</b> (${detail(u)})` : null)

// Returns an array of HTML "slides", one message each.
const renderSlides = (stats, chatTitle) => {
  if (!stats) return [`Nothing logged for this chat in ${new Date().getFullYear()} yet. Wrapped needs the bot to have seen some messages first.`]
  const s = stats
  const slides = []

  slides.push(`🎁 <b>${esc(chatTitle || 'This chat')} Wrapped ${s.year}</b>\n\nYou sent <b>${s.total.toLocaleString()}</b> messages across <b>${s.activeDays}</b> days.\nLongest streak: <b>${s.streak}</b> days in a row without shutting up.`)

  slides.push(`📅 <b>When you talk</b>\n\nBusiest month: <b>${MONTHS[s.busiestMonth]}</b>\nQuietest month: <b>${MONTHS[s.quietestMonth]}</b>\nFavorite day: <b>${s.busiestWeekday}</b>\nPeak hour: <b>${fmtHour(s.busiestHour)}</b>`)

  const podium = ['🥇', '🥈', '🥉', '4.', '5.']
  slides.push(`🗣 <b>Top yappers</b>\n\n${s.topUsers.map((u, i) => `${podium[i]} ${esc(u.name)} — ${u.msgs.toLocaleString()} messages`).join('\n')}`)

  const awards = [
    award('Night owl 🦉', s.nightOwl, u => u.night && `${u.night} messages after midnight`),
    award('Early bird 🌅', s.earlyBird, u => u.early && `${u.early} messages before 8am`),
    award('The novelist 📚', s.novelist, u => u.longest && `longest message: ${u.longest} characters`),
    award('GIF lord 🎬', s.gifLord, u => u.gifs && `${u.gifs} gifs`),
    award('Sticker guy 🩹', s.stickerGuy, u => u.stickers && `${u.stickers} stickers`),
    award('Family photographer 📸', s.photographer, u => u.photos && `${u.photos} photos and videos`),
    award('Most replied to 💬', s.mostReplied, u => u.repliesGot && `${u.repliesGot} replies`),
    award('Emoji enjoyer 😂', s.emojiGuy, u => u.emoji && `${u.emoji} emoji`),
  ].filter(Boolean)
  if (awards.length) slides.push(`🏆 <b>Awards</b>\n\n${awards.join('\n')}`)

  const vocab = []
  if (s.topWords.length) vocab.push(`Top words: ${s.topWords.map(([w, n]) => `<b>${esc(w)}</b> (${n})`).join(', ')}`)
  if (s.topEmoji.length) vocab.push(`Top emoji: ${s.topEmoji.map(([e, n]) => `${e} ${n}`).join('  ')}`)
  if (s.phrases.length) vocab.push(`Catchphrases: ${s.phrases.map(([p, n]) => `<b>${esc(p)}</b> ×${n}${s.phraseLeaders[p] ? ` (mostly ${esc(s.phraseLeaders[p].name)})` : ''}`).join(', ')}`)
  if (vocab.length) slides.push(`🔤 <b>Vocabulary</b>\n\n${vocab.join('\n')}`)

  if (s.finals.length) {
    slides.push(`🏈 <b>Season records</b>\n\n${s.finals.map(f => `${esc(f.team)}: <b>${f.w}-${f.l}</b>`).join('\n')}`)
  }

  slides.push(`That's a wrap on ${s.year}. See you next year, same group chat. 🫡`)
  return slides
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Post a full Wrapped to one chat, one slide at a time like the real thing.
const postWrapped = async (bot, chatId, chatTitle, year = new Date().getFullYear()) => {
  const slides = renderSlides(computeStats(chatId, year), chatTitle)
  for (const slide of slides) {
    await bot.sendMessage(chatId, slide, { parse_mode: 'HTML' })
    await sleep(2500)
  }
}

module.exports = { computeStats, renderSlides, postWrapped }
