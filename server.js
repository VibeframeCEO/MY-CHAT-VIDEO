// server.js - Bubble generator
const express = require('express');
const bodyParser = require('body-parser');
const { createCanvas, loadImage } = require('canvas');
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
    paddingTop = 200,
    marginSides = 36,
    bubblePaddingX = 32,
    bubblePaddingY = 24,
    gapBetween = 22,
    fontSize = 54,
    maxBubbleWidth = Math.floor(width * 0.75),
    backgroundPath,
    name = null // 👈 added here
  } = options;

  const measureCanvas = createCanvas(10, 10);
  const mctx = measureCanvas.getContext('2d');
  mctx.font = `${fontSize}px sans-serif`;

  function detectStatusFromMsg(msg) {
    if (!msg) return null;
    const s = (msg.status || msg.state || msg.tick || '').toString().toLowerCase();
    if (s === 'sent' || s === 'delivered' || s === 'seen' || s === 'read') return s === 'read' ? 'seen' : s;
    if (msg.seen === true || msg.read === true || msg.read_at || msg.readAt) return 'seen';
    if (msg.delivered === true || msg.delivered_at || msg.deliveredAt) return 'delivered';
    return null;
  }

  const bubbles = messages.map((msg, idx) => {
    const sender = msg.sender || "Sender";

    if (msg.typing) {
      const bubbleW = Math.floor(fontSize * 3.5);
      const bubbleH = Math.floor(fontSize * 2);
      return { index: idx, sender, typing: true, bubbleW, bubbleH };
    }

    const text = String(msg.text || '').trim();
    const detected = detectStatusFromMsg(msg);
    const lines = wrapText(mctx, text, maxBubbleWidth - bubblePaddingX * 2);
    const lineHeight = Math.max(fontSize * 1.12, fontSize + 6);
    const textWidth = Math.max(...lines.map(l => mctx.measureText(l).width), 0);
    const bubbleW = Math.min(maxBubbleWidth, Math.ceil(textWidth) + bubblePaddingX * 2);
    const bubbleH = Math.ceil(lines.length * lineHeight + bubblePaddingY * 2);
    return { index: idx, text, sender, status: detected, lines, bubbleW, bubbleH, lineHeight };
  });

  const frameBase = `${Date.now()}_${uuidv4()}`;
  const results = [];

  for (let state = 0; state < bubbles.length; state++) {

    const visibleBubbles = [];
    for (let j = 0; j <= state; j++) {
      const b = bubbles[j];
      if (b.typing) {
        let nextRealIdx = -1;
        for (let k = j + 1; k < bubbles.length; k++) {
          if (!bubbles[k].typing && bubbles[k].sender === b.sender) {
            nextRealIdx = k;
            break;
          }
        }
        if (nextRealIdx === -1 || nextRealIdx > state) {
          visibleBubbles.push(b);
        }
      } else {
        visibleBubbles.push(b);
      }
    }

    let cy = paddingTop;
    const positions = [];
    for (let i = 0; i < visibleBubbles.length; i++) {
      positions.push(cy);
      cy += visibleBubbles[i].bubbleH + gapBetween;
    }
    if (positions.length === 0) positions.push(paddingTop);

    const lastPos = positions[positions.length - 1];
    const lastBubble = visibleBubbles[visibleBubbles.length - 1] || { bubbleH: 0 };
    const cropHeight = lastPos + lastBubble.bubbleH + 50;
    const canvas = createCanvas(width, Math.min(cropHeight, height));
    const ctx = canvas.getContext('2d');

    // background
    if (backgroundPath && fs.existsSync(backgroundPath)) {
      try {
        const bg = await loadImage(backgroundPath);
        const aspect = bg.width / bg.height;
        const bgHeight = width / aspect;
        ctx.drawImage(bg, 0, 0, width, bgHeight);
        if (bgHeight < canvas.height) {
          ctx.fillStyle = '#0f1720';
          ctx.fillRect(0, bgHeight, width, canvas.height - bgHeight);
        }
      } catch {
        ctx.fillStyle = '#0f1720';
        ctx.fillRect(0, 0, width, canvas.height);
      }
    } else {
      ctx.fillStyle = '#0f1720';
      ctx.fillRect(0, 0, width, canvas.height);
    }

    // 👇 draw the "name" on top center if provided
    if (name) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `${Math.floor(fontSize * 1.2)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(name, width / 2, 40); // 40px from top
    }

    // bubbles
    for (let i = 0; i < visibleBubbles.length; i++) {
      const b = visibleBubbles[i];
      const bubbleY = positions[i];
      const isSender = (b.sender.toLowerCase() === "sender");
      const bubbleX = isSender ? (width - marginSides - b.bubbleW) : marginSides;

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      roundRect(ctx, bubbleX + 3, bubbleY + 6, b.bubbleW, b.bubbleH, 26);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.fillStyle = isSender ? '#2563eb' : '#1f2937';
      roundRect(ctx, bubbleX, bubbleY, b.bubbleW, b.bubbleH, 26);
      ctx.fill();
      ctx.restore();

      if (b.typing) {
        ctx.fillStyle = '#ffffff';
        const dotSize = Math.max(6, Math.floor(fontSize * 0.28));
        const totalWidth = dotSize * 4;
        const startX = bubbleX + (b.bubbleW / 2) - (totalWidth / 2);
        const centerY = bubbleY + b.bubbleH / 2;
        for (let d = 0; d < 3; d++) {
          ctx.beginPath();
          ctx.arc(startX + d * (dotSize * 1.7), centerY, dotSize, 0, 2 * Math.PI);
          ctx.fill();
        }
        continue;
      }

      ctx.fillStyle = '#ffffff';
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textBaseline = 'top';
      let ty = bubbleY + bubblePaddingY;
      const tx = bubbleX + bubblePaddingX;
      for (const line of b.lines) {
        ctx.fillText(line, tx, ty);
        ty += b.lineHeight;
      }

      if (isSender) {
        const finalStatus = b.status || 'delivered';
        let tickText = '✔✔';
        let tickColor = '#9ca3af';
        if (finalStatus === 'sent') tickText = '✔';
        if (finalStatus === 'seen') tickColor = '#0080ff';

        const tickFontSize = Math.max(18, Math.floor(fontSize * 0.8));
        ctx.font = `${tickFontSize}px sans-serif`;
        ctx.textBaseline = 'alphabetic';
        const tickWidth = ctx.measureText(tickText).width;
        const tickX = bubbleX + b.bubbleW - tickWidth - 10;
        const tickY = bubbleY + b.bubbleH - bubblePaddingY * 0.1;
        ctx.fillStyle = tickColor;
        ctx.fillText(tickText, tickX, tickY);
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

app.post('/generate', async (req, res) => {
  try {
    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return res.status(400).json({ error: 'No messages provided' });

    const width = body.width || 1080;
    const height = body.height || 1920;
    const fontSize = body.fontSize || 54;
    const templatePath = body.templatePath ? path.resolve(body.templatePath) : null;
    const name = body.name || null; // 👈 grab name from body

    const rawResults = await generateConversationFrames(messages, {
      width, height, fontSize, backgroundPath: templatePath, name
    });

    const results = rawResults.map(item => {
      const publicUrl = `${req.protocol}://${req.get('host')}/tmp/${path.basename(item.file)}`;
      return { url: publicUrl, local: item.file };
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
    if (err) return;
    files.forEach(file => {
      const filePath = path.join(TMP_DIR, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        if (now - stats.mtimeMs > maxAge) {
          fs.unlink(filePath, () => {});
        }
      });
    });
  });
}, 60 * 1000);

app.listen(PORT, () => {
  console.log(`Bubble generator API listening on ${PORT}`);
});
