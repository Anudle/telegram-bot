const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const axios = require("axios");
const FACT_URL = 'https://uselessfacts.jsph.pl/random.json?language=en'
const STOCK_URL = 'https://finnhub.io/api/v1/'
const token = process.env.TOKEN;
// Two groups: birthdays go to the dad chat, live scores to the football chat.
// OUR_CHAT_ID is kept as a fallback so the old single-chat .env still works.
const dadChat = process.env.DAD_CHAT_ID || process.env.OUR_CHAT_ID
const footballChat = process.env.FOOTBALL_CHAT_ID || process.env.OUR_CHAT_ID
const express = require('express')
const { kylesAPI, getGif, getRandomPhoto, getTextOnPhoto} = require('./api')
const { getRandomInt, ucfirst, findString, isToday } = require('./util');
const schedule = require('node-schedule');
const scores = require('./scores');
const { logMessage, logFinal, chatsWithMessages } = require('./db');
const { postWrapped } = require('./wrapped');



// Each group can have its own bot identity (e.g. @kids_birthday_bot in the
// dad chat, @final_score_bot in the football chat). Create each in BotFather
// and drop the tokens in .env. Every bot receives updates from the groups it
// is in so the message log (and the year-end Wrapped) covers every chat.
const app = express();
app.use(express.json());

const makeBot = (t) => {
  let b
  // Webhook mode only when a public URL is configured; otherwise long-poll,
  // which works on any host with no inbound port.
  if (process.env.WEBHOOK_URL) {
    b = new TelegramBot(t);
    b.setWebHook(process.env.WEBHOOK_URL + "/" + t);
    app.post('/' + t, (req, res) => { b.processUpdate(req.body); res.sendStatus(200); });
  } else {
    b = new TelegramBot(t, { polling: true });
  }
  b.on('message', (msg) => { try { logMessage(msg) } catch (e) { console.error('log failed', e.message) } })
  return b
}

const bot = makeBot(token)
const birthdayBot = process.env.BIRTHDAY_BOT_TOKEN && process.env.BIRTHDAY_BOT_TOKEN !== token ? makeBot(process.env.BIRTHDAY_BOT_TOKEN) : bot
const scoreBot = process.env.SCORE_BOT_TOKEN && process.env.SCORE_BOT_TOKEN !== token ? makeBot(process.env.SCORE_BOT_TOKEN) : bot
const allBots = [...new Set([bot, birthdayBot, scoreBot])]

// "bot wrapped" in any group posts that group's Wrapped on demand.
// "bot wrapped 2025" does a past year.
for (const b of allBots) {
  b.on('text', async (msg) => {
    const text = msg.text.toLowerCase().trim()
    try {
      // "bot wrapped" / "bot wrapped 2025"
      const m = text.match(/^bot wrapped(?:\s+(\d{4}))?$/)
      if (m) {
        const year = m[1] ? Number(m[1]) : new Date().getFullYear()
        return await postWrapped(b, msg.chat.id, msg.chat.title, year)
      }
      // setup + testing helpers
      if (text === '/chatid' || text === 'bot chatid') {
        return await b.sendMessage(msg.chat.id, `chat id: <code>${msg.chat.id}</code>`, { parse_mode: 'HTML' })
      }
      if (text === 'bot scores') {
        return await b.sendMessage(msg.chat.id, await scores.todaySummary(), { parse_mode: 'HTML' })
      }
      if (text === 'bot test final') {
        await b.sendMessage(msg.chat.id, scores.sampleFinal(), { parse_mode: 'HTML' })
        const sent = await scores.sendWinGif(b, msg.chat.id, scores.FOLLOW[0])
        if (!sent) await b.sendMessage(msg.chat.id, process.env.KLIPY_KEY ? 'no gif found' : 'no gif: KLIPY_KEY not set')
        return
      }
      // "bot test gif csu" / "bot test gif csu loss"
      const g = text.match(/^bot test gif (\w+)( loss)?$/)
      if (g) {
        const fn = g[2] ? scores.sendLossGif : scores.sendWinGif
        const sent = await fn(b, msg.chat.id, g[1].toUpperCase())
        if (!sent) await b.sendMessage(msg.chat.id, process.env.KLIPY_KEY ? 'no gif found' : 'no gif: KLIPY_KEY not set')
        return
      }
    } catch (e) { console.error('command failed', e) }
  })
}

