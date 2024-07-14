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

app.use(cors());
app.use(bodyParser.json());

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

app.post('/generate-pdf', async (req, res) => {
  try {
    const cards = req.body.allCards;
    const urls = [];

    for(let i = 0; i < cards.length; i++) {
      const card = cards[i];
      for(let j = 0; j < card.amount; j++){
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
    for(let i = 0; i < numberOfPages; i++) {
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

const refreshAccessToken = async (refreshToken) => {
  try {
    const { tokens } = await oauth2Client.refreshToken(refreshToken);
    return tokens;
  } catch (error) {
    console.error('Error refreshing access token:', error.message);
    throw error;
  }
};

app.post('/upload-pdf', async (req, res) => {
  const { token, refreshToken, allCards } = req.body;

  console.log('Received payload:', req.body);

  if (!refreshToken) {
    return res.status(400).send('No refresh token provided');
  }

  try {
    // Set the current tokens
    oauth2Client.setCredentials({ access_token: token, refresh_token: refreshToken });

    // Refresh the access token if needed
    const newTokens = await oauth2Client.getAccessToken();
    if (newTokens.res && newTokens.res.data && newTokens.res.data.error) {
      const refreshedTokens = await refreshAccessToken(refreshToken);
      oauth2Client.setCredentials(refreshedTokens);
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
