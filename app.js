const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { exec } = require('child_process');
const app = express();

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.render('index');
});

app.post('/search', async (req, res) => {
    const query = req.body.query.replace(' ', '+');
    const source = req.body.source;
  
    let searchUrl;
    if (source === 'monoschinos') {
      searchUrl = `https://monoschinos2.com/buscar?q=${query}`;
    } else if (source === 'latanime') {
      searchUrl = `https://latanime.org/buscar?q=${query}`;
    }
  
    try {
      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Cookie': 'cookies.txt',
        },
        timeout: 15000, // Establecer el tiempo de espera a 15 segundos
      });
  
      const $ = cheerio.load(response.data);
      const titles = [];
      const images = [];
  
      if (source === 'monoschinos') {
        $('.title_cap').each((index, element) => {
          titles.push($(element).text().trim());
          images.push($(element).find('img').attr('src')); // Aquí asume que hay un <img> dentro de .title_cap
        });
      } else if (source === 'latanime') {
        $('a[href^="https://latanime.org/anime/"]').each((index, element) => {
          const title = $(element).attr('href').replace('https://latanime.org/anime/', '').replace('/', '');
          titles.push(title);
          images.push($(element).find('img').attr('src')); // Aquí asume que hay un <img> dentro del <a>
        });
      }
  
      res.render('results', { titles, images, source });
    } catch (error) {
      console.error('Error:', error);
      res.send('Hubo un error al realizar la búsqueda.');
    }
  });
  

app.post('/episodes', async (req, res) => {
  const selectedTitle = req.body.selectedTitle;
  const source = req.body.source;
  console.log('Título seleccionado:', selectedTitle);
  
  const apiUrl = `https://api.jikan.moe/v4/anime?q=${selectedTitle}`;
  console.log('URL de la API:', apiUrl);

  const getEpisodesWithRetry = async (url, retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios.get(url, {
          timeout: 15000, // Establecer el tiempo de espera a 15 segundos
        });
        return response;
      } catch (error) {
        if (i === retries - 1) {
          throw error;
        }
        console.log(`Reintentando... (${i + 1})`);
      }
    }
  };

  try {
    const response = await getEpisodesWithRetry(apiUrl);
    console.log('Respuesta de la API:', response.data);
    
    const anime = response.data.data[0];
    console.log('Anime seleccionado:', anime);

    if (anime) {
      const episodesUrl = `https://api.jikan.moe/v4/anime/${anime.mal_id}/episodes`;
      console.log('URL de episodios:', episodesUrl);

      const episodesResponse = await getEpisodesWithRetry(episodesUrl);
      console.log('Respuesta de episodios:', episodesResponse.data);
      
      const episodes = episodesResponse.data.data;
      console.log('Episodios:', episodes);

      res.render('episodes', { title: selectedTitle, episodes, source });
    } else {
      res.send('No se encontraron episodios para el anime seleccionado.');
    }
  } catch (error) {
    console.error('Error:', error);
    res.send('Hubo un error al obtener los episodios.');
  }
});

