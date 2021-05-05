require('dotenv').config();
const path = require('path');
const {readdir} = require('fs/promises');
const express = require('express');
const app = express();

const PORT = process.env.PORT || null;
const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || null;
const BASE_MEDIA_DIR = process.env.BASE_MEDIA_DIR || path.join(__dirname, 'media');
if(PORT === null || IMAGE_BASE_URL === null) throw Error;

app.use(express.static(path.join(__dirname, 'client')));

app.get(`${IMAGE_BASE_URL}/list`, async (req, res) => {
  const files = await readdir(BASE_MEDIA_DIR);

  const dataRes = files.reduce((acc, next) => {
    next = String(next);
    // only process images
    if(next.slice(next.lastIndexOf('.')) !== '.jpg') {
      return acc;
    }

    // add key for label if not present
    const nextLabel = next.slice(0,next.indexOf('-'));
    if(!Object.keys(acc).includes(nextLabel)) {
      Object.defineProperty(acc, nextLabel, {
        value: {},
        writable: true,
        enumerable: true
      });
    }

    // add inner key for quality of this filename
    const nextQuality = next.slice(next.indexOf('-')+1, next.lastIndexOf('.'));
    Object.defineProperty(acc[nextLabel], nextQuality, {
      value: `${IMAGE_BASE_URL}/${nextLabel}?q=${nextQuality}`,
      enumerable: true
    })

    return acc;
  }, {});

  res.type('json').send(dataRes);
});

app.get(`${IMAGE_BASE_URL}/:imgLabel`, async (req, res) => {
  const label = req.params.imgLabel;
  const quality = req.query.q || 'lq';
  const filename = `${label}-${quality}.jpg`;

  const files = await readdir(BASE_MEDIA_DIR);

  if(files.includes(filename)) {
    res.type('jpg').sendFile(path.join(BASE_MEDIA_DIR, filename));
  } else {
    res.type('text').status(404)
      .send('Error 404: The requested image cannot be found.');
  }
});

app.get('/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

app.listen(PORT, () => console.log('server is alive'));