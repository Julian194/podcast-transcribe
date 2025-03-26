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

async function saveMetadata(episode: PodcastEpisode) {
  const sanitizedTitle = episode.feedTitle
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase();
  const podcastDir = path.join("data", sanitizedTitle);

  // Create podcast directory if it doesn't exist
  if (!fs.existsSync(podcastDir)) {
    fs.mkdirSync(podcastDir, { recursive: true });
  }

  const metadataPath = path.join(podcastDir, `${episode.id}.json`);

  // Skip if metadata already exists
  if (fs.existsSync(metadataPath)) {
    console.log(`Metadata already exists for episode: ${episode.title}`);
    return;
  }

  try {
    console.log(`Saving metadata for: ${episode.title}`);
    fs.writeFileSync(metadataPath, JSON.stringify(episode, null, 2));
    console.log(`Successfully saved metadata to: ${metadataPath}`);
  } catch (error) {
    console.error(`Error saving metadata for episode ${episode.title}:`, error);
  }
}

async function saveEpisodesMetadata(episodes: PodcastEpisode[]) {
  try {
    console.log(`Found ${episodes.length} episodes`);

    for (const episode of episodes) {
      await saveMetadata(episode);
      // Add a small delay between saves to be nice to the filesystem
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch (error) {
    console.error("Error saving episodes metadata:", error);
  }
}

async function main() {
  try {
    const searchResults = await searchPodcastsByPerson("luke leaman");
    console.log("Search results:", JSON.stringify(searchResults, null, 2));

    if (searchResults.items && searchResults.items.length > 0) {
      await saveEpisodesMetadata(searchResults.items);
    } else {
      console.log("No episodes found");
    }
  } catch (error) {
    console.error("Main process failed:", error);
  }
}

main();