app.post('/play', async (req, res) => {
    const { playOption, source, episodeNumber, selectedTitle } = req.body;
    console.log(`Source: ${source}, Título: ${selectedTitle}, Episodio: ${episodeNumber}`);
    
    let videoLink = '';
    let url = '';
    const formattedTitle = selectedTitle.toLowerCase().replace(/ /g, '-');
    console.log(`Título formateado: ${formattedTitle}`);
  
    if (source === 'monoschinos') {
      url = `https://monoschinos2.com/ver/${formattedTitle}-episodio-${episodeNumber}`;
    } else if (source === 'latanime') {
      url = `https://latanime.org/ver/${formattedTitle}-episodio-${episodeNumber}`;
    }
  
    try {
      console.log('Conectando al servidor...', url);
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
        timeout: 15000, // Establecer el tiempo de espera a 15 segundos
      });
  
      const $ = cheerio.load(response.data);
      let dataPlayer = $('*[data-player]').attr('data-player');
      console.log('data-player:', dataPlayer);
  
      if (dataPlayer) {
        const embedLink = Buffer.from(dataPlayer, 'base64').toString('utf-8');
        videoLink = await extractVideoLink(embedLink, url);
        console.log('videoLink:', videoLink);
      } else {
        console.error('data-player no encontrado.');
      }
  
      if (videoLink) {
        if (playOption === 'browser') {
          res.render('video', { episodeUrl: videoLink });
        } else if (playOption === 'mpv') {
          // Ejecutar mpv con el comando adecuado en Linux
          const command = `mpv "${videoLink}" --referrer="${url}"`;
          exec(command, (error, stdout, stderr) => {
            if (error) {
              console.error(`Error al ejecutar mpv: ${error.message}`);
              return res.send('Hubo un error al intentar reproducir el episodio.');
            }
            if (stderr) {
              console.error(`stderr: ${stderr}`);
            }
            console.log(`stdout: ${stdout}`);
            res.send(`Reproduciendo el episodio desde ${videoLink}...`);
          });
        }
      } else {
        res.send('Hubo un error al obtener el enlace de video.');
      }
    } catch (error) {
      console.error('Error:', error);
      res.send('Hubo un error al obtener el enlace de video.');
    }
  });
  

  const extractVideoLink = async (embedLink, originalUrl) => {
    let videoLink = '';
    let response, $, dataPlayer, embedLinkProcessed;
  
    try {
      // Intento con mp4upload
      response = await axios.get(embedLink, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
        timeout: 15000, // Establecer el tiempo de espera a 15 segundos
      });
      $ = cheerio.load(response.data);
      videoLink = $('video source').attr('src');
      console.log('Intento con mp4upload, videoLink:', videoLink);
  
      // Upload Extractor
      if (!videoLink) {
        console.log('El servidor mp4upload falló.');
        console.log('Probando con el servidor upload...');
        response = await axios.get(originalUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0',
          },
          timeout: 15000, // Establecer el tiempo de espera a 15 segundos
        });
        $ = cheerio.load(response.data);
        dataPlayer = $('*[data-player]').attr('data-player');
        embedLinkProcessed = Buffer.from(dataPlayer, 'base64').toString('utf-8').replace(/\.com|\.co/, '.io');
        response = await axios.get(embedLinkProcessed, {
          headers: {
            'User-Agent': 'Mozilla/5.0',
          },
          timeout: 15000, // Establecer el tiempo de espera a 15 segundos
        });
        $ = cheerio.load(response.data);
        videoLink = $('video source').attr('src');
        console.log('Intento con upload, videoLink:', videoLink);
      }
  
      // Ok.ru extractor
      if (!videoLink) {
        console.log('El servidor upload falló.');
        console.log('Probando con el servidor Ok.RU...');
        response = await axios.get(originalUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0',
          },
          timeout: 15000, // Establecer el tiempo de espera a 15 segundos
        });
        $ = cheerio.load(response.data);
        dataPlayer = $('*[data-player]').attr('data-player');
        embedLinkProcessed = Buffer.from(dataPlayer, 'base64').toString('utf-8');
        videoLink = embedLinkProcessed;
        console.log('Intento con Ok.RU, videoLink:', videoLink);
      }
  
      // Voe extractor
      if (!videoLink) {
        console.log('El servidor Ok.RU falló.');
        console.log('Probando con el servidor Voe...');
        response = await axios.get(originalUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0',
          },
          timeout: 15000, // Establecer el tiempo de espera a 15 segundos
        });
        $ = cheerio.load(response.data);
        dataPlayer = $('*[data-player]').attr('data-player');
        embedLinkProcessed = Buffer.from(dataPlayer, 'base64').toString('utf-8');
        const id = embedLinkProcessed.split('/e/')[1];
        response = await axios.get(`https://robertplacespace.com/${id}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0',
          },
          timeout: 15000, // Establecer el tiempo de espera a 15 segundos
        });
        $ = cheerio.load(response.data);
        videoLink = $('video source').attr('src');
        console.log('Intento con Voe, videoLink:', videoLink);
      }
  
      return videoLink;
    } catch (error) {
      console.error('Error al extraer el enlace de video:', error);
      return '';
    }
  };
  
  
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
