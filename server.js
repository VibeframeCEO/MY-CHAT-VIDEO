const express = require('express');
const bodyParser = require('body-parser');
const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const morgan = require('morgan');
const cloudinary = require('cloudinary').v2;

const PORT = process.env.PORT || 3000;
const TMP_DIR = process.env.TMP_DIR || '/tmp';
fs.mkdirSync(TMP_DIR, { recursive: true });

if (process.env.CLOUDINARY_URL) {
  cloudinary.config({ secure: true });
} else if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

const app = express();
app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '1mb' }));
app.use('/tmp', express.static(TMP_DIR));

app.get('/', (req, res) => res.send('✅ Bubble generator up'));

// Helper to draw rounded rect
function roundRect(ctx, x, y, w, h, r) {
  const min = Math.min(w / 2, h / 2);
  if (r > min) r = min;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Generate full conversation image
async function generateConversation(messages, options = {}) {
  const {
    width = 1080,
    height = 1920,
    padding = 36,
    bubblePaddingX = 28,
    bubblePaddingY = 20,
    maxBubbleWidth = Math.floor(width * 0.75),
    fontSize = 48,
    font = '48px sans-serif',
    backgroundPath = path.join(__dirname, 'templates', 'phone-ui.png'),
    spacing = 30
  } = options;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // background
  if (fs.existsSync(backgroundPath)) {
    const bg = await loadImage(backgroundPath);
    ctx.drawImage(bg, 0, 0, width, height);
  } else {
    ctx.fillStyle = '#0f1720';
    ctx.fillRect(0, 0, width, height);
  }

  ctx.textBaseline = 'top';
  ctx.font = `${fontSize}px sans-serif`;

  let bubbleY = 200; // starting Y position

  for (let i = 0; i < messages.length; i++) {
    const text = String(messages[i] || '').trim();
    if (!text) continue;

    const isSender = (i % 2) === 1; // alternate sides

    // wrap text
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const word of words) {
      const test = cur ? cur + ' ' + word : word;
      if (ctx.measureText(test).width + bubblePaddingX * 2 > maxBubbleWidth) {
        lines.push(cur);
        cur = word;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);

    const lineHeight = Math.max(fontSize * 1.12, fontSize + 6);
    const bubbleWidth = Math.min(
      maxBubbleWidth,
      Math.max(...lines.map(l => ctx.measureText(l).width)) + bubblePaddingX * 2
    );
    const bubbleHeight = lines.length * lineHeight + bubblePaddingY * 2;

    // X pos
    const marginX = padding;
    const bubbleX = isSender
      ? width - marginX - bubbleWidth
      : marginX;

    // shadow
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(ctx, bubbleX + 4, bubbleY + 8, bubbleWidth, bubbleHeight, 28);
    ctx.fill();
    ctx.restore();

    // bubble
    ctx.save();
    ctx.fillStyle = isSender ? '#10b981' : '#374151';
    roundRect(ctx, bubbleX, bubbleY, bubbleWidth, bubbleHeight, 28);
    ctx.fill();
    ctx.restore();

    // text
    ctx.fillStyle = isSender ? '#ffffff' : '#f3f4f6';
    let y = bubbleY + bubblePaddingY;
    const xText = bubbleX + bubblePaddingX;
    for (const line of lines) {
      ctx.fillText(line, xText, y);
      y += lineHeight;
    }

    bubbleY += bubbleHeight + spacing; // next message goes lower
  }

  const filename = `${uuidv4()}.png`;
  const outPath = path.join(TMP_DIR, filename);
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buffer);

  return outPath;
}

app.post('/generate', async (req, res) => {
  try {
    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return res.status(400).json({ error: 'No messages provided' });

    const width = body.width || 1080;
    const height = body.height || 1920;
    const fontSize = body.fontSize || 48;
    const templatePath = body.templatePath
      ? path.resolve(body.templatePath)
      : path.join(__dirname, 'templates', 'phone-ui.png');

    const file = await generateConversation(messages, { width, height, fontSize, backgroundPath: templatePath });

    let url;
    if (cloudinary.config().cloud_name && process.env.CLOUDINARY_UPLOAD === 'true') {
      const uploaded = await cloudinary.uploader.upload(file, { resource_type: 'image' });
      url = uploaded.secure_url;
      try { fs.unlinkSync(file); } catch (e) {}
    } else {
      url = `${req.protocol}://${req.get('host')}/tmp/${path.basename(file)}`;
    }

    res.json({ image: url });
  } catch (err) {
    console.error('Error generating conversation', err);
    res.status(500).json({ error: err.message || 'server error' });
  }
});

// cleanup
setInterval(() => {
  const maxAge = 2 * 60 * 1000;
  const now = Date.now();
  fs.readdir(TMP_DIR, (err, files) => {
    if (err) return;
    files.forEach(file => {
      const filePath = path.join(TMP_DIR, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        if (now - stats.mtimeMs > maxAge) {
          fs.unlink(filePath, () => {});
          console.log('🗑️ Deleted old file:', filePath);
        }
      });
    });
  });
}, 60 * 1000);

app.listen(PORT, () => {
  console.log(`Bubble generator API listening on ${PORT}`);
});
