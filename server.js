const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { PDFDocument, rgb } = require('pdf-lib');
const sharp = require('sharp');
const bodyParser = require('body-parser');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json()); // Parse JSON request bodies

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

// Start the server
app.listen(port, () => {
  console.log(`Proxy server listening at http://localhost:${port}`);
});
