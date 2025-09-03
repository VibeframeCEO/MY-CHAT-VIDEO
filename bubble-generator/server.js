const express = require('express');
const bodyParser = require('body-parser');
const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const morgan = require('morgan');
const cloudinary = require('cloudinary').v2;

// Optional: register a TTF font if you want a specific font file in ./fonts
// registerFont(path.join(__dirname, 'fonts', 'DejaVuSans-Bold.ttf'), { family: 'DejaVu' });

const PORT = process.env.PORT || 3000;
const TMP_DIR = process.env.TMP_DIR || '/tmp'; // Railway / Docker has /tmp
fs.mkdirSync(TMP_DIR, { recursive: true });

/** Cloudinary config (optional)
 * You can set CLOUDINARY_URL or individual env vars:
 * CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME
 * OR set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 */
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

// Serve generated images if using local fallback
app.use('/tmp', express.static(TMP_DIR));

// Simple health
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

// Generate one bubble image, returns local file path
async function generateBubbleImage(text, isSender, options = {}) {
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
  } = options;

  // Canvas for full template
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Fill background: if template file exists, draw it; otherwise plain dark bg
  if (fs.existsSync(backgroundPath)) {
    const bg = await loadImage(backgroundPath);
    ctx.drawImage(bg, 0, 0, width, height);
  } else {
    ctx.fillStyle = '#0f1720'; // fallback background
    ctx.fillRect(0, 0, width, height);
  }

  // Set font
  ctx.font = font; // e.g. '48px sans-serif'
  ctx.textBaseline = 'top';
  ctx.fillStyle = isSender ? '#0d9488' : '#e5e7eb'; // green-ish for sender, light for receiver
  ctx.lineWidth = 0;

  // Wrap text into lines respecting maxBubbleWidth
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const test = cur ? cur + ' ' + words[i] : words[i];
    const w = ctx.measureText(test).width;
    if (w + bubblePaddingX * 2 > maxBubbleWidth) {
      if (cur) {
        lines.push(cur);
        cur = words[i];
      } else {
        // single long word — force break
        lines.push(test);
        cur = '';
      }
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);

  // compute bubble size
  const lineHeight = Math.max(fontSize * 1.12, fontSize + 6);
  const bubbleWidth = Math.min(maxBubbleWidth, Math.max(...lines.map(l => ctx.measureText(l).width)) + bubblePaddingX * 2);
  const bubbleHeight = lines.length * lineHeight + bubblePaddingY * 2;

  // bubble position: left padding or right-aligned
  const marginX = padding;
  let bubbleX;
  if (isSender) {
    bubbleX = width - marginX - bubbleWidth; // right
  } else {
    bubbleX = marginX; // left
  }
  // vertical: near top for single bubble generation — center-ish or 200 px from top
  const bubbleY = 200;

  // draw shadow
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, bubbleX + 4, bubbleY + 8, bubbleWidth, bubbleHeight, 28);
  ctx.fill();
  ctx.restore();

  // draw bubble
  ctx.save();
  ctx.fillStyle = isSender ? '#10b981' : '#374151'; // nice green / dark grey
  roundRect(ctx, bubbleX, bubbleY, bubbleWidth, bubbleHeight, 28);
  ctx.fill();
  ctx.restore();

  // draw text
  ctx.fillStyle = isSender ? '#ffffff' : '#f3f4f6';
  ctx.font = `${fontSize}px sans-serif`;
  let y = bubbleY + bubblePaddingY;
  const xText = bubbleX + bubblePaddingX;
  for (const line of lines) {
    ctx.fillText(line, xText, y);
    y += lineHeight;
  }

  // save file
  const filename = `${uuidv4()}.png`;
  const outPath = path.join(TMP_DIR, filename);
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buffer);

  return outPath;
}

// POST /generate
// body: { messages: [ "text1", "text2", ... ], width?, height?, fontSize? }
// returns { images: [url_or_local_path,...] }
app.post('/generate', async (req, res) => {
  try {
    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return res.status(400).json({ error: 'No messages provided' });

    // options
    const width = body.width || 1080;
    const height = body.height || 1920;
    const fontSize = body.fontSize || 48;
    const templatePath = body.templatePath ? path.resolve(body.templatePath) : path.join(__dirname, 'templates', 'phone-ui.png');

    const results = [];

    // generate images sequentially (to avoid CPU spike). Alternate side: first LEFT (receiver), second RIGHT (sender)
    for (let i = 0; i < messages.length; i++) {
      const text = String(messages[i] || '').trim();
      if (!text) continue;
      const isSender = (i % 2) === 1; // first message is left (receiver=false), second is sender=true
      const file = await generateBubbleImage(text, isSender, { width, height, fontSize, backgroundPath: templatePath });
      // if Cloudinary configured -> upload
      if (cloudinary.config().cloud_name && process.env.CLOUDINARY_UPLOAD === 'true') {
        const uploaded = await cloudinary.uploader.upload(file, { resource_type: 'image' });
        results.push(uploaded.secure_url);
        // delete local file
        try { fs.unlinkSync(file); } catch (e) {}
      } else {
        // return reachable local URL served by this server
        const localUrl = `${req.protocol}://${req.get('host')}/tmp/${path.basename(file)}`;
        results.push(localUrl);
      }
    }

    // reply
    res.json({ images: results });

    // optional: schedule cleanup of tmp older than N seconds (background)
    // simple immediate cleanup not implemented here to not delete files returned to client
  } catch (err) {
    console.error('Error generating bubbles', err);
    res.status(500).json({ error: err.message || 'server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Bubble generator API listening on ${PORT}`);
});
