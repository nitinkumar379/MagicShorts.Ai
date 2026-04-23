import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import { google } from "googleapis";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ytdl from "ytdl-core";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import admin from "firebase-admin";
import multer from "multer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Firebase Admin (lazy load config better later if needed)
if (!admin.apps.length) {
  // In this environment, we usually use service account or default credentials
  // For simplicity here, we assume the environment has GOOGLE_APPLICATION_CREDENTIALS or similar
  // Or we just use a placeholder if we're mostly doing client-side firestore
  admin.initializeApp();
}

const db = admin.firestore();

// Setup ffmpeg
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // OAuth YouTube
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI || `${process.env.APP_URL}/api/auth/youtube/callback`
  );

  app.get("/api/auth/youtube/url", (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).send("Missing userId");

    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
      prompt: "consent",
      state: userId as string // Pass userId through state
    });
    res.json({ url });
  });

  app.get("/api/auth/youtube/callback", async (req, res) => {
    const { code, state: userId } = req.query;
    try {
      const { tokens } = await oauth2Client.getToken(code as string);
      
      // Save tokens to Firestore for this user
      if (userId) {
        await db.collection("users").doc(userId as string).collection("youtubeAccounts").doc("primary").set({
          tokens,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }

      res.send(`
        <html>
          <body>
            <script>
              window.opener.postMessage({ type: 'YOUTUBE_AUTH_SUCCESS', userId: '${userId}' }, '*');
              window.close();
            </script>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("Auth error", error);
      res.status(500).send("Auth failed");
    }
  });

  app.get("/api/video-info", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send("Missing url");
    try {
      const info = await ytdl.getBasicInfo(url as string);
      res.json({
        title: info.videoDetails.title,
        description: info.videoDetails.description,
        thumbnail: info.videoDetails.thumbnails[0].url,
        duration: info.videoDetails.lengthSeconds
      });
    } catch (err) {
      console.error(err);
      res.status(500).send("Failed to fetch video info");
    }
  });

  // Video Processing Endpoint (URL)
  app.post("/api/process-video", async (req, res) => {
    const { videoUrl, userId, videoId, startTime } = req.body;
    
    try {
      await db.collection("videos").doc(videoId).update({ status: "downloading" });

      const videoPath = path.join(__dirname, `temp_${videoId}.mp4`);
      const stream = ytdl(videoUrl, { quality: "highestvideo", filter: "audioandvideo" });
      const fileStream = fs.createWriteStream(videoPath);
      stream.pipe(fileStream);

      fileStream.on("finish", async () => {
        await processVideoTask(videoPath, videoId, startTime);
      });

      fileStream.on("error", async (err) => {
        console.error("Download error", err);
        await db.collection("videos").doc(videoId).update({ status: "failed", statusMessage: "Download failed" });
      });

      res.json({ message: "Started processing" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to start processing" });
    }
  });
const upload = multer({ dest: "uploads/" });
  app.post("/api/upload-video", upload.single("video"), async (req: any, res) => {
    const { userId } = req.body;
    const file = req.file;
    if (!file || !userId) return res.status(400).send("Missing file or userId");

    const docRef = await db.collection("videos").add({
      userId,
      title: file.originalname,
      status: "analyzing",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Start processing
    processVideoTask(file.path, docRef.id);
    res.json({ videoId: docRef.id });
  });

  async function processVideoTask(inputPath: string, videoId: string, startTime: number = 0) {
    try {
      await db.collection("videos").doc(videoId).update({ status: "editing" });
      const outputPath = path.join(__dirname, "public", "outputs", `output_${videoId}.mp4`);
      
      // Ensure directory exists
      if (!fs.existsSync(path.dirname(outputPath))) {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      }

      // FFmpeg processing: Crop to 9:16 and limit to 59 seconds
      return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .setStartTime(startTime)
          .setDuration(59)
          .videoFilters([
            {
                filter: 'crop',
                options: 'ih*9/16:ih' // Simple center crop for 9:16
            },
            {
               filter: 'drawtext',
               options: {
                 text: 'AI HIGHLIGHT',
                 fontcolor: 'white',
                 fontsize: 64,
                 x: '(w-text_w)/2',
                 y: '150',
                 box: 1,
                 boxcolor: 'black@0.4',
                 boxborderw: 10
               }
            }
          ])
          .on("error", async (err) => {
            console.error(err);
            await db.collection("videos").doc(videoId).update({ status: "failed", statusMessage: err.message });
            reject(err);
          })
          .on("end", async () => {
            await db.collection("videos").doc(videoId).update({ 
               status: "scheduled", 
               outputPath: `/outputs/output_${videoId}.mp4`,
               updatedAt: admin.firestore.FieldValue.serverTimestamp() 
            });
            // Cleanup input if needed
            // fs.unlinkSync(inputPath);
            resolve(true);
          })
          .save(outputPath);
      });
    } catch (err) {
      console.error(err);
    }
  }

  // YouTube Upload
  app.post("/api/youtube/upload", async (req, res) => {
    const { videoId, userId, metadata } = req.body;
    
    try {
      const projectDoc = await db.collection("videos").doc(videoId).get();
      const data = projectDoc.data();
      if (!data || !data.outputPath) return res.status(404).send("Video not ready");

      // Fetch tokens from Firestore
      const accountDoc = await db.collection("users").doc(userId).collection("youtubeAccounts").doc("primary").get();
      const accountData = accountDoc.data();
      if (!accountData || !accountData.tokens) return res.status(401).send("YouTube not linked");

      const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
      );
      auth.setCredentials(accountData.tokens);

      const youtube = google.youtube({ version: 'v3', auth });
      
      await db.collection("videos").doc(videoId).update({ status: "uploading" });

      const videoFilePath = path.join(__dirname, "public", "outputs", `output_${videoId}.mp4`);
      
      const response = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: metadata.title || data.title,
            description: metadata.description || "#shorts #magicai",
            tags: ['shorts', 'magic-ai', 'viral'],
            categoryId: '22'
          },
          status: {
            privacyStatus: 'public',
            selfDeclaredMadeForKids: false
          }
        },
        media: {
          body: fs.createReadStream(videoFilePath)
        }
      });

      await db.collection("videos").doc(videoId).update({ 
        status: "completed", 
        youtubeVideoId: response.data.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp() 
      });

      res.json(response.data);
    } catch (err) {
      console.error("YouTube upload error:", err);
      await db.collection("videos").doc(videoId).update({ status: "failed", statusMessage: "YouTube upload failed" });
      res.status(500).send("Upload failed");
    }
  });

  // Serve processed videos
  app.use("/outputs", express.static(path.join(__dirname, "public", "outputs")));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
