const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { PDFDocument, rgb } = require('pdf-lib');
const sharp = require('sharp');
const bodyParser = require('body-parser');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(bodyParser.json());

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

// Add CORS headers to all responses
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// Handle preflight requests
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});

app.post('/generate-pdf', async (req, res) => {
  try {
    const cards = req.body.allCards;
    const urls = [];

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      for (let j = 0; j < card.amount; j++) {
        urls.push(card.image);
      }
    }
    const imageBuffers = await Promise.all(urls.map(url =>
      fetch(url)
        .then(res => res.buffer())
        .then(buffer => sharp(buffer).resize(750, 1050).png().toBuffer())
    ));
    // Create a new PDF document
    const pdfDoc = await PDFDocument.create();

    // Constants for card dimensions
    const cardWidth = 2.5 * 300; // 2.5 inches in points
    const cardHeight = 3.5 * 300; // 3.5 inches in points

    // Create a page and add the images
    const numberOfPages = Math.ceil(imageBuffers.length / 9);
    for (let i = 0; i < numberOfPages; i++) {
      const page = pdfDoc.addPage([2550, 3300]);
      const imagesOnPage = [...imageBuffers].splice(i * 9, 9);
      for (let j = 0; j < imagesOnPage.length; j++) {
        const row = Math.floor(j / 3);
        const column = j % 3;
        let top = row * 1075 + 50;
        let left = column * 775 + 75;
        const image = await pdfDoc.embedPng(imagesOnPage[j]);
        page.drawImage(image, {
          x: left,
          y: page.getHeight() - top - cardHeight,
          width: cardWidth,
          height: cardHeight
        });
      }
    }

    // Serialize the PDF to bytes
    const pdfBytes = await pdfDoc.save();

    // Send the PDF file as response
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=generated-deck.pdf');
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

async function refreshAccessToken(refreshToken) {
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const newTokens = await oauth2Client.refreshAccessToken();
  console.log('Refreshed tokens:', newTokens.credentials);
  return newTokens.credentials;
}

app.post('/upload-pdf', async (req, res) => {
  const { token, refreshToken, allCards } = req.body;

  console.log('Received payload:', req.body);

  if (!refreshToken) {
    return res.status(400).send('No refresh token provided');
  }

  try {
    oauth2Client.setCredentials({ access_token: token, refresh_token: refreshToken });

    let tokens = await oauth2Client.getAccessToken();
    console.log('Initial tokens:', tokens);

    if (tokens.res && tokens.res.data && tokens.res.data.error) {
      console.log('Access token expired, refreshing...');
      tokens = await refreshAccessToken(refreshToken);
      oauth2Client.setCredentials(tokens);
    }

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const urls = [];
    for (let i = 0; i < allCards.length; i++) {
      const card = allCards[i];
      for (let j = 0; j < card.amount; j++) {
        urls.push(card.image);
      }
    }

    const imageBuffers = await Promise.all(
      urls.map(url =>
        fetch(url)
          .then(res => res.buffer())
          .then(buffer => sharp(buffer).resize(750, 1050).png().toBuffer())
      )
    );

    const pdfDoc = await PDFDocument.create();
    const cardWidth = 2.5 * 300; // 2.5 inches in points
    const cardHeight = 3.5 * 300; // 3.5 inches in points
    const numberOfPages = Math.ceil(imageBuffers.length / 9);
    for (let i = 0; i < numberOfPages; i++) {
      const page = pdfDoc.addPage([2550, 3300]);
      const imagesOnPage = imageBuffers.slice(i * 9, (i + 1) * 9);
      for (let j = 0; j < imagesOnPage.length; j++) {
        const row = Math.floor(j / 3);
        const column = j % 3;
        const top = row * 1075 + 50;
        const left = column * 775 + 75;
        const image = await pdfDoc.embedPng(imagesOnPage[j]);
        page.drawImage(image, {
          x: left,
          y: page.getHeight() - top - cardHeight,
          width: cardWidth,
          height: cardHeight,
        });
      }
    }

    const pdfBytes = await pdfDoc.save();
    const filePath = path.join(__dirname, 'generated-deck.pdf');
    fs.writeFileSync(filePath, pdfBytes);

    const fileMetadata = {
      name: 'generated-deck.pdf',
      mimeType: 'application/pdf',
    };

    const media = {
      mimeType: 'application/pdf',
      body: fs.createReadStream(filePath),
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id',
    });

    console.log('File uploaded successfully with ID:', response.data.id);
    res.json({ fileId: response.data.id });

    // Clean up: delete the generated PDF file
    fs.unlinkSync(filePath);
  } catch (error) {
    console.error('Error in /upload-pdf:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/oauth2callback', async (req, res) => {
  const code = req.body.code;
  
  try {
    const tokenResponse = await oauth2Client.getToken(code);
    const tokens = tokenResponse.tokens;

    res.json({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
  } catch (error) {
    console.error('Error exchanging code for token:', error);
    res.status(500).send('Error during authorization');
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Proxy server listening at http://localhost:${port}`);
});
