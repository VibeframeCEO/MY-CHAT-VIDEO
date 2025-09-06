// server.js - Bubble generator (Option B: produce a frame per conversation state)
const express = require('express');
const bodyParser = require('body-parser');
const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const morgan = require('morgan');
const cloudinary = require('cloudinary').v2;

// Optional: register a TTF font if you have one (uncomment & adjust path)
// registerFont(path.join(__dirname, 'fonts', 'DejaVuSans-Bold.ttf'), { family: 'DejaVu' });

const PORT = process.env.PORT || 3000;
const TMP_DIR = process.env.TMP_DIR || '/tmp';
fs.mkdirSync(TMP_DIR, { recursive: true });

/* Cloudinary config (optional)
 * If you set CLOUDINARY_URL or the individual env vars, uploading will work.
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
app.use(bodyParser.json({ limit: '2mb' }));

// Serve generated images if using local fallback
app.use('/tmp', express.static(TMP_DIR));

// Simple health
app.get('/', (req, res) => res.send('✅ Bubble generator up'));

/* helper: rounded rectangle */
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

/* wrapText: returns array of lines for given ctx/font and maxWidth */
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
        // if the single word itself is longer than maxWidth, split characters
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
          if (fragment) {
            // put the final fragment as the next "cur"
            cur = fragment;
          } else {
            cur = '';
          }
        }
      } else {
        // cur empty but word is too long -> split it
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

/*
 * produce frames: for each i produce an image that contains messages[0..i]
 * - messages: array of strings
 * - options: width/height/fontSize etc.
 * returns array of URLs (if cloudinary enabled+upload true) or local /tmp URLs
 */
async function generateConversationFrames(messages, options = {}) {
  const {
    width = 1080,
    height = 1920,
    paddingTop = 140,
    paddingBottom = 140,
    marginSides = 36,
    bubblePaddingX = 28,
    bubblePaddingY = 20,
    gapBetween = 18,
    fontSize = 48,
    maxBubbleWidth = Math.floor(width * 0.75),
    backgroundPath = path.join(__dirname, 'templates', 'phone-ui.png'),
  } = options;

  // tmp canvas for text measuring
  const measureCanvas = createCanvas(10, 10);
  const mctx = measureCanvas.getContext('2d');
  mctx.font = `${fontSize}px sans-serif`;

  // Pre-calc bubble layout for all messages (lines, width, height)
 const bubbles = messages.map((msg, idx) => {
  const text = String(msg.text || '').trim();  // instead of rawText
  const sender = msg.sender || "Sender";

  const lines = wrapText(mctx, text, maxBubbleWidth - bubblePaddingX * 2);
  const lineHeight = Math.max(fontSize * 1.12, fontSize + 6);
  const textWidth = Math.max(...lines.map(l => mctx.measureText(l).width), 0);
  const bubbleW = Math.min(maxBubbleWidth, Math.ceil(textWidth) + bubblePaddingX * 2);
  const bubbleH = Math.ceil(lines.length * lineHeight + bubblePaddingY * 2);

  return {
    index: idx,
    text,
    sender,
    lines,
    bubbleW,
    bubbleH,
    lineHeight
  };
 });


  // compute y positions of stacked bubbles (top -> down)
  const positions = [];
  let cy = paddingTop;
  for (let i = 0; i < bubbles.length; i++) {
    positions.push(cy);
    cy += bubbles[i].bubbleH + gapBetween;
  }
  // total height used by full stack
  const totalStackHeight = cy + paddingBottom - gapBetween;

  // generate frames: one frame per state (0..n-1)
  const frameBase = `${Date.now()}_${uuidv4()}`;
  const results = [];

  for (let state = 0; state < bubbles.length; state++) {
    // create a canvas per frame
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // background
    if (fs.existsSync(backgroundPath)) {
      try {
        const bg = await loadImage(backgroundPath);
        ctx.drawImage(bg, 0, 0, width, height);
      } catch (e) {
        ctx.fillStyle = '#0f1720';
        ctx.fillRect(0, 0, width, height);
      }
    } else {
      ctx.fillStyle = '#0f1720';
      ctx.fillRect(0, 0, width, height);
    }

    // decide yOffset so that the bottom-most visible portion shows the last bubbles:
    // we want to show the bottom of the stack up to 'height', i.e. if totalStackHeight > height,
    // shift up so the last part is visible.
    const lastVisibleIndex = state; // frames show 0..state
    const usedHeightUpToState = positions[lastVisibleIndex] + bubbles[lastVisibleIndex].bubbleH + paddingBottom;
    let yOffset = 0;
    if (usedHeightUpToState > height) {
      // show bottom of used area
      yOffset = usedHeightUpToState - height;
      // clamp non-negative
      if (yOffset < 0) yOffset = 0;
    } else {
      // Optionally we can center vertically when not full — but keep top feel, so yOffset = 0
      yOffset = 0;
    }

    // Draw each bubble 0..state
    for (let i = 0; i <= state; i++) {
      const b = bubbles[i];
      const bubbleY = positions[i] - yOffset;
      // If bubble is completely outside canvas vertically, skip
      if (bubbleY + b.bubbleH < 0 || bubbleY > height) continue;

      // x position (left or right)
      const isSender = (b.sender.toLowerCase() === "sender");
      const bubbleX = isSender ? (width - marginSides - b.bubbleW) : marginSides;

      // shadow
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      roundRect(ctx, bubbleX + 4, bubbleY + 8, b.bubbleW, b.bubbleH, 24);
      ctx.fill();
      ctx.restore();

      // bubble fill
      ctx.save();
      ctx.fillStyle = isSender ? '#10b981' : '#374151';
      roundRect(ctx, bubbleX, bubbleY, b.bubbleW, b.bubbleH, 24);
      ctx.fill();
      ctx.restore();

      // text
      ctx.fillStyle = isSender ? '#ffffff' : '#f3f4f6';
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textBaseline = 'top';
      let ty = bubbleY + bubblePaddingY;
      const tx = bubbleX + bubblePaddingX;
      for (const line of b.lines) {
        ctx.fillText(line, tx, ty);
        ty += b.lineHeight;
      }
    }

    // save file
    const frameName = `${frameBase}_${String(state).padStart(3, '0')}.png`;
    const outPath = path.join(TMP_DIR, frameName);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outPath, buffer);

    // either upload or return local URL
    if (cloudinary.config().cloud_name && process.env.CLOUDINARY_UPLOAD === 'true') {
      try {
        const uploaded = await cloudinary.uploader.upload(outPath, { resource_type: 'image' });
        results.push(uploaded.secure_url);
        try { fs.unlinkSync(outPath); } catch (e) {}
      } catch (e) {
        // fallback to local
        results.push(`${outPath}`);
      }
    } else {
      // reachable via /tmp route
      const localUrl = `${'http'}://${/* we don't know the host here, client will use returned path */ ''}${reqHostPlaceholder()}/tmp/${frameName}`;
      // Because we cannot know the exact host in isolated env, we'll return file path for the caller
      // but also return file system path as fallback
      results.push({
        file: outPath,
        publicUrl: null // caller can construct ${serverBase}/tmp/${frameName}
      });
    }
  }

  return results;
}

