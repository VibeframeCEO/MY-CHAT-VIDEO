// server.js - Bubble generator (Option B: produce a frame per conversation state)
const express = require('express');
const bodyParser = require('body-parser');
const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const morgan = require('morgan');
const cloudinary = require('cloudinary').v2;

// Optional: register a TTF font if you have one
// registerFont(path.join(__dirname, 'fonts', 'DejaVuSans-Bold.ttf'), { family: 'DejaVu' });

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
app.use(bodyParser.json({ limit: '2mb' }));

app.use('/tmp', express.static(TMP_DIR));

app.get('/', (req, res) => res.send('✅ Bubble generator up'));

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

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const test = cur ? (cur + ' ' + words[i]) : words[i];
    const w = ctx.measureText(test).width;
    if (w > maxWidth) {
      if (cur) {
        lines.push(cur);
        cur = words[i];
        if (ctx.measureText(words[i]).width > maxWidth) {
          let word = words[i];
          let fragment = '';
          for (const ch of word) {
            const t = fragment + ch;
            if (ctx.measureText(t).width > maxWidth) {
              lines.push(fragment);
              fragment = ch;
            } else {
              fragment = t;
            }
          }
          cur = fragment || '';
        }
      } else {
        let word = words[i];
        let fragment = '';
        for (const ch of word) {
          const t = fragment + ch;
          if (ctx.measureText(t).width > maxWidth) {
            lines.push(fragment);
            fragment = ch;
          } else {
            fragment = t;
          }
        }
        if (fragment) lines.push(fragment);
        cur = '';
      }
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

async function generateConversationFrames(messages, options = {}) {
  const {
    width = 1080,
    height = 1920,
    paddingTop = 140,
    paddingBottom = 140,
    marginSides = 36,
    bubblePaddingX = 32,
    bubblePaddingY = 24,
    gapBetween = 22,
    fontSize = 54,
    maxBubbleWidth = Math.floor(width * 0.75),
    backgroundPath
  } = options;

  const measureCanvas = createCanvas(10, 10);
  const mctx = measureCanvas.getContext('2d');
  mctx.font = `${fontSize}px sans-serif`;

  const bubbles = messages.map((msg, idx) => {
    const text = String(msg.text || '').trim();
    const sender = msg.sender || "Sender";
    const lines = wrapText(mctx, text, maxBubbleWidth - bubblePaddingX * 2);
    const lineHeight = Math.max(fontSize * 1.12, fontSize + 6);
    const textWidth = Math.max(...lines.map(l => mctx.measureText(l).width), 0);
    const bubbleW = Math.min(maxBubbleWidth, Math.ceil(textWidth) + bubblePaddingX * 2);
    const bubbleH = Math.ceil(lines.length * lineHeight + bubblePaddingY * 2);
    return { index: idx, text, sender, lines, bubbleW, bubbleH, lineHeight };
  });

  const positions = [];
  let cy = paddingTop;
  for (let i = 0; i < bubbles.length; i++) {
    positions.push(cy);
    cy += bubbles[i].bubbleH + gapBetween;
  }

  const frameBase = `${Date.now()}_${uuidv4()}`;
  const results = [];

  for (let state = 0; state < bubbles.length; state++) {
    // Dynamically shrink canvas height so only last bubble + 20px is included
    const cropHeight = positions[state] + bubbles[state].bubbleH + 20;
    const canvas = createCanvas(width, Math.min(cropHeight, height));
    const ctx = canvas.getContext('2d');

    if (backgroundPath && fs.existsSync(backgroundPath)) {
      try {
        const bg = await loadImage(backgroundPath);
        ctx.drawImage(bg, 0, 0, width, canvas.height);
      } catch (e) {
        ctx.fillStyle = '#0f1720';
        ctx.fillRect(0, 0, width, canvas.height);
      }
    } else {
      ctx.fillStyle = '#0f1720';
      ctx.fillRect(0, 0, width, canvas.height);
    }

    for (let i = 0; i <= state; i++) {
      const b = bubbles[i];
      const bubbleY = positions[i];
      const isSender = (b.sender.toLowerCase() === "sender");
      const bubbleX = isSender ? (width - marginSides - b.bubbleW) : marginSides;

      // subtle shadow
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      roundRect(ctx, bubbleX + 3, bubbleY + 6, b.bubbleW, b.bubbleH, 26);
      ctx.fill();
      ctx.restore();

      // bubble fill (blue vs gray-black)
      ctx.save();
      ctx.fillStyle = isSender ? '#2563eb' : '#1f2937';
      roundRect(ctx, bubbleX, bubbleY, b.bubbleW, b.bubbleH, 26);
      ctx.fill();
      ctx.restore();

      // text
      ctx.fillStyle = '#ffffff';
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textBaseline = 'top';
      let ty = bubbleY + bubblePaddingY;
      const tx = bubbleX + bubblePaddingX;
      for (const line of b.lines) {
        ctx.fillText(line, tx, ty);
        ty += b.lineHeight;
      }
    }

    const frameName = `${frameBase}_${String(state).padStart(3, '0')}.png`;
    const outPath = path.join(TMP_DIR, frameName);
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'));

    if (cloudinary.config().cloud_name && process.env.CLOUDINARY_UPLOAD === 'true') {
      try {
        const uploaded = await cloudinary.uploader.upload(outPath, { resource_type: 'image' });
        results.push(uploaded.secure_url);
        try { fs.unlinkSync(outPath); } catch (e) {}
      } catch (e) {
        results.push(`${outPath}`);
      }
    } else {
      results.push({ file: outPath, publicUrl: null });
    }
  }

  return results;
}

function reqHostPlaceholder() { return ''; }

app.post('/generate', async (req, res) => {
  try {
    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return res.status(400).json({ error: 'No messages provided' });

    const width = body.width || 1080;
    const height = body.height || 1920;
    const fontSize = body.fontSize || 54;
    const templatePath = body.templatePath ? path.resolve(body.templatePath) : path.join(__dirname, 'templates', 'phone-ui.png');

    if (body.cloudinaryUpload === true) process.env.CLOUDINARY_UPLOAD = 'true';

    const rawResults = await generateConversationFrames(messages, {
      width, height, fontSize, backgroundPath: templatePath
    });

    const results = rawResults.map(item => {
      if (typeof item === 'string') {
        if (item.startsWith('http')) return { url: item, local: null };
        return { url: null, local: item };
      } else if (item && item.file) {
        const publicUrl = `${req.protocol}://${req.get('host')}/tmp/${path.basename(item.file)}`;
        return { url: publicUrl, local: item.file };
      } else {
        return { url: null, local: null };
      }
    });

    res.json({ frames: results });

  } catch (err) {
    console.error('Error generating conversation frames', err);
    res.status(500).json({ error: err.message || 'server error' });
  }
});

setInterval(() => {
  const maxAge = 2 * 60 * 1000;
  const now = Date.now();
  fs.readdir(TMP_DIR, (err, files) => {
    if (err) return console.error('Cleanup error (readdir):', err);
    files.forEach(file => {
      const filePath = path.join(TMP_DIR, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return console.error('Cleanup error (stat):', err);
        if (now - stats.mtimeMs > maxAge) {
          fs.unlink(filePath, err => {
            if (err) console.error('Cleanup error (unlink):', err);
            else console.log('🗑️ Deleted old file:', filePath);
          });
        }
      });
    });
  });
}, 60 * 1000);

app.listen(PORT, () => {
  console.log(`Bubble generator API listening on ${PORT}`);
});
