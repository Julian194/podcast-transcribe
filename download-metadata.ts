import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import crypto from "crypto";

dotenv.config();

const apiKey = process.env.PODCAST_INDEX_API_KEY;
const apiSecret = process.env.PODCAST_INDEX_API_SECRET;

if (!apiKey || !apiSecret) {
  console.error("Error: Missing API credentials in environment variables");
  console.error(
    "Please create a .env file with PODCAST_INDEX_API_KEY and PODCAST_INDEX_API_SECRET"
  );
  process.exit(1);
}

// After validation, these variables are guaranteed to have values
const validatedApiKey: string = apiKey;
const validatedApiSecret: string = apiSecret;

interface PodcastEpisode {
  id: number;
  title: string;
  description: string;
  datePublished: number;
  duration: number;
  link: string;
  enclosureUrl: string;
  feedTitle: string;
  feedId: number;
}

async function searchPodcastsByPerson(query: string) {
  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const authHash = crypto
    .createHash("sha1")
    .update(validatedApiKey + validatedApiSecret + apiHeaderTime)
    .digest("hex");

  try {
    const response = await fetch(
      `https://api.podcastindex.org/api/1.0/search/byperson?q=${encodeURIComponent(
        query
      )}`,
      {
        headers: {
          "User-Agent": "MuscleNerds/1.0",
          "X-Auth-Date": apiHeaderTime.toString(),
          "X-Auth-Key": validatedApiKey,
          Authorization: authHash,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error fetching podcast data:", error);
    throw error;
  }
}

async function downloadEpisode(episode: PodcastEpisode) {
  const sanitizedTitle = episode.feedTitle
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase();
  const podcastDir = path.join("data", sanitizedTitle);
  const audioPath = path.join(podcastDir, `${episode.id}.mp3`);
  const metadataPath = path.join(podcastDir, `${episode.id}.json`);

  // Create podcast directory if it doesn't exist
  if (!fs.existsSync(podcastDir)) {
    fs.mkdirSync(podcastDir, { recursive: true });
  }

  // Skip if both audio and metadata already exist
  if (fs.existsSync(audioPath) && fs.existsSync(metadataPath)) {
    console.log(`Episode already downloaded: ${episode.title}`);
    return;
  }

  try {
    // Save metadata if it doesn't exist
    if (!fs.existsSync(metadataPath)) {
      console.log(`Saving metadata for: ${episode.title}`);
      fs.writeFileSync(metadataPath, JSON.stringify(episode, null, 2));
      console.log(`Successfully saved metadata to: ${metadataPath}`);
    }

    // Download audio if it doesn't exist
    if (!fs.existsSync(audioPath)) {
      console.log(`Downloading audio for: ${episode.title}`);
      const response = await fetch(episode.enclosureUrl);

      if (!response.ok) {
        throw new Error(`Failed to download episode: ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      fs.writeFileSync(audioPath, Buffer.from(buffer));
      console.log(`Successfully downloaded audio to: ${audioPath}`);
    }
  } catch (error) {
    console.error(`Error processing episode ${episode.title}:`, error);
    // Create a failed.txt file to track failed downloads
    const failedPath = path.join(podcastDir, "failed_downloads.txt");
    fs.appendFileSync(
      failedPath,
      `${episode.id}\t${episode.title}\t${episode.enclosureUrl}\n`
    );
  }
}

async function processEpisodes(episodes: PodcastEpisode[]) {
  try {
    console.log(`Found ${episodes.length} episodes`);

    for (const episode of episodes) {
      await downloadEpisode(episode);
      // Add a small delay between downloads to be nice to the server
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error("Error processing episodes:", error);
  }
}

async function main() {
  try {
    const searchResults = await searchPodcastsByPerson("luke leaman");
    console.log("Search results:", JSON.stringify(searchResults, null, 2));

    if (searchResults.items && searchResults.items.length > 0) {
      await processEpisodes(searchResults.items);
    } else {
      console.log("No episodes found");
    }
  } catch (error) {
    console.error("Main process failed:", error);
  }
}

main();
