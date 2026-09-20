
require('dotenv').config();
const axios = require("axios");
const { getRandomInt } = require('./util')

const getRandomPhoto = async () => {
  const UNSPLASH_URL = `https://api.unsplash.com/photos/random?client_id=${process.env.UNSPLASH_KEY}`
  let photo
  try {
      const response = await axios.get(UNSPLASH_URL)
      console.log(response.data)
      photo = response.data && response.data.urls && response.data.urls.regular
      console.log(photo)
  } catch(e) {
      console.error(e)
  }
  return photo 
}

const kylesAPI = async (text, author) => {
  let quotezURL
  if (author) {
    quotezURL = `http://quote.heliumlink.io/quotez?auth=NiVZfG1yvThe9nhR0YxurQ&quote=${encodeURIComponent(text)}&author=${author}`
  } else {
    quotezURL = `http://quote.heliumlink.io/quotez?auth=NiVZfG1yvThe9nhR0YxurQ&quote=${encodeURIComponent(text)}`
  }
  console.log({quotezURL})
  let response
  try {
    response = await axios.get(quotezURL, {}, {
      headers: {
      'auth': process.env.KYLES_KEY
      }
    })
  } catch (e) {
    console.error(e)
  }
  console.log(response)
  if (response.data && response.data.status === 'ok') {
    return response.data.result
  }
}

const getTextOnPhoto = async (text, photo) => {
  let textOverPictureURL = `https://textoverimage.moesif.com/image?image_url=${encodeURIComponent(photo)}&overlay_color=00000042&text=${encodeURIComponent(text)}&text_size=128&margin=50&y_align=middle&x_align=center`
  return textOverPictureURL
}

// GIF search via Klipy (Tenor's API shut down June 2026; Klipy is the
// drop-in successor). Key from https://partner.klipy.com/api-keys.
const KLIPY_KEY = process.env.KLIPY_KEY || process.env.GIF_KEY

const getGif = async (searchTerm) => {
  if (!KLIPY_KEY) return null
  try {
    const url = `https://api.klipy.com/api/v1/${KLIPY_KEY}/gifs/search?q=${encodeURIComponent(searchTerm)}&per_page=20&content_filter=medium`
    const response = await axios.get(url, { timeout: 10000 })
    const results = response.data && response.data.result && response.data.data && response.data.data.data
    if (results && results.length) {
      const pick = results[getRandomInt(results.length)]
      const f = pick.file || {}
      // mp4 is ~30x smaller than the gif and Telegram plays it as an animation
      const media = (f.md && f.md.mp4) || (f.md && f.md.gif) || (f.hd && f.hd.gif) || (f.sm && f.sm.gif)
      return media && media.url
    }
  } catch (e) {
    console.error('gif lookup failed', e.response ? JSON.stringify(e.response.data) : e.message)
  }
  return null
}

// Fetch a specific gif by Klipy slug (for curated, hand-picked sets).
const getGifBySlug = async (slug) => {
  if (!KLIPY_KEY) return null
  try {
    const url = `https://api.klipy.com/api/v1/${KLIPY_KEY}/gifs/items?slugs=${encodeURIComponent(slug)}`
    const response = await axios.get(url, { timeout: 10000 })
    const list = response.data && response.data.data && (Array.isArray(response.data.data) ? response.data.data : response.data.data.data)
    const pick = list && list[0]
    const f = (pick && pick.file) || {}
    const media = (f.md && f.md.mp4) || (f.md && f.md.gif) || (f.hd && f.hd.gif) || (f.sm && f.sm.gif)
    return media && media.url
  } catch (e) {
    console.error('gif slug lookup failed', e.response ? JSON.stringify(e.response.data) : e.message)
  }
  return null
}

module.exports = {
  getGifBySlug,
  getRandomPhoto,
  getGif,
  getTextOnPhoto,
  kylesAPI
}