// Dec 31 at 10:00: post a Wrapped to every chat that had messages this year.
schedule.scheduleJob('0 10 31 12 *', async () => {
  const year = new Date().getFullYear()
  const from = Math.floor(Date.UTC(year, 0, 1) / 1000), to = Math.floor(Date.UTC(year + 1, 0, 1) / 1000)
  for (const { chat_id, title } of chatsWithMessages(from, to)) {
    // pick whichever bot is a member of this chat; sendMessage from a
    // non-member fails, so try each until one works
    for (const b of allBots) {
      try { await postWrapped(b, chat_id, title, year); break } catch (e) { /* try next bot */ }
    }
  }
});

const brock_bets = [' bet ', 'betting']
const gif_trigger = ['roll tide', 'rtr', 'go blue', 'sko buffs', 'denver lynx']
const insult_trigger = ['ohio state', 'the sun', 'auburn', 'lsu']
const insult_search = ['shit', 'sucks', 'chump', 'loser', 'stupid']
const david_compliments = ['Roll tide my dude', 'you make a good point', "God you're so handsome David", 'Auburn is the worst', 'Can ABC just make you in charge of Disney already', 'How do you walk around with such a huge package David?']
const dates =  [
  { date: '2011-03-14T10:00:00Z', msg: 'Happy Pi Day!' },
  { date: '2011-04-15T10:00:00Z', msg: 'Happy Birthday Anu!'},
  { date: '2011-09-03T10:00:00Z', msg: 'Happy Birthday Lucas B!'},
  { date: '2011-03-23T10:00:00Z', msg: 'Happy Birthday Brock!'},
  { date: '2011-03-26T10:00:00Z', msg: 'Happy Birthday David!'},
  { date: '2011-06-30T10:00:00Z', msg: 'Happy Birthday KB!'},
  { date: '2011-07-05T10:00:00Z', msg: 'Happy Birthday Matt!'},
  { date: '2011-12-15T10:00:00Z', msg: 'Happy Birthday Lucas C!'}
]

const job = schedule.scheduleJob('15 11 * * *', function(){
  const today = new Date();
  for(let i=0; i<dates.length; i++) {
    let d = new Date(dates[i].date)
    if (isToday(d))  {
      if (dadChat) birthdayBot.sendMessage(dadChat, dates[i].msg)
    }
  }
});

if (footballChat) {
  scores.setOnFinal((eventId, team, won, summary) => logFinal(footballChat, eventId, team, won, summary))
  scores.start(scoreBot, footballChat)
}

