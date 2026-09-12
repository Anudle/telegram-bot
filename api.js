const GIF_URL =  `https://g.tenor.com/v2/search?key=${process.env.GIF_KEY}`

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

const getGif = async (searchTerm) => {
  if (!process.env.GIF_KEY) return null
  try {
    const response = await axios.get(`${GIF_URL}&q=${encodeURIComponent(searchTerm)}&media_filter=gif&limit=20`, { timeout: 10000 })
    const results = response.data && response.data.results
    if (results && results.length) {
      const pick = results[getRandomInt(results.length)]
      return (pick.media_formats && pick.media_formats.gif && pick.media_formats.gif.url) || pick.url
    }
  } catch (e) {
    console.error('gif lookup failed', e.message)
  }
  return null
}

module.exports = {
  getRandomPhoto,
  getGif,
  getTextOnPhoto,
  kylesAPI
}