/* Helper placeholder for constructing host-based URL - we'll just return empty string here.
   The /generate handler will construct actual public URL using request host if needed. */
function reqHostPlaceholder() { return ''; }

/* POST /generate
   body:
   {
     messages: ["hi","hello","..."],
     width?: number,
     height?: number,
     fontSize?: number,
     templatePath?: string,
     cloudinaryUpload?: boolean   // optional override
   }
   response: { frames: [ { file: localPath, publicUrl|null } ... ] }
*/
app.post('/generate', async (req, res) => {
  try {
    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return res.status(400).json({ error: 'No messages provided' });

    const width = body.width || 1080;
    const height = body.height || 1920;
    const fontSize = body.fontSize || 48;
    const templatePath = body.templatePath ? path.resolve(body.templatePath) : path.join(__dirname, 'templates', 'phone-ui.png');

    // If caller wants to force cloudinary upload for this request
    if (body.cloudinaryUpload === true) process.env.CLOUDINARY_UPLOAD = 'true';

    // Generate frames (returns array of objects or urls based on settings)
    // Note: generateConversationFrames uses internal reqHostPlaceholder - we'll convert local file paths to public urls here:
    const rawResults = await generateConversationFrames(messages, { width, height, fontSize, backgroundPath: templatePath });

    // Build the output list: for local files create public URLs using request host
    const results = rawResults.map(item => {
      if (typeof item === 'string') {
        // uploaded cloudinary url or fs path string; try to detect a cloud url (https...) else file path
        if (item.startsWith('http')) return { url: item, local: null };
        return { url: null, local: item }; // file path
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

/* Cleanup job: delete old files from TMP_DIR every 60 seconds */
setInterval(() => {
  const maxAge = 2 * 60 * 1000; // 2 minutes
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
}, 60 * 1000); // run every 1 minute

app.listen(PORT, () => {
  console.log(`Bubble generator API listening on ${PORT}`);
});
