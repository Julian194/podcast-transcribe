import Replicate from "replicate";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const replicateApiKey = process.env.REPLICATE_API_KEY;
if (!replicateApiKey) {
  console.error("Error: Missing Replicate API key in environment variables");
  console.error("Please add REPLICATE_API_KEY to your .env file");
  process.exit(1);
}

const replicate = new Replicate({
  auth: replicateApiKey,
});

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

interface TranscriptSegment {
  speaker: string;
  timestampFrom: string;
  timestampTo: string;
  content: string;
}

interface ReplicateSegment {
  speaker: number;
  start: number;
  end: number;
  text: string;
}

interface ReplicateResponse {
  segments: ReplicateSegment[];
}

async function transcribeAudio(audioUrl: string): Promise<TranscriptSegment[]> {
  try {
    const output = (await replicate.run(
      "thomasmol/whisper-diarization:d8bc5908738ebd84a9bb7d77d94b9c5e5a3d867886791d7171ddb60455b4c6af",
      {
        input: {
          file_url: audioUrl,
          num_speakers: 2,
          language: "en",
        },
      }
    )) as ReplicateResponse;

    if (!output?.segments) {
      throw new Error("Invalid response from Replicate");
    }

    return output.segments.map((segment) => ({
      speaker: `Speaker ${segment.speaker}`,
      timestampFrom: formatTime(segment.start),
      timestampTo: formatTime(segment.end),
      content: segment.text,
    }));
  } catch (error) {
    console.error("Error transcribing audio:", error);
    throw error;
  }
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds
    .toString()
    .padStart(2, "0")}`;
}

async function loadEpisodeMetadata(
  directory: string,
  metadataFile: string
): Promise<PodcastEpisode | null> {
  try {
    const metadataPath = path.join(directory, metadataFile);

    if (!fs.existsSync(metadataPath)) {
      console.error(`No metadata found at: ${metadataPath}`);
      return null;
    }

    const metadataContent = fs.readFileSync(metadataPath, "utf-8");
    return JSON.parse(metadataContent);
  } catch (error) {
    console.error("Error loading episode metadata:", error);
    return null;
  }
}

async function saveTranscript(
  directory: string,
  metadataFile: string,
  transcript: TranscriptSegment[]
) {
  const transcriptPath = path.join(
    directory,
    `${path.parse(metadataFile).name}_transcript.json`
  );
  fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));
  console.log(`Transcript saved to: ${transcriptPath}`);
}

async function processPodcastDirectory(directory: string) {
  try {
    const metadataFiles = fs
      .readdirSync(directory)
      .filter(
        (file) => file.endsWith(".json") && !file.endsWith("_transcript.json")
      );

    for (const metadataFile of metadataFiles) {
      console.log(`Processing: ${metadataFile}`);

      const metadata = await loadEpisodeMetadata(directory, metadataFile);
      if (!metadata?.enclosureUrl) {
        console.error(`No enclosure URL found in metadata for ${metadataFile}`);
        continue;
      }

      try {
        const transcript = await transcribeAudio(metadata.enclosureUrl);
        await saveTranscript(directory, metadataFile, transcript);
      } catch (error) {
        console.error(`Failed to transcribe episode ${metadata.title}:`, error);
        // Create a failed.txt file to track failed transcriptions
        const failedPath = path.join(directory, "failed_transcriptions.txt");
        fs.appendFileSync(
          failedPath,
          `${metadataFile}\t${metadata.enclosureUrl}\n`
        );
      }
    }
  } catch (error) {
    console.error("Error processing directory:", error);
  }
}

async function getPodcastDirectories(dataDir: string): Promise<string[]> {
  const podcastDirs = fs.readdirSync(dataDir);
  if (podcastDirs.length === 0) {
    console.log("No podcast directories found in data folder");
    return [];
  }
  return podcastDirs;
}

async function main() {
  try {
    const numPodcasts = parseInt(process.argv[2]) || 1;
    console.log(
      `Processing ${numPodcasts} podcast${numPodcasts > 1 ? "s" : ""}`
    );

    const dataDir = path.join(process.cwd(), "data");
    const podcastDirs = await getPodcastDirectories(dataDir);

    if (podcastDirs.length === 0) {
      console.log("No podcast directories found in data folder");
      return;
    }

    const podcastsToProcess = podcastDirs.slice(0, numPodcasts);
    for (const podcastDir of podcastsToProcess) {
      const fullPath = path.join(dataDir, podcastDir);
      if (fs.statSync(fullPath).isDirectory()) {
        console.log(`\nProcessing podcast: ${podcastDir}`);
        await processPodcastDirectory(fullPath);
      }
    }
  } catch (error) {
    console.error("Main process failed:", error);
  }
}

main();