bot.on('text', async (ctx) => {
  const chat_id = ctx.chat.id
  const string = ctx.text.toLowerCase()
  const name = ctx.from.first_name.toLowerCase()
  // if (name === 'david') {
  //   const randomNumber = getRandomInt(20)
  //   if (randomNumber === 5) {
  //     const index = getRandomInt(6)
  //     bot.sendMessage(chat_id, david_compliments[index])
  //   }
  // }
  if (name  === 'brock') {
    if (brock_bets.some(word => string.includes(word))) {
      bot.sendMessage(chat_id, "'Nahhhhh' -Lucas Brandl")
    }
    const randomNumber = getRandomInt(40)
    // if (randomNumber === 7) {
    //   bot.sendMessage("is that your actual opinion or are you just making a bad faith argument because it’s 'provocative'?")
    // }
  }
  if (insult_trigger.some(word => string.includes(word))) {
    let randomSearch = insult_search[getRandomInt(insult_search.length - 1)]
    let response = await getGif(randomSearch)
    const insult_name = insult_trigger.filter(word => {
      if (string.includes(word)) {
        return word
      }
    })
    if (response.includes('.gif')) {
      bot.sendDocument(chat_id, response);
      if (insult_name[0] !== 'csu') {
        bot.sendMessage(chat_id, `${insult_name[0].toUpperCase()} sucks`)
      }  
    }
  }
  if (gif_trigger.some(word => string.includes(word))) {
    const searchWord = gif_trigger.filter(word => {
      if (string.includes(word)) {
        return word
      }
    })
    if (searchWord.includes('sko buffs')) {
      searchWord.unshift('colorado buffs')
    }
    let response = await getGif(searchWord[0])
    if (response.includes('.gif')) {
      bot.sendDocument(chat_id, response);
    }
  }
  if (string.includes('evolve') || string.includes('evolution')) {
    let response = await getGif('pokemon evolve')
    if (response.includes('.gif')) {
      bot.sendDocument(chat_id, response);
    }
  }
  if (string.includes('roll tide')) {
    bot.sendMessage(chat_id, 'Roll Tide')
  }
  if (string.includes('go blue')) {
    bot.sendMessage(chat_id, 'Go Blue')
  }
  if (string.includes('sko buffs')) {
    bot.sendMessage(chat_id, 'Sko Buffs')
  }
  if (string.includes('csu')) {
    bot.sendMessage(chat_id, 'whoever went to CSU around here is better than everyone else. thank you')
  }
  const trigger = 'bot quote'
  if (string.includes(trigger)) {
  let quote = string.slice(string.indexOf(trigger) + trigger.length).trim();
  let arraySentence = quote.split(' ')
  let author = arraySentence[0]
  arraySentence.shift()
  quote = arraySentence.join(' ')
  if (author === 'this') {
    author = null
  } else if (author === 'me') {
    author = name
  }
  console.log({quote})
  console.log({author})
  try {
  const finalPhoto = await kylesAPI(quote, author)
  console.log(finalPhoto)
    bot.sendPhoto(chat_id, finalPhoto)
	//bot.sendMessage(chat_id, `'${author}' says '${quote}'... the pic thing  is under construction. check back l8r`);
  }catch(e) {
    console.error(e)
  }
  }
  
  if (string.includes('$')) {
    let symbol = await findString(string, '$')
    if (symbol) {
      if (symbol.length > 6) {
        bot.sendMessage(chat_id, `Don't abuse the bot ${ucfirst(name)}`)
        return
      } else {
        symbol = symbol.toUpperCase()
        try {
          const stockURL = `${STOCK_URL}quote?symbol=${symbol}&token=${process.env.STOCK_TOKEN}`
          const response = await axios.get(stockURL)
          if (response.data && response.data.c) {
            bot.sendMessage(chat_id, `${symbol} last price was $${response.data.c}`)
          }
        } catch(e) {
          bot.sendMessage(chat_id, `shits broken: ${e}`)
          console.log(e)
        }
      }
    }
  }
  
  if (string.includes('make zoom poll')){
    bot.sendMessage(chat_id, 'Beep Boop. Okay for what time?', { "reply_markup": {
        "inline_keyboard": [
          [
            {
              text: "Wednesday",
              callback_data: "wed",
            },
            {
              text: "Thursday",
              callback_data: "thursday",
            },
            {
              text: "Friday",
              callback_data: "friday",
            },
            {
              text: "Saturday",
              callback_data: "saturday",
            },
          ],
        ],
      }
    })
  }

  if (string.includes('fun fact')) {
    try {
      const response = await axios.get(FACT_URL)
      if (response.data && response.data.text) { 
        bot.sendMessage(chat_id, response.data.text)
      }
    } catch(e){
      bot.sendMessage(chat_id, "Not today I'm broken")
    }
  }
})

bot.on('callback_query', (callbackQuery) => {
  // console.log('callback query', callbackQuery)
  const msg = callbackQuery.message;
  bot.answerCallbackQuery(callbackQuery.id)
      .then(() => bot.sendMessage(msg.chat.id, "You clicked!"));
});

if (process.env.WEBHOOK_URL) app.listen(process.env.PORT || 3000);
