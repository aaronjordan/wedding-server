require('dotenv').config();
const path = require('path');
const express = require('express');
const app = express();

const PORT = process.env.PORT || null;
if(PORT === null) throw Error;

app.use(express.static(path.join(__dirname, 'client')));

app.get('/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

app.listen(PORT, () => console.log('server is alive'));