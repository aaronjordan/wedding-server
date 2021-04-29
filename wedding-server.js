const path = require('path');
const express = require('express');
const app = express();

const PORT = 7001;

// Have Node serve the files for our built React app
app.use(express.static(path.join(__dirname, 'client')));

app.get('/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

app.listen(PORT, () => console.log('server is alive'));